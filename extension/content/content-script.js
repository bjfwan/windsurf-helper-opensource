console.log('[Windsurf Helper] Content script loaded (v2.0)');

const upstreamContract = typeof WindsurfProtocol !== 'undefined' && WindsurfProtocol.upstream
  ? WindsurfProtocol.upstream
  : {
      registerUrl: 'https://windsurf.com/account/register',
      standardPatterns: ['windsurf.com/account/register'],
      oauthPatterns: ['windsurf.com/windsurf/signin', 'workflow=onboarding', 'prompt=login'],
      selectors: {
        step1Inputs: 'input[type="text"], input[type="email"]',
        textInputs: 'input[type="text"]',
        emailInputs: 'input[type="email"]',
        passwordInputs: 'input[type="password"]',
        termsCheckbox: 'input[type="checkbox"]',
        verificationInputs: 'input[name="code"], input[name="verificationCode"]',
        buttons: 'button',
        enabledButtons: 'button:not([disabled])',
        submitButtons: 'button[type="submit"]'
      },
      buttonKeywords: {
        continue: ['继续', 'Continue', '下一步', 'Next'],
        submit: ['注册', 'Register', '创建', 'Create', '提交', 'Submit']
      },
      smoke: {
        step1MinInputs: 3,
        step2MinPasswordInputs: 2,
        oauthMinNameInputs: 2
      },
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
      },
      includesKeyword(text = '', keywords = []) {
        return keywords.some(keyword => text.includes(keyword));
      }
    };

function isWindsurfRegistrationPage(url) {
  return upstreamContract.isRegistrationUrl(url);
}

const CONFIG = {
  MAX_WAIT_TIME: 10000,
  ELEMENT_CHECK_INTERVAL: 100,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 2000,
  // 决策理由：字段名沿用 CLOUDFLARE_TIMEOUT 是为了向后兼容，
  // 实际语义是"等提交按钮启用的最大时间"——CF 只是其中一种触发原因。
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
    const passwordInputs = document.querySelectorAll(upstreamContract.selectors.passwordInputs);
    const textInputs = document.querySelectorAll(upstreamContract.selectors.step1Inputs);
    
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
    
    const emailInputs = document.querySelectorAll(upstreamContract.selectors.emailInputs);
    const passwordInputs = document.querySelectorAll(upstreamContract.selectors.passwordInputs);
    const textInputs = document.querySelectorAll(upstreamContract.selectors.textInputs);
    
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

function findButtonByKeywords(keywords, selector = upstreamContract.selectors.buttons) {
  return Array.from(document.querySelectorAll(selector)).find(btn =>
    upstreamContract.includesKeyword((btn.textContent || '').trim(), keywords)
  ) || null;
}

function runSmokeCheck() {
  const step = detectCurrentStep();
  const counts = {
    step1Inputs: document.querySelectorAll(upstreamContract.selectors.step1Inputs).length,
    textInputs: document.querySelectorAll(upstreamContract.selectors.textInputs).length,
    emailInputs: document.querySelectorAll(upstreamContract.selectors.emailInputs).length,
    passwordInputs: document.querySelectorAll(upstreamContract.selectors.passwordInputs).length,
    termsCheckbox: document.querySelectorAll(upstreamContract.selectors.termsCheckbox).length,
    buttons: document.querySelectorAll(upstreamContract.selectors.buttons).length
  };
  const continueButton = findButtonByKeywords(upstreamContract.buttonKeywords.continue);
  const submitButton = findButtonByKeywords(upstreamContract.buttonKeywords.submit);
  const url = window.location.href;
  const urlMatched = upstreamContract.isRegistrationUrl(url);

  let success = false;
  if (step === 'step1') {
    success = urlMatched && counts.step1Inputs >= upstreamContract.smoke.step1MinInputs && !!continueButton;
  } else if (step === 'step2') {
    success = urlMatched && counts.passwordInputs >= upstreamContract.smoke.step2MinPasswordInputs;
  } else if (step === 'oauth_email') {
    success = urlMatched && counts.emailInputs >= 1 && !!continueButton;
  } else if (step === 'oauth_name') {
    success = urlMatched && counts.textInputs >= upstreamContract.smoke.oauthMinNameInputs && !!continueButton;
  } else if (step === 'oauth_full') {
    success = urlMatched && counts.emailInputs >= 1 && counts.passwordInputs >= 1 && !!(continueButton || submitButton);
  }

  return {
    success,
    url,
    urlMatched,
    step,
    counts,
    selectors: {
      continueButton: !!continueButton,
      submitButton: !!submitButton
    }
  };
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
    // 决策理由：填充流程包含 setTimeout 等待按钮启用，需要异步返回结果
    fillVerificationCode(message.code, message.options || {})
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.action === 'detectStep') {
    const step = detectCurrentStep();
    sendResponse({ success: true, step });
  } else if (message.action === 'smokeCheck') {
    sendResponse({ success: true, data: runSmokeCheck() });
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
  
  const inputs = document.querySelectorAll(upstreamContract.selectors.step1Inputs);
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
  
  const emailInput = document.querySelector(upstreamContract.selectors.emailInputs) || inputs[2];
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
    const checkbox = await waitForElement(upstreamContract.selectors.termsCheckbox, 5000);
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
    
    const continueBtn = findButtonByKeywords(
      upstreamContract.buttonKeywords.continue,
      upstreamContract.selectors.enabledButtons
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

  const passwordInputs = document.querySelectorAll(upstreamContract.selectors.passwordInputs);
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

  // 决策理由：旧名 waitForCloudflareAndSubmit 是误导——实际等的是任何让按钮启用
  // 的条件（CF / 表单校验 / 页面加载）。改名后语义诚实，并在内部区分原因。
  console.log('[Content] 步骤2填充完成，等待提交按钮启用...');
  waitForSubmitButtonAndSubmit();
}

/**
 * 探测页面上是否真的存在 Cloudflare Turnstile / Challenge 控件
 * 决策理由：原代码把"按钮没启用"一律视为 Cloudflare 等待，导致大量误报。
 * 这里通过 Cloudflare 自家 iframe 的 src / class / title 真正确认其存在。
 */
function detectCloudflareChallenge() {
  const probes = [
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    'iframe[title*="Cloudflare"]',
    'iframe[title*="cloudflare"]',
    'iframe[title*="challenge"]',
    '.cf-turnstile',
    '#cf-chl-widget',
    'div[data-sitekey][data-callback]'
  ];
  for (const selector of probes) {
    if (document.querySelector(selector)) {
      return true;
    }
  }
  return false;
}

/**
 * 等"继续/提交"按钮启用并自动点击。
 * 决策理由：按钮 disabled 可能由以下任一原因导致——
 *   1) Cloudflare 验证未通过
 *   2) 表单字段还没通过校验（密码/条款）
 *   3) 页面 React 还没刷新出可点击状态
 * 函数会先探测 Cloudflare 是否真的出现，根据结果给出准确日志，
 * 超时时再二次探测，避免输出"Cloudflare 等待中"的误导消息。
 *
 * 决策理由（资源管理）：
 *   Windsurf 是 React SPA——提交后 URL 切到 /verify-code 但不卸载页面，
 *   `beforeunload` / `visibilitychange` 都不会触发。如果只清 interval
 *   不清 30s timeout，那个定时器会在 SPA 跳转后继续 tick，最终在新页面
 *   里找不到 Step2 的按钮，错误地报"按钮未启用"。
 *
 *   用 cleanup() + cleanedUp 标志做互斥锁：成功 / 超时只能被触发一次，
 *   并互相清理对方的定时器。
 */
function waitForSubmitButtonAndSubmit() {
  const initiallyHasCf = detectCloudflareChallenge();
  const initialReason = initiallyHasCf ? 'Cloudflare 验证' : '表单校验/页面就绪';
  console.log(`[Content] 等待提交按钮启用（当前原因：${initialReason}）...`);

  let timeoutHandle = null;
  let cleanedUp = false;
  let checkInterval = null;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (checkInterval !== null) {
      clearInterval(checkInterval);
      removeFromActiveIntervals(checkInterval);
    }
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      const idx = activeTimeouts.indexOf(timeoutHandle);
      if (idx > -1) activeTimeouts.splice(idx, 1);
      timeoutHandle = null;
    }
  };

  checkInterval = setInterval(() => {
    if (cleanedUp) return;
    const continueBtn = findButtonByKeywords(
      upstreamContract.buttonKeywords.continue,
      upstreamContract.selectors.enabledButtons
    );

    if (continueBtn) {
      const stillHasCf = detectCloudflareChallenge();
      const successReason = initiallyHasCf
        ? (stillHasCf ? 'Cloudflare 已通过（控件残留）' : 'Cloudflare 验证已通过')
        : '表单校验通过';
      console.log(`[Content] 按钮启用：${successReason}`);
      cleanup(); // 关键：成功时同时清 30s 超时定时器

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

  timeoutHandle = setTimeout(() => {
    if (cleanedUp) return;
    cleanup();

    const stillHasCf = detectCloudflareChallenge();
    if (stillHasCf) {
      console.log('[Content] 超时：Cloudflare 验证未通过，需要手动完成');
      chrome.runtime.sendMessage({
        action: 'cloudflareWaiting',
        message: '请手动完成 Cloudflare 验证'
      });
    } else {
      // 决策理由：诚实告诉用户"页面里根本没 Cloudflare，是别的原因"，
      // 不再借 Cloudflare 之名甩锅。
      console.log('[Content] 超时：未检测到 Cloudflare，按钮仍未启用，可能是表单字段未通过校验或页面未就绪');
      chrome.runtime.sendMessage({
        action: 'submitButtonDisabled',
        message: '提交按钮长时间未启用，请检查：密码强度 / 条款勾选 / 页面是否加载完成'
      });
    }
  }, CONFIG.CLOUDFLARE_TIMEOUT);

  activeTimeouts.push(timeoutHandle);
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

/**
 * 填充验证码到注册页面
 *
 * 决策理由：兼容两种 UI 形态——
 *   1) 单输入框（旧版 input[name="code"]）
 *   2) 6 段式 OTP（windsurf 当前形态：6 个 maxlength="1" 的 input，
 *      第 1 个 autocomplete="one-time-code"，其余 autocomplete="off"）
 *
 * 默认行为：填充 + 自动点击"Create account"等提交按钮（沿用旧逻辑），
 * 调用方传 { autoSubmit: false } 可只填不提交。
 *
 * 返回 { success, mode, filledCount, submitted, reason } 便于 popup 给用户准确反馈。
 */
async function fillVerificationCode(code, options = {}) {
  const codeStr = String(code || '').trim();
  const autoSubmit = options.autoSubmit !== false;
  console.log(`[Content] 填充验证码: ${codeStr} (autoSubmit=${autoSubmit})`);

  if (!codeStr) {
    return { success: false, reason: '验证码为空' };
  }

  // 1) 优先尝试 6 段式 OTP（windsurf 当前形态）
  const segmented = locateSegmentedOtpInputs(codeStr.length);
  if (segmented.length === codeStr.length) {
    fillSegmentedOtp(segmented, codeStr);
    const submitted = autoSubmit ? await tryAutoSubmitVerification() : false;
    return {
      success: true,
      mode: 'segmented',
      filledCount: segmented.length,
      submitted
    };
  }

  // 2) 退到单输入框（兼容旧 UI）
  const codeInput = document.querySelector(upstreamContract.selectors.verificationInputs);
  if (codeInput) {
    safelyFillInput(codeInput, codeStr);
    const submitted = autoSubmit ? await tryAutoSubmitVerification() : false;
    return {
      success: true,
      mode: 'single',
      filledCount: 1,
      submitted
    };
  }

  console.warn('[Content] 未找到验证码输入框（既无 6 段 OTP 也无单输入框）');
  return { success: false, reason: '未找到验证码输入框' };
}

/**
 * 找出页面上紧邻分组、长度等于验证码位数的 OTP 输入框组。
 * 决策理由：页面上可能还有其它 maxlength="1" 输入框（如生日选择），
 * 必须按"同一父级 + 数量恰好等于验证码位数"来确定是验证码组。
 */
function locateSegmentedOtpInputs(expectedLen = 6) {
  const candidates = Array.from(document.querySelectorAll(
    upstreamContract.selectors.otpSegmentedInputs
  )).filter(input => {
    // 排除被禁用 / 隐藏的输入框
    if (input.disabled || input.readOnly) return false;
    if (input.type === 'hidden') return false;
    return true;
  });

  if (candidates.length === 0) return [];

  // 决策理由：按 parentElement 分组，挑选数量等于（或最接近）期望位数的那一组
  const groups = new Map();
  for (const input of candidates) {
    const parent = input.parentElement;
    if (!parent) continue;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(input);
  }

  // 优先返回长度刚好 == expectedLen 的分组
  for (const inputs of groups.values()) {
    if (inputs.length === expectedLen) {
      return inputs;
    }
  }

  // 没有完全匹配的，返回最接近的（取最大且 <= expectedLen）
  let best = [];
  for (const inputs of groups.values()) {
    if (inputs.length > best.length && inputs.length <= expectedLen) {
      best = inputs;
    }
  }
  return best;
}

/**
 * 把 N 位验证码逐位填到 N 个独立输入框，并触发递进事件。
 * 决策理由：很多 React/Vue OTP 组件监听 input 事件做"自动跳到下一个框"，
 * 我们必须模拟"逐个键入"的事件序列才能让组件状态正确更新。
 */
function fillSegmentedOtp(inputs, code) {
  console.log(`[Content] 6 段式 OTP 填充: ${code} -> ${inputs.length} 个输入框`);

  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const digit = code[i];

    // 1) 聚焦
    input.focus();

    // 2) 用原生 setter 写值，绕过 React 的 setState 拦截
    nativeSetter.call(input, digit);

    // 3) 模拟键盘输入事件序列，触发 React onChange + 自动跳转焦点
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: digit }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: digit }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: digit }));
  }

  // 4) 最后失焦让校验逻辑跑一次
  const last = inputs[inputs.length - 1];
  if (last) {
    last.dispatchEvent(new Event('blur', { bubbles: true }));
  }
}

/**
 * 找"Create account"等提交按钮并点击。
 * 决策理由：等按钮启用最多 1.5s，避免在页面校验完成前点击导致按钮 disabled 无效。
 */
async function tryAutoSubmitVerification() {
  const maxWaitMs = 1500;
  const checkIntervalMs = 100;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const btn = findButtonByKeywords(
      upstreamContract.buttonKeywords.submit,
      upstreamContract.selectors.enabledButtons
    ) || document.querySelector(`${upstreamContract.selectors.submitButtons}:not([disabled])`);

    if (btn && !btn.disabled) {
      // 留 200ms 让页面状态稳定（部分组件 enable 后会重渲）
      await new Promise(resolve => setTimeout(resolve, 200));
      btn.click();
      console.log('[Content] 已自动点击提交按钮:', btn.textContent?.trim());
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }

  console.log('[Content] 等待提交按钮启用超时，跳过自动提交');
  return false;
}
async function fillOAuthFull(data) {
  console.log('[Content] 执行OAuth完整页面填充');
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const { firstName, lastName } = generateRealName();
  
  const textInputs = document.querySelectorAll(upstreamContract.selectors.textInputs);
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
  
  const emailInput = document.querySelector(upstreamContract.selectors.emailInputs);
  if (emailInput) {
    if (!safelyFillInput(emailInput, data.email)) {
      throw new Error('填充邮箱失败');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  const passwordInputs = document.querySelectorAll(upstreamContract.selectors.passwordInputs);
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
  
  const emailInput = document.querySelector(upstreamContract.selectors.emailInputs);
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
  
  const textInputs = document.querySelectorAll(upstreamContract.selectors.textInputs);
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
    
    const continueBtn = findButtonByKeywords(
      upstreamContract.buttonKeywords.continue,
      upstreamContract.selectors.enabledButtons
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
    
    const submitBtn = findButtonByKeywords(
      upstreamContract.buttonKeywords.submit,
      upstreamContract.selectors.enabledButtons
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
