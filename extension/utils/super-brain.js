class SuperBrain {
  constructor(supabaseClient, stateMachine, smartValidator) {
    this.supabase = supabaseClient;
    this.stateMachine = stateMachine;
    this.validator = smartValidator;
    
    // 健康状态（云端版本）
    this.health = {
      frontend: { status: 'unknown', details: {} },
      cloudAPI: { status: 'unknown', details: {} },
      supabase: { status: 'unknown', details: {} },
      overall: { status: 'unknown', score: 0 }
    };
    
    // 智能建议
    this.recommendations = [];
    
    // 可视化面板元素
    this.panel = null;
  }
  async fullHealthCheck() {
    console.log('[SuperBrain] 🧠 开始全面健康检查（云端版本）...');
    console.log('[SuperBrain] [1/3] 检测前端组件...');
    console.log('[SuperBrain] [2/3] 检测云端API...');
    console.log('[SuperBrain] [3/3] 检测 Supabase 连接...');
    
    const checks = await Promise.allSettled([
      this.checkFrontend(),
      this.checkCloudAPI(),
      this.checkSupabase()
    ]);
    
    // 汇总结果
    this.health.frontend = checks[0].status === 'fulfilled' ? checks[0].value : { status: 'error', error: checks[0].reason };
    this.health.cloudAPI = checks[1].status === 'fulfilled' ? checks[1].value : { status: 'error', error: checks[1].reason };
    this.health.supabase = checks[2].status === 'fulfilled' ? checks[2].value : { status: 'error', error: checks[2].reason };
    
    console.log('[SuperBrain] 前端:', this.health.frontend.status);
    console.log('[SuperBrain] 云端API:', this.health.cloudAPI.status);
    console.log('[SuperBrain] Supabase:', this.health.supabase.status);
    
    // 计算总体健康分数
    this.calculateOverallHealth();
    
    // 生成智能建议
    this.generateRecommendations();
    
    console.log('[SuperBrain] ✅ 健康检查完成 - 分数:', this.health.overall.score);
    
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
      
      // 检查4：Supabase客户端
      result.details.supabaseClient = this.supabase ? '✅ 已初始化' : '❌ 未初始化';
      
      result.status = 'healthy';
    } catch (error) {
      result.status = 'error';
      result.error = error.message;
    }
    
    return result;
  }
  
  /**
   * 检查云端API状态
   */
  async checkCloudAPI() {
    const result = { status: 'unknown', details: {} };
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      // 检查1：API健康检查
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/health`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        result.details.apiStatus = `✅ ${data.status}`;
        result.details.message = data.message;
        
        // 检查各项服务
        if (data.checks) {
          result.details.supabase = data.checks.supabase ? '✅ 连接正常' : '❌ 连接失败';
          result.details.email = data.checks.email ? '✅ 连接正常' : '⚠️ 邮箱异常';
        }
        
        result.status = data.status === 'ok' ? 'healthy' : 'warning';
      } else {
        result.details.apiStatus = '⚠️ 响应异常';
        result.status = 'warning';
      }
    } catch (error) {
      result.details.apiStatus = '❌ 无法连接';
      result.details.error = error.name === 'AbortError' ? '请求超时' : error.message;
      result.details.url = API_CONFIG.BASE_URL;
      result.status = 'error';
    }
    
    // 检查2：Cloudflare Tunnel状态
    try {
      const tunnelCheck = await fetch(`${API_CONFIG.BASE_URL}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      
      result.details.tunnel = tunnelCheck.ok ? '✅ Tunnel正常' : '⚠️ Tunnel异常';
    } catch (error) {
      result.details.tunnel = '❌ Tunnel未连接';
    }
    
    return result;
  }
  
  /**
   * 检查 Supabase 连接
   */
  async checkSupabase() {
    const result = { status: 'unknown', details: {} };
    
    // 决策理由：扩展已迁移到 API 模式，无 Supabase 客户端时直接标记为不适用
    if (!this.supabase || !this.supabase.url || !this.supabase.key) {
      result.status = 'healthy';
      result.details.mode = 'ℹ️ API 模式（无需直连 Supabase）';
      return result;
    }
    
    try {
      // 决策理由：添加超时控制，避免网络问题导致无限等待
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3秒超时
      
      // 检查1：REST API 连接
      const response = await fetch(`${this.supabase.url}/rest/v1/`, {
        headers: {
          'apikey': this.supabase.key,
          'Authorization': `Bearer ${this.supabase.key}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      result.details.restApi = response.ok ? '✅ 可访问' : '❌ 连接失败';
      
      // 检查2：accounts 表（带超时）
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 2000);
      
      const accountsCheck = await fetch(`${this.supabase.url}/rest/v1/accounts?limit=1`, {
        headers: {
          'apikey': this.supabase.key,
          'Authorization': `Bearer ${this.supabase.key}`
        },
        signal: controller2.signal
      });
      
      clearTimeout(timeoutId2);
      result.details.accountsTable = accountsCheck.ok ? '✅ 可访问' : '❌ 无权限';
      
      // 检查3：verification_logs 表（带超时）
      const controller3 = new AbortController();
      const timeoutId3 = setTimeout(() => controller3.abort(), 2000);
      
      const logsCheck = await fetch(`${this.supabase.url}/rest/v1/verification_logs?limit=1`, {
        headers: {
          'apikey': this.supabase.key,
          'Authorization': `Bearer ${this.supabase.key}`
        },
        signal: controller3.signal
      });
      
      clearTimeout(timeoutId3);
      result.details.logsTable = logsCheck.ok ? '✅ 可访问' : '❌ 无权限';
      
      result.status = response.ok && accountsCheck.ok && logsCheck.ok ? 'healthy' : 'warning';
    } catch (error) {
      result.status = 'error';
      result.error = error.message;
      result.details.connection = '❌ 网络错误';
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
      this.health.cloudAPI,
      this.health.supabase
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
    
    // 检查云端API状态
    if (this.health.cloudAPI.status !== 'healthy') {
      if (this.health.cloudAPI.status === 'error') {
        this.recommendations.push({
          priority: 'high',
          title: '云端API服务无法连接',
          description: '无法启动邮箱监控和接收验证码',
          solutions: [
            { action: 'checkNetwork', text: '检查网络连接' },
            { action: 'checkURL', text: `确认API地址：${API_CONFIG.BASE_URL}` },
            { action: 'contactAdmin', text: '联系服务提供者确认API服务器状态' }
          ]
        });
      } else if (this.health.cloudAPI.details.email?.includes('❌') || this.health.cloudAPI.details.email?.includes('⚠️')) {
        this.recommendations.push({
          priority: 'medium',
          title: '邮箱监控服务异常',
          description: '可能无法自动接收验证码',
          solutions: [
            { action: 'contactAdmin', text: '联系服务提供者检查邮箱配置' },
            { action: 'manual', text: '暂时可手动填写验证码' }
          ]
        });
      }
      
      if (this.health.cloudAPI.details.tunnel?.includes('❌')) {
        this.recommendations.push({
          priority: 'high',
          title: 'Cloudflare Tunnel未连接',
          description: '公网无法访问API服务',
          solutions: [
            { action: 'contactAdmin', text: '联系服务提供者启动Tunnel服务' }
          ]
        });
      }
    }
    
    // 检查 Supabase 状态
    if (this.health.supabase.status !== 'healthy') {
      this.recommendations.push({
        priority: 'high',
        title: 'Supabase 连接异常',
        description: '无法保存账号和接收验证码',
        solutions: [
          { action: 'checkNetwork', text: '检查网络连接' },
          { action: 'checkConfig', text: '检查 config.js 中的配置' },
          { action: 'checkPermissions', text: '检查 manifest.json 权限' }
        ]
      });
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
        ${this.renderComponent('云端API', this.health.cloudAPI)}
        ${this.renderComponent('Supabase', this.health.supabase)}
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
          <span>云端API详细调试</span>
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
   */
  showConfigInfo() {
    const configLog = document.getElementById('debug-config');
    
    const info = [
      `✅ 扩展ID: ${chrome.runtime.id}`,
      `✅ API地址: ${API_CONFIG.BASE_URL}`,
      `✅ apiClient状态: ${typeof apiClient !== 'undefined' ? '已初始化' : '未初始化'}`,
      `⏱️ 请求超时: ${API_CONFIG.TIMEOUT}ms`,
      `🔄 轮询间隔: ${API_CONFIG.POLL_INTERVAL}ms`,
      ``,
      `📂 API端点:`,
      `  启动监控: ${API_CONFIG.ENDPOINTS.START_MONITOR}`,
      `  查询验证码: ${API_CONFIG.ENDPOINTS.CHECK_CODE}`,
      `  健康检查: ${API_CONFIG.ENDPOINTS.HEALTH}`,
      ``,
      `🌐 完整URL示例:`,
      `  ${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.START_MONITOR}`,
    ];
    
    configLog.innerHTML = info.map(line => `<div>${line}</div>`).join('');
  }
  
  /**
   * 运行详细测试
   */
  async runDetailedTest() {
    const testLog = document.getElementById('debug-test');
    const solutionLog = document.getElementById('debug-solution');
    
    testLog.innerHTML = '<div>🔄 开始测试云端API...</div>';
    solutionLog.innerHTML = '';
    
    const log = (msg, isError = false) => {
      const div = document.createElement('div');
      div.textContent = msg;
      if (isError) div.style.color = '#ef4444';
      testLog.appendChild(div);
      testLog.scrollTop = testLog.scrollHeight;
    };
    
    log(`[${new Date().toLocaleTimeString()}] 📤 调用云端API...`);
    log(`API地址: ${API_CONFIG.BASE_URL}`);
    log(`测试邮箱: test@example.com`);
    log(`测试会话: test-${Date.now()}`);
    
    const startTime = Date.now();
    const testEmail = 'test@example.com';
    const testSession = `test-${Date.now()}`;
    
    try {
      const response = await apiClient.startMonitor(testEmail, testSession);
      const elapsed = Date.now() - startTime;
      
      log('');
      log(`✅ API调用成功！ (耗时: ${elapsed}ms)`);
      log('');
      log(`API响应:`);
      log(`  ${JSON.stringify(response, null, 2)}`);
      log('');
      
      if (response.success) {
        solutionLog.innerHTML = `
          <div style="color: #10b981; font-weight: 600;">✅ 云端API工作正常！</div>
          <div style="margin-top: 8px;">API通信已建立，可以正常使用自动注册功能。</div>
        `;
      } else {
        solutionLog.innerHTML = `
          <div style="color: #f59e0b; font-weight: 600;">⚠️ API返回失败</div>
          <div style="margin-top: 8px;">API可访问但返回失败状态，请检查API服务器日志。</div>
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
      
      // 分析错误并给出解决方案
      solutionLog.innerHTML = `
        <div style="color: #ef4444; font-weight: 600;">🔴 问题：无法连接到云端API</div>
        <div style="margin-top: 8px;">可能原因:</div>
        <div style="margin-left: 16px;">
          1. API服务器未运行<br>
          2. Cloudflare Tunnel未连接<br>
          3. 网络连接问题<br>
          4. API地址配置错误
        </div>
        <div style="margin-top: 8px;">解决步骤:</div>
        <div style="margin-left: 16px;">
          ✅ 联系服务提供者确认API服务器状态<br>
          ✅ 检查config.js中的API_CONFIG.BASE_URL<br>
          ✅ 尝试在浏览器直接访问: ${API_CONFIG.BASE_URL}/api/health
        </div>
      `;
    }
  }
  
  /**
   * 分析错误并给出解决方案
   */
  analyzeError(errorMessage, solutionLog) {
    const solutions = [];
    
    if (errorMessage.includes('not found') || errorMessage.includes('host not found')) {
      solutions.push({
        title: '🔴 问题：找不到Native Messaging Host',
        reasons: [
          '1. 注册表未配置或配置错误',
          '2. manifest.json文件路径不正确',
          '3. Extension ID不匹配'
        ],
        steps: [
          '✅ 步骤1: 打开 edge://extensions',
          '   - 开启"开发人员模式"',
          '   - 复制扩展的ID',
          '',
          '✅ 步骤2: 检查ID是否匹配',
          `   - 当前扩展ID: ${chrome.runtime.id}`,
          '   - 打开 backend/windsurf_email_monitor.json',
          '   - 检查 allowed_origins 中的ID',
          '',
          '✅ 步骤3: 如果ID不匹配',
          '   - 运行 backend/create_clean_manifest.py',
          '   - 运行 backend/final_register.bat',
          '   - 在地址栏输入: edge://restart',
          '',
          '✅ 步骤4: 验证配置',
          '   - 运行 backend/verify_config.bat',
          '   - 检查所有配置是否正确',
        ]
      });
    } else if (errorMessage.includes('Access') || errorMessage.includes('forbidden')) {
      solutions.push({
        title: '🔴 问题：访问被拒绝',
        reasons: [
          '1. manifest.json中的permissions不正确',
          '2. Extension ID不在allowed_origins中'
        ],
        steps: [
          '✅ 检查 extension/manifest.json',
          '   - 确认有 "nativeMessaging" 权限',
          '',
          '✅ 检查 backend/windsurf_email_monitor.json',
          `   - allowed_origins 应包含: extension://${chrome.runtime.id}/`
        ]
      });
    } else if (errorMessage.includes('exited')) {
      solutions.push({
        title: '🔴 问题：Native Host启动后立即退出',
        reasons: [
          '1. Python未安装或路径不正确',
          '2. native_host.py有语法错误',
          '3. 依赖包未安装'
        ],
        steps: [
          '✅ 测试Python',
          '   - 打开命令提示符',
          '   - 运行: py --version',
          '   - 应显示Python版本',
          '',
          '✅ 手动测试Native Host',
          '   - cd backend',
          '   - py test_native_host.py',
          '   - 查看详细错误信息'
        ]
      });
    } else {
      solutions.push({
        title: '🔴 未知错误',
        reasons: ['请查看完整的错误消息'],
        steps: [
          '✅ 收集调试信息',
          '   - 打开浏览器开发者工具 (F12)',
          '   - 查看Console标签',
          '   - 截图完整的错误信息',
          '',
          '✅ 手动测试',
          '   - 运行 backend/test_native_host.py',
          '   - 查看 backend/native_host.log'
        ]
      });
    }
    
    // 渲染解决方案
    solutionLog.innerHTML = solutions.map(solution => `
      <div style="margin-bottom: 20px;">
        <div style="font-weight: 600; color: #ef4444; margin-bottom: 8px;">${solution.title}</div>
        <div style="margin-bottom: 8px; color: #f59e0b;">可能原因:</div>
        ${solution.reasons.map(r => `<div style="margin-left: 12px; font-size: 12px;">${r}</div>`).join('')}
        <div style="margin-top: 8px; margin-bottom: 8px; color: #10b981;">解决步骤:</div>
        ${solution.steps.map(s => `<div style="margin-left: 12px; font-size: 12px; line-height: 1.6;">${s}</div>`).join('')}
      </div>
    `).join('');
  }
  
  /**
   * 执行解决方案
   */
  async executeSolution(action) {
    console.log('[SuperBrain] 执行解决方案:', action);
    
    switch (action) {
      case 'installNative':
        await ui.alert('请打开文件管理器，导航到 backend 文件夹，运行 install_native.bat', { title: '安装原生模块' });
        break;

      case 'startProxy':
        await ui.alert('请打开文件管理器，导航到 backend 文件夹，运行 启动代理.bat', { title: '启动代理' });
        break;

      case 'manual':
        await ui.alert('请打开文件管理器，导航到 backend 文件夹，运行 启动监控.bat', { title: '启动监控' });
        break;

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
          // 略作延迟，让 toast 可见后再刷新
          setTimeout(() => location.reload(), 600);
        }
        break;
      }

      case 'checkNetwork':
        window.open(API_CONFIG.BASE_URL, '_blank');
        break;

      case 'checkConfig':
        await ui.alert('请检查 extension/config.js 中的 API_CONFIG 配置', { title: '检查配置' });
        break;

      case 'checkPermissions':
        await ui.alert('请检查 extension/manifest.json 中的 host_permissions 是否包含 API 域名', { title: '检查权限' });
        break;

      default:
        console.warn('未知操作:', action);
    }
  }
  
  /**
   * 测试云端API调用
   */
  async testAPICall() {
    const testSession = 'test-' + Date.now();
    const result = await ui.confirm(
      `将调用 /api/start-monitor 接口\n邮箱: test@example.com\n会话 ID: ${testSession}\n\n点击确定开始测试`,
      { title: '测试云端 API', confirmText: '开始测试' }
    );

    if (!result) return;

    try {
      console.log('[SuperBrain] 开始测试API调用');
      console.log('[SuperBrain] API_CONFIG:', API_CONFIG);
      console.log('[SuperBrain] apiClient:', typeof apiClient);

      const testEmail = 'test@example.com';

      console.log('[SuperBrain] 调用 apiClient.startMonitor');
      const response = await apiClient.startMonitor(testEmail, testSession);

      console.log('[SuperBrain] API响应:', response);

      if (response.success) {
        await ui.alert(JSON.stringify(response, null, 2), { title: '✅ API 调用成功' });
      } else {
        await ui.alert(JSON.stringify(response, null, 2), { title: '⚠️ API 返回失败' });
      }
    } catch (error) {
      console.error('[SuperBrain] API调用失败:', error);
      await ui.alert(`错误: ${error.message}\n\n查看控制台获取详细信息`, { title: '❌ API 调用失败' });
    }
  }
}
