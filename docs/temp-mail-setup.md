# 🌍 临时邮箱配置指南

## ⚠️ 重要说明

**本项目不提供预配置的临时邮箱服务**，原因：
1. 不同网站可能屏蔽不同的临时邮箱域名
2. Windsurf可能不接受内置的临时邮箱服务
3. 您需要自己测试并集成可用的临时邮箱

---

## 📋 如何找到可用的临时邮箱服务

### 1. 搜索临时邮箱服务
- Google: "temporary email API"
- 常见服务：Mohmal、TempMail+、10MinuteMail、Guerrilla Mail等

### 2. 测试是否被Windsurf接受
1. 手动在Windsurf注册页面输入该临时邮箱地址
2. 查看是否能收到验证码邮件
3. 确认后再集成到插件

### 3. 集成到插件
参考下方的集成教程

---

## 🛠️ 集成新的临时邮箱服务

### 步骤1：找到API文档

访问临时邮箱服务的官网，查找API文档。通常需要这两个接口：
- **生成邮箱接口**：获取一个新的临时邮箱地址
- **检查邮件接口**：轮询查询收到的邮件

### 步骤2：修改 `temp-mail-client.js`

打开 `extension/utils/temp-mail-client.js`，参考现有的 `generate1SecMail()` 和 `check1SecMail()` 方法：

```javascript
/**
 * 添加您的临时邮箱服务
 */
async generateYourService() {
  // 调用API生成邮箱
  const response = await fetch('https://your-service.com/api/generate');
  const data = await response.json();
  
  // 保存邮箱地址和token（用于后续查询）
  this.currentEmail = data.email;
  this.currentToken = data.token;  // 有些服务需要token来查询
  
  return {
    email: this.currentEmail,
    token: this.currentToken
  };
}

async checkYourService() {
  // 调用API检查邮件
  const response = await fetch(
    `https://your-service.com/api/inbox?email=${this.currentEmail}&token=${this.currentToken}`
  );
  const data = await response.json();
  
  // 返回邮件列表（需要统一格式）
  return Array.isArray(data) ? data : [];
}
```

### 步骤3：注册新服务商

在 `generateEmail()` 和 `checkMails()` 方法中添加你的服务：

```javascript
async generateEmail() {
  switch (this.provider) {
    case '1secmail':
      return await this.generate1SecMail();
    case 'your-service':  // 👈 添加这里
      return await this.generateYourService();
    default:
      throw new Error(`不支持的服务商: ${this.provider}`);
  }
}

async checkMails() {
  switch (this.provider) {
    case '1secmail':
      return await this.check1SecMail();
    case 'your-service':  // 👈 添加这里
      return await this.checkYourService();
    default:
      return [];
  }
}
```

### 步骤4：添加manifest权限

在 `extension/manifest.json` 中添加API域名权限：

```json
"host_permissions": [
  "https://www.1secmail.com/*",
  "https://api.guerrillamail.com/*",
  "https://your-service.com/*"
]
```

### 步骤5：更新配置文件

在 `extension/email-config.js` 中切换到新服务：

```javascript
const TEMP_MAIL_CONFIG = {
  provider: 'your-service',  // 👈 改为您的服务
  pollInterval: 5000,
  maxAttempts: 60
};
```

### 步骤6：测试

1. 重新加载插件：`edge://extensions/` → 刷新插件
2. 访问注册页面测试
3. 观察调试面板的日志输出

---

## 📚 完整示例

参考代码中的 `1SecMail` 实现：
- `generate1SecMail()` - 如何生成邮箱
- `check1SecMail()` - 如何检查邮件  
- `get1SecMailContent()` - 如何获取邮件内容
- `waitForVerificationCode()` - 如何提取验证码

---

## ⚠️ 注意事项

### 内置示例服务商（仅供参考）

内置的服务商（1SecMail、Guerrilla Mail）仅作为代码示例，**不保证能在Windsurf使用**。

经测试发现：
- ❌ Guerrilla Mail：Windsurf不发送邮件到此域名
- ❌ 1SecMail：国内访问可能被屏蔽

**您需要自己找到并集成Windsurf接受的临时邮箱服务。**
