/* ========== 数据看板 Dashboard ========== */

// 趋势图状态
let _trend = null;
let _trendRange = 'day';
let _trendHidden = new Set();
let _trendInited = false;
let _pmInited = false;
let _trendHover = null;
let _trendGeom = null;

const TREND_METRICS = {
  orders:   { label: '订单数', color: '#C23531', axis: 'count' },
  sales:    { label: '销售额', color: '#E6A23C', axis: 'money' },
  cost:     { label: '总货款', color: '#5B8FF9', axis: 'money' },
  shipping: { label: '总快递费', color: '#9C6ADE', axis: 'money' },
  profit:   { label: '利润', color: '#3C8C40', axis: 'money' }
};

// 最新看板统计（供利润卡片弹窗）
let _dashStats = null;
let _dashExtrasInited = false;

// ========== 看板交互（刷新按钮 / 利润卡片构成弹窗）==========
function initDashboardExtras() {
  if (_dashExtrasInited) return;
  _dashExtrasInited = true;

  // 刷新按钮：重新拉取统计并更新页面与时间
  const rf = $('#dashRefreshBtn');
  if (rf) rf.addEventListener('click', async () => {
    rf.disabled = true; rf.textContent = '刷新中...';
    try { await loadDashboard(); }
    catch (e) { showToast('刷新失败: ' + e.message, 'error'); }
    finally { rf.disabled = false; rf.textContent = '刷新'; }
  });
}

function showProfitDetail(range) {
  const s = _dashStats;
  if (!s) { showToast('数据尚未加载', 'info'); return; }
  const map = {
    today: { title: '今日利润构成', sales: s.todaySales, cost: s.todayCostPrice, shipping: s.todayShipping, profit: s.todayProfit },
    m30:   { title: '近30天利润构成', sales: s.last30Sales, cost: s.last30CostPrice, shipping: s.last30Shipping, profit: s.last30Profit },
    hc:    { title: '历史累计利润构成', sales: s.totalSales, cost: s.totalCostPrice, shipping: s.totalShipping, profit: s.totalProfit }
  };
  const d = map[range] || map.today;
  showModal(d.title, `
    <div class="profit-detail">
      <div class="pd-row"><span>销售额</span><b>${fmtMoney(d.sales)}</b></div>
      <div class="pd-row"><span>货款</span><b>${fmtMoney(d.cost)}</b></div>
      <div class="pd-row"><span>物流费</span><b>${fmtMoney(d.shipping)}</b></div>
      <div class="pd-row pd-total"><span>毛利（销售额 － 货款 － 物流费）</span><b>${fmtMoney(d.profit)}</b></div>
    </div>
  `, `<button class="btn btn-outline" onclick="closeModal()">关闭</button>`);
}

async function loadDashboard() {
  try {
    const stats = await apiCall('getOrderStats');

    // 今日数据
    $('#statTodayOrders').textContent = stats.todayOrderCount || 0;
    $('#statTodaySales').textContent = fmtMoney(stats.todaySales);
    $('#statTodayProfit').textContent = fmtMoney(stats.todayProfit);
    $('#statTodayNewUsers').textContent = stats.todayNewUsers || 0;
    $('#statTodayDiy').textContent = stats.todayDiy || 0;
    $('#statTodayDiySaved').textContent = stats.todayDiySaved || 0;
    $('#statTodayDiyBought').textContent = stats.todayDiyBought || 0;

    // 近30天数据
    $('#statM30Orders').textContent = stats.last30OrderCount || 0;
    $('#statM30Sales').textContent = fmtMoney(stats.last30Sales);
    $('#statM30Profit').textContent = fmtMoney(stats.last30Profit);
    $('#statM30NewUsers').textContent = stats.last30NewUsers || 0;
    $('#statM30Diy').textContent = stats.last30Diy || 0;
    $('#statM30DiySaved').textContent = stats.last30DiySaved || 0;
    $('#statM30DiyBought').textContent = stats.last30DiyBought || 0;

    // 历史累计
    $('#statHCOrders').textContent = stats.totalOrderCount || 0;
    $('#statHCSales').textContent = fmtMoney(stats.totalSales);
    $('#statHCProfit').textContent = fmtMoney(stats.totalProfit);
    $('#statHCDiy').textContent = stats.totalDiy || 0;
    $('#statHCDiySaved').textContent = stats.totalDiySaved || 0;
    $('#statHCDiyBought').textContent = stats.totalDiyBought || 0;
    $('#statUserTotal').textContent = stats.userTotal || 0;

    // 较昨日（销售额 / 利润）
    setDiff('statSalesDiff', stats.todaySales, stats.yesterdaySales);
    setDiff('statProfitDiff', stats.todayProfit, stats.yesterdayProfit);
    // 较上期（近30天 销售额 / 利润）
    setDiff('statSalesGrowth', stats.last30Sales, stats.prev30Sales);
    setDiff('statProfitGrowth', stats.last30Profit, stats.prev30Profit);

    $('#dashTime').textContent = new Date().toLocaleString('zh-CN');
    // 待处理订单数量（来自 getOrderStats 已统计，无需拉全量列表）
    if ($('#pmCntUnship')) $('#pmCntUnship').textContent = stats.unshippedOrderCount || 0;
    if ($('#pmCntRefund')) $('#pmCntRefund').textContent = stats.pendingRefundCount || 0;
    // 记录最新统计，供利润卡片弹窗使用
    _dashStats = stats;
    initDashboardExtras();
    initPendingModule();
  } catch(e) {
    showToast('加载看板数据失败: ' + e.message, 'error');
  }

  await loadTrend(_trendRange);
}

function setDiff(id, cur, prev) {
  const el = $('#' + id);
  if (!el) return;
  if (prev && prev > 0) {
    const d = (cur - prev) / prev * 100;
    el.textContent = (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
    // 上涨用红色、下降用绿色（其余指标均为黑色）
    el.style.color = d >= 0 ? '#f56c6c' : '#3C8C40';
  } else {
    el.textContent = '—';
    el.style.color = '';
  }
}

// ========== 销售趋势折线图 ==========
async function loadTrend(range) {
  _trendRange = range;
  try {
    _trend = await apiCall('getSalesTrend', { range });
  } catch(e) {
    showToast('加载趋势失败: ' + e.message, 'error');
    return;
  }
  renderTrendLegend();
  renderTrendChart();
}

function initTrendToggle() {
  if (_trendInited) return;
  _trendInited = true;
  $$('#trendChartWrap [data-range]').forEach(btn => {
    btn.addEventListener('click', async () => {
      $$('#trendChartWrap [data-range]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _trendHidden.clear();
      await loadTrend(btn.dataset.range);
    });
  });
  window.addEventListener('resize', () => { if (_trend) renderTrendChart(); });
  // 鼠标悬浮：显示该位置所有指标数值
  const tcanvas = $('#trendChart');
  if (tcanvas) {
    tcanvas.addEventListener('mousemove', (e) => {
      if (!_trend || !_trendGeom) return;
      const rect = tcanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const { padL, plotW, n } = _trendGeom;
      let idx = Math.round((x - padL) / plotW * (n - 1));
      idx = Math.max(0, Math.min(n - 1, idx));
      if (idx !== _trendHover) { _trendHover = idx; renderTrendChart(); }
    });
    tcanvas.addEventListener('mouseleave', () => {
      if (_trendHover !== null) { _trendHover = null; renderTrendChart(); }
    });
  }
}

function renderTrendLegend() {
  initTrendToggle();
  const el = $('#trendLegend');
  if (!el || !_trend) return;
  el.innerHTML = Object.keys(TREND_METRICS).map(key => {
    const m = TREND_METRICS[key];
    const hidden = _trendHidden.has(key);
    const lastVal = _trend.series[key] && _trend.series[key].length
      ? _trend.series[key][_trend.series[key].length - 1] : 0;
    return `<span class="legend-item ${hidden ? 'legend-off' : ''}" data-key="${key}">
      <i class="legend-dot" style="background:${m.color}"></i>${m.label}
    </span>`;
  }).join('');
  el.querySelectorAll('.legend-item').forEach(item => {
    item.addEventListener('click', () => {
      const key = item.dataset.key;
      if (_trendHidden.has(key)) _trendHidden.delete(key);
      else _trendHidden.add(key);
      renderTrendLegend();
      renderTrendChart();
    });
  });
}

function renderTrendChart() {
  const canvas = $('#trendChart');
  if (!canvas || !_trend) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = 340;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return; // 当前环境不支持 canvas（如部分无头环境），跳过绘制
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const labels = _trend.labels;
  const series = _trend.series;
  const n = labels.length;
  const padL = 58, padR = 50, padT = 18, padB = 38;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;
  _trendGeom = { padL, plotW, n };

  const visibleMoney = Object.keys(TREND_METRICS).filter(k => TREND_METRICS[k].axis === 'money' && !_trendHidden.has(k));
  const visibleCount = Object.keys(TREND_METRICS).filter(k => TREND_METRICS[k].axis === 'count' && !_trendHidden.has(k));

  let moneyMax = 0, countMax = 0;
  visibleMoney.forEach(k => series[k].forEach(v => { if (v > moneyMax) moneyMax = v; }));
  visibleCount.forEach(k => series[k].forEach(v => { if (v > countMax) countMax = v; }));
  moneyMax = niceMax(moneyMax);
  countMax = niceMax(countMax);

  // 网格 + 坐标轴标签
  ctx.strokeStyle = '#eee';
  ctx.fillStyle = '#999';
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = padT + plotH * i / steps;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    const moneyVal = Math.round(moneyMax * (1 - i / steps));
    ctx.textAlign = 'right'; ctx.fillText('¥' + abbrev(moneyVal), padL - 6, y + 4);
    if (countMax > 0) {
      const countVal = Math.round(countMax * (1 - i / steps));
      ctx.textAlign = 'left'; ctx.fillText(abbrev(countVal), padL + plotW + 6, y + 4);
    }
  }

  // X 轴标签（抽稀）
  const labelStep = Math.ceil(n / 8);
  ctx.textAlign = 'center'; ctx.fillStyle = '#999';
  for (let i = 0; i < n; i++) {
    if (i % labelStep !== 0 && i !== n - 1) continue;
    const x = padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1));
    ctx.fillText(labels[i], x, cssH - padB + 18);
  }

  // 画线
  const drawSeries = (key, max) => {
    const m = TREND_METRICS[key];
    const data = series[key];
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1));
      const y = padT + plotH * (1 - (max ? v / max : 0));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // 数据点
    ctx.fillStyle = m.color;
    data.forEach((v, i) => {
      const x = padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1));
      const y = padT + plotH * (1 - (max ? v / max : 0));
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    });
  };
  visibleMoney.forEach(k => drawSeries(k, moneyMax));
  visibleCount.forEach(k => drawSeries(k, countMax));

  // 悬停提示：显示该位置所有指标数值
  if (_trendHover != null && _trendHover >= 0 && _trendHover < n) {
    const idx = _trendHover;
    const hx = padL + (n === 1 ? plotW / 2 : plotW * idx / (n - 1));
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);

    const rows = [{ text: labels[idx], color: '#333', bold: true }];
    [...visibleMoney, ...visibleCount].forEach(k => {
      const m = TREND_METRICS[k];
      const v = series[k][idx];
      rows.push({ text: `${m.label}：${m.axis === 'money' ? fmtMoney(v) : v}`, color: m.color, bold: false });
    });

    ctx.font = '12px sans-serif';
    let bw = 0;
    rows.forEach(r => { const w = ctx.measureText(r.text).width; if (w > bw) bw = w; });
    bw += 28;
    const bh = rows.length * 18 + 12;
    let bx = hx + 14;
    if (bx + bw > cssW) bx = hx - bw - 14;
    const by = padT + 8;

    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeStyle = '#e3ddd4';
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, bw, bh, 6); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const ry = by + 13 + i * 18;
      if (i === 0) {
        ctx.fillStyle = r.color; ctx.font = 'bold 12px sans-serif';
        ctx.fillText(r.text, bx + 12, ry);
      } else {
        ctx.fillStyle = r.color;
        ctx.beginPath(); ctx.arc(bx + 16, ry, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#444'; ctx.font = '12px sans-serif';
        ctx.fillText(r.text, bx + 24, ry);
      }
    });
    ctx.textBaseline = 'alphabetic';
  }

  if (!visibleMoney.length && !visibleCount.length) {
    ctx.fillStyle = '#bbb'; ctx.textAlign = 'center';
    ctx.fillText('（已隐藏全部指标）', cssW / 2, cssH / 2);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ========== 待处理订单模块（仅显示数量，点击跳转）==========
function initPendingModule() {
  if (_pmInited) return;
  _pmInited = true;
  $$('.pending-module .pending-count-box').forEach(box => {
    box.addEventListener('click', () => goToOrders(box.dataset.status));
  });
}

function goToOrders(status) {
  navigateTo('orders');
  if (status === '待发货') {
    orderState.tab = 'pending';
    $$('#orderTabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'pending'));
    $('#orderPending').style.display = 'block';
    $('#orderHistory').style.display = 'none';
  } else {
    orderState.tab = 'history';
    orderState.historyStatus = status;
    orderState.historyPage = 1;
    $$('#orderTabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'history'));
    $('#orderPending').style.display = 'none';
    $('#orderHistory').style.display = 'block';
    const sel = $('#historyStatus');
    if (sel) sel.value = status;
  }
  reloadOrders();
}

function niceMax(v) {
  if (v <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  let step;
  if (norm <= 1) step = 1; else if (norm <= 2) step = 2;
  else if (norm <= 5) step = 5; else step = 10;
  return step * mag;
}

function abbrev(v) {
  if (v >= 10000) return (v / 10000).toFixed(1) + 'w';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return '' + v;
}
