import { VIEWS } from './views.js';
import { TOUCH_BRAKE, advanceBrakePressure } from '../sim/touchInput.js';

// ————— 键盘快捷键 —————
// 驾驶键(W/S/A/D/方向键)支持长按持续输入:keydown 记方向,主循环按 dt 推进,keyup 清零。
//
// 双模式语义：
// - 展台（默认）：S=油门−、转向不自动回中（滑条语义）、1-9 视角、E 爆炸、C 慢放——行为与历史版本逐字一致。
// - 赛道（isTrack()=true）：S/↓=刹车（停稳倒车）、Shift=漂移、松手自动回正、
//   V=换视角、R=回到起点、Esc=返回展台；1-9/E/C 不再触发展台语义。
//
// 输入源：held 集合被键盘与触屏按钮共用（hud 的 onHold → press），刹车手感按源区分——
// 键盘保持"一按即全开"（桌面零回归）；触屏走踏板行程（点刹部分制动、按住渐进到满，
// 见 sim/touchInput.js，修复报障"点刹车直接刹停"）。
export function initShortcuts({ sim, ctrl, explode, rig, help, infoCard, picking, trackApi = null }) {
  const viewKeys = Object.keys(VIEWS);

  // 持续输入状态:B 键同理由 keydown/keyup 管理
  const held = new Set();
  // 各方向的输入源（'key' | 'touch'）：触屏按钮按下时经 press(dir,on,'touch') 登记
  const heldSrc = new Map();
  // 触屏刹车踏板压力（0..1）：只在触屏刹车分支推进，键盘分支恒打满不受影响
  let touchBrakePressure = 0;
  // 每秒变化速率(与原单次步长对齐:原来每按一次油门 ±0.15、转向 ±0.2)
  const RATE = { throttle: 0.9, steer: 1.6 };
  // 赛道模式输入速率：转向更直接，且随速度衰减（高速猛打方向不会瞬间满舵）
  const TRACK_RATE = { throttle: 2.2, steerBase: 3.4, steerDecay: 0.045, center: 2.6 };

  const isTrack = () => !!trackApi?.isTrack?.();

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.repeat) return; // 拦下按键自动重复：按住空格不会反复启停、按住 W 油门不会秒满
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 修饰键组合留给浏览器（Ctrl+R 刷新、Ctrl+S 保存等）
    const k = e.key.toLowerCase();
    // 焦点停在按钮等可聚焦元素上时，空格/Enter 交给浏览器合成 click，避免双触发
    if (e.target !== document.body && (k === ' ' || e.key === 'Enter')) return;
    let handled = true;
    if (isTrack()) {
      // ————— 赛道模式键位 —————
      if (k === ' ') {
        sim.toggleEngine();
      } else if (k === 'w' || k === 'arrowup') {
        held.add('up');
      } else if (k === 's' || k === 'arrowdown') {
        held.add('down'); // 刹车（停稳后倒车）
      } else if (k === 'a' || k === 'arrowleft') {
        held.add('left');
      } else if (k === 'd' || k === 'arrowright') {
        held.add('right');
      } else if (k === 'b') {
        held.add('brake');
      } else if (k === 'shift') {
        sim.driftHeld = true;
      } else if (k === 'v') {
        trackApi.onCamCycle?.();
      } else if (k === 'r') {
        trackApi.onRespawn?.();
      } else if (k === '?' || k === 'h') {
        help.toggle();
      } else if (k === 'escape') {
        // 帮助开着先关帮助，否则退出赛道
        const helpOpen = !document.getElementById('help-overlay')?.classList.contains('hidden');
        if (helpOpen) help.show(false);
        else trackApi.onExit?.();
      } else if (/^[1-9]$/.test(k)) {
        handled = false; // 视角预设是展台语义，赛道下让位
      } else {
        handled = false;
      }
      if (handled) e.preventDefault();
      return;
    }
    // ————— 展台模式键位（历史行为不变）—————
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
    } else if (k === 'c') {
      // 换气慢放：与面板开关同一逻辑（§7.5，相对时序为真值）
      sim.visualSlow = sim.visualSlow === 0.004 ? 0.2 : 0.004;
      ctrl.setCycleSlowUI(sim.visualSlow === 0.004);
    } else if (k === '?' || k === 'h') {
      help.toggle();
    } else if (k === 'escape') {
      infoCard.show(null);
      picking.select(null);
      help.show(false);
    } else if (/^[1-9]$/.test(k)) {
      rig.applyView(viewKeys[+k - 1]);
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'shift') {
      if (isTrack()) sim.driftHeld = false;
      return;
    }
    if (k === 'b') {
      if (isTrack()) {
        held.delete('brake');
      } else {
        sim.brakeTarget = 0;
        ctrl.setBrakeUI(0); // 松键后把滑条 UI 拉回来，否则永远停在 100%
      }
    }
    // 方向键松开即清标志（另一侧按住时保留，支持按住 A 再点 D 的反向修正）
    if (k === 'w' || k === 'arrowup') held.delete('up');
    if (k === 's' || k === 'arrowdown') held.delete('down');
    if (k === 'a' || k === 'arrowleft') held.delete('left');
    if (k === 'd' || k === 'arrowright') held.delete('right');
  });
  // 焦点丢到页面之外时（切窗口/Alt-Tab/手机切后台），held 会卡住——失焦全清
  window.addEventListener('blur', () => {
    held.clear();
    heldSrc.clear();
    touchBrakePressure = 0;
    sim.driftHeld = false;
  });

  // 主循环每帧调用：按住的方向持续变化，同时松开则不动
  return {
    update(dt) {
      if (isTrack()) {
        this.updateTrack(dt);
        return;
      }
      // 展台态清掉触屏踏板压力残留：回赛道后首次点刹不得跳满
      touchBrakePressure = 0;
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

    // 赛道模式：油门/刹车/转向 + 松手自动回正 + 触屏自动油门
    updateTrack(dt) {
      const autoThrottle = trackApi.autoThrottle?.() ?? false;
      // 刹车按输入源分流：键盘通道保持"一按即全开"（桌面零回归）；
      // 触屏通道走踏板行程——点刹给部分制动、按住渐进到满、松开快速回弹。
      // 键盘 keydown 直接 add 进 held（不登记源），heldSrc 无记录即键盘口径。
      const kbBraking = (held.has('down') && heldSrc.get('down') !== 'touch')
        || (held.has('brake') && heldSrc.get('brake') !== 'touch');
      const touchBraking = (held.has('down') && heldSrc.get('down') === 'touch')
        || (held.has('brake') && heldSrc.get('brake') === 'touch');
      if (kbBraking) {
        sim.throttle = 0;
        sim.brakeTarget = 1;
        touchBrakePressure = 1; // 混合输入以键盘口径为准
      } else if (touchBraking) {
        touchBrakePressure = advanceBrakePressure(touchBrakePressure, true, dt);
        sim.brakeTarget = touchBrakePressure;
        // 刹车重叠期收油：松油门+踩刹车在真实驾驶里是同一个连续动作
        sim.throttle = Math.max(0, sim.throttle - TOUCH_BRAKE.cut * dt);
      } else {
        touchBrakePressure = advanceBrakePressure(touchBrakePressure, false, dt);
        sim.brakeTarget = 0;
        if (held.has('up')) {
          sim.throttle = Math.min(1, sim.throttle + TRACK_RATE.throttle * dt);
        } else if (autoThrottle) {
          sim.throttle = Math.min(1, sim.throttle + TRACK_RATE.throttle * dt);
        } else {
          // 松开油门自然滑行：气动+滚阻真实减速（driving.js 口径），修复报障"车一直加速"
          sim.throttle = Math.max(0, sim.throttle - TRACK_RATE.throttle * 1.4 * dt);
        }
        if (held.has('up') || autoThrottle || sim.throttle > 0) ctrl.setThrottleUI(sim.throttle);
      }

      const speed = Math.abs(sim.speedKmh) / 3.6;
      const steerRate = TRACK_RATE.steerBase / (1 + speed * TRACK_RATE.steerDecay);
      if (held.has('left') !== held.has('right')) {
        // 方向契约（回归 tests/steering.test.js + smoke）：键盘【右】→ sim.steer=+1
        // → 转向解算角为负 → yaw 减小。追逐相机下 yaw 减小出现在屏幕右侧（three.js 投影
        // 已验证），即驾驶员视角的右转；【左】对称。展台模式映射不在此（保留历史行为）。
        const d = (held.has('right') ? 1 : -1) * steerRate * dt;
        sim.steer = Math.min(1, Math.max(-1, sim.steer + d));
      } else if (sim.steer !== 0) {
        // 松手自动回正（卡丁车转向轮有自回正力矩）
        const back = TRACK_RATE.center * dt;
        sim.steer = Math.abs(sim.steer) <= back ? 0 : sim.steer - Math.sign(sim.steer) * back;
      }
      ctrl.setSteerUI(sim.steer);
    },

    // 触屏/无头通道：HUD 按钮与 smoke 走同一套 held 集合（与键盘完全同路径）。
    // src：'key'（默认，瞬时全刹）| 'touch'（踏板行程）——只对刹车语义有区分。
    press(dir, on, src = 'key') {
      if (dir === 'drift') {
        sim.driftHeld = on;
        return;
      }
      const map = { left: 'left', right: 'right', brake: 'brake', up: 'up', down: 'down' };
      if (map[dir]) {
        if (on) {
          held.add(map[dir]);
          heldSrc.set(map[dir], src);
        } else {
          held.delete(map[dir]);
          heldSrc.delete(map[dir]);
        }
      }
    },
  };
}
