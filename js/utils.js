/* ========== 工具函数 ========== */

function $(sel, parent = document) { return parent.querySelector(sel); }
function $$(sel, parent = document) { return parent.querySelectorAll(sel); }

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

// 时间戳转「年月日 时分秒」（含秒），用于数据库查看等场景
function fmtDateTime(ts) {
  if (ts === null || ts === undefined || ts === '') return '';
  let ms = Number(ts);
  if (isNaN(ms)) return String(ts);
  // 兼容秒级时间戳（10 位）自动补成毫秒级
  if (ms < 1e12) ms = ms * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return String(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 判断一个数值是否像时间戳（毫秒级 1e12 左右，或秒级 1e10 左右）
function looksLikeTimestamp(n) {
  const v = Number(n);
  if (isNaN(v) || !isFinite(v)) return false;
  // 排除过小或明显非时间的整数（如价格、数量、0 等）
  if (v <= 0) return false;
  // 秒级 1e9 ~ 1e11，毫秒级 1e12 ~ 1e13
  if (v >= 1e9 && v < 1e14) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100) return true;
  }
  return false;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtMoney(n) { return '¥' + (Number(n) || 0).toFixed(2); }

/* Toast */
function showToast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast toast-' + type + ' show';
  clearTimeout(el._tid);
  if (type !== 'loading') el._tid = setTimeout(() => { el.className = 'toast'; }, 6000);
}
function hideToast() {
  const el = $('#toast');
  if (el) el.className = 'toast';
  clearTimeout(el._tid);
}

/* Modal */
function showModal(title, bodyHtml, footerHtml) {
  $('#modalOverlay').style.display = 'flex';
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalFooter').innerHTML = footerHtml || '';
}
function closeModal() { $('#modalOverlay').style.display = 'none'; }

/* ========== 切换侧边栏 active ========== */
function setSidebarActive(page) {
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
}

/* ========== 防抖 ========== */
function debounce(fn, delay = 300) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
