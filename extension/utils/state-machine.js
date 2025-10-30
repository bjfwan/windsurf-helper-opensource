/**
 * 状态机管理器 - 管理注册流程的所有状态转换
 * 决策理由：使用FSM模式确保状态转换的确定性和可追溯性
 */

class RegistrationStateMachine {
  // 定义所有可能的状态
  static STATES = {
    IDLE: 'idle',                          // 空闲
    PREPARING: 'preparing',                // 准备中
    DETECTING_PAGE: 'detecting_page',      // 检测页面
    FILLING_STEP1: 'filling_step1',        // 填充步骤1
    WAITING_STEP1_SUBMIT: 'waiting_step1_submit',  // 等待步骤1提交
    FILLING_STEP2: 'filling_step2',        // 填充步骤2
    WAITING_CLOUDFLARE: 'waiting_cloudflare',      // 等待Cloudflare验证
    WAITING_VERIFICATION: 'waiting_verification',  // 等待邮箱验证码
    COMPLETED: 'completed',                // 完成
    ERROR: 'error',                        // 错误
    RETRYING: 'retrying'                   // 重试中
  };

  // 定义状态转换规则
  // 决策理由：允许快速跳过中间步骤，因为自动化填充可能瞬间完成
  static TRANSITIONS = {
    [this.STATES.IDLE]: [this.STATES.PREPARING],
    [this.STATES.PREPARING]: [this.STATES.DETECTING_PAGE, this.STATES.ERROR],
    [this.STATES.DETECTING_PAGE]: [this.STATES.FILLING_STEP1, this.STATES.FILLING_STEP2, this.STATES.ERROR],
    [this.STATES.FILLING_STEP1]: [this.STATES.WAITING_STEP1_SUBMIT, this.STATES.WAITING_VERIFICATION, this.STATES.ERROR, this.STATES.RETRYING],
    [this.STATES.WAITING_STEP1_SUBMIT]: [this.STATES.FILLING_STEP2, this.STATES.WAITING_VERIFICATION, this.STATES.ERROR, this.STATES.RETRYING],
    [this.STATES.FILLING_STEP2]: [this.STATES.WAITING_CLOUDFLARE, this.STATES.WAITING_VERIFICATION, this.STATES.ERROR, this.STATES.RETRYING],
    [this.STATES.WAITING_CLOUDFLARE]: [this.STATES.WAITING_VERIFICATION, this.STATES.ERROR, this.STATES.RETRYING],
    [this.STATES.WAITING_VERIFICATION]: [this.STATES.COMPLETED, this.STATES.ERROR],
    [this.STATES.ERROR]: [this.STATES.RETRYING, this.STATES.IDLE],
    [this.STATES.RETRYING]: [this.STATES.DETECTING_PAGE, this.STATES.ERROR, this.STATES.IDLE],
    [this.STATES.COMPLETED]: [this.STATES.IDLE]
  };

  // 状态中文显示
  static STATE_TEXT = {
    [this.STATES.IDLE]: '就绪',
    [this.STATES.PREPARING]: '正在准备...',
    [this.STATES.DETECTING_PAGE]: '检测当前页面...',
    [this.STATES.FILLING_STEP1]: '填充姓名和邮箱...',
    [this.STATES.WAITING_STEP1_SUBMIT]: '等待页面跳转...',
    [this.STATES.FILLING_STEP2]: '填充密码...',
    [this.STATES.WAITING_CLOUDFLARE]: '等待Cloudflare验证...',
    [this.STATES.WAITING_VERIFICATION]: '等待验证码...',
    [this.STATES.COMPLETED]: '注册完成',
    [this.STATES.ERROR]: '发生错误',
    [this.STATES.RETRYING]: '正在重试...'
  };

  constructor() {
    this.currentState = RegistrationStateMachine.STATES.IDLE;
    this.previousState = null;
    this.stateHistory = [];
    this.retryCount = 0;
    this.maxRetries = 3;
    this.listeners = [];
    this.metadata = {}; // 存储状态相关的元数据
  }

  /**
   * 获取当前状态
   */
  getState() {
    return this.currentState;
  }

  /**
   * 获取状态文本
   */
  getStateText() {
    return RegistrationStateMachine.STATE_TEXT[this.currentState] || '未知状态';
  }

  /**
   * 转换到新状态
   */
  transition(newState, metadata = {}) {
    // 验证转换是否合法
    if (!this.canTransitionTo(newState)) {
      console.error(`[StateMachine] 非法状态转换: ${this.currentState} -> ${newState}`);
      return false;
    }

    this.previousState = this.currentState;
    this.currentState = newState;
    this.metadata = { ...this.metadata, ...metadata };
    
    // 记录状态历史
    this.stateHistory.push({
      state: newState,
      timestamp: new Date().toISOString(),
      metadata
    });

    // 重置或增加重试计数
    if (newState === RegistrationStateMachine.STATES.RETRYING) {
      this.retryCount++;
    } else if (newState !== RegistrationStateMachine.STATES.ERROR) {
      this.retryCount = 0;
    }

    console.log(`[StateMachine] 状态转换: ${this.previousState} -> ${this.currentState}`, metadata);
    
    // 通知所有监听器
    this.notifyListeners(newState, this.previousState, metadata);
    
    return true;
  }

  /**
   * 检查是否可以转换到目标状态
   */
  canTransitionTo(newState) {
    const allowedTransitions = RegistrationStateMachine.TRANSITIONS[this.currentState];
    return allowedTransitions && allowedTransitions.includes(newState);
  }

  /**
   * 检查是否可以重试
   */
  canRetry() {
    return this.retryCount < this.maxRetries;
  }

  /**
   * 重置状态机
   */
  reset() {
    this.currentState = RegistrationStateMachine.STATES.IDLE;
    this.previousState = null;
    this.stateHistory = [];
    this.retryCount = 0;
    this.metadata = {};
    console.log('[StateMachine] 状态机已重置');
  }

  /**
   * 添加状态变化监听器
   */
  addListener(callback) {
    this.listeners.push(callback);
  }

  /**
   * 移除监听器
   */
  removeListener(callback) {
    this.listeners = this.listeners.filter(listener => listener !== callback);
  }

  /**
   * 通知所有监听器
   */
  notifyListeners(newState, oldState, metadata) {
    this.listeners.forEach(listener => {
      try {
        listener(newState, oldState, metadata);
      } catch (error) {
        console.error('[StateMachine] 监听器错误:', error);
      }
    });
  }

  /**
   * 获取状态历史
   */
  getHistory() {
    return this.stateHistory;
  }

  /**
   * 获取元数据
   */
  getMetadata() {
    return this.metadata;
  }

  /**
   * 保存状态到存储
   */
  async saveToStorage() {
    const stateData = {
      currentState: this.currentState,
      previousState: this.previousState,
      retryCount: this.retryCount,
      metadata: this.metadata,
      timestamp: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ registrationState: stateData }, () => {
        if (chrome.runtime.lastError) {
          console.error('[StateMachine] 保存状态失败:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log('[StateMachine] 状态已保存', stateData);
          resolve(true);
        }
      });
    });
  }

  /**
   * 从存储恢复状态
   */
  async loadFromStorage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['registrationState'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('[StateMachine] 加载状态失败:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else if (result.registrationState) {
          this.currentState = result.registrationState.currentState;
          this.previousState = result.registrationState.previousState;
          this.retryCount = result.registrationState.retryCount || 0;
          this.metadata = result.registrationState.metadata || {};
          console.log('[StateMachine] 状态已恢复', result.registrationState);
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  /**
   * 清除存储的状态
   */
  async clearStorage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(['registrationState'], () => {
        if (chrome.runtime.lastError) {
          console.error('[StateMachine] 清除状态失败:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log('[StateMachine] 存储状态已清除');
          resolve(true);
        }
      });
    });
  }

  /**
   * 获取进度百分比（0-100）
   */
  getProgress() {
    const stateProgress = {
      [RegistrationStateMachine.STATES.IDLE]: 0,
      [RegistrationStateMachine.STATES.PREPARING]: 10,
      [RegistrationStateMachine.STATES.DETECTING_PAGE]: 20,
      [RegistrationStateMachine.STATES.FILLING_STEP1]: 30,
      [RegistrationStateMachine.STATES.WAITING_STEP1_SUBMIT]: 40,
      [RegistrationStateMachine.STATES.FILLING_STEP2]: 50,
      [RegistrationStateMachine.STATES.WAITING_CLOUDFLARE]: 70,
      [RegistrationStateMachine.STATES.WAITING_VERIFICATION]: 85,
      [RegistrationStateMachine.STATES.COMPLETED]: 100,
      [RegistrationStateMachine.STATES.ERROR]: 0,
      [RegistrationStateMachine.STATES.RETRYING]: 15
    };

    return stateProgress[this.currentState] || 0;
  }

  /**
   * 检查当前状态是否需要自动恢复
   * 决策理由：只恢复进行中的状态，避免打扰用户
   */
  shouldAutoRestore() {
    const inProgressStates = [
      RegistrationStateMachine.STATES.PREPARING,
      RegistrationStateMachine.STATES.DETECTING_PAGE,
      RegistrationStateMachine.STATES.FILLING_STEP1,
      RegistrationStateMachine.STATES.WAITING_STEP1_SUBMIT,
      RegistrationStateMachine.STATES.FILLING_STEP2,
      RegistrationStateMachine.STATES.WAITING_CLOUDFLARE,
      RegistrationStateMachine.STATES.WAITING_VERIFICATION,
      RegistrationStateMachine.STATES.RETRYING
    ];
    return inProgressStates.includes(this.currentState);
  }

  /**
   * 检查是否处于进行中状态
   */
  isInProgress() {
    const inProgressStates = [
      RegistrationStateMachine.STATES.PREPARING,
      RegistrationStateMachine.STATES.DETECTING_PAGE,
      RegistrationStateMachine.STATES.FILLING_STEP1,
      RegistrationStateMachine.STATES.WAITING_STEP1_SUBMIT,
      RegistrationStateMachine.STATES.FILLING_STEP2,
      RegistrationStateMachine.STATES.WAITING_CLOUDFLARE,
      RegistrationStateMachine.STATES.WAITING_VERIFICATION,
      RegistrationStateMachine.STATES.RETRYING
    ];
    return inProgressStates.includes(this.currentState);
  }

  /**
   * 检查是否已完成（无需恢复）
   */
  isCompleted() {
    return this.currentState === RegistrationStateMachine.STATES.COMPLETED;
  }

  /**
   * 检查是否空闲（可以创建新账号）
   */
  isIdle() {
    return this.currentState === RegistrationStateMachine.STATES.IDLE;
  }

  /**
   * 检查是否处于错误状态
   */
  isError() {
    return this.currentState === RegistrationStateMachine.STATES.ERROR;
  }

  /**
   * 检查是否可以开始新注册
   * 决策理由：只有空闲、完成、错误状态才能开始新注册
   */
  canStartNewRegistration() {
    return this.isIdle() || this.isCompleted() || this.isError();
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RegistrationStateMachine;
}
