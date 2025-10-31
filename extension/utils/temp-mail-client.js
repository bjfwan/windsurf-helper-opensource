/**
 * 临时邮箱客户端
 * 
 * 默认支持的服务商（仅作推荐）：
 *   - temp-mail.org
 *   - guerrillamail.com
 * 
 * 用户可以自行添加其他临时邮箱服务API：
 *   - 10分钟邮箱 (10minutemail.com)
 *   - 2925邮箱 (mail.2925.com)
 *   - TempMail+ (tempmail.plus)
 *   - 等等...
 * 
 * 添加方法：
 *   1. 参考现有的 generateXXX() 和 checkXXX() 方法
 *   2. 添加新的服务商实现
 *   3. 在 generateEmail() 和 checkMails() 中添加case
 */

class TempMailClient {
  constructor(config = {}) {
    this.provider = config.provider || 'temp-mail-org';
    this.pollInterval = config.pollInterval || 5000;
    this.maxAttempts = config.maxAttempts || 60;
    this.currentEmail = null;
    this.currentToken = null;
  }

  /**
   * 生成临时邮箱地址
   */
  async generateEmail() {
    try {
      // 根据配置选择邮箱服务商
      switch (this.provider) {
        case '1secmail':
          return await this.generate1SecMail();
        case 'guerrilla-mail':
          return await this.generateGuerrillaMail();
        case 'temp-mail-org':
          // 旧方法已废弃，回退到1secmail
          console.warn('[TempMail] temp-mail-org已废弃，使用1secmail代替');
          return await this.generate1SecMail();
        default:
          throw new Error(`不支持的服务商: ${this.provider}`);
      }
    } catch (error) {
      console.error('[TempMail] 生成邮箱失败:', error);
      throw error;
    }
  }

  /**
   * 1SecMail - 生成邮箱（推荐）
   * 官方API: https://www.1secmail.com/api/
   */
  async generate1SecMail() {
    try {
      console.log('[1SecMail] 正在生成邮箱...');
      const response = await fetch('https://www.1secmail.com/api/v1/?action=genRandomMailbox&count=1');
      
      console.log('[1SecMail] API响应状态:', response.status, response.statusText);
      
      if (!response.ok) {
        throw new Error(`1SecMail API返回错误: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[1SecMail] API返回数据:', data);
      
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('1SecMail API返回数据格式错误');
      }
      
      this.currentEmail = data[0]; // 返回格式: ["abc123@1secmail.com"]
      
      // 分割邮箱获取 login 和 domain
      const [login, domain] = this.currentEmail.split('@');
      this.currentToken = JSON.stringify({ login, domain });
      
      console.log('[1SecMail] ✅ 邮箱生成成功:', this.currentEmail);
      
      return {
        email: this.currentEmail,
        token: this.currentToken
      };
    } catch (error) {
      console.error('[1SecMail] 生成邮箱失败:', error);
      console.error('[1SecMail] 错误详情:', error.message);
      throw new Error(`无法生成 1SecMail 邮箱: ${error.message}`);
    }
  }

  /**
   * Guerrilla Mail - 生成邮箱
   */
  async generateGuerrillaMail() {
    const response = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address');
    
    if (!response.ok) {
      throw new Error('无法生成 Guerrilla Mail 邮箱');
    }
    
    const data = await response.json();
    this.currentEmail = data.email_addr;
    this.currentToken = data.sid_token;
    
    return {
      email: this.currentEmail,
      token: this.currentToken
    };
  }

  /**
   * 检查邮件
   */
  async checkMails() {
    if (!this.currentEmail || !this.currentToken) {
      throw new Error('请先生成邮箱地址');
    }

    try {
      switch (this.provider) {
        case '1secmail':
          return await this.check1SecMail();
        case 'guerrilla-mail':
          return await this.checkGuerrillaMail();
        case 'temp-mail-org':
          // 旧方法已废弃，回退到1secmail
          return await this.check1SecMail();
        default:
          return [];
      }
    } catch (error) {
      console.error('[TempMail] 检查邮件失败:', error);
      return [];
    }
  }

  /**
   * 1SecMail - 检查邮件
   */
  async check1SecMail() {
    if (!this.currentToken) {
      return [];
    }
    
    const { login, domain } = JSON.parse(this.currentToken);
    const response = await fetch(
      `https://www.1secmail.com/api/v1/?action=getMessages&login=${login}&domain=${domain}`
    );
    
    if (!response.ok) {
      return [];
    }
    
    const messages = await response.json();
    return Array.isArray(messages) ? messages : [];
  }

  /**
   * Guerrilla Mail - 检查邮件
   */
  async checkGuerrillaMail() {
    console.log('[Guerrilla] 检查邮件...');
    console.log('[Guerrilla] 邮箱:', this.currentEmail);
    console.log('[Guerrilla] Token:', this.currentToken);
    
    const url = `https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${this.currentToken}`;
    console.log('[Guerrilla] API请求:', url);
    
    const response = await fetch(url);
    
    console.log('[Guerrilla] API响应状态:', response.status, response.statusText);
    
    if (!response.ok) {
      console.error('[Guerrilla] API请求失败');
      return [];
    }
    
    const data = await response.json();
    console.log('[Guerrilla] API返回数据:', JSON.stringify(data, null, 2));
    console.log('[Guerrilla] 邮件数量:', data.list ? data.list.length : 0);
    
    return data.list || [];
  }

  /**
   * 从邮件内容中提取验证码
   */
  extractVerificationCode(mailContent) {
    const patterns = [
      /(\d{6})/,
      /Your verification code is:\s*(\d{6})/i,
      /verification code:\s*(\d{6})/i,
      /code is:\s*(\d{6})/i,
      /验证码[：:]\s*(\d{6})/
    ];
    
    for (const pattern of patterns) {
      const match = mailContent.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * 获取1SecMail邮件详细内容
   */
  async get1SecMailContent(mailId) {
    const { login, domain } = JSON.parse(this.currentToken);
    const response = await fetch(
      `https://www.1secmail.com/api/v1/?action=readMessage&login=${login}&domain=${domain}&id=${mailId}`
    );
    
    if (!response.ok) {
      return null;
    }
    
    return await response.json();
  }

  /**
   * 轮询等待验证码
   */
  async waitForVerificationCode() {
    for (let i = 0; i < this.maxAttempts; i++) {
      console.log(`[TempMail] 第 ${i + 1}/${this.maxAttempts} 次检查...`);
      
      const mails = await this.checkMails();
      console.log(`[TempMail] 收到 ${mails.length} 封邮件`);
      
      for (const mail of mails) {
        // 1SecMail需要额外获取邮件内容
        let mailContent = mail;
        if (this.provider === '1secmail' || this.provider === 'temp-mail-org') {
          const fullMail = await this.get1SecMailContent(mail.id);
          if (fullMail) {
            mailContent = fullMail;
          }
        }
        
        const subject = mailContent.subject || mailContent.mail_subject || '';
        const body = mailContent.body || mailContent.textBody || mailContent.htmlBody || mailContent.mail_body || mailContent.mail_text || '';
        const from = mailContent.from || mailContent.mail_from || '';
        
        console.log(`[TempMail] 检查邮件:`);
        console.log(`  From: ${from}`);
        console.log(`  Subject: ${subject}`);
        console.log(`  Body (前100字): ${body.substring(0, 100)}`);
        
        // 检查是否来自 Windsurf
        if (from.toLowerCase().includes('windsurf') || 
            from.toLowerCase().includes('codeium') ||
            subject.toLowerCase().includes('windsurf') ||
            subject.toLowerCase().includes('verification')) {
          
          console.log(`[TempMail] ✅ 匹配到Windsurf邮件`);
          const code = this.extractVerificationCode(body);
          if (code) {
            console.log(`[TempMail] ✅ 找到验证码: ${code}`);
            return {
              success: true,
              code: code,
              mail: mail
            };
          }
        }
      }
      
      if (i < this.maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      }
    }
    
    return {
      success: false,
      error: '未能获取验证码'
    };
  }
}
