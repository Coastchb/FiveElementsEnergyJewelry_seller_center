/* ========== 上传历史 ========== */
let _taskInited = false;
let _taskPollTimer = null;

const TASK_STATUS_TEXT = {
  pending: '处理中',
  uploading: '上传中',
  running: '解析/写入中',
  success: '成功',
  failed: '失败',
};

const TASK_TYPE_TEXT = {
  product: '成品',
  material: '配饰',
};

// 根据后端状态和 result 汇总，返回更友好的状态文本
function resolveTaskStatusText(task) {
  const status = task && task.status;
  const result = task && task.result;
  const total = result && typeof result.total === 'number' ? result.total : 0;
  const successCount = result && typeof result.success === 'number' ? result.success : 0;
  const failCount = result && typeof result.failCount === 'number'
    ? result.failCount
    : (Array.isArray(result && result.failList) ? result.failList.length : 0);

  if (status === 'success' || status === 'failed') {
    if (total > 0 && successCount === total) return '全部成功';
    if (total > 0 && successCount === 0) return '全部失败';
    if (total > 0 && successCount > 0 && successCount < total) return '部分成功';
  }
  return TASK_STATUS_TEXT[status] || status || '未知';
}

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

function statusBadge(task) {
  const status = task && task.status;
  const cls = 'task-status task-status-' + (status || 'pending');
  const text = resolveTaskStatusText(task);
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

function startTaskPolling() {
  if (_taskPollTimer) return;
  _taskPollTimer = setInterval(() => {
    loadTaskHistory();
  }, 600000); // 10 分钟自动刷新一次
}

function stopTaskPolling() {
  if (_taskPollTimer) {
    clearInterval(_taskPollTimer);
    _taskPollTimer = null;
  }
}

async function loadTaskHistory() {
  const body = $('#taskBody');
  if (body) body.innerHTML = '<tr><td colspan="9" class="empty-state">加载中...</td></tr>';
  try {
    const res = await apiCall('importTaskManager', { action: 'list', limit: 50 });
    const list = (res && res.list) || [];
    if (!list.length) {
      if (body) body.innerHTML = '<tr><td colspan="9" class="empty-state">暂无上传任务</td></tr>';
      stopTaskPolling();
      return;
    }
    if (body) {
      body.innerHTML = list.map((t) => `
        <tr>
          <td><code>${escapeHtml(t.taskId)}</code></td>
          <td>${fmtTaskTime(t.createdAt)}</td>
          <td>${escapeHtml(t.account || '-')}</td>
          <td>${TASK_TYPE_TEXT[t.type] || (t.type === 'product' ? '成品' : '配饰')}</td>
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
          <td>${statusBadge(t)}</td>
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
    // 若存在处理中的任务，自动轮询刷新；否则停止轮询
    const hasRunning = list.some((t) => t.status === 'pending' || t.status === 'running' || t.status === 'uploading');
    if (hasRunning) startTaskPolling();
    else stopTaskPolling();
  } catch (e) {
    if (body) body.innerHTML = `<tr><td colspan="9" class="empty-state">加载失败：${escapeHtml(e.message)}</td></tr>`;
    stopTaskPolling();
  }
}

async function showTaskLog(taskId) {
  try {
    const res = await apiCall('importTaskManager', { action: 'get', taskId });
    const task = res && res.task;
    if (!task) { showToast('任务不存在', 'error'); return; }
    const logs = (task.logs || []).map((l) => `<div class="log-line">${escapeHtml(l)}</div>`).join('') || '<div class="log-line">无日志</div>';
    let resultText = '';
    if (task.result) {
      const failList = Array.isArray(task.result.failList) ? task.result.failList : [];
      const failHtml = failList.length
        ? `<div style="margin-top:8px;color:#C0392B;"><strong>失败明细：</strong></div>` +
          failList.map((x) => `<div class="log-line" style="color:#C0392B;">第 ${x.row} 行：${escapeHtml(x.reason)}</div>`).join('')
        : '';
      const errText = task.result.error ? `<div class="log-line" style="color:#C0392B;">错误：${escapeHtml(task.result.error)}</div>` : '';
      const summary = `<div class="log-line">汇总：总计 ${task.result.total || 0}，成功 ${task.result.success || 0}，失败 ${task.result.failCount || failList.length} 条</div>`;
      resultText = `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);">${summary}${errText}${failHtml}</div>`;
    }
    showModal('上传日志 · ' + taskId, `
      <div class="task-log-meta">
        <div>文件：${escapeHtml(task.fileName || '-')}（${fmtFileSize(task.fileSize)}）</div>
        <div>提交时间：${fmtTaskTime(task.createdAt)}　状态：${resolveTaskStatusText(task)}</div>
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
