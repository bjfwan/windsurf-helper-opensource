# 🚀 后端服务部署指南

本文档详细说明如何部署后端服务（QQ邮箱模式需要）。

---

## 📋 前置要求

### 必需资源

| 项目 | 用途 | 费用 | 注册地址 |
|------|------|------|----------|
| Vercel 账号 | 部署后端API | 免费 | https://vercel.com |
| Supabase 账号 | 数据库存储 | 免费 | https://supabase.com |
| QQ邮箱 | 接收验证码 | 免费 | - |
| 域名 | 邮件转发 | ~$10/年 | 任意域名商 |
| Cloudflare 账号 | 邮件路由 | 免费 | https://cloudflare.com |

---

## 🗄️ 步骤1：创建 Supabase 数据库

### 1.1 注册并创建项目

```
1. 访问 https://supabase.com
2. 使用 GitHub 账号登录
3. 点击 "New Project"
4. 填写项目信息：
   - Name: windsurf-helper
   - Database Password: 设置强密码（保存好！）
   - Region: 选择离您最近的区域
5. 点击 "Create new project"
6. 等待约2分钟项目创建完成
```

### 1.2 创建数据表

在 Supabase Dashboard 中：

```sql
-- 1. 进入 SQL Editor
-- 2. 创建 accounts 表

CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  username TEXT,
  session_id TEXT UNIQUE,
  verification_code TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 创建索引
CREATE INDEX idx_session_id ON accounts(session_id);
CREATE INDEX idx_email ON accounts(email);
CREATE INDEX idx_created_at ON accounts(created_at DESC);

-- 4. 启用 RLS（行级安全）
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- 5. 创建策略（允许服务角色访问）
CREATE POLICY "Enable all for service role"
ON accounts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

### 1.3 获取密钥

```
1. 点击左侧菜单 "Settings" → "API"
2. 找到以下信息并保存：
   - Project URL（类似 https://xxx.supabase.co）
   - anon public key
   - service_role key（重要！不要泄露）
```

---

## 📧 步骤2：配置 Cloudflare Email Routing

### 2.1 添加域名到 Cloudflare

```
1. 登录 Cloudflare Dashboard
2. 点击 "Add a Site"
3. 输入您的域名（如 example.com）
4. 选择 Free 计划
5. 按照提示修改域名的 NS 记录
6. 等待域名验证通过（通常10分钟内）
```

### 2.2 设置 Email Routing

```
1. 在 Cloudflare Dashboard 中选择您的域名
2. 点击左侧菜单 "Email" → "Email Routing"
3. 点击 "Get started"
4. 添加目标邮箱：输入您的 QQ 邮箱
5. 验证邮箱：查收验证邮件并点击确认
6. 创建路由规则：
   - Type: Custom address
   - Expression: *@yourdomain.com
   - Action: Send to → 您的QQ邮箱
7. 保存规则
```

### 2.3 测试邮件转发

```
1. 使用另一个邮箱发送测试邮件到 test@yourdomain.com
2. 检查您的 QQ 邮箱是否收到
3. 如果没收到，检查垃圾邮件文件夹
```

---

## 📮 步骤3：获取 QQ 邮箱授权码

### 3.1 开启 IMAP 服务

```
1. 登录 QQ 邮箱网页版
2. 点击右上角 "设置" → "账户"
3. 找到 "POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务"
4. 开启 "IMAP/SMTP服务"
5. 按照提示发送短信验证
```

### 3.2 生成授权码

```
1. 在同一页面点击 "生成授权码"
2. 再次发送短信验证
3. 复制生成的授权码（16位字符，如：abcdabcdabcdabcd）
4. ⚠️ 重要：这不是您的QQ密码！请妥善保管
```

---

## 🚀 步骤4：部署到 Vercel

### 4.1 准备代码

从私有项目中复制 `api` 文件夹到本项目：

```bash
# 假设您有私有项目的访问权限
# 将 api 文件夹复制到当前项目根目录
cp -r /path/to/private/project/api ./
```

`api` 文件夹结构应该是：
```
api/
├── check-code.py       # 检查验证码
├── get-accounts.py     # 获取账号列表  
├── save-account.py     # 保存账号
├── update-account.py   # 更新账号
└── delete-account.py   # 删除账号
```

### 4.2 部署到 Vercel

#### 方法1：通过 Vercel CLI（推荐）

```bash
# 1. 安装 Vercel CLI
npm install -g vercel

# 2. 登录 Vercel
vercel login

# 3. 进入项目目录
cd windsurf-helper-opensource

# 4. 部署
vercel

# 5. 按提示操作：
#    - Set up and deploy? Yes
#    - Which scope? 选择您的账号
#    - Link to existing project? No
#    - Project name? windsurf-helper
#    - In which directory is your code? ./
#    - Override settings? No
```

#### 方法2：通过 GitHub + Vercel Dashboard

```
1. 将项目推送到 GitHub
2. 访问 https://vercel.com
3. 点击 "New Project"
4. 导入您的 GitHub 仓库
5. 配置项目：
   - Framework Preset: Other
   - Root Directory: ./
6. 点击 "Deploy"
```

### 4.3 配置环境变量

在 Vercel Dashboard 中：

```
1. 进入您的项目
2. 点击 "Settings" → "Environment Variables"
3. 添加以下变量：

SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp...（service_role key）
EMAIL_ADDRESS=your-email@qq.com
EMAIL_PASSWORD=your-qq-auth-code（16位授权码）
API_SECRET_KEY=（可选，自定义密钥）

4. 点击 "Save"
5. 重新部署项目使环境变量生效
```

### 4.4 获取API地址

```
部署成功后，Vercel 会分配一个域名：
https://your-project-name.vercel.app

这就是您的后端 API 地址！
```

---

## ⚙️ 步骤5：配置插件

### 5.1 创建配置文件

```bash
cd extension
cp email-config.example.js email-config.js
```

### 5.2 编辑配置

打开 `extension/email-config.js`：

```javascript
const EMAIL_MODE = 'qq-imap';  // 改为 QQ邮箱模式

const QQ_IMAP_CONFIG = {
  domain: 'yourdomain.com',  // 您的域名
  emailPrefix: 'windsurf',
  apiBaseUrl: 'https://your-project.vercel.app',  // Vercel分配的域名
  apiKey: 'your-api-secret-key',  // 如果设置了API_SECRET_KEY
  pollInterval: 5000,
  timeout: 120000
};
```

---

## ✅ 步骤6：测试

### 6.1 测试后端API

```bash
# 测试保存账号接口
curl -X POST https://your-project.vercel.app/api/save-account \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-secret-key" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#",
    "username": "testuser",
    "session_id": "test_session_123"
  }'

# 预期返回
{"success": true, "message": "账号已保存"}
```

### 6.2 测试邮件接收

```
1. 访问 Windsurf 注册页面
2. 使用插件开始注册
3. 等待验证码自动显示
4. 如果出现问题，检查：
   - Vercel 部署日志
   - Supabase 数据库日志
   - QQ 邮箱是否收到邮件
```

---

## 🔧 常见问题

<details>
<summary><b>Q: API 返回 401 Unauthorized？</b></summary>

A: 
1. 检查 Vercel 环境变量中的 API_SECRET_KEY
2. 确保插件配置中的 apiKey 与之匹配
3. 如果不需要密钥保护，删除环境变量中的 API_SECRET_KEY
</details>

<details>
<summary><b>Q: 收不到验证码？</b></summary>

A:
1. 检查 Cloudflare Email Routing 是否正常工作
2. 确认 QQ 邮箱授权码正确
3. 查看 QQ 邮箱垃圾邮件文件夹
4. 检查 Vercel 部署日志中的错误信息
</details>

<details>
<summary><b>Q: Supabase 连接失败？</b></summary>

A:
1. 确认使用的是 service_role key（不是 anon key）
2. 检查 RLS 策略是否正确设置
3. 确认 Supabase URL 正确
</details>

---

## 📞 需要帮助？

- 📧 Email: 2632507193@qq.com
- 🐛 Issues: [GitHub Issues](https://github.com/bjfwan/windsurf-helper-opensource/issues)
- ⭐ Star: 如果有帮助，请给项目一个Star！

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/bjfwan">bjfwan</a>
</p>
