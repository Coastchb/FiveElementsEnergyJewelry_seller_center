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
  el._tid = setTimeout(() => { el.className = 'toast'; }, 2000);
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
