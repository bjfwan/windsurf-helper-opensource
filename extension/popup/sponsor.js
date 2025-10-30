/**
 * 打赏功能
 */

// 打赏相关变量
let currentPaymentType = 'wechat';

// 显示打赏弹窗
function showSponsorModal() {
  const modal = document.getElementById('sponsor-modal');
  modal.classList.remove('hidden');
  
  // 显示当前支付方式的收款码
  loadQRCode(currentPaymentType);
  
  log('☕ 感谢您的支持！', 'success');
}

// 隐藏打赏弹窗
function hideSponsorModal() {
  const modal = document.getElementById('sponsor-modal');
  modal.classList.add('hidden');
}

// 切换支付方式
function switchPaymentType(type) {
  currentPaymentType = type;
  
  // 更新标签页样式
  document.querySelectorAll('.sponsor-tab').forEach(tab => {
    if (tab.dataset.type === type) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // 加载对应的收款码
  loadQRCode(type);
}

// 加载收款码
function loadQRCode(type) {
  const qrcodeContainer = document.getElementById('sponsor-qrcode');
  
  // 构建收款码路径
  const imagePath = chrome.runtime.getURL(`popup/sponsor-qr/${type}.jpg`);
  
  // 检查图片是否存在
  const img = new Image();
  img.onload = function() {
    qrcodeContainer.innerHTML = `<img src="${imagePath}" alt="${type === 'wechat' ? '微信' : '支付宝'}收款码">`;
  };
  img.onerror = function() {
    qrcodeContainer.innerHTML = `
      <div class="placeholder">
        <p>收款码暂未设置</p>
        <p style="font-size: 12px; margin-top: 10px;">请联系作者获取收款码</p>
      </div>
    `;
  };
  img.src = imagePath;
}

// 设置打赏相关事件监听
function setupSponsorEvents() {
  // 关闭按钮
  document.getElementById('sponsor-close').addEventListener('click', hideSponsorModal);
  
  // 点击遮罩关闭
  document.getElementById('sponsor-modal').addEventListener('click', (e) => {
    if (e.target.id === 'sponsor-modal') {
      hideSponsorModal();
    }
  });
  
  // 切换支付方式
  document.querySelectorAll('.sponsor-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchPaymentType(tab.dataset.type);
    });
  });
}
