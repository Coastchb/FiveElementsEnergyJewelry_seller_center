/* ========== 用户管理（买家 / 供应商 / 管理员）========== */

let _usersInited = false;
let _userRole = 'buyer';
const _userCache = { buyer: [], supplier: [], admin: [] };

function initUsers() {
  if (_usersInited) return;
  _usersInited = true;

  $$('#userTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#userTabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _userRole = btn.dataset.tab;
      showUserTab(_userRole);
      loadUsers(_userRole);
    });
  });

  $('#addSupplierBtn').addEventListener('click', () => openSupplierModal('create'));
  $('#addAdminBtn').addEventListener('click', () => openAdminModal('create'));
}

function showUserTab(role) {
  $('#userBuyer').style.display = role === 'buyer' ? 'block' : 'none';
  $('#userSupplier').style.display = role === 'supplier' ? 'block' : 'none';
  $('#userAdmin').style.display = role === 'admin' ? 'block' : 'none';
}

async function loadUsers(role) {
  try {
    const res = await apiCall('getAdminUsers', { role });
    _userCache[role] = res.list || [];
    if (role === 'buyer') renderBuyer(res.list, res.total);
    else if (role === 'supplier') renderSupplier(res.list, res.total);
    else renderAdmin(res.list, res.total);
  } catch (e) {
    showToast('加载失败: ' + e.message, 'error');
  }
}

// ========== 买家用户（只读展示）==========
function renderBuyer(list, total) {
  $('#buyerTotal').textContent = `共 ${total} 位买家用户`;
  const body = $('#buyerBody');
  if (!list.length) { body.innerHTML = '<tr><td colspan="6" class="empty-state">暂无买家用户</td></tr>'; return; }
  body.innerHTML = list.map(u => `<tr>
    <td>${escapeHtml(u.userId)}</td>
    <td>${escapeHtml(u.nickname || '-')}</td>
    <td>${fmtTime(u.registerAt)}</td>
    <td>${fmtTime(u.lastLoginAt)}</td>
    <td>${u.diyCount}</td>
    <td>${u.buyCount}</td>
  </tr>`).join('');
}

// ========== 供应商（增删改）==========
function renderSupplier(list, total) {
  $('#supplierTotal').textContent = `共 ${total} 个供应商`;
  const body = $('#supplierBody');
  if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="empty-state">暂无供应商，点击右上角新增</td></tr>'; return; }
  body.innerHTML = list.map((s, idx) => `<tr>
    <td>${escapeHtml(s.supplierId)}</td>
    <td>${escapeHtml(s.name || '-')}</td>
    <td>${escapeHtml(s.account)}</td>
    <td>${escapeHtml(s.loginPassword || '')}</td>
    <td>${fmtTime(s.firstLoginAt)}</td>
    <td>${fmtTime(s.lastLoginAt)}</td>
    <td>
      <span class="action-link" data-supplier-idx="${idx}" data-action="edit">修改</span>
      <span class="action-link danger" data-supplier-idx="${idx}" data-action="delete">删除</span>
    </td>
  </tr>`).join('');
  body.querySelectorAll('[data-supplier-idx]').forEach(link => {
    link.addEventListener('click', () => {
      const idx = +link.dataset.supplierIdx;
      if (link.dataset.action === 'edit') openSupplierModal('update', idx);
      else deleteSupplier(idx);
    });
  });
}

function openSupplierModal(action, idx) {
  const isEdit = action === 'update';
  const s = isEdit ? _userCache.supplier[idx] : null;
  showModal(isEdit ? '修改供应商' : '新增供应商', `
    <form id="supplierForm" autocomplete="off">
      <div class="form-row"><label>供应商ID</label>
        <input id="sfUserID" class="form-input" autocomplete="off" value="${s ? escapeHtml(s.supplierId) : ''}" placeholder="如 S001" ${isEdit ? 'disabled' : ''}></div>
      <div class="form-row"><label>供应商名称</label>
        <input id="sfName" class="form-input" autocomplete="off" value="${s ? escapeHtml(s.name) : ''}" placeholder="供应商名称"></div>
      <div class="form-row"><label>登录账号</label>
        <input id="sfAccount" class="form-input" autocomplete="off" value="${s ? escapeHtml(s.account) : ''}" placeholder="供应商登录账号"></div>
      <div class="form-row pwd-row"><label>登录密码</label>
        <input id="sfPwd" class="form-input" type="password" autocomplete="new-password" value="${s ? escapeHtml(s.loginPassword || '') : ''}" placeholder="${isEdit ? '不修改请留空' : '登录密码'}">
        <span class="pwd-toggle" id="sfPwdToggle">显示密码</span>
      </div>
    </form>
  `, `
    <button class="btn btn-primary" id="supplierSaveBtn">保存</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const toggle = $('#sfPwdToggle');
    if (toggle) toggle.addEventListener('click', () => {
      const input = $('#sfPwd');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? '隐藏密码' : '显示密码';
    });
    const btn = $('#supplierSaveBtn');
    if (btn) btn.onclick = async () => {
      const supplierId = $('#sfUserID').value.trim();
      const name = $('#sfName').value.trim();
      const account = $('#sfAccount').value.trim();
      const loginPassword = $('#sfPwd').value;
      if (!supplierId || !account || (!isEdit && !loginPassword)) { showToast('请填写完整信息', 'error'); return; }
      const payload = { role: 'supplier', action, supplierId, name, account };
      if (loginPassword) payload.loginPassword = loginPassword;
      try {
        await apiCall('manageUser', payload);
        closeModal();
        showToast('已保存', 'success');
        await loadUsers('supplier');
      } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
    };
  }, 50);
}

async function deleteSupplier(idx) {
  const s = _userCache.supplier[idx];
  if (!s) return;
  showModal('删除供应商', `<p style="text-align:center;">确定删除供应商 <b>${escapeHtml(s.supplierId)}</b> ？</p>`, `
    <button class="btn btn-danger" id="supplierDelBtn">删除</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#supplierDelBtn');
    if (btn) btn.onclick = async () => {
      try {
        await apiCall('manageUser', { role: 'supplier', action: 'delete', supplierId: s.supplierId });
        closeModal();
        showToast('已删除', 'success');
        await loadUsers('supplier');
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    };
  }, 50);
}

// ========== 管理员（增删改）==========
function renderAdmin(list, total) {
  $('#adminTotal').textContent = `共 ${total} 个管理员`;
  const body = $('#adminBody');
  if (!list.length) { body.innerHTML = '<tr><td colspan="3" class="empty-state">暂无管理员，点击右上角新增</td></tr>'; return; }
  body.innerHTML = list.map((a, idx) => `<tr>
    <td>${escapeHtml(a.account || '')}</td>
    <td>***</td>
    <td>
      <span class="action-link" data-admin-idx="${idx}" data-action="edit">修改</span>
      <span class="action-link danger" data-admin-idx="${idx}" data-action="delete">删除</span>
    </td>
  </tr>`).join('');
  body.querySelectorAll('[data-admin-idx]').forEach(link => {
    link.addEventListener('click', () => {
      const idx = +link.dataset.adminIdx;
      if (link.dataset.action === 'edit') openAdminModal('update', idx);
      else deleteAdmin(idx);
    });
  });
}

function openAdminModal(action, idx) {
  const isEdit = action === 'update';
  const a = isEdit ? _userCache.admin[idx] : null;
  showModal(isEdit ? '修改管理员' : '新增管理员', `
    <form id="adminForm" autocomplete="off">
      <div class="form-row"><label>账号名</label>
        <input id="afName" class="form-input" autocomplete="off" value="${a ? escapeHtml(a.account || '') : ''}" placeholder="登录账号名" ${isEdit ? 'disabled' : ''}></div>
      <div class="form-row pwd-row"><label>密码</label>
        <input id="afPwd" class="form-input" type="password" autocomplete="new-password" value="${a ? escapeHtml(a.password || '') : ''}" placeholder="${isEdit ? '不修改请留空' : '登录密码'}">
        <span class="pwd-toggle" id="afPwdToggle">显示密码</span>
      </div>
    </form>
  `, `
    <button class="btn btn-primary" id="adminSaveBtn">保存</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const toggle = $('#afPwdToggle');
    if (toggle) toggle.addEventListener('click', () => {
      const input = $('#afPwd');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? '隐藏密码' : '显示密码';
    });
    const btn = $('#adminSaveBtn');
    if (btn) btn.onclick = async () => {
      const account = isEdit ? (a ? a.account : '') : $('#afName').value.trim();
      const password = $('#afPwd').value;
      if (!account || (!isEdit && !password)) { showToast('请填写完整信息', 'error'); return; }
      const payload = { role: 'admin', action, account };
      if (password) payload.password = password;
      try {
        await apiCall('manageUser', payload);
        closeModal();
        showToast('已保存', 'success');
        await loadUsers('admin');
      } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
    };
  }, 50);
}

async function deleteAdmin(idx) {
  const a = _userCache.admin[idx];
  if (!a) return;
  showModal('删除管理员', `<p style="text-align:center;">确定删除管理员 <b>${escapeHtml(a.account || '')}</b> ？</p>`, `
    <button class="btn btn-danger" id="adminDelBtn">删除</button>
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
  `);
  setTimeout(() => {
    const btn = $('#adminDelBtn');
    if (btn) btn.onclick = async () => {
      try {
        await apiCall('manageUser', { role: 'admin', action: 'delete', account: a.account });
        closeModal();
        showToast('已删除', 'success');
        await loadUsers('admin');
      } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
    };
  }, 50);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
