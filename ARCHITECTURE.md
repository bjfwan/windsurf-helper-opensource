# 架构概览

本文档描述 `windsurf-helper-opensource` 的整体架构、模块划分与运行时数据流。仅介绍开源插件部分（`extension/`），不涉及 backend serverless API 的内部实现。

---

## 目录结构

```
.editorconfig                  # 缩进 / EOL / 字符集一致性
extension/
├── manifest.json              # MV3 清单
├── config.js                  # API 端点 / 公共配置（不含密钥）
├── email-config.js            # 邮箱模式配置（temp-mail | api）
├── background/
│   └── service-worker.js      # 后台服务工作线程：管理状态、跨 tab 协调
├── content/
│   └── content-script.js      # 注入 windsurf.com，负责表单填充
├── popup/
│   ├── index.html             # 主弹窗
│   ├── popup.js               # 主流程逻辑
│   ├── accounts.html / .js    # 账号管理
│   ├── stats.html / .js       # 统计页
│   ├── styles-modern.css      # 全局主题（CSS 变量 + :focus-visible / prefers-reduced-motion）
│   ├── stats.css              # stats 页专用样式（从 HTML 抽离）
│   └── accounts.css           # 账号页 + 调试面板样式
└── utils/
    ├── logger.js              # 分级日志器（必须最先加载）
    ├── ui-toast.js            # Toast / Modal / 确认框组件
    ├── api-client.js          # 与本地/云端后端通信
    ├── state-machine.js       # 注册流程状态机（含 VERIFYING_RESULT 中间态）
    ├── state-sync.js          # 跨上下文状态同步（按需心跳）
    ├── temp-mail-client.js    # 临时邮箱 API 客户端
    ├── db-manager.js          # IndexedDB 封装
    ├── analytics.js           # 注册成功率统计
    ├── email-generator.js     # 邮箱 / 用户名 / 密码生成
    ├── email-provider.js      # 邮箱来源（temp-mail / qq-imap）抽象
    ├── smart-validator.js     # 启动前环境检查
    ├── registration-verifier.js  # 注册结果独立核验（backend / mailbox / local）
    ├── upstream-probe.js      # 上游变更探测（关键链路 smoke check）
    └── super-brain.js         # 智能诊断面板（消费 UpstreamProbe 报告）

extension/protocol-contract.js
                               # 协议契约：客户端身份 / endpoints / headers /
                               # 上游选择器与关键链路 / 邮箱 provider 字典 /
                               # 注册结果核验策略
```

---

## 运行时数据流

### 注册流程（temp-mail 模式）
```
popup.startRegistration
  → tempMailClient.generateEmail   生成临时邮箱地址 + token
  → currentAccount = {email, password, username, session_id, tempMailToken}
  → dbManager.saveAccount          IndexedDB 持久化
  → stateMachine.transition(FILLING_FORM)
  → chrome.tabs.sendMessage(activeTab, fillForm, account)
       ↓
  content-script.fillRegistrationForm  填充输入框
  content-script.waitForCloudflareAndSubmit  等 Cloudflare 后提交
       ↓
  popup.startTempMailMonitoring(email)
  → tempMailClient.waitForVerificationCode  内部 5s 轮询，60 次
  → handleVerificationCodeReceived(code)    统一成功路径
       ↓
  stateMachine.transition(COMPLETED)
  dbManager.saveAccount({status:'verified', verification_code})
```

### 注册流程（API 模式）
```
popup.startRegistration
  → chrome.runtime.sendMessage(startRegistration → background)
  → background.service-worker 生成账号 → 返回 popup
  → currentAccount = {email, password, username, session_id}
  → fill form (与 temp-mail 相同)
  → popup.startRealtimeMonitoring(email)
  → triggerBackendMonitor(email, sessionId)        通知后端拉取
  → setInterval(apiClient.checkCode, 5s)            每 5s 调用 /api/check-code
  → handleVerificationCodeReceived(code)            统一成功路径（云端同步）
```

---

## 关键设计决策

### 1. 日志分级（`logger.js`）
- 默认 `LOG_LEVEL='info'`，保持向后兼容
- 用户可在浏览器 devtools 执行 `Logger.setLevel('warn')` 减少噪音
- 也可 `Logger.saveLevelToStorage('warn')` 持久化到 `chrome.storage.local.__log_level`
- `logger.scope('Module')` 创建带前缀子 logger

**已迁移到 logger 的高频路径（默认 info 级别下不发出）：**

| 文件 | 调用频率 | 迁移策略 |
|---|---|---|
| `temp-mail-client.js` | 1 次/5s×60 | 轮询/邮件检查 → `debug`；命中/生成成功 → `info`；错误 → `error` |
| `db-manager.js` | 每次 popup 打开 | 初始化 → `debug`；创建 schema/货仓 → `info`；失败 → `error` |
| `state-machine.js` | 每次状态转换 | 转换/保存/加载 → `debug`；重置 → `info`；非法转换 → `error` |
| `analytics.js` | 每个注册步骤 | 步骤开始/结束 → `debug`；会话结束/重置 → `info` |
| `state-sync.js` | 5s 心跳 | 一致性检查/同步 → `debug`；错误 → `error` |

其余低频路径（`service-worker.js` 启动、`super-brain.js` 诊断、`smart-validator.js` 一次性检查）保留 `console.*`。
`content-script.js` 不加载 logger（未在 manifest 的 `content_scripts` 中声明），仍用 `console.*`。

### 2. 状态机 + 跨上下文同步
- `state-machine.js` 单例驱动 popup UI
- `state-sync.js` 把状态广播到所有上下文（popup, content-script, service-worker）
- 心跳每 5s 检查一致性；**空闲 30s 自动停止心跳**节约资源
- 写入新状态时如果心跳已停，会自动重启

### 3. 验证码监听统一处理
- `handleVerificationCodeReceived(code, opts)` — 公共成功路径（统计、状态机、DB、云端同步）
- `handleVerificationTimeout(retryFn, msg)` — 公共超时路径（决定重试 vs ERROR）
- 两个流程（temp-mail / API）共用助手，避免行为分歧

### 3.1 注册结果核验器（registration-verifier.js）
- 决策理由：**不仅仅靠"页面状态 + 验证码字符串"判定成功**，还要在
  独立来源（后端 `/api/accounts` / 临时邮箱原始邮件）二次确认。
- 三个来源：
  - `backend`  —— `apiClient.listAccounts({ email })`，对状态 + 验证码三向校验
  - `mailbox`  —— `tempMailClient.confirmVerificationCode(expectedCode)`，按 from + 验证码二次匹配
  - `local`    —— IndexedDB（仅用于降级证据）
- 输出：`{ confirmed, degraded, source, code, attempts, backendAccount, mailboxResult, localAccount, reason }`
  - `confirmed && !degraded`：强确认（独立来源命中）
  - `confirmed &&  degraded`：降级确认（独立来源全部 skipped，本地数据自洽）
  - `!confirmed`             ：核验失败 → 状态机进入 ERROR
- 策略集中在 `WindsurfProtocol.verification`（retries / retryDelay / strongSources / allowDegraded）。

### 3.2 上游变更探测器（upstream-probe.js）
- 决策理由：**只跟踪能让流程完全断的少数关键链路**，不做全量接口/选择器接入。
- 关键链路清单写在 `WindsurfProtocol.upstream.smokePaths`：
  - `register-url`     — 注册页 URL 仍可识别
  - `step1-inputs`     — Step1 至少 3 个输入框
  - `step2-passwords`  — Step2 至少 2 个密码框
  - `continue-button`  — 继续/提交按钮存在
- 同时调用 `apiClient.smokeCheck()` 跑后端关键接口（health / accounts / start-monitor / check-code）
- 报告一次性返回 `{ ok, summary, upstream, backend, paths }`，被 super-brain 直接消费

### 4. UI 安全
- `accounts.js` 中 `escapeHtml` / `escapeAttr` 用于所有从存储读取的字段拼接到 HTML
- `popup.js displayVerificationCode` 用 DOM API 而非 `innerHTML` 拼接
- `ui.alert` / `ui.confirm` 始终通过 `textContent` 渲染消息

### 5. 资源清理
- `popup` 在 `pagehide` 时主动 `stateSyncManager.destroy()`、清理倒计时与轮询
- `content-script` 在 `beforeunload` 与 `visibilitychange` 时调用 `cleanupTimers()`
- `state-sync.js` 心跳防御性 `stopHeartbeat()` 重置，避免重复启动

---

## 脚本加载顺序（关键约束）

每个 HTML 入口必须按以下顺序加载：
1. `utils/logger.js` — 提供 `logger` 全局
2. `utils/ui-toast.js` — 提供 `ui` 全局
3. `protocol-contract.js` — 提供 `WindsurfProtocol` 全局（必须早于配置文件）
4. 配置文件（`email-config.js`, `config.js`）— 内部会读 `WindsurfProtocol.client`
5. 工具库（utils/*）— `email-provider.js` / `api-client.js` / `registration-verifier.js` / `upstream-probe.js` / `super-brain.js`
6. 业务脚本（popup.js / accounts.js / stats.js）

`service-worker.js` 通过 `importScripts` 加载相同顺序。
`content-script.js` 通过 manifest `content_scripts.js` 数组顺序加载（顺序为 `protocol-contract.js` → `utils/logger.js` → `content/content-script.js`）。

---

## 开发约定

- 缩进 2 空格（见 `.editorconfig`）
- 函数级注释以"决策理由："开头说明设计权衡
- 高频调用路径（轮询/心跳/状态转换）使用 `logger.debug`；里程碑用 `logger.info`；错误用 `logger.error`
- 低频一次性初始化日志可保留 `console.log`，避免过度迁移
- 用户面板提示用 `ui.toast` / `ui.alert` / `ui.confirm`，禁止 `alert/confirm/window.prompt`
- 任何从 `chrome.storage` 或 `IndexedDB` 读取后插入 HTML 的字段都必须用 `escapeHtml` / `escapeAttr`
- 优先用 DOM API（`createElement`/`appendChild`/`textContent`）而非 `innerHTML` 拼接
- 新增定时器（`setInterval`/`setTimeout`）需在 `pagehide`/`beforeunload`/`destroy()` 中明确清理

---

## 已知限制

- `popup` 是非持久页面，关闭即销毁。轮询验证码必须在打开 popup 时进行
- service-worker 在 MV3 下会被休眠，长时间任务需要保存状态到 storage
- temp-mail API 受第三方服务可用性影响，需要配置正确的 `EMAIL_CONFIG.tempMail`
- `content-script.js` 运行在隔离世界，不能访问页面上下文的 logger；如需为其启用，需在 `manifest.json` 的 `content_scripts.js` 中补上 `utils/logger.js`

---

## 静态验证工作流

修改后运行以下检查可在不加载到浏览器的情况下捕获大部分回归：

```powershell
# 1) JS 语法检查（需 Node）
$jsFiles = Get-ChildItem extension/utils/*.js, extension/popup/*.js, `
  extension/background/*.js, extension/content/*.js
foreach ($f in $jsFiles) { node -c $f.FullName }

# 2) HTML 中 script/link 引用是否存在
foreach ($html in Get-ChildItem extension/popup/*.html) {
  $c = Get-Content $html.FullName -Raw
  $dir = Split-Path $html.FullName
  [regex]::Matches($c, '(?:src|href)="([^"]+)"') | ForEach-Object {
    $abs = [System.IO.Path]::GetFullPath((Join-Path $dir $_.Groups[1].Value))
    if (-not (Test-Path $abs)) { Write-Host "MISSING: $($html.Name) -> $($_.Groups[1].Value)" }
  }
}

# 3) manifest.json 合法性
Get-Content extension/manifest.json -Raw | ConvertFrom-Json | Out-Null

# 4) logger 加载顺序：使用 logger.* 的文件必须在 logger.js 之后被加载
# 5) CSS 变量一致性：used vars 都需在 styles-modern.css 中定义
```

详细脚本参见 `CHANGELOG.md` 的静态 lint 部分。

---

## 变更历史

详见 [`CHANGELOG.md`](./CHANGELOG.md)。
