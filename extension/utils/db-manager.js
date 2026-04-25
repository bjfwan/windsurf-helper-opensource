/**
 * IndexedDB 管理器 - 账号数据离线缓存
 * 
 * 性能优化：
 * - 使用索引加速查询
 * - 批量操作减少事务开销
 * - 自动清理过期数据
 */

class DBManager {
  constructor() {
    this.dbName = 'WindsurfAccountsDB';
    this.version = 2;
    this.db = null;
    
    // 决策理由：使用对象存储而非关系表，适合Chrome Extension环境
    this.stores = {
      accounts: 'accounts',
      verificationLogs: 'verification_logs'
    };
  }
  
  /**
   * 初始化数据库
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;
    
    // 决策理由：检查浏览器支持，避免隐私模式或旧浏览器崩溃
    if (!window.indexedDB) {
      const error = new Error('浏览器不支持 IndexedDB（可能处于隐私模式）');
      logger.error('❌', error.message);
      return Promise.reject(error);
    }
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => {
        logger.error('IndexedDB 打开失败:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        logger.debug('✅ IndexedDB 初始化成功');
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const tx = event.target.transaction;
        
        // 创建账号存储（如果不存在）
        if (!db.objectStoreNames.contains(this.stores.accounts)) {
          const accountStore = db.createObjectStore(this.stores.accounts, { 
            keyPath: 'email'
          });
          accountStore.createIndex('status', 'status', { unique: false });
          accountStore.createIndex('created_at', 'created_at', { unique: false });
          accountStore.createIndex('session_id', 'session_id', { unique: false });
          logger.info('✅ 创建 accounts 存储');
        } else {
          // 为已有accounts添加缺失索引
          const store = tx.objectStore(this.stores.accounts);
          if (!Array.from(store.indexNames).includes('session_id')) {
            store.createIndex('session_id', 'session_id', { unique: false });
            logger.info('🔧 添加 accounts.session_id 索引');
          }
        }
        
        // 创建验证日志存储
        if (!db.objectStoreNames.contains(this.stores.verificationLogs)) {
          const logStore = db.createObjectStore(this.stores.verificationLogs, { 
            keyPath: 'id',
            autoIncrement: true 
          });
          logStore.createIndex('email', 'email', { unique: false });
          logStore.createIndex('received_at', 'received_at', { unique: false });
          logStore.createIndex('session_id', 'session_id', { unique: false });
          logger.info('✅ 创建 verification_logs 存储');
        } else {
          const store = tx.objectStore(this.stores.verificationLogs);
          if (!Array.from(store.indexNames).includes('session_id')) {
            store.createIndex('session_id', 'session_id', { unique: false });
            logger.info('🔧 添加 verification_logs.session_id 索引');
          }
        }
      };
    });
  }
  
  /**
   * 保存账号（单个）
   * 性能约束：O(1) 复杂度
   */
  async saveAccount(account) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.stores.accounts], 'readwrite');
      const store = transaction.objectStore(this.stores.accounts);
      
      // 添加时间戳
      const accountWithTimestamp = {
        ...account,
        updated_at: new Date().toISOString()
      };
      
      const request = store.put(accountWithTimestamp);
      
      request.onsuccess = () => resolve({ success: true, data: accountWithTimestamp });
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * 批量保存账号
   * 性能优化：单次事务处理所有数据
   */
  async saveAccountsBatch(accounts) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.stores.accounts], 'readwrite');
      const store = transaction.objectStore(this.stores.accounts);
      
      let completed = 0;
      const total = accounts.length;
      
      accounts.forEach(account => {
        const request = store.put({
          ...account,
          updated_at: new Date().toISOString()
        });
        
        request.onsuccess = () => {
          completed++;
          if (completed === total) {
            resolve({ success: true, count: total });
          }
        };
      });
      
      transaction.onerror = () => reject(transaction.error);
    });
  }
  
  /**
   * 获取所有账号
   * @param {Object} options - 查询选项
   */
  async getAllAccounts(options = {}) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.stores.accounts], 'readonly');
      const store = transaction.objectStore(this.stores.accounts);
      
      let request;
      
      // 决策理由：使用索引查询提升性能
      if (options.status) {
        const index = store.index('status');
        request = index.getAll(options.status);
      } else {
        request = store.getAll();
      }
      
      request.onsuccess = () => {
        let results = request.result;
        
        // 按创建时间倒序排序
        results.sort((a, b) => 
          new Date(b.created_at) - new Date(a.created_at)
        );
        
        // 分页支持
        if (options.limit) {
          results = results.slice(0, options.limit);
        }
        
        resolve({ success: true, data: results });
      };
      
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * 根据邮箱获取账号
   */
  async getAccount(email) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.stores.accounts], 'readonly');
      const store = transaction.objectStore(this.stores.accounts);
      const request = store.get(email);
      
      request.onsuccess = () => {
        resolve({ success: true, data: request.result });
      };
      
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * 搜索账号（模糊匹配）
   */
  async searchAccounts(query) {
    await this.init();
    
    const { data } = await this.getAllAccounts();
    const lowerQuery = query.toLowerCase();
    
    // 决策理由：客户端过滤，避免复杂索引
    const filtered = data.filter(account => 
      account.email?.toLowerCase().includes(lowerQuery) ||
      account.username?.toLowerCase().includes(lowerQuery)
    );
    
    return { success: true, data: filtered };
  }
  
  /**
   * 更新账号状态
   */
  async updateAccountStatus(email, status) {
    await this.init();
    
    const { data: account } = await this.getAccount(email);
    if (!account) {
      return { success: false, error: '账号不存在' };
    }
    
    account.status = status;
    account.updated_at = new Date().toISOString();
    
    if (status === 'verified') {
      account.verified_at = new Date().toISOString();
    }
    
    return this.saveAccount(account);
  }
  
  /**
   * 删除账号
   */
  async deleteAccount(email) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.stores.accounts], 'readwrite');
      const store = transaction.objectStore(this.stores.accounts);
      const request = store.delete(email);
      
      request.onsuccess = () => resolve({ success: true });
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * 清空所有账号
   */
  async clearAllAccounts() {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.stores.accounts], 'readwrite');
      const store = transaction.objectStore(this.stores.accounts);
      const request = store.clear();
      
      request.onsuccess = () => resolve({ success: true });
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * 保存验证日志
   */
  async saveVerificationLog(log) {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.stores.verificationLogs], 'readwrite');
      const store = transaction.objectStore(this.stores.verificationLogs);
      
      const request = store.add({
        ...log,
        received_at: log.received_at || new Date().toISOString()
      });
      
      request.onsuccess = () => resolve({ success: true, id: request.result });
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * 获取账号统计信息
   */
  async getStats() {
    await this.init();
    
    const { data: accounts } = await this.getAllAccounts();
    
    return {
      total: accounts.length,
      verified: accounts.filter(a => a.status === 'verified').length,
      pending: accounts.filter(a => a.status === 'pending').length,
      failed: accounts.filter(a => a.status === 'failed').length
    };
  }
  
  /**
   * 清理过期数据（7天前）
   * 内存泄漏预防：定期清理
   */
  async cleanupOldData(daysToKeep = 7) {
    await this.init();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const { data: accounts } = await this.getAllAccounts();
    const toDelete = accounts.filter(account => 
      new Date(account.created_at) < cutoffDate
    );
    
    const transaction = this.db.transaction([this.stores.accounts], 'readwrite');
    const store = transaction.objectStore(this.stores.accounts);
    
    toDelete.forEach(account => {
      store.delete(account.email);
    });
    
    return new Promise((resolve) => {
      transaction.oncomplete = () => {
        logger.info(`🗑️ 清理了 ${toDelete.length} 个过期账号`);
        resolve({ success: true, deleted: toDelete.length });
      };
    });
  }
  
  /**
   * 关闭数据库连接
   * 资源管理：防止内存泄漏
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.debug('🔒 IndexedDB 连接已关闭');
    }
  }
}

// 单例模式
const dbManager = new DBManager();
