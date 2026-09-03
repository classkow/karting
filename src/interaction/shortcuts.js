import { VIEWS } from './views.js';

// ————— 键盘快捷键 —————
// 驾驶键(W/S/A/D/方向键)支持长按持续输入:keydown 记方向,主循环按 dt 推进,keyup 清零。
export function initShortcuts({ sim, ctrl, explode, rig, help, infoCard, picking }) {
  const viewKeys = Object.keys(VIEWS);

  // 持续输入状态:B 键同理由 keydown/keyup 管理
  const held = new Set();
  // 每秒变化速率(与原单次步长对齐:原来每按一次油门 ±0.15、转向 ±0.2)
  const RATE = { throttle: 0.9, steer: 1.6 };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.repeat) return; // 拦下按键自动重复：按住空格不会反复启停、按住 W 油门不会秒满
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 修饰键组合留给浏览器（Ctrl+R 刷新、Ctrl+S 保存等）
    const k = e.key.toLowerCase();
    // 焦点停在按钮等可聚焦元素上时，空格/Enter 交给浏览器合成 click，避免双触发
    if (e.target !== document.body && (k === ' ' || e.key === 'Enter')) return;
    let handled = true;
    if (k === ' ') {
      sim.toggleEngine();
    } else if (k === 'w' || k === 'arrowup') {
      held.add('up');
    } else if (k === 's' || k === 'arrowdown') {
      held.add('down');
    } else if (k === 'a' || k === 'arrowleft') {
      held.add('left');
    } else if (k === 'd' || k === 'arrowright') {
      held.add('right');
    } else if (k === 'b') {
      sim.brakeTarget = 1;
    } else if (k === 'e') {
      const next = explode.get() > 0.5 ? 0 : 1;
      explode.setTarget(next);
      ctrl.setExplodeUI(next);
    } else if (k === 'r') {
      rig.applyView('home');
    } else if (k === '?' || k === 'h') {
      help.toggle();
    } else if (k === 'escape') {
      infoCard.show(null);
      picking.select(null);
      help.show(false);
    } else if (/^[1-8]$/.test(k)) {
      rig.applyView(viewKeys[+k - 1]);
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'b') {
      sim.brakeTarget = 0;
      ctrl.setBrakeUI(0); // 松键后把滑条 UI 拉回来，否则永远停在 100%
    }
    // 方向键松开即清标志（另一侧按住时保留，支持按住 A 再点 D 的反向修正）
    if (k === 'w' || k === 'arrowup') held.delete('up');
    if (k === 's' || k === 'arrowdown') held.delete('down');
    if (k === 'a' || k === 'arrowleft') held.delete('left');
    if (k === 'd' || k === 'arrowright') held.delete('right');
  });
  // 焦点丢到页面之外时（切窗口/Alt+Tab），held 会卡住——失焦全清
  window.addEventListener('blur', () => held.clear());

  // 主循环每帧调用：按住的方向持续变化，同时松开则不动
  return {
    update(dt) {
      if (!held.size) return;
      if (held.has('up') !== held.has('down')) {
        const d = (held.has('up') ? 1 : -1) * RATE.throttle * dt;
        sim.throttle = Math.min(1, Math.max(0, sim.throttle + d));
        ctrl.setThrottleUI(sim.throttle);
      }
      if (held.has('left') !== held.has('right')) {
        const d = (held.has('right') ? 1 : -1) * RATE.steer * dt;
        sim.steer = Math.min(1, Math.max(-1, sim.steer + d));
        ctrl.setSteerUI(sim.steer);
      }
    },
  };
}
