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

> 📖 **详细部署教程**：[查看完整后端部署指南](./docs/BACKEND_DEPLOY.md)

简要步骤：

1. **创建 Supabase 数据库**
   - 注册 Supabase 账号
   - 创建新项目
   - 执行 SQL 创建数据表
   - 获取 API 密钥

2. **部署到 Vercel**
   - 准备 API 代码文件
   - 使用 Vercel CLI 或 GitHub 集成部署
   - 配置环境变量（Supabase 密钥、邮箱配置等）
   - 获取部署域名

3. **配置完成**
   - 将 API 地址填入插件配置
   - 测试接口是否正常

👉 **[点击查看详细图文教程](./docs/BACKEND_DEPLOY.md)** - 包含每一步的详细说明和常见问题解决方案

#### 4️⃣ 配置插件

编辑 `extension/email-config.js`：

```javascript
const EMAIL_MODE = 'qq-imap';  // QQ邮箱模式

const QQ_IMAP_CONFIG = {
  domain: 'yourdomain.com',
  emailPrefix: 'windsurf',
  apiBaseUrl: 'https://your-api.vercel.app',
  apiKey: '',  // 可选
  pollInterval: 5000,
  timeout: 120000
};
```

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

👉 **[查看赞助方式](./docs/SPONSOR.md)**

您的支持是我持续维护和改进项目的动力！每一份打赏都会被用于：
- 🔧 项目维护和更新
- 📚 文档完善  
- 🐛 Bug修复
- ✨ 新功能开发

---

<p align="center">
  ⭐ 如果这个项目对您有帮助，请给它一个 Star！
</p>

<p align="center">
  Made with ❤️ by <a href="https://github.com/bjfwan">bjfwan</a>
</p>
