/**
 * Supabase REST API 封装（无需SDK）
 * 决策理由：Manifest V3禁止外部CDN，使用原生fetch
 */

class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.realtimeWs = null;
  }
  
  async saveAccount(accountData) {
    try {
      const response = await fetch(`${this.url}/rest/v1/accounts`, {
        method: 'POST',
        headers: {
          'apikey': this.key,
          'Authorization': `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(accountData)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error('保存账号失败:', error);
      return { success: false, error: error.message };
    }
  }
  
  async getAccounts(limit = 50) {
    try {
      const response = await fetch(
        `${this.url}/rest/v1/accounts?order=created_at.desc&limit=${limit}`,
        {
          headers: {
            'apikey': this.key,
            'Authorization': `Bearer ${this.key}`
          }
        }
      );
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error('获取账号失败:', error);
      return { success: false, error: error.message };
    }
  }
  
  async updateAccountStatus(email, status, errorMessage = null) {
    try {
      const updateData = { status };
      if (status === 'verified') {
        updateData.verified_at = new Date().toISOString();
      }
      if (errorMessage) {
        updateData.error_message = errorMessage;
      }
      
      const response = await fetch(
        `${this.url}/rest/v1/accounts?email=eq.${email}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': this.key,
            'Authorization': `Bearer ${this.key}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(updateData)
        }
      );
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error('更新账号状态失败:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 订阅验证码（MV3：用轮询模拟Realtime）
   * filter: { session_id?: string, email?: string }
   */
  subscribeToVerificationCodes(callback, filter = {}) {
    // 返回假的channel对象供兼容
    let isSubscribed = true;
    let lastSig = null; // 去重：received_at+code
    // 首帧拉取一次（避免冷启动等待）
    (async () => {
      if (!isSubscribed) return;
      try {
        // 严格匹配：同时使用 session_id 和 email 查询
        let query = `${this.url}/rest/v1/verification_logs?order=received_at.desc&limit=1`;
        if (filter.session_id && filter.email) {
          query = `${this.url}/rest/v1/verification_logs?session_id=eq.${encodeURIComponent(filter.session_id)}&email=eq.${encodeURIComponent(filter.email)}&order=received_at.desc&limit=1`;
        } else if (filter.session_id) {
          query = `${this.url}/rest/v1/verification_logs?session_id=eq.${encodeURIComponent(filter.session_id)}&order=received_at.desc&limit=1`;
        } else if (filter.email) {
          query = `${this.url}/rest/v1/verification_logs?email=eq.${encodeURIComponent(filter.email)}&order=received_at.desc&limit=1`;
        }
        const response = await fetch(query, {
          headers: {
            'apikey': this.key,
            'Authorization': `Bearer ${this.key}`,
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache'
          }
        });
        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            const sig = `${data[0].received_at || ''}-${data[0].code || ''}`;
            lastSig = sig;
            callback(data[0]);
          }
        }
      } catch (e) {
        console.error('首帧拉取失败:', e);
      }
    })();

    // 使用轮询替代Realtime（2s±抖动）
    const base = 2000;
    const jitter = () => base + Math.floor(Math.random() * 600) - 300;
    const timer = async () => {
      if (!isSubscribed) {
        return;
      }

      try {
        // 严格匹配：同时使用 session_id 和 email 查询
        let query = `${this.url}/rest/v1/verification_logs?order=received_at.desc&limit=1`;
        if (filter.session_id && filter.email) {
          query = `${this.url}/rest/v1/verification_logs?session_id=eq.${encodeURIComponent(filter.session_id)}&email=eq.${encodeURIComponent(filter.email)}&order=received_at.desc&limit=1`;
        } else if (filter.session_id) {
          query = `${this.url}/rest/v1/verification_logs?session_id=eq.${encodeURIComponent(filter.session_id)}&order=received_at.desc&limit=1`;
        } else if (filter.email) {
          query = `${this.url}/rest/v1/verification_logs?email=eq.${encodeURIComponent(filter.email)}&order=received_at.desc&limit=1`;
        }

        const response = await fetch(query, {
          headers: {
            'apikey': this.key,
            'Authorization': `Bearer ${this.key}`,
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache'
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            const sig = `${data[0].received_at || ''}-${data[0].code || ''}`;
            if (sig !== lastSig) {
              lastSig = sig;
              callback(data[0]);
            }
          }
        }
      } catch (error) {
        console.error('轮询失败:', error);
      }
      if (isSubscribed) setTimeout(timer, jitter());
    };
    setTimeout(timer, jitter());

    // 返回channel对象
    return {
      unsubscribe: () => {
        isSubscribed = false;
        console.log('✅ 已取消订阅');
      }
    };
  }
}
