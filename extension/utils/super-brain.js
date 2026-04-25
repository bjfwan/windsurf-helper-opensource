class SuperBrain {
  constructor(apiClient, stateMachine, smartValidator) {
    this.apiClient = apiClient;
    this.stateMachine = stateMachine;
    this.validator = smartValidator;

    this.health = {
      frontend: { status: 'unknown', details: {} },
      backend: { status: 'unknown', details: {} },
      upstream: { status: 'unknown', details: {} },
      overall: { status: 'unknown', score: 0 }
    };

    this.lastProbeReport = null;
    this.recommendations = [];
    this.panel = null;

    // 决策理由：复用统一的 UpstreamProbe，避免本类与 content-script 各自维护一份探测逻辑
    this.upstreamProbe = (typeof UpstreamProbe !== 'undefined')
      ? new UpstreamProbe({
          apiClient: this.apiClient,
          getActiveTab: () => this.getActiveTab(),
          sendTabMessage: (tabId, message) => this.sendTabMessage(tabId, message)
        })
      : null;
  }

  get upstream() {
    return typeof WindsurfProtocol !== 'undefined' && WindsurfProtocol.upstream
      ? WindsurfProtocol.upstream
      : {
          registerUrl: 'https://windsurf.com/account/register',
          selectors: {
            step1Inputs: 'input[type="text"], input[type="email"]',
            emailInputs: 'input[type="email"]',
            passwordInputs: 'input[type="password"]'
          }
        };
  }

  get protocolClient() {
    return (typeof WindsurfProtocol !== 'undefined' && WindsurfProtocol.client)
      ? WindsurfProtocol.client
      : { name: 'windsurf-helper-opensource', version: '4.0.0', protocolVersion: '1' };
  }

  get protocolEndpoints() {
    return (typeof WindsurfProtocol !== 'undefined' && WindsurfProtocol.api?.endpoints)
      ? WindsurfProtocol.api.endpoints
      : { health: '/api/health', startMonitor: '/api/start-monitor', checkCode: '/api/check-code', accounts: '/api/accounts' };
  }

  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  async sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  async runRegistrationSmokeCheck() {
    if (this.upstreamProbe) {
      const report = await this.upstreamProbe.run();
      this.lastProbeReport = report;
      const upstream = report.upstream || {};
      return {
        success: !!(upstream.data && upstream.data.success),
        status: upstream.status || 'unknown',
        data: upstream.data || null,
        reason: upstream.reason,
        report
      };
    }

    // 兜底（理论上 upstreamProbe 一定有，保留兜底是为了在 import 顺序异常时不直接崩）
    const tab = await this.getActiveTab();
    if (!tab?.id || !tab.url) {
      return { success: false, status: 'unknown', reason: '未找到当前标签页' };
    }
    if (!this.upstream.isRegistrationUrl?.(tab.url)) {
      return { success: false, status: 'unknown', reason: '当前标签页不是注册页', url: tab.url };
    }
    try {
      const response = await this.sendTabMessage(tab.id, { action: 'smokeCheck' });
      return {
        success: !!response?.data?.success,
        status: response?.data?.success ? 'healthy' : 'warning',
        data: response?.data || null
      };
    } catch (error) {
      return { success: false, status: 'error', reason: error.message };
    }
  }

  async fullHealthCheck() {
    console.log('[SuperBrain] 开始全面健康检查...');
    console.log('[SuperBrain] [1/3] 检测前端组件...');
    console.log('[SuperBrain] [2/3] 检测后端API...');
    console.log('[SuperBrain] [3/3] 检测关键链路...');
    
    const checks = await Promise.allSettled([
      this.checkFrontend(),
      this.checkBackend(),
      this.checkUpstream()
    ]);
    
    this.health.frontend = checks[0].status === 'fulfilled' ? checks[0].value : { status: 'error', error: checks[0].reason };
    this.health.backend = checks[1].status === 'fulfilled' ? checks[1].value : { status: 'error', error: checks[1].reason };
    this.health.upstream = checks[2].status === 'fulfilled' ? checks[2].value : { status: 'error', error: checks[2].reason };
    
    console.log('[SuperBrain] 前端:', this.health.frontend.status);
    console.log('[SuperBrain] 后端API:', this.health.backend.status);
    console.log('[SuperBrain] 关键链路:', this.health.upstream.status);
    
    this.calculateOverallHealth();
    this.generateRecommendations();
    console.log('[SuperBrain] 健康检查完成 - 分数:', this.health.overall.score);
    
    return this.health;
  }
  
  /**
   * 检查前端状态
   */
  async checkFrontend() {
    const result = { status: 'healthy', details: {} };
    
    try {
      // 检查1：状态机状态
      const stateValid = this.stateMachine && this.stateMachine.currentState;
      result.details.stateMachine = stateValid ? '✅ 正常' : '❌ 未初始化';
      
      // 检查2：本地存储
      const storage = await chrome.storage.local.get(null);
      result.details.storage = storage ? `✅ ${Object.keys(storage).length} 条记录` : '❌ 无法访问';
      
      // 检查3：扩展权限
      const permissions = await chrome.permissions.getAll();
      result.details.permissions = permissions ? '✅ 权限正常' : '❌ 权限缺失';
      
      result.details.apiClient = this.apiClient ? '✅ 已初始化' : '❌ 未初始化';
      
      result.status = 'healthy';
    } catch (error) {
      result.status = 'error';
      result.error = error.message;
    }
    
    return result;
  }
  
  /**
   * 检查后端API状态
   */
  async checkBackend() {
    const result = { status: 'unknown', details: {} };
    
    try {
      const data = await this.apiClient.health();
      result.details.apiStatus = data?.success ? `✅ ${data.status}` : '⚠️ 响应异常';
      result.details.sessions = data?.session_count !== undefined ? `会话 ${data.session_count}` : '';
      result.details.accounts = data?.account_count !== undefined ? `账号 ${data.account_count}` : '';
      result.status = data?.success ? 'healthy' : 'warning';
    } catch (error) {
      result.details.apiStatus = '❌ 无法连接';
      result.details.error = error.message;
      result.details.url = API_CONFIG.BASE_URL;
      result.status = 'error';
    }

    return result;
  }
  
  /**
   * 检查关键链路
   * 决策理由：直接消费 UpstreamProbe 输出的 paths 列表，让"哪条路径出问题"
   * 与协议契约（WindsurfProtocol.upstream.smokePaths）严格对应。
   */
  async checkUpstream() {
    const result = { status: 'unknown', details: {} };

    try {
      const smoke = await this.runRegistrationSmokeCheck();
      result.status = smoke.status || 'unknown';

      if (smoke.status === 'unknown') {
        result.details.page = `ℹ️ ${smoke.reason || '探测被跳过'}`;
        if (smoke.report?.upstream?.url) {
          result.details.url = smoke.report.upstream.url;
        }
        return result;
      }

      const paths = smoke.report?.paths || [];
      if (paths.length > 0) {
        for (const path of paths) {
          const icon = path.ok === true ? '✅' : path.ok === false ? '❌' : 'ℹ️';
          result.details[path.id] = `${icon} ${path.desc}：${path.reason}`;
        }
      } else if (smoke.data) {
        // 兼容旧路径
        result.details.url = smoke.data?.urlMatched ? '✅ URL 识别正常' : '❌ URL 未匹配';
        result.details.step = `步骤识别: ${smoke.data?.step || 'unknown'}`;
      }

      if (smoke.report?.upstream?.url) {
        result.details.tabUrl = smoke.report.upstream.url;
      }
    } catch (error) {
      result.status = 'error';
      result.error = error.message;
      result.details.connection = '❌ 注册页 smoke check 失败';
    }

    return result;
  }
  
  
  /**
   * 计算总体健康分数
   */
  calculateOverallHealth() {
    const scores = {
      healthy: 100,
      warning: 50,
      error: 0,
      unknown: 25
    };
    
    const components = [
      this.health.frontend,
      this.health.backend,
      this.health.upstream
    ];
    
    let totalScore = 0;
    let count = 0;
    
    components.forEach(component => {
      totalScore += scores[component.status] || 0;
      count++;
    });
    
    this.health.overall.score = Math.round(totalScore / count);
    
    if (this.health.overall.score >= 80) {
      this.health.overall.status = 'healthy';
      this.health.overall.emoji = '💚';
      this.health.overall.text = '系统运行良好';
    } else if (this.health.overall.score >= 50) {
      this.health.overall.status = 'warning';
      this.health.overall.emoji = '💛';
      this.health.overall.text = '系统部分功能异常';
    } else {
      this.health.overall.status = 'error';
      this.health.overall.emoji = '❤️';
      this.health.overall.text = '系统存在严重问题';
    }
  }
  
  /**
   * 生成智能建议
   */
  generateRecommendations() {
    this.recommendations = [];
    
    if (this.health.backend.status !== 'healthy') {
      if (this.health.backend.status === 'error') {
        this.recommendations.push({
          priority: 'high',
          title: '后端API服务无法连接',
          description: '无法启动邮箱监控和接收验证码',
          solutions: [
            { action: 'checkNetwork', text: '检查网络连接' },
            { action: 'checkURL', text: `确认API地址：${API_CONFIG.BASE_URL}` },
            { action: 'contactAdmin', text: '联系服务提供者确认API服务器状态' }
          ]
        });
      }
    }
    
    if (this.health.upstream.status !== 'healthy') {
      if (this.health.upstream.status === 'warning' || this.health.upstream.status === 'error') {
        this.recommendations.push({
          priority: 'high',
          title: '注册页链路探测异常',
          description: 'Windsurf 注册页结构可能已经变化',
          solutions: [
            { action: 'openRegisterPage', text: '打开注册页' },
            { action: 'checkPermissions', text: '检查扩展权限' },
            { action: 'checkDebug', text: '查看详细调试' }
          ]
        });
      }
    }
    
    // 检查状态机卡住
    if (this.stateMachine && this.stateMachine.isInProgress()) {
      const metadata = this.stateMachine.getMetadata();
      if (metadata.created_at) {
        const elapsed = Date.now() - new Date(metadata.created_at).getTime();
        if (elapsed > 10 * 60 * 1000) { // 超过10分钟
          this.recommendations.push({
            priority: 'medium',
            title: '检测到长时间未完成的注册',
            description: '可能已卡住，建议重置',
            solutions: [
              { action: 'reset', text: '重置状态并重新开始' }
            ]
          });
        }
      }
    }
  }
  
  /**
   * 🎨 创建可视化状态面板
   */
  createVisualPanel() {
    // 创建面板容器
    const panel = document.createElement('div');
    panel.id = 'super-brain-panel';
    panel.className = 'brain-panel';
    panel.innerHTML = `
      <div class="brain-header">
        <div class="brain-title">
          <span class="brain-emoji">🧠</span>
          <span>超级智能大脑</span>
        </div>
        <div class="brain-score">
          <span class="score-value">${this.health.overall.score}</span>
          <span class="score-label">健康分</span>
        </div>
      </div>
      
      <div class="brain-overall">
        <span class="overall-emoji">${this.health.overall.emoji}</span>
        <span class="overall-text">${this.health.overall.text}</span>
      </div>
      
      <div class="brain-components">
        ${this.renderComponent('前端', this.health.frontend)}
        ${this.renderComponent('后端API', this.health.backend)}
        ${this.renderComponent('关键链路', this.health.upstream)}
      </div>
      
      ${this.recommendations.length > 0 ? `
        <div class="brain-recommendations">
          <div class="recommendations-title">💡 智能建议</div>
          ${this.recommendations.map(r => this.renderRecommendation(r)).join('')}
        </div>
      ` : ''}
      
      <div class="brain-actions">
        <button class="brain-btn brain-btn-primary" id="brain-refresh">🔄 刷新检测</button>
        <button class="brain-btn brain-btn-test" id="brain-test-api">🧪 测试API</button>
        <button class="brain-btn brain-btn-debug" id="brain-debug">🐛 详细调试</button>
        <button class="brain-btn brain-btn-secondary" id="brain-close">关闭</button>
      </div>
    `;
    
    this.panel = panel;
    return panel;
  }
  
  /**
   * 渲染组件状态
   */
  renderComponent(name, component) {
    const statusEmoji = {
      healthy: '✅',
      warning: '⚠️',
      error: '❌',
      unknown: '❔'
    };
    
    const detailsHtml = Object.entries(component.details || {})
      .map(([key, value]) => `<div class="detail-item">${value}</div>`)
      .join('');
    
    return `
      <div class="component-item status-${component.status}">
        <div class="component-header">
          <span class="component-emoji">${statusEmoji[component.status]}</span>
          <span class="component-name">${name}</span>
        </div>
        <div class="component-details">${detailsHtml || '无详细信息'}</div>
      </div>
    `;
  }
  
  /**
   * 渲染建议
   */
  renderRecommendation(rec) {
    const priorityEmoji = {
      high: '🔴',
      medium: '🟡',
      low: '🟢'
    };
    
    const solutionsHtml = rec.solutions
      .map(s => `<button class="solution-btn" data-action="${s.action}">${s.text}</button>`)
      .join('');
    
    return `
      <div class="recommendation-item priority-${rec.priority}">
        <div class="rec-header">
          <span class="rec-emoji">${priorityEmoji[rec.priority]}</span>
          <span class="rec-title">${rec.title}</span>
        </div>
        <div class="rec-description">${rec.description}</div>
        <div class="rec-solutions">${solutionsHtml}</div>
      </div>
    `;
  }
  
  /**
   * 显示可视化面板
   */
  async showPanel(container) {
    // 先执行健康检查
    await this.fullHealthCheck();
    
    // 创建面板
    const panel = this.createVisualPanel();
    
    // 清空容器并添加面板
    container.innerHTML = '';
    container.appendChild(panel);
    
    // 绑定事件
    this.bindPanelEvents();
  }
  
  /**
   * 绑定面板事件
   */
  bindPanelEvents() {
    if (!this.panel) return;
    
    // 刷新按钮
    const refreshBtn = this.panel.querySelector('#brain-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '🔄 检测中...';
        
        await this.fullHealthCheck();
        
        // 重新渲染
        const container = this.panel.parentElement;
        await this.showPanel(container);
      });
    }
    
    // 测试API按钮
    const testApiBtn = this.panel.querySelector('#brain-test-api');
    if (testApiBtn) {
      testApiBtn.addEventListener('click', async () => {
        await this.testAPICall();
      });
    }
    
    // 调试按钮
    const debugBtn = this.panel.querySelector('#brain-debug');
    if (debugBtn) {
      debugBtn.addEventListener('click', async () => {
        await this.showDebugPanel();
      });
    }
    
    // 关闭按钮
    const closeBtn = this.panel.querySelector('#brain-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.panel.remove();
      });
    }
    
    // 解决方案按钮
    const solutionBtns = this.panel.querySelectorAll('.solution-btn');
    solutionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this.executeSolution(action);
      });
    });
  }
  
  /**
   * 显示详细调试面板
   */
  async showDebugPanel() {
    console.log('[SuperBrain] 打开详细调试面板');
    
    const debugPanel = document.createElement('div');
    debugPanel.className = 'brain-panel brain-debug-panel';
    debugPanel.innerHTML = `
      <div class="brain-header">
        <div class="brain-title">
          <span class="brain-emoji">🐛</span>
          <span>后端与链路详细调试</span>
        </div>
      </div>
      
      <div class="debug-content">
        <div class="debug-section">
          <div class="debug-title">📋 API配置信息</div>
          <div class="debug-log" id="debug-config"></div>
        </div>
        
        <div class="debug-section">
          <div class="debug-title">🧪 API测试</div>
          <div class="debug-log" id="debug-test"></div>
        </div>
        
        <div class="debug-section">
          <div class="debug-title">💡 解决建议</div>
          <div class="debug-log" id="debug-solution"></div>
        </div>
      </div>
      
      <div class="brain-actions">
        <button class="brain-btn brain-btn-primary" id="debug-test-btn">🧪 开始测试</button>
        <button class="brain-btn brain-btn-secondary" id="debug-close">关闭</button>
      </div>
    `;
    
    // 替换当前面板
    const container = this.panel.parentElement;
    container.innerHTML = '';
    container.appendChild(debugPanel);
    this.panel = debugPanel;
    
    // 显示配置信息
    this.showConfigInfo();
    
    // 绑定事件
    document.getElementById('debug-test-btn').addEventListener('click', async () => {
      await this.runDetailedTest();
    });
    
    document.getElementById('debug-close').addEventListener('click', async () => {
      // 返回主面板
      await this.showPanel(container);
    });
  }
  
  /**
   * 显示配置信息
   * 决策理由：版本/协议字段统一从 WindsurfProtocol.client 读，
   * API_CONFIG 只保留与运行环境相关的字段（BASE_URL / TIMEOUT / POLL_INTERVAL）。
   */
  showConfigInfo() {
    const configLog = document.getElementById('debug-config');
    const ep = this.protocolEndpoints;
    const cli = this.protocolClient;

    const info = [
      `✅ 扩展ID: ${chrome.runtime.id}`,
      `✅ API地址: ${API_CONFIG.BASE_URL}`,
      `✅ apiClient状态: ${this.apiClient ? '已初始化' : '未初始化'}`,
      `✅ 协议版本: ${cli.protocolVersion}`,
      `✅ 客户端: ${cli.name} v${cli.version}`,
      `⏱️ 请求超时: ${API_CONFIG.TIMEOUT}ms`,
      `🔄 轮询间隔: ${API_CONFIG.POLL_INTERVAL}ms`,
      ``,
      `📂 API端点（来自协议契约）：`,
      `  健康检查: ${ep.health}`,
      `  启动监控: ${ep.startMonitor}`,
      `  查询验证码: ${ep.checkCode}`,
      `  账号管理: ${ep.accounts}`,
      ``,
      `🌐 完整URL示例:`,
      `  ${API_CONFIG.BASE_URL}${ep.startMonitor}`,
    ];

    // 决策理由：使用 DOM API 替代 innerHTML 拼接，避免任何字段反射注入风险
    const fragment = document.createDocumentFragment();
    for (const line of info) {
      const div = document.createElement('div');
      div.textContent = line;
      fragment.appendChild(div);
    }
    configLog.replaceChildren(fragment);
  }
  
  /**
   * 运行详细测试
   */
  async runDetailedTest() {
    const testLog = document.getElementById('debug-test');
    const solutionLog = document.getElementById('debug-solution');
    
    testLog.innerHTML = '<div>🔄 开始测试关键链路...</div>';
    solutionLog.innerHTML = '';
    
    const log = (msg, isError = false) => {
      const div = document.createElement('div');
      div.textContent = msg;
      if (isError) div.style.color = '#ef4444';
      testLog.appendChild(div);
      testLog.scrollTop = testLog.scrollHeight;
    };
    
    log(`[${new Date().toLocaleTimeString()}] 📤 调用关键链路探测...`);
    log(`API地址: ${API_CONFIG.BASE_URL}`);
    
    const startTime = Date.now();
    
    try {
      const response = await this.apiClient.smokeCheck();
      const elapsed = Date.now() - startTime;
      
      log('');
      log(`✅ API调用成功！ (耗时: ${elapsed}ms)`);
      log('');
      log(`API响应:`);
      log(`  ${JSON.stringify(response, null, 2)}`);
      log('');
      
      if (response.success) {
        solutionLog.innerHTML = `
          <div style="color: #10b981; font-weight: 600;">✅ 关键链路工作正常</div>
          <div style="margin-top: 8px;">健康检查、账号接口、监控接口和验证码接口都可用。</div>
        `;
      } else {
        solutionLog.innerHTML = `
          <div style="color: #f59e0b; font-weight: 600;">⚠️ 链路探测返回异常</div>
          <div style="margin-top: 8px;">至少有一个关键接口异常，请检查后端日志。</div>
        `;
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      
      log('');
      log(`❌ API调用失败 (耗时: ${elapsed}ms)`, true);
      log('');
      log(`错误详情:`, true);
      log(`  ${error.message}`, true);
      log('');
      
      // 分析错误并给出解决方案（仅限本项目实际涉及的链路）
      const ep = this.protocolEndpoints;
      solutionLog.innerHTML = `
        <div style="color: #ef4444; font-weight: 600;">🔴 问题：无法完成关键链路探测</div>
        <div style="margin-top: 8px;">可能原因:</div>
        <div style="margin-left: 16px;">
          1. 本地后端未启动（start-backend.bat）<br>
          2. 网络连接问题<br>
          3. config.js 中 BASE_URL 与实际后端地址不一致<br>
          4. 上游接口契约（windsurf 注册页）已变化
        </div>
        <div style="margin-top: 8px;">解决步骤:</div>
        <div style="margin-left: 16px;">
          ✅ 确认 start-backend.bat 已运行，且没有错误日志<br>
          ✅ 检查 extension/config.js 中的 API_CONFIG.BASE_URL<br>
          ✅ 在浏览器直接访问: ${API_CONFIG.BASE_URL}${ep.health}<br>
          ✅ 打开 Windsurf 注册页后重试 smoke check
        </div>
      `;
    }
  }

  /**
   * 执行解决方案
   * 决策理由：本项目只走 HTTP API（非 native messaging），保留与
   * generateRecommendations() 中实际使用的 action 对应的处理分支。
   */
  async executeSolution(action) {
    console.log('[SuperBrain] 执行解决方案:', action);

    switch (action) {
      case 'reset': {
        const ok = await ui.confirm('确定要重置当前状态吗？', {
          title: '重置状态',
          confirmText: '重置',
          danger: true
        });
        if (ok) {
          this.stateMachine.reset();
          await this.stateMachine.clearStorage();
          ui.toast('状态已重置', 'success');
          setTimeout(() => location.reload(), 600);
        }
        break;
      }

      case 'checkNetwork':
        window.open(API_CONFIG.BASE_URL, '_blank');
        break;

      case 'checkURL':
      case 'checkConfig':
        await ui.alert('请检查 extension/config.js 中的 API_CONFIG.BASE_URL 是否正确指向后端地址', { title: '检查配置' });
        break;

      case 'checkPermissions':
        await ui.alert('请检查 extension/manifest.json 中的 host_permissions 是否包含 API 域名', { title: '检查权限' });
        break;

      case 'openRegisterPage':
        chrome.tabs.create({ url: this.upstream.registerUrl });
        break;

      case 'checkDebug':
        await this.showDebugPanel();
        break;

      case 'contactAdmin':
        await ui.alert('请联系作者或在 GitHub 提交 Issue：https://github.com/bjfwan/windsurf-helper-opensource/issues', { title: '联系作者' });
        break;

      default:
        console.warn('[SuperBrain] 未知 action:', action);
    }
  }
  
  /**
   * 测试关键链路
   */
  async testAPICall() {
    const testSession = 'test-' + Date.now();
    const result = await ui.confirm(
      `将执行健康检查、账号接口、监控接口和验证码接口的 smoke check\n\n测试会话 ID: ${testSession}`,
      { title: '测试关键链路', confirmText: '开始测试' }
    );

    if (!result) return;

    try {
      console.log('[SuperBrain] 开始测试API调用');
      console.log('[SuperBrain] API_CONFIG:', API_CONFIG);
      console.log('[SuperBrain] apiClient:', this.apiClient ? '已初始化' : '未初始化');

      console.log('[SuperBrain] 调用 apiClient.smokeCheck');
      const response = await this.apiClient.smokeCheck();

      console.log('[SuperBrain] API响应:', response);

      if (response.success) {
        await ui.alert(JSON.stringify(response, null, 2), { title: '✅ 链路测试成功' });
      } else {
        await ui.alert(JSON.stringify(response, null, 2), { title: '⚠️ 链路测试异常' });
      }
    } catch (error) {
      console.error('[SuperBrain] API调用失败:', error);
      await ui.alert(`错误: ${error.message}\n\n查看控制台获取详细信息`, { title: '❌ API 调用失败' });
    }
  }
}
