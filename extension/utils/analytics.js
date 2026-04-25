/**
 * 统计分析模块 - 注册流程数据分析
 * 跟踪成功率、耗时、失败原因等关键指标
 */

class RegistrationAnalytics {
  constructor() {
    this.storageKey = 'registration_analytics';
    this.sessionKey = 'current_session';
  }

  /**
   * 初始化统计模块
   */
  async init() {
    const data = await this.loadAnalyticsData();
    if (!data) {
      await this.initializeAnalyticsData();
    }
    logger.debug('[Analytics] 统计模块已初始化');
  }

  /**
   * 初始化统计数据结构
   */
  async initializeAnalyticsData() {
    const initialData = {
      totalAttempts: 0,           // 总尝试次数
      successCount: 0,            // 成功次数
      failureCount: 0,            // 失败次数
      averageTime: 0,             // 平均耗时（秒）
      totalTime: 0,               // 总耗时
      failureReasons: {},         // 失败原因统计
      stepTiming: {               // 各步骤耗时统计
        step1Fill: [],
        step2Fill: [],
        cloudflareWait: [],
        emailWait: []
      },
      dailyStats: {},             // 每日统计
      sessions: [],               // 会话历史（保留最近50个）
      lastUpdated: new Date().toISOString()
    };
    
    await this.saveAnalyticsData(initialData);
    return initialData;
  }

  /**
   * 开始新的注册会话
   * @param {Object} accountInfo - 账号信息
   */
  async startSession(accountInfo) {
    const session = {
      sessionId: this.generateSessionId(),
      email: accountInfo.email,
      startTime: Date.now(),
      endTime: null,
      status: 'in_progress',
      steps: [],
      errors: [],
      totalDuration: 0
    };
    
    await this.saveCurrentSession(session);
    logger.debug('[Analytics] 📊 新会话已开始:', session.sessionId);
    return session;
  }

  /**
   * 记录步骤开始
   * @param {string} stepName - 步骤名称
   */
  async recordStepStart(stepName) {
    const session = await this.getCurrentSession();
    if (!session) return;
    
    session.steps.push({
      name: stepName,
      startTime: Date.now(),
      endTime: null,
      duration: 0,
      success: null
    });
    
    await this.saveCurrentSession(session);
    logger.debug('[Analytics] 📝 步骤开始:', stepName);
  }

  /**
   * 记录步骤完成
   * @param {string} stepName - 步骤名称
   * @param {boolean} success - 是否成功
   */
  async recordStepEnd(stepName, success = true) {
    const session = await this.getCurrentSession();
    if (!session) return;
    
    const step = session.steps.find(s => s.name === stepName && s.endTime === null);
    if (step) {
      step.endTime = Date.now();
      step.duration = step.endTime - step.startTime;
      step.success = success;
      
      await this.saveCurrentSession(session);
      logger.debug('[Analytics] ✅ 步骤完成:', stepName, `(${step.duration}ms)`);
    }
  }

  /**
   * 记录错误
   * @param {string} errorType - 错误类型
   * @param {string} errorMessage - 错误信息
   */
  async recordError(errorType, errorMessage) {
    const session = await this.getCurrentSession();
    if (!session) return;
    
    session.errors.push({
      type: errorType,
      message: errorMessage,
      timestamp: Date.now()
    });
    
    await this.saveCurrentSession(session);
    logger.debug('[Analytics] ❌ 错误记录:', errorType);
  }

  /**
   * 完成会话
   * @param {string} status - 最终状态 ('success' | 'failed' | 'cancelled')
   */
  async endSession(status) {
    const session = await this.getCurrentSession();
    if (!session) return;
    
    session.endTime = Date.now();
    session.totalDuration = session.endTime - session.startTime;
    session.status = status;
    
    // 更新总体统计
    await this.updateOverallStats(session);
    
    // 保存到历史记录
    await this.saveToHistory(session);
    
    // 清除当前会话
    await this.clearCurrentSession();
    
    logger.info('[Analytics] 🏁 会话结束:', status, `(总耗时: ${session.totalDuration}ms)`);
    return session;
  }

  /**
   * 更新总体统计
   * @param {Object} session - 会话数据
   */
  async updateOverallStats(session) {
    const data = await this.loadAnalyticsData();
    
    data.totalAttempts++;
    
    if (session.status === 'success') {
      data.successCount++;
      data.totalTime += session.totalDuration;
      data.averageTime = Math.round(data.totalTime / data.successCount / 1000); // 转换为秒
    } else if (session.status === 'failed') {
      data.failureCount++;
      
      // 统计失败原因
      session.errors.forEach(error => {
        const reason = error.type || 'unknown';
        data.failureReasons[reason] = (data.failureReasons[reason] || 0) + 1;
      });
    }
    
    // 更新各步骤耗时
    session.steps.forEach(step => {
      if (step.success && step.duration) {
        const timeInSeconds = step.duration / 1000;
        switch (step.name) {
          case 'filling_step1':
            data.stepTiming.step1Fill.push(timeInSeconds);
            break;
          case 'filling_step2':
            data.stepTiming.step2Fill.push(timeInSeconds);
            break;
          case 'waiting_cloudflare':
            data.stepTiming.cloudflareWait.push(timeInSeconds);
            break;
          case 'waiting_verification':
            data.stepTiming.emailWait.push(timeInSeconds);
            break;
        }
      }
    });
    
    // 更新每日统计
    const today = new Date().toISOString().split('T')[0];
    if (!data.dailyStats[today]) {
      data.dailyStats[today] = {
        attempts: 0,
        success: 0,
        failed: 0
      };
    }
    data.dailyStats[today].attempts++;
    if (session.status === 'success') {
      data.dailyStats[today].success++;
    } else if (session.status === 'failed') {
      data.dailyStats[today].failed++;
    }
    
    data.lastUpdated = new Date().toISOString();
    await this.saveAnalyticsData(data);
  }

  /**
   * 保存到历史记录
   * @param {Object} session - 会话数据
   */
  async saveToHistory(session) {
    const data = await this.loadAnalyticsData();
    
    // 添加到历史记录
    data.sessions.unshift(session);
    
    // 只保留最近50个会话
    if (data.sessions.length > 50) {
      data.sessions = data.sessions.slice(0, 50);
    }
    
    await this.saveAnalyticsData(data);
  }

  /**
   * 获取统计摘要
   */
  async getStatsSummary() {
    const data = await this.loadAnalyticsData();
    
    const successRate = data.totalAttempts > 0 
      ? Math.round((data.successCount / data.totalAttempts) * 100) 
      : 0;
    
    return {
      totalAttempts: data.totalAttempts,
      successCount: data.successCount,
      failureCount: data.failureCount,
      successRate: successRate,
      averageTime: data.averageTime,
      topFailureReasons: this.getTopFailureReasons(data.failureReasons, 5),
      stepTimingAverage: this.calculateStepAverages(data.stepTiming),
      recentSessions: data.sessions.slice(0, 10)
    };
  }

  /**
   * 获取今日统计
   */
  async getTodayStats() {
    const data = await this.loadAnalyticsData();
    const today = new Date().toISOString().split('T')[0];
    
    return data.dailyStats[today] || {
      attempts: 0,
      success: 0,
      failed: 0
    };
  }

  /**
   * 获取最近7天统计
   */
  async getWeeklyStats() {
    const data = await this.loadAnalyticsData();
    const stats = [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      
      stats.push({
        date: dateKey,
        ...(data.dailyStats[dateKey] || { attempts: 0, success: 0, failed: 0 })
      });
    }
    
    return stats;
  }

  /**
   * 获取失败原因排行
   * @param {Object} reasons - 失败原因统计
   * @param {number} limit - 返回数量
   */
  getTopFailureReasons(reasons, limit = 5) {
    const sorted = Object.entries(reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([reason, count]) => ({
        reason: this.translateErrorType(reason),
        count
      }));
    
    return sorted;
  }

  /**
   * 计算步骤平均耗时
   * @param {Object} stepTiming - 步骤耗时数据
   */
  calculateStepAverages(stepTiming) {
    const averages = {};
    
    Object.entries(stepTiming).forEach(([step, times]) => {
      if (times.length > 0) {
        const sum = times.reduce((acc, t) => acc + t, 0);
        averages[step] = Math.round(sum / times.length);
      } else {
        averages[step] = 0;
      }
    });
    
    return averages;
  }

  /**
   * 翻译错误类型
   * @param {string} errorType - 错误类型
   */
  translateErrorType(errorType) {
    const translations = {
      'network': '网络错误',
      'cloudflare_timeout': 'Cloudflare验证超时',
      'page_structure': '页面结构变化',
      'email_timeout': '邮箱验证码超时',
      'form_fill_failed': '表单填充失败',
      'unknown': '未知错误'
    };
    
    return translations[errorType] || errorType;
  }

  /**
   * 生成会话ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 加载统计数据
   */
  async loadAnalyticsData() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.storageKey], (result) => {
        resolve(result[this.storageKey] || null);
      });
    });
  }

  /**
   * 保存统计数据
   */
  async saveAnalyticsData(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [this.storageKey]: data }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 获取当前会话
   */
  async getCurrentSession() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.sessionKey], (result) => {
        resolve(result[this.sessionKey] || null);
      });
    });
  }

  /**
   * 保存当前会话
   */
  async saveCurrentSession(session) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [this.sessionKey]: session }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 清除当前会话
   */
  async clearCurrentSession() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([this.sessionKey], () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 重置所有统计数据
   */
  async resetAllStats() {
    await this.initializeAnalyticsData();
    await this.clearCurrentSession();
    logger.info('[Analytics] 📊 统计数据已重置');
  }

  /**
   * 导出统计数据
   */
  async exportStats() {
    const data = await this.loadAnalyticsData();
    const summary = await this.getStatsSummary();
    
    return {
      summary,
      fullData: data,
      exportTime: new Date().toISOString()
    };
  }
}

// 导出单例
const analytics = new RegistrationAnalytics();
