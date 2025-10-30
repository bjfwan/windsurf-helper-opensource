/**
 * API客户端 - 与云端服务器通信
 */

class APIClient {
  constructor() {
    this.baseURL = API_CONFIG.BASE_URL;
    this.timeout = API_CONFIG.TIMEOUT;
  }

  /**
   * 发送HTTP请求
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_CONFIG.API_KEY,
        ...options.headers
      },
      ...options
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...config,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('请求超时');
      }
      throw error;
    }
  }

  /**
   * 启动邮箱监控
   */
  async startMonitor(email, sessionId) {
    console.log(`[API] 启动监控: ${email}`);
    
    return await this.request(API_CONFIG.ENDPOINTS.START_MONITOR, {
      method: 'POST',
      body: JSON.stringify({
        email: email,
        session_id: sessionId
      })
    });
  }

  /**
   * 检查验证码
   */
  async checkCode(sessionId) {
    const endpoint = `${API_CONFIG.ENDPOINTS.CHECK_CODE}/${sessionId}`;
    return await this.request(endpoint);
  }

  /**
   * 健康检查
   */
  async health() {
    return await this.request(API_CONFIG.ENDPOINTS.HEALTH);
  }

  /**
   * 轮询检查验证码
   */
  async pollForCode(sessionId, maxAttempts = 60) {
    console.log(`[API] 开始轮询验证码: ${sessionId}`);
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await this.checkCode(sessionId);
        
        if (result.success && result.code) {
          console.log(`[API] ✅ 收到验证码: ${result.code}`);
          return result;
        }
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, API_CONFIG.POLL_INTERVAL));
      } catch (error) {
        console.warn(`[API] 轮询失败 (${i + 1}/${maxAttempts}):`, error.message);
        
        if (i < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, API_CONFIG.POLL_INTERVAL));
        }
      }
    }
    
    throw new Error('轮询超时：未收到验证码');
  }
}

// 导出单例
const apiClient = new APIClient();
