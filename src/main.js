import * as THREE from 'three';
import { createStage } from './core/stage.js';
import { createPostFX } from './core/postfx.js';
import { updateEngineAudio } from './core/audio.js';
import { buildKart } from './kart/builder.js';
import { getPart, runUpdates } from './kart/registry.js';
import { createSim } from './sim/state.js';
import { initExplode } from './interaction/explode.js';
import { initPicking } from './interaction/picking.js';
import { initCameraRig, VIEWS } from './interaction/cameraRig.js';
import { initPartsPanel, initControlPanel, initInfoCard, initTooltip, initHelp } from './ui/panels.js';

// ————— 基础设施 —————
const canvas = document.getElementById('scene');

// localStorage 在 file:// 打开或严格隐私模式下可能抛异常，统一兜底
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
};
const prefs = {
  quality: storage.get('kart.quality') !== '0',
  sound: storage.get('kart.sound') === '1',
};

const stage = createStage(canvas);
const { renderer, scene, camera, controls } = stage;

// 后期链初始化失败（个别显卡/驱动不支持）时优雅降级为直接渲染
let fx = null;
try {
  fx = createPostFX(renderer, scene, camera, window.innerWidth, window.innerHeight);
} catch (e) {
  console.warn('后期处理链初始化失败，本次会话使用直接渲染：', e);
}
const noopPass = { selectedObjects: [] }; // 无后期链时的高亮占位
let usePostfx = false; // 控制面板初始化后按偏好确定

const sim = createSim();
const kart = buildKart();
scene.add(kart);

const explode = initExplode();
const rig = initCameraRig(camera, controls);

// ————— UI —————
const tooltip = initTooltip(document.getElementById('tooltip'));
const partsPanel = initPartsPanel(document.getElementById('parts-panel'), {
  onSelect(id) {
    picking.select(id);
    const p = getPart(id);
    if (p) rig.flyTo(...focusTarget(p));
  },
  onFocus(id) {
    picking.select(id);
    const p = getPart(id);
    if (p) rig.flyTo(...focusTarget(p));
  },
  onHover(id) {
    picking.setHoverExternal(id);
  },
  onToggleVis(id, visible) {
    const p = getPart(id);
    if (p) {
      p.visible = visible;
      p.group.visible = visible;
    }
  },
});

const infoCard = initInfoCard(document.getElementById('info-card'), {
  onFocus(id) {
    partsPanel.setActive(id);
    const p = getPart(id);
    if (p) rig.flyTo(...focusTarget(p));
  },
});

function focusTarget(part) {
  const box = new THREE.Box3().setFromObject(part.group);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.18);
  const dir = camera.position.clone().sub(controls.target).normalize();
  const pos = center.clone().add(dir.multiplyScalar(radius * 2.6 + 0.35));
  pos.y = Math.max(pos.y, 0.15);
  return [pos.toArray(), center.toArray(), 0.8];
}

const chipEngine = document.getElementById('chip-engine');
const chipFps = document.getElementById('chip-fps');

const ctrl = initControlPanel(document.getElementById('control-panel'), {
  onThrottle(v) {
    sim.throttle = v;
    ctrl.setThrottleUI(v);
  },
  onSteer(v) {
    sim.steer = v;
  },
  onBrake(v) {
    sim.brakeTarget = v;
  },
  onExplode(v) {
    explode.setTarget(v);
  },
  onEngine() {
    sim.toggleEngine();
  },
  onRotate() {
    controls.autoRotate = !controls.autoRotate;
    ctrl.setRotateUI(controls.autoRotate);
  },
  onQuality() {
    prefs.quality = !prefs.quality;
    storage.set('kart.quality', prefs.quality ? '1' : '0');
    usePostfx = prefs.quality && !!fx;
    ctrl.setQualityUI(prefs.quality);
  },
  onSound() {
    prefs.sound = !prefs.sound;
    storage.set('kart.sound', prefs.sound ? '1' : '0');
    ctrl.setSoundUI(prefs.sound);
  },
  onReset() {
    rig.applyView('home');
  },
  onView(name) {
    rig.applyView(name);
  },
  getRpm: () => sim.rpm,
});
usePostfx = prefs.quality && !!fx;
ctrl.setQualityUI(prefs.quality);
ctrl.setSoundUI(prefs.sound);
ctrl.setRotateUI(true);

const help = initHelp(document.getElementById('help-overlay'));
document.getElementById('btn-help').addEventListener('click', () => help.toggle());

// ————— 拾取 —————
const lastPointer = [0, 0];
canvas.addEventListener('pointermove', (e) => {
  lastPointer[0] = e.clientX;
  lastPointer[1] = e.clientY;
});

const picking = initPicking({
  canvas,
  camera,
  kartRoot: kart,
  hoverPass: fx?.hoverPass ?? noopPass,
  selectPass: fx?.selectPass ?? noopPass,
  onHover(id, x, y) {
    if (id) {
      const p = getPart(id);
      const sysColor = { chassis: '#e0564f', wheels: '#aeb8c6', steering: '#4cc2ff', engine: '#ffb547', drivetrain: '#c9a24b', brakes: '#ff5d5d', cockpit: '#8fd460' }[p.system] ?? '#888';
      tooltip.move(x ?? lastPointer[0], y ?? lastPointer[1], p.name, sysColor);
    } else {
      tooltip.hide();
    }
  },
  onSelect(part) {
    infoCard.show(part);
    partsPanel.setActive(part?.id ?? null);
  },
});

// 用户拖拽时停止自动环绕
canvas.addEventListener('pointerdown', () => {
  if (controls.autoRotate) {
    controls.autoRotate = false;
    ctrl.setRotateUI(false);
  }
});

// ————— 键盘 —————
const viewKeys = Object.keys(VIEWS);
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
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
    document.getElementById('help-overlay').classList.add('hidden');
  } else if (/^[1-8]$/.test(k)) {
    rig.applyView(viewKeys[+k - 1]);
  } else {
    handled = false;
  }
  if (handled) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === 'b') sim.brakeTarget = 0;
});

// ————— 主循环 —————
const clock = new THREE.Clock();
let running = true;
let wasRunning = false;
let fpsFrames = 0, fpsTime = 0;
let fpsTotalFrames = 0, fpsTotalTime = 0, fpsAutoChecked = false;

function loop() {
  requestAnimationFrame(loop);
  if (!running) return;

  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  sim.step(dt);
  explode.update(dt);
  runUpdates(dt, sim);
  rig.update(dt);
  controls.update();

  ctrl.frame(sim.rpm, sim.speedKmh, sim.engineOn);

  const engineActive = sim.engineOn || sim.cranking > 0;
  if (engineActive !== wasRunning) {
    wasRunning = engineActive;
    chipEngine.classList.toggle('running', engineActive);
    chipEngine.querySelector('b').textContent = engineActive ? '引擎运转' : '引擎停止';
  }
  ctrl.setEngineUI(sim.engineOn, sim.cranking > 0);

  updateEngineAudio({
    on: sim.engineOn,
    cranking: sim.cranking > 0,
    rpm: sim.rpm,
    throttle: sim.throttle,
    muted: !prefs.sound,
  });

  if (usePostfx) {
    try {
      fx.composer.render();
    } catch (e) {
      console.warn('后期渲染失败，本次会话余下时间改用直接渲染：', e);
      usePostfx = false;
      renderer.render(scene, camera);
    }
  } else {
    renderer.render(scene, camera);
  }

  // 帧率统计：跳过切后台恢复等造成的长帧，避免误判
  if (rawDt < 1) {
    fpsFrames++;
    fpsTime += rawDt;
    fpsTotalFrames++;
    fpsTotalTime += rawDt;
  }
  if (fpsTime >= 0.5) {
    chipFps.textContent = Math.round(fpsFrames / fpsTime) + ' FPS';
    fpsFrames = 0;
    fpsTime = 0;
  }
  // 持续低帧率（<24fps）时自动关闭后期链，保住交互流畅度（一次性）
  if (!fpsAutoChecked && fpsTotalTime >= 5) {
    fpsAutoChecked = true;
    if (usePostfx && fpsTotalFrames / fpsTotalTime < 24) {
      usePostfx = false;
      prefs.quality = false;
      storage.set('kart.quality', '0');
      ctrl.setQualityUI(false);
    }
  }
}

document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) clock.getDelta();
});

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  stage.setSize(w, h);
  fx?.setSize(w, h);
});

// ————— 开场：装配完成后推进镜头 —————
controls.autoRotate = true;
setTimeout(() => {
  rig.applyView('home', 1.3);
}, 250);

loop();

// 首帧渲染完成后揭开幕布
requestAnimationFrame(() => {
  setTimeout(() => document.getElementById('loader').classList.add('done'), 350);
});

// 调试句柄
window.__kart = { sim, getPart, camera, controls, explode };
