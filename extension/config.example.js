/**
 * API 客户端运行时配置模板
 *
 * 决策理由：协议层常量（客户端名 / 版本 / 协议版本 / endpoints / headers / metadata）
 *           统一由 protocol-contract.js 维护，本文件只保留与"用户运行环境"相关的字段：
 *           - BASE_URL    : 后端地址（本地 vs Vercel）
 *           - API_KEY     : 后端如设置了网关密钥，才需要填
 *           - TIMEOUT     : 单次请求超时
 *           - POLL_INTERVAL: 验证码轮询间隔
 *
 *           CLIENT_NAME / CLIENT_VERSION / PROTOCOL_VERSION 由 getter 从协议契约转发，
 *           保持向后兼容（旧代码读 API_CONFIG.PROTOCOL_VERSION 仍可用）。
 */
const protocolClient = typeof WindsurfProtocol !== 'undefined'
  ? WindsurfProtocol.client
  : {
      name: 'windsurf-helper-opensource',
      version: '4.0.0',
      protocolVersion: '1'
    };

const API_CONFIG = {
  BASE_URL: 'http://localhost:3000',
  API_KEY: '',
  TIMEOUT: 10000,
  POLL_INTERVAL: 5000,

  // 决策理由：getter 转发避免在多份配置里重复声明协议字段，
  // 如需"快照"语义（避免运行时被改动）可改回 const 直拷贝。
  get CLIENT_NAME() { return protocolClient.name; },
  get CLIENT_VERSION() { return protocolClient.version; },
  get PROTOCOL_VERSION() { return protocolClient.protocolVersion; }
};
