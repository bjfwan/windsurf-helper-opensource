/**
 * API配置文件示例
 * 
 * 使用说明：
 * 1. 复制此文件为 config.js
 * 2. 填写您自己部署的API地址和Supabase信息
 * 3. config.js 已在 .gitignore 中，不会被提交到Git
 * 
 * 注意：这些是您的私密配置，请勿分享！
 */

// ==================== API 配置 ====================
const API_CONFIG = {
  // 您部署在 Vercel 的API地址
  BASE_URL: 'https://your-project.vercel.app',
  
  // API密钥（可选，如果后端设置了的话）
  API_KEY: '',
  
  // 请求超时时间（毫秒）
  TIMEOUT: 10000,
  
  // 验证码轮询间隔（毫秒）
  POLL_INTERVAL: 5000,
  
  // API端点配置
  ENDPOINTS: {
    HEALTH: '/api/health',
    START_MONITOR: '/api/start-monitor',
    CHECK_CODE: '/api/check-code',
    SAVE_ACCOUNT: '/api/accounts',
    UPDATE_ACCOUNT: '/api/accounts',
    DELETE_ACCOUNT: '/api/accounts',
    GET_ACCOUNTS: '/api/accounts'
  }
};

// ==================== Supabase 配置（可选） ====================
// 注意：Serverless版本不需要直接访问Supabase，所有请求通过API转发
// 如果您的API已经处理了Supabase交互，可以不配置此部分
const SUPABASE_CONFIG = {
  url: 'https://xxxxx.supabase.co',
  key: 'your-anon-key-here'
};
