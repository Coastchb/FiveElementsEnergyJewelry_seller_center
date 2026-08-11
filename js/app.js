/* ========== App 主控制器 ========== */

let currentPage = '';

// URL hash 变化时（前进/后退/手动修改）同步切换页面；注册在顶部，确保早于首次 navigateTo
window.addEventListener('hashchange', () => {
  navigateTo(location.hash.slice(1) || 'dashboard');
});

// ========== 登录 ==========
$('#loginBtn').addEventListener('click', async () => {
  const account = $('#loginAccount').value.trim();
  const password = $('#loginPwd').value.trim();
  if (!account || !password) {
    $('#loginError').textContent = '请输入账号和密码';
    return;
  }
  $('#loginBtn').disabled = true;
  $('#loginBtn').textContent = '登录中...';
  $('#loginError').textContent = '';
  try {
    const data = await apiCall('login', { account, password });
    setToken(data.token);
    $('#userName').textContent = data.name || '管理员';
    $('#userAvatar').textContent = (data.name || '管')[0];
    showApp();
  } catch(e) {
    $('#loginError').textContent = e.message || '登录失败';
  } finally {
    $('#loginBtn').disabled = false;
    $('#loginBtn').textContent = '登 录';
  }
});

// 回车登录
$('#loginPwd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#loginBtn').click();
});

function showApp() {
  $('#loginPage').style.display = 'none';
  $('#appPage').style.display = 'flex';
  initNavigate();
  // 优先用 URL hash（如 #products）定位页面，刷新即停留原页；否则回退 localStorage / 看板
  const initPage = location.hash.slice(1) || localStorage.getItem('seller_current_page') || 'dashboard';
  navigateTo(initPage);
}

// ========== 登出 ==========
$('#logoutBtn').addEventListener('click', () => {
  showModal('退出登录', '<p style="text-align:center;">确定要退出登录吗？</p>', `
    <button class="btn btn-danger" id="logoutConfirm">确定退出</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#logoutConfirm');
    if (btn) btn.onclick = () => {
      closeModal();
      setToken('');
      localStorage.removeItem(STORAGE_KEY);
      $('#appPage').style.display = 'none';
      $('#loginPage').style.display = 'flex';
    };
  }, 50);
});

// ========== 导航 ==========
function initNavigate() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(item.dataset.page);
    });
  });

  // Modal 关闭
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalOverlay').addEventListener('click', (e) => {
    if (e.target === $('#modalOverlay')) closeModal();
  });
}

async function navigateTo(page) {
  if (!page) page = 'dashboard';
  // 同步 URL hash（如 #products），让每个页面拥有独立 URL，刷新后浏览器直接定位
  if (location.hash.slice(1) !== page) {
    location.hash = page; // 修改 hash 后触发 hashchange，再次进入本函数完成渲染
    return;
  }
  if (page === currentPage) return; // 已在该页，避免重复渲染/重复加载
  setSidebarActive(page);

  // 离开上传历史页时停止自动轮询
  if (currentPage === 'taskhistory' && page !== 'taskhistory' && typeof stopTaskPolling === 'function') {
    stopTaskPolling();
  }

  // 隐藏所有页面
  $$('.page-section').forEach(s => s.style.display = 'none');
  const target = $('#page-' + page);
  if (target) target.style.display = 'block';
  currentPage = page;
  localStorage.setItem('seller_current_page', page); // 冗余备份，兼容无 hash 场景

  // 加载对应数据
  if (page === 'dashboard') await loadDashboard();
  else if (page === 'orders') {
    initOrders();
    await reloadOrders();
  }   else if (page === 'products') {
    await initProducts();
    await loadProducts();
  } else if (page === 'users') {
    initUsers();
    _userRole = 'buyer';
    $$('#userTabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'buyer'));
    showUserTab('buyer');
    await loadUsers('buyer');
  } else if (page === 'dbview') {
    initDbview();
  } else if (page === 'taskhistory') {
    initTaskHistory();
    await loadTaskHistory();
  }
}

// ========== 自动登录 ==========
(function checkAutoLogin() {
  if (AUTH_TOKEN) {
    // 验证 token 是否有效
    try {
      const db = getDB();
      $('#userName').textContent = db.session.name || '管理员';
      $('#userAvatar').textContent = (db.session.name || '管')[0];
      showApp();
    } catch(e) {
      setToken('');
    }
  }
})();
