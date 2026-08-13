/* ========== 上传历史 ========== */
let _taskInited = false;
let _taskPollTimer = null;

const TASK_STATUS_TEXT = {
  pending: '处理中',
  uploading: '上传中',
  running: '解析/写入中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

const TASK_TYPE_TEXT = {
  product: '成品',
  material: '配饰',
  image: '图片',
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

function splitTaskTime(ts) {
  const text = fmtTaskTime(ts);
  if (text === '-') return ['', ''];
  const [date, time] = text.split(' ');
  return [date, time];
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
  const text = resolveTaskStatusText(task);
  // 部分成功也按失败级别标红，和全部失败保持一致
  const clsSuffix = (status === 'success' && text === '部分成功') ? 'failed' : (status || 'pending');
  const cls = 'task-status task-status-' + clsSuffix;
  return `<span class="${cls}">${text}</span>`;
}

function fmtParams(params) {
  if (!params || typeof params !== 'object') return '-';
  // 列表中只显示最关键的几项，避免参数过多把表格撑宽；完整参数点击“查看参数”弹窗
  const priority = ['type', 'maxCount', 'thicknessMm', 'colPrice', 'colCost'];
  const parts = [];
  for (const k of priority) {
    if (params[k] !== '' && params[k] != null) {
      parts.push(`${escapeHtml(k)}: ${escapeHtml(String(params[k]))}`);
    }
  }
  let text = parts.length ? parts.join(' / ') : `已配置 ${Object.keys(params).filter((k) => params[k] !== '' && params[k] != null).length} 项`;
  if (text.length > 55) text = text.slice(0, 55) + '…';
  return text;
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
      body.innerHTML = list.map((t) => {
        const canTerminate = t.status === 'pending' || t.status === 'running' || t.status === 'uploading';
        const [createDate, createTime] = splitTaskTime(t.createdAt);
        const [finishDate, finishTime] = splitTaskTime(t.finishedAt);
        return `
        <tr>
          <td class="task-id-cell"><code>${escapeHtml(t.taskId)}</code></td>
          <td class="task-time-cell"><div class="task-date">${createDate}</div><div class="task-clock">${createTime}</div></td>
          <td>${escapeHtml(t.account || '-')}</td>
          <td>${TASK_TYPE_TEXT[t.type] || (t.type === 'product' ? '成品' : '配饰')}</td>
          <td class="task-params-cell">
            <button class="btn btn-sm btn-outline" data-task-param="${escapeHtml(t.taskId)}">查看参数</button>
          </td>
          <td class="task-time-cell">${finishDate ? `<div class="task-date">${finishDate}</div><div class="task-clock">${finishTime}</div>` : '-'}</td>
          <td>${statusBadge(t)}</td>
          <td class="task-ops">
            ${canTerminate ? `<button class="btn btn-sm btn-danger" data-task-terminate="${escapeHtml(t.taskId)}" data-task-type="${escapeHtml(t.type || '')}">终止任务</button>` : ''}
          </td>
          <td>
            <button class="btn btn-sm btn-outline" data-task-log="${escapeHtml(t.taskId)}">查看日志</button>
          </td>
        </tr>
      `;
      }).join('');
      body.querySelectorAll('[data-task-log]').forEach((btn) => {
        btn.addEventListener('click', () => showTaskLog(btn.dataset.taskLog));
      });
      body.querySelectorAll('[data-task-param]').forEach((btn) => {
        btn.addEventListener('click', () => showTaskParams(btn.dataset.taskParam));
      });
      body.querySelectorAll('[data-task-terminate]').forEach((btn) => {
        btn.addEventListener('click', () => terminateHistoryTask(btn.dataset.taskTerminate, btn.dataset.taskType));
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

async function terminateHistoryTask(taskId, type) {
  if (!taskId) return;
  if (!confirm('确定要终止该任务吗？\n图片类任务会立即中断当前会话的上传；其他任务会被标记为“已取消”，后台是否立即停下取决于执行逻辑。')) return;

  // 图片上传任务：若当前浏览器会话仍在运行，先 abort 前端 fetch/controller
  if (type === 'image') {
    const t = _uploadTasks && _uploadTasks.get(taskId);
    if (t && t.controller && t.status !== 'cancelled') {
      t.controller.abort();
    }
  }

  try {
    await apiCall('importTaskManager', {
      action: 'update',
      taskId,
      status: 'cancelled',
      finishedAt: Date.now(),
      log: type === 'image' ? '用户在上传历史页终止图片上传任务' : '用户在上传历史页标记取消任务',
    });
    showToast('已终止任务', 'success');
  } catch (e) {
    showToast('终止任务失败：' + e.message, 'error');
  }
  loadTaskHistory();
}

async function showTaskLog(taskId) {
  try {
    const res = await apiCall('importTaskManager', { action: 'get', taskId });
    const task = res && res.task;
    if (!task) { showToast('任务不存在', 'error'); return; }
    const logs = (task.logs || []).map((l) => `<div class="log-line">${escapeHtml(l)}</div>`).join('') || '<div class="log-line">无日志</div>';
    let resultText = '';
    // 仅任务已结束时展示汇总，避免运行中的空 result 误导用户以为已结束
    const isFinished = ['success', 'failed', 'cancelled'].includes(task.status);
    if (isFinished && task.result) {
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
