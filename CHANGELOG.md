# 变更日志

本文档记录 `windsurf-helper-opensource` 的重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [Unreleased] — 协议层 / 核验器 / 上游探测 加固

本轮聚焦 4 件事：(1) 不再仅靠"页面状态 + 验证码字符串"判定成功；(2) 把上游变更探测收口为
小而专的关键链路 smoke check；(3) 协议常量集中到一份契约；(4) 清理命名/死代码债务。

### ✨ 新增（Added）

- **`extension/utils/upstream-probe.js`**：独立的上游变更探测器，只跟踪
  `WindsurfProtocol.upstream.smokePaths` 列出的关键链路（注册页 URL / Step1 输入框 /
  Step2 密码框 / 继续按钮），同时跑后端 `apiClient.smokeCheck()`，一次性返回
  `{ ok, summary, upstream, backend, paths }`。**刻意不做**全量接口/选择器接入。
- **协议契约扩充**：`extension/protocol-contract.js` 增加
  - `api.methods` / `api.headers` / `api.responseShape` —— HTTP 调用契约集中化
  - `upstream.smokePaths` —— 关键链路清单
  - `verification.{ strongSources, weakSources, retries, retryDelayMs, allowDegraded }`
    —— 注册结果核验策略
  - `normalizeEmailProvider()` —— provider 别名归一化
- **核验器**：`registration-verifier.js` 扩充输出，新增 `attempts` 数组、
  `degraded` 字段、`_isDegradedConfirmable` 决策。在强来源全部 skipped、本地数据自洽时
  返回 **降级确认**，避免把"独立来源不可用"等同于"成功"或"失败"。
- **popup.js**：对核验报告分流处理：
  - `confirmed && !degraded` → 强确认日志 + COMPLETED
  - `confirmed &&  degraded` → 降级警告日志 + COMPLETED（metadata 记录 degraded）
  - `!confirmed`             → 失败日志 + ERROR（metadata 携带核验报告）

### ♻️ 重构（Changed）

- **super-brain.js**：
  - 替换重复的 smoke check 实现，改为消费 `UpstreamProbe.run()`
  - `checkUpstream()` 直接渲染 `WindsurfProtocol.upstream.smokePaths` 中每条路径的命中状态
  - `showConfigInfo()` 改读 `WindsurfProtocol.client` / `.api.endpoints`，不再依赖
    `API_CONFIG.PROTOCOL_VERSION` / `CLIENT_VERSION`
  - 删除 ~95 行 native messaging 死代码（`analyzeError` 引用项目中并不存在的
    `backend/native_host.py` / `register.bat`）
  - `executeSolution` 收敛到本项目实际使用的 action（`reset` / `checkNetwork` /
    `checkConfig` / `checkPermissions` / `openRegisterPage` / `checkDebug` / `contactAdmin`）
- **`config.example.js`**：协议字段 `CLIENT_NAME / CLIENT_VERSION / PROTOCOL_VERSION`
  改为 getter，从 `WindsurfProtocol.client` 转发，避免双源真相。

### 🧹 命名 & 配置债务（Cleaned）

- README、`docs/self-hosted-api.md` 中的 `EMAIL_MODE` 全部统一为 `EMAIL_PROVIDER`，
  与 `email-config.example.js` 对齐。`EMAIL_CONFIG.mode` 仍保留为兼容 getter，
  指向 `provider`，不破坏既有用户配置。
- `email-config.example.js` 顶部追加命名说明：顶层 `provider` 是"邮箱来源"，
  `tempMail.provider` 是来源下的"具体服务"——避免一词两义。

### 📚 文档（Documentation）

- `ARCHITECTURE.md` 增加 `3.1 注册结果核验器` 与 `3.2 上游变更探测器` 两节，
  并补全脚本加载顺序（`protocol-contract.js` 必须早于 `email-config.js` / `config.js`）。

### 📦 文件级摘要（本轮）

| 路径 | 状态 |
|---|---|
| `extension/utils/upstream-probe.js` | 新增 |
| `extension/protocol-contract.js` | 修改（扩充协议常量 + 核验策略 + smoke 路径） |
| `extension/utils/registration-verifier.js` | 重写（degraded 模式 + attempts 报告 + 策略外置） |
| `extension/utils/super-brain.js` | 重构（接入 UpstreamProbe + 删死代码 + 改 protocol 常量） |
| `extension/popup/index.html` | 修改（加载 upstream-probe.js） |
| `extension/popup/popup.js` | 修改（分流处理 verifier 报告） |
| `extension/email-config.example.js` | 修改（命名说明 + 注释） |
| `extension/config.example.js` | 修改（协议字段改 getter） |
| `README.md` / `docs/self-hosted-api.md` | 修改（EMAIL_MODE → EMAIL_PROVIDER） |
| `ARCHITECTURE.md` | 修改（3.1 / 3.2 节 + 脚本顺序） |

---

## [Previous] — 全面优化

涵盖 P0（紧急修复）、P1（核心质量）、UI（体验提升）、P2（开发者文档）共 9 个主题的优化，以及 3 项后续工作（F1-F3）。

### 🛡 安全（Security）

- **修复**：`accounts.js` 中通过 `innerHTML` 拼接账号字段（email/password/username）的 **XSS 风险**。统一使用 `escapeHtml` / `escapeAttr`。
- **修复**：`popup.js` 中 `displayVerificationCode` 用 `innerHTML` 拼接 `${code}`。改用 DOM API（`createElement` + `textContent`），消除潜在 XSS。
- **加固**：删除直连 Supabase 的 `utils/supabase-rest.js`（开源版本应只走 serverless API）。
- **收紧权限**：`manifest.json` 的 `host_permissions` 从 7 个域名缩减到 3 个（`windsurf.com`、`api.guerrillamail.com`、`*.1secmail.com`），最小权限原则。
- **修复**：`accounts.js` 文件中存在 **两处 console 劫持**（debugPanel 与下方旧代码同时 patch `console.log`），导致循环调用与栈溢出风险。统一为单一劫持点。

### 🚀 性能（Performance）

- **新增**：分级日志器 `extension/utils/logger.js`（debug/info/warn/error/silent），默认 `info`，支持 devtools 动态调整与 `chrome.storage.local.__log_level` 持久化。
- **迁移**：高频路径 `console.log` → `logger.debug`，默认级别下不输出：

  | 文件 | 调用频率 | 替换数 |
  |---|---|---|
  | `temp-mail-client.js` | 1 次/5s × 60 | 19 |
  | `db-manager.js` | 每次 popup 打开 | 8 |
  | `state-machine.js` | 每次状态转换 | 7 |
  | `analytics.js` | 每个注册步骤 | 7 |

  注册一次（5 分钟内）控制台输出从 ~600 行降到 ~30 行（**降幅 95%+**）。

- **修复定时器泄漏**：
  - `state-sync.js` 心跳：每次 `startHeartbeat` 前先 `stopHeartbeat`，避免重复启动累计；空闲 30s 自动停止；写入新状态时如未运行则自动重启。
  - `popup.js` 在 `pagehide` 时显式调用 `stateSyncManager.destroy()` + 清理 `monitorCountdownHandle` + 取消轮询 `realtimeChannel`。
  - `content-script.js` 已有 `cleanupTimers` 在 `beforeunload` / `visibilitychange` 调用，验证完整。

- **优化**：`accounts.js` 渲染账号列表时使用 `DocumentFragment`（一次性 reflow），避免逐个 `appendChild` 触发布局抖动。

### ✨ 新增（Added）

- **统一 UI 组件**：`extension/utils/ui-toast.js` 提供 `ui.toast(msg, type)` / `ui.alert(msg, opts)` / `ui.confirm(msg, opts)`，类型 `info/success/warning/error`，支持 `title`、`danger`、`confirmText`、`cancelText`，键盘可访问（Esc 取消、Enter 确认、focus-visible）。
- **架构文档**：`ARCHITECTURE.md` 涵盖目录结构、运行时数据流、关键设计决策、加载顺序约束、开发约定、静态验证工作流。
- **代码风格**：`.editorconfig`（缩进 / EOL / 字符集）。
- **CSS 抽离**：`extension/popup/stats.css` 从 `stats.html` 内联 `<style>` 抽出（HTML 由 340 行降到 75 行）；`accounts.css` 末尾追加调试面板专用类，从 `accounts.html` 内联样式抽离。

### ♻️ 重构（Changed）

- **抽取公共助手**：`popup.js` 新增 `handleVerificationCodeReceived(code, opts)` 与 `handleVerificationTimeout(retryFn, msg)`，消除 `startTempMailMonitoring` 与 `startRealtimeMonitoring` 中 ~70 行重复逻辑（统计、状态机、DB、云端同步、重试 vs ERROR）。
- **替换 `alert/confirm`**：
  - `accounts.js` 9 处（错误提示、删除/清空确认 → `ui.confirm({ danger: true })`）
  - `popup.js` 2 处（复制失败、超脑未初始化）
  - `super-brain.js` 11 处（解决方案提示、重置确认、API 测试）
  - **顶层 `alert/confirm` 残留：0**
- **`showToast` 改为 `ui.toast` 包装器**：根据消息 emoji 前缀（✅/⚠️/❌）自动映射到对应 `type`，保持调用点向后兼容。

### ♿ 无障碍（Accessibility）

- **键盘焦点**：`styles-modern.css` 全局 `:focus-visible` 规则（蓝色 outline + 偏移），仅在键盘聚焦时显示，不打扰鼠标用户。
- **减少动效**：`prefers-reduced-motion: reduce` 媒体查询将所有动画/过渡降到 0.01ms。
- **ARIA 标注**：
  - 状态区 `role="status"` `aria-live="polite"`
  - 状态指示器 `aria-hidden="true"`
  - 进度条 `role="progressbar"` `aria-valuemin/max/now`，并在 `updateProgressBar()` 中同步 `aria-valuenow`
  - 按钮添加 `aria-label`

### 🧹 清理（Removed）

- 删除 `extension/popup/popup.js.backup`（备份文件不应提交）
- 删除 `extension/popup/styles.css`（已被 `styles-modern.css` 取代）
- 删除 `extension/utils/supabase-rest.js`（开源版本不直连数据库）
- 修正 `.gitignore` 中的错误 glob 模式

### 📚 文档（Documentation）

- **修订**：`README.md` 同步项目实际架构，由原"Vercel 自建 API"改为"**本地 Node.js 后端**（推荐）+ Vercel 云端（可选）"双方案：
  - 模式对比表：`📧 自建API模式` → `📧 本地后端模式（QQ 邮箱）`
  - 快速开始：新增"步骤 5 启动本地后端"章节，覆盖 `start-backend.bat` 用法与端点列表
  - 手动配置：`BASE_URL` 默认值由 `https://your-project.vercel.app` → `http://localhost:3000`，新增 `backend/backend-config.js` 配置示例
  - 项目结构补全：`backend/`、`start-backend.bat`、`ARCHITECTURE.md`、`CHANGELOG.md`、`.editorconfig`
  - FAQ 修订：费用说明、验证码获取流程、故障排除均反映本地后端路径
  - 修复"功能特性"小节两处损坏 emoji
- **修订**：`docs/self-hosted-api.md` 顶部新增"两种部署方式"对比表（本地推荐 / Vercel 可选），步骤 5.2 给出 `localhost:3000` 与 Vercel 双选项，步骤 6 区分两种模式的健康检查 URL，FAQ 重写说明选型建议。
- **新增**：`README.md` 开发指南章节补充日志级别控制（`Logger.setLevel`）、静态 lint 命令、贡献检查清单。

---

## 静态 Lint 验证

仓库未引入打包工具，可用以下 PowerShell 脚本快速验证修改：

```powershell
# 项目根目录运行
$ok = $true

# 1) JS 语法
Get-ChildItem extension/utils/*.js, extension/popup/*.js, `
              extension/background/*.js, extension/content/*.js |
  ForEach-Object {
    node -c $_.FullName
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: $($_.Name)" -F Red; $ok = $false }
  }

# 2) HTML script/link 引用解析
Get-ChildItem extension/popup/*.html | ForEach-Object {
  $c = Get-Content $_.FullName -Raw; $dir = Split-Path $_.FullName
  [regex]::Matches($c, '(?:src|href)="([^"]+)"') | ForEach-Object {
    $abs = [System.IO.Path]::GetFullPath((Join-Path $dir $_.Groups[1].Value))
    if (-not (Test-Path $abs)) { Write-Host "MISSING: $abs" -F Red; $script:ok = $false }
  }
}

# 3) manifest.json 合法
Get-Content extension/manifest.json -Raw | ConvertFrom-Json | Out-Null

# 4) service-worker importScripts 路径
$sw = Get-Content extension/background/service-worker.js -Raw
[regex]::Matches($sw, "importScripts\(([^)]+)\)") | ForEach-Object {
  [regex]::Matches($_.Groups[1].Value, "['""]([^'""]+)['""]") | ForEach-Object {
    $abs = [System.IO.Path]::GetFullPath((Join-Path 'extension/background' $_.Groups[1].Value))
    if (-not (Test-Path $abs)) { Write-Host "SW missing: $abs" -F Red; $script:ok = $false }
  }
}

# 5) CSS 变量一致性
$mainCss = Get-Content extension/popup/styles-modern.css -Raw
$defined = [regex]::Matches($mainCss, "--([a-zA-Z0-9-]+)\s*:") | ForEach-Object { $_.Groups[1].Value } | Sort -Unique
$used = New-Object System.Collections.Generic.HashSet[string]
Get-ChildItem extension/popup/*.css | ForEach-Object {
  [regex]::Matches((Get-Content $_.FullName -Raw), "var\(--([a-zA-Z0-9-]+)") |
    ForEach-Object { [void]$used.Add($_.Groups[1].Value) }
}
$undefined = $used | Where-Object { $_ -notin $defined }
if ($undefined) { Write-Host "Undefined CSS vars: $($undefined -join ',')" -F Red; $ok = $false }

if ($ok) { Write-Host "ALL CHECKS PASS" -F Green } else { Write-Host "FAILED" -F Red }
```

---

## 当前指标

| 指标 | 起始 | 当前 |
|---|---|---|
| HTML 文件 | 3 | 3 |
| CSS 文件 | 2（含已删除的 styles.css）| 5（拆分 + 新增 ui-toast 内联） |
| JS 文件 | 18 | 17（删 supabase-rest，加 logger + ui-toast） |
| 顶层 `alert/confirm` | 21 | **0** |
| `console.*` 调用 | 178+ | 137（高频路径已迁） |
| `logger.*` 调用 | 0 | 100 |
| `host_permissions` 域名 | 7 | 3 |
| `stats.html` 行数 | 340 | 75 |
| 默认级别下控制台噪音（5 分钟注册）| ~600 行 | ~30 行 |

---

## 文件级摘要

| 路径 | 状态 |
|---|---|
| `ARCHITECTURE.md` | 新增 |
| `CHANGELOG.md` | 新增 |
| `.editorconfig` | 新增 |
| `extension/utils/logger.js` | 新增 |
| `extension/utils/ui-toast.js` | 新增 |
| `extension/popup/stats.css` | 新增（从 HTML 抽离） |
| `extension/popup/popup.js.backup` | 删除 |
| `extension/popup/styles.css` | 删除 |
| `extension/utils/supabase-rest.js` | 删除 |
| `extension/manifest.json` | 修改（收紧权限） |
| `extension/popup/*.html` | 修改（脚本引用、ARIA、抽样式） |
| `extension/popup/popup.js` | 重构（公共助手、UI 组件、清理钩子、XSS 修复） |
| `extension/popup/accounts.js` | 重构（XSS 防护、UI 组件、单点 console 劫持、DocumentFragment） |
| `extension/popup/styles-modern.css` | 修改（焦点 / 减动效） |
| `extension/popup/accounts.css` | 修改（追加调试面板样式） |
| `extension/utils/state-sync.js` | 修改（按需心跳、destroy） |
| `extension/utils/state-machine.js` | 修改（logger 迁移） |
| `extension/utils/db-manager.js` | 修改（logger 迁移） |
| `extension/utils/temp-mail-client.js` | 修改（logger 迁移） |
| `extension/utils/analytics.js` | 修改（logger 迁移） |
| `extension/utils/super-brain.js` | 修改（ui.alert/confirm 替换） |
| `extension/background/service-worker.js` | 修改（importScripts logger） |
