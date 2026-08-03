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

  head.innerHTML = fields.map(f => `<th>${f}</th>`).join('');

  // 收集所有图片值（http / cloud://）批量解析成可渲染链接
  const allImgVals = [];
  list.slice(0, 50).forEach(row => {
    fields.forEach(f => {
      const v = row[f];
      if (typeof v === 'string' && isImageUrl(v)) allImgVals.push(v);
      else if (Array.isArray(v) && v.length && v.every(isImageUrl)) v.forEach(x => allImgVals.push(x));
    });
  });
  const urlMap = await resolveImageUrls(allImgVals);

  body.innerHTML = list.map(row => {
    return `<tr>${fields.map(f => {
      const v = row[f];
      return `<td>${formatCell(v, urlMap)}</td>`;
    }).join('')}</tr>`;
  }).join('');
}

function formatCell(v, urlMap) {
  urlMap = urlMap || new Map();
  if (v === null || v === undefined) return '<span class="cell-null">—</span>';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // 图片 URL 显示缩略图（cloud:// 已解析为临时 http 链接）
    if (isImageUrl(v)) {
      const src = urlMap.get(v) || v;
      return `<img src="${escapeHtml(src)}" class="cell-img" onerror="this.style.display='none'"><div class="cell-img-url">${escapeHtml(v)}</div>`;
    }
    return escapeHtml(v);
  }
  if (Array.isArray(v)) {
    // 如果是图片 URL 数组，展示缩略图
    if (v.length && v.every(isImageUrl)) {
      return v.map(url => {
        const src = urlMap.get(url) || url;
        return `<img src="${escapeHtml(src)}" class="cell-img" onerror="this.style.display='none'">`;
      }).join('');
    }
    const json = JSON.stringify(v);
    return `<span class="cell-json">${escapeHtml(json)}</span>`;
  }
  // 对象
  const json = JSON.stringify(v);
  return `<span class="cell-json">${escapeHtml(json)}</span>`;
}

function isImageUrl(s) {
  return typeof s === 'string' && (/^https?:\/\//.test(s) || s.startsWith('/') || s.startsWith('cloud://'));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
