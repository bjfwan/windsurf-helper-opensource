# Windsurf 自动注册助手 - 开源版

自动化 Windsurf 账号注册的浏览器插件，支持两种邮箱模式。

## 邮箱模式

### 模式1：临时邮箱（推荐新手）
- ✅ 无需配置
- ✅ 无需后端服务器
- ✅ 开箱即用
- ⚠️ 需要手动查看临时邮箱网站

### 模式2：QQ邮箱 + 后端
- ✅ 全自动获取验证码
- ✅ 无需手动操作
- ⚠️ 需要域名
- ⚠️ 需要部署后端服务
- ⚠️ 需要配置Cloudflare Email Routing

---

## 快速开始（临时邮箱模式）

### 1. 配置插件

```bash
# 复制配置文件
cp extension/email-config.example.js extension/email-config.js
```

打开 `extension/email-config.js`，确保设置为：
```javascript
const EMAIL_MODE = 'temp-mail';  // 临时邮箱模式
```

### 2. 安装插件

1. 打开 Edge 浏览器
2. 访问 `edge://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `extension` 文件夹

### 3. 使用

1. 访问 https://windsurf.com/account/register
2. 点击插件图标
3. 点击"开始注册"
4. 插件会显示生成的邮箱地址
5. **手动打开** https://temp-mail.org 查看验证码
6. 复制验证码粘贴到网页

---

## 高级配置（QQ邮箱模式）

### 前置要求

1. 一个域名
2. Cloudflare 账号（免费）
3. QQ 邮箱
4. Vercel 账号（免费）

### 步骤

#### 1. 配置 Cloudflare Email Routing

```
1. 登录 Cloudflare
2. 添加您的域名
3. 进入 Email → Email Routing
4. 添加转发规则：*@yourdomain.com → 您的QQ邮箱
```

#### 2. 获取 QQ 邮箱授权码

```
1. 登录 QQ 邮箱
2. 设置 → 账户
3. 开启 IMAP/SMTP 服务
4. 生成授权码
5. 保存授权码
```

#### 3. 部署后端服务

参考原项目的后端部署说明，部署到 Vercel。

#### 4. 配置插件

打开 `extension/email-config.js`：

```javascript
const EMAIL_MODE = 'qq-imap';  // QQ邮箱模式

const QQ_IMAP_CONFIG = {
  domain: 'yourdomain.com',           // 您的域名
  emailPrefix: 'windsurf',             // 邮箱前缀
  apiBaseUrl: 'https://your-api.vercel.app',  // 后端API地址
  apiKey: '',                          // API密钥（如果设置了）
  pollInterval: 5000,
  timeout: 120000
};
```

#### 5. 使用

与临时邮箱模式相同，但验证码会自动显示，无需手动查看。

---

## 配置文件说明

### email-config.js

```javascript
// 选择模式
const EMAIL_MODE = 'temp-mail';  // 或 'qq-imap'

// 临时邮箱配置
const TEMP_MAIL_CONFIG = {
  provider: 'temp-mail-org',  // 或 'guerrilla-mail'
  pollInterval: 5000,         // 轮询间隔（毫秒）
  maxAttempts: 60            // 最大尝试次数
};

// QQ邮箱配置
const QQ_IMAP_CONFIG = {
  domain: 'example.com',
  emailPrefix: 'windsurf',
  apiBaseUrl: 'https://your-api.vercel.app',
  apiKey: '',
  pollInterval: 5000,
  timeout: 120000
};
```

---

## 文件结构

```
windsurf_helper_opensource/
├── extension/
│   ├── manifest.json              # 插件清单
│   ├── email-config.example.js   # 配置模板
│   ├── email-config.js            # 用户配置（需自己创建）
│   ├── popup/                     # 主界面
│   ├── content/                   # 页面脚本
│   ├── background/                # 后台服务
│   └── utils/
│       ├── temp-mail-client.js   # 临时邮箱客户端
│       ├── api-client.js         # 后端API客户端（QQ邮箱模式）
│       └── ...
└── README.md
```

---

## 常见问题

### 临时邮箱模式

**Q: 在哪里查看验证码？**  
A: 访问 https://temp-mail.org，插件生成的邮箱地址会显示在界面上。

**Q: 收不到验证码？**  
A: 
1. 检查临时邮箱服务是否正常
2. 尝试更换临时邮箱服务商（在配置中修改 provider）
3. 重新生成邮箱

### QQ邮箱模式

**Q: 验证码一直不显示？**  
A:
1. 检查后端服务是否正常运行
2. 检查 Cloudflare Email Routing 是否配置正确
3. 检查 QQ 邮箱授权码是否正确

**Q: API密钥是必须的吗？**  
A: 不是必须的。如果后端没有设置 API_SECRET_KEY，apiKey 可以留空。

---

## 开发

### 修改代码后重新加载

1. 在 `edge://extensions/` 页面
2. 找到插件
3. 点击"重新加载"图标

### 查看日志

1. 右键点击插件图标
2. 选择"检查"
3. 查看 Console 输出

---

## 许可证

MIT License

---

## 免责声明

本工具仅供学习和测试使用。
