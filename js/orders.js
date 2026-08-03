/* ========== 订单管理 Orders ========== */

let orderState = {
  tab: 'pending',
  subType: 'product',
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

function initOrders() {
  if (_ordersInited) return;
  _ordersInited = true;

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
    const data = await apiCall('getAdminOrders', {
      scope: 'pending',
      subType: orderState.subType,
      pageNum: 1,
      pageSize: 200
    });
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
    const [rp, rd] = await Promise.all([
      apiCall('getAdminOrders', { scope: 'pending', subType: 'product', pageNum: 1, pageSize: 1 }),
      apiCall('getAdminOrders', { scope: 'pending', subType: 'diy', pageNum: 1, pageSize: 1 })
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
      keyword: orderState.historyKeyword || undefined
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
    const statusClass = { '待发货': 'st-paid', '运输中': 'st-ship', '已完成': 'st-done', '已取消': 'st-cancel', '待退款': 'st-refund-pending', '已退款': 'st-refunded' }[o.status] || '';
    const isDiy = o.type === 'diy';
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

    // 物流详情（含完整物流轨迹，默认折叠，点击展开）
    const hasExpress = !!(o.expressCompany || o.waybillNo);
    let logisticsHtml = '';
    if (hasExpress) {
      const ls = o.signed ? '已签收' : '运输中';
      const statusClass = o.signed ? 'signed' : 'shipping';
      const trace = buildTrace(o);
      const interceptHtml = o.intercepted
        ? `<div class="logi-interrupt">🚫 已拦截：${o.interceptInfo || ''}</div>` : '';
      logisticsHtml = `
      <div class="order-logistics">
        <div class="logi-head" onclick="toggleLogi(this)">
          <span class="logi-title">物流追踪</span>
          <span class="logi-company">${o.expressCompany || '-'} · ${o.waybillNo || '-'}</span>
          <span class="logi-status ${statusClass}">${ls}</span>
          <span class="logi-caret">▾</span>
        </div>
        <div class="logi-trace" style="display:none;">
          ${trace.map(t => `
            <div class="trace-item ${t.active ? 'active' : ''}">
              <div class="trace-dot"></div>
              <div class="trace-info">
                <div class="trace-desc">${t.desc}</div>
                <div class="trace-time">${t.time}</div>
              </div>
            </div>`).join('')}
          ${interceptHtml}
        </div>
      </div>`;
    }

    // 售后管理操作（按订单状态 + 物流状态展示）
    let adminHtml = '';
    if (o.status === '待支付') {
      adminHtml = `<button class="btn btn-outline" onclick="onCancelOrder('${o.orderId}', 'cancel')">取消订单</button>`;
    } else if (o.status === '待发货' || o.status === '运输中' || o.status === '已完成') {
      // 未进入退换货流程：仅提供「退换货」入口
      adminHtml = `<button class="btn btn-danger" onclick="onApplyRefund('${o.orderId}')">退换货</button>`;
    } else if (o.status === '待退款') {
      // 已退换货：原「退换货」变灰；运输中未签收可「拦截快递」；并新增「退款」按钮
      adminHtml = `<button class="btn btn-danger" disabled>退换货</button>`;
      if (hasExpress && !o.signed) {
        adminHtml += o.intercepted
          ? `<button class="btn btn-warn" disabled>已拦截快递</button>`
          : `<button class="btn btn-warn" onclick="onIntercept('${o.orderId}')">拦截快递</button>`;
      }
      adminHtml += `<button class="btn btn-danger" onclick="onConfirmRefund('${o.orderId}')">退款</button>`;
    } else if (o.status === '已退款') {
      adminHtml = `<button class="btn btn-danger" disabled>退换货</button><button class="btn btn-danger" disabled>退款</button>`;
    }

    const actionsHtml = (waybillHtml || adminHtml || true) ? (waybillHtml + adminHtml + `<button class="btn btn-outline" onclick="onEditSellerRemark('${o.orderId}')">卖家备注</button>`) : '';

    const fee = Number(o.物流费) || 0;
    const gross = Math.round(((o.price * o.qty || 0) - (o.costPrice || 0) - fee) * 100) / 100;
    const remarkHtml = `
      ${o.buyerRemark ? `<div class="order-remark"><span class="remark-label buyer">买家备注</span><span class="remark-text">${o.buyerRemark}</span></div>` : ''}
      ${o.sellerRemark ? `<div class="order-remark"><span class="remark-label seller">卖家备注</span><span class="remark-text">${o.sellerRemark}</span></div>` : ''}
    `;

    return `
    <div class="order-card">
      <div class="order-card-head">
        <span class="order-seq">编号：${o.orderId.slice(-4)}</span>
        <span class="order-status ${statusClass}">${o.status}</span>
        ${o.status === '已退款' ? '<span class="refund-tag">已退款</span>' : ''}
      </div>
      <div class="order-goods">
        <span class="order-goods-name">${o.goodsName}</span>
        <span style="font-weight:600;color:#8A8079;">×${o.qty}</span>
        ${tagHtml}
      </div>
      ${diyHtml}
      <div class="order-cost-line">
        <span>售价：<b class="money">${fmtMoney(o.price * o.qty || 0)}</b></span>
        <span>成本价：<b>${fmtMoney(o.costPrice || 0)}</b></span>
        <span>物流费：<b>${fee ? fmtMoney(fee) : '-'}</b></span>
        <span>毛利：<b class="${gross >= 0 ? 'profit' : 'loss'}">${fmtMoney(gross)}</b></span>
      </div>
      <div class="order-info">
        <div class="order-info-no">订单号：${o.orderId}<button type="button" class="copy-no-btn" onclick="onCopyOrderId('${o.orderId}', this)">复制</button></div>
        <div>下单：${o.createdAtText || ''}</div>
        <div>用户：${o.nickname || ''}</div>
        <div>收货：${(o.address && o.address.name) || ''} ${(o.address && o.address.phone) || ''}</div>
        <div>地址：${(o.address && o.address.address) || ''}</div>
        ${o.shippedAtText ? `<div>发货：${o.shippedAtText}</div>` : ''}
      </div>
      ${logisticsHtml}
      ${remarkHtml}
      ${actionsHtml ? '<div class="order-actions">' + actionsHtml + '</div>' : ''}
    </div>`;
  }).join('');
}

// ========== 物流轨迹（mock 合成，真实环境由快递助手/微信物流助手返回替换）==========
function buildTrace(o) {
  const H = 3600000;
  const fmt = (ts) => {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const t0 = o.createdAt || Date.now();
  const shipAt = o.shippedAt || (t0 + 3 * H);
  const isSigned = o.signed || o.status === '已完成';
  const list = [];
  list.push({ desc: '您的订单已提交，等待商家发货', time: fmt(t0), active: false });
  list.push({ desc: `【${o.expressCompany || '快递'}】已揽收，快件已发出`, time: fmt(shipAt), active: false });
  list.push({ desc: '运输中，快件已到达【转运中心】', time: fmt(shipAt + 6 * H), active: false });
  list.push({ desc: '运输中，快件已到达【目的地分拨中心】', time: fmt(shipAt + 18 * H), active: false });
  list.push({ desc: '派送中，快递员正在为您配送', time: fmt(shipAt + 30 * H), active: !isSigned });
  if (isSigned) {
    list.push({ desc: '已签收，感谢您的使用', time: fmt(shipAt + 33 * H), active: true });
  }
  if (o.intercepted) {
    list.push({ desc: '已发起快递拦截，包裹退回中：' + (o.interceptInfo || ''), time: fmt(shipAt + 34 * H), active: true });
  }
  return list;
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
          <li>立即与供应商联系，沟通退换货事情（通知他们该单取消）；</li>
          <li>立即退款给用户。</li>
        </ol>`,
    b: `<p style="margin-bottom:8px;">该商品<strong>运输中（未签收）</strong>，请按以下操作：</p>
        <ol class="guide-list">
          <li>如果是换货，让用户重新下单；</li>
          <li>立即拦截快递；</li>
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
        showToast('已转入「待退款」，请跟进退款', 'success');
        await reloadOrders();
      } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
    };
  }, 50);
}

// ========== 拦截快递（仅运输中未签收且进入退换货流程后可用）==========
async function onIntercept(orderId) {
  showModal('拦截快递', `
    <p style="text-align:center;line-height:2;">确认向快递公司发起拦截？</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">包裹将在最近网点退回，拦截完成后再进行退款。</p>
    <p style="text-align:center;color:#8A8079;font-size:13px;">订单号：${orderId}</p>
  `, `
    <button class="btn btn-warn" id="interceptConfirm">确认拦截</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#interceptConfirm');
    if (btn) btn.onclick = async () => {
      closeModal();
      try {
        await apiCall('adminUpdateOrder', { orderId, action: 'intercept' });
        showToast('已发起快递拦截', 'success');
        await reloadOrders();
      } catch(e) { showToast('操作失败: ' + e.message, 'error'); }
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
