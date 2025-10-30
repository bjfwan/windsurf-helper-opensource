let currentStats = null;
document.addEventListener('DOMContentLoaded', async () => {
  await analytics.init();
  await loadStats();
  setupEventListeners();
});
async function loadStats() {
  try {
    const summary = await analytics.getStatsSummary();
    const weeklyStats = await analytics.getWeeklyStats();
    
    currentStats = {
      summary,
      weeklyStats
    };
    updateSummaryCards(summary);
    updateWeeklyChart(weeklyStats);
    updateFailureReasons(summary.topFailureReasons);
    updateSessionList(summary.recentSessions);
    updateLastUpdated();
    
    console.log('[Stats] 统计数据已加载', summary);
  } catch (error) {
    console.error('[Stats] 加载统计失败:', error);
    showError('加载统计数据失败');
  }
}
function updateSummaryCards(summary) {
  document.getElementById('total-attempts').textContent = summary.totalAttempts;
  document.getElementById('success-count').textContent = summary.successCount;
  document.getElementById('success-rate').textContent = summary.successRate + '%';
  document.getElementById('avg-time').textContent = summary.averageTime + 's';
}
function updateWeeklyChart(weeklyStats) {
  const chartContainer = document.getElementById('weekly-chart');
  chartContainer.innerHTML = '';
  
  if (!weeklyStats || weeklyStats.length === 0) {
    chartContainer.innerHTML = '<div class="no-data"><div class="icon">📊</div><p>暂无数据</p></div>';
    return;
  }
  const maxValue = Math.max(...weeklyStats.map(d => d.attempts)) || 1;
  
  weeklyStats.forEach(day => {
    const dayBar = document.createElement('div');
    dayBar.className = 'day-bar';
    
    const barContainer = document.createElement('div');
    barContainer.className = 'bar-container';
    if (day.success > 0) {
      const successBar = document.createElement('div');
      successBar.className = 'bar';
      const successHeight = (day.success / maxValue) * 100;
      successBar.style.height = successHeight + '%';
      successBar.title = `成功: ${day.success}`;
      barContainer.appendChild(successBar);
    }
    if (day.failed > 0) {
      const failedBar = document.createElement('div');
      failedBar.className = 'bar failed';
      const failedHeight = (day.failed / maxValue) * 100;
      failedBar.style.height = failedHeight + '%';
      failedBar.title = `失败: ${day.failed}`;
      barContainer.appendChild(failedBar);
    }
    if (day.attempts === 0) {
      const emptyBar = document.createElement('div');
      emptyBar.className = 'bar';
      emptyBar.style.height = '5%';
      emptyBar.style.opacity = '0.2';
      barContainer.appendChild(emptyBar);
    }
    
    const dayLabel = document.createElement('div');
    dayLabel.className = 'day-label';
    const date = new Date(day.date);
    dayLabel.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
    
    dayBar.appendChild(barContainer);
    dayBar.appendChild(dayLabel);
    chartContainer.appendChild(dayBar);
  });
}
function updateFailureReasons(reasons) {
  const container = document.getElementById('failure-reasons');
  const section = document.getElementById('failure-section');
  
  if (!reasons || reasons.length === 0) {
    section.style.display = 'none';
    return;
  }
  
  section.style.display = 'block';
  container.innerHTML = '';
  
  const maxCount = Math.max(...reasons.map(r => r.count)) || 1;
  
  reasons.forEach(reason => {
    const item = document.createElement('div');
    item.className = 'reason-item';
    
    const label = document.createElement('div');
    label.className = 'reason-label';
    label.textContent = reason.reason;
    
    const bar = document.createElement('div');
    bar.className = 'reason-bar';
    
    const fill = document.createElement('div');
    fill.className = 'reason-bar-fill';
    fill.style.width = '0%'; // 初始为0，后面动画
    
    setTimeout(() => {
      fill.style.width = (reason.count / maxCount * 100) + '%';
    }, 100);
    
    bar.appendChild(fill);
    
    const count = document.createElement('div');
    count.className = 'reason-count';
    count.textContent = reason.count;
    
    item.appendChild(label);
    item.appendChild(bar);
    item.appendChild(count);
    container.appendChild(item);
  });
}
function updateSessionList(sessions) {
  const container = document.getElementById('session-list');
  
  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<div class="no-data"><div class="icon">📝</div><p>暂无会话记录</p></div>';
    return;
  }
  
  container.innerHTML = '';
  
  sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item';
    
    const header = document.createElement('div');
    header.className = 'session-header';
    
    const email = document.createElement('div');
    email.className = 'session-email';
    email.textContent = session.email || '未知邮箱';
    
    const status = document.createElement('div');
    status.className = `session-status ${session.status}`;
    status.textContent = session.status === 'success' ? '成功' : '失败';
    
    header.appendChild(email);
    header.appendChild(status);
    
    const timeInfo = document.createElement('div');
    timeInfo.className = 'session-time';
    const startTime = new Date(session.startTime);
    const duration = Math.round(session.totalDuration / 1000);
    timeInfo.textContent = `${formatTime(startTime)} · 耗时 ${duration}s`;
    
    item.appendChild(header);
    item.appendChild(timeInfo);
    container.appendChild(item);
  });
}
function updateLastUpdated() {
  const elem = document.getElementById('last-updated');
  const now = new Date();
  elem.textContent = `最后更新: ${formatTime(now)}`;
}
function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}:${seconds}`;
}
function setupEventListeners() {
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    await loadStats();
    showSuccess('数据已刷新');
  });
  document.getElementById('export-btn').addEventListener('click', async () => {
    try {
      const data = await analytics.exportStats();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `windsurf-stats-${Date.now()}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      showSuccess('数据已导出');
    } catch (error) {
      console.error('[Stats] 导出失败:', error);
      showError('导出失败');
    }
  });
  document.getElementById('reset-btn').addEventListener('click', async () => {
    if (confirm('确定要重置所有统计数据吗？此操作不可恢复！')) {
      try {
        await analytics.resetAllStats();
        await loadStats();
        showSuccess('统计数据已重置');
      } catch (error) {
        console.error('[Stats] 重置失败:', error);
        showError('重置失败');
      }
    }
  });
}
function showSuccess(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: var(--success-color);
    color: white;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  toast.textContent = '✅ ' + message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
function showError(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: var(--danger-color);
    color: white;
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  toast.textContent = '❌ ' + message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
