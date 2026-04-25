/**
 * Background Service Worker - 管理状态和后端同步（架构重构版）
 * 决策理由：添加状态持久化和恢复机制，支持中断恢复
 */

importScripts(
  '../utils/logger.js',
  '../protocol-contract.js',
  '../email-config.js',
  '../config.js',
  '../utils/email-generator.js',
  '../utils/email-provider.js',
  '../utils/temp-mail-client.js',
  '../utils/api-client.js'
);

console.log('[Background] Service worker initialized (v2.0)');

let currentRegistration = null;
const MAX_RETRY_ATTEMPTS = 3;

// ============================================================
// 验证码后台轮询
// ============================================================
//
// 决策理由：
//   MV3 的 popup 是临时窗口——失去焦点即销毁，popup 内的 setInterval
//   会被立刻清掉，所以"在 popup 里轮询验证码"的旧方案在用户切换标签页
//   填表单时一定会失败（没人继续拉接口）。
//
//   解决方法：把轮询挪到 service-worker 中，验证码到手后：
//     1) 直接对注册标签页发 fillVerificationCode（自动填 OTP + 提交）
//     2) 写到 chrome.storage 作为"补单"（popup 重开时可拾取）
//     3) 发 runtime 消息 codeReceived（popup 还开着时即时通知 UI）
//
//   SW 在 setTimeout pending 时会保持存活（不会被 30s 空闲杀掉），
//   5 分钟轮询周期内是稳定的。

const activePolls = new Map(); // sessionId → state

function stopCodePolling(sessionId) {
  const state = activePolls.get(sessionId);
  if (!state) return false;
  state.cancelled = true;
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
  activePolls.delete(sessionId);
  console.log(`[BG-Poll] 已取消 session=${sessionId}`);
  return true;
}

async function startCodePolling(opts = {}) {
  const sessionId = opts.sessionId;
  if (!sessionId) {
    throw new Error('startCodePolling 缺少 sessionId');
  }
  if (!opts.email) {
    throw new Error('startCodePolling 缺少 email');
  }

  // 决策理由：dedup——background 在 startRegistration 里会主动启动一次，
  // popup 收到响应后也会再调一次（用于刷新 isMonitoring / countdown UI）。
  // 同 sessionId+email 已在轮询时直接返回，避免取消已经在跑的任务、重置 attempt。
  // 但如果 tabId 不同（比如用户重开了注册页），允许更新 tabId 而不重启轮询。
  const existing = activePolls.get(sessionId);
  if (existing && !existing.cancelled && existing.email === opts.email) {
    if (opts.tabId && existing.tabId !== opts.tabId) {
      existing.tabId = opts.tabId;
      console.log(`[BG-Poll] session=${sessionId} 已在轮询，更新 tabId=${opts.tabId}`);
    } else {
      console.log(`[BG-Poll] session=${sessionId} 已在轮询，跳过重复启动`);
    }
    return { ok: true, alreadyRunning: true };
  }

  // 不同 sessionId/email 才取消
  stopCodePolling(sessionId);

  const state = {
    sessionId,
    email: opts.email,
    mode: opts.mode || 'qq-imap',
    tabId: opts.tabId || null,
    tempMailToken: opts.tempMailToken || null,
    tempMailProvider: opts.tempMailProvider || '1secmail',
    pollIntervalMs: opts.pollIntervalMs || 5000,
    maxAttempts: opts.maxAttempts || 60,
    attempt: 0,
    timeoutId: null,
    cancelled: false,
    startedAt: Date.now()
  };
  activePolls.set(sessionId, state);
  console.log(`[BG-Poll] 启动 mode=${state.mode} session=${sessionId} email=${state.email} tab=${state.tabId}`);

  // 后端模式：先通知后端开始监控（IMAP 抓邮件）
  if (state.mode === 'qq-imap' && typeof apiClient !== 'undefined') {
    try {
      await apiClient.startMonitor(state.email, state.sessionId);
      console.log('[BG-Poll] 后端 /api/start-monitor 已触发');
    } catch (error) {
      console.warn('[BG-Poll] 启动后端监控失败（继续轮询）:', error.message);
    }
  }

  scheduleNextPoll(state);
  return { ok: true };
}

function scheduleNextPoll(state) {
  if (state.cancelled) return;
  state.timeoutId = setTimeout(async () => {
    if (state.cancelled) return;
    state.attempt++;

    try {
      const code = await pollOnce(state);
      if (code) {
        console.log(`[BG-Poll] ${state.sessionId} 第 ${state.attempt} 次成功获取验证码: ${code}`);
        await onCodeReceived(state, code);
        return; // 终止轮询
      }
    } catch (error) {
      console.warn(`[BG-Poll] ${state.sessionId} 第 ${state.attempt} 次轮询异常:`, error.message);
    }

    if (state.attempt >= state.maxAttempts) {
      console.log(`[BG-Poll] ${state.sessionId} 达到最大重试 ${state.maxAttempts} 次，超时`);
      activePolls.delete(state.sessionId);
      broadcastTimeout(state);
      return;
    }

    scheduleNextPoll(state);
  }, state.pollIntervalMs);
}

async function pollOnce(state) {
  if (state.mode === 'temp-mail') {
    return pollTempMailOnce(state);
  }
  // qq-imap / 后端模式
  if (typeof apiClient === 'undefined') {
    throw new Error('apiClient 未在 SW 中加载');
  }
  const result = await apiClient.checkCode(state.sessionId);
  return result?.success && result.code ? result.code : null;
}

async function pollTempMailOnce(state) {
  if (typeof TempMailClient === 'undefined') {
    throw new Error('TempMailClient 未在 SW 中加载');
  }
  if (!state.tempMailToken) {
    throw new Error('temp-mail 模式缺少 tempMailToken');
  }
  // 决策理由：每次新建 client 实例，避免 SW 跨任务状态污染
  const client = new TempMailClient({ provider: state.tempMailProvider });
  client.currentEmail = state.email;
  client.currentToken = state.tempMailToken;

  const result = await client.confirmVerificationCode(null);
  return result?.confirmed && result.code ? result.code : null;
}

async function onCodeReceived(state, code) {
  activePolls.delete(state.sessionId);

  // 1) 写到 chrome.storage 让 popup 重开时也能拿到
  try {
    await chrome.storage.local.set({
      ['verification_code:' + state.sessionId]: {
        code,
        email: state.email,
        sessionId: state.sessionId,
        receivedAt: Date.now()
      }
    });
  } catch (error) {
    console.warn('[BG-Poll] 写 storage 失败:', error.message);
  }

  // 2) 直接对注册标签页发 fillVerificationCode（OTP 自动填 + 提交）
  if (state.tabId) {
    try {
      const fillResp = await chrome.tabs.sendMessage(state.tabId, {
        action: 'fillVerificationCode',
        code,
        options: {}
      });
      console.log('[BG-Poll] 自动填写验证码结果:', fillResp);
    } catch (error) {
      console.warn(`[BG-Poll] 投递 fillVerificationCode 到 tab ${state.tabId} 失败:`, error.message);
    }
  }

  // 3) popup 还开着时即时通知（关闭则失败，依赖 storage 兜底）
  try {
    await chrome.runtime.sendMessage({
      action: 'codeReceived',
      sessionId: state.sessionId,
      email: state.email,
      code
    });
  } catch (error) {
    // popup 没开属于正常情况
  }
}

function broadcastTimeout(state) {
  chrome.runtime.sendMessage({
    action: 'codeTimeout',
    sessionId: state.sessionId,
    email: state.email,
    attempts: state.attempt
  }).catch(() => { /* popup not open */ });
}

// 在service worker启动时恢复状态
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Service worker启动，检查是否有未完成的注册');
  restoreRegistrationState();
});

// 在安装时也恢复状态
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension安装/更新，初始化状态');
});

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] 收到消息:', message);
  
  if (message.action === 'startRegistration') {
    // 获取当前活动标签页
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        startRegistration(tabs[0].id).then(accountData => {
          sendResponse({ success: true, ...accountData });
        }).catch(error => {
          console.error('[Background] 错误:', error);
          sendResponse({ success: false, error: error.message });
        });
      }
    });
    return true; // 异步响应
  } else if (message.action === 'pageReady') {
    console.log('[Background] 页面已就绪:', message.url, '步骤:', message.step);
    handlePageReady(message.url, message.step);
  } else if (message.action === 'registrationSubmitted') {
    console.log('[Background] 注册表单已提交');
    // 保存提交状态
    if (currentRegistration) {
      currentRegistration.submitted = true;
      saveRegistrationState(currentRegistration);
    }
  } else if (message.action === 'cloudflareWaiting') {
    console.log('[Background] 检测到 Cloudflare 验证未通过，等待用户手动完成');
    // 不作为错误处理，等待用户手动完成
  } else if (message.action === 'submitButtonDisabled') {
    // 决策理由：与 cloudflareWaiting 区分——表示页面没有 Cloudflare，
    // 但提交按钮长时间未启用，可能是表单校验/网络/页面状态问题。
    console.log('[Background] 提交按钮未启用且非 Cloudflare:', message.message);
  } else if (message.action === 'startCodePolling') {
    // popup 发起后台轮询：即使 popup 关闭也能继续抓验证码
    startCodePolling(message)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.action === 'stopCodePolling') {
    const stopped = stopCodePolling(message.sessionId);
    sendResponse({ success: true, stopped });
    return true;
  }

  return true;
});

/**
 * 开始注册流程
 *
 * 决策理由（关键）：
 *   填表单需要 15-30 秒（fillStep1 → 等页面 → fillStep2 → 等按钮 → 提交），
 *   popup 是 MV3 临时窗口，用户在这期间切到 windsurf 标签页一定会让 popup 关闭。
 *   如果"启动轮询"放在 popup 收到 background 响应后再做，那 popup 已经死了，
 *   `startCodePolling` 永远不会被调用——这就是用户报告"没人去拉验证码"的根因。
 *
 *   修复：在 background 这边，**收到注册请求 + 生成账号后，立刻**
 *   调 startCodePolling。后续的 fillForm 失败也不影响（轮询会自然超时）。
 */
async function startRegistration(tabId) {
  console.log('[Background] 开始注册流程');

  try {
    // 生成账号信息
    const sessionId = generateUUID();
    const accountData = {
      email: buildEmailAddress(EMAIL_CONFIG),
      password: generatePassword(12),
      username: generateUsername(),
      status: 'pending',
      created_at: new Date().toISOString(),
      session_id: sessionId,
      provider: getEmailProviderName(EMAIL_CONFIG)
    };

    currentRegistration = accountData;

    console.log('[Background] 账号信息:', accountData);

    // 保存到本地存储（状态持久化）
    await saveRegistrationState(accountData);

    saveAccountWithRetry(accountData, MAX_RETRY_ATTEMPTS);

    // 决策理由：在 sendMessage(fillForm) 之前就启动轮询，
    // 这样即使 popup 在填表单期间被销毁（用户切到 windsurf 标签页），
    // 验证码轮询依然在 SW 中继续，验证码到手时直接给 tab 发 fillVerificationCode。
    if (accountData.provider !== 'temp-mail') {
      startCodePolling({
        sessionId: accountData.session_id,
        email: accountData.email,
        mode: 'qq-imap',
        tabId,
        pollIntervalMs: 5000,
        maxAttempts: 60
      }).catch(err => console.warn('[Background] 提前启动轮询失败（继续 fillForm）:', err.message));
    }

    // 立即通知 content script 填充表单
    console.log('[Background] 发送消息到 content script');

    return sendFillFormWithInjectFallback(tabId, accountData);

  } catch (error) {
    console.error('[Background] 注册流程错误:', error);
    throw error;
  }
}

/**
 * 给注册标签页发 fillForm，如遇 "Receiving end does not exist" 自动尝试重新注入 content-script 后重试。
 *
 * 决策理由：
 *   reload 扩展或重启浏览器后，已经打开的 windsurf 标签页里没有最新的 content-script——
 *   chrome 不会自动给已存在 tab 注入新的 content-script。这是用户报告
 *   "Could not establish connection. Receiving end does not exist." 的最常见原因。
 *
 *   有了 manifest "scripting" 权限后，可以用 chrome.scripting.executeScript 主动补注入，
 *   注入完再发一次 fillForm，绝大多数情况下就能成功，免去用户手动 F5 的烦恼。
 */
async function sendFillFormWithInjectFallback(tabId, accountData) {
  const sendOnce = () => new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'fillForm',
      data: accountData
    }, (response) => {
      const lastErr = chrome.runtime.lastError;
      if (lastErr) {
        const err = new Error(lastErr.message);
        err.isCommError = true;
        reject(err);
        return;
      }
      if (response && response.success) {
        resolve(accountData);
      } else {
        reject(new Error(response?.error || '表单填充失败'));
      }
    });
  });

  try {
    return await sendOnce();
  } catch (error) {
    if (!error.isCommError || !/Receiving end does not exist/i.test(error.message)) {
      // 非通信错误：不要尝试重注入，直接清理轮询并抛
      stopCodePolling(accountData.session_id);
      throw error;
    }

    console.warn('[Background] content-script 未就绪，尝试主动注入...');
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'protocol-contract.js',
          'utils/logger.js',
          'content/content-script.js'
        ]
      });
      console.log('[Background] content-script 注入成功，等待 200ms 后重试 fillForm');
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (injectError) {
      console.error('[Background] 主动注入 content-script 失败:', injectError.message);
      stopCodePolling(accountData.session_id);
      throw new Error(
        '页面未加载注册插件 content-script，请在 windsurf 标签页按 F5 刷新后重试。' +
        '原始错误：' + error.message
      );
    }

    // 重试一次
    try {
      return await sendOnce();
    } catch (retryError) {
      stopCodePolling(accountData.session_id);
      throw new Error(
        '已尝试重新注入 content-script 但仍无法通信，请在 windsurf 标签页按 F5 刷新后重试。' +
        '错误：' + retryError.message
      );
    }
  }
}

/**
 * 带重试的账号保存
 */
async function saveAccountWithRetry(data, maxAttempts) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await apiClient.saveAccount({
        email: data.email,
        password: data.password,
        username: data.username,
        status: data.status,
        created_at: data.created_at,
        session_id: data.session_id,
        provider: data.provider
      });

      if (response?.success) {
        console.log(`[Background] 账号已保存 (第 ${attempt} 次尝试)`);
        return true;
      }

      throw new Error(response?.error || '账号保存失败');
    } catch (error) {
      console.warn(`[Background] 保存失败 (第 ${attempt}/${maxAttempts} 次): ${error.message}`);
      
      if (attempt < maxAttempts) {
        // 指数退避
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  console.error('[Background] 账号保存失败，已达最大重试次数');
  return false;
}

/**
 * 获取当前注册信息
 */
function getCurrentRegistration() {
  return currentRegistration;
}

/**
 * 保存注册状态到存储
 */
async function saveRegistrationState(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ 
      currentRegistration: data,
      registrationTimestamp: Date.now()
    }, () => {
      console.log('[Background] 注册状态已保存');
      resolve(true);
    });
  });
}

/**
 * 从存储恢复注册状态
 */
async function restoreRegistrationState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['currentRegistration', 'registrationTimestamp'], (result) => {
      if (result.currentRegistration && result.registrationTimestamp) {
        const elapsedTime = Date.now() - result.registrationTimestamp;
        
        // 如果超过30分钟，状态过期
        if (elapsedTime < 30 * 60 * 1000) {
          currentRegistration = result.currentRegistration;
          console.log('[Background] 已恢复注册状态:', currentRegistration);
          resolve(currentRegistration);
        } else {
          console.log('[Background] 注册状态已过期，清除');
          chrome.storage.local.remove(['currentRegistration', 'registrationTimestamp']);
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * 处理页面就绪事件
 * 决策理由：页面加载完成后，检查是否需要恢复填写
 */
async function handlePageReady(url, step) {
  // 检查是否有未完成的注册
  const savedRegistration = await restoreRegistrationState();
  
  if (savedRegistration && !savedRegistration.submitted) {
    console.log('[Background] 检测到未完成的注册，步骤:', step);
    
    // 根据当前步骤自动恢复
    if (step === 'step1' || step === 'step2') {
      console.log('[Background] 尝试自动恢复填写...');
      // 可以在这里触发自动恢复逻辑
    }
  }
}

// 导出函数供测试
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    startRegistration,
    saveAccountWithRetry,
    getCurrentRegistration,
    saveRegistrationState,
    restoreRegistrationState
  };
}
