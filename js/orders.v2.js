/* ========== 订单管理 Orders ========== */

let orderState = {
  tab: 'pending',
  subType: 'product',
  supplierId: '',           // ''=全部供应商
  supplierMap: {},          // supplierId -> supplierName
  // 历史订单过滤
  historyRange: 'all',
  historyStatus: '',
  historyKeyword: '',
  historyStart: '',
  historyEnd: '',
  historyPage: 1,
  historyHasMore: false
};

let _ordersInited = false;
let _orderCache = [];

const NORMAL_EXPRESS_FEE = 6;
const SF_EXPRESS_FEE = 18;

// 防止 waybillError 等后端文本破坏 HTML 结构
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getDisplayExpressFee(o) {
  const isSF = o.logisticsType === 'SF' || o.expressShipping === true ||
               (o.expressCompany && /顺丰/.test(o.expressCompany)) ||
               (o.courier && /顺丰/.test(o.courier));
  return isSF ? SF_EXPRESS_FEE : (Number(o.fee) || Number(o.物流费) || Number(o.expressFee) || NORMAL_EXPRESS_FEE);
}

function initOrders() {
  if (_ordersInited) {
    // 已初始化过：只重拉供应商下拉框（低成本），不重复绑定事件
    loadSuppliers();
    return;
  }
  _ordersInited = true;

  // 加载供应商列表并渲染下拉框
  loadSuppliers().then(() => reloadOrders());

  // Tab 切换
  $$('#orderTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      orderState.tab = btn.dataset.tab;
      $$('#orderTabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('#orderPending').style.display = orderState.tab === 'pending' ? 'block' : 'none';
      $('#orderHistory').style.display = orderState.tab === 'history' ? 'block' : 'none';
      await reloadOrders();
    });
  });

  // 子 Tab 切换
  $$('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      orderState.subType = btn.dataset.sub;
      $$('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await reloadOrders();
    });
  });

  // 打印全部按钮
  $('#printAllBtn').addEventListener('click', onPrintAll);

  // （已移除批量取消按钮，按订单卡片上的「拦截快递」单独处理）

  // 历史订单快捷按钮
  $$('#orderHistory [data-range]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const range = btn.dataset.range;
      orderState.historyRange = range;
      orderState.historyStart = '';
      orderState.historyEnd = '';
      $('#historyStart').value = '';
      $('#historyEnd').value = '';
      $$('#orderHistory [data-range]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await reloadOrders();
    });
  });

  // 日期选择
  $('#historyStart').addEventListener('change', async (e) => {
    orderState.historyStart = e.target.value;
    orderState.historyRange = '';
    $$('#orderHistory [data-range]').forEach(b => b.classList.remove('active'));
    await reloadOrders();
  });
  $('#historyEnd').addEventListener('change', async (e) => {
    orderState.historyEnd = e.target.value;
    orderState.historyRange = '';
    $$('#orderHistory [data-range]').forEach(b => b.classList.remove('active'));
    await reloadOrders();
  });

  // 状态筛选
  $('#historyStatus').addEventListener('change', async (e) => {
    orderState.historyStatus = e.target.value;
    orderState.historyPage = 1;
    await reloadOrders();
  });

  // 关键词搜索（防抖）
  $('#historyKeyword').addEventListener('input', debounce(async (e) => {
    orderState.historyKeyword = e.target.value;
    orderState.historyPage = 1;
    await reloadOrders();
  }, 400));

  // 供应商筛选（待发货 + 历史共用）
  $$('#orderSupplier, #historySupplier').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      orderState.supplierId = e.target.value;
      // 同步另一个下拉框的选中态
      $$('#orderSupplier, #historySupplier').forEach(other => {
        if (other && other !== e.target) other.value = e.target.value;
      });
      orderState.historyPage = 1;
      await reloadOrders();
    });
  });
}

/** 加载供应商列表到下拉框（复用 getAdminUsers(role=supplier)，与 users/products 页一致） */
async function loadSuppliers() {
  console.log('[loadSuppliers] 函数已执行，MOCK=', window.__MOCK__);
  try {
    const res = await apiCall('getAdminUsers', { role: 'supplier', pageNum: 1, pageSize: 1000 });
    console.log('[loadSuppliers] 返回原始数据:', JSON.stringify(res));
    if (res && typeof res.code === 'number' && res.code !== 0) throw new Error(res.message || res.error || '网关返回失败');
    const list = (res && res.list) || (res && res.data && res.data.list) || [];
    console.log('[loadSuppliers] 解析到 list 长度=', list.length, ' 样例=', JSON.stringify(list[0] || null));
    orderState.supplierMap = {};
    const options = ['<option value="">全部供应商</option>'];
    list.forEach(s => {
      const id = s.supplierId || s.id || '';
      const name = s.name || s.supplierName || '未命名';
      orderState.supplierMap[id] = name;
      options.push(`<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`);
    });
    const osList = $$('#orderSupplier');
    const hsList = $$('#historySupplier');
    console.log('[loadSuppliers] 匹配到 orderSupplier 数量=', osList.length, ' historySupplier 数量=', hsList.length);
    const html = options.length > 1 ? options.join('') : '<option value="">暂无供应商</option>';
    osList.forEach((el, i) => {
      console.log('[loadSuppliers] 写入 orderSupplier[' + i + '] 父节点id=', (el.parentElement || {}).id || '?', ' 写入前innerHTML=', JSON.stringify(el.innerHTML));
      el.innerHTML = html;
      console.log('[loadSuppliers] orderSupplier[' + i + '] 写入后option数=', el.options.length);
    });
    hsList.forEach((el, i) => {
      console.log('[loadSuppliers] 写入 historySupplier[' + i + '] 父节点id=', (el.parentElement || {}).id || '?');
      el.innerHTML = html;
    });
  } catch (e) {
    const msg = '加载供应商失败: ' + (e.message || e);
    console.warn(msg);
    showToast(msg, 'error');
    $$('#orderSupplier, #historySupplier').forEach(sel => {
      if (sel) sel.innerHTML = '<option value="">加载失败</option>';
    });
  }
}

async function reloadOrders() {
  if (orderState.tab === 'pending') {
    await loadPendingOrders();
  } else {
    await loadHistoryOrders();
  }
}

async function loadPendingOrders() {
  try {
    const params = {
      scope: 'pending',
      subType: orderState.subType,
      pageNum: 1,
      pageSize: 200
    };
    if (orderState.supplierId) params.supplierId = orderState.supplierId;
    const data = await apiCall('getAdminOrders', params);
    $('#pendingCount').textContent = `共 ${data.total || 0} 笔待发货`;
    renderOrderList($('#pendingList'), data.list || [], 'pending');
    // 同步更新成品/DIY 子 tab 上的待发货数量
    loadPendingTabCounts();
  } catch(e) {
    showToast('加载失败: ' + e.message, 'error');
  }
}

// 分别统计成品 / DIY 的待发货数量，显示在对应子 tab 上（括号括起）
async function loadPendingTabCounts() {
  try {
    const base = { scope: 'pending', pageNum: 1, pageSize: 1 };
    if (orderState.supplierId) base.supplierId = orderState.supplierId;
    const [rp, rd] = await Promise.all([
      apiCall('getAdminOrders', Object.assign({}, base, { subType: 'product' })),
      apiCall('getAdminOrders', Object.assign({}, base, { subType: 'diy' }))
    ]);
    const cp = $('#subCntProduct'), cd = $('#subCntDiy');
    if (cp) cp.textContent = '(' + (rp.total || 0) + ')';
    if (cd) cd.textContent = '(' + (rd.total || 0) + ')';
  } catch (e) { /* 数量展示失败不阻塞主列表 */ }
}

async function loadHistoryOrders() {
  try {
    const params = {
      scope: 'history',
      pageNum: orderState.historyPage,
      pageSize: 20,
      status: orderState.historyStatus || undefined,
      keyword: orderState.historyKeyword || undefined,
      supplierId: orderState.supplierId || undefined
    };
    if (orderState.historyStart) params.startTime = orderState.historyStart;
    if (orderState.historyEnd) params.endTime = orderState.historyEnd;
    if (orderState.historyRange && orderState.historyRange !== 'all') {
      params.range = orderState.historyRange;
    }
    const data = await apiCall('getAdminOrders', params);
    orderState.historyHasMore = data.hasMore;
    $('#historyTotal').textContent = `共 ${data.total || 0} 笔订单 · 总货款 ${fmtMoney(data.totalGoods || 0)}`;
    renderOrderList($('#historyList'), data.list || [], 'history');
    renderPagination($('#historyPager'), orderState.historyPage, data.pageSize, data.total, data.hasMore, async (page) => {
      orderState.historyPage = page;
      await loadHistoryOrders();
    });
  } catch(e) {
    showToast('加载失败: ' + e.message, 'error');
  }
}

function renderOrderList(container, list, type) {
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无订单</div>';
    return;
  }
  _orderCache = list;
  container.innerHTML = list.map(o => {
    const statusClass = { '待发货': 'st-paid', '运输中': 'st-ship', '已完成': 'st-done', '已取消': 'st-cancel', '待退款': 'st-refund-pending', '已退款': 'st-refunded', '已支付': 'st-paid' }[o.status] || '';
    // 面单生成失败标记（后端 createWaybill 真实调用失败时写入）
    const hasWaybillError = !!(o.waybillError && String(o.waybillError).trim());
    const waybillErrClass = hasWaybillError ? ' has-waybill-error' : '';
    const hasPayError = !!(o.payError && String(o.payError).trim());
    const isDiy = o.orderType === 'diy' || o.type === 'diy';
    const tagHtml = isDiy
      ? '<span class="order-tag tag-diy">DIY</span>'
      : '<span class="order-tag tag-product">成品</span>';

    const diyHtml = isDiy && o.diyMaterials
      ? `<div class="diy-detail-box"><strong>配饰：</strong>${o.diyMaterials}</div>` : '';

    // 面单 / 发货操作（仅待发货订单）
    let waybillHtml = '';
    if (o.status === '待发货') {
      const printedClass = o.waybillPrinted ? ' btn-printed' : '';
      const printedText = o.waybillPrinted ? '打印面单（已打印）' : '打印面单';
      waybillHtml = `
        <button class="btn btn-gray" onclick="onViewWaybill('${o.orderId}')">查看面单</button>
        <button class="btn btn-outline${printedClass}" onclick="onPrintWaybill('${o.orderId}')">${printedText}</button>
        <button class="btn btn-ship" onclick="onShipOrder('${o.orderId}', ${o.waybillPrinted})">已备好货并贴好快递面单</button>
      `;
    }

    // 物流详情（真实轨迹，默认折叠）
    const hasExpress = !!(o.expressCompany || o.waybillNo || (o.waybill && o.waybill.trackingNo));
    let logisticsHtml = '';
    if (hasExpress) {
      // 优先使用后端同步的真实物流状态（logisticsStatus），不要用订单状态推断快递状态。
      // 当尚未同步到真实物流状态时，按订单状态给出中性兜底：待发货 → 待揽件，其它 → 运输中
      let ls = o.logisticsStatus;
      if (!ls) ls = o.status === '待发货' ? '待揽件' : '运输中';
      let statusClass = 'shipping';
      if (o.signed || ls === '已签收') {
        ls = '已签收';
        statusClass = 'signed';
      } else if (ls === '待揽件') {
        statusClass = 'pending-pickup';
      }
      const traceList = (o.logistics && o.logistics.list) || [];
      const traceHtml = traceList.length
        ? traceList.slice().reverse().map((t, idx) => `
            <div class="trace-item ${idx === 0 ? 'active' : ''}">
              <div class="trace-dot"></div>
              <div class="trace-info">
                <div class="trace-desc">${t.actionName || t.actionMsg || t.desc || ''}</div>
                <div class="trace-time">${fmtDateTime(t.time) || ''}</div>
              </div>
            </div>`).join('')
        : `<div class="trace-item active"><div class="trace-dot"></div><div class="trace-info"><div class="trace-desc">暂无详细物流轨迹，点击下方「更新物流信息」更新</div></div></div>`;
      logisticsHtml = `
      <div class="order-logistics">
        <div class="logi-head" onclick="toggleLogi(this)">
          <span class="logi-title">物流追踪</span>
          <span class="logi-company">${o.expressCompany || '顺丰速运'} · ${o.waybillNo || (o.waybill && o.waybill.trackingNo) || '-'}</span>
          <span class="logi-status ${statusClass}">${ls}</span>
          <span class="logi-caret">▾</span>
        </div>
        <div class="logi-trace" style="display:none;">
          ${traceHtml}
        </div>
      </div>`;
    }

    // 管理操作
    let adminHtml = '';

    if (o.status === '待支付') {
      adminHtml += `<button class="btn btn-outline" onclick="onCancelOrder('${o.orderId}', 'cancel')">取消订单</button>`;
    } else if (['待发货', '运输中', '已完成'].includes(o.status)) {
      adminHtml += `<button class="btn btn-danger" onclick="onApplyRefund('${o.orderId}')">退换货</button>`;
      adminHtml += `<button class="btn btn-danger" onclick="onConfirmRefund('${o.orderId}')">立即退款</button>`;
      adminHtml += `<button class="btn btn-outline" onclick="onCompensate('${o.orderId}')">补差价</button>`;
    } else if (o.status === '待退款') {
      adminHtml = `<button class="btn btn-danger" disabled>退换货</button>`;
      adminHtml += `<button class="btn btn-danger" onclick="onConfirmRefund('${o.orderId}')">立即退款</button>`;
      adminHtml += `<button class="btn btn-outline" onclick="onCompensate('${o.orderId}')">补差价</button>`;
    } else if (o.status === '已退款') {
      adminHtml = `<button class="btn btn-danger" disabled>退换货</button><button class="btn btn-danger" disabled>退款</button>`;
    } else if (o.status === '已支付') {
      // 虚假超时订单：实际已支付，但状态机未转正
      const hasWaybill = !!(o.waybillNo || o.waybillId || (o.waybill && (o.waybill.waybillId || o.waybill.trackingNo)));
      if (hasWaybill) {
        adminHtml += `<button class="btn btn-ship" onclick="onSetToShip('${o.orderId}')">转为待发货</button>`;
      } else {
        adminHtml += `<button class="btn btn-ship" onclick="onCreateWaybillForOrder('${o.orderId}')">创建快递订单${hasWaybillError ? '<span class="btn-note">（面单生成失败，请补单）</span>' : ''}</button>`;
      }
    }

    const syncBtn = hasExpress
      ? `<button class="btn btn-outline" onclick="onSyncLogistics('${o.orderId}', '${o.orderId.slice(-4)}')">更新物流信息</button>`
      : '';
    // 其余操作按钮折叠进「更多操作」下拉菜单，卡片只保留「更新物流信息」
    const moreButtons = waybillHtml + adminHtml + `<button class="btn btn-outline" onclick="onEditSellerRemark('${o.orderId}')">卖家备注</button>`;
    const actionsHtml = syncBtn + (moreButtons.trim()
      ? `<div class="more-actions"><button class="btn btn-outline" onclick="toggleMoreActions(this)">更多操作 ▾</button><div class="more-menu" style="display:none;">${moreButtons}</div></div>`
      : '');

    const fee = getDisplayExpressFee(o);
    const saleAmount = Number(o.totalPrice) || (Number(o.price || 0) * Number(o.qty || 1));
    const gross = Math.round((saleAmount - (Number(o.costPrice) || 0) - fee) * 100) / 100;
    const createdAtText = o.createdAt ? fmtDateTime(o.createdAt) : (o.createdAtText || '');
    const shippedAtText = o.shippedAt ? fmtDateTime(o.shippedAt) : (o.shippedAtText || '');
    const remarkHtml = `
      ${o.buyerRemark ? `<div class="order-remark"><span class="remark-label buyer">买家备注</span><span class="remark-text">${o.buyerRemark}</span></div>` : ''}
      ${o.sellerRemark ? `<div class="order-remark"><span class="remark-label seller">卖家备注</span><span class="remark-text">${o.sellerRemark}</span></div>` : ''}
    `;

    return `
    <div class="order-card${waybillErrClass}">
      <div class="order-card-head">
        <span class="order-seq">编号：${o.orderId.slice(-4)}</span>
        <span class="order-status ${statusClass}">${o.status}</span>
        ${o.status === '已退款' ? '<span class="refund-tag">已退款</span>' : ''}
        ${hasPayError ? '<span class="refund-tag pay-err-tag">支付异常</span>' : ''}
      </div>
      ${hasWaybillError ? `
      <div class="waybill-error">
        <span class="waybill-error-badge">面单异常</span>
        <span class="waybill-error-msg">${escapeHtml(o.waybillError)}</span>
      </div>` : ''}
      ${hasPayError ? `
      <div class="pay-error">
        <span class="pay-error-badge">支付异常</span>
        <span class="pay-error-msg">${escapeHtml(o.payError)}</span>
      </div>` : ''}
      <div class="order-goods">
        <span class="order-goods-name">${o.goodsName || o.productName || ''}</span>
        ${tagHtml}
      </div>
      ${diyHtml}
      <div class="order-cost-line">
        <span>数量：<b>${o.qty || o.quantity || 1}</b></span>
        <span>售价：<b class="money">${fmtMoney(saleAmount || 0)}</b></span>
        <span>成本价：<b>${fmtMoney(Number(o.costPrice) || 0)}</b></span>
        <span>物流费：<b>${fee ? fmtMoney(fee) : '-'}</b></span>
        <span>毛利：<b class="${gross >= 0 ? 'profit' : 'loss'}">${fmtMoney(gross)}</b></span>
      </div>
      <div class="order-info">
        <div class="order-info-no">订单号：${o.orderId}<button type="button" class="copy-no-btn" onclick="onCopyOrderId('${o.orderId}', this)">复制</button></div>
        <div>下单：${createdAtText}</div>
        <div>用户：${o.nickname || ''}</div>
        <div>收货：${(o.address && o.address.name) || ''} ${(o.address && o.address.phone) || ''}</div>
        <div>地址：${(o.address && o.address.address) || ''}</div>
        ${o.supplierName ? `<div class="order-supplier"><span class="supplier-label">供应商</span>${escapeHtml(o.supplierName)}</div>` : ''}
        ${o.senderAddress ? `<div class="order-supplier"><span class="supplier-label">发货地址</span>${escapeHtml(o.senderAddress)}</div>` : ''}
        ${shippedAtText ? `<div>发货：${shippedAtText}</div>` : ''}
      </div>
      ${logisticsHtml}
      ${remarkHtml}
      ${actionsHtml ? '<div class="order-actions">' + actionsHtml + '</div>' : ''}
    </div>`;
  }).join('');
}

// 渲染真实物流轨迹（从 order.logistics.list 倒序展示）
function renderTrace(list) {
  if (!list || !list.length) {
    return `<div class="trace-item active"><div class="trace-dot"></div><div class="trace-info"><div class="trace-desc">暂无详细物流轨迹，点击下方「更新物流信息」更新</div></div></div>`;
  }
  return list.slice().reverse().map((t, idx) => `
    <div class="trace-item ${idx === 0 ? 'active' : ''}">
      <div class="trace-dot"></div>
      <div class="trace-info">
        <div class="trace-desc">${t.actionName || t.actionMsg || t.desc || ''}</div>
        <div class="trace-time">${fmtDateTime(t.time) || ''}</div>
      </div>
    </div>`).join('');
}

// 展开/收起物流轨迹
function toggleLogi(headEl) {
  const box = headEl.parentElement;
  const trace = box.querySelector('.logi-trace');
  const caret = headEl.querySelector('.logi-caret');
  if (!trace) return;
  const hidden = trace.style.display === 'none';
  trace.style.display = hidden ? 'block' : 'none';
  if (caret) caret.textContent = hidden ? '▴' : '▾';
}

// 展开/收起「更多操作」下拉菜单
function toggleMoreActions(btn) {
  const menu = btn.parentElement.querySelector('.more-menu');
  if (!menu) return;
  const show = menu.style.display === 'none';
  // 先关闭其他已打开的菜单
  document.querySelectorAll('.more-menu').forEach(m => { m.style.display = 'none'; });
  menu.style.display = show ? 'block' : 'none';
}

// 点击空白处关闭所有「更多操作」菜单
document.addEventListener('click', (e) => {
  if (!e.target.closest('.more-actions')) {
    document.querySelectorAll('.more-menu').forEach(m => { m.style.display = 'none'; });
  }
});

// ========== 卖家备注编辑 ==========
async function onEditSellerRemark(orderId) {
  const order = _orderCache.find(o => o.orderId === orderId);
  const current = order ? (order.sellerRemark || '') : '';
  showModal('卖家备注', `
    <p style="color:#8A8079;font-size:13px;margin-bottom:10px;">与用户协商后追加的内部备注，不展示给用户。</p>
    <textarea id="sellerRemarkInput" class="form-input" rows="4" style="width:100%;resize:vertical;">${current}</textarea>
  `, `
    <button class="btn btn-primary" id="saveRemarkBtn">保存</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#saveRemarkBtn');
    if (btn) btn.onclick = async () => {
      const text = $('#sellerRemarkInput').value;
      closeModal();
      try {
        await apiCall('adminUpdateOrder', { orderId, action: 'remark', sellerRemark: text });
        showToast('备注已保存', 'success');
        await reloadOrders();
      } catch(e) { showToast('保存失败: ' + e.message, 'error'); }
    };
  }, 50);
}

// ========== 打印面单 ==========
async function onPrintWaybill(orderId) {
  showToast('已发送至打印机', 'success');
  // 模拟打印后标记为已打印
  const db = getDB();
  const idx = db.orders.findIndex(o => o.orderId === orderId);
  if (idx >= 0) db.orders[idx].waybillPrinted = true;
  saveDB(db);
  await reloadOrders();
}

function onCopyOrderId(orderId, btn) {
  const text = String(orderId || '');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showCopyTip(btn, '订单号已复制'),
      () => fallbackCopy(text, btn)
    );
  } else {
    fallbackCopy(text, btn);
  }
}

function fallbackCopy(text, btn) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showCopyTip(btn, '订单号已复制');
  } catch (e) {
    showCopyTip(btn, '复制失败，请手动复制', true);
  }
  document.body.removeChild(ta);
}

// 在“复制”按钮旁显示提示气泡，1.5s 后自动消失
function showCopyTip(btn, msg, isError) {
  if (!btn) { showToast(msg, isError ? 'error' : 'success'); return; }
  const tip = document.createElement('div');
  tip.className = 'copy-tip' + (isError ? ' copy-tip-err' : '');
  tip.textContent = msg;
  document.body.appendChild(tip);
  const rect = btn.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = rect.right + 8;
  if (left + tw > window.innerWidth - 8) left = rect.left - tw - 8;
  if (left < 8) left = 8;
  tip.style.left = left + 'px';
  tip.style.top = (rect.top + rect.height / 2 - th / 2) + 'px';
  requestAnimationFrame(() => tip.classList.add('show'));
  setTimeout(() => {
    tip.classList.remove('show');
    setTimeout(() => tip.remove(), 220);
  }, 1500);
}

function onViewWaybill(orderId) {
  showModal('查看面单', `
    <div style="padding:20px;border:2px dashed #ddd;border-radius:10px;text-align:center;">
      <p style="font-size:16px;font-weight:600;margin-bottom:8px;">五行能量饰品馆</p>
      <p>订单号：${orderId}</p>
      <p style="color:#999;margin-top:12px;">面单预览区域</p>
      <p style="color:#999;">（对接打印机后可展示具体内容）</p>
    </div>
  `, '<button class="btn btn-outline" onclick="closeModal()">关闭</button>');
}

// ========== 打印全部 ==========
async function onPrintAll() {
  try {
    const data = await apiCall('getAdminOrders', {
      scope: 'pending',
      subType: orderState.subType,
      pageNum: 1,
      pageSize: 200
    });
    const list = data.list || [];
    const printedList = list.filter(o => o.waybillPrinted);

    if (printedList.length > 0) {
      showModal('包含已打印面单', `
        <p style="text-align:center;line-height:2;">检测到 <strong>${printedList.length}</strong> 笔订单已打印过面单。</p>
        <p style="text-align:center;color:#8A8079;">是否重复打印？</p>
      `, `
        <button class="btn btn-green" id="dupPrintAll">依然打印全部</button>
        <button class="btn btn-outline" id="dupPrintNew">只打印未处理的</button>
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
      `);
      // 绑定按钮
      setTimeout(() => {
        const allBtn = $('#dupPrintAll');
        const newBtn = $('#dupPrintNew');
        if (allBtn) allBtn.onclick = () => { closeModal(); doPrintAll(true, list); };
        if (newBtn) newBtn.onclick = () => { closeModal(); doPrintAll(false, list); };
      }, 50);
    } else {
      doPrintAll(false, list);
    }
  } catch(e) {
    showToast('获取订单失败: ' + e.message, 'error');
  }
}

function doPrintAll(includePrinted, list) {
  const toPrint = includePrinted ? list : list.filter(o => !o.waybillPrinted);
  if (toPrint.length === 0) {
    showToast('没有需要打印的订单', 'info');
    return;
  }
  // 标记全部为已打印
  const db = getDB();
  toPrint.forEach(o => {
    const idx = db.orders.findIndex(d => d.orderId === o.orderId);
    if (idx >= 0) db.orders[idx].waybillPrinted = true;
  });
  saveDB(db);
  showToast(`已发送 ${toPrint.length} 笔订单至打印机`, 'success');
  reloadOrders();
}

// ========== 发货 ==========
async function onShipOrder(orderId, waybillPrinted) {
  if (!waybillPrinted) {
    showModal('提示', `
      <p style="text-align:center;line-height:2;">⚠️ 还未打印该快递面单，请不要漏了该订单。</p>
      <p style="text-align:center;color:#8A8079;">是否继续发货？</p>
    `, `
      <button class="btn btn-primary" id="shipConfirm">确认发货</button>
      <button class="btn btn-outline" onclick="closeModal()">取消</button>
    `);
    setTimeout(() => {
      const btn = $('#shipConfirm');
      if (btn) btn.onclick = () => { closeModal(); doShip(orderId); };
    }, 50);
  } else {
    await doShip(orderId);
  }
}

async function doShip(orderId) {
  try {
    await apiCall('adminUpdateOrder', { orderId, action: 'ship' });
    showToast('发货成功', 'success');
    await reloadOrders();
  } catch(e) {
    showToast('发货失败: ' + e.message, 'error');
  }
}

// ========== 取消订单 ==========
async function onCancelOrder(orderId, action) {
  if (action !== 'cancel') { showToast('不支持的操作', 'error'); return; }
  showModal('取消订单', `
    <p style="text-align:center;line-height:2;">确定要取消该订单吗？</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">取消后供应商将无法看到此订单。</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">订单号：${orderId}</p>
  `, `
    <button class="btn btn-danger" id="cancelConfirm">确认取消</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#cancelConfirm');
    if (btn) btn.onclick = async () => {
      closeModal();
      try {
        const res = await apiCall('adminUpdateOrder', { orderId, action: 'cancel' });
        showToast('已取消', 'success');
        await reloadOrders();
      } catch(e) {
        showToast('操作失败: ' + e.message, 'error');
      }
    };
  }, 50);
}

// 同步单个订单物流
async function onSyncLogistics(orderId, orderNo) {
  try {
    showToast('正在更新物流信息...', 'loading');
    const res = await apiCall('syncExpressStatus', { orderIds: [orderId] });
    const item = (res.results || [])[0] || {};
    hideToast();
    if (item.ok) {
      showToast(item.signed ? '已同步，订单已签收' : '物流同步成功', 'success');
    } else {
      showToast('同步失败：' + item.message, 'error');
    }
    await reloadOrders();
  } catch (e) {
    hideToast();
    showToast('同步失败: ' + e.message, 'error');
  }
}

// ========== 退换货（按订单/物流状态三态弹窗 → 待退款）==========
// 判定场景：
//   a. 待发货
//   b. 运输中 且未签收
//   c. 运输中 且已签收 / 已完成
async function onApplyRefund(orderId) {
  const order = _orderCache.find(o => o.orderId === orderId);
  if (!order) { showToast('订单不存在', 'error'); return; }
  let caseType = '';
  if (order.status === '待发货') caseType = 'a';
  else if (order.status === '运输中' && !order.signed) caseType = 'b';
  else if ((order.status === '运输中' && order.signed) || order.status === '已完成') caseType = 'c';
  else { showToast('当前订单状态不可退换货', 'error'); return; }

  const bodies = {
    a: `<p style="margin-bottom:8px;">该商品<strong>暂未发货</strong>，请按以下操作：</p>
        <ol class="guide-list">
          <li>如果是换货，让用户重新下单；</li>
          <li>立即与供应商联系，沟通退换货事情（通知他们该单已取消）；</li>
          <li>去中通快递 app 或顺丰企业服务小程序取消快递订单（如果已经签收，就不需要了）；</li>
          <li>立即退款给用户。</li>
        </ol>`,
    b: `<p style="margin-bottom:8px;">该商品<strong>运输中（未签收）</strong>，请按以下操作：</p>
        <ol class="guide-list">
          <li>如果是换货，让用户重新下单；</li>
          <li>立即与供应商联系，沟通退换货事情（通知他们该单已取消）；</li>
          <li>去中通快递 app 或顺丰企业服务小程序取消或拦截快递订单（如果已经签收，就不需要了）；</li>
          <li>立即退款给用户。</li>
        </ol>`,
    c: (() => {
      // 检查是否超过 7 天退换期
      const DAY_MS = 7 * 24 * 60 * 60 * 1000;
      let overdueHtml = '';
      if (order.完成时间) {
        const elapsed = Date.now() - order.完成时间;
        if (elapsed > DAY_MS) {
          overdueHtml = `<p style="color:#d93025;font-weight:600;margin:8px 0;font-size:14px;">⚠ 距离该商品签收已超过7天，不在退换时间范围内。请谨慎操作！</p>`;
        }
      }
      return `${overdueHtml}
        <p style="margin-bottom:8px;">该商品<strong>已签收 / 已完成</strong>，请按以下操作：</p>
        <ol class="guide-list">
          <li>如果是换货，让用户重新下单；</li>
          <li>让用户寄回商品；</li>
          <li>等收到退回的商品并确认无损后，再退款给用户。</li>
        </ol>`;
    })()
  };

  showModal('退换货', bodies[caseType], `
    <button class="btn btn-outline" id="cancelApplyBtn">取消</button>
    <button class="btn btn-danger" id="confirmApplyBtn">确定操作</button>
  `);
  setTimeout(() => {
    const cbtn = $('#cancelApplyBtn');
    if (cbtn) cbtn.onclick = () => closeModal(); // 取消：状态不变
    const pbtn = $('#confirmApplyBtn');
    if (pbtn) pbtn.onclick = async () => {
      closeModal();
      try {
        await apiCall('adminUpdateOrder', { orderId, action: 'applyRefund' });
        showToast('已转入「待退款」，请按指引去快递 app 处理取消/拦截', 'success');
        await reloadOrders();
      } catch(e) { hideToast(); showToast('操作失败: ' + e.message, 'error'); }
    };
  }, 50);
}

// ========== 立即退款（真实调微信支付退款，金额可含退货运费）==========
async function onConfirmRefund(orderId) {
  const order = _orderCache.find(o => o.orderId === orderId);
  if (!order) { showToast('订单不存在', 'error'); return; }
  // 默认退款金额 = 实付货款（单价×数量）；如需承担退货运费，可在下方输入框一并加上
  const defaultAmount = (Number(order.price) * Number(order.qty || 1) || 0).toFixed(2);
  showModal('立即退款', `
    <p style="text-align:center;line-height:2;">该订单将发起<strong>微信支付退款</strong>，款项原路退回到用户支付账户。</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">订单号：${orderId}</p>
    <div style="margin-top:14px;">
      <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">退款金额（元）</label>
      <input id="refundAmount" type="number" min="0.01" step="0.01" value="${defaultAmount}"
             style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;">
      <p style="font-size:12px;color:#8A8079;margin-top:6px;">默认仅退商品货款；如需承担用户退回的运费，请在此金额基础上<strong>一并加上运费</strong>。</p>
    </div>
  `, `
    <button class="btn btn-danger" id="refundConfirm">确认退款</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#refundConfirm');
    if (btn) btn.onclick = async () => {
      const amount = parseFloat($('#refundAmount').value);
      if (!(amount > 0)) { showToast('请输入大于 0 的退款金额', 'error'); return; }
      closeModal();
      try {
        showToast('退款处理中...', 'loading');
        const res = await apiCall('adminUpdateOrder', { orderId, action: 'refund', refundAmount: amount });
        hideToast();
        showToast('退款已发起，金额 ¥' + amount.toFixed(2), 'success');
        await reloadOrders();
      } catch(e) { hideToast(); showToast('退款失败: ' + e.message, 'error'); }
    };
  }, 50);
}

// ========== 补差价（从商户账户向用户付款，如承担退货运费）==========
async function onCompensate(orderId) {
  const order = _orderCache.find(o => o.orderId === orderId);
  if (!order) { showToast('订单不存在', 'error'); return; }
  showModal('补差价', `
    <p style="text-align:center;line-height:2;">将从<strong>商户账户</strong>向用户付款（如承担退货运费）。</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">订单号：${orderId}</p>
    <div style="margin-top:14px;">
      <label style="display:block;font-size:13px;color:#555;margin-bottom:6px;">补差金额（元）</label>
      <input id="compAmount" type="number" min="0.01" step="0.01" placeholder="请输入金额"
             style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;">
      <label style="display:block;font-size:13px;color:#555;margin:12px 0 6px;">备注（可选）</label>
      <input id="compRemark" type="text" value="退货运费补偿"
             style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;">
    </div>
  `, `
    <button class="btn btn-green" id="compConfirm">确认支付</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#compConfirm');
    if (btn) btn.onclick = async () => {
      const amount = parseFloat($('#compAmount').value);
      const remark = $('#compRemark').value || '退货运费补偿';
      if (!(amount > 0)) { showToast('请输入大于 0 的金额', 'error'); return; }
      closeModal();
      try {
        showToast('付款处理中...', 'loading');
        await apiCall('adminUpdateOrder', { orderId, action: 'compensate', amount, remark });
        hideToast();
        showToast('已补差 ¥' + amount.toFixed(2), 'success');
        await reloadOrders();
      } catch(e) { hideToast(); showToast('操作失败: ' + e.message, 'error'); }
    };
  }, 50);
}

// ========== 已支付订单修复：转为待发货 / 补创建快递订单 ==========
// 针对「虚假超时」订单：实际已支付并生成了快递单，却被误置为「已支付」
async function onSetToShip(orderId) {
  showModal('转为待发货', `
    <p style="text-align:center;line-height:2;">该订单实际已支付并生成了快递单，确认转为「待发货」？</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">订单号：${orderId}</p>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-ship" id="setToShipConfirm">确认转为待发货</button>
  `);
  setTimeout(() => {
    const btn = $('#setToShipConfirm');
    if (btn) btn.onclick = async () => {
      closeModal();
      try {
        showToast('处理中...', 'loading');
        await apiCall('adminUpdateOrder', { orderId, action: 'setToShip' });
        hideToast();
        showToast('已转为「待发货」', 'success');
        await reloadOrders();
      } catch(e) { hideToast(); showToast('操作失败: ' + e.message, 'error'); }
    };
  }, 50);
}

async function onCreateWaybillForOrder(orderId) {
  showModal('创建快递订单', `
    <p style="text-align:center;line-height:2;">该订单已支付但缺少快递单，确认手动创建一个快递订单吗？</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">订单号：${orderId}</p>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-ship" id="createWaybillConfirm">确认创建</button>
  `);
  setTimeout(() => {
    const btn = $('#createWaybillConfirm');
    if (btn) btn.onclick = async () => {
      closeModal();
      try {
        showToast('正在生成快递单...', 'loading');
        await apiCall('adminUpdateOrder', { orderId, action: 'createWaybill' });
        hideToast();
        showToast('快递单已创建并转为「待发货」', 'success');
        await reloadOrders();
      } catch(e) { hideToast(); showToast('操作失败: ' + e.message, 'error'); }
    };
  }, 50);
}

// ========== 确认退款（→ 已退款）==========
async function onConfirmRefund(orderId) {
  showModal('确认退款', `
    <p style="text-align:center;color:#d93025;font-weight:600;font-size:14px;margin-bottom:12px;">退款前，请先确认是否收到买家寄回的商品，并确认无损</p>
    <p style="text-align:center;line-height:2;">确认原路退回货款？</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">订单将转为「已退款」。</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">订单号：${orderId}</p>
  `, `
    <button class="btn btn-primary" id="confirmRefundBtn">确认退款</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#confirmRefundBtn');
    if (btn) btn.onclick = async () => {
      closeModal();
      try {
        const res = await apiCall('adminUpdateOrder', { orderId, action: 'refund' });
        const ns = res && (res.状态 || res.status);
        showToast(ns || '已退款', 'success');
        await reloadOrders();
      } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
    };
  }, 50);
}

// ========== 换货（已并入「退换货」统一流程：用户重新下单，原单走退换货退款）==========

function renderPagination(container, page, pageSize, total, hasMore, onPage) {
  const totalPages = Math.ceil(total / pageSize);
  if (total <= pageSize) { container.innerHTML = ''; return; }

  let html = '';
  html += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">上一页</button>`;
  html += `<span class="page-info">${page} / ${totalPages}</span>`;
  html += `<button class="page-btn" ${!hasMore ? 'disabled' : ''} data-page="${page + 1}">下一页</button>`;
  container.innerHTML = html;

  container.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page);
      if (!isNaN(p) && p >= 1) onPage(p);
    });
  });
}

// ============ 兜底：脚本加载即尝试填充供应商下拉框 ============
// 不依赖路由 _ordersInited 守卫，确保只要页面里有供应商/历史供应商
// 下拉框，就尽早去服务端拉取并写入，避免“路由没触发 / 日志被过滤”
// 造成的“下拉框为空却查不出原因”的问题。
(function autoLoadSuppliers() {
  const hasSelect = document.getElementById('orderSupplier') || document.getElementById('historySupplier');
  if (!hasSelect) return;
  // 延迟一拍，等 DOM 完全就绪
  setTimeout(() => {
    loadSuppliers().then(() => {
      const els = document.querySelectorAll('#orderSupplier');
      console.log('[autoLoadSuppliers] 供应商已填充，匹配 orderSupplier 数=', els.length, ' 首个innerHTML=', JSON.stringify(els[0] ? els[0].innerHTML : '无'));
    }).catch(err => {
      console.error('[autoLoadSuppliers] 填充失败', err);
    });
  }, 0);
})();

// ========== 以下为真实订单渲染与交互逻辑 ==========
