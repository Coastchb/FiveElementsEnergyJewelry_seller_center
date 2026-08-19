/* ========== 商品管理 Products ========== */

let productState = {
  type: '', categoryId: '', status: '', keyword: '',
  page: 1, pageSize: 20
};

let _productCategories = [];
let _selectedIds = new Set();
let _productCache = {};   // productId → 商品对象（含解析后的 _images/_listImages/_displayImages 链接）
let _suppliers = [];      // 供应商列表缓存 { supplierId, name }
let _categories = [];     // 后端分类缓存 { id, name }，来自 categories 集合
let _productsInited = false;

async function loadSuppliers() {
  try {
    const res = await apiCall('getAdminUsers', { role: 'supplier', pageNum: 1, pageSize: 1000 });
    _suppliers = (res && res.list) || [];
    const sel = $('#pfSupplierId');
    if (sel) {
      const current = sel.value;
      sel.innerHTML = '<option value="">请选择供应商</option>' +
        _suppliers.map(s => `<option value="${escapeHtml(s.supplierId)}">${escapeHtml(s.name || s.account || s.supplierId)}</option>`).join('');
      if (current && _suppliers.find(s => s.supplierId === current)) sel.value = current;
    }
  } catch (e) {
    console.warn('加载供应商列表失败', e);
  }
}

async function loadCategories() {
  try {
    const res = await apiCall('getCollectionData', { collection: 'categories', pageNum: 1, pageSize: 1000 });
    _categories = (res && res.list) || [];
  } catch (e) {
    console.warn('加载分类列表失败', e);
    _categories = [];
  }
}

function getSupplierName(supplierId) {
  const s = _suppliers.find(x => x.supplierId === supplierId);
  return s ? (s.name || s.account || supplierId) : '';
}

async function initProducts() {
  if (_productsInited) return;
  _productsInited = true;

  // 加载供应商/分类列表，供编辑弹窗下拉框使用
  loadSuppliers();
  await loadCategories();
  updateCategoryOptions();

  // 筛选变化
  $('#prodType').addEventListener('change', async (e) => {
    productState.type = e.target.value; productState.page = 1;
    updateCategoryOptions();
    await loadProducts();
  });
  $('#prodCategory').addEventListener('change', async (e) => {
    productState.categoryId = e.target.value; productState.page = 1;
    await loadProducts();
  });
  $('#prodStatus').addEventListener('change', async (e) => {
    productState.status = e.target.value; productState.page = 1;
    await loadProducts();
  });
  $('#prodKeyword').addEventListener('input', debounce(async (e) => {
    productState.keyword = e.target.value; productState.page = 1;
    await loadProducts();
  }, 400));

  // 从 Excel 批量上传
  $('#importDocBtn').addEventListener('click', openImportConfirmModal);

  // 上传商品图片（腾讯文档 → 云存储 → 回写文档）
  $('#uploadImagesBtn').addEventListener('click', openUploadImagesModal);

  // 批量操作
  $('#batchShelfBtn').addEventListener('click', () => batchShelf(true));
  $('#batchOffBtn').addEventListener('click', () => batchShelf(false));
  $('#batchStockBtn').addEventListener('click', openBatchStockModal);
  $('#batchPriceBtn').addEventListener('click', openBatchPriceModal);
  $('#batchDeleteBtn').addEventListener('click', batchDelete);

  // 上传历史按钮（与其他按钮一致，点击切换到上传历史页）
  const gotoTh = $('#gotoTaskHistoryBtn');
  if (gotoTh) gotoTh.addEventListener('click', () => {
    if (typeof navigateTo === 'function') navigateTo('taskhistory');
  });

  // 全选
  $('#selectAll').addEventListener('change', (e) => {
    _selectedIds.clear();
    if (e.target.checked) {
      $$('#productBody input[type="checkbox"]').forEach(cb => _selectedIds.add(cb.value + ':' + (cb.dataset.type || 'product')));
    }
    updateCheckboxes();
  });

  // 弹窗关闭
  $('#prodModalClose').addEventListener('click', closeProductForm);
  $('#prodModalCancel').addEventListener('click', closeProductForm);
  $('#prodModalSave').addEventListener('click', saveProduct);
  $('#prodModalOverlay').addEventListener('click', (e) => {
    if (e.target === $('#prodModalOverlay')) closeProductForm();
  });

  // 类型切换时更新分类
  $('#pfProdType').addEventListener('change', updateProdFormCategories);

  // 图片预览（多图）
  bindImagePreview('pfImages', 'pfImagesPreview');
  bindImagePreview('pfListImages', 'pfListImagesPreview');
  bindImagePreview('pfDisplayImages', 'pfDisplayImagesPreview');

  // AI 图自动处理（材料展示图）
  $('#aiProcessBtn').addEventListener('click', processAiImage);
}

function bindImagePreview(textareaId, previewId) {
  const ta = $(`#${textareaId}`);
  if (!ta) return;
  ta.addEventListener('input', () => renderImagePreview(textareaId, previewId));
}

function renderImagePreview(textareaId, previewId) {
  const ta = $(`#${textareaId}`);
  const box = $(`#${previewId}`);
  if (!ta || !box) return;
  const urls = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!urls.length) { box.innerHTML = ''; return; }
  box.innerHTML = urls.map(url => `<img src="${escapeHtml(url)}" class="form-img-preview" onerror="this.style.display='none'">`).join('');
}

function renderImagePreviewUrls(textareaId, previewId, urls) {
  const box = $(`#${previewId}`);
  if (!box) return;
  const list = (urls || []).filter(Boolean);
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = list.map(url => `<img src="${escapeHtml(url)}" class="form-img-preview" onerror="this.style.display='none'">`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ========== AI 图自动处理（调用 processBeadImage 云函数）==========
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = fr.result;
      resolve(String(dataUrl).split(',')[1] || '');
    };
    fr.onerror = () => reject(new Error('读取图片失败'));
    fr.readAsDataURL(file);
  });
}

async function processAiImage() {
  const btn = $('#aiProcessBtn');
  const msg = $('#aiProcessMsg');
  const preview = $('#aiProcessPreview');
  const file = $('#aiImgFile') && $('#aiImgFile').files && $('#aiImgFile').files[0];
  const realW = parseFloat($('#aiRealW').value);
  const realH = parseFloat($('#aiRealH').value);
  const threadDirection = $('#aiThreadDir').value;
  const thickness = parseFloat($('#aiThickness').value);
  const padding = parseInt($('#aiPadding').value, 10) || 0;

  if (!file) { setAiMsg(msg, '请先上传 AI 透明 PNG', 'err'); return; }
  if (!(realW > 0) || !(realH > 0)) { setAiMsg(msg, '请填写有效的横向/纵向真实尺寸(mm)', 'err'); return; }
  if (threadDirection === 'front_back' && !(thickness > 0)) {
    setAiMsg(msg, 'front_back 必须填写沿穿线厚度(mm)', 'err'); return;
  }

  btn.disabled = true; btn.textContent = '处理中...';
  setAiMsg(msg, '正在上传原图到 COS...', '');
  try {
    const imageBase64 = await fileToBase64(file);
    const materialName = $('#pfName').value.trim();
    if (!materialName) throw new Error('请先填写商品名称作为素材目录名');

    // 1) 上传原图到 images/materials/<商品名>/ 目录
    const safeFileName = String(file.name || 'image.png')
      .replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fa5]/g, '_')
      .replace(/_{2,}/g, '_');
    const srcCloudPath = `images/materials/${materialName}/${safeFileName}`;
    const upRes = await fetch(`${API_BASE}/adminUploadFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: safeFileName,
        fileBase64: imageBase64,
        _adminToken: AUTH_TOKEN,
        cloudPath: srcCloudPath,
      }),
    });
    const upJson = await upRes.json().catch(() => ({}));
    if (upJson.code !== 0) throw new Error(upJson.message || '原图上传到 COS 失败');

    // 2) 调用 processBeadImage，传入原图 cloudPath，让云函数把 _card/_assembly 存到同一目录
    setAiMsg(msg, '正在调用 processBeadImage 处理...', '');
    const res = await apiCall('processBeadImage', {
      imageBase64,
      metadata: {
        realWmm: realW, realHmm: realH, threadDirection,
        thicknessMm: threadDirection === 'front_back' ? thickness : undefined,
      },
      output: 'both',
      paddingPx: padding,
      cloudPath: srcCloudPath,
    });

    // 3) 优先用返回的 COS fileID 填入展示图；fallback 用临时 dataURL
    const cardUrl = res.cardFileID || res.cardImageUrl || (res.cardImageBase64 ? 'data:image/png;base64,' + res.cardImageBase64 : '');
    const assemblyUrl = res.assemblyFileID || res.assemblyImageUrl || (res.assemblyImageBase64 ? 'data:image/png;base64,' + res.assemblyImageBase64 : '');

    if (cardUrl) {
      const ta = $('#pfDisplayImages');
      const existing = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!existing.includes(cardUrl)) {
        existing.push(cardUrl);
        ta.value = existing.join('\n');
        renderImagePreview('pfDisplayImages', 'pfDisplayImagesPreview');
      }
    }

    // 预览卡片版 + 装配版（fileID 需要临时 URL 才能预览，交由 renderImagePreviewUrls 处理）
    preview.innerHTML = '';
    const cardPreview = res.cardFileID || res.cardImageUrl;
    const asmPreview = res.assemblyFileID || res.assemblyImageUrl;
    if (cardPreview) {
      preview.innerHTML += `<div><div style="font-size:12px;color:var(--text-light);">卡片版 ${res.cardSize.w}x${res.cardSize.h}</div><img src="${cardPreview.startsWith('cloud://') ? '' : cardPreview}" data-fileid="${cardPreview.startsWith('cloud://') ? cardPreview : ''}" onload="if(this.dataset.fileid){resolveImageUrls([this.dataset.fileid]).then(m=>{const u=m.get(this.dataset.fileid);if(u)this.src=u;});}" onerror="this.style.display='none'"></div>`;
    }
    if (asmPreview) {
      preview.innerHTML += `<div><div style="font-size:12px;color:var(--text-light);">装配版 ${res.assemblySize.w}x${res.assemblySize.h}</div><img src="${asmPreview.startsWith('cloud://') ? '' : asmPreview}" data-fileid="${asmPreview.startsWith('cloud://') ? asmPreview : ''}" onload="if(this.dataset.fileid){resolveImageUrls([this.dataset.fileid]).then(m=>{const u=m.get(this.dataset.fileid);if(u)this.src=u;});}" onerror="this.style.display='none'"></div>`;
    }

    const warn = res.warning ? `（${res.warning}）` : '';
    const note = res.note ? ` ${res.note}` : '';
    setAiMsg(msg, `处理成功，已填入展示图${warn}${note}`, 'ok');
  } catch (e) {
    // 后端会明确提示"非透明背景"等，直接透传
    setAiMsg(msg, '处理失败: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = '处理并填入展示图';
  }
}

function setAiMsg(el, text, cls) {
  if (!el) return;
  el.textContent = text;
  el.className = 'ai-process-msg' + (cls ? ' ' + cls : '');
}

async function loadProducts() {
  try {
    const params = {
      type: productState.type || 'all',
      categoryId: productState.categoryId || undefined,
      status: productState.status || undefined,
      keyword: productState.keyword || undefined,
      pageNum: productState.page,
      pageSize: productState.pageSize
    };
    const data = await apiCall('getAdminProducts', params);
    if ($('#prodTotalText')) $('#prodTotalText').textContent = `共 ${data.total || 0} 个商品`;

    const tbody = $('#productBody');
    if (!data.list || data.list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-state">暂无商品数据</td></tr>';
      return;
    }

    _selectedIds.clear();
    $('#selectAll').checked = false;
    _productCategories = data.list.reduce((acc, p) => {
      if (!acc.find(c => c.id === p.categoryId)) acc.push({ id: p.categoryId, name: p.categoryName });
      return acc;
    }, []);

    // 批量把云存储 fileID 换成临时 http 链接（mock 模式下 http 链接直接透传）
    const allImgs = [];
    data.list.forEach(p => {
      (p.images || []).forEach(img => allImgs.push(img));
      if (p.firstImage && !p.images) allImgs.push(p.firstImage);
      (p.listImages || []).forEach(img => allImgs.push(img));
      (p.displayImages || []).forEach(img => allImgs.push(img));
    });
    const urlMap = await resolveImageUrls(allImgs);
    // 给每个商品附加解析后的可渲染链接，并计算统一业务 ID
    data.list.forEach(p => {
      p._idField = p.type === 'material' ? 'materialId' : 'productId';
      p._bizId = p[p._idField] || '';
      p._images = (p.images || (p.firstImage ? [p.firstImage] : [])).map(v => urlMap.get(v) || '');
      p._listImages = (p.listImages || []).map(v => urlMap.get(v) || '');
      p._displayImages = (p.displayImages || []).map(v => urlMap.get(v) || '');
      if (p._bizId) _productCache[p._bizId] = p;
    });

    tbody.innerHTML = data.list.map(p => {
      const statusText = p.status || '在售';
      const shelfColor = statusText === '在售' ? '#3C8C40' : (statusText === '已下架' ? '#999' : '#C9760E');
      const stockClass = p.stock <= 0 ? 'stock-low' : '';
      const typeText = p.type === 'product' ? '成品' : (p.type === 'material' ? '配饰' : '材料');
      const imgSrc = (p._images && p._images[0]) || '';
      const name = p.productName || p.materialName || '';
      const homeText = p.homeRecommended ? '是' : '否';
      const supplierName = p.supplierName || getSupplierName(p.supplierId) || '-';
      return `
      <tr>
        <td><input type="checkbox" value="${p._bizId}" data-type="${p.type || 'product'}" class="prod-cb"></td>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            ${imgSrc ? `<img src="${imgSrc}" class="prod-img-thumb" onerror="this.style.display='none'">` : ''}
            <div>
              <div style="font-weight:500;">${name}</div>
              <div style="font-size:12px;color:#999;">${p.tagline || ''}</div>
            </div>
          </div>
        </td>
        <td>${typeText}</td>
        <td>${p.categoryName || '-'}</td>
        <td>${fmtMoney(p.price)}</td>
        <td style="color:var(--text-light)">${fmtMoney(p.costPrice != null ? p.costPrice : 0)}</td>
        <td class="${stockClass}">${p.stock}</td>
        <td>${supplierName}</td>
        <td>${homeText}</td>
        <td><span style="color:${shelfColor};font-weight:500;">${statusText}</span></td>
        <td>
          <span class="action-link" data-id="${p._bizId}" data-type="${p.type || 'product'}" data-action="edit">编辑</span>
          <span class="action-link danger" data-id="${p._bizId}" data-type="${p.type || 'product'}" data-action="delete">删除</span>
        </td>
      </tr>`;
    }).join('');

    // 绑定操作按钮
    tbody.querySelectorAll('.action-link').forEach(link => {
      link.addEventListener('click', (e) => {
        const id = link.dataset.id;
        const action = link.dataset.action;
        const type = link.dataset.type;
        if (action === 'edit') openProductForm(id, type);
        else if (action === 'delete') deleteProduct(id, type);
      });
    });

    // 绑定复选框
    tbody.querySelectorAll('.prod-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.value;
        const type = cb.dataset.type;
        if (cb.checked) _selectedIds.add(id + ':' + type);
        else _selectedIds.delete(id + ':' + type);
        $('#selectAll').checked = _selectedIds.size === (data.list || []).length;
      });
    });

    renderPagination($('#productPager'), productState.page, productState.pageSize, data.total, data.hasMore, async (page) => {
      productState.page = page;
      await loadProducts();
    });
  } catch(e) {
    showToast('加载商品失败: ' + e.message, 'error');
  }
}

function updateCheckboxes() {
  $$('#productBody .prod-cb').forEach(cb => {
    cb.checked = _selectedIds.has(cb.value + ':' + (cb.dataset.type || 'product'));
  });
}

/** 把 _selectedIds（存储为 "id:type"）按 type 分组 */
function getSelectedGroups() {
  const groups = {};
  _selectedIds.forEach(item => {
    const idx = item.lastIndexOf(':');
    const id = idx > 0 ? item.slice(0, idx) : item;
    const type = idx > 0 ? item.slice(idx + 1) : 'product';
    if (!groups[type]) groups[type] = [];
    groups[type].push(id);
  });
  return groups;
}

/** 对 product/material 分组执行同一 manageProduct action */
async function runGroupedManageAction(action, extraBuilder) {
  const groups = getSelectedGroups();
  const types = Object.keys(groups);
  let total = 0;
  for (const type of types) {
    const ids = groups[type].join(',');
    const extra = extraBuilder ? extraBuilder(type) : {};
    const res = await apiCall('manageProduct', { action, type, ids, ...extra });
    total += (res && (res.updated != null ? res.updated : res.deleted)) || 0;
  }
  return { total, types };
}

async function batchShelf(toOn) {
  if (_selectedIds.size === 0) { showToast('请先选择商品', 'info'); return; }
  const verb = toOn ? '上架' : '下架';
  showModal('确认' + verb, `
    <p style="text-align:center;font-size:15px;line-height:1.6;">确定要将选中的 <b>${_selectedIds.size}</b> 个商品批量${verb}吗？</p>
  `, `
    <button class="btn ${toOn ? 'btn-primary' : 'btn-danger'}" id="batchShelfConfirm">确定</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#batchShelfConfirm');
    if (btn) btn.onclick = async () => {
      closeModal();
      try {
        const status = toOn ? '在售' : '已下架';
        const { total } = await runGroupedManageAction(toOn ? 'batchShelf' : 'batchOff', () => ({ status }));
        showToast(`${toOn ? '批量上架' : '批量下架'}成功（共 ${total} 条）`, 'success');
        _selectedIds.clear();
        $('#selectAll').checked = false;
        await loadProducts();
      } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
    };
  }, 50);
}

async function batchDelete() {
  if (_selectedIds.size === 0) { showToast('请先选择商品', 'info'); return; }
  showModal('确认删除', `
    <p style="text-align:center;font-size:15px;line-height:1.6;color:#C0392B;">确定要永久删除选中的 <b>${_selectedIds.size}</b> 个商品吗？此操作不可恢复。</p>
  `, `
    <button class="btn btn-danger" id="batchDeleteConfirm">确定删除</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#batchDeleteConfirm');
    if (btn) btn.onclick = async () => {
      closeModal();
      try {
        const { total } = await runGroupedManageAction('delete');
        showToast(`已删除 ${total} 个商品`, 'success');
        _selectedIds.clear();
        $('#selectAll').checked = false;
        await loadProducts();
      } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
    };
  }, 50);
}

function filterCategoriesByType(type) {
  // 配饰类型的分类名含 "配饰-"，成品饰品类型使用其余分类
  if (type === 'material') return _categories.filter(c => (c.name || '').includes('配饰-'));
  if (type === 'product') return _categories.filter(c => !(c.name || '').includes('配饰-'));
  return _categories;
}

function updateCategoryOptions() {
  const sel = $('#prodCategory');
  const current = sel.value;
  sel.innerHTML = '<option value="">全部分类</option>';
  const cats = filterCategoriesByType(productState.type);
  cats.forEach(c => { sel.innerHTML += `<option value="${c.id}">${c.name}</option>`; });
  sel.value = current && cats.find(c => c.id === current) ? current : '';
}

async function openProductForm(productId, type) {
  // 确保分类/供应商列表已加载
  if (!_categories.length) await loadCategories();
  if (!_suppliers.length) await loadSuppliers();

  const sel = $('#pfCategory');
  const supplierSel = $('#pfSupplierId');
  if (supplierSel) {
    supplierSel.innerHTML = '<option value="">请选择供应商</option>' +
      _suppliers.map(s => `<option value="${escapeHtml(s.supplierId)}">${escapeHtml(s.name || s.account || s.supplierId)}</option>`).join('');
  }

  const setImages = (id, arr, previewUrls) => {
    const ta = $(`#${id}`);
    ta.value = (arr || []).join('\n');
    // 预览优先用解析后的 http 链接（fileID 无法直接渲染），缺省回退到原始值
    const urls = (previewUrls && previewUrls.length) ? previewUrls : (arr || []);
    renderImagePreviewUrls(id, id.replace('Images', 'ImagesPreview'), urls);
  };

  if (productId) {
    // 真实后端模式下优先使用列表缓存，缓存未命中再回退到本地 mock 数据
    let p = _productCache[productId];
    if (!p && type === 'product') p = db.products.find(prod => prod.productId === productId);
    if (!p && type === 'material') p = db.materials.find(m => m.materialId === productId);
    if (!p) { showToast('未找到该商品', 'error'); return; }
    const cached = _productCache[productId] || {};
    $('#pfId').value = productId;
    $('#pfName').value = p.productName || p.materialName || '';
    $('#pfProdType').value = p.type || type;
    $('#pfCategory').value = p.categoryId;
    $('#pfPrice').value = p.price;
    $('#pfCost').value = p.costPrice != null ? p.costPrice : '';
    $('#pfStock').value = p.stock;
    $('#pfTagline').value = p.tagline || '';
    // textarea 存原始 fileID（保存时回写），预览用解析后的 http 链接
    setImages('pfImages', p.images || (p.firstImage ? [p.firstImage] : []), cached._images);
    $('#pfStatus').value = p.status || '在售';
    $('#pfType').value = p.type || type;
    if (supplierSel) supplierSel.value = p.supplierId || '';
    $('#pfHomeRecommended').value = p.homeRecommended ? 'true' : 'false';
    $('#pfColorName').value = p.colorName || '';
    $('#pfColorHex').value = p.colorHex || '';
    $('#pfSpecSize').value = p.specSize || '';
    $('#pfThreadWidth').value = p.threadWidthMm != null ? p.threadWidthMm : '';
    setImages('pfListImages', p.listImages, cached._listImages);
    setImages('pfDisplayImages', p.displayImages, cached._displayImages);
    $('#prodModalTitle').textContent = '编辑商品';
  } else {
    $('#pfId').value = '';
    $('#pfName').value = '';
    $('#pfProdType').value = 'product';
    $('#pfPrice').value = '';
    $('#pfCost').value = '';
    $('#pfStock').value = '';
    $('#pfTagline').value = '';
    setImages('pfImages', []);
    $('#pfStatus').value = '在售';
    $('#pfType').value = 'product';
    if (supplierSel) supplierSel.value = '';
    $('#pfHomeRecommended').value = 'false';
    $('#pfColorName').value = '';
    $('#pfColorHex').value = '';
    $('#pfSpecSize').value = '';
    $('#pfThreadWidth').value = '';
    setImages('pfListImages', []);
    setImages('pfDisplayImages', []);
    $('#prodModalTitle').textContent = '新增商品';
  }
  updateProdFormCategories();
  if (!productId && !sel.value && sel.options.length) sel.value = sel.options[0].value;
  $('#prodModalOverlay').style.display = 'flex';
}

function updateProdFormCategories() {
  const type = $('#pfProdType').value;
  const cats = filterCategoriesByType(type);
  const sel = $('#pfCategory');
  const current = sel.value;
  sel.innerHTML = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (!cats.length) sel.innerHTML = '<option value="">暂无分类</option>';
  if (current && cats.find(c => c.id === current)) sel.value = current;

  // 材料类型显示列表图/展示图字段
  const isMaterial = type === 'material';
  const listRow = $('#pfListImagesRow');
  const displayRow = $('#pfDisplayImagesRow');
  if (listRow) listRow.style.display = isMaterial ? 'flex' : 'none';
  if (displayRow) displayRow.style.display = isMaterial ? 'flex' : 'none';
}

function closeProductForm() { $('#prodModalOverlay').style.display = 'none'; }

async function saveProduct() {
  const id = $('#pfId').value;
  const type = $('#pfProdType').value;
  const isMaterial = type === 'material';
  const idKey = isMaterial ? 'materialId' : 'productId';
  const nameKey = isMaterial ? 'materialName' : 'productName';
  const parseUrls = (id) => $(`#${id}`).value.split('\n').map(s => s.trim()).filter(Boolean);
  const supplierId = $('#pfSupplierId').value;
  const data = {
    action: id ? 'update' : 'create',
    type,
    [idKey]: id || undefined,
    [nameKey]: $('#pfName').value,
    categoryId: $('#pfCategory').value,
    price: $('#pfPrice').value,
    costPrice: $('#pfCost').value,
    stock: $('#pfStock').value,
    tagline: $('#pfTagline').value,
    images: parseUrls('pfImages'),
    status: $('#pfStatus').value,
    supplierId,
    supplierName: supplierId ? getSupplierName(supplierId) : '',
    homeRecommended: $('#pfHomeRecommended').value === 'true',
    colorName: $('#pfColorName').value.trim(),
    colorHex: $('#pfColorHex').value.trim(),
    specSize: $('#pfSpecSize').value.trim()
  };
  if (isMaterial) {
    data.threadWidthMm = $('#pfThreadWidth').value;
    data.listImages = parseUrls('pfListImages');
    data.displayImages = parseUrls('pfDisplayImages');
  }
  if (!data[nameKey] || !data.categoryId || !data.price || data.stock === '') {
    showToast('请填写完整信息', 'error'); return;
  }
  try {
    await apiCall('manageProduct', data);
    showToast(id ? '修改成功' : '新增成功', 'success');
    closeProductForm();
    await loadProducts();
  } catch(e) { showToast('保存失败: ' + e.message, 'error'); }
}

async function deleteProduct(productId, type) {
  const idKey = type === 'material' ? 'materialId' : 'productId';
  showModal('确认删除', `<p style="text-align:center;">确定要删除该商品吗？此操作不可恢复。</p>`, `
    <button class="btn btn-danger" id="deleteConfirm">确认删除</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#deleteConfirm');
    if (btn) btn.onclick = async () => {
      closeModal();
      try {
        await apiCall('manageProduct', { action: 'delete', type, [idKey]: productId });
        showToast('删除成功', 'success');
        await loadProducts();
      } catch(e) { showToast('删除失败: ' + e.message, 'error'); }
    };
  }, 50);
}

// ========== 批量改库存 / 改价格 ==========
function openBatchStockModal() {
  if (_selectedIds.size === 0) { showToast('请先选择商品', 'info'); return; }
  showModal('批量修改库存', `
    <p style="margin-bottom:12px;color:var(--text-light);">已选中 <b>${_selectedIds.size}</b> 个商品，将统一设为下面输入的库存值。</p>
    <div class="form-row"><label>新库存</label><input type="number" id="batchStockVal" class="form-input" min="0" value="0"></div>
  `, `
    <button class="btn btn-primary" id="batchStockConfirm">保存</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#batchStockConfirm');
    if (btn) btn.onclick = async () => {
      const val = $('#batchStockVal').value;
      if (val === '') { showToast('请输入库存值', 'error'); return; }
      await runBatch('batchStock', { stock: +val });
    };
  }, 50);
}

function openBatchPriceModal() {
  if (_selectedIds.size === 0) { showToast('请先选择商品', 'info'); return; }
  showModal('批量修改价格', `
    <p style="margin-bottom:12px;color:var(--text-light);">已选中 <b>${_selectedIds.size}</b> 个商品，将统一上调指定百分比。</p>
    <div class="form-row"><label>上调(%)</label><input type="number" id="batchPricePct" class="form-input" step="0.01" value="10" placeholder="如 10 表示上涨 10%"></div>
    <p style="font-size:12px;color:#999;margin-left:92px;">新价格 = 当前价格 × (1 + 上调百分比/100)</p>
  `, `
    <button class="btn btn-primary" id="batchPriceConfirm">保存</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#batchPriceConfirm');
    if (btn) btn.onclick = async () => {
      const pct = parseFloat($('#batchPricePct').value);
      if (isNaN(pct)) { showToast('请输入有效的百分比', 'error'); return; }
      await runBatch('batchPrice', { priceDeltaPct: pct });
    };
  }, 50);
}

async function runBatch(action, extra) {
  try {
    const { total, types } = await runGroupedManageAction(action, () => extra);
    showToast(`批量操作成功（涉及 ${types.length} 种类型，共 ${total} 条）`, 'success');
    closeModal();
    _selectedIds.clear();
    $('#selectAll').checked = false;
    await loadProducts();
  } catch (e) { showToast('批量操作失败: ' + e.message, 'error'); }
}

// ========== 批量上传：本地 Excel 上传 ==========
// 大文件分片上传参数
const UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB/片，降低单请求大小/时间，避免网关/浏览器超时
const UPLOAD_CONCURRENCY = 3;              // 并发片数
const UPLOAD_MAX_RETRY = 2;                // 单分片失败重试次数

// 上传单个分片到 adminUploadFile，返回 fileID（带重试）
async function uploadPartToCloud(file, start, end, partIndex, totalParts, token, onProgress) {
  const chunk = file.slice(start, end);
  const partName = `${file.name || 'import.xlsx'}.part${partIndex}`;
  const qs = `_adminToken=${encodeURIComponent(token)}&fileName=${encodeURIComponent(partName)}`;
  const url = `${API_BASE}/adminUploadFile?${qs}`;

  let lastErr = null;
  for (let attempt = 0; attempt <= UPLOAD_MAX_RETRY; attempt++) {
    try {
      if (attempt > 0) console.log(`[upload] 分片 ${partIndex}/${totalParts} 第 ${attempt + 1} 次重试`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: chunk,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
      }
      const json = await res.json().catch(() => ({ code: -1, message: '上传响应解析失败' }));
      if (json.code !== 0) {
        throw new Error(json.message || `分片 ${partIndex} 上传失败`);
      }
      if (!json.data || !json.data.fileID) {
        throw new Error(`分片 ${partIndex} 未返回 fileID`);
      }
      if (typeof onProgress === 'function') onProgress(partIndex, totalParts);
      return json.data.fileID;
    } catch (e) {
      lastErr = e;
      console.error(`[upload] 分片 ${partIndex}/${totalParts} 尝试 ${attempt + 1} 失败:`, e.message || e);
      if (attempt < UPLOAD_MAX_RETRY) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`分片 ${partIndex}/${totalParts} 上传失败: ${lastErr && lastErr.message ? lastErr.message : lastErr}`);
}

// 把文件分片上传到 adminUploadFile 云存储接口，返回 fileID 数组（绕开 HTTP 触发器 10MB / cloud.callFunction 6MB 限制）
async function uploadFileToCloud(file, onProgress) {
  const token = localStorage.getItem('seller_token') || '';
  if (!file) throw new Error('未选择文件');
  if (file.size === 0) throw new Error('文件大小为 0');

  const totalParts = Math.ceil(file.size / UPLOAD_CHUNK_SIZE);
  console.log(`[upload] 开始分片上传: ${file.name}, 大小 ${file.size}, 共 ${totalParts} 片`);
  const fileIDList = new Array(totalParts);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < totalParts) {
      const i = nextIndex++;
      const start = i * UPLOAD_CHUNK_SIZE;
      const end = Math.min(start + UPLOAD_CHUNK_SIZE, file.size);
      fileIDList[i] = await uploadPartToCloud(file, start, end, i + 1, totalParts, token, onProgress);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(UPLOAD_CONCURRENCY, totalParts); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  console.log('[upload] 全部分片上传完成:', totalParts);
  return fileIDList;
}

// 批量上传：Excel 上传使用的「列号」默认值（与 schema.md「列号 ↔ 字段映射对照」一致）
// 成品 / 配饰共用基础列，配饰额外要求透明图列 + 处理参数列
const IMPORT_COL_DEFAULTS = {
  product: {
    colRawName: 'A', colName: 'O', colRawPrice: '', colPrice: 'H', colCost: 'G',
    colCategory: 'F', colTagline: 'N',
    colImages: 'X,Y,Z,AA,AB,AC',
    colBeadSize: 'D',
    colMaterial: 'E',
    colElements: 'P', colHome: 'W',
  },
  material: {
    // 默认列号与业务 Excel 对齐（材料名A / 配饰图片C / 分类D / 零售原价(空) / 零售现价E / 成本价F /
    // 横向G / 纵向H / 形状I / 穿线方向J / 穿线宽度K / 是否挂坠L / 五行属M）
    // 配饰AI名、零售原价默认留空：无该列则不填
    colRawName: 'A', colName: '', colRawPrice: '', colPrice: 'E', colCost: 'F',
    colTransparent: 'C', colCategory: 'D',
    colRealW: 'G', colRealH: 'H', colShape: 'I', colThreadDir: 'J', colThreadWidth: 'K',
    colPendant: 'L',            // 是否挂坠列号：填 TRUE/是/1 表示挂坠（front_back）
    colElements: 'M',
    thicknessMm: 3,             // 默认厚度 3mm（固定值，非 Excel 列号）
    kPxPerMm: '',               // 默认留空：按原图不放大
  },
};

// 上传弹窗必填校验：返回未填字段 id 列表（空数组表示全部已填）
// 例外（非必填）：库存列（diColStock，只读）、统一像素精度（diMKpxPerMm）
function validateImportForm() {
  const type = $('#diType').value;
  const required = [
    'diSupplier',
    'diDocUrl', // 固定腾讯文档在线表格模式，链接必填
  ];
  if (type === 'product') {
    required.push(
      'diColName', 'diColPrice', 'diColCost', 'diColCategory', 'diColTagline',
      'diColImages', 'diColBeadSize', 'diColElements', 'diColHome',
    );
  } else {
    required.push(
      'diMColPrice', 'diMColCost', 'diMColCategory', 'diColTransparent',
      'diMColRealW', 'diMColRealH', 'diMColShape', 'diMColThreadDir',
      'diMColThreadWidth', 'diMColElements',
    );
  }
  const invalid = [];
  required.forEach((fieldId) => {
    const el = $('#' + fieldId);
    let empty = false;
    if (!el) empty = true;
    else if (el.type === 'file') empty = !(el.files && el.files[0]);
    else if (el.tagName === 'SELECT') empty = el.value === '';
    else empty = el.value.trim() === '';
    el && el.classList.toggle('import-invalid', empty);
    if (el) {
      if (empty) {
        el.style.borderColor = '#C0392B';
        el.style.background = 'rgba(192,57,43,.04)';
      } else {
        el.style.borderColor = '';
        el.style.background = '';
      }
    }
    if (empty) invalid.push(fieldId);
  });
  return invalid;
}

// 为上传弹窗中可输入的项绑定：输入即清除该字段的红色边框
function bindImportFieldClear() {
  const fields = document.querySelectorAll('#docImportForm .form-input');
  fields.forEach((el) => {
    const evt = (el.type === 'file' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(evt, () => {
      const v = el.type === 'file' ? (el.files && el.files[0]) : el.value.trim();
      const empty = el.type === 'file' ? !v : (el.tagName === 'SELECT' ? el.value === '' : v === '');
      if (!empty) {
        el.classList.remove('import-invalid');
        el.style.borderColor = '';
        el.style.background = '';
      }
    });
  });
}

// 点击「批量上传商品」时，先确认是否已上传待上传商品的图片
function openImportConfirmModal() {
  showModal('批量上传商品', `
    <p style="text-align:center;font-size:15px;line-height:1.6;">是否已经上传了待上传商品的图片？</p>
  `, `
    <button class="btn btn-outline" id="importConfirmNo">否</button>
    <button class="btn btn-primary" id="importConfirmYes">是</button>
  `);
  setTimeout(() => {
    const yes = $('#importConfirmYes');
    const no = $('#importConfirmNo');
    if (no) no.onclick = () => {
      closeModal();
      showModal('上传提示', `
        <p style="text-align:center;font-size:15px;line-height:1.6;">请先上传图片再上传商品</p>
      `, `
        <button class="btn btn-primary" onclick="closeModal()">好的</button>
      `);
    };
    if (yes) yes.onclick = () => {
      closeModal();
      openImportDocModal();
    };
  }, 50);
}

function openImportDocModal() {
  const dp = IMPORT_COL_DEFAULTS.product;
  const dm = IMPORT_COL_DEFAULTS.material;
  showModal('批量上传商品', `
    <div class="import-summary-err" id="diSummaryErr" style="display:none;color:#C0392B;font-size:13px;font-weight:500;margin:0 0 12px;padding:8px 10px;background:rgba(192,57,43,.06);border-radius:8px;"></div>
    <form id="docImportForm">
      <div class="form-row"><label>上传类型</label>
        <select id="diType" class="form-input">
          <option value="product" selected>成品饰品</option>
          <option value="material">配饰</option>
        </select></div>

      <div class="form-row"><label>供应商</label>
        <select id="diSupplier" class="form-input">
          <option value="">请选择供应商</option>
        </select></div>

      <!-- 固定使用腾讯文档在线表格 -->
      <div class="import-source-doc">
        <div class="form-row"><label>腾讯文档链接</label>
          <input id="diDocUrl" class="form-input" value="" placeholder="https://docs.qq.com/sheet/xxxx?tab=xxx"></div>
      </div>

      <div class="form-row"><label>导入商品数量</label>
        <input id="diMaxCount" class="form-input" type="number" min="1" value="" placeholder="留空表示全部"></div>

      <div class="import-cols import-cols-product">
        <div class="form-row"><label>商品原名列号</label><input id="diColRawName" class="form-input" value="${dp.colRawName}"></div>
        <div class="form-row"><label>商品AI名列号</label><input id="diColName" class="form-input" value="${dp.colName}"></div>
        <div class="form-row"><label>零售原价列号</label><input id="diColRawPrice" class="form-input" value="${dp.colRawPrice}" placeholder="如果没有，就不填"></div>
        <div class="form-row"><label>零售现价列号</label><input id="diColPrice" class="form-input" value="${dp.colPrice}"></div>
        <div class="form-row"><label>成本价列号</label><input id="diColCost" class="form-input" value="${dp.colCost}" placeholder="单颗/单件成本"></div>
        <div class="form-row"><label>分类列号</label><input id="diColCategory" class="form-input" value="${dp.colCategory}" placeholder="填分类名称"></div>
        <div class="form-row"><label>推荐语列号</label><input id="diColTagline" class="form-input" value="${dp.colTagline}" placeholder="可选；留空由 DS 生成"></div>
        <div class="form-row"><label>图片URL列号</label><input id="diColImages" class="form-input" value="${dp.colImages}" placeholder="多列多图逗号分隔；内嵌图按行归位"></div>
        <div class="form-row"><label>珠子尺寸列号</label><input id="diColBeadSize" class="form-input" value="${dp.colBeadSize}" placeholder="如 6mm / 8mm"></div>
        <div class="form-row"><label>材料属性列号</label><input id="diColMaterial" class="form-input" value="${dp.colMaterial}" placeholder="如 天然红胶花"></div>
        <div class="form-row"><label>五行属列号</label><input id="diColElements" class="form-input" value="${dp.colElements}" placeholder="多值逗号分隔"></div>
        <div class="form-row"><label>首页推荐列号</label><input id="diColHome" class="form-input" value="${dp.colHome}" placeholder="TRUE/FALSE"></div>
        <div class="form-row"><label>库存列号</label><input id="diColStock" class="form-input" value="暂时不填，库存管够" readonly disabled></div>
      </div>

      <div class="import-cols import-cols-material" style="display:none">
        <div class="form-row"><label>配饰原名列号</label><input id="diMColRawName" class="form-input" value="${dm.colRawName}"></div>
        <div class="form-row"><label>配饰AI名列号</label><input id="diMColName" class="form-input" value="${dm.colName}" placeholder="如果没有，就不填"></div>
        <div class="form-row"><label>零售原价列号</label><input id="diMColRawPrice" class="form-input" value="${dm.colRawPrice}" placeholder="如果没有，就不填"></div>
        <div class="form-row"><label>零售现价列号</label><input id="diMColPrice" class="form-input" value="${dm.colPrice}"></div>
        <div class="form-row"><label>成本价列号</label><input id="diMColCost" class="form-input" value="${dm.colCost}"></div>
        <div class="form-row"><label>分类列号</label><input id="diMColCategory" class="form-input" value="${dm.colCategory}" placeholder="填分类名称"></div>
        <div class="form-row"><label>配饰图片URL列号</label><input id="diColTransparent" class="form-input" value="${dm.colTransparent}" placeholder="内嵌透明 PNG 所在列"></div>
        <div class="form-row"><label>横向真实尺寸(mm)列号</label><input id="diMColRealW" class="form-input" value="${dm.colRealW}" placeholder="用于生成规格(横向*纵向)"></div>
        <div class="form-row"><label>纵向真实尺寸(mm)列号</label><input id="diMColRealH" class="form-input" value="${dm.colRealH}" placeholder="圆形仅需横向"></div>
        <div class="form-row"><label>形状列号</label><input id="diMColShape" class="form-input" value="${dm.colShape}" placeholder="如 圆形/圆珠/桶珠/鼓珠"></div>
        <div class="form-row"><label>穿线方向列号</label><input id="diMColThreadDir" class="form-input" value="${dm.colThreadDir}" placeholder="前后 / 左右 / 上下"></div>
        <div class="form-row"><label>穿线宽度(mm)列号</label><input id="diMColThreadWidth" class="form-input" value="${dm.colThreadWidth}" placeholder="前后方向留空则自动取厚度"></div>
        <div class="form-row"><label>是否挂坠列号</label><input id="diMColPendant" class="form-input" value="${dm.colPendant}" placeholder="TRUE/是/1 表示挂坠"></div>
        <div class="form-row"><label>五行属列号</label><input id="diMColElements" class="form-input" value="${dm.colElements}"></div>
        <div class="form-row"><label>厚度(mm)</label><input id="diMThickness" class="form-input" type="number" value="${dm.thicknessMm}" placeholder="默认 3mm，可修改"></div>
        <div class="form-row"><label>统一像素精度(k px/mm)</label><input id="diMKpxPerMm" class="form-input" value="${dm.kPxPerMm}" placeholder="留空则按原图不放大；填数字(如60)则全局统一比例"></div>
      </div>
    </form>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" id="docImportStartBtn">开始上传</button>
  `);

  // 加载供应商列表，填充下拉（直接选供应商，无需在 Excel 里放供应商列）
  setTimeout(async () => {
    const sel = $('#diSupplier');
    if (!sel) return;
    try {
      const res = await apiCall('getAdminUsers', { role: 'supplier' });
      const list = (res && res.list) || [];
      sel.innerHTML = '<option value="">请选择供应商</option>'
        + list.map(s => `<option value="${s.supplierId}">${escapeHtml(s.name || s.supplierId)}</option>`).join('');
    } catch (e) {
      console.warn('加载供应商列表失败:', e.message);
    }
  }, 10);

  // 开始上传按钮始终保持可点击：未填写项由点击时的必填校验标红提示，而不是提前禁用按钮。

      // 类型切换：显示对应列组（两组共用 id 的输入框，切换时只切可见性）
      setTimeout(() => {
        const typeSel = $('#diType');
        const grpProduct = document.querySelector('.import-cols-product');
        const grpMaterial = document.querySelector('.import-cols-material');
        if (typeSel && grpProduct && grpMaterial) {
          typeSel.onchange = () => {
            const isMat = typeSel.value === 'material';
            grpProduct.style.display = isMat ? 'none' : '';
            grpMaterial.style.display = isMat ? '' : 'none';
            // 切换时把对应列组重置为默认列号（库存列号固定只读，不重置；供应商下拉不随类型重置）
            if (isMat) {
              const dm = IMPORT_COL_DEFAULTS.material;
              $('#diMColRawName').value = dm.colRawName;
              $('#diMColName').value = dm.colName;
              $('#diMColRawPrice').value = dm.colRawPrice;
              $('#diMColPrice').value = dm.colPrice;
              $('#diMColCost').value = dm.colCost;
              $('#diMColCategory').value = dm.colCategory;
              $('#diColTransparent').value = dm.colTransparent;
              $('#diMColRealW').value = dm.colRealW;
              $('#diMColRealH').value = dm.colRealH;
              $('#diMColShape').value = dm.colShape;
              $('#diMColThreadDir').value = dm.colThreadDir;
              $('#diMColThreadWidth').value = dm.colThreadWidth;
              $('#diMColPendant').value = dm.colPendant;
              $('#diMColElements').value = dm.colElements;
              $('#diMThickness').value = dm.thicknessMm;
              $('#diMKpxPerMm').value = dm.kPxPerMm;
            } else {
              const dp = IMPORT_COL_DEFAULTS.product;
              $('#diColRawName').value = dp.colRawName;
              $('#diColName').value = dp.colName;
              $('#diColRawPrice').value = dp.colRawPrice;
              $('#diColPrice').value = dp.colPrice;
              $('#diColCost').value = dp.colCost;
              $('#diColCategory').value = dp.colCategory;
              $('#diColImages').value = dp.colImages;
              $('#diColElements').value = dp.colElements;
            }
          };
        }
      }, 10);

  // 开始上传按钮：同步绑定（紧跟 showModal 后 DOM 已就绪），避免 setTimeout 时序竞态导致点击无响应
  bindImportFieldClear();
  const btn = $('#docImportStartBtn');
  if (btn) {
    btn.onclick = async () => {
      try {
        // 必填校验：任何未填项都标红，并阻断本次上传
        const invalid = validateImportForm();
        const summary = $('#diSummaryErr');
        if (invalid.length) {
          if (summary) {
            summary.textContent = `还有 ${invalid.length} 项必填未填写（已标红），请补全后再上传`;
            summary.style.display = 'block';
          }
          // 滚动到第一个未填项，方便定位
          const first = $('#' + invalid[0]);
          if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
        if (summary) summary.style.display = 'none';

        // 防止重复提交
        btn.disabled = true;
        btn.textContent = '上传中...';

        const supplierId = $('#diSupplier') ? $('#diSupplier').value : '';
        const type = $('#diType').value;
        const docUrl = $('#diDocUrl').value.trim();
        if (!docUrl) { showToast('请填写腾讯文档链接', 'error'); return; }

        // 固定腾讯文档在线表格模式
        const maxCountRaw = $('#diMaxCount').value.trim();
        const maxCount = maxCountRaw ? parseInt(maxCountRaw, 10) : 0;
        const payload = { source: 'doc', type, docUrl, supplierId, maxCount };

        if (type === 'product') {
          // 列号映射（成品列，含图片列 R~W 等）
          Object.assign(payload, {
            colRawName: $('#diColRawName').value.trim(),
            colName: $('#diColName').value.trim(),
            colRawPrice: $('#diColRawPrice').value.trim(),
            colPrice: $('#diColPrice').value.trim(),
            colCost: $('#diColCost').value.trim(),
            colStock: $('#diColStock').value.trim(),
            colCategory: $('#diColCategory').value.trim(),
            colImages: $('#diColImages').value.trim(),
            colBeadSize: $('#diColBeadSize').value.trim(),
            colMaterial: $('#diColMaterial').value.trim(),
            colTagline: $('#diColTagline').value.trim(),
            colElements: $('#diColElements').value.trim(),
            colHome: $('#diColHome').value.trim(),
          });
        } else {
          // 配饰列号映射
          Object.assign(payload, {
            colRawName: $('#diMColRawName').value.trim(),
            colName: $('#diMColName').value.trim(),
            colRawPrice: $('#diMColRawPrice').value.trim(),
            colPrice: $('#diMColPrice').value.trim(),
            colCost: $('#diMColCost').value.trim(),
            colCategory: $('#diMColCategory').value.trim(),
            colTransparent: $('#diColTransparent').value.trim(),
            colRealW: $('#diMColRealW').value.trim(),
            colRealH: $('#diMColRealH').value.trim(),
            colShape: $('#diMColShape').value.trim(),
            colThreadDir: $('#diMColThreadDir').value.trim(),
            colThreadWidth: $('#diMColThreadWidth').value.trim(),
            colPendant: $('#diMColPendant').value.trim(),
            colElements: $('#diMColElements').value.trim(),
            thicknessMm: parseFloat($('#diMThickness').value) || 3,
            kPxPerMm: $('#diMKpxPerMm').value.trim(),
          });
        }
        const colParams = { ...payload };
        delete colParams.source; delete colParams.docUrl; delete colParams.supplierId;

        // 创建上传任务记录（用于「上传历史」追溯）
        let taskId = '';
        try {
          const session = getSession();
          const tRes = await apiCall('importTaskManager', {
            action: 'create',
            account: session.account || session.name || (AUTH_TOKEN ? '管理员' : ''),
            fileName: docUrl,
            fileSize: 0,
            type,
            sheetName: '(腾讯文档)',
            supplierId,
            params: colParams,
          });
          taskId = (tRes && tRes.taskId) || '';
        } catch (e) {
          showToast('创建上传任务失败: ' + e.message, 'error');
          btn.disabled = false; btn.textContent = '开始上传';
          return;
        }
        if (taskId) payload.taskId = taskId;

        closeModal();
        showToast('上传任务已提交，可到【上传历史】页面查看任务进度', 'success');
        // 不 await：后端通过 upload_tasks 回写状态
        apiCall('importFromTencentDoc', payload).catch((e) => {
          console.error('[上传任务] 后端执行异常', taskId, e);
        });
      } catch (e) {
        // 顶层兜底：任何未预期异常都给出反馈，避免"点击无反应"
        console.error('[上传] 未预期异常:', e);
        showToast('上传异常: ' + (e && e.message ? e.message : e), 'error');
        btn.disabled = false; btn.textContent = '开始上传';
      }
    };
  }
}

// ========== 上传商品图片：腾讯文档 → 云存储 → 回写文档 ==========

function openUploadImagesModal() {
  $('#uploadImagesModal').style.display = 'flex';
  $('#uiResult').innerHTML = '';
  $('#uiProgressWrap').style.display = 'none';
  $('#uiProgressBar').style.width = '0%';
  $('#uiProgressText').textContent = '';
  $('#uiFileHint').textContent = '未选择目录';
  $('#uiFileInput').value = '';
  $('#uploadImagesCancel').style.display = '';
  $('#uploadImagesStart').style.display = '';
  $('#uploadImagesStart').disabled = false;
  $('#uploadImagesStart').textContent = '开始上传';
  $('#uploadImagesDone').style.display = 'none';
  $('#uploadImagesTerminate').style.display = 'none'; // 终止任务仅上传进行中可见
  $('#uploadImagesTerminate').textContent = '终止任务'; // 复位可能的“终止中…”残留
  _uploadCancelled = false; // 重新打开清空上次的终止状态
  _uploadAbortController = null; // 旧任务已结束，避免残留 controller 干扰关闭判断
  _uploadCurrentTaskId = null;
  const summary = $('#uiSummaryErr');
  if (summary) summary.style.display = 'none';

  // 根据上传类型动态切换标签与默认图片数
  const typeSel = $('#uiType');
  const applyType = () => {
    const isMat = typeSel && typeSel.value === 'material';
    const colLabel = $('#uiColNameLabel');
    if (colLabel) colLabel.textContent = isMat ? '配饰名列号' : '商品名列号';
    const per = $('#uiImagesPer');
    if (per) per.value = isMat ? '1' : '6';
  };
  if (typeSel) {
    // 重置为成品默认值（弹窗每次打开都重置）
    typeSel.value = 'product';
    typeSel.onchange = applyType;
  }
  applyType();

  // 输入即清除红色边框
  document.querySelectorAll('#uploadImagesModal .form-input').forEach((el) => {
    const evt = (el.type === 'file' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(evt, () => {
      const v = el.type === 'file' ? (el.files && el.files[0]) : el.value.trim();
      const empty = el.type === 'file' ? !v : (el.tagName === 'SELECT' ? el.value === '' : v === '');
      if (!empty) {
        el.classList.remove('upload-invalid');
        el.style.borderColor = '';
        el.style.background = '';
      }
    });
  });
}

// 上传任务的全局取消令牌：点“终止任务”时 abort()，所有进行中/后续的 fetch 立即中断
let _uploadAbortController = null;
let _uploadCancelled = false;
// 当前图片上传任务在后端 upload_tasks 中的 taskId
let _uploadCurrentTaskId = null;
// 内存 Map：backendTaskId -> { controller, status, type }
// 仅当前浏览器会话可终止，页面刷新后 controller 丢失，只能在上传历史页标记取消
var _uploadTasks = new Map();

// 同步更新后端 upload_tasks 任务状态/结果/日志（失败仅打印，不影响主流程）
async function _updateBackendTask(taskId, status, result, log) {
  if (!taskId) return;
  const t = _uploadTasks.get(taskId);
  if (t) t.status = status;
  try {
    const payload = { action: 'update', taskId, status, finishedAt: Date.now() };
    if (result) payload.result = result;
    if (log) payload.log = log;
    await apiCall('importTaskManager', payload);
  } catch (e) {
    console.error('[taskUpdate] 失败', taskId, e);
  }
}

// 强制终止正在进行的上传任务（仅终止，不关闭弹窗，便于查看已上传进度）
function terminateUploadTask() {
  if (!_uploadAbortController || _uploadCancelled) return;
  _uploadCancelled = true;
  _uploadAbortController.abort();
  $('#uploadImagesTerminate').style.display = 'none';
  $('#uploadImagesTerminate').textContent = '终止任务';
  if (_uploadCurrentTaskId) _updateBackendTask(_uploadCurrentTaskId, 'cancelled', null, '用户从弹窗终止任务');
  showToast('已发送终止指令，正在中止上传…', 'info');
}

function closeUploadImagesModal() {
  // 取消 = 仅关闭弹窗。若上传仍在进行，提示用户用“终止任务”先停掉，避免后台偷偷继续跑
  if (_uploadAbortController && !_uploadCancelled) {
    if (!confirm('上传任务仍在进行中，直接关闭弹窗不会终止上传。确定要关闭吗？（可重新打开弹窗点“终止任务”中止）')) {
      return;
    }
    showToast('弹窗已关闭，但上传仍在后台进行，请重新打开并点“终止任务”', 'info');
  }
  $('#uploadImagesModal').style.display = 'none';
}

// 上传商品图片弹窗必填校验：返回未填字段 id 列表
function validateUploadImagesForm() {
  const required = ['uiDocUrl', 'uiColName', 'uiImagesPer', 'uiWriteStart', 'uiFileInput'];
  const invalid = [];
  required.forEach((fieldId) => {
    const el = $('#' + fieldId);
    let empty = false;
    if (!el) empty = true;
    else if (el.type === 'file') empty = !(el.files && el.files[0]);
    else if (el.tagName === 'SELECT') empty = el.value === '';
    else empty = el.value.trim() === '';
    if (el) {
      el.classList.toggle('upload-invalid', empty);
      if (empty) {
        el.style.borderColor = '#C0392B';
        el.style.background = 'rgba(192,57,43,.04)';
      } else {
        el.style.borderColor = '';
        el.style.background = '';
      }
    }
    if (empty) invalid.push(fieldId);
  });
  return invalid;
}

// 文件名首段数字（下划线前），用于全局序号分组：1_~6_=商品1, 7_~12_=商品2...
function fileGlobalSeq(file) {
  const m = (file.name || '').match(/^(\d+)_/);
  return m ? parseInt(m[1], 10) : NaN;
}

// 把商品名转为云存储安全路径段（去掉 / \ : * ? " < > | # % 等）
function sanitizeCloudName(name) {
  return String(name || '').replace(/[\\/:*?"<>|#%{}]/g, '_').replace(/_{2,}/g, '_').slice(0, 60) || 'unknown';
}

// 上传单个文件到 COS（直接走 uploadProductImageToCos HTTP 触发器，二进制直传）
// 关键：signal 合并「全局取消令牌」+「30s 超时」，既支持点取消即时中断，
// 也避免高并发下请求被网关静默挂起导致并发池整体卡死。
const UPLOAD_TIMEOUT_MS = 30000; // 单张上传 30s 超时，超时即失败进入重试/报错
async function uploadImageFile(file, cloudPath, abortSignal) {
  const token = localStorage.getItem('seller_token') || '';
  const qs = `_adminToken=${encodeURIComponent(token)}&fileName=${encodeURIComponent(file.name)}&cloudPath=${encodeURIComponent(cloudPath)}`;
  const url = `${API_BASE}/uploadProductImageToCos?${qs}`;
  // 合并全局取消信号与超时信号（任一触发即中断本次 fetch）
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)])
    : AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
      signal,
    });
  } catch (e) {
    // 超时 / 网络中断 / 连接被网关断开 / 用户取消 都会走到这里，统一抛错由上层重试或终止
    const reason = e && e.name === 'AbortError'
      ? '已取消'
      : (e && e.name === 'TimeoutError' ? '超时' : (e && e.message) || '网络错误');
    throw new Error(`请求异常(${reason})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json().catch(() => ({ code: -1, message: '响应解析失败' }));
  if (json.code !== 0) throw new Error(json.message || '上传失败');
  if (!json.data || !json.data.url) throw new Error('未返回图片 URL');
  return json.data.url;
}

// 浏览器端压缩图片：长边缩到 maxEdge，质量 quality，输出目标类型的 Blob。
// 不支持的格式（如 heic）/ 解码失败时原样返回，保证不丢图。
async function compressImage(file, { maxEdge = 1280, quality = 0.8, type = 'image/jpeg' } = {}) {
  // 跳过明显无需压缩的小图（< 300KB）直接原图上传
  if (file.size <= 300 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close && bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) return file;
    // 压缩后反而更大（极端情况）则退回原图
    if (blob.size >= file.size) return file;
    const ext = type === 'image/png' ? 'png' : 'jpg';
    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.' + ext;
    return new File([blob], name, { type });
  } catch (e) {
    console.warn('[压缩] 失败，回退原图:', e && e.message);
    return file;
  }
}

// 并发池：对 items 执行 asyncFn，限制并发数 concurrency，支持逐条进度回调
// shouldStop：返回 true 时，worker 不再派发新任务（用于“取消”即时终止）
async function runPool(items, concurrency, asyncFn, onProgress, shouldStop) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < items.length) {
      if (shouldStop && shouldStop()) break; // 取消后不再取新任务
      const idx = cursor++;
      try {
        results[idx] = await asyncFn(items[idx], idx);
      } catch (e) {
        results[idx] = { __error: e };
      }
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  const pool = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) pool.push(worker());
  await Promise.all(pool);
  return results;
}

function setUploadProgress(done, total, text) {
  $('#uiProgressWrap').style.display = 'block';
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#uiProgressBar').style.width = pct + '%';
  $('#uiProgressText').textContent = text || `${done}/${total}`;
}

async function startUploadImages() {
  // 必填校验
  const invalid = validateUploadImagesForm();
  const summary = $('#uiSummaryErr');
  if (invalid.length) {
    if (summary) {
      summary.textContent = `还有 ${invalid.length} 项必填未填写（已标红），请补全后再上传`;
      summary.style.display = 'block';
    }
    const first = $('#' + invalid[0]);
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (summary) summary.style.display = 'none';

  const docUrl = $('#uiDocUrl').value.trim();
  const colName = $('#uiColName').value.trim() || 'A';
  const imagesPer = Math.max(1, parseInt($('#uiImagesPer').value, 10) || 6);
  const writeStart = $('#uiWriteStart').value.trim() || 'X';
  const uploadType = $('#uiType') ? $('#uiType').value : 'product';
  // COS 子路径：成品走 images/products，配饰走 images/materials
  const cosSubPath = uploadType === 'material' ? 'images/materials' : 'images/products';
  const files = Array.from($('#uiFileInput').files || []);

  $('#uiResult').innerHTML = '';

  // 仅保留 png/jpg 图片（过滤 .DS_Store 等非图片文件，也排除 gif/webp/bmp/heic 等）
  const isAllowedImage = (f) => /\.(jpe?g|png)$/i.test(f.name) || /^image\/(jpeg|png)$/i.test(f.type);
  const imageFiles = files.filter(isAllowedImage);
  const skipped = files.length - imageFiles.length;
  if (!imageFiles.length) { showToast(`所选目录下未找到 png/jpg 图片${skipped ? `（已忽略 ${skipped} 个非目标文件）` : ''}`, 'error'); return; }

  // 单图体积提示（原图直传，超大图可能受网关限制）
  const tooLarge = imageFiles.filter((f) => f.size > 4 * 1024 * 1024);
  if (tooLarge.length) {
    showToast(`有 ${tooLarge.length} 张图片超过 4MB，超大图可能上传较慢或失败`, 'info');
  }

  const totalFileSize = imageFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const fileNameText = `${imageFiles.length} 张图片（${uploadType === 'material' ? '配饰' : '成品'}）`;
  const btn = $('#uploadImagesStart');

  // 创建后端任务记录，统一在上传历史页面追溯
  let backendTaskId = '';
  try {
    const session = getSession();
    const tRes = await apiCall('importTaskManager', {
      action: 'create',
      account: session.account || session.name || (AUTH_TOKEN ? '管理员' : ''),
      fileName: fileNameText,
      fileSize: totalFileSize,
      type: 'image',
      sheetName: docUrl,
      supplierId: '',
      params: { docUrl, colName, imagesPer, writeStartCol: writeStart, uploadType },
    });
    backendTaskId = (tRes && tRes.taskId) || '';
  } catch (e) {
    showToast('创建上传任务失败: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = '开始上传';
    return;
  }
  _uploadCurrentTaskId = backendTaskId;

  btn.disabled = true; btn.textContent = '处理中...';
  $('#uploadImagesTerminate').style.display = ''; // 上传进行中显示“终止任务”

  // 初始化本次上传的取消令牌（每次开始重新建，避免上次的 abort 状态残留）
  _uploadAbortController = new AbortController();
  _uploadCancelled = false;
  _uploadTasks.set(backendTaskId, { controller: _uploadAbortController, status: 'uploading', type: 'image' });
  _updateBackendTask(backendTaskId, 'uploading', null, '开始读取腾讯文档商品名');
  const abortSignal = _uploadAbortController.signal;

  try {
    // 1) 读取腾讯文档商品名列表
    setUploadProgress(0, 1, '正在读取腾讯文档商品名...');
    const prep = await apiCall('prepareProductImageUpload', { docUrl, colName });
    const products = (prep && prep.products) || [];
    if (!products.length) throw new Error('腾讯文档未读取到商品名，请检查链接与商品名列号');

    // 2) 校验文件数
    const expectTotal = products.length * imagesPer;
    if (imageFiles.length !== expectTotal) {
      throw new Error(`文件数量不匹配：文档 ${products.length} 个商品 × ${imagesPer} 张 = ${expectTotal} 张，但目录下找到 ${imageFiles.length} 张图片`);
    }

    // 3) 按文件名首段数字排序（全局序号）
    const sorted = imageFiles.slice().sort((a, b) => fileGlobalSeq(a) - fileGlobalSeq(b));
    const bad = sorted.filter((f) => isNaN(fileGlobalSeq(f)));
    if (bad.length) {
      throw new Error(`有 ${bad.length} 个文件未按 "序号_名称" 命名（如 1_xxx.png），无法分组`);
    }

    // 4) 并发压缩 + 并发上传到 images/products/<商品名>/<文件名>
    //    先按文件名分组算好每张的目标 cloudPath（压缩后文件名会变，但路径已锁定），
    //    再以并发池（压缩+上传）执行，避免逐张串行的长时间等待。
    const uploadPlan = sorted.map((f) => {
      const globalSeq = fileGlobalSeq(f);
      const productIdx = Math.floor((globalSeq - 1) / imagesPer); // 0 基商品索引
      const productName = (products[productIdx] && products[productIdx].name) || ('商品' + (productIdx + 1));
      const cloudPath = `${cosSubPath}/${sanitizeCloudName(productName)}/${f.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')}`;
      return { f, cloudPath };
    });

    // 并发度：浏览器对同一域名的并发连接数有硬约束（Chrome 默认 6），
    // 超过后多余请求排队等待空闲连接，反而易被网关空闲超时静默挂起（即本次卡死的根因）。
    // 因此默认取安全的 6 路；若部署在支持 HTTP/2 多路复用的网关且想拉满，
    // 可在控制台执行 localStorage.setItem('seller_upload_concurrency', 20) 自行试档位。
    const MAX_CONCURRENCY = 50;
    let CONCURRENCY = parseInt(localStorage.getItem('seller_upload_concurrency'), 10);
    if (!Number.isFinite(CONCURRENCY) || CONCURRENCY < 1) CONCURRENCY = 6; // 默认安全值，避免一上来就卡死
    CONCURRENCY = Math.min(CONCURRENCY, MAX_CONCURRENCY);
    const uploadResults = await runPool(uploadPlan, CONCURRENCY, async (item) => {
      const { f, cloudPath } = item;
      // 不压缩，原图直传（保留透明背景/原画质）
      for (let attempt = 0; attempt < 3; attempt++) {
        // 用户已点取消：直接抛错退出，不再重试、不再发起新请求
        if (abortSignal.aborted) throw new Error('已取消');
        try {
          return await uploadImageFile(f, cloudPath, abortSignal);
        } catch (e) {
          if (abortSignal.aborted) throw new Error('已取消');
          if (attempt === 2) throw new Error(`上传 ${f.name} 失败: ${e.message}`);
          // 退避：超时/网络类错误稍长，给网关和连接池喘息
          const isTimeout = /超时|网络错误|TimeoutError/.test(e.message);
          await new Promise((r) => setTimeout(r, isTimeout ? 1500 : 800));
        }
      }
    }, (done, total) => {
      setUploadProgress(done, total, `正在上传 ${done}/${total} 张（并发 ${CONCURRENCY}）`);
    }, () => _uploadCancelled); // 取消后不再派发新任务

    const fileIDList = uploadResults;
    // 收集可能存在的单张失败（runPool 已吞掉异常，这里统一报错）
    const failed = [];
    const cancelled = [];
    uploadResults.forEach((v, i) => {
      if (v && v.__error) {
        const msg = v.__error.message || String(v.__error);
        if (/已取消/.test(msg)) cancelled.push(sorted[i].name);
        else failed.push(sorted[i].name + ':' + msg);
      }
    });
    if (_uploadCancelled) {
      // 用户主动取消：不报“失败”，直接以取消状态结束
      const termBtn = $('#uploadImagesTerminate');
      if (termBtn) termBtn.textContent = '终止任务';
      $('#uiResult').innerHTML = `<div class="upload-result-warn">⏹ 已取消，共上传 ${sorted.length - failed.length - cancelled.length}/${sorted.length} 张后终止。</div>`;
      showToast('上传任务已终止', 'info');
      if (_uploadCurrentTaskId) _updateBackendTask(_uploadCurrentTaskId, 'cancelled', { uploaded: sorted.length - failed.length - cancelled.length, total: sorted.length }, '用户在上传图片阶段终止任务');
      return;
    }
    if (failed.length) {
      throw new Error(`有 ${failed.length} 张上传失败：${failed.slice(0, 3).join('；')}${failed.length > 3 ? '…' : ''}`);
    }

    // 5) 分批回写到腾讯文档（避免单次云函数调用超时中断）
    //    云函数默认执行超时较短，一次性回写几十个商品（每张图都要签名+回写请求）
    //    极易超时只写一部分。改为每批 BATCH 个商品循环调用，单批轻量不超时。
    const BATCH = 3; // 每批处理的商品数（3 商品 × 6 图 = 18 次签名 + 3 次回写，确保在网关 3s 超时内同步返回）
    const totalProducts = products.length;
    let writtenOk = 0;
    const writeFail = [];
    setUploadProgress(sorted.length, sorted.length, '图片已上传，正在回写腾讯文档...');
    if (_uploadCurrentTaskId) _updateBackendTask(_uploadCurrentTaskId, 'uploading', null, `图片已上传（${fileIDList.length} 个 fileID），开始回写腾讯文档`);
    for (let sp = 0; sp < totalProducts; sp += BATCH) {
      const cnt = Math.min(BATCH, totalProducts - sp);
      const batchFileIDs = fileIDList.slice(sp * imagesPer, (sp + cnt) * imagesPer);
      console.log(`[回写] 开始第 ${sp + 1}-${sp + cnt} 个商品 (startProduct=${sp}, count=${cnt}, fileIDs=${batchFileIDs.length})`);
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const r = await apiCall('writeProductImageUrls', {
            docUrl, colName, imagesPerProduct: imagesPer, writeStartCol: writeStart,
            fileIDList: batchFileIDs, startProduct: sp, count: cnt,
          });
          const d = (r && r.data) || {};
          console.log(`[回写] 第 ${sp + 1}-${sp + cnt} 个商品 返回:`, JSON.stringify(d));
          writtenOk += (d.success || 0);
          if (d.failList && d.failList.length) {
            d.failList.forEach((f) => writeFail.push(`行${f.row}:${f.reason}`));
          }
          ok = true;
        } catch (e) {
          console.error(`[回写] 第 ${sp + 1}-${sp + cnt} 个商品 异常(attempt ${attempt + 1}):`, e && e.message);
          if (attempt === 2) {
            writeFail.push(`第${sp + 1}-${sp + cnt}个商品回写异常: ${e.message}`);
          } else {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
      setUploadProgress(sorted.length, sorted.length,
        `正在回写腾讯文档 ${Math.min(sp + cnt, totalProducts)}/${totalProducts} 个商品...`);
    }
    console.log(`[回写] 全部批次结束: writtenOk=${writtenOk}, writeFail=${writeFail.length}`);

    const total = products.length;
    if (writeFail.length) {
      $('#uiResult').innerHTML = `<div class="upload-result-warn">⚠️ 图片已上传，回写完成但 ${writeFail.length} 处失败：${writeFail.slice(0, 5).join('；')}${writeFail.length > 5 ? '…' : ''}，请检查文档或重试</div>`;
      showToast(`回写完成，${writeFail.length} 处失败`, 'info');
      if (_uploadCurrentTaskId) _updateBackendTask(_uploadCurrentTaskId, 'failed', { total, success: total - writeFail.length, failCount: writeFail.length }, `回写完成，${writeFail.length} 处失败`);
    } else {
      $('#uiResult').innerHTML = `<div class="upload-result-ok">✅ 已上传并回写 ${total}/${total} 个商品的图片到腾讯文档。</div>`;
      showToast(`上传+回写完成`, 'success');
      if (_uploadCurrentTaskId) _updateBackendTask(_uploadCurrentTaskId, 'success', { total, success: total, failCount: 0 }, '上传+回写完成');
    }
    // 任务彻底完成：进度置 100%、清除“正在回写…”残留文字，并清空 controller，
    // 这样关闭弹窗时不会再误提示“上传任务仍在进行中”。
    setUploadProgress(sorted.length, sorted.length, '已完成');
    _uploadAbortController = null;
    _uploadCancelled = false;
    // 成功后只保留"完成"按钮
    $('#uploadImagesCancel').style.display = 'none';
    $('#uploadImagesStart').style.display = 'none';
    $('#uploadImagesTerminate').style.display = 'none';
    $('#uploadImagesDone').style.display = '';
  } catch (e) {
    console.error('[上传商品图片] 失败', e);
    $('#uiResult').innerHTML = `<div class="upload-result-err">❌ ${e.message}</div>`;
    showToast('上传失败: ' + e.message, 'error');
    $('#uploadImagesTerminate').style.display = 'none';
    if (_uploadCurrentTaskId) {
      const status = _uploadCancelled ? 'cancelled' : 'failed';
      _updateBackendTask(_uploadCurrentTaskId, status, null, e.message || '上传失败');
    }
    // 失败也视为任务结束，清空 controller 避免关闭弹窗时误提示“仍在进行中”
    _uploadAbortController = null;
    _uploadCancelled = false;
  } finally {
    btn.disabled = false; btn.textContent = '开始上传';
  }
}

// 弹窗关闭/取消/终止/开始/完成 绑定
$('#uploadImagesClose').addEventListener('click', closeUploadImagesModal);
$('#uploadImagesCancel').addEventListener('click', closeUploadImagesModal);
$('#uploadImagesTerminate').addEventListener('click', terminateUploadTask);
$('#uploadImagesDone').addEventListener('click', closeUploadImagesModal);
$('#uploadImagesStart').addEventListener('click', startUploadImages);
$('#uploadImagesModal').addEventListener('click', (e) => {
  if (e.target === $('#uploadImagesModal')) closeUploadImagesModal();
});
$('#uiFileInput').addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  const imageFiles = files.filter((f) => /\.(jpe?g|png)$/i.test(f.name) || /^image\/(jpeg|png)$/i.test(f.type));
  const skipped = files.length - imageFiles.length;
  if (!files.length) {
    $('#uiFileHint').textContent = '未选择目录';
  } else if (!imageFiles.length) {
    $('#uiFileHint').textContent = `已选择目录（未找到 png/jpg 图片，共 ${files.length} 个文件）`;
  } else {
    $('#uiFileHint').textContent = `已选择目录（${imageFiles.length} 张 png/jpg 图片${skipped ? `，已忽略 ${skipped} 个非目标文件` : ''}）`;
  }
});
