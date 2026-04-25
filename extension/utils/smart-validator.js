class SmartValidator {
  constructor(apiClient, tempMailClient = null, dbManager = null) {
    this.apiClient = apiClient;
    this.tempMailClient = tempMailClient;
    this.dbManager = dbManager;
  }

  async validateAccountState(account) {
    if (!account || !account.email) {
      return {
        isValid: false,
        realStatus: 'none',
        reason: '无账号信息',
        needReset: true,
        recommendation: 'clear'
      };
    }

    const stateConsistency = this.checkStateConsistency(account);
    if (!stateConsistency.isComplete) {
      return {
        isValid: false,
        realStatus: 'incomplete',
        reason: stateConsistency.reason,
        needReset: true,
        recommendation: 'clear'
      };
    }

    const [backendAccount, mailboxStatus, localAccount] = await Promise.all([
      this.checkBackendAccount(account.email),
      this.checkMailboxStatus(account),
      this.checkLocalAccount(account.email)
    ]);

    const timeValidity = this.checkTimeValidity(account);

    if (backendAccount.exists && backendAccount.status === 'verified') {
      return {
        isValid: true,
        realStatus: 'verified',
        reason: '后端已确认验证完成',
        needReset: true,
        recommendation: 'clear',
        verificationCode: backendAccount.verification_code || localAccount.verification_code || ''
      };
    }

    if (mailboxStatus.exists && mailboxStatus.code) {
      return {
        isValid: true,
        realStatus: 'code_received',
        reason: '邮箱已收到验证码，可以继续',
        needReset: false,
        recommendation: 'continue',
        verificationCode: mailboxStatus.code
      };
    }

    if (timeValidity.isExpired) {
      return {
        isValid: false,
        realStatus: 'expired',
        reason: timeValidity.reason,
        needReset: true,
        recommendation: 'clear'
      };
    }

    if (backendAccount.exists && backendAccount.status === 'pending') {
      return {
        isValid: true,
        realStatus: 'in_progress',
        reason: '后端记录仍在进行中',
        needReset: false,
        recommendation: 'continue'
      };
    }

    if (localAccount.exists && localAccount.status === 'verified' && localAccount.verification_code) {
      return {
        isValid: true,
        realStatus: 'verified_local',
        reason: '本地已保存验证结果',
        needReset: true,
        recommendation: 'clear',
        verificationCode: localAccount.verification_code
      };
    }

    if (!backendAccount.exists && !backendAccount.skipped && stateConsistency.isComplete) {
      return {
        isValid: false,
        realStatus: 'sync_failed',
        reason: '后端未找到账号记录，建议重新注册',
        needReset: true,
        recommendation: 'retry'
      };
    }

    return {
      isValid: false,
      realStatus: 'unknown',
      reason: '状态未知，建议重新开始',
      needReset: true,
      recommendation: 'clear'
    };
  }

  async checkBackendAccount(email) {
    if (!this.apiClient || typeof this.apiClient.listAccounts !== 'function') {
      return { exists: false, skipped: true };
    }

    try {
      const response = await this.apiClient.listAccounts({ email, limit: 1 });
      const record = Array.isArray(response?.data) ? response.data[0] : null;

      if (!record) {
        return { exists: false, skipped: false };
      }

      return {
        exists: true,
        skipped: false,
        status: String(record.status || 'pending').toLowerCase(),
        verification_code: record.verification_code || '',
        verified_at: record.verified_at || '',
        updated_at: record.updated_at || '',
        record
      };
    } catch (error) {
      return {
        exists: false,
        skipped: true,
        error: error.message
      };
    }
  }

  async checkMailboxStatus(account) {
    if (!this.tempMailClient || typeof this.tempMailClient.confirmVerificationCode !== 'function' || !account.tempMailToken) {
      return { exists: false, skipped: true };
    }

    try {
      this.tempMailClient.currentEmail = account.email;
      this.tempMailClient.currentToken = account.tempMailToken;
      const result = await this.tempMailClient.confirmVerificationCode(account.verification_code || null);
      return {
        exists: !!result?.confirmed,
        skipped: false,
        code: result?.code || '',
        reason: result?.reason || ''
      };
    } catch (error) {
      return {
        exists: false,
        skipped: true,
        error: error.message
      };
    }
  }

  async checkLocalAccount(email) {
    if (!this.dbManager || typeof this.dbManager.getAccount !== 'function') {
      return { exists: false, skipped: true };
    }

    try {
      const response = await this.dbManager.getAccount(email);
      const record = response?.data || null;
      if (!record) {
        return { exists: false, skipped: false };
      }

      return {
        exists: true,
        skipped: false,
        status: String(record.status || 'pending').toLowerCase(),
        verification_code: record.verification_code || '',
        verified_at: record.verified_at || '',
        record
      };
    } catch (error) {
      return {
        exists: false,
        skipped: true,
        error: error.message
      };
    }
  }

  checkTimeValidity(account) {
    const now = Date.now();
    const createdAt = account.created_at ? new Date(account.created_at).getTime() : now;
    const elapsed = now - createdAt;
    const expireTime = 30 * 60 * 1000;
    const warningTime = 10 * 60 * 1000;

    return {
      elapsed,
      isExpired: elapsed > expireTime,
      isWarning: elapsed > warningTime && elapsed <= expireTime,
      reason: elapsed > expireTime ? '账号已过期（超过30分钟）' : elapsed > warningTime ? '账号即将过期' : '时间正常'
    };
  }

  checkStateConsistency(account) {
    const hasEmail = !!account.email;
    const hasPassword = !!account.password;
    return {
      isComplete: hasEmail && hasPassword,
      reason: !hasEmail ? '缺少邮箱' : !hasPassword ? '缺少密码' : '字段完整'
    };
  }

  async executeRecommendation(recommendation, stateMachine) {
    switch (recommendation.recommendation) {
      case 'clear':
        stateMachine.reset();
        await stateMachine.clearStorage();
        return { action: 'cleared', message: '已清理无效状态，可以开始新注册' };
      case 'continue':
        return {
          action: 'continue',
          message: '检测到进行中的注册，可以继续',
          verificationCode: recommendation.verificationCode || ''
        };
      case 'retry':
        stateMachine.reset();
        await stateMachine.clearStorage();
        return { action: 'retry', message: '同步失败，已重置，请重新注册' };
      default:
        return { action: 'none', message: '无需操作' };
    }
  }

  async smartCheckAndHandle(account, stateMachine) {
    const validation = await this.validateAccountState(account);
    const result = await this.executeRecommendation(validation, stateMachine);
    return {
      validation,
      result,
      canStartNew: validation.needReset || validation.realStatus === 'none'
    };
  }
}
