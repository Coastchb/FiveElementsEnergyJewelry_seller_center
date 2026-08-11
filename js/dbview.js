/* ========== 数据库查看 Database Viewer ========== */

const DBVIEW_COLLECTIONS = [
  { id: 'users', name: '用户 users' },
  { id: 'addresses', name: '收货地址 addresses' },
  { id: 'products', name: '成品商品 products' },
  { id: 'materials', name: '材料 materials' },
  { id: 'categories', name: '分类 categories' },
  { id: 'diy_items', name: 'DIY作品 diy_items' },
  { id: 'favorites', name: '收藏 favorites' },
  { id: 'orders', name: '订单 orders' },
  { id: 'reviews', name: '评价 reviews' },
  { id: 'fortune_info', name: '五行分析 fortune_info' },
  { id: 'chat_messages', name: '客服消息 chat_messages' },
  { id: 'suppliers', name: '供应商 suppliers' },
  { id: 'admins', name: '管理员 admins' },
];

let _dbviewInited = false;

function initDbview() {
  if (_dbviewInited) { loadDbview(); return; }
  _dbviewInited = true;

  // 填充集合下拉
  const sel = $('#dbviewCollection');
  sel.innerHTML = DBVIEW_COLLECTIONS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  sel.addEventListener('change', async (e) => {
    await loadDbview(e.target.value);
  });

  loadDbview(sel.value);
}

async function loadDbview(collection) {
  if (!collection) return;
  try {
    const data = await apiCall('getCollectionData', { collection });
    const list = data.list || [];
    $('#dbviewCount').textContent = `共 ${list.length} 条`;
    await renderDbviewTable(list);
  } catch (e) {
    showToast('加载失败: ' + e.message, 'error');
  }
}

async function renderDbviewTable(list) {
  const head = $('#dbviewHead');
  const body = $('#dbviewBody');

  if (!list.length) {
    head.innerHTML = '<th>字段</th>';
    body.innerHTML = '<tr><td class="empty-state">该集合暂无数据</td></tr>';
    return;
  }

  // 收集所有字段（取前 50 条的字段并集，避免表头过宽）
  const fieldSet = new Set();
  list.slice(0, 50).forEach(row => {
    Object.keys(row).forEach(k => fieldSet.add(k));
  });
  const fields = Array.from(fieldSet);

  head.innerHTML = fields.map(f => `<th class="${f === '_id' ? 'col-id' : ''}">${f}</th>`).join('');

  // 收集所有图片值（http / cloud://）批量解析成可渲染链接
  // 兼容 firstImage 等字段里混有标语+URL 的情况：从字符串中提取所有图片 URL
  const allImgVals = [];
  list.slice(0, 50).forEach(row => {
    fields.forEach(f => {
      const v = row[f];
      if (typeof v === 'string') {
        extractImageUrls(v).forEach(u => allImgVals.push(u));
      } else if (Array.isArray(v) && v.length && v.every(isImageUrl)) {
        v.forEach(x => allImgVals.push(x));
      }
    });
  });
  const urlMap = await resolveImageUrls(allImgVals);

  body.innerHTML = list.map(row => {
    return `<tr>${fields.map(f => {
      const v = row[f];
      const cls = f === '_id' ? 'col-id' : '';
      return `<td class="${cls}">${formatCell(v, urlMap, f)}</td>`;
    }).join('')}</tr>`;
  }).join('');

  // 绑定图片缩略图点击 → 灯箱预览
  body.querySelectorAll('.cell-img-wrap').forEach((wrap) => {
    wrap.addEventListener('click', () => {
      try {
        const urls = JSON.parse(wrap.dataset.imgurls || '[]');
        const idx = Math.max(0, Math.min(Number(wrap.dataset.imgidx) || 0, urls.length - 1));
        openImageLightbox(urls, idx);
      } catch (e) { /* ignore */ }
    });
  });
}

function formatCell(v, urlMap, field) {
  urlMap = urlMap || new Map();
  if (v === null || v === undefined) return '<span class="cell-null">—</span>';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    // 时间戳（毫秒/秒级）转为「年月日 时分秒」，原始值保留在 title 中便于核对
    if (looksLikeTimestamp(v)) {
      const fmt = fmtDateTime(v);
      return `<span class="cell-time" title="${escapeHtml(String(v))}">${escapeHtml(fmt)}</span>`;
    }
    return String(v);
  }
  if (typeof v === 'string') {
    // _id 字段截断显示，hover 可看完整值
    if (field === '_id') {
      return `<span class="cell-id" title="${escapeHtml(v)}">${escapeHtml(v)}</span>`;
    }
    // 从字符串中提取所有图片 URL（兼容 firstImage 等字段混有标语+URL 的情况）
    const imgUrls = extractImageUrls(v);
    if (imgUrls.length) {
      const urls = imgUrls.map(u => urlMap.get(u) || u);
      return renderImgThumb(urls[0], urls, 0);
    }
    return escapeHtml(v);
  }
  if (Array.isArray(v)) {
    // 如果是图片 URL 数组，仅展示主图，浮层显示剩余数量，点击可灯箱查看全部
    if (v.length && v.every(isImageUrl)) {
      const urls = v.map(url => urlMap.get(url) || url);
      return renderImgThumb(urls[0], urls, 0);
    }
    const json = JSON.stringify(v);
    return `<span class="cell-json">${escapeHtml(json)}</span>`;
  }
  // 对象
  const json = JSON.stringify(v);
  return `<span class="cell-json">${escapeHtml(json)}</span>`;
}

function renderImgThumb(src, allUrls, startIdx) {
  const extra = allUrls.length > 1 ? `<span class="cell-img-more">+${allUrls.length - 1}</span>` : '';
  const urlsJson = escapeHtml(JSON.stringify(allUrls));
  return `<div class="cell-img-wrap" data-imgurls="${urlsJson}" data-imgidx="${startIdx}">
    <img src="${escapeHtml(src)}" class="cell-img" onerror="this.style.display='none'">${extra}
  </div>`;
}

function isImageUrl(s) {
  return typeof s === 'string' && (/^https?:\/\//.test(s) || s.startsWith('/') || s.startsWith('cloud://'));
}

// 从一段文本中提取所有图片 URL（支持 http(s) / cloud:// / 相对路径，按空白/换行/逗号/引号分隔）
function extractImageUrls(s) {
  if (typeof s !== 'string' || !s.trim()) return [];
  const parts = s.split(/[\s\n\r,;"'<>()[\]{}]+/);
  return parts.filter(isImageUrl);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ========== 图片灯箱 ========== */
let _lightboxUrls = [];
let _lightboxIdx = 0;

function openImageLightbox(urls, startIdx) {
  if (!urls || !urls.length) return;
  _lightboxUrls = urls;
  _lightboxIdx = Math.max(0, Math.min(startIdx || 0, urls.length - 1));
  const box = $('#imgLightbox');
  if (!box) return;
  box.style.display = 'flex';
  showLightboxImage(_lightboxIdx);
  bindLightboxEvents();
}

function closeImageLightbox() {
  const box = $('#imgLightbox');
  if (box) box.style.display = 'none';
  unbindLightboxEvents();
}

function showLightboxImage(idx) {
  _lightboxIdx = idx;
  const img = $('#imgLightboxImg');
  const curr = $('#imgLightboxCurr');
  const total = $('#imgLightboxTotal');
  if (img) { img.src = ''; img.src = _lightboxUrls[idx]; }
  if (curr) curr.textContent = String(idx + 1);
  if (total) total.textContent = String(_lightboxUrls.length);
}

function lightboxPrev() {
  if (_lightboxUrls.length <= 1) return;
  showLightboxImage((_lightboxIdx - 1 + _lightboxUrls.length) % _lightboxUrls.length);
}

function lightboxNext() {
  if (_lightboxUrls.length <= 1) return;
  showLightboxImage((_lightboxIdx + 1) % _lightboxUrls.length);
}

let _lbKeyHandler = null;
let _lbClickBound = false;

function bindLightboxEvents() {
  if (_lbClickBound) return;
  const box = $('#imgLightbox');
  if (!box) return;

  const closeBtn = box.querySelector('.img-lightbox-close');
  const prevBtn = box.querySelector('.img-lightbox-prev');
  const nextBtn = box.querySelector('.img-lightbox-next');
  const backdrop = box.querySelector('.img-lightbox-backdrop');

  if (closeBtn) closeBtn.addEventListener('click', closeImageLightbox);
  if (prevBtn) prevBtn.addEventListener('click', lightboxPrev);
  if (nextBtn) nextBtn.addEventListener('click', lightboxNext);
  if (backdrop) backdrop.addEventListener('click', closeImageLightbox);

  _lbKeyHandler = (e) => {
    if (e.key === 'Escape') closeImageLightbox();
    else if (e.key === 'ArrowLeft') lightboxPrev();
    else if (e.key === 'ArrowRight') lightboxNext();
  };
  document.addEventListener('keydown', _lbKeyHandler);
  _lbClickBound = true;
}

function unbindLightboxEvents() {
  if (!_lbClickBound) return;
  const box = $('#imgLightbox');
  if (box) {
    const closeBtn = box.querySelector('.img-lightbox-close');
    const prevBtn = box.querySelector('.img-lightbox-prev');
    const nextBtn = box.querySelector('.img-lightbox-next');
    const backdrop = box.querySelector('.img-lightbox-backdrop');
    if (closeBtn) closeBtn.removeEventListener('click', closeImageLightbox);
    if (prevBtn) prevBtn.removeEventListener('click', lightboxPrev);
    if (nextBtn) nextBtn.removeEventListener('click', lightboxNext);
    if (backdrop) backdrop.removeEventListener('click', closeImageLightbox);
  }
  if (_lbKeyHandler) document.removeEventListener('keydown', _lbKeyHandler);
  _lbKeyHandler = null;
  _lbClickBound = false;
}
