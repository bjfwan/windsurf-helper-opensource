/**
 * Windsurf 注册助手 - 本地后端
 * 
 * 功能：
 *   1. POST /api/start-monitor  - 记录开始监控的邮箱和 session
 *   2. GET  /api/check-code/:sessionId - 从 QQ 邮箱 IMAP 拉取验证码
 *   3. POST /api/accounts       - 保存账号（写入本地 JSON 文件）
 *   4. GET  /api/accounts       - 获取所有账号
 *   5. GET  /api/health         - 健康检查
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const { checkCodeFromQQMail } = require('./imap-client');

// ===== 加载配置 =====
const configPath = path.join(__dirname, 'backend-config.js');
if (!fs.existsSync(configPath)) {
  console.error('[Server] ❌ 缺少配置文件 backend-config.js');
  console.error('[Server] 请复制 backend-config.example.js 为 backend-config.js 并填写配置');
  process.exit(1);
}
const { BACKEND_CONFIG } = require('./backend-config');

// ===== 初始化 =====
const app = express();
app.use(cors());
app.use(express.json());

// 账号存储文件
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
// session 监控表：sessionId -> { email, startTime }
const sessions = new Map();

// ===== 工具函数 =====
function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
}

// ===== 路由 =====

/**
 * GET /api/health
 * 健康检查，插件用于确认后端是否在线
 */
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    version: '1.0.0',
    time: new Date().toISOString()
  });
});

/**
 * POST /api/start-monitor
 * 插件在提交注册表单后调用，通知后端开始监控某个邮箱
 * Body: { email, session_id }
 */
app.post('/api/start-monitor', (req, res) => {
  const { email, session_id } = req.body;

  if (!email || !session_id) {
    return res.status(400).json({ success: false, error: '缺少 email 或 session_id' });
  }

  sessions.set(session_id, {
    email,
    startTime: Date.now()
  });

  console.log(`[Monitor] 开始监控 session=${session_id} email=${email}`);
  res.json({ success: true, session_id, email });
});

/**
 * GET /api/check-code/:sessionId
 * 插件轮询此接口获取验证码
 * 返回: { success: true, code: '123456' } 或 { success: false }
 */
app.get('/api/check-code/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ success: false, error: '未找到该 session，请先调用 start-monitor' });
  }

  try {
    console.log(`[CheckCode] 查询 session=${sessionId} email=${session.email}`);
    const code = await checkCodeFromQQMail(BACKEND_CONFIG, session.email, session.startTime);

    if (code) {
      console.log(`[CheckCode] ✅ 找到验证码: ${code}`);
      // 找到后删除 session，避免重复查询
      sessions.delete(sessionId);
      return res.json({ success: true, code });
    } else {
      return res.json({ success: false });
    }
  } catch (error) {
    console.error(`[CheckCode] 查询失败:`, error.message);
    return res.json({ success: false, error: error.message });
  }
});

/**
 * POST /api/accounts
 * 保存注册成功的账号到本地 JSON 文件
 * Body: { email, password, username, status, created_at }
 */
app.post('/api/accounts', (req, res) => {
  const { email, password, username, status, created_at } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, error: '缺少 email' });
  }

  const accounts = loadAccounts();
  const existing = accounts.findIndex(a => a.email === email);
  const record = {
    id: existing >= 0 ? accounts[existing].id : Date.now().toString(),
    email,
    password: password || '',
    username: username || '',
    status: status || 'pending',
    created_at: created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (existing >= 0) {
    accounts[existing] = record;
  } else {
    accounts.push(record);
  }

  saveAccounts(accounts);
  console.log(`[Accounts] 已保存账号: ${email}`);
  res.json({ success: true, data: record });
});

/**
 * GET /api/accounts
 * 获取所有账号列表
 */
app.get('/api/accounts', (req, res) => {
  const accounts = loadAccounts();
  res.json({ success: true, data: accounts });
});

/**
 * DELETE /api/accounts/:id
 * 删除指定账号
 */
app.delete('/api/accounts/:id', (req, res) => {
  const { id } = req.params;
  const accounts = loadAccounts();
  const filtered = accounts.filter(a => a.id !== id);

  if (filtered.length === accounts.length) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }

  saveAccounts(filtered);
  res.json({ success: true });
});

// ===== 启动 =====
const PORT = BACKEND_CONFIG.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Windsurf Helper 本地后端已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   健康检查: http://localhost:${PORT}/api/health`);
  console.log(`   账号列表: http://localhost:${PORT}/api/accounts`);
  console.log(`\n   QQ邮箱: ${BACKEND_CONFIG.QQ_EMAIL}`);
  console.log(`   监控域名: *@${BACKEND_CONFIG.DOMAIN}\n`);
});
