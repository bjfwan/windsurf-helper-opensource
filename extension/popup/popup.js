let currentAccount = null;
let isMonitoring = false;
let realtimeChannel = null;
let stateMachine = null;
let smartValidator = null;
let superBrain = null;
let registrationVerifier = null;
let monitorCountdownHandle = null;
let monitorDeadlineTs = 0;
// 决策理由：注册流程开始时记录目标 tab id，验证码到手后定向投递自动填充消息，
// 避免用户切到别的标签页后误填，或失去活跃 tab 上下文。
let registrationTabId = null;

// 邮箱模式配置
let emailConfig = null;
let tempMailClient = null;
const upstreamContract = typeof WindsurfProtocol !== 'undefined' && WindsurfProtocol.upstream
  ? WindsurfProtocol.upstream
  : {
      registerUrl: 'https://windsurf.com/account/register',
      standardPatterns: ['windsurf.com/account/register'],
      oauthPatterns: ['windsurf.com/windsurf/signin', 'workflow=onboarding', 'prompt=login'],
      countMatches(url = '', patterns = []) {
        return patterns.filter(pattern => url.includes(pattern)).length;
      },
      isRegistrationUrl(url = '') {
        if (!url) {
          return false;
        }
        if (this.standardPatterns.some(pattern => url.includes(pattern))) {
          return true;
        }
        return this.countMatches(url, this.oauthPatterns) >= 2;
      }
    };

// 尝试加载配置文件
try {
  if (typeof EMAIL_CONFIG !== 'undefined') {
    emailConfig = EMAIL_CONFIG;
    console.log('[模式] 配置已加载:', getEmailProviderName(emailConfig));

    if (isTempMailProvider(emailConfig)) {
      tempMailClient = createTempMailClient(emailConfig);
      console.log('[临时邮箱] 客户端已初始化');
    }
  } else {
    console.warn('[配置] 未找到 EMAIL_CONFIG，将使用默认配置');
  }
} catch (error) {
  console.error('[配置] 加载失败:', error);
}

/**
 * 检测是否为Windsurf注册页面
 * 支持多种注册页面URL格式
 */
function isWindsurfRegistrationPage(url) {
  return upstreamContract.isRegistrationUrl(url);
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await initRuntimeClients();
  await initStateSyncAndAnalytics();
  initStateMachine();
  setupEventListeners();
  setupBackgroundMessageListener();
  await checkAndRestoreState();
  await pickupBackgroundCachedCode();
  log('✅ 插件已加载 (v2.1 - 优化版)');
  updateStatus('idle', '就绪');
});

/**
 * 监听 service-worker 推送的验证码事件
 *
 * 决策理由：
 *   SW 真正负责轮询，popup 只在打开时才能听到这些消息；关闭时由 storage 兜底。
 *
 * 防误投递（关键）：
 *   1) 必须严格匹配本地+远端 sessionId（之前只在两者都存在且不等时才丢弃，
 *      ERROR 状态下本地 sessionId 是 undefined，会让任何 SW 残留消息都被处理）
 *   2) ERROR / IDLE / COMPLETED 状态下忽略迟到的验证码——这些状态意味着流程已结束
 */
function setupBackgroundMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return false;

    if (message.action === 'codeReceived') {
      const localSessionId = currentAccount?.session_id || stateMachine?.getMetadata()?.session_id;

      // 严格匹配：缺一不可
      if (!localSessionId || !message.sessionId || localSessionId !== message.sessionId) {
        log(`⚠️ 忽略不匹配的验证码（local=${localSessionId || '空'} remote=${message.sessionId || '空'}）`, 'warning');
        sendResponse({ ignored: true, reason: 'sessionId mismatch' });
        return false;
      }

      // 状态检查：流程已结束的话，迟到的验证码大概率是上一轮残留
      const state = stateMachine?.getState();
      const ignoredStates = [
        RegistrationStateMachine.STATES.ERROR,
        RegistrationStateMachine.STATES.IDLE,
        RegistrationStateMachine.STATES.COMPLETED
      ];
      if (ignoredStates.includes(state)) {
        log(`⚠️ 当前状态 ${state}，忽略迟到的验证码 ${message.code}`, 'warning');
        sendResponse({ ignored: true, reason: state });
        return false;
      }

      log(`📨 收到后台投递的验证码: ${message.code}`);
      handleVerificationCodeReceived(message.code, {
        sourceTag: '后台投递',
        updateCloud: !!currentAccount && !isTempMailProvider(emailConfig),
        email: message.email
      }).catch(err => logger.error('[BG-Msg] handleVerificationCodeReceived 失败:', err));
      sendResponse({ ok: true });
      return false;
    }

    if (message.action === 'codeTimeout') {
      const localSessionId = currentAccount?.session_id || stateMachine?.getMetadata()?.session_id;
      if (!localSessionId || !message.sessionId || localSessionId !== message.sessionId) {
        return false; // 静默忽略——超时也得是给当前会话的才有意义
      }
      log(`⏱️ 后台轮询超时（已尝试 ${message.attempts} 次）`, 'error');
      stopRealtimeMonitoring();
      handleVerificationTimeout(() => {
        const mode = isTempMailProvider(emailConfig) ? 'temp-mail' : 'qq-imap';
        if (mode === 'temp-mail') {
          startTempMailMonitoring(message.email);
        } else {
          startRealtimeMonitoring(message.email);
        }
      }, '验证码获取超时');
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
}

/**
 * popup 重新打开时，从 storage 读取 SW 在后台已经拿到的验证码
 *
 * 决策理由：popup 关闭期间 codeReceived runtime 消息会丢失，但 SW 把验证码
 *          写入了 storage，这里补单恢复 UI 流程。
 *
 * 防误投递：与 setupBackgroundMessageListener 同理——流程已结束（ERROR/IDLE/COMPLETED）
 *          的话，缓存的验证码视为残留并清理。
 */
async function pickupBackgroundCachedCode() {
  try {
    const sessionId = currentAccount?.session_id || stateMachine?.getMetadata()?.session_id;
    if (!sessionId) return;

    const key = 'verification_code:' + sessionId;
    const data = await new Promise(resolve => {
      chrome.storage.local.get([key], resolve);
    });

    const cached = data?.[key];
    if (!cached?.code) return;

    // 状态检查：流程已结束的会话不应该再"恢复"
    const state = stateMachine?.getState();
    const finishedStates = [
      RegistrationStateMachine.STATES.ERROR,
      RegistrationStateMachine.STATES.IDLE,
      RegistrationStateMachine.STATES.COMPLETED
    ];
    if (finishedStates.includes(state)) {
      log(`🗑️ 清理上一轮残留验证码缓存（state=${state}, code=${cached.code}）`, 'warning');
      chrome.storage.local.remove([key]);
      return;
    }

    log(`💾 从后台缓存恢复验证码: ${cached.code}`);
    await handleVerificationCodeReceived(cached.code, {
      sourceTag: '后台缓存',
      updateCloud: !!currentAccount && !isTempMailProvider(emailConfig),
      email: cached.email
    });

    // 决策理由：消费一次即清理，避免下次打开 popup 时重复触发
    chrome.storage.local.remove([key]);
  } catch (error) {
    logger.error('[Popup] 拾取后台验证码失败:', error);
  }
}

// 决策理由：popup 关闭时显式清理定时器与心跳，避免资源泄漏（pagehide 比 beforeunload 更可靠）
window.addEventListener('pagehide', () => {
  try {
    if (typeof stateSyncManager !== 'undefined' && stateSyncManager) {
      stateSyncManager.destroy();
    }
    if (monitorCountdownHandle) {
      clearInterval(monitorCountdownHandle);
      monitorCountdownHandle = null;
    }
    if (realtimeChannel && typeof realtimeChannel.unsubscribe === 'function') {
      realtimeChannel.unsubscribe();
      realtimeChannel = null;
    }
    isMonitoring = false;
  } catch {
    // 静默：popup 卸载阶段尽力清理
  }
});

async function initRuntimeClients() {
  try {
    log('✅ API客户端就绪');
    await dbManager.init();
    registrationVerifier = new RegistrationResultVerifier(apiClient, dbManager, tempMailClient);
    log('✅ IndexedDB 本地缓存就绪');
  } catch (error) {
    log('❌ 初始化失败: ' + error.message, 'error');
  }
}

// 初始化状态同步和统计分析
async function initStateSyncAndAnalytics() {
  try {
    // 初始化状态同步管理器
    await stateSyncManager.init();
    log('✅ 状态同步管理器已初始化');
    
    // 添加同步监听器，实时更新UI
    stateSyncManager.addSyncListener((newState) => {
      console.log('[Popup] 检测到状态同步:', newState);
      // 可以在这里添加UI更新逻辑
    });
    
    // 初始化统计分析
    await analytics.init();
    log('✅ 统计分析模块已初始化');
  } catch (error) {
    log('⚠️ 状态同步/统计初始化失败: ' + error.message, 'warning');
  }
}

// 初始化状态机
function initStateMachine() {
  stateMachine = new RegistrationStateMachine();
  
  // 添加状态变化监听器
  stateMachine.addListener(async (newState, oldState, metadata) => {
    log(`📊 状态转换: ${oldState} → ${newState}`);
    updateUIFromState(newState, metadata);
    updateProgressBar(stateMachine.getProgress());
    
    // 📊 统计分析：记录状态转换
    try {
      if (newState === RegistrationStateMachine.STATES.COMPLETED) {
        // 注册成功
        await analytics.endSession('success');
        log('📊 注册成功，统计已记录', 'success');
      } else if (newState === RegistrationStateMachine.STATES.ERROR) {
        // 注册失败，记录错误原因
        const errorType = metadata.error || 'unknown';
        await analytics.recordError(errorType, metadata.error || '未知错误');
        await analytics.endSession('failed');
        log('📊 注册失败，统计已记录', 'warning');
      }
    } catch (error) {
      console.error('[Analytics] 状态转换记录失败:', error);
    }
  });
  
  // 初始化智能验证器
  smartValidator = new SmartValidator(apiClient, tempMailClient, dbManager);
  superBrain = new SuperBrain(apiClient, stateMachine, smartValidator);
  
  log('✅ 状态机已初始化');
  log('✅ 智能验证器已初始化');
  log('🧠 超级智能大脑已初始化');
}

// 检查并恢复状态
async function checkAndRestoreState() {
  try {
    const restored = await stateMachine.loadFromStorage();
    if (restored) {
      const state = stateMachine.getState();
      const metadata = stateMachine.getMetadata();
      
      log('🔄 检测到上次会话状态: ' + stateMachine.getStateText());
      
      // 🧠 智能验证：自动检测并清理过期/无效状态
      if (smartValidator && metadata.email) {
        const smartCheck = await smartValidator.smartCheckAndHandle(metadata, stateMachine);
        console.log('[RestoreState] 智能验证结果:', smartCheck);
        
        if (smartCheck.result.action === 'cleared') {
          log('🧹 ' + smartCheck.result.message);
          return; // 已清理，无需继续恢复
        } else if (smartCheck.result.action === 'retry') {
          log('🔄 ' + smartCheck.result.message, 'warning');
          return; // 已重置，无需继续恢复
        }
      }
      
      // 决策理由：智能判断是否需要自动恢复，无需用户确认
      if (stateMachine.shouldAutoRestore() && metadata.email) {
        currentAccount = metadata;
        displayAccountInfo(metadata);
        log('✅ 自动恢复进行中的注册流程');
        
        // 根据状态决定按钮和监听
        if (state === RegistrationStateMachine.STATES.WAITING_VERIFICATION) {
          // 等待验证状态：启动监听并显示停止按钮
          if (!isMonitoring) {
            startRealtimeMonitoring(metadata.email);
          }
          // 显示停止按钮
          document.getElementById('start-btn').classList.add('hidden');
          document.getElementById('stop-btn').classList.remove('hidden');
        } else {
          // 其他进行中状态，显示"继续"按钮
          updateButtonState('continue');
        }
      } else if (stateMachine.isCompleted()) {
        // 已完成：显示账号信息，但不监听
        if (metadata.email) {
          currentAccount = metadata;
          displayAccountInfo(metadata);
          log('✅ 上次注册已完成');
        }
        // 重置状态机，允许创建新账号
        stateMachine.reset();
        await stateMachine.clearStorage();
      } else if (stateMachine.isError()) {
        log('⚠️ 上次注册遇到错误，已重置', 'warning');
        stateMachine.reset();
        await stateMachine.clearStorage();
      }
    }
  } catch (error) {
    console.error('[Popup] 恢复状态失败:', error);
    log('⚠️ 恢复状态失败，使用默认状态', 'warning');
  }
}

// 设置事件监听器
function setupEventListeners() {
  document.getElementById('start-btn').addEventListener('click', startRegistration);
  document.getElementById('stop-btn').addEventListener('click', stopMonitoring);
  document.getElementById('reset-btn').addEventListener('click', resetRegistration);
  document.getElementById('accounts-btn').addEventListener('click', viewAccounts);
  document.getElementById('stats-btn').addEventListener('click', viewStats);
  
  // 超级智能大脑按钮
  document.getElementById('brain-btn').addEventListener('click', openSuperBrain);
  
  // 复制按钮（使用事件委托）
  document.addEventListener('click', (e) => {
    if (e.target.id === 'copy-email-btn') {
      copyToClipboard(currentAccount?.email, '邮箱');
    } else if (e.target.id === 'copy-password-btn') {
      copyToClipboard(currentAccount?.password, '密码');
    }
  });
  
  // 打赏按钮事件监听
  document.getElementById('sponsor-btn').addEventListener('click', showSponsorModal);
  
  // 设置打赏弹窗内部事件（关闭、切换支付方式等）
  setupSponsorEvents();
}

// 开始注册
async function startRegistration() {
  try {
    // 防止重复启动
    if (isMonitoring) {
      log('⚠️ 已在运行中，请勿重复操作');
      return;
    }
    
    // 🧠 智能验证：自动检测账号真实状态
    log('🧠 智能分析账号状态...');
    const smartCheck = await smartValidator.smartCheckAndHandle(currentAccount, stateMachine);
    
    console.log('[StartRegistration] 智能检测结果:', smartCheck);
    
    // 决策理由：根据智能验证结果决定操作
    if (smartCheck.result.action === 'cleared') {
      log('✅ ' + smartCheck.result.message);
      // 状态已清理，准备创建新账号
      currentAccount = null;
    } else if (smartCheck.result.action === 'continue') {
      log('✅ ' + smartCheck.result.message);
      if (smartCheck.result.verificationCode) {
        await handleVerificationCodeReceived(smartCheck.result.verificationCode, {
          sourceTag: '恢复校验',
          updateCloud: !!currentAccount && !isTempMailProvider(emailConfig),
          email: currentAccount?.email || null
        });
        return;
      }
    } else if (smartCheck.result.action === 'retry') {
      log('⚠️ ' + smartCheck.result.message, 'warning');
      currentAccount = null;
    }
    
    // 决策理由：智能判断是继续现有注册还是创建新账号
    const isContinue = stateMachine.shouldAutoRestore() && currentAccount && currentAccount.email;
    
    if (isContinue) {
      log('🔄 继续未完成的注册流程: ' + currentAccount.email);
      // 不需要重新生成账号，使用现有账号
    } else {
      // 重置状态机，确保从IDLE开始
      if (stateMachine.getState() !== RegistrationStateMachine.STATES.IDLE) {
        stateMachine.reset();
        await stateMachine.clearStorage();
      }
      
      // 使用状态锁保护状态转换
      await stateSyncManager.executeWithLock(async () => {
        stateMachine.transition(RegistrationStateMachine.STATES.PREPARING);
        await stateMachine.saveToStorage();
        await stateSyncManager.syncState(stateMachine.getMetadata());
      });
      
      log('🚀 开始新注册流程');
    }
  
  // 显示停止按钮
  document.getElementById('start-btn').classList.add('hidden');
  document.getElementById('stop-btn').classList.remove('hidden');
  
  // 获取当前标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !isWindsurfRegistrationPage(tab.url)) {
    log('❌ 请先打开 Windsurf 注册页面', 'error');
    stateMachine.transition(RegistrationStateMachine.STATES.ERROR, {
      error: '页面URL不正确'
    });
    await stateMachine.saveToStorage();
    resetUI();

    // 自动打开注册页面
    chrome.tabs.create({ url: upstreamContract.registerUrl });
    return;
  }

  // 决策理由：记录注册标签页 id，验证码到手后定向自动填充
  registrationTabId = tab.id;
  
  // 决策理由：继续模式直接填充，新建模式通过background生成账号
  if (isContinue) {
    // 继续模式：直接使用现有账号通知content script填充
    log('📝 使用现有账号继续填充表单');

    // 决策理由（关键）：在 fillForm 之前先启动 SW 后台轮询，
    // 这样即使 popup 在填表单期间被销毁也不会丢失监听。
    if (currentAccount.email) {
      if (isTempMailProvider(emailConfig)) {
        await startTempMailMonitoring(currentAccount.email);
      } else {
        await startRealtimeMonitoring(currentAccount.email);
      }
    }

    try {
      const response = await sendFillFormWithFallback(tab.id, currentAccount);
      if (response && response.success) {
        log('✅ 表单已填充（验证码后台监听已就绪）');
        displayAccountInfo(currentAccount);

        // 决策理由：根据当前状态合法转换到WAITING_VERIFICATION
        const currentState = stateMachine.getState();
        if (currentState !== RegistrationStateMachine.STATES.WAITING_VERIFICATION) {
          if (currentState === RegistrationStateMachine.STATES.PREPARING) {
            stateMachine.transition(RegistrationStateMachine.STATES.DETECTING_PAGE);
            await stateMachine.saveToStorage();
            stateMachine.transition(RegistrationStateMachine.STATES.FILLING_STEP1);
            await stateMachine.saveToStorage();
          } else if (currentState === RegistrationStateMachine.STATES.DETECTING_PAGE) {
            stateMachine.transition(RegistrationStateMachine.STATES.FILLING_STEP1);
            await stateMachine.saveToStorage();
          }

          if ([RegistrationStateMachine.STATES.FILLING_STEP1,
               RegistrationStateMachine.STATES.WAITING_STEP1_SUBMIT,
               RegistrationStateMachine.STATES.FILLING_STEP2,
               RegistrationStateMachine.STATES.WAITING_CLOUDFLARE].includes(stateMachine.getState())) {
            stateMachine.transition(RegistrationStateMachine.STATES.WAITING_VERIFICATION, {
              email: currentAccount.email
            });
            await stateMachine.saveToStorage();
          }
        }

        document.getElementById('start-btn').classList.add('hidden');
        document.getElementById('stop-btn').classList.remove('hidden');
      }
    } catch (fillError) {
      stateMachine.transition(RegistrationStateMachine.STATES.ERROR, {
        error: fillError.message
      });
      await stateMachine.saveToStorage();
      log('❌ 填充失败: ' + fillError.message, 'error');
      if (/Receiving end does not exist|F5/i.test(fillError.message)) {
        log('💡 提示：按 F5 刷新 windsurf 页面，再重新点击"开始注册"', 'warning');
      }
      if (currentAccount?.session_id) {
        try { await chrome.runtime.sendMessage({ action: 'stopCodePolling', sessionId: currentAccount.session_id }); } catch { /* ignore */ }
      }
      resetUI();
    }
  } else {
    // 新建模式：根据配置选择账号生成方式
    stateMachine.transition(RegistrationStateMachine.STATES.DETECTING_PAGE);
    await stateMachine.saveToStorage();
    
    if (emailConfig && isTempMailProvider(emailConfig) && tempMailClient) {
      // 临时邮箱模式：前端直接生成
      log('🌍 使用临时邮箱模式生成账号...');
      
      try {
        // 1. 生成临时邮箱
        const emailResult = await tempMailClient.generateEmail();
        log('✅ 临时邮箱已生成: ' + emailResult.email);
        
        // 2. 生成完整账号信息
        const accountData = {
          email: emailResult.email,
          password: generatePassword(12),
          username: generateUsername(),
          session_id: 'session_' + Date.now() + '_' + generateRandomString(6),
          tempMailToken: emailResult.token,
          created_at: new Date().toISOString(),
          status: 'pending',
          provider: getEmailProviderName(emailConfig)
        };
        
        // 3. 保存当前账号
        currentAccount = accountData;
        
        // 4. 显示账号信息
        displayAccountInfo(accountData);
        
        // 5. 更新状态机
        stateMachine.transition(RegistrationStateMachine.STATES.FILLING_STEP1, {
          email: accountData.email,
          password: accountData.password,
          username: accountData.username,
          session_id: accountData.session_id
        });
        await stateMachine.saveToStorage();
        
        // 6. 保存到本地数据库
        try {
          await dbManager.saveAccount(accountData);
          log('💾 账号已保存到本地');
        } catch (err) {
          console.error('保存账号失败:', err);
        }

        // 决策理由（关键）：在 sendMessage(fillForm) 之前就启动后台轮询。
        // 填表单 + 等提交 + 等验证码页面渲染共耗时 15-30s，期间 popup 必然被销毁，
        // 如果"启动监听"放在 fillForm 回调里，那回调永远不会执行（popup 没了）。
        // 提前启动让 SW 接手，验证码到手时直接给 tab 发 fillVerificationCode。
        await startTempMailMonitoring(accountData.email);

        // 7. 通知content script填充表单（含 content-script 缺失自动注入回退）
        try {
          const fillResponse = await sendFillFormWithFallback(tab.id, accountData);
          if (fillResponse && fillResponse.success) {
            log('✅ 表单已填充（验证码后台监听已就绪）');
            stateMachine.transition(RegistrationStateMachine.STATES.WAITING_VERIFICATION, {
              email: accountData.email
            });
            await stateMachine.saveToStorage();
          }
        } catch (fillError) {
          log('❌ 填充失败: ' + fillError.message, 'error');
          if (/Receiving end does not exist|F5/i.test(fillError.message)) {
            log('💡 提示：按 F5 刷新 windsurf 页面，再重新点击"开始注册"', 'warning');
          }
          // 决策理由：fillForm 失败时停止已启动的轮询，避免空跑 5 分钟
          try {
            await chrome.runtime.sendMessage({ action: 'stopCodePolling', sessionId: accountData.session_id });
          } catch { /* ignore */ }
          resetUI();
          return;
        }

        return; // 退出函数，不执行后面的background调用

      } catch (error) {
        log('❌ 临时邮箱生成失败: ' + error.message, 'error');
        resetUI();
        return;
      }
    }
    
    // 默认模式：通过background生成账号
    log('🔒 使用后端API模式生成账号...');
    chrome.runtime.sendMessage({ action: 'startRegistration' }, async (response) => {
    // 检查runtime错误
    if (chrome.runtime.lastError) {
      console.error('[Popup] Runtime错误:', chrome.runtime.lastError);
      stateMachine.transition(RegistrationStateMachine.STATES.ERROR, {
        error: 'Background通信失败: ' + chrome.runtime.lastError.message
      });
      await stateMachine.saveToStorage();
      log('❌ 通信失败: ' + chrome.runtime.lastError.message, 'error');
      resetUI();
      return;
    }
    
    if (response && response.success) {
      log('✅ 表单已填充');
      
      // 保存当前账号
      if (response.email) {
        currentAccount = response;
        
        // 📊 启动统计会话
        try {
          await analytics.startSession(response);
          await analytics.recordStepStart('filling_step1');
          log('📊 统计会话已启动');
        } catch (error) {
          console.error('[Analytics] 启动会话失败:', error);
        }
        
        // 决策理由：遵循状态机转换规则，不能跳过中间状态
        // 更新状态机元数据并转换到填充步骤1
        stateMachine.transition(RegistrationStateMachine.STATES.FILLING_STEP1, {
          email: response.email,
          password: response.password,
          username: response.username,
          session_id: response.session_id
        });
        await stateMachine.saveToStorage();
        
        // 保存到 IndexedDB
        dbManager.saveAccount(response).then(() => {
          log('💾 账号已缓存到本地');
        }).catch(err => {
          console.error('IndexedDB 保存失败:', err);
        });
        
        // 显示账号信息
        displayAccountInfo(response);
        
        // 决策理由：content script自动完成所有填充，直接跳到等待验证状态
        stateMachine.transition(RegistrationStateMachine.STATES.WAITING_VERIFICATION, {
          email: response.email,
          session_id: response.session_id
        });
        await stateMachine.saveToStorage();
        
        // 使用 Realtime 监听验证码（避免重复监听）
        if (!isMonitoring) {
          startRealtimeMonitoring(response.email);
        }
      }
    } else {
      stateMachine.transition(RegistrationStateMachine.STATES.ERROR, {
        error: response?.error || '未知错误'
      });
      await stateMachine.saveToStorage();
      const errMsg = response?.error || '未知错误';
      log('❌ 启动失败: ' + errMsg, 'error');
      // 决策理由：把"通信失败"翻译成用户可操作的提示
      if (/Receiving end does not exist|F5|content-script/i.test(errMsg)) {
        log('💡 提示：windsurf 标签页里没有插件 content-script，请按 F5 刷新页面后重试', 'warning');
      }
      resetUI();
    }
    });
  }
  } catch (error) {
    console.error('[Popup] 注册流程错误:', error);
    stateMachine.transition(RegistrationStateMachine.STATES.ERROR, {
      error: error.message
    });
    await stateMachine.saveToStorage();
    log('❌ 发生错误: ' + error.message, 'error');
    resetUI();
  }
}

async function triggerBackendMonitor(email, sessionId) {
  console.log('[triggerBackendMonitor] 开始', { email, sessionId });
  console.log('[triggerBackendMonitor] apiClient存在:', typeof apiClient !== 'undefined');
  console.log('[triggerBackendMonitor] API_CONFIG:', API_CONFIG);
  
  log('☁️ 正在连接后端服务...');
  
  try {
    console.log('[triggerBackendMonitor] 调用apiClient.startMonitor');
    const result = await apiClient.startMonitor(email, sessionId);
    console.log('[triggerBackendMonitor] API响应:', result);
    
    if (result.success) {
      log('✅ 后端监控已启动');
      console.log('[triggerBackendMonitor] 成功');
      return true;
    } else {
      log('❌ 启动监控失败: ' + (result.message || '未知错误'), 'error');
      console.error('[triggerBackendMonitor] 失败:', result);
      return false;
    }
  } catch (error) {
    console.error('[triggerBackendMonitor] 异常:', error);
    console.error('[triggerBackendMonitor] 错误详情:', error.message, error.stack);
    log('❌ 连接后端服务失败: ' + error.message, 'error');
    log('💡 提示: 请确保API服务器正在运行', 'warning');
    return false;
  }
}

/**
 * 启动临时邮箱验证码监听（temp-mail 模式）
 *
 * 决策理由：MV3 popup 失去焦点即销毁，popup 内的轮询会丢。
 * 改为委托 service-worker 后台轮询，验证码到手时：
 *   - SW 直接对注册标签页发 fillVerificationCode（OTP 自动填）
 *   - SW 同时发 codeReceived runtime 消息（popup 还开着时即时更新）
 *   - SW 写 storage（popup 重开时也能拾取）
 */
async function startTempMailMonitoring(email) {
  if (!currentAccount?.tempMailToken) {
    log('❌ 缺少临时邮箱令牌，无法启动监听', 'error');
    return;
  }
  await delegateBackgroundCodePolling({
    email,
    mode: 'temp-mail',
    tempMailToken: currentAccount.tempMailToken,
    tempMailProvider: currentAccount?.tempMailProvider || emailConfig?.tempMail?.provider || '1secmail',
    pollIntervalMs: emailConfig?.tempMail?.pollInterval || 5000,
    maxAttempts: emailConfig?.tempMail?.maxAttempts || 60,
    sourceTag: '临时邮箱'
  });
}

/**
 * 启动后端 API 验证码监听（qq-imap 模式）
 *
 * 决策理由：同上——委托 SW 后台轮询，规避 popup 关闭导致的轮询中断。
 */
async function startRealtimeMonitoring(email) {
  await delegateBackgroundCodePolling({
    email,
    mode: 'qq-imap',
    pollIntervalMs: API_CONFIG.POLL_INTERVAL || 5000,
    maxAttempts: 60,
    sourceTag: '后端轮询'
  });
}

/**
 * 把验证码轮询委托给 service-worker
 * 决策理由：把"popup 内 setInterval"换成"SW 内 setTimeout 链"，
 *           即使 popup 关掉也继续工作。
 */
async function delegateBackgroundCodePolling(opts) {
  if (isMonitoring) {
    log('⚠️ 已在监听验证码，请勿重复操作');
    return;
  }

  // 取 sessionId
  let sessionId = null;
  try {
    if (stateMachine && typeof stateMachine.getMetadata === 'function') {
      const md = stateMachine.getMetadata();
      sessionId = md?.session_id || null;
    }
  } catch { /* ignore */ }
  if (!sessionId && currentAccount?.session_id) {
    sessionId = currentAccount.session_id;
  }

  if (!sessionId) {
    log('❌ 缺少 session_id，无法启动验证码监听', 'error');
    return;
  }

  isMonitoring = true;

  // 启动 popup 端的倒计时显示（仅 UI，不参与轮询）
  const totalMs = (opts.pollIntervalMs || 5000) * (opts.maxAttempts || 60);
  monitorDeadlineTs = Date.now() + totalMs;
  if (monitorCountdownHandle) clearInterval(monitorCountdownHandle);
  monitorCountdownHandle = setInterval(() => {
    const remain = Math.max(0, Math.floor((monitorDeadlineTs - Date.now()) / 1000));
    updateStatus('running', `等待验证码（剩余 ${remain}s）`);
    if (remain <= 0) {
      clearInterval(monitorCountdownHandle);
      monitorCountdownHandle = null;
    }
  }, 1000);

  log(`🔔 委托后台轮询验证码（${opts.sourceTag}，${(totalMs / 1000) | 0}s 内）`);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'startCodePolling',
      sessionId,
      email: opts.email,
      mode: opts.mode,
      tabId: registrationTabId,
      tempMailToken: opts.tempMailToken,
      tempMailProvider: opts.tempMailProvider,
      pollIntervalMs: opts.pollIntervalMs,
      maxAttempts: opts.maxAttempts
    });

    if (!response?.success) {
      log('❌ 启动后台轮询失败: ' + (response?.error || '未知错误'), 'error');
      isMonitoring = false;
      if (monitorCountdownHandle) {
        clearInterval(monitorCountdownHandle);
        monitorCountdownHandle = null;
      }
      return;
    }

    log('✅ 后台轮询已启动，可以放心切换标签页');

    // realtimeChannel 用作"取消句柄"——stopRealtimeMonitoring 会调用
    realtimeChannel = {
      sessionId,
      sourceTag: opts.sourceTag,
      mode: opts.mode,
      email: opts.email,
      unsubscribe: () => {
        chrome.runtime.sendMessage({ action: 'stopCodePolling', sessionId }).catch(() => {});
      }
    };
  } catch (error) {
    log('❌ 启动后台轮询异常: ' + error.message, 'error');
    isMonitoring = false;
    if (monitorCountdownHandle) {
      clearInterval(monitorCountdownHandle);
      monitorCountdownHandle = null;
    }
  }
}

/**
 * 给注册标签页发 fillForm，content-script 没就绪时尝试主动注入后重试一次。
 *
 * 决策理由（与 background 同源）：
 *   reload 扩展或重启浏览器后，已经打开的 windsurf 标签页里没有最新 content-script——
 *   chrome 不会自动给已存在 tab 注入。利用 manifest "scripting" 权限主动补注入，
 *   绝大多数情况下就能直接救活，免去手动 F5。
 */
async function sendFillFormWithFallback(tabId, data) {
  const sendOnce = () => new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'fillForm', data }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        const e = new Error(err.message);
        e.isCommError = true;
        reject(e);
        return;
      }
      if (response && response.success) {
        resolve(response);
      } else {
        reject(new Error(response?.error || '表单填充失败'));
      }
    });
  });

  try {
    return await sendOnce();
  } catch (error) {
    if (!error.isCommError || !/Receiving end does not exist/i.test(error.message)) {
      throw error;
    }
    log('⚙️ content-script 未就绪，尝试主动注入...', 'warning');
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['protocol-contract.js', 'utils/logger.js', 'content/content-script.js']
      });
      log('✅ content-script 已注入，重试填充', 'success');
      await new Promise(resolve => setTimeout(resolve, 200));
      return await sendOnce();
    } catch (injectError) {
      throw new Error(
        '页面 content-script 缺失且无法主动注入。请按 F5 刷新 windsurf 页面后重试。原始错误：' + error.message
      );
    }
  }
}

/**
 * 把验证码自动填到注册页面的输入框（OTP 6 段或单输入框均兼容）。
 * 决策理由：避免用户手动复制+粘贴，减少操作步骤。
 * 优先发到 registrationTabId（注册流程开始时记录），fallback 到当前活跃 tab。
 *
 * @param {string} code
 * @param {Object} options - { autoSubmit?: boolean }
 * @returns {Promise<{ ok: boolean, mode?: string, submitted?: boolean, reason?: string }>}
 */
async function autofillVerificationCodeOnPage(code, options = {}) {
  let tabId = registrationTabId;
  if (!tabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    } catch (error) {
      logger.warn('[AutoFill] 查询活跃标签页失败:', error);
    }
  }

  if (!tabId) {
    return { ok: false, reason: '找不到注册标签页' };
  }

  return new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { action: 'fillVerificationCode', code, options },
        (response) => {
          if (chrome.runtime.lastError) {
            logger.warn('[AutoFill] 发送失败:', chrome.runtime.lastError.message);
            resolve({ ok: false, reason: chrome.runtime.lastError.message });
            return;
          }
          if (!response || response.success === false) {
            resolve({ ok: false, reason: response?.reason || '内容脚本未返回成功' });
            return;
          }
          resolve({
            ok: true,
            mode: response.mode,
            filledCount: response.filledCount,
            submitted: !!response.submitted
          });
        }
      );
    } catch (error) {
      logger.error('[AutoFill] 异常:', error);
      resolve({ ok: false, reason: error.message });
    }
  });
}

/**
 * 收到验证码后的统一处理
 * 决策理由：消除 startTempMailMonitoring 与 startRealtimeMonitoring 中的重复逻辑
 * @param {string} code - 验证码
 * @param {Object} options - { sourceTag?: string, updateCloud?: boolean, email?: string }
 */
async function handleVerificationCodeReceived(code, options = {}) {
  const { sourceTag = '监控', updateCloud = false, email = null } = options;

  log(`🎉 收到验证码: ${code}`, 'success');
  displayVerificationCode(code);

  // 决策理由：拿到验证码立刻投递到注册页面自动填充。
  // 与下面的独立核验并行执行，让用户少一次手动复制/粘贴。
  // 自动提交按钮的等待逻辑（最多 1.5s）在 content-script 内完成，
  // 这里 await 主要是为了把"是否成功填充"反馈给用户日志。
  autofillVerificationCodeOnPage(code).then(fillResult => {
    if (fillResult.ok) {
      const submittedHint = fillResult.submitted ? '，已点击提交' : '，等待手动提交';
      log(`✍️ 已自动填写验证码（${fillResult.mode}${submittedHint}）`, 'success');
    } else {
      log(`💡 自动填写未生效（${fillResult.reason}），请手动复制验证码`, 'warning');
    }
  }).catch(error => {
    logger.error('[AutoFill] 投递异常:', error);
  });

  // 统计：记录步骤完成
  try {
    await analytics.recordStepEnd('waiting_verification', true);
  } catch (error) {
    logger.error('[Analytics] 记录步骤失败:', error);
  }

  stateMachine.transition(RegistrationStateMachine.STATES.VERIFYING_RESULT, {
    verificationCode: code
  });
  try {
    await stateMachine.saveToStorage();
  } catch (error) {
    logger.error(`[${sourceTag}] 保存状态失败:`, error);
  }

  if (currentAccount) {
    currentAccount.verification_code = code;
    try {
      await dbManager.saveAccount(currentAccount);
      log('✅ 已记录验证码，开始独立核验');
    } catch (e) {
      logger.error('[DB] 保存账号失败:', e);
    }
  }

  const verificationReport = registrationVerifier
    ? await registrationVerifier.verify(currentAccount, { expectedCode: code })
    : { confirmed: false, degraded: false, reason: '核验器未初始化', attempts: [] };

  // 决策理由：把"是否独立确认"与"是否降级确认"分开告诉用户。
  // - confirmed && !degraded ：强确认，直接进入 COMPLETED
  // - confirmed && degraded  ：降级确认（独立来源全部不可用，本地数据自洽），
  //                            状态机也走 COMPLETED，但日志/metadata 里记一笔 degraded
  // - !confirmed             ：核验失败，进入 ERROR
  if (!verificationReport.confirmed) {
    stateMachine.transition(RegistrationStateMachine.STATES.ERROR, {
      error: verificationReport.reason || '独立核验失败',
      verificationReport
    });
    await stateMachine.saveToStorage();
    log('❌ 独立核验失败: ' + (verificationReport.reason || '未知错误'), 'error');
    return;
  }

  if (verificationReport.degraded) {
    log(`⚠️ 独立来源不可用，已使用本地降级核验（来源: ${verificationReport.source}）`, 'warning');
  } else {
    log(`🔎 独立核验通过: ${verificationReport.source}`, 'success');
  }

  if (currentAccount) {
    currentAccount.status = 'verified';
    currentAccount.verified_at = new Date().toISOString();
    currentAccount.verification_source = verificationReport.source || sourceTag;
    currentAccount.verification_degraded = !!verificationReport.degraded;
    try {
      await dbManager.saveAccount(currentAccount);
      log('✅ 本地账号状态已确认');
    } catch (error) {
      logger.error(`[${sourceTag}] 本地确认保存失败:`, error);
    }
  }

  if (updateCloud && email && isTempMailProvider(emailConfig)) {
    try {
      await updateAccountStatus(email, 'verified', code);
      log('✅ 后端账号状态已同步');
    } catch (error) {
      logger.error(`[${sourceTag}] 更新账号状态失败:`, error);
    }
  }

  stateMachine.transition(RegistrationStateMachine.STATES.COMPLETED, {
    verificationCode: code,
    verificationConfirmed: verificationReport.confirmed,
    verificationDegraded: !!verificationReport.degraded,
    verificationSource: verificationReport.source || sourceTag,
    verificationAttempts: Array.isArray(verificationReport.attempts) ? verificationReport.attempts.length : 0
  });

  try {
    await stateMachine.saveToStorage();
  } catch (error) {
    logger.error(`[${sourceTag}] 保存完成状态失败:`, error);
  }
}

/**
 * 验证码超时/失败的统一处理：决定重试 vs 进入 ERROR
 * @param {Function} retryFn - 重试函数
 * @param {string} errorMsg - 失败描述（写入状态机 metadata）
 */
function handleVerificationTimeout(retryFn, errorMsg = '验证码获取超时') {
  if (stateMachine.canRetry()) {
    stateMachine.transition(RegistrationStateMachine.STATES.RETRYING);
    stateMachine.saveToStorage().catch(err => logger.error('[StateMachine] 保存状态失败:', err));
    log('⏱️ 验证码超时，准备重试...', 'warning');
    setTimeout(retryFn, 3000);
  } else {
    stateMachine.transition(RegistrationStateMachine.STATES.ERROR, { error: errorMsg });
    stateMachine.saveToStorage().catch(err => logger.error('[StateMachine] 保存状态失败:', err));
    log('⏱️ 验证码获取超时，已达最大重试次数', 'error');
  }
}

// 停止 Realtime 监听
function stopRealtimeMonitoring() {
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
    realtimeChannel = null;
    log('🔕 已停止 Realtime 监听');
  }
  isMonitoring = false;
  if (monitorCountdownHandle) {
    clearInterval(monitorCountdownHandle);
    monitorCountdownHandle = null;
  }
  updateStatus('idle', '就绪');
  
  // 隐藏停止按钮，恢复开始按钮
  document.getElementById('stop-btn').classList.add('hidden');
  document.getElementById('start-btn').classList.remove('hidden');
  
  // 决策理由：重置按钮文本，避免显示错误状态
  updateButtonState('start');
}

// 手动停止监听
async function stopMonitoring() {
  console.log('[stopMonitoring] 被调用, isMonitoring:', isMonitoring);
  
  if (isMonitoring) {
    stopRealtimeMonitoring();
    
    // 决策理由：用户手动停止，重置状态机到IDLE
    stateMachine.reset();
    await stateMachine.clearStorage();
    
    updateStatus('idle', '已停止');
    log('⏹️ 用户手动停止监听');
  } else {
    console.log('[stopMonitoring] isMonitoring为false，无需停止');
    log('⚠️ 当前没有正在进行的监听', 'warning');
  }
}

// 重新开始注册
async function resetRegistration() {
  log('🔄 重新开始注册流程...');
  
  // 停止当前监听（如果有）
  if (isMonitoring) {
    stopRealtimeMonitoring();
  }
  
  // 重置状态机
  stateMachine.reset();
  await stateMachine.clearStorage();
  
  // 清空当前账号
  currentAccount = null;
  
  // 重置UI
  resetUI();
  
  // 清空日志
  document.getElementById('logs').innerHTML = '';
  
  updateStatus('idle', '就绪');
  log('✅ 已重置，可以开始新的注册');
}

// 显示验证码
function displayVerificationCode(code) {
  updateStatus('success', '验证码已接收');
  
  // 显示账号信息区域
  const accountInfoDiv = document.getElementById('current-account');
  accountInfoDiv.classList.remove('hidden');
  
  // 填充账号信息
  document.getElementById('account-email').textContent = currentAccount.email;
  document.getElementById('account-password').textContent = currentAccount.password;
  document.getElementById('account-username').textContent = currentAccount.username;
  
  // 检查是否已存在验证码字段，避免重复创建
  let codeField = document.getElementById('code-field-container');
  
  if (!codeField) {
    // 首次创建验证码字段（使用 DOM API 避免 XSS，并直接绑定事件无需 setTimeout）
    codeField = document.createElement('div');
    codeField.id = 'code-field-container';
    codeField.className = 'field';

    const label = document.createElement('label');
    label.textContent = '验证码:';
    codeField.appendChild(label);

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const codeSpan = document.createElement('span');
    codeSpan.id = 'verification-code';
    codeSpan.style.cssText = 'font-weight: bold; color: #10b981; font-size: 16px;';
    codeSpan.textContent = String(code);
    row.appendChild(codeSpan);

    const copyBtn = document.createElement('button');
    copyBtn.id = 'copy-code-btn';
    copyBtn.className = 'btn btn-primary';
    copyBtn.style.cssText = 'padding: 4px 12px; font-size: 12px;';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
        log('✅ 验证码已复制到剪贴板');
        copyBtn.textContent = '已复制';
        copyBtn.style.background = '#059669';
        setTimeout(() => {
          copyBtn.textContent = '复制';
          copyBtn.style.background = '#10b981';
        }, 2000);
      } catch (error) {
        log('❌ 复制失败: ' + error.message, 'error');
        ui.alert('复制失败，请手动复制: ' + code, { title: '❌ 复制失败' });
      }
    });
    row.appendChild(copyBtn);

    codeField.appendChild(row);
    accountInfoDiv.appendChild(codeField);
  } else {
    // 更新已存在的验证码
    const codeSpan = document.getElementById('verification-code');
    if (codeSpan) {
      codeSpan.textContent = String(code);
      log('🔄 验证码已更新');
    }
  }
  
  // 自动复制到剪贴板
  // 自动复制到剪贴板
  navigator.clipboard.writeText(code).then(() => {
    log('📋 验证码已自动复制到剪贴板');
  }).catch(err => {
    console.error('自动复制失败:', err);
  });
}

// 复制到剪贴板工具函数
async function copyToClipboard(text, label) {
  if (!text) {
    log('❌ 无内容可复制', 'error');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(text);
    log(`✅ ${label}已复制到剪贴板`);
  } catch (error) {
    log(`❌ 复制失败: ${error.message}`, 'error');
  }
}

// 查看账号列表（跳转到账号管理页面）
async function viewAccounts() {
  try {
    window.location.href = 'accounts.html';
  } catch (error) {
    log('❌ 打开账号管理失败: ' + error.message, 'error');
  }
}

// 更新状态
function updateStatus(status, text) {
  const indicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  
  indicator.className = `indicator ${status}`;
  statusText.textContent = text;
}

// 显示账号信息
function displayAccountInfo(account) {
  if (!account) {
    console.warn('[Popup] displayAccountInfo: account为空');
    return;
  }
  
  const accountInfoDiv = document.getElementById('current-account');
  accountInfoDiv.classList.remove('hidden');
  document.getElementById('account-email').textContent = account.email || 'N/A';
  document.getElementById('account-password').textContent = account.password || 'N/A';
  document.getElementById('account-username').textContent = account.username || 'N/A';
  const sidEl = document.getElementById('account-session');
  if (sidEl) {
    const sidShort = (account.session_id || '').slice(0, 8);
    sidEl.textContent = sidShort || 'N/A';
  }
}

// 根据状态更新UI
function updateUIFromState(state, metadata) {
  const statusText = RegistrationStateMachine.STATE_TEXT[state] || '未知状态';
  const progressContainer = document.querySelector('.progress-container');
  
  // 更新状态指示器
  if (state === RegistrationStateMachine.STATES.IDLE) {
    updateStatus('idle', statusText);
    if (progressContainer) progressContainer.classList.add('hidden');
  } else if (state === RegistrationStateMachine.STATES.ERROR) {
    updateStatus('error', statusText + (metadata.error ? ': ' + metadata.error : ''));
    if (progressContainer) progressContainer.classList.remove('hidden');
  } else if (state === RegistrationStateMachine.STATES.COMPLETED) {
    updateStatus('success', statusText);
    if (progressContainer) progressContainer.classList.remove('hidden');
  } else if (state === RegistrationStateMachine.STATES.RETRYING) {
    updateStatus('running', statusText + ` (${stateMachine.retryCount}/${stateMachine.maxRetries})`);
    if (progressContainer) progressContainer.classList.remove('hidden');
  } else {
    updateStatus('running', statusText);
    if (progressContainer) progressContainer.classList.remove('hidden');
  }
}

// 更新进度条
function updateProgressBar(progress) {
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const progressContainer = document.querySelector('.progress-container');

  if (progressBar) {
    progressBar.style.width = progress + '%';
  }

  if (progressText) {
    progressText.textContent = progress + '%';
  }

  // 决策理由：同步 ARIA 进度值，让屏幕阅读器正确朗读进度
  if (progressContainer) {
    progressContainer.setAttribute('aria-valuenow', String(progress));
  }
}

// 重置UI
function resetUI() {
  document.getElementById('stop-btn').classList.add('hidden');
  document.getElementById('start-btn').classList.remove('hidden');
  isMonitoring = false;
  
  // 隐藏账号信息
  const accountInfoDiv = document.getElementById('current-account');
  if (accountInfoDiv) {
    accountInfoDiv.classList.add('hidden');
  }
  
  // 重置进度条
  updateProgressBar(0);
  const progressContainer = document.querySelector('.progress-container');
  if (progressContainer) {
    progressContainer.classList.add('hidden');
  }
}

/**
 * 更新按钮状态
 * @param {string} mode - 'start' | 'continue' | 'stop'
 */
function updateButtonState(mode) {
  const startBtn = document.getElementById('start-btn');
  
  if (mode === 'continue') {
    startBtn.textContent = '继续注册';
    startBtn.classList.add('btn-continue');
    log('💡 点击"继续注册"可恢复未完成的流程');
  } else if (mode === 'start') {
    startBtn.textContent = '开始注册';
    startBtn.classList.remove('btn-continue');
  } else if (mode === 'stop') {
    startBtn.classList.add('hidden');
    document.getElementById('stop-btn').classList.remove('hidden');
  }
}

/**
 * 更新账号状态到后端
 */
async function updateAccountStatus(email, status, verificationCode = null) {
  const updateData = {
    status: status,
    updated_at: new Date().toISOString()
  };
  
  if (status === 'verified' && verificationCode) {
    updateData.verification_code = verificationCode;
    updateData.verified_at = new Date().toISOString();
  }
  
  try {
    const response = await apiClient.updateAccount({ email, ...updateData });

    if (!response?.success) {
      throw new Error(response?.error || '更新账号状态失败');
    }
    
    if (currentAccount && currentAccount.email === email) {
      currentAccount.status = status;
      if (verificationCode) {
        currentAccount.verification_code = verificationCode;
      }
      if (status === 'verified') {
        currentAccount.verified_at = new Date().toISOString();
      }
      await dbManager.saveAccount(currentAccount);
    }
    
    return true;
  } catch (error) {
    console.error('[Popup] 更新账号状态失败:', error);
    throw error;
  }
}

// 日志
// 决策理由：UI 日志面板始终显示给用户，console 输出经 logger 受 LOG_LEVEL 控制
function log(message, type = 'info') {
  const logs = document.getElementById('logs');
  const logItem = document.createElement('div');
  logItem.className = 'log-item';
  
  // 根据类型添加CSS类（而不是直接设置颜色）
  if (type === 'error') {
    logItem.classList.add('error');
  } else if (type === 'success') {
    logItem.classList.add('success');
  } else if (type === 'warning') {
    logItem.classList.add('warning');
  }
  
  logItem.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logs.appendChild(logItem);
  logs.scrollTop = logs.scrollHeight;
  
  // 输出到 console，按 LOG_LEVEL 过滤
  const prefixed = `[Popup] ${message}`;
  if (type === 'error') {
    logger.error(prefixed);
  } else if (type === 'warning') {
    logger.warn(prefixed);
  } else {
    logger.info(prefixed);
  }
}

// 打开超级智能大脑面板
async function openSuperBrain() {
  if (!superBrain) {
    ui.toast('超级智能大脑未初始化', 'warning');
    return;
  }
  
  log('🧠 启动超级智能大脑诊断...');
  
  // 显示加载提示
  const container = document.getElementById('brain-container');
  container.innerHTML = `
    <div class="brain-panel">
      <div style="padding: 60px 40px; text-align: center;">
        <div style="font-size: 48px; animation: brainPulse 1s ease-in-out infinite;">🧠</div>
        <div style="margin-top: 20px; color: white; font-size: 16px;">正在执行全面诊断...</div>
        <div style="margin-top: 10px; color: rgba(255,255,255,0.7); font-size: 12px;">检测前端、后端、关键链路与上游探测</div>
      </div>
    </div>
  `;
  
  try {
    await superBrain.showPanel(container);
    log('✅ 诊断完成');
  } catch (error) {
    log('❌ 诊断失败: ' + error.message, 'error');
    container.innerHTML = '';
  }
}

// 打开统计页面
function viewStats() {
  log('📊 打开统计分析页面');
  chrome.windows.create({
    url: chrome.runtime.getURL('popup/stats.html'),
    type: 'popup',
    width: 520,
    height: 650
  });
}
