/* ========== 上传历史 ========== */
let _taskInited = false;

const TASK_STATUS_TEXT = {
  pending: '处理中',
  uploading: '上传中',
  running: '解析/写入中',
  success: '成功',
  failed: '失败',
};

function fmtTaskTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtFileSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function statusBadge(status) {
  const cls = 'task-status task-status-' + (status || 'pending');
  const text = TASK_STATUS_TEXT[status] || status || '未知';
  return `<span class="${cls}">${text}</span>`;
}

function fmtParams(params) {
  if (!params || typeof params !== 'object') return '-';
  const entries = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`);
  return entries.length ? entries.join(' / ') : '-';
}

function fmtParamsFull(params) {
  if (!params || typeof params !== 'object') return '<div class="log-line">无参数</div>';
  const lines = Object.entries(params).map(([k, v]) => {
    const val = v === '' || v == null ? '（未填写）' : escapeHtml(String(v));
    return `<div class="log-line"><strong>${escapeHtml(k)}</strong>：${val}</div>`;
  });
  return lines.join('');
}

async function loadTaskHistory() {
  const body = $('#taskBody');
  if (body) body.innerHTML = '<tr><td colspan="8" class="empty-state">加载中...</td></tr>';
  try {
    const res = await apiCall('importTaskManager', { action: 'list', limit: 50 });
    const list = (res && res.list) || [];
    if (!list.length) {
      if (body) body.innerHTML = '<tr><td colspan="8" class="empty-state">暂无上传任务</td></tr>';
      return;
    }
    if (body) {
      body.innerHTML = list.map((t) => `
        <tr>
          <td><code>${escapeHtml(t.taskId)}</code></td>
          <td>${fmtTaskTime(t.createdAt)}</td>
          <td>${escapeHtml(t.account || '-')}</td>
          <td>
            <div class="task-file">
              <div class="task-file-name" title="${escapeHtml(t.fileName || '')}">${escapeHtml(t.fileName || '-')}</div>
              <div class="task-file-size">${fmtFileSize(t.fileSize)}</div>
              ${t.fileUrl ? `<a class="task-file-dl" href="${escapeHtml(t.fileUrl)}" target="_blank" rel="noopener">下载</a>` : '<span class="task-file-dl disabled">暂不可用</span>'}
            </div>
          </td>
          <td>
            <button class="btn btn-sm btn-outline" data-task-param="${escapeHtml(t.taskId)}">查看参数</button>
          </td>
          <td>${fmtTaskTime(t.finishedAt)}</td>
          <td>${statusBadge(t.status)}</td>
          <td>
            <button class="btn btn-sm btn-outline" data-task-log="${escapeHtml(t.taskId)}">查看日志</button>
          </td>
        </tr>
      `).join('');
      body.querySelectorAll('[data-task-log]').forEach((btn) => {
        btn.addEventListener('click', () => showTaskLog(btn.dataset.taskLog));
      });
      body.querySelectorAll('[data-task-param]').forEach((btn) => {
        btn.addEventListener('click', () => showTaskParams(btn.dataset.taskParam));
      });
    }
  } catch (e) {
    if (body) body.innerHTML = `<tr><td colspan="8" class="empty-state">加载失败：${escapeHtml(e.message)}</td></tr>`;
  }
}

async function showTaskLog(taskId) {
  try {
    const res = await apiCall('importTaskManager', { action: 'get', taskId });
    const task = res && res.task;
    if (!task) { showToast('任务不存在', 'error'); return; }
    const logs = (task.logs || []).map((l) => `<div class="log-line">${escapeHtml(l)}</div>`).join('') || '<div class="log-line">无日志</div>';
    const resultText = task.result
      ? `<div class="log-line">结果：${JSON.stringify(task.result)}</div>`
      : '';
    showModal('上传日志 · ' + taskId, `
      <div class="task-log-meta">
        <div>文件：${escapeHtml(task.fileName || '-')}（${fmtFileSize(task.fileSize)}）</div>
        <div>提交时间：${fmtTaskTime(task.createdAt)}　状态：${TASK_STATUS_TEXT[task.status] || task.status}</div>
      </div>
      <div class="task-log-box">${logs}${resultText}</div>
    `, '');
  } catch (e) {
    showToast('加载日志失败: ' + e.message, 'error');
  }
}

async function showTaskParams(taskId) {
  try {
    const res = await apiCall('importTaskManager', { action: 'get', taskId });
    const task = res && res.task;
    if (!task) { showToast('任务不存在', 'error'); return; }
    showModal('上传参数 · ' + taskId, `
      <div class="task-log-meta">
        <div>文件：${escapeHtml(task.fileName || '-')}（${fmtFileSize(task.fileSize)}）</div>
        <div>操作人：${escapeHtml(task.account || '-')}　提交时间：${fmtTaskTime(task.createdAt)}</div>
      </div>
      <div class="task-log-box">${fmtParamsFull(task.params)}</div>
    `, '');
  } catch (e) {
    showToast('加载参数失败: ' + e.message, 'error');
  }
}

function initTaskHistory() {
  if (_taskInited) return;
  _taskInited = true;
  const btn = $('#refreshTaskBtn');
  if (btn) btn.addEventListener('click', loadTaskHistory);
}
