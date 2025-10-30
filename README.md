# 🚀 Windsurf 自动注册助手 - 开源版

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.0.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Edge-Compatible-orange.svg" alt="Edge">
</p>

> 🎯 自动化 Windsurf 账号注册的浏览器插件，支持两种邮箱模式，完全开源，安全无隐私问题。

---

## ✨ 特性

- 🌍 **临时邮箱模式** - 零配置，开箱即用
- 📧 **QQ邮箱模式** - 全自动获取验证码
- 🔒 **完全开源** - 代码透明，安全可靠
- 💾 **本地存储** - 数据保存在浏览器本地
- 🎨 **现代UI** - 美观易用的用户界面

---

## 📋 邮箱模式对比

| 特性 | 🌍 临时邮箱模式 | 📧 QQ邮箱模式 |
|------|---------------|-------------|
| **配置难度** | ⭐ 简单 | ⭐⭐⭐ 中等 |
| **需要后端** | ❌ 不需要 | ✅ 需要 |
| **需要域名** | ❌ 不需要 | ✅ 需要 |
| **自动化程度** | 半自动 | 全自动 |
| **验证码获取** | 手动查看 | 自动显示 |
| **推荐场景** | 快速测试 | 生产使用 |

---

## 🚀 快速开始（临时邮箱模式）

### 📦 第一步：下载项目

```bash
git clone https://github.com/bjfwan/windsurf-helper-opensource.git
cd windsurf-helper-opensource
```

### ⚙️ 第二步：配置插件

```bash
# 复制配置文件
cp extension/email-config.example.js extension/email-config.js
```

打开 `extension/email-config.js`，确保设置为：
```javascript
const EMAIL_MODE = 'temp-mail';  // 临时邮箱模式
```

### 🔧 第三步：安装插件

1. 打开 **Edge 浏览器**
2. 访问 `edge://extensions/`
3. 开启 **"开发者模式"**
4. 点击 **"加载已解压的扩展程序"**
5. 选择 `extension` 文件夹

### 🎉 第四步：使用

1. 访问 https://windsurf.com/account/register
2. 点击浏览器工具栏的**插件图标**
3. 点击 **"开始注册"**
4. 插件会自动生成临时邮箱地址（显示在界面上）
5. 前往任意临时邮箱网站，输入生成的邮箱地址查看邮件
6. 复制收到的验证码
7. 完成注册！

> 💡 **临时邮箱服务推荐**：
> - 支持多个临时邮箱服务商
> - 插件会自动选择可用的服务
> - 邮箱地址格式：`windsurf-xxxxx@tempr.email`
> - 您也可以在主流搜索引擎搜索"临时邮箱"找到更多服务

---

## 🔥 高级配置（QQ邮箱模式）

> ⚠️ 此模式需要一定的技术基础和资源准备

### 📋 前置要求

| 项目 | 说明 | 费用 |
|------|------|------|
| 🌐 域名 | 任意域名（如 example.com） | ~$10/年 |
| ☁️ Cloudflare | 邮件转发服务 | 免费 |
| 📮 QQ邮箱 | 接收验证码 | 免费 |
| 🚀 Vercel | 部署后端服务 | 免费 |
| 🗄️ Supabase | 数据库存储 | 免费 |

### 🛠️ 配置步骤

#### 1️⃣ 配置 Cloudflare Email Routing

```
1. 登录 Cloudflare Dashboard
2. 添加您的域名
3. 进入 Email → Email Routing
4. 设置 Catch-all 转发到您的 QQ 邮箱
```

#### 2️⃣ 获取 QQ 邮箱授权码

```
1. 登录 QQ 邮箱
2. 设置 → 账户
3. 开启 IMAP/SMTP 服务
4. 生成授权码（非 QQ 密码！）
5. 保存授权码
```

#### 3️⃣ 部署后端服务

##### 3.1 创建 Supabase 数据库

**步骤 1：注册并创建项目**

1. 访问 [Supabase](https://supabase.com/) 并注册账号
2. 点击 **"New Project"** 创建新项目
3. 填写项目信息：
   - Project Name: `windsurf-helper` (任意名称)
   - Database Password: 设置一个强密码（请牢记）
   - Region: 选择离您最近的地区
4. 点击 **"Create new project"**，等待项目创建完成（约2分钟）

**步骤 2：创建数据表**

1. 在项目页面，点击左侧 **"SQL Editor"**
2. 点击 **"New query"**
3. 复制以下 SQL 代码并执行：

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

-- 创建索引以提高查询性能
CREATE INDEX idx_verification_logs_session_email 
ON verification_logs(session_id, email, received_at DESC);

CREATE INDEX idx_verification_logs_received_at 
ON verification_logs(received_at DESC);

-- 为 accounts 表启用 RLS（行级安全）
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- 允许匿名插入和读取
CREATE POLICY "允许匿名访问 accounts" ON accounts
FOR ALL USING (true) WITH CHECK (true);

-- 为 verification_logs 表启用 RLS
ALTER TABLE verification_logs ENABLE ROW LEVEL SECURITY;

-- 允许匿名插入和读取
CREATE POLICY "允许匿名访问 verification_logs" ON verification_logs
FOR ALL USING (true) WITH CHECK (true);
```

4. 点击 **"Run"** 执行 SQL
5. 确认执行成功（应该显示 "Success. No rows returned"）

**步骤 3：获取 API 密钥**

1. 点击左侧 **"Project Settings"**（齿轮图标）
2. 选择 **"API"** 标签
3. 找到以下信息并保存：
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (很长的字符串)

##### 3.2 准备后端 API 代码

在您的项目根目录创建 `api` 文件夹，然后创建以下文件：

**文件 1: `api/package.json`**

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

**文件 2: `api/get-verification-code.js`**

```javascript
import Imap from 'imap';
import { simpleParser } from 'mailparser';

export default async function handler(req, res) {
  // 设置 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, session_id } = req.query;

  if (!email || !session_id) {
    return res.status(400).json({ error: 'Missing email or session_id' });
  }

  try {
    // 从环境变量获取配置
    const imapConfig = {
      user: process.env.QQ_EMAIL,
      password: process.env.QQ_AUTH_CODE,
      host: 'imap.qq.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    };

    // 查找验证码邮件
    const code = await searchVerificationEmail(imapConfig, email);

    if (code) {
      // 保存到 Supabase
      await saveToSupabase(session_id, email, code);
      
      return res.status(200).json({ 
        success: true, 
        code,
        email,
        session_id
      });
    }

    return res.status(404).json({ 
      success: false, 
      message: 'Verification code not found' 
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: error.message 
    });
  }
}

async function searchVerificationEmail(config, targetEmail) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(config);

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // 搜索最近的邮件
        imap.search([['TO', targetEmail], ['SINCE', new Date(Date.now() - 10 * 60 * 1000)]], (err, results) => {
          if (err || !results || results.length === 0) {
            imap.end();
            return resolve(null);
          }

          const fetch = imap.fetch(results, { bodies: '' });
          let found = false;

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, async (err, parsed) => {
                if (err) return;

                const text = parsed.text || '';
                const match = text.match(/(\d{6})/);
                
                if (match && !found) {
                  found = true;
                  imap.end();
                  resolve(match[1]);
                }
              });
            });
          });

          fetch.once('end', () => {
            if (!found) {
              imap.end();
              resolve(null);
            }
          });
        });
      });
    });

    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

async function saveToSupabase(sessionId, email, code) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  await fetch(`${supabaseUrl}/rest/v1/verification_logs`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      session_id: sessionId,
      email: email,
      code: code,
      subject: 'Windsurf Verification Code'
    })
  });
}
```

**文件 3: `api/vercel.json`**

```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/*.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1"
    }
  ]
}
```

##### 3.3 部署到 Vercel

**方式一：使用 Vercel CLI（推荐）**

1. 安装 Vercel CLI：
```bash
npm install -g vercel
```

2. 登录 Vercel：
```bash
vercel login
```

3. 在项目根目录部署：
```bash
cd api
vercel
```

4. 按提示操作：
   - Set up and deploy? **Y**
   - Which scope? 选择您的账号
   - Link to existing project? **N**
   - Project name? `windsurf-helper-api`
   - In which directory is your code located? `./`

5. 配置环境变量：
```bash
vercel env add QQ_EMAIL
# 输入您的 QQ 邮箱，如：your@qq.com

vercel env add QQ_AUTH_CODE
# 输入 QQ 邮箱授权码（在第2步获取）

vercel env add SUPABASE_URL
# 输入 Supabase Project URL

vercel env add SUPABASE_KEY
# 输入 Supabase anon key
```

6. 重新部署以应用环境变量：
```bash
vercel --prod
```

**方式二：使用 Vercel 网页部署**

1. 访问 [Vercel](https://vercel.com/)，登录账号
2. 点击 **"Add New"** → **"Project"**
3. 导入您的 GitHub 仓库（需先推送到 GitHub）
4. 配置项目：
   - Framework Preset: **Other**
   - Root Directory: `api`
5. 添加环境变量（Settings → Environment Variables）：
   - `QQ_EMAIL`: 您的 QQ 邮箱
   - `QQ_AUTH_CODE`: QQ 邮箱授权码
   - `SUPABASE_URL`: Supabase 项目 URL
   - `SUPABASE_KEY`: Supabase anon key
6. 点击 **"Deploy"**

**部署完成后：**
- 获取 API 地址：`https://your-project.vercel.app`
- 测试接口：访问 `https://your-project.vercel.app/api/get-verification-code?email=test@example.com&session_id=test123`

##### 3.4 配置插件

编辑 `extension/email-config.js`：

```javascript
const EMAIL_MODE = 'qq-imap';

const QQ_IMAP_CONFIG = {
  domain: 'yourdomain.com',           // 您的域名
  emailPrefix: 'windsurf',
  apiBaseUrl: 'https://your-project.vercel.app',  // Vercel 部署的 API 地址
  apiKey: '',
  pollInterval: 5000,
  timeout: 120000
};
```

##### 3.5 测试部署

1. 在浏览器中加载插件
2. 访问 Windsurf 注册页面
3. 点击"开始注册"
4. 观察插件是否自动显示验证码
5. 检查 Supabase 数据库中是否有数据记录


---

## 📁 项目结构

```
windsurf-helper-opensource/
├── 📄 README.md                    # 项目说明
├── 📄 .gitignore                   # Git忽略配置
└── 📁 extension/                   # 浏览器插件
    ├── 📄 manifest.json            # 插件清单
    ├── 📄 email-config.example.js # 配置模板
    ├── 📁 popup/                   # 弹出界面
    │   ├── index.html
    │   ├── popup.js
    │   └── styles.css
    ├── 📁 content/                 # 内容脚本
    │   └── content-script.js
    ├── 📁 background/              # 后台服务
    │   └── service-worker.js
    └── 📁 utils/                   # 工具库
        ├── temp-mail-client.js    # 临时邮箱客户端 ✨
        ├── email-generator.js     # 邮箱生成器
        ├── db-manager.js          # 数据库管理
        └── ...
```

---

## ❓ 常见问题

<details>
<summary><b>Q: 临时邮箱模式下，验证码在哪里查看？</b></summary>

A: 插件会显示生成的邮箱地址（如 `windsurf-xxx@tempr.email`），您需要：
1. 复制生成的邮箱地址
2. 在搜索引擎搜索"临时邮箱"找到相关服务
3. 在临时邮箱服务网站输入邮箱地址
4. 查看收到的邮件，复制验证码

💡 提示：多数临时邮箱服务都支持直接粘贴邮箱地址查看邮件
</details>

<details>
<summary><b>Q: 为什么选择临时邮箱模式？</b></summary>

A: 
- ✅ 无需任何配置
- ✅ 无需后端服务器
- ✅ 完全免费
- ✅ 适合快速测试
</details>

<details>
<summary><b>Q: QQ邮箱模式有什么优势？</b></summary>

A:
- ✅ 验证码自动显示在插件中
- ✅ 无需手动查看邮箱
- ✅ 更加自动化
- ⚠️ 但需要配置后端服务
</details>

<details>
<summary><b>Q: 数据存储在哪里？</b></summary>

A: 所有数据都存储在浏览器的 IndexedDB 中，完全本地，不会上传到任何服务器。
</details>

<details>
<summary><b>Q: 安全吗？</b></summary>

A: 
- ✅ 完全开源，代码透明
- ✅ 无硬编码密钥
- ✅ 数据本地存储
- ✅ 配置文件不会被提交到 Git
</details>

---

## 🛠️ 开发指南

### 修改代码后重新加载

```
1. 访问 edge://extensions/
2. 找到"Windsurf 注册助手"
3. 点击 🔄 重新加载图标
```

### 查看调试日志

```
1. 右键点击插件图标
2. 选择"检查"
3. 打开 Console 标签页
```

### 修改建议

如果您想改进此项目，欢迎：
- 🐛 提交 Bug 报告
- 💡 提出新功能建议
- 🔧 发送 Pull Request

---

## 🤝 贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📜 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

```
MIT License

Copyright (c) 2025 bjfwan

允许免费使用、复制、修改、合并、发布、分发本软件
```

---

## ⚠️ 免责声明

- 本工具仅供学习和研究使用
- 请遵守相关服务的使用条款
- 使用本工具产生的任何后果由使用者自行承担
- 作者不对使用本工具造成的任何损失负责

---

## 📞 联系方式

- 📧 Email: 2632507193@qq.com
- 🐙 GitHub: [@bjfwan](https://github.com/bjfwan)
- 🔗 项目地址: [windsurf-helper-opensource](https://github.com/bjfwan/windsurf-helper-opensource)
- 🐛 问题反馈: [Issues](https://github.com/bjfwan/windsurf-helper-opensource/issues)

---

## ☕ 赞助支持

如果这个项目对您有帮助，欢迎请作者喝杯咖啡 ☕

您的支持是我持续维护和改进项目的动力！每一份打赏都会被用于：
- 🔧 项目维护和更新
- 📚 文档完善  
- 🐛 Bug修复
- ✨ 新功能开发
- 💡 新特性开发和研究

### 💰 打赏方式

<table>
  <tr>
    <td align="center">
      <img src="./docs/sponsor/weixin.jpg" width="200" alt="微信打赏码"><br>
      <b>微信打赏</b>
    </td>
    <td align="center">
      <img src="./docs/sponsor/zhifubao.jpg" width="200" alt="支付宝打赏码"><br>
      <b>支付宝打赏</b>
    </td>
  </tr>
</table>

### 🎁 打赏福利

感谢每一位支持者！为了表达感谢：

- 💝 **所有打赏者**：将获得作者的真诚感谢和优先技术支持
- 🌟 **累计打赏 ¥50+**：可提出一个功能建议，优先排期开发
- 👑 **累计打赏 ¥100+**：可获得一对一配置指导服务
- 🏆 **累计打赏 ¥200+**：可获得定制化功能开发支持

> 💡 打赏后请添加作者微信（见下方联系方式），备注"打赏+GitHub用户名"，以便提供对应服务

### 📊 赞助使用透明化

| 用途 | 占比 | 说明 |
|------|------|------|
| 🖥️ 服务器费用 | 30% | 域名、API服务等运营成本 |
| 📚 学习提升 | 30% | 购买技术书籍、课程等 |
| ⏰ 开发时间 | 30% | 补贴开发维护时间成本 |
| ☕ 生活支持 | 10% | 咖啡、能量饮料等 |

### 🙏 特别鸣谢

感谢以下赞助者对本项目的支持（按时间顺序）：

> 暂无赞助记录，期待您成为第一位支持者！

---

### 💬 其他支持方式

除了资金支持，您还可以通过以下方式帮助项目：

- ⭐ **Star 本项目** - 让更多人发现这个工具
- 🐛 **提交 Bug 报告** - 帮助改进项目质量
- 💡 **提出功能建议** - 让项目更加完善
- 📖 **改进文档** - 帮助其他用户更好地使用
- 🔧 **贡献代码** - 直接参与项目开发
- 📣 **分享推广** - 在社交媒体上分享本项目

---

<p align="center">
  ⭐ 如果这个项目对您有帮助，请给它一个 Star！
</p>

<p align="center">
  Made with ❤️ by <a href="https://github.com/bjfwan">bjfwan</a>
</p>
