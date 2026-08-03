/* ========== 商品管理 Products ========== */

let productState = {
  type: '', categoryId: '', status: '', keyword: '',
  page: 1, pageSize: 20
};

let _productCategories = [];
let _selectedIds = new Set();
let _productCache = {};   // productId → 商品对象（含解析后的 _images/_listImages/_displayImages 链接）
let _productsInited = false;

function initProducts() {
  if (_productsInited) return;
  _productsInited = true;
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

  // 新增商品
  $('#addProductBtn').addEventListener('click', () => openProductForm(null));

  // 从 Excel 批量上传
  $('#importDocBtn').addEventListener('click', openImportDocModal);

  // 批量操作
  $('#batchShelfBtn').addEventListener('click', () => batchShelf(true));
  $('#batchOffBtn').addEventListener('click', () => batchShelf(false));
  $('#batchStockBtn').addEventListener('click', openBatchStockModal);
  $('#batchPriceBtn').addEventListener('click', openBatchPriceModal);

  // 全选
  $('#selectAll').addEventListener('change', (e) => {
    _selectedIds.clear();
    if (e.target.checked) {
      $$('#productBody input[type="checkbox"]').forEach(cb => _selectedIds.add(cb.value));
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
  setAiMsg(msg, '正在调用 processBeadImage 处理...', '');
  try {
    const imageBase64 = await fileToBase64(file);
    const res = await apiCall('processBeadImage', {
      imageBase64,
      metadata: {
        realWmm: realW, realHmm: realH, threadDirection,
        thicknessMm: threadDirection === 'front_back' ? thickness : undefined,
      },
      output: 'both',
      paddingPx: padding,
    });

    // 卡片版填入展示图文本框（与 displayImages 字段对齐）
    if (res.cardImageBase64) {
      const dataUrl = 'data:image/png;base64,' + res.cardImageBase64;
      const ta = $('#pfDisplayImages');
      const existing = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!existing.includes(dataUrl)) {
        existing.push(dataUrl);
        ta.value = existing.join('\n');
        renderImagePreview('pfDisplayImages', 'pfDisplayImagesPreview');
      }
    }

    // 预览卡片版 + 装配版
    preview.innerHTML = '';
    if (res.cardImageBase64) {
      preview.innerHTML += `<div><div style="font-size:12px;color:var(--text-light);">卡片版 ${res.cardSize.w}x${res.cardSize.h}</div><img src="data:image/png;base64,${res.cardImageBase64}"></div>`;
    }
    if (res.assemblyImageBase64) {
      preview.innerHTML += `<div><div style="font-size:12px;color:var(--text-light);">装配版 ${res.assemblySize.w}x${res.assemblySize.h}</div><img src="data:image/png;base64,${res.assemblyImageBase64}"></div>`;
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
      type: productState.type || undefined,
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
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">暂无商品数据</td></tr>';
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
    // 给每个商品附加解析后的可渲染链接
    data.list.forEach(p => {
      p._images = (p.images || (p.firstImage ? [p.firstImage] : [])).map(v => urlMap.get(v) || '');
      p._listImages = (p.listImages || []).map(v => urlMap.get(v) || '');
      p._displayImages = (p.displayImages || []).map(v => urlMap.get(v) || '');
      _productCache[p.productId] = p;
    });

    tbody.innerHTML = data.list.map(p => {
      const statusText = p.status || '在售';
      const shelfColor = statusText === '在售' ? '#3C8C40' : (statusText === '已下架' ? '#999' : '#C9760E');
      const stockClass = p.stock <= 0 ? 'stock-low' : '';
      const typeText = p.type === 'product' ? '成品' : '材料';
      const imgSrc = (p._images && p._images[0]) || '';
      const name = p.productName || p.materialName || '';
      return `
      <tr>
        <td><input type="checkbox" value="${p.productId}" class="prod-cb"></td>
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
        <td><span style="color:${shelfColor};font-weight:500;">${statusText}</span></td>
        <td>
          <span class="action-link" data-id="${p.productId}" data-action="edit">编辑</span>
          <span class="action-link danger" data-id="${p.productId}" data-action="delete">删除</span>
        </td>
      </tr>`;
    }).join('');

    // 绑定操作按钮
    tbody.querySelectorAll('.action-link').forEach(link => {
      link.addEventListener('click', (e) => {
        const id = link.dataset.id;
        const action = link.dataset.action;
        if (action === 'edit') openProductForm(id);
        else if (action === 'delete') deleteProduct(id);
      });
    });

    // 绑定复选框
    tbody.querySelectorAll('.prod-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) _selectedIds.add(cb.value);
        else _selectedIds.delete(cb.value);
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
    cb.checked = _selectedIds.has(cb.value);
  });
}

async function batchShelf(toOn) {
  if (_selectedIds.size === 0) { showToast('请先选择商品', 'info'); return; }
  const ids = Array.from(_selectedIds).join(',');
  try {
    await apiCall('manageProduct', { action: toOn ? 'batchShelf' : 'batchOff', ids, status: toOn ? '在售' : '已下架' });
    showToast(toOn ? '批量上架成功' : '批量下架成功', 'success');
    _selectedIds.clear();
    $('#selectAll').checked = false;
    await loadProducts();
  } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
}

function updateCategoryOptions() {
  const sel = $('#prodCategory');
  const current = sel.value;
  sel.innerHTML = '<option value="">全部分类</option>';
  // 根据类型筛选可用分类 - 从全局 mock 数据获取
  const db = getDB();
  let cats = db.categories;
  if (productState.type === 'product') cats = cats.filter(c => ['bracelet', 'necklace', 'earrings'].includes(c.id));
  if (productState.type === 'material') cats = cats.filter(c => ['crystal', 'silver', 'wood'].includes(c.id));
  cats.forEach(c => { sel.innerHTML += `<option value="${c.id}">${c.name}</option>`; });
  sel.value = current && cats.find(c => c.id === current) ? current : '';
}

function openProductForm(productId) {
  const db = getDB();
  const cats = db.categories;
  const sel = $('#pfCategory');
  sel.innerHTML = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  const setImages = (id, arr, previewUrls) => {
    const ta = $(`#${id}`);
    ta.value = (arr || []).join('\n');
    // 预览优先用解析后的 http 链接（fileID 无法直接渲染），缺省回退到原始值
    const urls = (previewUrls && previewUrls.length) ? previewUrls : (arr || []);
    renderImagePreviewUrls(id, id.replace('Images', 'ImagesPreview'), urls);
  };

  if (productId) {
    const p = db.products.find(prod => prod.productId === productId);
    if (!p) return;
    const cached = _productCache[productId] || {};
    $('#pfId').value = p.productId;
    $('#pfName').value = p.productName || p.materialName || '';
    $('#pfProdType').value = p.type;
    $('#pfCategory').value = p.categoryId;
    $('#pfPrice').value = p.price;
    $('#pfCost').value = p.costPrice != null ? p.costPrice : '';
    $('#pfStock').value = p.stock;
    $('#pfTagline').value = p.tagline || '';
    // textarea 存原始 fileID（保存时回写），预览用解析后的 http 链接
    setImages('pfImages', p.images || (p.firstImage ? [p.firstImage] : []), cached._images);
    $('#pfStatus').value = p.status || '在售';
    $('#pfType').value = p.type;
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
    $('#pfCategory').value = cats[0] ? cats[0].id : '';
    $('#pfPrice').value = '';
    $('#pfCost').value = '';
    $('#pfStock').value = '';
    $('#pfTagline').value = '';
    setImages('pfImages', []);
    $('#pfStatus').value = '在售';
    $('#pfType').value = 'product';
    $('#pfColorName').value = '';
    $('#pfColorHex').value = '';
    $('#pfSpecSize').value = '';
    $('#pfThreadWidth').value = '';
    setImages('pfListImages', []);
    setImages('pfDisplayImages', []);
    $('#prodModalTitle').textContent = '新增商品';
  }
  updateProdFormCategories();
  $('#prodModalOverlay').style.display = 'flex';
}

function updateProdFormCategories() {
  const db = getDB();
  const type = $('#pfProdType').value;
  let cats = db.categories;
  if (type === 'product') cats = cats.filter(c => ['bracelet', 'necklace', 'earrings'].includes(c.id));
  if (type === 'material') cats = cats.filter(c => ['crystal', 'silver', 'wood'].includes(c.id));
  const sel = $('#pfCategory');
  const current = sel.value;
  sel.innerHTML = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
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
  const parseUrls = (id) => $(`#${id}`).value.split('\n').map(s => s.trim()).filter(Boolean);
  const data = {
    action: id ? 'update' : 'create',
    productId: id || undefined,
    productName: $('#pfName').value,
    type,
    categoryId: $('#pfCategory').value,
    price: $('#pfPrice').value,
    costPrice: $('#pfCost').value,
    stock: $('#pfStock').value,
    tagline: $('#pfTagline').value,
    images: parseUrls('pfImages'),
    status: $('#pfStatus').value,
    colorName: $('#pfColorName').value.trim(),
    colorHex: $('#pfColorHex').value.trim(),
    specSize: $('#pfSpecSize').value.trim()
  };
  if (type === 'material') {
    data.threadWidthMm = $('#pfThreadWidth').value;
    data.listImages = parseUrls('pfListImages');
    data.displayImages = parseUrls('pfDisplayImages');
  }
  if (!data.productName || !data.categoryId || !data.price || data.stock === '') {
    showToast('请填写完整信息', 'error'); return;
  }
  try {
    await apiCall('manageProduct', data);
    showToast(id ? '修改成功' : '新增成功', 'success');
    closeProductForm();
    await loadProducts();
  } catch(e) { showToast('保存失败: ' + e.message, 'error'); }
}

async function deleteProduct(productId) {
  showModal('确认删除', `<p style="text-align:center;">确定要删除该商品吗？此操作不可恢复。</p>`, `
    <button class="btn btn-danger" id="deleteConfirm">确认删除</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#deleteConfirm');
    if (btn) btn.onclick = async () => {
      closeModal();
      try {
        await apiCall('manageProduct', { productId, action: 'delete' });
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
  const ids = Array.from(_selectedIds).join(',');
  try {
    await apiCall('manageProduct', { action, ids, ...extra });
    showToast('批量操作成功', 'success');
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
    colName: 'A', colPrice: 'H', colCost: 'I',
    colCategory: 'G', colTagline: 'O',
    colImages: 'R,S,T,U,V,W',
    colBeadSize: 'E',
    colElements: 'O', colHome: 'X',
  },
  material: {
    colName: 'A', colPrice: 'H', colCost: 'I',
    colCategory: 'G',
    colTransparent: 'Q',        // 配饰专属：内嵌透明 PNG 所在列，经 processBeadImage 处理
    colRealW: 'N', colRealH: 'O', colThreadDir: 'P', colThickness: 'R', colThreadWidth: 'S',
    colShape: 'T', colElements: 'V',
  },
};

// 上传弹窗必填校验：返回未填字段 id 列表（空数组表示全部已填）
// 例外（非必填）：库存列（diColStock，只读）、配饰的厚度（diMColThickness）、统一像素精度（diMKpxPerMm）
function validateImportForm() {
  const type = $('#diType').value;
  const source = $('#diSource') ? $('#diSource').value : 'xlsx';
  const required = [
    'diSupplier',
  ];
  // 本地 Excel 模式：文件 + 工作表必填
  if (source === 'xlsx') {
    required.push('diFile', 'diSheetName');
  } else {
    // 腾讯文档模式：链接必填
    required.push('diDocUrl');
  }
  if (type === 'product') {
    required.push(
      'diColName', 'diColPrice', 'diColCost', 'diColCategory', 'diColTagline',
      'diColImages', 'diColBeadSize', 'diColElements', 'diColHome',
    );
  } else {
    required.push(
      'diMColName', 'diMColPrice', 'diMColCost', 'diMColCategory', 'diColTransparent',
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

function openImportDocModal() {
  const d = IMPORT_COL_DEFAULTS.product;
  showModal('批量上传商品', `
    <div class="import-summary-err" id="diSummaryErr" style="display:none;color:#C0392B;font-size:13px;font-weight:500;margin:0 0 12px;padding:8px 10px;background:rgba(192,57,43,.06);border-radius:8px;"></div>
    <form id="docImportForm">
      <div class="form-row"><label>数据来源</label>
        <select id="diSource" class="form-input">
          <option value="xlsx" selected>本地 Excel 文件</option>
          <option value="doc">腾讯文档在线表格</option>
        </select></div>
      <div class="form-row"><label>上传类型</label>
        <select id="diType" class="form-input">
          <option value="product" selected>成品饰品</option>
          <option value="material">DIY材料（配饰）</option>
        </select></div>

      <!-- 来源：本地 Excel -->
      <div class="import-source-xlsx">
        <div class="form-row"><label>上传 Excel 文件</label>
          <input type="file" id="diFile" accept=".xlsx,.xls" class="form-input"></div>
        <div class="form-row"><label>工作表名称</label>
          <input id="diSheetName" class="form-input" value="" placeholder="如 成品-测试（必填）"></div>
      </div>

      <!-- 来源：腾讯文档（doc 模式仅支持成品，图片列填 URL 文本）-->
      <div class="import-source-doc" style="display:none">
        <div class="form-row"><label>腾讯文档链接</label>
          <input id="diDocUrl" class="form-input" value="" placeholder="https://docs.qq.com/sheet/xxxx?tab=xxx"></div>
        <p class="import-tip">提示：腾讯文档模式仅支持「成品饰品」。图片列（如 R,S,T,U,V,W）填写<b>图片 URL</b> 文本，系统会自动转存到云存储；内嵌图块也兼容。链接需带 <code>?tab=</code> 指定子表。</p>
      </div>

      <div class="form-row"><label>供应商</label>
        <select id="diSupplier" class="form-input">
          <option value="">请选择供应商</option>
        </select></div>

      <div class="import-cols import-cols-product">
        <div class="form-row"><label>商品名列号</label><input id="diColName" class="form-input" value="${d.colName}"></div>
        <div class="form-row"><label>零售价列号</label><input id="diColPrice" class="form-input" value="${d.colPrice}"></div>
        <div class="form-row"><label>成本价列号</label><input id="diColCost" class="form-input" value="${d.colCost}" placeholder="单颗/单件成本"></div>
        <div class="form-row"><label>分类列号</label><input id="diColCategory" class="form-input" value="${d.colCategory}" placeholder="填分类名称"></div>
        <div class="form-row"><label>推荐语列号</label><input id="diColTagline" class="form-input" value="${d.colTagline}" placeholder="可选；留空由 DS 生成"></div>
        <div class="form-row"><label>图片列号</label><input id="diColImages" class="form-input" value="${d.colImages}" placeholder="多列多图逗号分隔；内嵌图按行归位"></div>
        <div class="form-row"><label>珠子尺寸列号</label><input id="diColBeadSize" class="form-input" value="${d.colBeadSize}" placeholder="如 6mm / 8mm"></div>
        <div class="form-row"><label>五行属列号</label><input id="diColElements" class="form-input" value="${d.colElements}" placeholder="多值逗号分隔"></div>
        <div class="form-row"><label>首页推荐列号</label><input id="diColHome" class="form-input" value="${d.colHome}" placeholder="TRUE/FALSE"></div>
        <div class="form-row"><label>库存列号</label><input id="diColStock" class="form-input" value="暂时不填，库存管够" readonly disabled></div>
      </div>

      <div class="import-cols import-cols-material" style="display:none">
        <div class="form-row"><label>材料名列号</label><input id="diMColName" class="form-input" value="${d.colName}"></div>
        <div class="form-row"><label>零售价列号</label><input id="diMColPrice" class="form-input" value="${d.colPrice}"></div>
        <div class="form-row"><label>成本价列号</label><input id="diMColCost" class="form-input" value="${d.colCost}"></div>
        <div class="form-row"><label>分类列号</label><input id="diMColCategory" class="form-input" value="${d.colCategory}" placeholder="填分类名称"></div>
        <div class="form-row"><label>配饰图片列号</label><input id="diColTransparent" class="form-input" value="${d.colTransparent}" placeholder="内嵌透明 PNG 所在列"></div>
        <div class="form-row"><label>横向真实尺寸(mm)列</label><input id="diMColRealW" class="form-input" value="${d.colRealW}" placeholder="用于生成规格(横向*纵向)"></div>
        <div class="form-row"><label>纵向真实尺寸(mm)列</label><input id="diMColRealH" class="form-input" value="${d.colRealH}" placeholder="圆形仅需横向"></div>
        <div class="form-row"><label>形状列号</label><input id="diMColShape" class="form-input" value="${d.colShape}" placeholder="如 圆形/圆珠/桶珠/鼓珠"></div>
        <div class="form-row"><label>穿线方向列</label><input id="diMColThreadDir" class="form-input" value="${d.colThreadDir}" placeholder="前后 / 左右 / 上下"></div>
        <div class="form-row"><label>穿线宽度(mm)列</label><input id="diMColThreadWidth" class="form-input" value="${d.colThreadWidth}" placeholder="前后方向留空则自动取厚度"></div>
        <div class="form-row"><label>五行属列号</label><input id="diMColElements" class="form-input" value="${d.colElements}"></div>
        <div class="form-row"><label>厚度(mm)</label><input id="diMColThickness" class="form-input" value="4" placeholder="默认 4mm，可修改"></div>
        <div class="form-row"><label>统一像素精度(k px/mm)</label><input id="diMKpxPerMm" class="form-input" value="" placeholder="留空则按原图不放大；填数字(如60)则全局统一比例"></div>
      </div>
    </form>
  `, `
    <button class="btn btn-primary" id="docImportStartBtn">开始上传</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
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

  // 数据来源切换：显示对应输入组（本地 Excel / 腾讯文档链接）
  setTimeout(() => {
    const srcSel = $('#diSource');
    const xlsxGrp = document.querySelector('.import-source-xlsx');
    const docGrp = document.querySelector('.import-source-doc');
    if (srcSel && xlsxGrp && docGrp) {
      srcSel.onchange = () => {
        const isDoc = srcSel.value === 'doc';
        xlsxGrp.style.display = isDoc ? 'none' : '';
        docGrp.style.display = isDoc ? '' : 'none';
        // 腾讯文档模式仅支持成品（成品/配饰共用 diType；doc 模式下强制成品）
        if (isDoc) {
          const typeSel = $('#diType');
          if (typeSel) {
            typeSel.value = 'product';
            typeSel.dispatchEvent(new Event('change'));
            typeSel.disabled = true;
          }
        } else {
          const typeSel = $('#diType');
          if (typeSel) typeSel.disabled = false;
        }
      };
    }
  }, 10);

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
        // 切换时把「成品组」输入框重置为成品默认列号（库存列号固定只读，不重置；供应商下拉不随类型重置）
        const def = IMPORT_COL_DEFAULTS.product;
        $('#diColName').value = def.colName;
        $('#diColPrice').value = def.colPrice;
        $('#diColCost').value = def.colCost;
        $('#diColCategory').value = def.colCategory;
        $('#diColImages').value = def.colImages;
        $('#diColElements').value = def.colElements;
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

        const source = $('#diSource') ? $('#diSource').value : 'xlsx';
        const supplierId = $('#diSupplier') ? $('#diSupplier').value : '';
        const type = $('#diType').value;

        if (source === 'doc') {
          const docUrl = $('#diDocUrl').value.trim();
          if (!docUrl) { showToast('请填写腾讯文档链接', 'error'); return; }
          if (type !== 'product') { showToast('腾讯文档模式仅支持成品饰品', 'error'); return; }
          // ===== 腾讯文档在线表格模式：直接调用后端读取，无需上传文件 =====
          const payload = { source: 'doc', type: 'product', docUrl, supplierId };

          // 列号映射（成品列，含图片列 R~W 等）
          Object.assign(payload, {
            colName: $('#diColName').value.trim(),
            colPrice: $('#diColPrice').value.trim(),
            colCost: $('#diColCost').value.trim(),
            colStock: $('#diColStock').value.trim(),
            colCategory: $('#diColCategory').value.trim(),
            colImages: $('#diColImages').value.trim(),
            colBeadSize: $('#diColBeadSize').value.trim(),
            colTagline: $('#diColTagline').value.trim(),
            colElements: $('#diColElements').value.trim(),
            colHome: $('#diColHome').value.trim(),
          });
          const colParams = { ...payload };
          delete colParams.source; delete colParams.docUrl; delete colParams.supplierId;

          // 创建上传任务记录（用于「上传历史」追溯）
          let taskId = '';
          try {
            const tRes = await apiCall('importTaskManager', {
              action: 'create',
              account: (AUTH_TOKEN ? 'admin' : ''),
              fileName: docUrl,
              fileSize: 0,
              type: 'product',
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
          showToast('上传任务已提交，正在读取腾讯文档', 'success');
          // 不 await：后端通过 upload_tasks 回写状态
          apiCall('importFromTencentDoc', payload).catch((e) => {
            console.error('[上传任务] 后端执行异常', taskId, e);
          });
          return;
        }

        // ===== 本地 Excel 模式 =====
        const fileInput = $('#diFile');
        const file = fileInput && fileInput.files && fileInput.files[0];
        if (!file) { showToast('请先选择 Excel 文件', 'error'); return; }
        const sheetName = $('#diSheetName').value.trim();
        if (!sheetName) { showToast('请填写工作表名称', 'error'); return; }

        const payload = {
          source: 'xlsx',
          type,
          sheetName,
          supplierId,
        };

        // 列号映射（完整传入 importFromTencentDoc，也写入任务记录供追溯）
        const colParams = {};
        if (type === 'product') {
          Object.assign(payload, colParams, {
            colName: $('#diColName').value.trim(),
            colPrice: $('#diColPrice').value.trim(),
            colCost: $('#diColCost').value.trim(),
            colStock: $('#diColStock').value.trim(), // 只读固定 'J'，库存管够
            colCategory: $('#diColCategory').value.trim(),
            colImages: $('#diColImages').value.trim(),
            colBeadSize: $('#diColBeadSize').value.trim(),
            colTagline: $('#diColTagline').value.trim(),
            colElements: $('#diColElements').value.trim(),
            colHome: $('#diColHome').value.trim(),
          });
          Object.assign(colParams, {
            colName: payload.colName, colPrice: payload.colPrice, colCost: payload.colCost,
            colStock: payload.colStock, colCategory: payload.colCategory, colImages: payload.colImages,
            colBeadSize: payload.colBeadSize, colTagline: payload.colTagline,
            colElements: payload.colElements, colHome: payload.colHome,
          });
        } else {
          Object.assign(payload, {
            colName: $('#diMColName').value.trim(),
            colPrice: $('#diMColPrice').value.trim(),
            colCost: $('#diMColCost').value.trim(),
            colCategory: $('#diMColCategory').value.trim(),
            colTransparent: $('#diColTransparent').value.trim(),
            colRealW: $('#diMColRealW').value.trim(),
            colRealH: $('#diMColRealH').value.trim(),
            colShape: $('#diMColShape').value.trim(),
            colThreadDir: $('#diMColThreadDir').value.trim(),
            colThickness: $('#diMColThickness').value.trim(),
            colThreadWidth: $('#diMColThreadWidth').value.trim(),
            colElements: $('#diMColElements').value.trim(),
          });
          // 统一像素精度：留空则后端按 safe_k（不放大）；填数字则全局统一比例
          const kVal = parseFloat($('#diMKpxPerMm').value);
          if (!isNaN(kVal) && kVal > 0) payload.kPxPerMm = kVal;
          Object.assign(colParams, {
            colName: payload.colName, colPrice: payload.colPrice, colCost: payload.colCost,
            colCategory: payload.colCategory, colTransparent: payload.colTransparent,
            colRealW: payload.colRealW, colRealH: payload.colRealH, colShape: payload.colShape,
            colThreadDir: payload.colThreadDir, colThickness: payload.colThickness,
            colThreadWidth: payload.colThreadWidth, colElements: payload.colElements,
            kPxPerMm: payload.kPxPerMm,
          });
        }

        // 1) 先建上传任务记录
        let taskId = '';
        try {
          const tRes = await apiCall('importTaskManager', {
            action: 'create',
            account: (AUTH_TOKEN ? 'admin' : ''),
            fileName: file.name,
            fileSize: file.size,
            type,
            sheetName,
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

        // 2) 立即关闭弹窗，给用户即时反馈；后续上传在后台执行
        closeModal();
        showToast('上传任务已提交，处理中', 'success');

        // 3) 后台执行：分片上传 → 调用导入（通过 upload_tasks 回写进度/结果）
        (async () => {
          try {
            // 上传前先把任务状态标记为"上传中"
            apiCall('importTaskManager', { action: 'update', taskId, status: 'uploading', log: '文件分片上传中' }).catch(() => {});
            payload.xlsxFileIDList = await uploadFileToCloud(file, (done, total) => {
              // 可选：把上传进度写回任务日志，方便「上传历史」刷新查看
              console.log(`[上传任务 ${taskId}] 上传中 ${done}/${total}`);
            });
          } catch (e) {
            showToast('上传文件失败: ' + e.message, 'error');
            console.error('[上传任务] 上传失败', taskId, e);
            return;
          }

          try {
            // 不 await 最终结果：后端会通过 upload_tasks 回写状态
            apiCall('importFromTencentDoc', payload).catch((e) => {
              console.error('[上传任务] 后端执行异常', taskId, e);
            });
          } catch (e) {
            console.error('[上传任务] 提交失败', taskId, e);
          }
        })();
      } catch (e) {
        // 顶层兜底：任何未预期异常都给出反馈，避免"点击无反应"
        console.error('[上传] 未预期异常:', e);
        showToast('上传异常: ' + (e && e.message ? e.message : e), 'error');
        btn.disabled = false; btn.textContent = '开始上传';
      }
    };
  }
}
