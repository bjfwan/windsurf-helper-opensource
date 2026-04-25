/**
 * 超级智能状态验证器
 * 决策理由：通过多维度检测真实状态，而非单纯依赖本地缓存
 */

class SmartValidator {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
  }
  
  /**
   * 智能验证账号状态
   * @param {Object} account - 本地保存的账号信息
   * @returns {Object} { isValid, realStatus, reason, needReset }
   */
  async validateAccountState(account) {
    if (!account || !account.email) {
      return {
        isValid: false,
        realStatus: 'none',
        reason: '无账号信息',
        needReset: true
      };
    }
    
    console.log('[SmartValidator] 开始智能验证账号:', account.email);
    
    // 验证账号数据完整性
    const accountValidation = this.validateAccount(account);
    if (!accountValidation.valid) {
      return {
        isValid: false,
        realStatus: 'invalid',
        reason: accountValidation.issues.join(', '),
        needReset: true
      };
    }
    
    // 多维度检测
    const checks = {
      supabaseStatus: await this.checkSupabaseStatus(account.email),
      verificationCode: await this.checkVerificationCode(account.email, account.session_id),
      timeValidity: this.checkTimeValidity(account),
      stateConsistency: this.checkStateConsistency(account)
    };
    
    console.log('[SmartValidator] 检测结果:', checks);
    
    // 智能决策引擎
    return this.makeIntelligentDecision(checks, account);
  }

  async checkSupabaseStatus(email) {
    // 决策理由：扩展已切换为 API 模式，无直连 Supabase 客户端时跳过该检查
    if (!this.supabase || !this.supabase.url || !this.supabase.key) {
      return { exists: false, skipped: true };
    }
    try {
      const response = await fetch(
        `${this.supabase.url}/rest/v1/accounts?email=eq.${encodeURIComponent(email)}&select=*&order=created_at.desc&limit=1`,
        {
          headers: {
            'apikey': this.supabase.key,
            'Authorization': `Bearer ${this.supabase.key}`,
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache'
          }
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const account = data[0];
          return {
            exists: true,
            status: account.status,
            verified_at: account.verified_at,
            created_at: account.created_at
          };
        }
      }
      
      return { exists: false };
    } catch (error) {
      console.warn('[SmartValidator] Supabase检查失败:', error);
      return { exists: false, error: error.message };
    }
  }
  
  /**
   * 检查是否收到验证码
   */
  async checkVerificationCode(email, sessionId) {
    if (!this.supabase || !this.supabase.url || !this.supabase.key) {
      return { exists: false, skipped: true };
    }
    try {
      // 严格匹配：同时使用 session_id 和 email 查询
      let query = `${this.supabase.url}/rest/v1/verification_logs?order=received_at.desc&limit=1`;
      if (sessionId && email) {
        query = `${this.supabase.url}/rest/v1/verification_logs?session_id=eq.${encodeURIComponent(sessionId)}&email=eq.${encodeURIComponent(email)}&order=received_at.desc&limit=1`;
      } else if (sessionId) {
        query = `${this.supabase.url}/rest/v1/verification_logs?session_id=eq.${encodeURIComponent(sessionId)}&order=received_at.desc&limit=1`;
      } else if (email) {
        query = `${this.supabase.url}/rest/v1/verification_logs?email=eq.${encodeURIComponent(email)}&order=received_at.desc&limit=1`;
      }

      const response = await fetch(query, {
        headers: {
          'apikey': this.supabase.key,
          'Authorization': `Bearer ${this.supabase.key}`,
          'Cache-Control': 'no-store',
          'Pragma': 'no-cache'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          return {
            exists: true,
            code: data[0].code,
            received_at: data[0].received_at
          };
        }
      }
      
      return { exists: false };
    } catch (error) {
      console.warn('[SmartValidator] 验证码检查失败:', error);
      return { exists: false, error: error.message };
    }
  }
  
  /**
   * 检查时间有效性
   */
  checkTimeValidity(account) {
    const now = Date.now();
    const createdAt = account.created_at ? new Date(account.created_at).getTime() : now;
    const elapsed = now - createdAt;
    
    const EXPIRE_TIME = 30 * 60 * 1000; // 30分钟过期
    const WARNING_TIME = 10 * 60 * 1000; // 10分钟警告
    
    return {
      elapsed: elapsed,
      isExpired: elapsed > EXPIRE_TIME,
      isWarning: elapsed > WARNING_TIME && elapsed <= EXPIRE_TIME,
      reason: elapsed > EXPIRE_TIME ? '账号已过期（超过30分钟）' : 
              elapsed > WARNING_TIME ? '账号即将过期' : '时间正常'
    };
  }
  
  /**
   * 检查状态一致性
   */
  checkStateConsistency(account) {
    const hasEmail = !!account.email;
    const hasPassword = !!account.password;
    const hasStatus = !!account.status;
    
    return {
      isComplete: hasEmail && hasPassword,
      hasAllFields: hasEmail && hasPassword && hasStatus,
      reason: !hasEmail ? '缺少邮箱' : 
              !hasPassword ? '缺少密码' : 
              !hasStatus ? '缺少状态' : '字段完整'
    };
  }
  
  /**
   * 智能决策引擎
   */
  makeIntelligentDecision(checks, account) {
    const { supabaseStatus, verificationCode, timeValidity, stateConsistency } = checks;
    
    // 决策规则1：Supabase显示已验证 → 真正完成
    if (supabaseStatus.exists && supabaseStatus.status === 'verified') {
      return {
        isValid: true,
        realStatus: 'verified',
        reason: '账号已在Supabase中验证完成',
        needReset: true, // 需要重置，允许新注册
        recommendation: 'clear' // 建议清除本地状态
      };
    }
    
    // 决策规则2：收到验证码但未标记完成 → 可以完成
    if (verificationCode.exists && !supabaseStatus.verified_at) {
      return {
        isValid: true,
        realStatus: 'code_received',
        reason: '已收到验证码，可以继续验证',
        needReset: false,
        verificationCode: verificationCode.code,
        recommendation: 'continue' // 建议继续流程
      };
    }
    
    // 决策规则3：时间过期 → 自动清理
    if (timeValidity.isExpired) {
      return {
        isValid: false,
        realStatus: 'expired',
        reason: timeValidity.reason,
        needReset: true,
        recommendation: 'clear'
      };
    }
    
    // 决策规则4：Supabase中不存在但本地有 → 同步失败，重新开始
    if (!supabaseStatus.exists && stateConsistency.isComplete) {
      return {
        isValid: false,
        realStatus: 'sync_failed',
        reason: 'Supabase同步失败，建议重新注册',
        needReset: true,
        recommendation: 'retry'
      };
    }
    
    // 决策规则5：数据不完整 → 清理
    if (!stateConsistency.isComplete) {
      return {
        isValid: false,
        realStatus: 'incomplete',
        reason: stateConsistency.reason,
        needReset: true,
        recommendation: 'clear'
      };
    }
    
    // 决策规则6：正在进行中，时间正常 → 允许继续
    if (supabaseStatus.exists && supabaseStatus.status === 'pending' && !timeValidity.isExpired) {
      return {
        isValid: true,
        realStatus: 'in_progress',
        reason: '注册流程进行中',
        needReset: false,
        recommendation: 'continue'
      };
    }
    
    // 默认：状态未知，建议清理
    return {
      isValid: false,
      realStatus: 'unknown',
      reason: '状态未知，建议重新开始',
      needReset: true,
      recommendation: 'clear'
    };
  }
  
  /**
   * 自动执行推荐操作
   */
  async executeRecommendation(recommendation, stateMachine) {
    console.log('[SmartValidator] 执行推荐操作:', recommendation);
    
    switch (recommendation.recommendation) {
      case 'clear':
        console.log('🧹 自动清理过期/无效状态');
        stateMachine.reset();
        await stateMachine.clearStorage();
        return { action: 'cleared', message: '已清理无效状态，可以开始新注册' };
        
      case 'continue':
        console.log('▶️ 允许继续现有流程');
        return { 
          action: 'continue', 
          message: '检测到进行中的注册，可以继续',
          verificationCode: recommendation.verificationCode
        };
        
      case 'retry':
        console.log('🔄 建议重试');
        stateMachine.reset();
        await stateMachine.clearStorage();
        return { action: 'retry', message: '同步失败，已重置，请重新注册' };
        
      default:
        return { action: 'none', message: '无需操作' };
    }
  }
  
  /**
   * 完整的智能检测并自动处理
   */
  async smartCheckAndHandle(account, stateMachine) {
    const validation = await this.validateAccountState(account);
    
    console.log('[SmartValidator] 验证结果:', validation);
    
    // 自动执行推荐操作
    const result = await this.executeRecommendation(validation, stateMachine);
    
    return {
      validation,
      result,
      canStartNew: validation.needReset || validation.realStatus === 'none'
    };
  }
}
