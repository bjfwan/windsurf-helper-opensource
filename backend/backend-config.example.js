/**
 * 后端配置文件模板
 *
 * 使用说明：
 *   1. 复制此文件为 backend-config.js
 *   2. 填写你的 QQ 邮箱信息和域名
 *   3. backend-config.js 已在 .gitignore 中，不会被提交
 */

const BACKEND_CONFIG = {
  // 后端监听端口
  PORT: 3000,

  // ===== QQ 邮箱配置 =====
  // 你的 QQ 邮箱地址
  QQ_EMAIL: 'your-qq@qq.com',

  // QQ 邮箱授权码（不是 QQ 密码！）
  // 获取方式：QQ邮箱 → 设置 → 账户 → 开启IMAP/SMTP → 生成授权码
  QQ_AUTH_CODE: 'your-auth-code-here',

  // ===== 域名配置 =====
  // 你的域名（已在 Cloudflare 配置 Email Routing 转发到上面的 QQ 邮箱）
  DOMAIN: 'example.com'
};

module.exports = { BACKEND_CONFIG };
