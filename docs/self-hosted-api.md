# 📧 自有域名模式配置指南

> 本指南覆盖**两种部署方式**——**本地 Node.js 后端**（推荐）与**云端 Vercel 部署**（可选）。
> 二者共用相同的 Cloudflare Email Routing + QQ 邮箱 IMAP 链路，只是 API 服务的运行位置不同。

---

## 🚦 选哪种？

| 维度 | 💻 本地 Node.js 后端（推荐） | ☁️ Vercel 云端部署 |
|---|---|---|
| **部署难度** | ⭐ 双击 `start-backend.bat` | ⭐⭐⭐ 需要 Vercel CLI / Git |
| **运行机器** | 用户本机（localhost:3000） | Vercel 边缘节点 |
| **持续在线** | 仅 popup + 后端进程同时打开时可用 | 24/7 在线 |
| **数据存储** | `backend/accounts.json`（明文，已 .gitignore） | Supabase（可选，需另配） |
| **额外依赖** | Node.js 18+ | Vercel CLI、可选 Supabase |
| **适用场景** | 单机长期使用 | 多设备共享、跨网络访问 |

**没有特殊需求时优先选本地后端**：开箱即用、隐私可控、零云费用。

---

## 📋 共同前置要求（两种方式都需要）

| 项目 | 说明 | 费用 | 必需性 |
|------|------|------|--------|
| 🌐 域名 | 用于接收邮件（如 `example.com`） | ~$10/年 | 必需 |
| ☁️ Cloudflare | Email Routing 转发到 QQ | 免费 | 必需 |
| 📮 QQ邮箱 | 实际收件箱（IMAP + 授权码） | 免费 | 必需 |

**仅 Vercel 模式额外需要**：

| 项目 | 说明 | 费用 |
|------|------|------|
| 🚀 Vercel 账号 | 部署 serverless API | 免费额度 |
| 🗄️ Supabase | 跨设备数据库（可选） | 免费额度 |

---

## 🅰 方式 A：本地 Node.js 后端（推荐 5 分钟搞定）

```
1. 配置 Cloudflare Email Routing → 转发到 QQ 邮箱（见步骤 1）
2. 开启 QQ 邮箱 IMAP 并获取授权码（见步骤 2）
3. 双击 start-backend.bat（首次自动 npm install + 创建配置文件）
4. 编辑 backend/backend-config.js 填入 QQ_EMAIL / QQ_AUTH_CODE / DOMAIN
5. 重新运行 start-backend.bat 启动服务
6. extension/config.js 中 BASE_URL 保持默认 http://localhost:3000
```

✅ 完成后任何时候只要 `start-backend.bat` 运行中、popup 打开，注册流程即可工作。

---

## 🅱 方式 B：Vercel 云端部署（可选）

```
1. 配置 Cloudflare Email Routing → 转发到 QQ 邮箱（见步骤 1）
2. 开启 QQ 邮箱 IMAP 并获取授权码（见步骤 2）
3. （可选）创建 Supabase 项目用于跨设备账号同步（见步骤 3）
4. 把 backend/ 代码部署到 Vercel（见步骤 4）
5. extension/config.js 中 BASE_URL 改为 https://your-project.vercel.app
```

> 💡 下方"详细配置步骤"中的步骤 1-2 是两种方式的公共部分，步骤 3-4 仅 Vercel 模式需要。
> 步骤 5 中"选项 A 本地" / "选项 B Vercel" 给出两种方式的具体填写示例。

---

## 🛠️ 详细配置步骤

### 步骤1：配置 Cloudflare Email Routing

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 添加您的域名
3. 进入 **Email** → **Email Routing**
4. 设置 **Catch-all** 转发到您的 QQ 邮箱
5. 验证邮箱地址

---

### 步骤2：获取 QQ 邮箱授权码

1. 登录 [QQ 邮箱](https://mail.qq.com/)
2. **设置** → **账户**
3. 开启 **IMAP/SMTP 服务**
4. 生成**授权码**（非 QQ 密码！）
5. 保存授权码（后续需要用到）

---

### 步骤3：创建 Supabase 数据库（可选）

#### 3.1 注册并创建项目

1. 访问 [Supabase](https://supabase.com/) 并注册账号
2. 点击 **"New Project"** 创建新项目
3. 填写项目信息：
   - Project Name: `windsurf-helper`
   - Database Password: 设置强密码
   - Region: 选择最近的地区
4. 等待项目创建完成（约2分钟）

#### 3.2 创建数据表

1. 在项目页面，点击 **"SQL Editor"**
2. 点击 **"New query"**
3. 执行以下 SQL：

```sql
-- 创建账号表
CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  error_message TEXT
);

-- 创建验证码日志表
CREATE TABLE verification_logs (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  subject TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_verification_logs_session_email 
ON verification_logs(session_id, email, received_at DESC);

-- 启用 RLS 并允许匿名访问
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "允许匿名访问 accounts" ON accounts
FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE verification_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "允许匿名访问 verification_logs" ON verification_logs
FOR ALL USING (true) WITH CHECK (true);
```

#### 3.3 获取 API 密钥

1. **Project Settings** → **API**
2. 保存以下信息：
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGciOi...`（很长的字符串）

---

### 步骤4：部署 Vercel API

#### 4.1 准备后端代码

在项目根目录创建 `api` 文件夹，包含以下文件：

**`api/package.json`**
```json
{
  "name": "windsurf-helper-api",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "imap": "^0.8.19",
    "mailparser": "^3.6.5"
  }
}
```

**`api/get-verification-code.js`**  
_(代码较长，请参考项目示例文件或联系作者获取)_

**`api/vercel.json`**
```json
{
  "version": 2,
  "builds": [{"src": "api/*.js", "use": "@vercel/node"}],
  "routes": [{"src": "/api/(.*)", "dest": "/api/$1"}]
}
```

#### 4.2 部署到 Vercel

**方式一：使用 Vercel CLI**

```bash
# 安装 Vercel CLI
npm install -g vercel

# 登录
vercel login

# 部署
cd api
vercel

# 配置环境变量
vercel env add QQ_EMAIL            # 输入 QQ 邮箱
vercel env add QQ_AUTH_CODE        # 输入授权码
vercel env add SUPABASE_URL        # 输入 Supabase URL
vercel env add SUPABASE_KEY        # 输入 Supabase key

# 重新部署
vercel --prod
```

**方式二：使用 Vercel 网页**

1. 访问 [Vercel](https://vercel.com/)
2. **Add New** → **Project**
3. 导入 GitHub 仓库
4. 配置环境变量（Settings → Environment Variables）
5. 点击 **Deploy**

---

### 步骤5：配置插件

#### 5.1 修改 `extension/email-config.js`

```javascript
const EMAIL_MODE = 'qq-imap';  // 启用本地后端 / Vercel 模式

const QQ_IMAP_CONFIG = {
  domain: 'yourdomain.com',      // 填写您的域名
  emailPrefix: 'windsurf',       // 生成 windsurf+xxx@yourdomain.com
  pollInterval: 5000,
  timeout: 120000
};
```

#### 5.2 修改 `extension/config.js`

**选项 A：本地后端（默认）**

```javascript
const API_CONFIG = {
  BASE_URL: 'http://localhost:3000',   // 本地 Node 后端地址
  API_KEY: '',                         // 本地后端不需要
  TIMEOUT: 10000,
  POLL_INTERVAL: 5000,
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
```

同时编辑 `backend/backend-config.js`（从 `backend-config.example.js` 复制）：

```javascript
const BACKEND_CONFIG = {
  PORT: 3000,
  QQ_EMAIL: 'your-qq@qq.com',
  QQ_AUTH_CODE: 'xxxxxxxxxxxxxxxx',
  DOMAIN: 'yourdomain.com'
};
module.exports = { BACKEND_CONFIG };
```

**选项 B：Vercel 云端**

```javascript
const API_CONFIG = {
  BASE_URL: 'https://your-project.vercel.app',  // 你的 Vercel 部署地址
  API_KEY: '',
  TIMEOUT: 10000,
  POLL_INTERVAL: 5000,
  ENDPOINTS: { /* 同上 */ }
};
```

Vercel 环境变量 会代替本地 `backend-config.js` 提供凭证（见步骤 4.2）。

---

### 步骤6：测试

**本地后端模式**：
1. 运行 `start-backend.bat` 启动后端
2. 访问 `http://localhost:3000/api/health` 确认返回 `{success:true}`
3. 重新加载插件：`edge://extensions/` → 刷新
4. 访问 Windsurf 注册页面测试
5. 点击插件 🧠 图标查看诊断报告

**Vercel 模式**：
1. 访问 `https://your-project.vercel.app/api/health` 确认返回 `{success:true}`
2. 重新加载插件：`edge://extensions/` → 刷新
3. 访问 Windsurf 注册页面测试

---

## ❓ 常见问题

**Q: 为什么需要自己部署？**
A: 完全开源，数据自控，不依赖他人服务器。

**Q: 本地后端与 Vercel 模式怎么选？**
A: 单机使用选**本地后端**（零部署、零云费用）。需要多设备共享账号库、或希望 24/7 在线选 **Vercel**。

**Q: 部署费用多少？**
A: 两种方式都是 ~$10/年（仅域名）。Vercel、Supabase、Cloudflare 都有充裕免费额度；本地后端运行在你机器上，完全免费。

**Q: 本地后端多复杂？**
A: Windows 双击 `start-backend.bat` 即可。首次会自动 `npm install`，其后只需保持进程运行。

**Q: Vercel 部署多复杂？**
A: 有一定技术门槛，建议熟悉 Git/Node 的开发者使用。

---

## 📞 需要帮助？

如果在配置过程中遇到问题，欢迎：
- 📧 Email: 2632507193@qq.com
- 🐛 [提交 Issue](https://github.com/bjfwan/windsurf-helper-opensource/issues)
