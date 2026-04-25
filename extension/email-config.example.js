/**
 * 邮箱配置文件模板
 *
 * 使用说明：
 *   1. 复制此文件为 email-config.js（已 .gitignore）
 *   2. 选择邮箱来源：EMAIL_PROVIDER = 'temp-mail' | 'qq-imap'
 *   3. 填写对应来源的子配置
 *
 * 命名说明：
 *   - 顶层 EMAIL_PROVIDER / EMAIL_CONFIG.provider 表示"邮箱来源"
 *     （temp-mail = 浏览器直连临时邮箱；qq-imap = 经本地/云端后端走 IMAP）
 *   - tempMail.provider 表示该来源下使用的"具体服务"
 *     （1secmail / guerrilla-mail / 自定义集成）
 *   - 旧字段 EMAIL_CONFIG.mode 仍兼容（getter 转发到 provider）
 *
 * 协议常量（headers / endpoints / 客户端版本）由 protocol-contract.js 集中管理，
 * 这里不再硬编码。
 */

// ==================== 选择来源 ====================
// 'temp-mail': 浏览器直连临时邮箱（无需后端，但需找到 Windsurf 接受的临时邮箱服务）
// 'qq-imap'  : 通过 backend/ 下的本地（或 Vercel）后端走 IMAP 拉验证码（推荐）
const EMAIL_PROVIDER = 'qq-imap';

// ==================== 临时邮箱（temp-mail）来源 ====================
const TEMP_MAIL_CONFIG = {
  // 子服务名称（这一层的 provider 表示"用哪一家临时邮箱服务"）
  // 内置：'1secmail' | 'guerrilla-mail'
  // 自定义：参考 docs/temp-mail-setup.md
  provider: 'guerrilla-mail',
  prefix: 'windsurf',
  domain: 'tempr.email',
  pollInterval: 5000,   // 5 秒检查一次
  maxAttempts: 60       // 共 5 分钟超时
};

// ==================== 自有域名 + IMAP（qq-imap）来源 ====================
const QQ_IMAP_CONFIG = {
  domain: 'example.com',         // 你的域名（CF Email Routing 转发到 QQ 邮箱）
  emailPrefix: 'windsurf',       // 生成 windsurf-xxxxx@example.com
  apiBaseUrl: '',                // 留空，由 config.js 中 BASE_URL 统一控制
  apiKey: '',                    // 后端如设置了 API key 才填
  pollInterval: 5000,
  timeout: 120000                // 2 分钟超时
};

// ==================== 导出配置 ====================
const EMAIL_CONFIG = {
  provider: EMAIL_PROVIDER,
  tempMail: TEMP_MAIL_CONFIG,
  qqImap: QQ_IMAP_CONFIG,

  // 兼容旧字段：曾使用 mode/prefix/domain 顶层访问
  get mode() { return this.provider; },
  get prefix() {
    return this.provider === 'temp-mail' ? this.tempMail.prefix : this.qqImap.emailPrefix;
  },
  get domain() {
    return this.provider === 'temp-mail' ? this.tempMail.domain : this.qqImap.domain;
  }
};
