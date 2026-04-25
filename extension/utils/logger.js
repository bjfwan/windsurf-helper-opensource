/**
 * 统一日志器 - 支持分级输出
 *
 * 决策理由：项目原有 ~189 处 console.log，启动时大量噪音 + 轮询期间持续刷屏。
 * 通过 LOG_LEVEL 集中控制，生产默认仅 warn/error，调试可一键开启 debug。
 *
 * 用法:
 *   logger.debug('详细调试信息')       // 默认不输出
 *   logger.info('一般信息')             // 默认输出
 *   logger.warn('警告')                 // 始终输出
 *   logger.error('错误', err)           // 始终输出
 *
 *   const log = logger.scope('Popup')   // 带前缀子 logger
 *   log.debug('xxx')                    // → [Popup] xxx
 *
 *   // 调整级别（运行时）
 *   Logger.setLevel('debug')            // 输出全部
 *   Logger.setLevel('warn')             // 仅 warn/error
 *   Logger.setLevel('silent')           // 全部静默
 *
 *   // 持久化（chrome.storage.local.__log_level）
 *   Logger.saveLevelToStorage('warn')   // 后续会话生效
 */

(function () {
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

  // 默认 'info' — 保留对老代码的向后兼容；用户可通过 setLevel('warn') 静默
  let currentLevel = LEVELS.info;

  // 保留原始 console 引用，避免与其他脚本（如 accounts.js debugPanel）的劫持互相覆盖
  const refs = {
    debug: (console.debug ? console.debug : console.log).bind(console),
    info: (console.info ? console.info : console.log).bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };

  class Logger {
    constructor(prefix = '') {
      this.prefix = prefix;
    }

    _enabled(level) {
      return LEVELS[level] >= currentLevel;
    }

    _withPrefix(args) {
      return this.prefix ? [`[${this.prefix}]`, ...args] : args;
    }

    debug(...args) {
      if (this._enabled('debug')) refs.debug(...this._withPrefix(args));
    }

    info(...args) {
      if (this._enabled('info')) refs.info(...this._withPrefix(args));
    }

    log(...args) {
      // log 视作 info 的别名
      if (this._enabled('info')) refs.log(...this._withPrefix(args));
    }

    warn(...args) {
      if (this._enabled('warn')) refs.warn(...this._withPrefix(args));
    }

    error(...args) {
      if (this._enabled('error')) refs.error(...this._withPrefix(args));
    }

    /**
     * 创建带前缀的子 logger
     * @param {string} prefix
     * @returns {Logger}
     */
    scope(prefix) {
      return new Logger(this.prefix ? `${this.prefix}/${prefix}` : prefix);
    }

    /**
     * 设置当前日志级别
     * @param {'debug'|'info'|'warn'|'error'|'silent'} name
     */
    static setLevel(name) {
      const v = LEVELS[name];
      if (typeof v === 'number') {
        currentLevel = v;
      } else {
        refs.warn('[Logger] 无效级别:', name);
      }
    }

    /**
     * 获取当前级别名
     * @returns {string}
     */
    static getLevel() {
      return Object.keys(LEVELS).find(k => LEVELS[k] === currentLevel) || 'info';
    }

    /**
     * 从 chrome.storage.local 加载持久化级别（异步，启动时调用）
     */
    static async loadLevelFromStorage() {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        const result = await new Promise((resolve, reject) => {
          chrome.storage.local.get(['__log_level'], (r) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(r);
          });
        });
        if (result && result.__log_level && LEVELS[result.__log_level] !== undefined) {
          currentLevel = LEVELS[result.__log_level];
        }
      } catch {
        // 静默：storage 不可用时回退到默认级别
      }
    }

    /**
     * 持久化日志级别到 chrome.storage
     * @param {'debug'|'info'|'warn'|'error'|'silent'} name
     */
    static async saveLevelToStorage(name) {
      Logger.setLevel(name);
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        await new Promise((resolve, reject) => {
          chrome.storage.local.set({ __log_level: name }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
          });
        });
      } catch {
        // 静默
      }
    }

    /**
     * 暴露原始 console 引用（用于 debugPanel 等需要绕过 logger 拦截的场景）
     */
    static getConsoleRefs() {
      return refs;
    }
  }

  // 默认实例
  const logger = new Logger();

  // 暴露到 window/self 全局，兼容 popup/content/service-worker 三种环境
  const root = (typeof globalThis !== 'undefined') ? globalThis
              : (typeof self !== 'undefined') ? self
              : (typeof window !== 'undefined') ? window : {};

  root.Logger = Logger;
  root.logger = logger;

  // 启动时尝试加载持久化级别（fire-and-forget）
  Logger.loadLevelFromStorage();
})();
