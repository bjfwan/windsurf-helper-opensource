let currentAccount = null;
let isMonitoring = false;
let realtimeChannel = null;
let stateMachine = null;
let smartValidator = null;
let superBrain = null;
let monitorCountdownHandle = null;
let monitorDeadlineTs = 0;

// 邮箱模式配置
let emailConfig = null;
let tempMailClient = null;

// 尝试加载配置文件
try {
  if (typeof EMAIL_CONFIG !== 'undefined') {
    emailConfig = EMAIL_CONFIG;
    console.log('[模式] 配置已加载:', emailConfig.mode);
    
    // 如果是临时邮箱模式，初始化客户端
    if (emailConfig.mode === 'temp-mail' && typeof TempMailClient !== 'undefined') {
      tempMailClient = new TempMailClient(emailConfig.tempMail);
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
  if (!url) return false;
  
  // 标准注册页面
  const standardPatterns = [
    'windsurf.com/account/register'
  ];
  
  // OAuth/Onboarding注册页面
  const oauthPatterns = [
    'windsurf.com/windsurf/signin',
    'workflow=onboarding',
    'prompt=login'
  ];
  
  // 检查标准注册页面
  for (const pattern of standardPatterns) {
    if (url.includes(pattern)) {
      return true;
    }
  }
  
  // 检查OAuth注册页面（需要同时满足多个条件）
  let oauthMatchCount = 0;
  for (const pattern of oauthPatterns) {
    if (url.includes(pattern)) {
      oauthMatchCount++;
    }
  }
  
  // OAuth页面需要匹配至少2个条件才认为是注册页面
  return oauthMatchCount >= 2;
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 决策理由：等待异步初始化完成，避免竞态条件
  await initSupabase();
  await initStateSyncAndAnalytics();
  initStateMachine();
  setupEventListeners();
  await checkAndRestoreState();
  log('✅ 插件已加载 (v2.1 - 优化版)');
  updateStatus('idle', '就绪');
});

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

// 初始化 Supabase
async function initSupabase() {
  try {
    // 决策理由：使用API而非直接Supabase访问，提高安全性
    // supabaseClient = new SupabaseClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
    log('✅ API客户端就绪');
    
    // 初始化 IndexedDB
    await dbManager.init();
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
  smartValidator = new SmartValidator(null);
  
  // 初始化超级智能大脑
  superBrain = new SuperBrain(null, stateMachine, smartValidator);
  
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
      // 显示验证码（如果有）
      if (smartCheck.result.verificationCode) {
        displayVerificationCode(smartCheck.result.verificationCode);
        return; // 直接显示验证码，无需继续
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
    chrome.tabs.create({ url: 'https://windsurf.com/account/register' });
    return;
  }
  
  // 决策理由：继续模式直接填充，新建模式通过background生成账号
  if (isContinue) {
    // 继续模式：直接使用现有账号通知content script填充
    log('📝 使用现有账号继续填充表单');
    
    chrome.tabs.sendMessage(tab.id, {
      action: 'fillForm',
      data: currentAccount
    }, async (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Popup] Runtime错误:', chrome.runtime.lastError);
        stateMachine.transition(RegistrationStateMachine.STATES.ERROR, {
          error: 'Content script通信失败: ' + chrome.runtime.lastError.message
        });
        await stateMachine.saveToStorage();
        log('❌ 通信失败: ' + chrome.runtime.lastError.message, 'error');
        resetUI();
        return;
      }
      
      if (response && response.success) {
        log('✅ 表单已填充');
        displayAccountInfo(currentAccount);
        
        // 决策理由：根据当前状态合法转换到WAITING_VERIFICATION
        const currentState = stateMachine.getState();
        if (currentState !== RegistrationStateMachine.STATES.WAITING_VERIFICATION) {
          // 根据当前状态选择合法的转换路径
          if (currentState === RegistrationStateMachine.STATES.PREPARING) {
            stateMachine.transition(RegistrationStateMachine.STATES.DETECTING_PAGE);
            await stateMachine.saveToStorage();
            stateMachine.transition(RegistrationStateMachine.STATES.FILLING_STEP1);
            await stateMachine.saveToStorage();
          } else if (currentState === RegistrationStateMachine.STATES.DETECTING_PAGE) {
            stateMachine.transition(RegistrationStateMachine.STATES.FILLING_STEP1);
            await stateMachine.saveToStorage();
          }
          
          // 从任何FILLING状态都可以跳到WAITING_VERIFICATION
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
        
        // 决策理由：无论当前状态如何，只要未监听就启动监听
        if (!isMonitoring && currentAccount.email) {
          startRealtimeMonitoring(currentAccount.email);
        }
        
        // 确保显示停止按钮
        document.getElementById('start-btn').classList.add('hidden');
        document.getElementById('stop-btn').classList.remove('hidden');
      } else {
        stateMachine.transition(RegistrationStateMachine.STATES.ERROR, {
          error: response?.error || '填充失败'
        });
        await stateMachine.saveToStorage();
        log('❌ 填充失败: ' + (response?.error || '未知错误'), 'error');
        resetUI();
      }
    });
  } else {
    // 新建模式：根据配置选择账号生成方式
    stateMachine.transition(RegistrationStateMachine.STATES.DETECTING_PAGE);
    await stateMachine.saveToStorage();
    
    // 检查是否使用临时邮箱模式
    if (emailConfig && emailConfig.mode === 'temp-mail' && tempMailClient) {
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
          status: 'pending'
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
        
        // 7. 通知content script填充表单
        chrome.tabs.sendMessage(tab.id, {
          action: 'fillForm',
          data: accountData
        }, async (fillResponse) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            
            // 友好的错误提示
            if (errorMsg.includes('Receiving end does not exist')) {
              log('❌ 页面未就绪，请刷新页面后重试', 'error');
              log('💡 提示: 按 F5 刷新页面，然后重新点击"开始注册"', 'warning');
            } else {
              log('❌ 填充失败: ' + errorMsg, 'error');
            }
            
            resetUI();
            return;
          }
          
          if (fillResponse && fillResponse.success) {
            log('✅ 表单已填充');
            log('🔄 启动临时邮箱验证码监听...');
            
            // 转换到等待验证状态
            stateMachine.transition(RegistrationStateMachine.STATES.WAITING_VERIFICATION, {
              email: accountData.email
            });
            await stateMachine.saveToStorage();
            
            // 启动临时邮箱验证码自动获取
            startTempMailMonitoring(accountData.email);
          }
        });
        
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
      log('❌ 启动失败: ' + (response?.error || '未知错误'), 'error');
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

/**
 * 云端API触发后端监控
 * 决策理由：直接调用云端API服务器，无需本地配置
 */
async function triggerBackendMonitor(email, sessionId) {
  console.log('[triggerBackendMonitor] 开始', { email, sessionId });
  console.log('[triggerBackendMonitor] apiClient存在:', typeof apiClient !== 'undefined');
  console.log('[triggerBackendMonitor] API_CONFIG:', API_CONFIG);
  
  log('☁️ 正在连接云端服务...');
  
  try {
    // 调用云端API启动监控
    console.log('[triggerBackendMonitor] 调用apiClient.startMonitor');
    const result = await apiClient.startMonitor(email, sessionId);
    console.log('[triggerBackendMonitor] API响应:', result);
    
    if (result.success) {
      log('✅ 云端监控已启动');
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
    log('❌ 连接云端服务失败: ' + error.message, 'error');
    log('💡 提示: 请确保API服务器正在运行', 'warning');
    return false;
  }
}

/**
 * 启动临时邮箱验证码监听
 */
async function startTempMailMonitoring(email) {
  if (isMonitoring) {
    log('⚠️ 已在监听验证码，请勿重复操作');
    return;
  }

  if (!tempMailClient) {
    log('❌ 临时邮箱客户端未初始化', 'error');
    return;
  }

  isMonitoring = true;
  log('📧 开始监听临时邮箱: ' + email);
  log('⏳ 预计等待时间: 5分钟（最多60次检查，每5秒一次）');

  try {
    // 使用 tempMailClient 自动获取验证码（内部已实现轮询）
    const result = await tempMailClient.waitForVerificationCode();

    if (result.success && result.code) {
      // 复用统一成功处理：状态/统计/账号持久化
      await handleVerificationCodeReceived(result.code, { sourceTag: '临时邮箱' });
      stopRealtimeMonitoring();
    } else {
      log('⏱️ 验证码获取超时: ' + (result.error || '未知错误'), 'error');
      log('💡 提示: 您可以手动访问临时邮箱网站查看', 'warning');
      log('📧 邮箱地址: ' + email, 'warning');

      stopRealtimeMonitoring();
      // 复用统一超时处理：决定重试 vs ERROR
      handleVerificationTimeout(() => startTempMailMonitoring(email), '验证码获取超时');
    }
  } catch (error) {
    log('❌ 验证码监听失败: ' + error.message, 'error');
    stopRealtimeMonitoring();
  }
}

// 使用 Supabase Realtime 监听验证码（API模式）
function startRealtimeMonitoring(email) {
  if (isMonitoring) {
    log('⚠️ 已在监听验证码，请勿重复操作');
    return;
  }
  
  // API客户端始终可用，无需检查
  isMonitoring = true;
  monitorDeadlineTs = Date.now() + 120000;
  if (monitorCountdownHandle) {
    clearInterval(monitorCountdownHandle);
    monitorCountdownHandle = null;
  }
  monitorCountdownHandle = setInterval(() => {
    const remain = Math.max(0, Math.floor((monitorDeadlineTs - Date.now()) / 1000));
    updateStatus('running', `等待验证码（剩余 ${remain}s）`);
    if (remain <= 0) {
      clearInterval(monitorCountdownHandle);
      monitorCountdownHandle = null;
    }
  }, 1000);
  
  // 获取当前会话ID（优先状态机元数据，其次 currentAccount）
  let sessionId = null;
  try {
    if (stateMachine && typeof stateMachine.getMetadata === 'function') {
      const md = stateMachine.getMetadata();
      sessionId = md && md.session_id ? md.session_id : null;
    }
  } catch {}
  if (!sessionId && currentAccount && currentAccount.session_id) {
    sessionId = currentAccount.session_id;
  }

  // 决策理由：先触发后端监控（异步），再启动前端监听
  triggerBackendMonitor(email, sessionId).catch(err => {
    console.error('[触发后端] 错误:', err);
  });
  
  log('🔔 启动验证码轮询监听...');
  
  // 使用轮询API检查验证码（替代直接Supabase访问）
  let pollingInterval;
  const pollVerificationCode = async () => {
    if (!isMonitoring) {
      clearInterval(pollingInterval);
      return;
    }
    
    try {
      const response = await apiClient.checkCode(sessionId);

      if (response.success && response.code) {
        logger.info('[轮询] 收到验证码:', response.code);
        // 复用统一成功处理（API 模式需要同步云端状态）
        await handleVerificationCodeReceived(response.code, {
          sourceTag: '轮询',
          updateCloud: true,
          email
        });
        stopRealtimeMonitoring();
      }
    } catch (error) {
      logger.error('[轮询] 检查验证码失败:', error);
    }
  };
  
  // 立即检查一次，然后每5秒轮询一次
  pollVerificationCode();
  pollingInterval = setInterval(pollVerificationCode, API_CONFIG.POLL_INTERVAL);
  realtimeChannel = { unsubscribe: () => clearInterval(pollingInterval) };
  
  log('✅ 验证码轮询已启动（每5秒检查一次）');
  
  // 设置120秒超时（复用统一超时处理）
  setTimeout(() => {
    if (isMonitoring) {
      stopRealtimeMonitoring();
      handleVerificationTimeout(() => startRealtimeMonitoring(email), '验证码监听超时');
    }
  }, 120000);
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

  // 统计：记录步骤完成
  try {
    await analytics.recordStepEnd('waiting_verification', true);
  } catch (error) {
    logger.error('[Analytics] 记录步骤失败:', error);
  }

  // 状态机转换到完成
  stateMachine.transition(RegistrationStateMachine.STATES.COMPLETED, {
    verificationCode: code
  });
  try {
    await stateMachine.saveToStorage();
  } catch (error) {
    logger.error(`[${sourceTag}] 保存状态失败:`, error);
  }

  // 持久化账号状态
  if (currentAccount) {
    currentAccount.status = 'verified';
    currentAccount.verification_code = code;
    try {
      await dbManager.saveAccount(currentAccount);
      log('✅ 账号状态已更新');
    } catch (e) {
      logger.error('[DB] 保存账号失败:', e);
    }
  }

  // 仅 API 模式需要把状态同步回云端
  if (updateCloud && email) {
    try {
      await updateAccountStatus(email, 'verified', code);
      log('✅ 账号状态已同步到云端');
    } catch (error) {
      logger.error(`[${sourceTag}] 更新账号状态失败:`, error);
    }
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
 * 更新账号状态到Supabase
 * 决策理由：O(1)复杂度的单次HTTP请求，性能可接受
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
    // 使用API而不是直接访问Supabase
    const response = await fetch(
      `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.UPDATE_ACCOUNT}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, ...updateData })
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    // 同步更新IndexedDB
    if (currentAccount && currentAccount.email === email) {
      currentAccount.status = status;
      if (verificationCode) {
        currentAccount.verification_code = verificationCode;
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
        <div style="margin-top: 10px; color: rgba(255,255,255,0.7); font-size: 12px;">检测前端、后端、Supabase、Native Messaging</div>
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

