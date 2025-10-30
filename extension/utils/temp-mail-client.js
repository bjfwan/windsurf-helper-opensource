/**
 * 临时邮箱客户端
 * 支持多个临时邮箱服务商
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
      switch (this.provider) {
        case 'temp-mail-org':
          return await this.generateTempMailOrg();
        case 'guerrilla-mail':
          return await this.generateGuerrillaMail();
        default:
          throw new Error(`不支持的服务商: ${this.provider}`);
      }
    } catch (error) {
      console.error('[TempMail] 生成邮箱失败:', error);
      throw error;
    }
  }

  /**
   * Temp-Mail.org - 生成邮箱
   */
  async generateTempMailOrg() {
    const randomString = Math.random().toString(36).substring(2, 15);
    const domains = ['@tempr.email', '@tmpbox.net', '@moakt.com'];
    const domain = domains[Math.floor(Math.random() * domains.length)];
    
    this.currentEmail = `windsurf-${randomString}${domain}`;
    this.currentToken = btoa(this.currentEmail);
    
    return {
      email: this.currentEmail,
      token: this.currentToken
    };
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
        case 'temp-mail-org':
          return await this.checkTempMailOrg();
        case 'guerrilla-mail':
          return await this.checkGuerrillaMail();
        default:
          return [];
      }
    } catch (error) {
      console.error('[TempMail] 检查邮件失败:', error);
      return [];
    }
  }

  /**
   * Temp-Mail.org - 检查邮件
   */
  async checkTempMailOrg() {
    const response = await fetch(`https://api.temp-mail.org/request/mail/id/${this.currentToken}/`);
    
    if (!response.ok) {
      return [];
    }
    
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  /**
   * Guerrilla Mail - 检查邮件
   */
  async checkGuerrillaMail() {
    const response = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${this.currentToken}`
    );
    
    if (!response.ok) {
      return [];
    }
    
    const data = await response.json();
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
   * 轮询等待验证码
   */
  async waitForVerificationCode() {
    for (let i = 0; i < this.maxAttempts; i++) {
      console.log(`[TempMail] 第 ${i + 1}/${this.maxAttempts} 次检查...`);
      
      const mails = await this.checkMails();
      
      for (const mail of mails) {
        const subject = mail.subject || mail.mail_subject || '';
        const body = mail.body || mail.mail_body || mail.mail_text || '';
        const from = mail.from || mail.mail_from || '';
        
        // 检查是否来自 Windsurf
        if (from.toLowerCase().includes('windsurf') || 
            subject.toLowerCase().includes('windsurf') ||
            subject.toLowerCase().includes('verification')) {
          
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
