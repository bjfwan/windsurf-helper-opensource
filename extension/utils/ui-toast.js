/**
 * 统一 UI 组件 - Toast 与 Modal
 *
 * 决策理由：
 *   - alert/confirm 阻塞 UI、视觉粗糙、无法定制样式
 *   - 统一组件可在多个页面复用，并与全站灰白主题一致
 *
 * API:
 *   ui.toast(message, type='info', duration=2000)
 *     type ∈ 'info' | 'success' | 'warning' | 'error'
 *
 *   ui.confirm(message, opts={}) -> Promise<boolean>
 *     opts: { title, confirmText, cancelText, danger }
 *
 *   ui.alert(message, opts={}) -> Promise<void>
 *     opts: { title, confirmText }
 */

(function () {
  // 注入一次样式（每个页面只注入一次）
  function ensureStyles() {
    if (document.getElementById('__ui_toast_styles')) return;
    const style = document.createElement('style');
    style.id = '__ui_toast_styles';
    style.textContent = `
      .ui-toast-stack {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 100000;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      }
      .ui-toast {
        padding: 10px 14px;
        background: rgba(31, 41, 55, 0.95);
        color: #fff;
        font-size: 13px;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        max-width: 360px;
        line-height: 1.5;
        word-break: break-word;
        animation: uiToastIn 0.2s ease-out;
        pointer-events: auto;
      }
      .ui-toast.success { background: rgba(5, 150, 105, 0.95); }
      .ui-toast.warning { background: rgba(217, 119, 6, 0.95); }
      .ui-toast.error   { background: rgba(220, 38, 38, 0.95); }
      .ui-toast.leaving { animation: uiToastOut 0.2s ease-in forwards; }
      @keyframes uiToastIn  { from { transform: translateY(-12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      @keyframes uiToastOut { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-8px); opacity: 0; } }

      .ui-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(17, 24, 39, 0.45);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        animation: uiModalIn 0.18s ease-out;
      }
      @keyframes uiModalIn { from { opacity: 0; } to { opacity: 1; } }
      .ui-modal {
        background: #ffffff;
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
        border: 1px solid rgba(229, 231, 235, 0.9);
        width: min(360px, calc(100% - 40px));
        padding: 20px;
        animation: uiModalSlide 0.2s ease-out;
      }
      @keyframes uiModalSlide { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .ui-modal-title {
        font-size: 15px;
        font-weight: 700;
        color: #111827;
        margin-bottom: 8px;
      }
      .ui-modal-message {
        font-size: 13px;
        color: #374151;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
        margin-bottom: 18px;
      }
      .ui-modal-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .ui-modal-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: filter 0.15s, transform 0.15s;
      }
      .ui-modal-btn:hover { filter: brightness(0.95); transform: translateY(-1px); }
      .ui-modal-btn:active { transform: translateY(0); }
      .ui-modal-btn-cancel  { background: #f3f4f6; color: #111827; border: 1px solid #e5e7eb; }
      .ui-modal-btn-confirm { background: #4b5563; color: #ffffff; }
      .ui-modal-btn-danger  { background: #dc2626; color: #ffffff; }
      .ui-modal-btn:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    `;
    document.head.appendChild(style);
  }

  function ensureToastStack() {
    let stack = document.getElementById('__ui_toast_stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = '__ui_toast_stack';
      stack.className = 'ui-toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  /**
   * 显示 Toast
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} [type='info']
   * @param {number} [duration=2000]
   */
  function toast(message, type = 'info', duration = 2000) {
    ensureStyles();
    const stack = ensureToastStack();
    const node = document.createElement('div');
    node.className = `ui-toast ${type}`;
    node.textContent = String(message);
    stack.appendChild(node);

    const remove = () => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 200);
    };
    setTimeout(remove, Math.max(800, duration));
    return remove;
  }

  function buildModal({ title, message, confirmText, cancelText, danger, showCancel }) {
    ensureStyles();

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'ui-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.className = 'ui-modal';

      if (title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'ui-modal-title';
        titleEl.textContent = title;
        modal.appendChild(titleEl);
      }

      const msg = document.createElement('div');
      msg.className = 'ui-modal-message';
      msg.textContent = String(message ?? '');
      modal.appendChild(msg);

      const actions = document.createElement('div');
      actions.className = 'ui-modal-actions';

      const close = (value) => {
        overlay.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        resolve(value);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape' && showCancel) close(false);
        if (e.key === 'Enter') close(true);
      };

      if (showCancel) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'ui-modal-btn ui-modal-btn-cancel';
        cancelBtn.textContent = cancelText || '取消';
        cancelBtn.addEventListener('click', () => close(false));
        actions.appendChild(cancelBtn);
      }

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'ui-modal-btn ' + (danger ? 'ui-modal-btn-danger' : 'ui-modal-btn-confirm');
      confirmBtn.textContent = confirmText || '确定';
      confirmBtn.addEventListener('click', () => close(true));
      actions.appendChild(confirmBtn);

      modal.appendChild(actions);
      overlay.appendChild(modal);

      // 点击遮罩关闭（仅在有取消按钮时）
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && showCancel) close(false);
      });

      overlay.tabIndex = -1;
      overlay.addEventListener('keydown', onKeyDown);
      document.body.appendChild(overlay);

      // 自动聚焦到默认按钮
      requestAnimationFrame(() => confirmBtn.focus());
    });
  }

  /**
   * 显示确认对话框
   * @param {string} message
   * @param {{title?: string, confirmText?: string, cancelText?: string, danger?: boolean}} [opts]
   * @returns {Promise<boolean>}
   */
  function confirmDialog(message, opts = {}) {
    return buildModal({
      title: opts.title,
      message,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      danger: !!opts.danger,
      showCancel: true
    });
  }

  /**
   * 显示提示对话框（仅一个确定按钮）
   * @param {string} message
   * @param {{title?: string, confirmText?: string}} [opts]
   * @returns {Promise<void>}
   */
  function alertDialog(message, opts = {}) {
    return buildModal({
      title: opts.title,
      message,
      confirmText: opts.confirmText || '确定',
      showCancel: false
    }).then(() => undefined);
  }

  const ui = {
    toast,
    confirm: confirmDialog,
    alert: alertDialog
  };

  // 暴露到全局
  const root = (typeof globalThis !== 'undefined') ? globalThis
              : (typeof self !== 'undefined') ? self
              : (typeof window !== 'undefined') ? window : {};
  root.ui = ui;
})();
