/**
 * 状态同步管理器 - 实时同步和状态锁机制
 * 确保多标签页和popup关闭后的状态一致性
 */

class StateSyncManager {
  constructor() {
    this.lockKey = 'state_operation_lock';
    this.syncKey = 'state_sync_timestamp';
    this.heartbeatInterval = null;
    this.syncListeners = [];
    this.isLocked = false;
  }

  /**
   * 初始化同步管理器
   */
  async init() {
    // 监听storage变化
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.registrationState) {
        this.handleStateChange(changes.registrationState.newValue);
      }
    });

    // 启动心跳检测
    this.startHeartbeat();
    
    console.log('[StateSync] 同步管理器已初始化');
  }

  /**
   * 获取分布式锁
   * @param {number} timeout - 超时时间（毫秒）
   * @returns {Promise<boolean>} 是否成功获取锁
   */
  async acquireLock(timeout = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const lockData = await this.getLockData();
      
      // 如果没有锁或锁已过期（超过10秒）
      if (!lockData || Date.now() - lockData.timestamp > 10000) {
        const newLock = {
          timestamp: Date.now(),
          holder: chrome.runtime.id + '_' + Math.random(),
        };
        
        await this.setLockData(newLock);
        
        // 验证是否成功获取锁
        await new Promise(resolve => setTimeout(resolve, 50));
        const currentLock = await this.getLockData();
        
        if (currentLock && currentLock.holder === newLock.holder) {
          this.isLocked = true;
          this.lockHolder = newLock.holder;
          console.log('[StateSync] ✅ 获取锁成功');
          return true;
        }
      }
      
      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.warn('[StateSync] ⚠️ 获取锁超时');
    return false;
  }

  /**
   * 释放锁
   */
  async releaseLock() {
    if (this.isLocked) {
      await this.clearLockData();
      this.isLocked = false;
      this.lockHolder = null;
      console.log('[StateSync] 🔓 释放锁成功');
    }
  }

  /**
   * 执行带锁的操作
   * @param {Function} operation - 需要执行的操作
   */
  async executeWithLock(operation) {
    const acquired = await this.acquireLock();
    
    if (!acquired) {
      throw new Error('无法获取操作锁，请稍后重试');
    }
    
    try {
      const result = await operation();
      return result;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * 同步状态到所有上下文
   * @param {Object} stateData - 状态数据
   */
  async syncState(stateData) {
    const syncData = {
      ...stateData,
      syncTimestamp: Date.now()
    };
    
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ 
        registrationState: syncData,
        [this.syncKey]: Date.now()
      }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('[StateSync] 状态已同步到所有上下文');
          resolve();
        }
      });
    });
  }

  /**
   * 处理状态变化
   * @param {Object} newState - 新状态
   */
  handleStateChange(newState) {
    console.log('[StateSync] 检测到状态变化:', newState);
    
    // 通知所有监听器
    this.syncListeners.forEach(listener => {
      try {
        listener(newState);
      } catch (error) {
        console.error('[StateSync] 监听器错误:', error);
      }
    });
  }

  /**
   * 添加同步监听器
   * @param {Function} callback - 回调函数
   */
  addSyncListener(callback) {
    this.syncListeners.push(callback);
  }

  /**
   * 移除同步监听器
   * @param {Function} callback - 回调函数
   */
  removeSyncListener(callback) {
    this.syncListeners = this.syncListeners.filter(l => l !== callback);
  }

  /**
   * 启动心跳检测
   */
  startHeartbeat() {
    // 每5秒检查一次状态一致性
    this.heartbeatInterval = setInterval(async () => {
      await this.checkStateConsistency();
    }, 5000);
  }

  /**
   * 停止心跳检测
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 检查状态一致性
   */
  async checkStateConsistency() {
    try {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['registrationState', this.syncKey], resolve);
      });
      
      if (result.registrationState) {
        const lastSync = result[this.syncKey] || 0;
        const now = Date.now();
        
        // 如果超过30秒没有同步，可能存在问题
        if (now - lastSync > 30000) {
          console.warn('[StateSync] ⚠️ 状态长时间未同步，可能存在问题');
        }
      }
    } catch (error) {
      console.error('[StateSync] 一致性检查失败:', error);
    }
  }

  /**
   * 获取锁数据
   */
  async getLockData() {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.lockKey], (result) => {
        resolve(result[this.lockKey] || null);
      });
    });
  }

  /**
   * 设置锁数据
   */
  async setLockData(lockData) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [this.lockKey]: lockData }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 清除锁数据
   */
  async clearLockData() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([this.lockKey], () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 清理资源
   */
  destroy() {
    this.stopHeartbeat();
    this.syncListeners = [];
    this.releaseLock();
  }
}

// 导出单例
const stateSyncManager = new StateSyncManager();
