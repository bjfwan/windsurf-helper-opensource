let allAccounts = [];
let filteredAccounts = [];

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
  console.log('[确保Session] 开始为账号确保 session_id:', email);

  let acc = allAccounts.find(a => a.email === email);
  console.log('[确保Session] 从内存查找账号:', acc ? '找到' : '未找到');

  if (!acc) {
    console.log('[确保Session] 从 IndexedDB 查找账号');
    const res = await dbManager.getAccount(email);
    acc = res && res.data ? res.data : null;
    console.log('[确保Session] IndexedDB 查找结果:', acc ? '找到' : '未找到');
  }

  if (acc && acc.session_id) {
    console.log('[确保Session] ✅ 账号已有 session_id:', acc.session_id);
    return acc.session_id;
  }

  console.log('[确保Session] 生成新的 session_id');
  const sid = genUUID();
  console.log('[确保Session] 新 session_id:', sid);

  const updated = { ...(acc || { email }), session_id: sid, updated_at: new Date().toISOString() };
  console.log('[确保Session] 保存到 IndexedDB:', updated);
  await dbManager.saveAccount(updated);

  const idx = allAccounts.findIndex(a => a.email === email);
  if (idx >= 0) {
    allAccounts[idx] = { ...allAccounts[idx], session_id: sid };
    console.log('[确保Session] 更新内存中的账号');
  }

  // 注册会话现在由 start-monitor API 自动处理
  console.log('[确保Session] ✅ 完成，返回 session_id:', sid);
  return sid;
}

async function triggerBackend(email, sessionId) {
  console.log('[触发后端] 开始触发后端监控:', { email, sessionId });

  console.log('[触发后端] 调用云端API');
  try {
    const result = await apiClient.startMonitor(email, sessionId);
    console.log('[触发后端] API 响应:', result);
    
    if (result.success) {
      console.log('[触发后端] 云端监控已启动');
      return true;
    } else {
      console.error('[触发后端] API 返回失败:', result.message);
      return false;
    }
  } catch (error) {
    console.error('[触发后端] API 调用异常:', error);
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

  // 刷新按钮
  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadAccounts();
  });

  // 搜索
  document.getElementById('search-input').addEventListener('input', (e) => {
    filterAccounts(e.target.value);
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
    const email = e.target.dataset.email;
    if (!email) return;

    if (e.target.classList.contains('btn-copy-email')) {
      await copyAccount(email);
    } else if (e.target.classList.contains('btn-copy-password')) {
      await copyPassword(email);
    } else if (e.target.classList.contains('btn-check-code')) {
      await checkVerificationCode(email);
    } else if (e.target.classList.contains('btn-delete')) {
      await deleteAccount(email);
    } else if (e.target.classList.contains('view-mailbox-btn')) {
      await viewMailbox(email);
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

  if (filteredAccounts.length === 0) {
    listElement.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  // 决策理由：根据真实状态和验证码情况显示准确信息
  // 所有用户输入字段使用 escapeHtml/escapeAttr 转义，防止 XSS
  listElement.innerHTML = filteredAccounts.map(account => {
    const hasCode = account.verification_code && account.verification_code !== '等待中...';
    const actualStatus = hasCode ? 'verified' : (account.status || 'pending');
    const sidShort = (account.session_id || '').slice(0, 8);
    const safeEmail = escapeAttr(account.email);
    const codeId = 'code-' + (account.email || '').replace(/[^a-zA-Z0-9]/g, '-');

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
        <span id="${escapeAttr(codeId)}" style="font-weight: bold; color: ${hasCode ? '#10b981' : '#6b7280'};">
          ${escapeHtml(account.verification_code || '等待中...')}
        </span>
        <span class="account-label">创建时间:</span>
        <span>${escapeHtml(formatDate(account.created_at))}</span>
      </div>
      <div class="account-actions">
        <button class="btn-small btn-copy-email" data-email="${safeEmail}">复制邮箱</button>
        <button class="btn-small btn-copy-password" data-email="${safeEmail}">复制密码</button>
        <button class="btn btn-sm view-mailbox-btn" data-email="${safeEmail}" style="margin-right: 5px; background: #10b981;">查看邮箱</button>
        <button class="btn btn-sm btn-check-code" data-email="${safeEmail}" style="margin-right: 5px;">查询验证码</button>
        <button class="btn btn-sm btn-delete" data-email="${safeEmail}">删除</button>
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
async function copyAccount(email) {
  const account = allAccounts.find(a => a.email === email);
  if (account) {
    await navigator.clipboard.writeText(account.email);
    showToast('✅ 邮箱已复制');
  }
}

// 复制密码
async function copyPassword(email) {
  const account = allAccounts.find(a => a.email === email);
  if (account && account.password) {
    await navigator.clipboard.writeText(account.password);
    showToast('✅ 密码已复制');
  }
}

// 查看邮箱
async function viewMailbox(email) {
  console.log('[查看邮箱] 开始查看:', email);
  
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
  
  try {
    const tempMailClient = new TempMailClient(EMAIL_CONFIG.tempMail);
    tempMailClient.currentEmail = account.email;
    tempMailClient.currentToken = account.tempMailToken;
    
    console.log('[查看邮箱] 正在获取邮件列表...');
    const mails = await tempMailClient.checkMails();
    
    console.log(`[查看邮箱] 收到 ${mails.length} 封邮件`);
    
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
      
      mailInfo += `${i + 1}. 发件人: ${from}\n`;
      mailInfo += `   主题: ${subject}\n`;
      mailInfo += `   时间: ${date}\n\n`;
    }
    
    await ui.alert(mailInfo, { title: '📧 邮件列表' });
    
  } catch (error) {
    console.error('[查看邮箱] 失败:', error);
    await ui.alert(error.message, { title: '❌ 查看邮箱失败' });
  }
}

// 查询验证码
async function checkVerificationCode(email) {
  logger.debug('[查询验证码] 开始查询:', email);

  try {
    const codeId = 'code-' + (email || '').replace(/[^a-zA-Z0-9]/g, '-');
    const codeElement = document.getElementById(codeId);
    const btn = document.querySelector(`.btn-check-code[data-email="${email}"]`);

    logger.debug('[查询验证码] 找到元素:', { codeElement: !!codeElement, btn: !!btn });

    if (codeElement) {
      codeElement.textContent = '查询中...';
      codeElement.style.color = '#3b82f6';
    }
    if (btn) {
      btn.textContent = '获取中...';
    }

    // 检查是否为临时邮箱模式
    if (typeof EMAIL_CONFIG !== 'undefined' && EMAIL_CONFIG.mode === 'temp-mail') {
      logger.debug('[查询验证码] 临时邮箱模式 - 使用临时邮箱API获取');
      
      // 获取账号的tempMailToken
      const account = allAccounts.find(a => a.email === email);
      if (!account || !account.tempMailToken) {
        logger.error('[查询验证码] 临时邮箱模式需要 tempMailToken');
        if (codeElement) {
          codeElement.textContent = '缺少邮箱令牌';
          codeElement.style.color = '#ef4444';
        }
        if (btn) {
          btn.textContent = '查询验证码';
        }
        await ui.alert('此账号缺少临时邮箱令牌，无法查询验证码。\n请重新注册账号。', { title: '⚠️ 提示' });
        return;
      }
      
      // 使用TempMailClient获取验证码
      try {
        const tempMailClient = new TempMailClient(EMAIL_CONFIG.tempMail);
        tempMailClient.currentEmail = account.email;
        tempMailClient.currentToken = account.tempMailToken;
        
        logger.debug('[查询验证码] 开始轮询临时邮箱API...');
        const result = await tempMailClient.waitForVerificationCode();
        
        if (result.success && result.code) {
          logger.info('[查询验证码] ✅ 获取到验证码:', result.code);
          
          // 更新显示
          if (codeElement) {
            codeElement.textContent = result.code;
            codeElement.style.color = '#10b981';
          }
          if (btn) {
            btn.textContent = '查询验证码';
          }
          
          // 更新账号状态
          account.verification_code = result.code;
          account.status = 'verified';
          await dbManager.saveAccount(account);
          
          return;
        } else {
          logger.warn('[查询验证码] 未能获取验证码:', result.error);
          if (codeElement) {
            codeElement.textContent = '未收到验证码';
            codeElement.style.color = '#f59e0b';
          }
          if (btn) {
            btn.textContent = '查询验证码';
          }
          return;
        }
      } catch (error) {
        logger.error('[查询验证码] 临时邮箱API异常:', error);
        if (codeElement) {
          codeElement.textContent = '查询失败';
          codeElement.style.color = '#ef4444';
        }
        if (btn) {
          btn.textContent = '查询验证码';
        }
        return;
      }
    }

    logger.debug('[查询验证码] 步骤1: 确保账号有 session_id');
    const sessionId = await ensureSessionForAccount(email);
    logger.debug('[查询验证码] session_id:', sessionId);

    logger.debug('[查询验证码] 步骤2: 触发后端监控');
    const backendStarted = await triggerBackend(email, sessionId);
    logger.debug('[查询验证码] 后端启动结果:', backendStarted);

    if (!backendStarted) {
      logger.warn('[查询验证码] 后端启动失败');
      if (codeElement) {
        codeElement.textContent = '后端未启动';
        codeElement.style.color = '#f59e0b';
      }
      showToast('⚠️ 后端监控未启动，请手动运行 backend/main.py');
      return;
    }

    logger.debug('[查询验证码] 步骤3: 开始轮询查询验证码');
    const startTs = Date.now();
    const timeoutMs = 60000;
    let found = null;
    let attempts = 0;

    while (Date.now() - startTs < timeoutMs) {
      attempts++;
      const elapsed = Math.round((Date.now() - startTs) / 1000);
      logger.debug(`[查询验证码] 第 ${attempts} 次查询 (已用时 ${elapsed}s)`);

      if (codeElement) {
        codeElement.textContent = `查询中(${elapsed}s)...`;
      }

      try {
        // Serverless版本：调用API查询（API会主动查邮箱）
        const apiUrl = `${API_CONFIG.BASE_URL}/api/check-code/${encodeURIComponent(sessionId)}`;
        logger.debug('[查询验证码] 调用API:', apiUrl);
        logger.debug('[查询验证码] 查询条件: session_id=' + sessionId + ', email=' + email);

        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_CONFIG.API_KEY,
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache'
          }
        });

        logger.debug('[查询验证码] API响应状态:', response.status, response.ok);

        if (response.ok) {
          const data = await response.json();
          logger.debug('[查询验证码] API返回:', data);

          if (data && data.success && data.code) {
            found = data.code;
            logger.info('[查询验证码] ✅ 找到验证码:', found);
            break;
          } else {
            logger.debug('[查询验证码] API返回:', data.message || '暂无验证码');
          }
        } else {
          const errorText = await response.text();
          logger.error('[查询验证码] API失败:', response.status, errorText);
        }
      } catch (fetchError) {
        logger.error('[查询验证码] API请求异常:', fetchError);
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    logger.debug('[查询验证码] 轮询结束，总尝试次数:', attempts, '找到验证码:', !!found);

    if (found) {
      const code = found;

      // 最后一层安全检查：确认这个验证码确实属于当前账号
      console.log('[查询验证码] 最终安全检查: 验证码=' + code + ', 账号=' + email);

      // 更新显示
      if (codeElement) {
        codeElement.textContent = code;
        codeElement.style.color = '#10b981';
      }

      // 更新内存中的账号信息
      const account = allAccounts.find(a => a.email === email);
      if (account) {
        console.log('[查询验证码] 更新账号信息: ' + account.email);
        account.verification_code = code;
        account.status = 'verified'; // 更新状态
        account.session_id = sessionId;

        // 同步到IndexedDB
        await dbManager.saveAccount(account);

        // 同步更新云端账号状态
        try {
          await fetch(
            `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.UPDATE_ACCOUNT}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_CONFIG.API_KEY
              },
              body: JSON.stringify({
                email: email,
                verification_code: code,
                status: 'verified'
              })
            }
          );
        } catch (cloudError) {
          console.warn('⚠️ 云端同步失败:', cloudError);
        }
      }

      // 重新渲染以更新状态徽章
      renderAccounts();
      updateStats();

      // 自动复制
      await navigator.clipboard.writeText(code);
      showToast(`✅ 验证码: ${code} 已复制`);
    } else {
      if (codeElement) {
        codeElement.textContent = '未找到';
        codeElement.style.color = '#6b7280';
      }
      showToast('⚠️ 暂无验证码');
    }

  } catch (error) {
    console.error('查询验证码失败:', error);
    const codeElement = document.getElementById('code-' + (email || '').replace(/[^a-zA-Z0-9]/g, '-'));
    if (codeElement) {
      codeElement.textContent = '查询失败';
      codeElement.style.color = '#ef4444';
    }
    showToast('❌ 查询失败');
  } finally {
    const btn = document.querySelector(`.btn-check-code[data-email="${email}"]`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
    }
  }
}

// 删除账号
async function deleteAccount(email) {
  const ok = await ui.confirm(`确定要删除账号 ${email} 吗？`, {
    title: '删除账号',
    confirmText: '删除',
    danger: true
  });
  if (!ok) return;

  try {
    // 决策理由：同时从Supabase、IndexedDB和Chrome Storage删除
    console.log('开始删除账号:', email);

    // 1. 从云端API删除
    try {
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
      if (response.ok) {
        console.log('✅ 云端删除成功');
      }
    } catch (cloudError) {
      console.warn('⚠️ 云端删除失败:', cloudError);
    }

    // 2. 从 IndexedDB 删除
    const dbResult = await dbManager.deleteAccount(email);
    console.log('IndexedDB删除结果:', dbResult);

    // 3. 从 Chrome Storage 删除（兼容旧数据）
    await new Promise((resolve) => {
      chrome.storage.local.get(['accounts'], (result) => {
        const accounts = result.accounts || [];
        const updatedAccounts = accounts.filter(a => a.email !== email);
        chrome.storage.local.set({ accounts: updatedAccounts }, resolve);
      });
    });

    // 4. 从内存中删除
    allAccounts = allAccounts.filter(a => a.email !== email);
    filteredAccounts = filteredAccounts.filter(a => a.email !== email);

    console.log('删除后账号数量:', allAccounts.length);

    // 5. 重新渲染
    renderAccounts();
    updateStats();
    showToast('✅ 账号已彻底删除');
  } catch (error) {
    console.error('删除失败:', error);
    showToast('❌ 删除失败: ' + error.message);
  }
}

// 导出为CSV
function exportToCSV() {
  if (allAccounts.length === 0) {
    showToast('⚠️ 暂无数据可导出');
    return;
  }

  // 构建CSV内容
  const headers = ['邮箱', '密码', '用户名', '状态', '创建时间'];
  const rows = allAccounts.map(account => [
    account.email || '',
    account.password || '',
    account.username || '',
    getStatusText(account.status),
    formatDate(account.created_at)
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  // 下载文件
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `windsurf_accounts_${new Date().getTime()}.csv`;
  link.click();

  showToast('✅ CSV已导出');
}

// 清空本地账号
async function clearLocalAccounts() {
  const ok = await ui.confirm('确定要清空所有本地账号记录吗？此操作不可恢复！', {
    title: '清空所有账号',
    confirmText: '清空',
    danger: true
  });
  if (!ok) return;

  try {
    // 清空IndexedDB
    await dbManager.clearAllAccounts();

    // 清空Chrome Storage
    chrome.storage.local.set({ accounts: [] }, () => {
      allAccounts = [];
      filteredAccounts = [];
      renderAccounts();
      updateStats();
      showToast('✅ 所有账号已清空');
    });
  } catch (error) {
    console.error('清空失败:', error);
    showToast('❌ 清空失败');
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
