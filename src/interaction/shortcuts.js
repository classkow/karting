import { VIEWS } from './views.js';

// ————— 键盘快捷键 —————
export function initShortcuts({ sim, ctrl, explode, rig, help, infoCard, picking }) {
  const viewKeys = Object.keys(VIEWS);

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
      sim.throttle = Math.min(1, sim.throttle + 0.15);
      ctrl.setThrottleUI(sim.throttle);
    } else if (k === 's' || k === 'arrowdown') {
      sim.throttle = Math.max(0, sim.throttle - 0.15);
      ctrl.setThrottleUI(sim.throttle);
    } else if (k === 'a' || k === 'arrowleft') {
      sim.steer = Math.max(-1, sim.steer - 0.2);
      ctrl.setSteerUI(sim.steer);
    } else if (k === 'd' || k === 'arrowright') {
      sim.steer = Math.min(1, sim.steer + 0.2);
      ctrl.setSteerUI(sim.steer);
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
    if (e.key.toLowerCase() === 'b') {
      sim.brakeTarget = 0;
      ctrl.setBrakeUI(0); // 松键后把滑条 UI 拉回来，否则永远停在 100%
    }
  });
}
