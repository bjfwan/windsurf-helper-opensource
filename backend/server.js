const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const protocol = require('../protocol-contract');
const { checkCodeFromQQMail } = require('./imap-client');

const configPath = path.join(__dirname, 'backend-config.js');
if (!fs.existsSync(configPath)) {
  console.error('[Server] 缺少配置文件 backend-config.js');
  console.error('[Server] 请复制 backend-config.example.js 为 backend-config.js 并填写配置');
  process.exit(1);
}

const { BACKEND_CONFIG } = require('./backend-config');
const app = express();
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map();

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Client-Name', 'X-Client-Version', 'X-Protocol-Version']
}));
app.use(express.json());

function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
}

function buildAccountRecord(existing, payload = {}) {
  const now = new Date().toISOString();
  return {
    id: existing?.id || payload.id || Date.now().toString(),
    email: payload.email || existing?.email || '',
    password: payload.password ?? existing?.password ?? '',
    username: payload.username ?? existing?.username ?? '',
    status: payload.status ?? existing?.status ?? 'pending',
    provider: payload.provider ?? existing?.provider ?? '',
    session_id: payload.session_id ?? existing?.session_id ?? '',
    verification_code: payload.verification_code ?? existing?.verification_code ?? '',
    created_at: payload.created_at ?? existing?.created_at ?? now,
    verified_at: payload.verified_at ?? existing?.verified_at ?? '',
    updated_at: now
  };
}

function upsertAccount(payload = {}) {
  const accounts = loadAccounts();
  const existingIndex = accounts.findIndex(account => account.email === payload.email);
  const existing = existingIndex >= 0 ? accounts[existingIndex] : null;
  const record = buildAccountRecord(existing, payload);

  if (existingIndex >= 0) {
    accounts[existingIndex] = record;
  } else {
    accounts.push(record);
  }

  saveAccounts(accounts);
  return record;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  let removed = 0;

  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.startTime > SESSION_TTL_MS) {
      sessions.delete(sessionId);
      removed++;
    }
  }

  return removed;
}

function filterAccounts(accounts, query = {}) {
  return accounts.filter(account => {
    if (query.email && account.email !== query.email) {
      return false;
    }

    if (query.status && account.status !== query.status) {
      return false;
    }

    if (query.session_id && account.session_id !== query.session_id) {
      return false;
    }

    return true;
  });
}

setInterval(() => {
  cleanupExpiredSessions();
}, 60 * 1000).unref?.();

app.get(protocol.api.endpoints.health, (req, res) => {
  cleanupExpiredSessions();
  res.json({
    success: true,
    status: 'ok',
    version: protocol.client.version,
    protocol_version: protocol.client.protocolVersion,
    account_count: loadAccounts().length,
    session_count: sessions.size,
    time: new Date().toISOString()
  });
});

app.post(protocol.api.endpoints.startMonitor, (req, res) => {
  const { email, session_id } = req.body || {};

  if (!email || !session_id) {
    return res.status(400).json({ success: false, error: '缺少 email 或 session_id' });
  }

  cleanupExpiredSessions();
  sessions.set(session_id, {
    email,
    startTime: Date.now()
  });

  console.log(`[Monitor] 开始监控 session=${session_id} email=${email}`);
  return res.json({ success: true, session_id, email });
});

app.get(`${protocol.api.endpoints.checkCode}/:sessionId`, async (req, res) => {
  cleanupExpiredSessions();
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ success: false, error: '未找到该 session，请先调用 start-monitor' });
  }

  try {
    const code = await checkCodeFromQQMail(BACKEND_CONFIG, session.email, session.startTime);

    if (code) {
      sessions.delete(sessionId);
      upsertAccount({
        email: session.email,
        session_id: sessionId,
        status: 'verified',
        verification_code: code,
        verified_at: new Date().toISOString()
      });
      return res.json({ success: true, code });
    }

    return res.json({ success: false });
  } catch (error) {
    console.error('[CheckCode] 查询失败:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get(protocol.api.endpoints.accounts, (req, res) => {
  const filtered = filterAccounts(loadAccounts(), req.query || {});
  const limit = Number.parseInt(req.query?.limit, 10);
  const data = Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered;
  res.json({ success: true, data });
});

app.post(protocol.api.endpoints.accounts, (req, res) => {
  if (!req.body?.email) {
    return res.status(400).json({ success: false, error: '缺少 email' });
  }

  const record = upsertAccount(req.body);
  console.log(`[Accounts] 已保存账号: ${record.email}`);
  return res.json({ success: true, data: record });
});

app.patch(protocol.api.endpoints.accounts, (req, res) => {
  if (!req.body?.email) {
    return res.status(400).json({ success: false, error: '缺少 email' });
  }

  const record = upsertAccount(req.body);
  console.log(`[Accounts] 已更新账号: ${record.email}`);
  return res.json({ success: true, data: record });
});

app.delete(`${protocol.api.endpoints.accounts}/:id`, (req, res) => {
  const { id } = req.params;
  const accounts = loadAccounts();
  const filtered = accounts.filter(account => account.id !== id);

  if (filtered.length === accounts.length) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }

  saveAccounts(filtered);
  return res.json({ success: true });
});

// 决策理由：在启动时打印 imap-client.js 的特征字符串和文件 mtime，
// 方便以后一眼判断"修改了文件但忘记重启 node 进程"的情况——
// 检查"客户端 To 过滤"特征字符串（拉回邮件后按 toAddr.includes 过滤），
// 这是真正避免拿到旧验证码的护栏。
const imapPath = path.join(__dirname, 'imap-client.js');
const imapSrc = fs.readFileSync(imapPath, 'utf-8');
const hasClientToFilter = imapSrc.includes('跳过：To 不匹配');
const imapMtime = fs.statSync(imapPath).mtime;

const PORT = BACKEND_CONFIG.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nWindsurf Helper 本地后端已启动`);
  console.log(`地址: http://localhost:${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}${protocol.api.endpoints.health}`);
  console.log(`账号列表: http://localhost:${PORT}${protocol.api.endpoints.accounts}`);
  console.log(`协议版本: ${protocol.client.protocolVersion}`);
  console.log(`QQ邮箱: ${BACKEND_CONFIG.QQ_EMAIL}`);
  console.log(`监控域名: *@${BACKEND_CONFIG.DOMAIN}`);
  console.log(`imap-client.js mtime: ${imapMtime.toISOString()}`);
  console.log(`客户端 To 过滤: ${hasClientToFilter ? '✅ 已启用' : '❌ 未启用（请检查 imap-client.js）'}\n`);
});
