(function (root, factory) {
  const contract = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = contract;
  }
  root.WindsurfProtocol = contract;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  // ============================================================
  // 客户端身份
  // 决策理由：所有版本/客户端名/协议版本都从这里读，避免散落多处。
  // 上游变更或客户端升级时只改这一处。
  // ============================================================
  const client = {
    name: 'windsurf-helper-opensource',
    version: '4.0.0',
    protocolVersion: '1',
    locale: 'zh-CN'
  };

  // ============================================================
  // 后端 / 自建 API
  // 决策理由：endpoints 集中维护；server.js 与 api-client.js 都引用本表，
  // 后端字段命名（响应里的 success/data）也写在 responseShape 中以便文档化。
  // ============================================================
  const api = {
    basePath: '/api',
    endpoints: {
      health: '/api/health',
      startMonitor: '/api/start-monitor',
      checkCode: '/api/check-code',
      accounts: '/api/accounts'
    },
    methods: {
      health: 'GET',
      startMonitor: 'POST',
      checkCode: 'GET',
      listAccounts: 'GET',
      saveAccount: 'POST',
      updateAccount: 'PATCH',
      deleteAccount: 'DELETE'
    },
    headers: {
      apiKey: 'X-API-Key',
      clientName: 'X-Client-Name',
      clientVersion: 'X-Client-Version',
      protocolVersion: 'X-Protocol-Version'
    },
    responseShape: {
      successKey: 'success',
      errorKey: 'error',
      dataKey: 'data'
    }
  };

  // ============================================================
  // 上游（windsurf.com）页面契约
  // 决策理由：把"我们认为上游会长这样"的所有假设写在这里。
  // 一旦上游改版，所有探测/选择器/按钮关键词都从这一份契约推导，
  // 不需要在 popup / content-script / super-brain 三处分别改。
  // ============================================================
  const upstream = {
    registerUrl: 'https://windsurf.com/account/register',
    standardPatterns: ['windsurf.com/account/register'],
    oauthPatterns: ['windsurf.com/windsurf/signin', 'workflow=onboarding', 'prompt=login'],
    selectors: {
      step1Inputs: 'input[type="text"], input[type="email"]',
      textInputs: 'input[type="text"]',
      emailInputs: 'input[type="email"]',
      passwordInputs: 'input[type="password"]',
      termsCheckbox: 'input[type="checkbox"]',
      // 决策理由：兼容三种验证码输入形态——
      //   1) 旧版 input[name="code"]（单输入框）
      //   2) HTML5 OTP 标准 autocomplete="one-time-code"
      //   3) Windsurf 当前的 6 段式：每个 input 都是 maxlength="1" + numeric
      verificationInputs: 'input[name="code"], input[name="verificationCode"], input[autocomplete="one-time-code"]',
      otpSegmentedInputs: 'input[autocomplete="one-time-code"], input[maxlength="1"][inputmode="numeric"], input[maxlength="1"][pattern]',
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
    // 决策理由：明确列出上游探测应跟踪的"关键链路"。
    // 这个清单刻意保持很短——只跟踪能让注册流程完全断的几条，
    // 不做全量接口/选择器接入，降低误报噪音。
    smokePaths: [
      { id: 'register-url', kind: 'url', desc: '注册页 URL 仍可识别' },
      { id: 'step1-inputs', kind: 'dom', desc: 'Step1 至少 3 个输入框' },
      { id: 'step2-passwords', kind: 'dom', desc: 'Step2 至少 2 个密码框' },
      { id: 'continue-button', kind: 'dom', desc: '继续/提交按钮存在' }
    ],
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

  // ============================================================
  // 邮箱来源（provider）抽象
  // 决策理由：把"邮箱来源"这一层抽出来，未来要接 Mailgun / outlook / 其他
  // 临时邮箱服务时只在这里加一项即可，业务代码继续用 provider 字符串识别。
  // ============================================================
  const emailProviders = {
    tempMail: 'temp-mail',     // 浏览器直连临时邮箱 API
    backend: 'qq-imap'         // 通过本地/云端后端走 IMAP
  };

  const emailProviderAliases = {
    'temp-mail': 'temp-mail',
    'tempmail': 'temp-mail',
    'qq-imap': 'qq-imap',
    'imap': 'qq-imap',
    'backend': 'qq-imap'
  };

  function normalizeEmailProvider(value = '') {
    if (!value) {
      return emailProviders.tempMail;
    }
    return emailProviderAliases[String(value).toLowerCase()] || value;
  }

  // ============================================================
  // 注册结果核验策略
  // 决策理由：核验器需要在多个来源里挑选可用的，本表声明每个来源
  // 的优先级与是否允许"降级确认"。verifier 只读这份策略，
  // 业务侧决定"什么算成功"的口径都集中在这里。
  // ============================================================
  const verification = {
    // 强确认（独立来源命中即可判定成功）
    strongSources: ['backend', 'mailbox'],
    // 弱确认（仅本地有记录，没有独立来源；触发降级路径）
    weakSources: ['local'],
    retries: 3,
    retryDelayMs: 1500,
    // 当强来源全部 skipped、且本地状态一致时是否允许 degraded confirm
    allowDegraded: true
  };

  function metadata(apiKey = '') {
    return {
      apiKey,
      clientName: client.name,
      clientVersion: client.version,
      protocolVersion: client.protocolVersion,
      locale: client.locale
    };
  }

  function headers(apiKey = '', extra = {}) {
    return {
      'Content-Type': 'application/json',
      [api.headers.apiKey]: apiKey || '',
      [api.headers.clientName]: client.name,
      [api.headers.clientVersion]: client.version,
      [api.headers.protocolVersion]: client.protocolVersion,
      ...extra
    };
  }

  return {
    client,
    api,
    upstream,
    verification,
    metadata,
    headers,
    emailProviders,
    normalizeEmailProvider
  };
});
