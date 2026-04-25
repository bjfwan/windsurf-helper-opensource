class APIClient {
  constructor() {
    this.protocol = typeof WindsurfProtocol !== 'undefined'
      ? WindsurfProtocol
      : {
          api: {
            endpoints: {
              health: '/api/health',
              startMonitor: '/api/start-monitor',
              checkCode: '/api/check-code',
              accounts: '/api/accounts'
            }
          },
          headers(apiKey = '', extra = {}) {
            return {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey || '',
              ...extra
            };
          }
        };
    this.baseURL = API_CONFIG.BASE_URL;
    this.timeout = API_CONFIG.TIMEOUT;
    this.apiKey = API_CONFIG.API_KEY || '';
  }

  buildURL(endpoint, query = {}) {
    const url = new URL(`${this.baseURL}${endpoint}`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  }

  buildHeaders(extra = {}) {
    return this.protocol.headers(this.apiKey, extra);
  }

  async fetchResponse(endpoint, options = {}, query = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || this.timeout);
    const requestOptions = { ...options };
    const headers = this.buildHeaders(requestOptions.headers || {});

    if (requestOptions.body && typeof requestOptions.body === 'object' && !(requestOptions.body instanceof FormData)) {
      requestOptions.body = JSON.stringify(requestOptions.body);
    }

    delete requestOptions.timeout;
    requestOptions.headers = headers;
    requestOptions.signal = controller.signal;

    try {
      const response = await fetch(this.buildURL(endpoint, query), requestOptions);
      const text = await response.text();
      let data = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { success: response.ok, raw: text };
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        data
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        return {
          ok: false,
          status: 0,
          data: { success: false, error: '请求超时' }
        };
      }

      return {
        ok: false,
        status: 0,
        data: { success: false, error: error.message }
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async request(endpoint, options = {}, query = {}) {
    const response = await this.fetchResponse(endpoint, options, query);
    if (!response.ok) {
      throw new Error(response.data?.error || `HTTP ${response.status}`);
    }
    return response.data;
  }

  async health() {
    return this.request(this.protocol.api.endpoints.health);
  }

  async startMonitor(email, sessionId) {
    return this.request(this.protocol.api.endpoints.startMonitor, {
      method: 'POST',
      body: {
        email,
        session_id: sessionId
      }
    });
  }

  async checkCode(sessionId) {
    return this.request(`${this.protocol.api.endpoints.checkCode}/${encodeURIComponent(sessionId)}`);
  }

  async listAccounts(query = {}) {
    return this.request(this.protocol.api.endpoints.accounts, {}, query);
  }

  async saveAccount(account) {
    return this.request(this.protocol.api.endpoints.accounts, {
      method: 'POST',
      body: account
    });
  }

  async updateAccount(account) {
    return this.request(this.protocol.api.endpoints.accounts, {
      method: 'PATCH',
      body: account
    });
  }

  async deleteAccount(id) {
    return this.request(`${this.protocol.api.endpoints.accounts}/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  }

  async backendSmokeCheck() {
    const probeSession = `probe-${Date.now()}`;
    const probeEmail = `${probeSession}@windsurf-helper.local`;
    const [health, accounts, monitor] = await Promise.all([
      this.fetchResponse(this.protocol.api.endpoints.health),
      this.fetchResponse(this.protocol.api.endpoints.accounts, {}, { limit: 1 }),
      this.fetchResponse(this.protocol.api.endpoints.startMonitor, {
        method: 'POST',
        body: {
          email: probeEmail,
          session_id: probeSession
        }
      })
    ]);

    const checkCode = await this.fetchResponse(
      `${this.protocol.api.endpoints.checkCode}/${encodeURIComponent(probeSession)}`
    );

    return {
      success: health.ok && accounts.ok && monitor.ok && checkCode.ok,
      data: {
        probeEmail,
        probeSession,
        health,
        accounts,
        monitor,
        checkCode
      }
    };
  }

  async smokeCheck() {
    return this.backendSmokeCheck();
  }
}

const apiClient = new APIClient();
