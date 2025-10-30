/**
 * Background Service Worker - 管理状态和 Supabase 连接（架构重构版）
 * 决策理由：添加状态持久化和恢复机制，支持中断恢复
 */

importScripts('../config.js', '../utils/email-generator.js');

console.log('[Background] Service worker initialized (v2.0)');

let currentRegistration = null;
const MAX_RETRY_ATTEMPTS = 3;

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
    console.log('[Background] Cloudflare验证等待中');
    // 不作为错误处理，等待用户手动完成
  }
  
  return true;
});

/**
 * 开始注册流程
 */
async function startRegistration(tabId) {
  console.log('[Background] 开始注册流程');
  
  try {
    // 生成账号信息
    const sessionId = generateUUID();
    const accountData = {
      email: generateEmail(EMAIL_CONFIG.prefix, EMAIL_CONFIG.domain),
      password: generatePassword(12),
      username: generateUsername(),
      status: 'pending',
      created_at: new Date().toISOString(),
      session_id: sessionId
    };
    
    currentRegistration = accountData;
    
    console.log('[Background] 账号信息:', accountData);
  
    // 保存到本地存储（状态持久化）
    await saveRegistrationState(accountData);

    // registration_sessions 现在由 start-monitor API 自动处理
    // 保存账号（带重试机制）
    saveToSupabaseWithRetry(accountData, MAX_RETRY_ATTEMPTS);
  
    // 立即通知 content script 填充表单
    console.log('[Background] 发送消息到 content script');
    
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, {
        action: 'fillForm',
        data: accountData
      }, (response) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message;
          console.error('[Background] 发送消息失败:', error);
          reject(new Error(`Content script 通信失败: ${error}`));
        } else if (response && response.success) {
          console.log('[Background] 表单填充成功:', response);
          resolve(accountData);
        } else {
          console.error('[Background] 表单填充失败:', response);
          reject(new Error(response?.error || '表单填充失败'));
        }
      });
    });
    
  } catch (error) {
    console.error('[Background] 注册流程错误:', error);
    throw error;
  }
}

/**
 * 带重试的 Supabase 保存
 */
async function saveToSupabaseWithRetry(data, maxAttempts) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const payload = {
        email: data.email,
        password: data.password,
        username: data.username,
        status: data.status,
        created_at: data.created_at
      };

      // 使用API而不是直接访问Supabase
      const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SAVE_ACCOUNT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        console.log(`[Background] 账号已保存 (第 ${attempt} 次尝试)`);
        return true;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
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
    saveToSupabaseWithRetry,
    getCurrentRegistration,
    saveRegistrationState,
    restoreRegistrationState
  };
}
