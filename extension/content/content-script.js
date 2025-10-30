console.log('[Windsurf Helper] Content script loaded (v2.0)');

function isWindsurfRegistrationPage(url) {
  if (!url) return false;
  
  const standardPatterns = [
    'windsurf.com/account/register'
  ];
  
  const oauthPatterns = [
    'windsurf.com/windsurf/signin',
    'workflow=onboarding',
    'prompt=login'
  ];
  
  for (const pattern of standardPatterns) {
    if (url.includes(pattern)) {
      return true;
    }
  }
  
  let oauthMatchCount = 0;
  for (const pattern of oauthPatterns) {
    if (url.includes(pattern)) {
      oauthMatchCount++;
    }
  }
  
  return oauthMatchCount >= 2;
}

const CONFIG = {
  MAX_WAIT_TIME: 10000,
  ELEMENT_CHECK_INTERVAL: 100,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 2000,
  CLOUDFLARE_TIMEOUT: 30000
};

let activeIntervals = [];
let activeTimeouts = [];

function waitForElement(selector, timeout = CONFIG.MAX_WAIT_TIME) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkElement = () => {
      const element = document.querySelector(selector);
      
      if (element) {
        console.log(`[Content] 找到元素: ${selector}`);
        resolve(element);
        return;
      }
      
      if (Date.now() - startTime > timeout) {
        console.error(`[Content] 等待元素超时: ${selector}`);
        reject(new Error(`Element not found: ${selector}`));
        return;
      }
      
      setTimeout(checkElement, CONFIG.ELEMENT_CHECK_INTERVAL);
    };
    
    checkElement();
  });
}

function waitForAnyElement(selectors, timeout = CONFIG.MAX_WAIT_TIME) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkElements = () => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          console.log(`[Content] 找到元素: ${selector}`);
          resolve({ element, selector });
          return;
        }
      }
      
      if (Date.now() - startTime > timeout) {
        console.error(`[Content] 等待元素超时: ${selectors.join(', ')}`);
        reject(new Error(`Elements not found: ${selectors.join(', ')}`));
        return;
      }
      
      setTimeout(checkElements, CONFIG.ELEMENT_CHECK_INTERVAL);
    };
    
    checkElements();
  });
}

function safelyFillInput(input, value) {
  if (!input) {
    console.error('[Content] 输入框不存在');
    return false;
  }
  if (value === undefined || value === null) {
    console.error('[Content] 填充值无效:', value);
    return false;
  }
  
  try {
    const stringValue = String(value);
    console.log(`[Content] 准备填充: ${stringValue} 到元素:`, input);
    
    input.value = stringValue;
    
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    nativeInputValueSetter.call(input, stringValue);
    
    input.focus();
    
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    
    if (input.value !== stringValue) {
      console.warn(`[Content] 填充验证失败，期望: ${stringValue}, 实际: ${input.value}`);
      input.value = stringValue;
      nativeInputValueSetter.call(input, stringValue);
    }
    
    console.log(`[Content] ✅ 已填充: ${stringValue}, 当前值: ${input.value}`);
    return input.value === stringValue;
  } catch (error) {
    console.error('[Content] 填充失败:', error);
    return false;
  }
}

function generateRealName() {
  const firstNames = ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles',
                      'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
                     'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'Martin', 'Lee', 'White', 'Harris'];
  
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  
  return { firstName, lastName };
}

function detectCurrentStep() {
  const url = window.location.href;
  console.log('[Content] 检测页面:', url);
  
  if (isWindsurfRegistrationPage(url)) {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    const textInputs = document.querySelectorAll('input[type="text"], input[type="email"]');
    
    if (passwordInputs.length >= 2) {
      return 'step2';
    } else if (textInputs.length >= 3) {
      return 'step1';
    } else {
      return detectOAuthPageStep();
    }
  }
  
  return 'unknown';
}

function detectOAuthPageStep() {
  const url = window.location.href;
  
  if (url.includes('windsurf.com/windsurf/signin') && 
      url.includes('workflow=onboarding')) {
    
    const emailInputs = document.querySelectorAll('input[type="email"]');
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    const textInputs = document.querySelectorAll('input[type="text"]');
    
    if (emailInputs.length > 0 && passwordInputs.length > 0) {
      return 'oauth_full';
    }
    
    if (emailInputs.length > 0 && passwordInputs.length === 0) {
      return 'oauth_email';
    }
    
    if (textInputs.length > 0 && emailInputs.length === 0 && passwordInputs.length === 0) {
      return 'oauth_name';
    }
  }
  
  return 'unknown';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Content] 收到消息:', message);
  
  if (message.action === 'fillForm') {
    handleFillForm(message.data).then(result => {
      sendResponse(result);
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (message.action === 'fillVerificationCode') {
    fillVerificationCode(message.code);
    sendResponse({ success: true });
  } else if (message.action === 'detectStep') {
    const step = detectCurrentStep();
    sendResponse({ success: true, step });
  }
  
  return true;
});

async function handleFillForm(data) {
  console.log('[Content] 开始填充表单:', data);
  
  await chrome.storage.local.set({ currentAccountData: data });
  
  await new Promise(resolve => setTimeout(resolve, 300));
  
  const step = detectCurrentStep();
  console.log('[Content] 检测到步骤:', step);
  
  try {
    if (step === 'step1') {
      await fillStep1WithRetry(data);
      return { success: true, step: 'step1' };
    } else if (step === 'step2') {
      await fillStep2WithRetry(data);
      return { success: true, step: 'step2' };
    } else if (step === 'oauth_full') {
      await fillOAuthFullWithRetry(data);
      return { success: true, step: 'oauth_full' };
    } else if (step === 'oauth_email') {
      await fillOAuthEmailWithRetry(data);
      return { success: true, step: 'oauth_email' };
    } else if (step === 'oauth_name') {
      await fillOAuthNameWithRetry(data);
      return { success: true, step: 'oauth_name' };
    } else {
      throw new Error('无法识别当前步骤，请确认页面URL');
    }
  } catch (error) {
    console.error('[Content] 填充失败:', error);
    return { success: false, error: error.message };
  }
}

async function fillStep1WithRetry(data, attemptCount = 0) {
  console.log(`[Content] 填充步骤1 (尝试 ${attemptCount + 1}/${CONFIG.MAX_RETRY_ATTEMPTS})`);
  
  try {
    await fillStep1(data);
  } catch (error) {
    if (attemptCount < CONFIG.MAX_RETRY_ATTEMPTS - 1) {
      console.warn(`[Content] 步骤1失败，${CONFIG.RETRY_DELAY}ms后重试...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return fillStep1WithRetry(data, attemptCount + 1);
    } else {
      throw error;
    }
  }
}

async function fillStep1(data) {
  console.log('[Content] 执行步骤1填充');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const inputs = document.querySelectorAll('input[type="text"], input[type="email"]');
  if (inputs.length < 3) {
    throw new Error('输入框数量不足');
  }
  
  const { firstName, lastName } = generateRealName();
  
  if (!safelyFillInput(inputs[0], firstName)) {
    throw new Error('填充名失败');
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  
  if (!safelyFillInput(inputs[1], lastName)) {
    throw new Error('填充姓失败');
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  
  const emailInput = document.querySelector('input[type="email"]') || inputs[2];
  if (!safelyFillInput(emailInput, data.email)) {
    throw new Error('填充邮箱失败');
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await checkTermsCheckbox();
  
  await clickContinueButton();
  
  console.log('[Content] 等待步骤2页面加载...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const result = await chrome.storage.local.get(['currentAccountData']);
  if (result.currentAccountData) {
    await fillStep2WithRetry(result.currentAccountData);
  }
}

async function checkTermsCheckbox() {
  try {
    const checkbox = await waitForElement('input[type="checkbox"]', 5000);
    if (checkbox && !checkbox.checked) {
      checkbox.click();
      console.log('[Content] 已勾选同意条款');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (error) {
    console.warn('[Content] 未找到同意条款复选框');
  }
}

async function clickContinueButton() {
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const buttons = Array.from(document.querySelectorAll('button:not([disabled])'));
    const continueBtn = buttons.find(btn => 
      btn.textContent.includes('继续') || 
      btn.textContent.includes('Continue')
    );
    
    if (continueBtn) {
      continueBtn.click();
      console.log('[Content] 已点击"继续"按钮');
    } else {
      throw new Error('未找到"继续"按钮');
    }
  } catch (error) {
    console.error('[Content] 点击继续按钮失败:', error);
    throw error;
  }
}

async function fillStep2WithRetry(data, attemptCount = 0) {
  console.log(`[Content] 填充步骤2 (尝试 ${attemptCount + 1}/${CONFIG.MAX_RETRY_ATTEMPTS})`);
  
  try {
    await fillStep2(data);
  } catch (error) {
    if (attemptCount < CONFIG.MAX_RETRY_ATTEMPTS - 1) {
      console.warn(`[Content] 步骤2失败，${CONFIG.RETRY_DELAY}ms后重试...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return fillStep2WithRetry(data, attemptCount + 1);
    } else {
      throw error;
    }
  }
}

async function fillStep2(data) {
  console.log('[Content] 执行步骤2填充');
  
  await new Promise(resolve => setTimeout(resolve, 800));
  
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  if (passwordInputs.length < 2) {
    throw new Error('密码输入框数量不足');
  }
  
  if (!safelyFillInput(passwordInputs[0], data.password)) {
    throw new Error('填充密码失败');
  }
  await new Promise(resolve => setTimeout(resolve, 400));
  
  if (!safelyFillInput(passwordInputs[1], data.password)) {
    throw new Error('填充密码确认失败');
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log('[Content] 步骤2完成，等待Cloudflare验证...');
  
  waitForCloudflareAndSubmit();
}

function waitForCloudflareAndSubmit() {
  console.log('[Content] 开始监听Cloudflare验证状态...');
  
  const checkInterval = setInterval(() => {
    const buttons = Array.from(document.querySelectorAll('button:not([disabled])'));
    const continueBtn = buttons.find(btn => 
      btn.textContent.includes('继续') || 
      btn.textContent.includes('Continue')
    );
    
    if (continueBtn) {
      clearInterval(checkInterval);
      removeFromActiveIntervals(checkInterval);
      console.log('[Content] Cloudflare验证完成');
      
      const submitTimeout = setTimeout(() => {
        continueBtn.click();
        console.log('[Content] 已自动提交注册表单');
        
        chrome.runtime.sendMessage({
          action: 'registrationSubmitted',
          success: true
        });
      }, 1000);
      
      activeTimeouts.push(submitTimeout);
    }
  }, 1000);
  
  activeIntervals.push(checkInterval);
  
  const timeoutHandler = setTimeout(() => {
    clearInterval(checkInterval);
    removeFromActiveIntervals(checkInterval);
    console.log('[Content] Cloudflare验证等待中（需要手动完成）');
    
    chrome.runtime.sendMessage({
      action: 'cloudflareWaiting',
      message: '请手动完成Cloudflare验证'
    });
  }, CONFIG.CLOUDFLARE_TIMEOUT);
  
  activeTimeouts.push(timeoutHandler);
}

function removeFromActiveIntervals(interval) {
  const index = activeIntervals.indexOf(interval);
  if (index > -1) {
    activeIntervals.splice(index, 1);
  }
}

function cleanupTimers() {
  activeIntervals.forEach(interval => clearInterval(interval));
  activeTimeouts.forEach(timeout => clearTimeout(timeout));
  activeIntervals = [];
  activeTimeouts = [];
  console.log('[Content] 已清理所有定时器');
}

function fillVerificationCode(code) {
  console.log('[Content] 填充验证码:', code);
  
  const codeInput = document.querySelector('input[name="code"], input[name="verificationCode"]');
  
  if (codeInput) {
    safelyFillInput(codeInput, code);
    
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) {
      setTimeout(() => {
        submitBtn.click();
        console.log('[Content] 已自动提交验证码');
      }, 500);
    }
  } else {
    console.warn('[Content] 未找到验证码输入框');
  }
}
async function fillOAuthFull(data) {
  console.log('[Content] 执行OAuth完整页面填充');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const { firstName, lastName } = generateRealName();
  
  const textInputs = document.querySelectorAll('input[type="text"]');
  if (textInputs.length >= 2) {
    if (!safelyFillInput(textInputs[0], firstName)) {
      throw new Error('填充名字失败');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    
    if (!safelyFillInput(textInputs[1], lastName)) {
      throw new Error('填充姓氏失败');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  const emailInput = document.querySelector('input[type="email"]');
  if (emailInput) {
    if (!safelyFillInput(emailInput, data.email)) {
      throw new Error('填充邮箱失败');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  if (passwordInputs.length >= 1) {
    if (!safelyFillInput(passwordInputs[0], data.password)) {
      throw new Error('填充密码失败');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  await checkTermsCheckbox();
  await clickOAuthSubmitButton();
  
  console.log('[Content] OAuth完整页面填充完成');
}

async function fillOAuthEmailWithRetry(data, attemptCount = 0) {
  console.log(`[Content] 填充OAuth邮箱步骤 (尝试 ${attemptCount + 1}/${CONFIG.MAX_RETRY_ATTEMPTS})`);
  
  try {
    await fillOAuthEmail(data);
  } catch (error) {
    if (attemptCount < CONFIG.MAX_RETRY_ATTEMPTS - 1) {
      console.warn(`[Content] OAuth邮箱步骤失败，${CONFIG.RETRY_DELAY}ms后重试...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return fillOAuthEmailWithRetry(data, attemptCount + 1);
    } else {
      throw error;
    }
  }
}

async function fillOAuthEmail(data) {
  console.log('[Content] 执行OAuth邮箱步骤填充');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const emailInput = document.querySelector('input[type="email"]');
  if (emailInput) {
    if (!safelyFillInput(emailInput, data.email)) {
      throw new Error('填充邮箱失败');
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  await clickOAuthContinueButton();
  
  console.log('[Content] OAuth邮箱步骤填充完成');
}

async function fillOAuthNameWithRetry(data, attemptCount = 0) {
  console.log(`[Content] 填充OAuth姓名步骤 (尝试 ${attemptCount + 1}/${CONFIG.MAX_RETRY_ATTEMPTS})`);
  
  try {
    await fillOAuthName(data);
  } catch (error) {
    if (attemptCount < CONFIG.MAX_RETRY_ATTEMPTS - 1) {
      console.warn(`[Content] OAuth姓名步骤失败，${CONFIG.RETRY_DELAY}ms后重试...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return fillOAuthNameWithRetry(data, attemptCount + 1);
    } else {
      throw error;
    }
  }
}

async function fillOAuthName(data) {
  console.log('[Content] 执行OAuth姓名步骤填充');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const { firstName, lastName } = generateRealName();
  
  const textInputs = document.querySelectorAll('input[type="text"]');
  if (textInputs.length >= 2) {
    if (!safelyFillInput(textInputs[0], firstName)) {
      throw new Error('填充名字失败');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    
    if (!safelyFillInput(textInputs[1], lastName)) {
      throw new Error('填充姓氏失败');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  await clickOAuthContinueButton();
  
  console.log('[Content] OAuth姓名步骤填充完成');
}

async function clickOAuthContinueButton() {
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const buttons = Array.from(document.querySelectorAll('button:not([disabled])'));
    const continueBtn = buttons.find(btn => 
      btn.textContent.includes('继续') || 
      btn.textContent.includes('Continue') ||
      btn.textContent.includes('下一步') ||
      btn.textContent.includes('Next')
    );
    
    if (continueBtn) {
      continueBtn.click();
      console.log('[Content] 已点击OAuth继续按钮');
    } else {
      throw new Error('未找到OAuth继续按钮');
    }
  } catch (error) {
    console.error('[Content] 点击OAuth继续按钮失败:', error);
    throw error;
  }
}

async function clickOAuthSubmitButton() {
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const buttons = Array.from(document.querySelectorAll('button:not([disabled])'));
    const submitBtn = buttons.find(btn => 
      btn.textContent.includes('注册') || 
      btn.textContent.includes('Register') ||
      btn.textContent.includes('创建') ||
      btn.textContent.includes('Create') ||
      btn.textContent.includes('提交') ||
      btn.textContent.includes('Submit')
    );
    
    if (submitBtn) {
      submitBtn.click();
      console.log('[Content] 已点击OAuth提交按钮');
    } else {
      await clickOAuthContinueButton();
    }
  } catch (error) {
    console.error('[Content] 点击OAuth提交按钮失败:', error);
    throw error;
  }
}

window.addEventListener('load', () => {
  const step = detectCurrentStep();
  chrome.runtime.sendMessage({
    action: 'pageReady',
    url: window.location.href,
    step: step
  });
  
  console.log('[Content] 页面已加载，当前步骤:', step);
});

window.addEventListener('beforeunload', () => {
  cleanupTimers();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('[Content] 页面隐藏，清理定时器');
    cleanupTimers();
  }
});
