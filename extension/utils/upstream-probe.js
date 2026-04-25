/**
 * 上游变更探测器（小而专注的 smoke check）
 *
 * 决策理由：
 *   - 我们 *不* 想做全量接口/选择器接入——上游 windsurf.com 的页面会经常微调，
 *     全量接入只会引入大量噪音和误报。
 *   - 这里只跟踪能让注册流程"完全断"的几条关键链路（见 WindsurfProtocol.upstream.smokePaths）。
 *   - 探测同时收集后端关键链路（health / accounts / start-monitor / check-code），
 *     一次拿到一份"上游 + 后端"的健康摘要。
 *
 * 用法：
 *   const probe = new UpstreamProbe({ apiClient, getActiveTab, sendTabMessage });
 *   const report = await probe.run();
 *   // report = { ok, summary, upstream: {...}, backend: {...}, paths: [...] }
 */

class UpstreamProbe {
  constructor({ apiClient, getActiveTab, sendTabMessage } = {}) {
    this.apiClient = apiClient;
    this.getActiveTab = typeof getActiveTab === 'function'
      ? getActiveTab
      : async () => {
          if (typeof chrome === 'undefined' || !chrome.tabs) return null;
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          return tab || null;
        };
    this.sendTabMessage = typeof sendTabMessage === 'function'
      ? sendTabMessage
      : (tabId, message) => new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, message, response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          });
        });

    const proto = (typeof WindsurfProtocol !== 'undefined' && WindsurfProtocol.upstream) || {};
    this.smokePaths = Array.isArray(proto.smokePaths) ? proto.smokePaths : [];
    this.isRegistrationUrl = typeof proto.isRegistrationUrl === 'function'
      ? proto.isRegistrationUrl.bind(proto)
      : () => false;
    this.smokeThresholds = proto.smoke || { step1MinInputs: 3, step2MinPasswordInputs: 2 };
  }

  async run() {
    const [upstream, backend] = await Promise.all([
      this._probeUpstream(),
      this._probeBackend()
    ]);

    const paths = this._evaluatePaths(upstream);
    const ok = upstream.status === 'healthy' && backend.status === 'healthy';
    const summary = this._summarize({ upstream, backend, paths });

    return {
      ok,
      summary,
      upstream,
      backend,
      paths,
      generatedAt: new Date().toISOString()
    };
  }

  async _probeUpstream() {
    const tab = await this.getActiveTab();
    if (!tab?.id || !tab.url) {
      return {
        status: 'unknown',
        reason: '未找到当前标签页',
        url: '',
        data: null
      };
    }

    if (!this.isRegistrationUrl(tab.url)) {
      return {
        status: 'unknown',
        reason: '当前标签页不是 Windsurf 注册页',
        url: tab.url,
        data: null
      };
    }

    try {
      const response = await this.sendTabMessage(tab.id, { action: 'smokeCheck' });
      if (!response?.success || !response.data) {
        return {
          status: 'error',
          reason: response?.error || '内容脚本未返回探测结果',
          url: tab.url,
          data: null
        };
      }
      return {
        status: response.data.success ? 'healthy' : 'warning',
        reason: response.data.success ? '关键链路全部命中' : '部分关键链路未命中',
        url: tab.url,
        data: response.data
      };
    } catch (error) {
      return {
        status: 'error',
        reason: error.message,
        url: tab.url,
        data: null
      };
    }
  }

  async _probeBackend() {
    if (!this.apiClient || typeof this.apiClient.smokeCheck !== 'function') {
      return {
        status: 'unknown',
        reason: '后端客户端不可用',
        data: null
      };
    }

    try {
      const result = await this.apiClient.smokeCheck();
      return {
        status: result?.success ? 'healthy' : 'warning',
        reason: result?.success ? '后端关键接口正常' : '至少一个后端关键接口异常',
        data: result?.data || null
      };
    } catch (error) {
      return {
        status: 'error',
        reason: error.message,
        data: null
      };
    }
  }

  /**
   * 把 content-script 的探测数据映射到 protocol-contract 中声明的 smokePaths 列表。
   * 决策理由：让"哪些路径出问题了"可以从协议契约直接读出，而不是散落在 UI 里硬编码。
   *
   * step-awareness：注册流程是分步的（step1 / step2 / oauth_*），不应把"当前不在该步"
   * 的路径标成失败。所以 ok=null 表示"本步骤无法判定"，UI 显示为 ℹ️ 而非 ❌。
   */
  _evaluatePaths(upstream) {
    if (!Array.isArray(this.smokePaths) || this.smokePaths.length === 0) {
      return [];
    }

    if (!upstream || !upstream.data) {
      return this.smokePaths.map(path => ({
        ...path,
        ok: false,
        reason: upstream?.reason || '无探测数据'
      }));
    }

    const data = upstream.data || {};
    const counts = data.counts || {};
    const selectors = data.selectors || {};
    const step = data.step || 'unknown';

    return this.smokePaths.map(path => {
      switch (path.id) {
        case 'register-url':
          return { ...path, ok: !!data.urlMatched, reason: data.urlMatched ? 'URL 命中' : 'URL 未命中' };

        case 'step1-inputs': {
          if (step !== 'step1' && step !== 'oauth_name' && step !== 'oauth_full' && step !== 'unknown') {
            return { ...path, ok: null, reason: `当前为 ${step}，跳过 Step1 检测` };
          }
          const ok = (counts.step1Inputs || 0) >= (this.smokeThresholds.step1MinInputs || 3);
          return { ...path, ok, reason: ok ? `Step1 输入框 ${counts.step1Inputs}` : `Step1 输入框仅 ${counts.step1Inputs || 0}` };
        }

        case 'step2-passwords': {
          if (step !== 'step2' && step !== 'oauth_full') {
            return { ...path, ok: null, reason: `当前为 ${step}，Step2 密码框未渲染（属正常）` };
          }
          const ok = (counts.passwordInputs || 0) >= (this.smokeThresholds.step2MinPasswordInputs || 2);
          return { ...path, ok, reason: ok ? `Step2 密码框 ${counts.passwordInputs}` : `Step2 密码框仅 ${counts.passwordInputs || 0}` };
        }

        case 'continue-button': {
          const ok = !!(selectors.continueButton || selectors.submitButton);
          return { ...path, ok, reason: ok ? '继续/提交按钮存在' : '继续/提交按钮缺失' };
        }

        default:
          return { ...path, ok: null, reason: '未知关键路径' };
      }
    });
  }

  _summarize({ upstream, backend, paths }) {
    const failedPaths = paths.filter(p => p.ok === false).map(p => p.id);
    if (upstream.status === 'unknown') {
      return `上游：${upstream.reason}；后端：${backend.reason}`;
    }
    if (upstream.status === 'healthy' && backend.status === 'healthy') {
      return '上游与后端关键链路全部正常';
    }
    if (failedPaths.length > 0) {
      return `关键链路异常：${failedPaths.join(', ')}`;
    }
    return `上游：${upstream.reason}；后端：${backend.reason}`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UpstreamProbe;
}
