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

## 许可证

MIT License

## 免责声明

本工具仅供学习和测试使用。
