let allAccounts = [];
let filteredAccounts = [];

// 决策理由：每个邮箱 + 操作类型一组的并发锁，防止用户连点导致并发请求/状态错乱
// key 形如 `code:foo@bar.com` `del:foo@bar.com` `copy-email:foo@bar.com`
const inFlight = new Set();

function lockKey(action, email) {
  return `${action}:${email}`;
}

function tryAcquire(action, email) {
  const key = lockKey(action, email);
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

function release(action, email) {
  inFlight.delete(lockKey(action, email));
}

// HTML 转义工具，用于在 innerHTML 中安全插入用户生成内容
// 决策理由：账号邮箱/用户名/密码均来自外部来源（API/IndexedDB），存在 XSS 风险
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 用于 HTML 属性值（更严格，连同空白符和等号编码）
function escapeAttr(value) {
  return escapeHtml(value);
}

// 决策理由：用 CSS.escape 拼装 querySelector 的属性值，避免邮箱里的特殊字符
// （理论上邮箱也可能含 + 等符号）破坏选择器；CSS.escape 是浏览器内置 API。
function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(String(value ?? ''));
  }
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch);
}

function findActionBtn(action, email) {
  return document.querySelector(`.${action}[data-email="${cssEscape(email)}"]`);
}

// 决策理由：所有异步操作的统一“按钮态机”：进入时禁用 + 文案切换 + 锁定，
// 完成/失败时统一恢复，避免到处 if(btn) btn.textContent = '...'，并防止 finally 漏掉。
async function withButtonState(action, email, originalText, busyText, fn) {
  if (!tryAcquire(action, email)) {
    showToast('⚠️ 上一次操作还未完成，请稍候');
    return;
  }
  const btn = findActionBtn(action, email);
  if (btn) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = busyText;
    btn.disabled = true;
    btn.classList.add('is-loading');
  }
  try {
    return await fn();
  } finally {
    release(action, email);
    // 重新查找：因为列表可能已经被重新渲染过，原 btn 引用可能已脱离 DOM
    const fresh = findActionBtn(action, email);
    if (fresh) {
      fresh.textContent = originalText;
      fresh.disabled = false;
      fresh.classList.remove('is-loading');
      delete fresh.dataset.originalText;
    }
  }
}

// 复制成功后给按钮一个短暂的“已复制”视觉反馈（不阻塞下一次点击）
function flashSuccess(btn, successText = '✓ 已复制', duration = 1100) {
  if (!btn) return;
  const original = btn.textContent;
  btn.classList.add('is-success');
  btn.textContent = successText;
  setTimeout(() => {
    btn.classList.remove('is-success');
    // 仅当文案没有被其他逻辑改写时才回写
    if (btn.textContent === successText) btn.textContent = original;
  }, duration);
}

// 统一的剪贴板写入，处理无 https / 焦点丢失等异常
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(String(text ?? ''));
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = String(text ?? '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch {
      return false;
    }
  }
}

// 生成UUID（v4）
function genUUID() {
  let d = new Date().getTime();
  let d2 = (typeof performance !== 'undefined' && performance.now && (performance.now() * 1000)) || 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    let r = Math.random() * 16;
    if (d > 0) {
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else {
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    }
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function ensureSessionForAccount(email) {
  logger?.debug?.('[确保Session] 开始为账号确保 session_id:', email);

  let acc = allAccounts.find(a => a.email === email);

  if (!acc) {
    const res = await dbManager.getAccount(email);
    acc = res && res.data ? res.data : null;
  }

  if (acc && acc.session_id) {
    logger?.debug?.('[确保Session] 账号已有 session_id:', acc.session_id);
    return acc.session_id;
  }

  const sid = genUUID();
  const updated = { ...(acc || { email }), session_id: sid, updated_at: new Date().toISOString() };
  await dbManager.saveAccount(updated);

  const idx = allAccounts.findIndex(a => a.email === email);
  if (idx >= 0) {
    allAccounts[idx] = { ...allAccounts[idx], session_id: sid };
  }

  logger?.debug?.('[确保Session] 生成新 session_id:', sid);
  return sid;
}

async function triggerBackend(email, sessionId) {
  logger?.debug?.('[触发后端] 启动后端监控:', { email, sessionId });
  try {
    const result = await apiClient.startMonitor(email, sessionId);
    if (result?.success) return true;
    logger?.warn?.('[触发后端] API 返回失败:', result?.message);
    return false;
  } catch (error) {
    logger?.error?.('[触发后端] API 调用异常:', error);
    return false;
  }
}

// 调试面板
// 决策理由：单一 console 劫持点，使用 DOM 节点替代 innerHTML 字符串拼接以防 XSS 与提升性能
const debugPanel = {
  logs: [],
  maxLogs: 100,
  _renderScheduled: false,

  init() {
    const showBtn = document.getElementById('show-debug');
    const toggleBtn = document.getElementById('toggle-debug');
    const panel = document.getElementById('debug-panel');

    if (showBtn && panel) {
      showBtn.addEventListener('click', () => {
        panel.style.display = 'block';
        showBtn.style.display = 'none';
      });
    }

    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        if (showBtn) showBtn.style.display = 'block';
      });
    }

    // 复制日志
    const copyBtn = document.getElementById('copy-debug-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyLogs());
    }

    // 清空日志
    const clearBtn = document.getElementById('clear-debug-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.logs = [];
        this.render();
        showToast('✅ 调试日志已清空');
      });
    }

    // 拦截 console（保留原始引用，避免与其他脚本互相覆盖）
    const original = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console)
    };
    this._original = original;

    console.log = (...args) => {
      original.log(...args);
      this.addLog('LOG', args.join(' '));
    };
    console.error = (...args) => {
      original.error(...args);
      this.addLog('ERROR', args.join(' '), '#ef4444');
    };
    console.warn = (...args) => {
      original.warn(...args);
      this.addLog('WARN', args.join(' '), '#f59e0b');
    };
  },

  addLog(level, message, color = '#10b981') {
    const timestamp = new Date().toLocaleTimeString();
    this.logs.push({ timestamp, level, message: String(message), color });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    // 决策理由：合并多次 addLog 在一个动画帧内统一渲染，避免高频日志拖慢主线程
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this.render();
      });
    }
  },

  render() {
    const logsDiv = document.getElementById('debug-logs');
    if (!logsDiv) return;
    const fragment = document.createDocumentFragment();
    for (const log of this.logs) {
      const div = document.createElement('div');
      div.style.color = log.color;
      div.textContent = `[${log.timestamp}] ${log.level}: ${log.message}`;
      fragment.appendChild(div);
    }
    logsDiv.replaceChildren(fragment);
    logsDiv.scrollTop = logsDiv.scrollHeight;
  },

  async copyLogs() {
    const lines = this.logs.map(log => `[${log.timestamp}] ${log.level}: ${log.message}`);
    const debugInfo = [
      '=== Windsurf Helper 调试信息 ===',
      `时间: ${new Date().toLocaleString()}`,
      `API地址: ${typeof API_CONFIG !== 'undefined' ? API_CONFIG.BASE_URL : 'N/A'}`,
      '',
      '=== 配置信息 ===',
      `轮询间隔: ${typeof API_CONFIG !== 'undefined' ? API_CONFIG.POLL_INTERVAL : 'N/A'}ms`,
      `请求超时: ${typeof API_CONFIG !== 'undefined' ? API_CONFIG.TIMEOUT : 'N/A'}ms`,
      '',
      '=== 调试日志 ===',
      ...lines,
      '',
      '=== 系统信息 ===',
      `User Agent: ${navigator.userAgent}`,
      `浏览器: ${navigator.vendor}`
    ].join('\n');

    try {
      await navigator.clipboard.writeText(debugInfo);
      showToast('✅ 调试信息已复制到剪贴板');
    } catch {
      showToast('❌ 复制失败');
    }
  }
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  debugPanel.init();
  await initSupabase();
  setupEventListeners();
  await loadAccounts();
});

// 初始化
async function initSupabase() {
  try {
    // 使用API而非直接Supabase访问
    console.log('✅ API客户端就绪');

    // 初始化 IndexedDB
    await dbManager.init();
    console.log('✅ IndexedDB 就绪');
  } catch (error) {
    console.error('初始化失败:', error);
  }
}

// 设置事件监听
function setupEventListeners() {
  // 返回按钮
  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  // 刷新按钮：进入加载态期间禁用，避免连点重复刷
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.addEventListener('click', async () => {
    if (refreshBtn.disabled) return;
    refreshBtn.disabled = true;
    refreshBtn.classList.add('is-loading');
    try {
      await loadAccounts();
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('is-loading');
    }
  });

  // 搜索：决策理由——每键 input 都重渲整个列表（最多 100 条）虽不致命，
  // 但中文输入法 IME 合成阶段会触发多次 input，加 180ms 防抖手感更顺滑
  let searchTimer = null;
  document.getElementById('search-input').addEventListener('input', (e) => {
    const value = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => filterAccounts(value), 180);
  });

  // 导出CSV
  document.getElementById('export-btn').addEventListener('click', exportToCSV);

  // 清空本地
  document.getElementById('clear-btn').addEventListener('click', clearLocalAccounts);

  // 开始注册按钮
  document.getElementById('start-register-btn').addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  // 账号操作按钮（事件委托）
  document.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-email]');
    if (!target) return;
    const email = target.dataset.email;
    if (!email) return;

    if (target.classList.contains('btn-copy-email')) {
      await copyAccount(email, target);
    } else if (target.classList.contains('btn-copy-password')) {
      await copyPassword(email, target);
    } else if (target.classList.contains('btn-check-code')) {
      await checkVerificationCode(email);
    } else if (target.classList.contains('btn-delete')) {
      await deleteAccount(email);
    } else if (target.classList.contains('view-mailbox-btn')) {
      await viewMailbox(email);
    } else if (target.classList.contains('code-display') && target.classList.contains('has-code')) {
      // 决策理由：点击验证码字段直接复制，省一次点击
      const ok = await copyToClipboard(target.textContent.trim());
      showToast(ok ? '✅ 验证码已复制' : '❌ 复制失败');
    }
  });
}

// 加载账号列表（优先IndexedDB，支持离线）
async function loadAccounts() {
  showLoading(true);

  try {
    // 1. 优先从 IndexedDB 加载（离线支持）
    const dbResult = await dbManager.getAllAccounts({ limit: 100 });
    let localAccounts = [];
    if (dbResult.success && dbResult.data) {
      localAccounts = dbResult.data;
      allAccounts = localAccounts;
      console.log('💾 从 IndexedDB 加载账号:', allAccounts.length);
    }

    // 2. 尝试从云端API加载并合并（在线同步）
    // 决策理由：始终从云端同步最新数据
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.GET_ACCOUNTS}?limit=100`, {
        headers: {
          'X-API-Key': API_CONFIG.API_KEY
        }
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          const supabaseAccounts = result.data;
          console.log('☁️ 从云端加载账号:', supabaseAccounts.length);

          const localMap = new Map((localAccounts || []).map(a => [a.email, a]));
          const merged = supabaseAccounts.map(sa => {
            const la = localMap.get(sa.email);
            return la ? {
              ...sa,
              session_id: la.session_id || sa.session_id,
              password: sa.password || la.password,
              username: sa.username || la.username,
              verification_code: sa.verification_code || la.verification_code
            } : sa;
          });
          const supaEmails = new Set(supabaseAccounts.map(sa => sa.email));
          const missingLocals = (localAccounts || []).filter(a => !supaEmails.has(a.email));
          allAccounts = merged.concat(missingLocals);

          dbManager.saveAccountsBatch(allAccounts);
        }
      }
    } catch (cloudError) {
      console.warn('⚠️ 云端加载失败，使用本地数据:', cloudError);
    }

    filteredAccounts = [...allAccounts];
    renderAccounts();
    updateStats();
    showLoading(false);
  } catch (error) {
    console.error('加载账号失败:', error);
    showLoading(false);
  }
}

// 渲染账号列表
function renderAccounts() {
  const listElement = document.getElementById('accounts-list');
  const emptyState = document.getElementById('empty-state');
  const emptyMessage = emptyState.querySelector('p');
  const startBtn = document.getElementById('start-register-btn');

  if (filteredAccounts.length === 0) {
    listElement.innerHTML = '';
    emptyState.classList.remove('hidden');
    // 决策理由：当总账号数 > 0 但筛选无结果时，应该提示“未找到匹配”而不是“暂无账号”
    if (allAccounts.length > 0) {
      if (emptyMessage) emptyMessage.textContent = '未找到匹配的账号';
      if (startBtn) startBtn.classList.add('hidden');
    } else {
      if (emptyMessage) emptyMessage.textContent = '暂无账号记录';
      if (startBtn) startBtn.classList.remove('hidden');
    }
    return;
  }

  emptyState.classList.add('hidden');

  // 决策理由：根据真实状态和验证码情况显示准确信息
  // 所有用户输入字段使用 escapeHtml/escapeAttr 转义，防止 XSS
  // 按钮使用统一的 .btn-small + 变体（btn-success/btn-info/btn-danger），
  // 不再混用 .btn .btn-sm（后者会触发 .btn 的 flex:1+ellipsis 导致文字截断）。
  listElement.innerHTML = filteredAccounts.map(account => {
    const hasCode = account.verification_code && account.verification_code !== '等待中...';
    const actualStatus = hasCode ? 'verified' : (account.status || 'pending');
    const sidShort = (account.session_id || '').slice(0, 8);
    const safeEmail = escapeAttr(account.email);
    const codeId = 'code-' + (account.email || '').replace(/[^a-zA-Z0-9]/g, '-');
    const codeText = account.verification_code || '等待中...';
    const codeClass = hasCode ? 'code-display has-code' : 'code-display';
    const codeTitle = hasCode ? '点击复制验证码' : '尚未获取到验证码';

    return `
    <div class="account-card" data-email="${safeEmail}">
      <div class="account-header">
        <div class="account-email">${escapeHtml(account.email)}</div>
        <span class="status-badge status-${actualStatus}">
          ${getStatusText(actualStatus)}
        </span>
      </div>
      <div class="account-details">
        <span class="account-label">密码:</span>
        <span>${escapeHtml(account.password || 'N/A')}</span>
        <span class="account-label">用户名:</span>
        <span>${escapeHtml(account.username || 'N/A')}</span>
        <span class="account-label">会话:</span>
        <span>${escapeHtml(sidShort || 'N/A')}</span>
        <span class="account-label">验证码:</span>
        <span id="${escapeAttr(codeId)}" class="${codeClass}" data-email="${safeEmail}" title="${escapeAttr(codeTitle)}">${escapeHtml(codeText)}</span>
        <span class="account-label">创建时间:</span>
        <span>${escapeHtml(formatDate(account.created_at))}</span>
      </div>
      <div class="account-actions">
        <button class="btn-small btn-success btn-check-code" data-email="${safeEmail}" title="从邮箱获取最新验证码">查询验证码</button>
        <button class="btn-small btn-copy-email" data-email="${safeEmail}" title="复制邮箱地址">复制邮箱</button>
        <button class="btn-small btn-copy-password" data-email="${safeEmail}" title="复制密码">复制密码</button>
        <button class="btn-small btn-info view-mailbox-btn" data-email="${safeEmail}" title="查看该邮箱收件">查看邮箱</button>
        <button class="btn-small btn-danger btn-delete" data-email="${safeEmail}" title="彻底删除该账号">删除</button>
      </div>
    </div>
  `}).join('');
}

// 获取状态文本
function getStatusText(status) {
  const statusMap = {
    'verified': '✅ 已验证',
    'pending': '⏳ 待验证',
    'failed': '❌ 失败'
  };
  return statusMap[status] || '⏳ 待验证';
}

// 格式化日期
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 更新统计信息
function updateStats() {
  const total = allAccounts.length;

  // 决策理由：基于真实状态和验证码情况统计，确保准确性
  const verified = allAccounts.filter(a => {
    const hasCode = a.verification_code && a.verification_code !== '等待中...';
    return a.status === 'verified' || hasCode;
  }).length;

  const pending = total - verified;

  document.getElementById('total-count').textContent = total;
  document.getElementById('verified-count').textContent = verified;
  document.getElementById('pending-count').textContent = pending;
}

// 过滤账号
function filterAccounts(query) {
  const lowerQuery = query.toLowerCase().trim();

  if (!lowerQuery) {
    filteredAccounts = [...allAccounts];
  } else {
    filteredAccounts = allAccounts.filter(account =>
      account.email?.toLowerCase().includes(lowerQuery) ||
      account.username?.toLowerCase().includes(lowerQuery)
    );
  }

  renderAccounts();
}

// 复制账号邮箱
async function copyAccount(email, btn) {
  const account = allAccounts.find(a => a.email === email);
  if (!account) {
    showToast('❌ 未找到账号');
    return;
  }
  const ok = await copyToClipboard(account.email);
  if (ok) {
    flashSuccess(btn);
    showToast('✅ 邮箱已复制');
  } else {
    showToast('❌ 复制失败');
  }
}

// 复制密码
async function copyPassword(email, btn) {
  const account = allAccounts.find(a => a.email === email);
  if (!account || !account.password) {
    showToast('⚠️ 该账号没有密码');
    return;
  }
  const ok = await copyToClipboard(account.password);
  if (ok) {
    flashSuccess(btn);
    showToast('✅ 密码已复制');
  } else {
    showToast('❌ 复制失败');
  }
}

// 查看邮箱
async function viewMailbox(email) {
  const account = allAccounts.find(a => a.email === email);
  if (!account) {
    await ui.alert('未找到账号信息', { title: '❌ 错误' });
    return;
  }

  // 检查是否为临时邮箱模式
  if (typeof EMAIL_CONFIG === 'undefined' || EMAIL_CONFIG.mode !== 'temp-mail') {
    await ui.alert('此功能仅适用于临时邮箱模式', { title: '⚠️ 提示' });
    return;
  }

  if (!account.tempMailToken) {
    await ui.alert('此账号缺少邮箱令牌，无法查看邮箱', { title: '❌ 错误' });
    return;
  }

  await withButtonState('view-mailbox-btn', email, '查看邮箱', '加载中...', async () => {
    try {
      const tempMailClient = new TempMailClient(EMAIL_CONFIG.tempMail);
      tempMailClient.currentEmail = account.email;
      tempMailClient.currentToken = account.tempMailToken;

      logger?.debug?.('[查看邮箱] 获取邮件列表...');
      const mails = await tempMailClient.checkMails();
      logger?.debug?.(`[查看邮箱] 收到 ${mails.length} 封邮件`);

      if (mails.length === 0) {
        await ui.alert(`邮箱地址: ${account.email}\n没有收到任何邮件`, { title: '📤 邮箱为空' });
        return;
      }

      // 显示邮件列表
      let mailInfo = `📧 邮箱: ${account.email}\n收到 ${mails.length} 封邮件:\n\n`;
      for (let i = 0; i < mails.length; i++) {
        const mail = mails[i];
        const from = mail.from || mail.mail_from || '未知';
        const subject = mail.subject || mail.mail_subject || '无主题';
        const date = mail.date || mail.mail_date || mail.mail_timestamp || '未知时间';
        mailInfo += `${i + 1}. 发件人: ${from}\n   主题: ${subject}\n   时间: ${date}\n\n`;
      }
      await ui.alert(mailInfo, { title: '📧 邮件列表' });
    } catch (error) {
      logger?.error?.('[查看邮箱] 失败:', error);
      await ui.alert(error?.message || String(error), { title: '❌ 查看邮箱失败' });
    }
  });
}

// 查询验证码
// 决策理由：把对 codeElement 的颜色控制全部交给 CSS class（.code-display.has-code 等），
// 避免每处都 codeElement.style.color，并且写按钮态全部走 withButtonState 统一收口。
function setCodeDisplay(email, text, state) {
  const codeId = 'code-' + (email || '').replace(/[^a-zA-Z0-9]/g, '-');
  const el = document.getElementById(codeId);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('has-code', 'is-querying', 'is-warn', 'is-error');
  if (state) el.classList.add(state);
  // 已不再依赖 inline style，确保不残留旧的颜色
  el.style.color = '';
}

async function checkVerificationCode(email) {
  await withButtonState('btn-check-code', email, '查询验证码', '获取中...', async () => {
    setCodeDisplay(email, '查询中...', 'is-querying');

    // ===== 临时邮箱模式 =====
    if (typeof EMAIL_CONFIG !== 'undefined' && EMAIL_CONFIG.mode === 'temp-mail') {
      const account = allAccounts.find(a => a.email === email);
      if (!account || !account.tempMailToken) {
        setCodeDisplay(email, '缺少邮箱令牌', 'is-error');
        await ui.alert('此账号缺少临时邮箱令牌，无法查询验证码。\n请重新注册账号。', { title: '⚠️ 提示' });
        return;
      }
      try {
        const tempMailClient = new TempMailClient(EMAIL_CONFIG.tempMail);
        tempMailClient.currentEmail = account.email;
        tempMailClient.currentToken = account.tempMailToken;
        const result = await tempMailClient.waitForVerificationCode();
        if (result.success && result.code) {
          await applyVerificationCode(email, result.code, /*sessionId*/ null);
        } else {
          setCodeDisplay(email, '未收到验证码', 'is-warn');
          showToast('⚠️ 暂未收到验证码');
        }
      } catch (error) {
        logger?.error?.('[查询验证码] 临时邮箱API异常:', error);
        setCodeDisplay(email, '查询失败', 'is-error');
        showToast('❌ 查询失败: ' + (error?.message || error));
      }
      return;
    }

    // ===== 后端 / 云函数模式 =====
    let sessionId;
    try {
      sessionId = await ensureSessionForAccount(email);
    } catch (e) {
      setCodeDisplay(email, '会话准备失败', 'is-error');
      showToast('❌ 会话准备失败');
      return;
    }

    let backendStarted = false;
    try {
      backendStarted = await triggerBackend(email, sessionId);
    } catch (_) { /* 走下面的失败分支 */ }

    if (!backendStarted) {
      setCodeDisplay(email, '后端未启动', 'is-warn');
      showToast('⚠️ 后端监控未启动，请检查 backend 服务');
      return;
    }

    // 轮询：每 2s 一次，最多 60s
    const startTs = Date.now();
    const timeoutMs = 60000;
    let found = null;
    let attempts = 0;

    while (Date.now() - startTs < timeoutMs) {
      // 决策理由：用户离开页面/账号被删时主动停止轮询，避免无效请求和锁不释放
      if (document.hidden) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      if (!allAccounts.find(a => a.email === email)) {
        logger?.warn?.('[查询验证码] 账号已被删除，提前结束');
        return;
      }
      attempts++;
      const elapsed = Math.round((Date.now() - startTs) / 1000);
      setCodeDisplay(email, `查询中(${elapsed}s)...`, 'is-querying');

      try {
        const apiUrl = `${API_CONFIG.BASE_URL}/api/check-code/${encodeURIComponent(sessionId)}`;
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_CONFIG.API_KEY,
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache'
          }
        });
        if (response.ok) {
          const data = await response.json();
          if (data && data.success && data.code) {
            found = data.code;
            break;
          }
        } else {
          logger?.warn?.('[查询验证码] API状态码非 OK:', response.status);
        }
      } catch (fetchError) {
        logger?.warn?.('[查询验证码] API请求异常:', fetchError);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (found) {
      await applyVerificationCode(email, found, sessionId);
    } else {
      setCodeDisplay(email, '未找到', 'is-warn');
      showToast('⚠️ 暂无验证码（已尝试 ' + attempts + ' 次）');
    }
  });
}

// 决策理由：抽出公共“写入验证码 + 同步存储 + 复制”逻辑，避免在两个分支重复
async function applyVerificationCode(email, code, sessionId) {
  setCodeDisplay(email, code, 'has-code');

  const account = allAccounts.find(a => a.email === email);
  if (account) {
    account.verification_code = code;
    account.status = 'verified';
    if (sessionId) account.session_id = sessionId;

    try {
      await dbManager.saveAccount(account);
    } catch (e) {
      logger?.warn?.('[查询验证码] 本地保存失败:', e);
    }

    // 云端同步（失败不影响本地体验）
    try {
      if (typeof API_CONFIG !== 'undefined' && API_CONFIG?.ENDPOINTS?.UPDATE_ACCOUNT) {
        await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.UPDATE_ACCOUNT}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_CONFIG.API_KEY
          },
          body: JSON.stringify({ email, verification_code: code, status: 'verified' })
        });
      }
    } catch (cloudError) {
      logger?.warn?.('⚠️ 云端同步失败:', cloudError);
    }
  }

  // 重渲染以刷新状态徽章
  renderAccounts();
  updateStats();

  const ok = await copyToClipboard(code);
  showToast(ok ? `✅ 验证码: ${code} 已复制` : `✅ 已获取验证码: ${code}`);
}

// 删除账号
async function deleteAccount(email) {
  const ok = await ui.confirm(`确定要删除账号 ${email} 吗？`, {
    title: '删除账号',
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  await withButtonState('btn-delete', email, '删除', '删除中...', async () => {
    let cloudOk = false;
    let localOk = false;

    // 1. 云端删除（失败也继续清本地，避免本地一直残留无效记录）
    try {
      if (typeof API_CONFIG !== 'undefined' && API_CONFIG?.ENDPOINTS?.DELETE_ACCOUNT) {
        const response = await fetch(
          `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.DELETE_ACCOUNT}?email=${encodeURIComponent(email)}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': API_CONFIG.API_KEY
            }
          }
        );
        cloudOk = response.ok;
      }
    } catch (cloudError) {
      logger?.warn?.('⚠️ 云端删除失败:', cloudError);
    }

    // 2. IndexedDB
    try {
      const dbResult = await dbManager.deleteAccount(email);
      localOk = !!(dbResult && dbResult.success !== false);
    } catch (e) {
      logger?.warn?.('IndexedDB 删除失败:', e);
    }

    // 3. Chrome Storage（兼容旧数据）
    try {
      await new Promise((resolve) => {
        chrome.storage.local.get(['accounts'], (result) => {
          const accounts = result.accounts || [];
          const updatedAccounts = accounts.filter(a => a.email !== email);
          chrome.storage.local.set({ accounts: updatedAccounts }, resolve);
        });
      });
    } catch (e) {
      logger?.warn?.('Chrome Storage 删除失败:', e);
    }

    // 4. 内存
    allAccounts = allAccounts.filter(a => a.email !== email);
    filteredAccounts = filteredAccounts.filter(a => a.email !== email);

    renderAccounts();
    updateStats();

    if (cloudOk || localOk) {
      showToast('✅ 账号已删除');
    } else {
      showToast('⚠️ 仅从内存中移除，存储删除可能未生效');
    }
  });
}

// 导出为CSV
function exportToCSV() {
  if (allAccounts.length === 0) {
    showToast('⚠️ 暂无数据可导出');
    return;
  }

  // 决策理由：CSV 字段中如果包含引号、逗号或换行需要按 RFC 4180 转义，
  // 这里把双引号变成两个双引号，避免导出后字段错位
  const csvCell = (v) => {
    const s = String(v ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  };

  const headers = ['邮箱', '密码', '用户名', '状态', '验证码', '创建时间'];
  const rows = allAccounts.map(account => [
    account.email || '',
    account.password || '',
    account.username || '',
    getStatusText(account.status),
    account.verification_code && account.verification_code !== '等待中...' ? account.verification_code : '',
    formatDate(account.created_at)
  ]);

  const csvContent = [
    headers.map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(','))
  ].join('\r\n');

  // 下载文件
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  // 决策理由：用 ISO 时间戳替代毫秒数，文件名更可读
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  link.download = `windsurf_accounts_${ts}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showToast(`✅ 已导出 ${allAccounts.length} 条记录`);
}

// 清空本地账号
async function clearLocalAccounts() {
  if (allAccounts.length === 0) {
    showToast('⚠️ 当前没有账号可清空');
    return;
  }
  const ok = await ui.confirm(`确定要清空全部 ${allAccounts.length} 条本地账号记录吗？此操作不可恢复！`, {
    title: '清空所有账号',
    confirmText: '清空',
    danger: true
  });
  if (!ok) return;

  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) {
    clearBtn.disabled = true;
    clearBtn.dataset.originalText = clearBtn.textContent;
    clearBtn.textContent = '清空中...';
  }

  try {
    await dbManager.clearAllAccounts();
    await new Promise((resolve) => {
      chrome.storage.local.set({ accounts: [] }, resolve);
    });
    allAccounts = [];
    filteredAccounts = [];
    renderAccounts();
    updateStats();
    showToast('✅ 所有账号已清空');
  } catch (error) {
    logger?.error?.('清空失败:', error);
    showToast('❌ 清空失败: ' + (error?.message || error));
  } finally {
    if (clearBtn) {
      clearBtn.disabled = false;
      clearBtn.textContent = clearBtn.dataset.originalText || '清空本地';
      delete clearBtn.dataset.originalText;
    }
  }
}

// 显示加载状态
function showLoading(show) {
  const loading = document.getElementById('loading');
  const accountsList = document.getElementById('accounts-list');

  if (show) {
    loading.classList.remove('hidden');
    accountsList.classList.add('hidden');
  } else {
    loading.classList.add('hidden');
    accountsList.classList.remove('hidden');
  }
}

// 显示提示消息
// 决策理由：统一走 ui.toast，根据 emoji 前缀自动选择 type，保持调用点向后兼容
function showToast(message) {
  const m = String(message);
  let type = 'info';
  if (m.startsWith('✅') || m.startsWith('🎉')) type = 'success';
  else if (m.startsWith('⚠️') || m.startsWith('⚠')) type = 'warning';
  else if (m.startsWith('❌') || m.startsWith('🚫')) type = 'error';
  ui.toast(m, type);
}

// 决策理由：调试功能已统一由文件顶部的 debugPanel 对象管理（单一 console 劫持点 + DOM 安全渲染）
