# 📧 自建API模式配置指南

> ⚠️ 此模式需要自己部署后端服务，适合有技术基础的用户

---

## 📋 前置要求

| 项目 | 说明 | 费用 | 必需性 |
|------|------|------|--------|
| 🌐 域名 | 用于接收邮件（如 example.com） | ~$10/年 | 必需 |
| ☁️ Cloudflare | 邮件路由服务 | 免费 | 必需 |
| 📮 QQ邮箱 | 接收转发的验证码邮件 | 免费 | 必需 |
| 🚀 Vercel | 部署后端API服务 | 免费 | 必需 |
| 🗄️ Supabase | 数据库存储（可选） | 免费 | 可选 |

---

## 📝 配置流程概览

```
1. 运行 setup 脚本（创建配置文件）
   ↓
2. 部署后端服务（Vercel + Cloudflare + QQ邮箱）
   ↓
3. 修改配置文件（填写API地址和域名）
   ↓
4. 加载插件使用
```

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

#### 5.1 修改 `email-config.js`

```javascript
const EMAIL_MODE = 'qq-imap';  // 改为 API 模式

const QQ_IMAP_CONFIG = {
  domain: 'yourdomain.com',      // 填写您的域名
  emailPrefix: 'windsurf',
  apiBaseUrl: '',
  apiKey: '',
  pollInterval: 5000,
  timeout: 120000
};
```

#### 5.2 修改 `config.js`

```javascript
const API_CONFIG = {
  BASE_URL: 'https://your-project.vercel.app',  // Vercel API 地址
  API_KEY: '',
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

---

### 步骤6：测试

1. 重新加载插件：`edge://extensions/` → 刷新
2. 访问注册页面测试
3. 点击插件 🧠 图标查看诊断报告

---

## ❓ 常见问题

**Q: 为什么需要自己部署？**  
A: 完全开源，数据自控，不依赖他人服务器。

**Q: 部署费用多少？**  
A: Vercel免费，Supabase免费，Cloudflare免费，只需购买域名（~$10/年）。

**Q: 部署有多复杂？**  
A: 有一定技术门槛，建议有基础的开发者使用。

---

## 📞 需要帮助？

如果在配置过程中遇到问题，欢迎：
- 📧 Email: 2632507193@qq.com
- 🐛 [提交 Issue](https://github.com/bjfwan/windsurf-helper-opensource/issues)
