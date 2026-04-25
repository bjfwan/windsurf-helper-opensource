/**
 * 注册结果核验器
 *
 * 决策理由：注册的"成功"判定不能只看页面状态 + 验证码字符串，
 * 必须再走一层独立核验（后端账号记录 / 邮箱原始邮件），才能避免：
 *   - 验证码已下发但 windsurf 后端拒绝
 *   - 临时邮箱劫持/伪造邮件
 *   - 页面跳转但实际接口失败
 *
 * 三个来源：
 *   1) backend  —— 自建后端 /api/accounts，对邮箱/状态/code 三向校验
 *   2) mailbox  —— 临时邮箱原始邮件，做 from + 验证码二次确认
 *   3) local    —— IndexedDB 本地缓存，仅作为降级证据
 *
 * 输出：
 *   { confirmed, degraded, source, code, attempts, backendAccount, mailboxResult, localAccount, reason }
 *
 *   - confirmed=true  且 degraded=false：强确认（独立来源命中）
 *   - confirmed=true  且 degraded=true ：降级确认（无独立来源可用，
 *                                         但本地记录与期望 code 一致）
 *   - confirmed=false                  ：核验失败
 */

class RegistrationResultVerifier {
  constructor(apiClient, dbManager, tempMailClient) {
    this.apiClient = apiClient;
    this.dbManager = dbManager;
    this.tempMailClient = tempMailClient;

    const policy = (typeof WindsurfProtocol !== 'undefined' && WindsurfProtocol.verification) || {};
    this.policy = {
      retries: Number.isInteger(policy.retries) ? policy.retries : 3,
      retryDelayMs: Number.isInteger(policy.retryDelayMs) ? policy.retryDelayMs : 1500,
      allowDegraded: policy.allowDegraded !== false,
      strongSources: Array.isArray(policy.strongSources) ? policy.strongSources : ['backend', 'mailbox'],
      weakSources: Array.isArray(policy.weakSources) ? policy.weakSources : ['local']
    };
  }

  async verify(account = {}, options = {}) {
    if (!account || !account.email) {
      return this._buildFailure('缺少邮箱', { backendAccount: {}, mailboxResult: {}, localAccount: {} }, []);
    }

    const expectedCode = options.expectedCode || account.verification_code || '';
    const retries = Number.isInteger(options.retries) ? Math.max(1, options.retries) : this.policy.retries;
    const retryDelay = Number.isInteger(options.retryDelay) ? Math.max(0, options.retryDelay) : this.policy.retryDelayMs;
    const allowDegraded = options.allowDegraded !== undefined ? !!options.allowDegraded : this.policy.allowDegraded;
    const attempts = [];
    let lastReport = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const [backendAccount, mailboxResult, localAccount] = await Promise.all([
        this.checkBackendAccount(account.email, expectedCode),
        this.checkMailbox(account, expectedCode),
        this.checkLocalAccount(account.email)
      ]);

      const snapshot = {
        attempt,
        backendConfirmed: !!backendAccount.confirmed,
        mailboxConfirmed: !!mailboxResult.confirmed,
        localConfirmed: !!localAccount.confirmed,
        backendStatus: backendAccount.skipped ? 'skipped' : backendAccount.confirmed ? 'confirmed' : 'pending',
        mailboxStatus: mailboxResult.skipped ? 'skipped' : mailboxResult.confirmed ? 'confirmed' : 'pending'
      };
      attempts.push(snapshot);

      // 强确认：任一独立来源命中即可
      if (this._isStrongConfirmed({ backendAccount, mailboxResult })) {
        return {
          confirmed: true,
          degraded: false,
          source: backendAccount.confirmed ? 'backend' : 'mailbox',
          code: backendAccount.code || mailboxResult.code || expectedCode,
          attempts,
          backendAccount,
          mailboxResult,
          localAccount,
          reason: '注册结果已独立确认'
        };
      }

      lastReport = { backendAccount, mailboxResult, localAccount };
      const shouldRetry =
        attempt < retries &&
        (backendAccount.pending || mailboxResult.pending || backendAccount.retryable || mailboxResult.retryable);

      if (shouldRetry) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    const report = lastReport || { backendAccount: {}, mailboxResult: {}, localAccount: {} };

    // 决策理由：当强来源全部 skipped（不可用）且本地有记录与期望 code 一致时，
    // 视为"降级确认"——告诉调用方"我们不能强保证，但本地/输入路径自洽"。
    // 业务侧可以根据 degraded 标记决定是否提示用户手动复核。
    if (allowDegraded && this._isDegradedConfirmable(report, expectedCode)) {
      return {
        confirmed: true,
        degraded: true,
        source: 'local',
        code: report.localAccount.code || expectedCode,
        attempts,
        ...report,
        reason: '强确认来源全部不可用，已使用本地降级核验'
      };
    }

    return this._buildFailure(this._summarizeFailure(report, expectedCode, allowDegraded), report, attempts, expectedCode);
  }

  _isStrongConfirmed({ backendAccount, mailboxResult }) {
    if (this.policy.strongSources.includes('backend') && backendAccount.confirmed) {
      return true;
    }
    if (this.policy.strongSources.includes('mailbox') && mailboxResult.confirmed) {
      return true;
    }
    return false;
  }

  _isDegradedConfirmable(report, expectedCode) {
    const { backendAccount, mailboxResult, localAccount } = report;
    // 强来源必须 *都* skipped（不是 pending），否则说明系统是失败而不是没探到
    if (!backendAccount.skipped) {
      return false;
    }
    if (!mailboxResult.skipped) {
      return false;
    }
    if (!localAccount.confirmed) {
      return false;
    }
    if (expectedCode && localAccount.code && localAccount.code !== expectedCode) {
      return false;
    }
    return true;
  }

  _summarizeFailure(report, expectedCode = '', allowDegraded = true) {
    const { backendAccount = {}, mailboxResult = {}, localAccount = {} } = report;
    const allSkipped = backendAccount.skipped && mailboxResult.skipped;
    if (allSkipped) {
      if (!localAccount.confirmed) {
        return '无可用的独立核验来源';
      }
      if (expectedCode && localAccount.code && localAccount.code !== expectedCode) {
        return '强确认来源不可用，且本地验证码与期望不一致';
      }
      if (!allowDegraded) {
        return '强确认来源不可用，本地记录存在但策略禁用降级';
      }
      return '强确认来源不可用，本地记录无法自洽';
    }
    return backendAccount.reason || mailboxResult.reason || '未能确认注册结果';
  }

  _buildFailure(reason, report, attempts, expectedCode = '') {
    const backendAccount = report?.backendAccount || { skipped: true, reason: '后端核验不可用' };
    const mailboxResult = report?.mailboxResult || { skipped: true, reason: '邮箱核验不可用' };
    const localAccount = report?.localAccount || { confirmed: false, reason: '本地无记录' };
    return {
      confirmed: false,
      degraded: false,
      source: '',
      code: backendAccount.code || mailboxResult.code || localAccount.code || expectedCode,
      attempts: attempts || [],
      backendAccount,
      mailboxResult,
      localAccount,
      reason
    };
  }

  async checkBackendAccount(email, expectedCode = '') {
    if (!this.apiClient || typeof this.apiClient.listAccounts !== 'function') {
      return { confirmed: false, skipped: true, pending: false, retryable: false, reason: '后端客户端不可用' };
    }

    try {
      const response = await this.apiClient.listAccounts({ email, limit: 1 });
      const record = Array.isArray(response?.data) ? response.data[0] : null;

      if (!record) {
        return { confirmed: false, skipped: false, pending: true, retryable: false, reason: '后端未找到账号' };
      }

      const status = String(record.status || '').toLowerCase();
      const code = record.verification_code || '';
      const confirmed = status === 'verified' && !!code && (!expectedCode || code === expectedCode);

      return {
        confirmed,
        skipped: false,
        pending: !confirmed,
        retryable: false,
        reason: confirmed ? '后端已确认验证完成' : '后端尚未确认验证结果',
        code,
        record
      };
    } catch (error) {
      return {
        confirmed: false,
        skipped: false,
        pending: true,
        retryable: true,
        reason: error.message,
        error: error.message
      };
    }
  }

  async checkLocalAccount(email) {
    if (!this.dbManager || typeof this.dbManager.getAccount !== 'function') {
      return { confirmed: false, reason: '本地数据库不可用', code: '' };
    }

    try {
      const response = await this.dbManager.getAccount(email);
      const record = response?.data || null;
      if (!record) {
        return { confirmed: false, reason: '本地未找到账号', code: '' };
      }

      return {
        confirmed: String(record.status || '').toLowerCase() === 'verified' && !!record.verification_code,
        reason: '本地记录可用',
        code: record.verification_code || '',
        record
      };
    } catch (error) {
      return { confirmed: false, reason: error.message, code: '', error: error.message };
    }
  }

  async checkMailbox(account, expectedCode = '') {
    if (!this.tempMailClient || typeof this.tempMailClient.confirmVerificationCode !== 'function' || !account.tempMailToken) {
      return { confirmed: false, skipped: true, pending: false, retryable: false, reason: '邮箱核验未启用', code: '' };
    }

    try {
      this.tempMailClient.currentEmail = account.email;
      this.tempMailClient.currentToken = account.tempMailToken;
      const result = await this.tempMailClient.confirmVerificationCode(expectedCode || null);

      if (result?.confirmed) {
        return {
          confirmed: true,
          skipped: false,
          pending: false,
          retryable: false,
          reason: '邮箱已独立确认',
          code: result.code || expectedCode || '',
          mail: result.mail || null
        };
      }

      return {
        confirmed: false,
        skipped: false,
        pending: true,
        retryable: false,
        reason: result?.reason || '邮箱未确认',
        code: result?.code || ''
      };
    } catch (error) {
      return {
        confirmed: false,
        skipped: false,
        pending: true,
        retryable: true,
        reason: error.message,
        code: '',
        error: error.message
      };
    }
  }
}
