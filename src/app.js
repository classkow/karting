import * as THREE from 'three';
import { createStage } from './core/stage.js';
import { createPostFX } from './core/postfx.js';
import { updateEngineAudio } from './core/audio.js';
import { createFpsGuard } from './core/fpsGuard.js';
import { buildKart } from './kart/builder.js';
import { createRegistry } from './kart/registry.js';
import { createSim } from './sim/state.js';
import { initExplode } from './interaction/explode.js';
import { initPicking } from './interaction/picking.js';
import { initCameraRig } from './interaction/cameraRig.js';
import { initShortcuts } from './interaction/shortcuts.js';
import { initPartsPanel, initControlPanel, initInfoCard, initTooltip, initHelp, initPanelCollapse } from './ui/panels.js';

// ————— 应用装配与主循环 —————
// 依赖方向：app → { core, kart, sim, interaction, ui }；kart/sim 不依赖 interaction/ui。
export function createApp() {
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

  const registry = createRegistry();
  const sim = createSim();
  const kart = buildKart(registry);
  scene.add(kart);

  const explode = initExplode(registry);
  // ctrl 稍后创建（初始化顺序），用前置声明打破引用环
  let ctrl = null;
  const rig = initCameraRig(camera, controls, {
    onStopAutoRotate: () => ctrl?.setRotateUI(false),
  });

  // ————— UI —————
  const tooltip = initTooltip(document.getElementById('tooltip'));
  const partsPanel = initPartsPanel(document.getElementById('parts-panel'), registry, {
    onSelect(id) {
      picking.select(id);
      const p = registry.getPart(id);
      if (p) rig.flyTo(...focusTarget(p));
    },
    onFocus(id) {
      picking.select(id);
      const p = registry.getPart(id);
      if (p) rig.flyTo(...focusTarget(p));
    },
    onHover(id) {
      picking.setHoverExternal(id);
    },
    onToggleVis(id, visible) {
      const p = registry.getPart(id);
      if (p) {
        p.visible = visible;
        p.group.visible = visible;
      }
    },
  });

  const infoCard = initInfoCard(document.getElementById('info-card'), {
    onFocus(id) {
      partsPanel.setActive(id);
      const p = registry.getPart(id);
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

  ctrl = initControlPanel(document.getElementById('control-panel'), {
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
  initPanelCollapse();

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
    registry,
    hoverPass: fx?.hoverPass ?? noopPass,
    selectPass: fx?.selectPass ?? noopPass,
    onHover(id, x, y) {
      if (id) {
        const p = registry.getPart(id);
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

  initShortcuts({ sim, ctrl, explode, rig, help, infoCard, picking });

  // ————— FPS 统计与持续低帧率自动降级 —————
  const fpsGuard = createFpsGuard({
    onDegrade() {
      if (usePostfx) {
        usePostfx = false;
        prefs.quality = false;
        ctrl.setQualityUI(false);
      }
    },
  });

  // ————— 主循环 —————
  const clock = new THREE.Clock();
  let running = true;
  let wasRunning = false;
  let lastEngineState = -1;

  function frame(dt, rawDt = dt, render = true) {
    sim.step(dt);
    registry.runUpdates(dt, sim); // 各部件先写机构位姿（动态件写 mechPos）
    explode.update(dt);           // 再由爆炸模块统一落 position —— 动态件零帧滞后
    rig.update(dt);
    controls.update();

    ctrl.frame(sim.rpm, sim.speedKmh, sim.engineOn);

    const engineActive = sim.engineOn || sim.cranking > 0;
    if (engineActive !== wasRunning) {
      wasRunning = engineActive;
      chipEngine.classList.toggle('running', engineActive);
      chipEngine.querySelector('b').textContent = engineActive ? '引擎运转' : '引擎停止';
    }
    // setEngineUI 会重建按钮内 DOM（innerHTML），只在状态变化时调用，不做每帧 DOM churn；
    // 注意脏键要区分 熄火/拖转/运转 三态（拖转→点火 的迁移也要刷新按钮文案）
    const engineState = sim.cranking > 0 ? 1 : sim.engineOn ? 2 : 0;
    if (engineState !== lastEngineState) {
      lastEngineState = engineState;
      ctrl.setEngineUI(sim.engineOn, sim.cranking > 0);
    }

    updateEngineAudio({
      on: sim.engineOn,
      cranking: sim.cranking > 0,
      rpm: sim.rpm,
      throttle: sim.throttle,
      muted: !prefs.sound,
    });

    if (render) {
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
    }

    const fpsText = fpsGuard.frame(rawDt);
    if (fpsText) chipFps.textContent = fpsText;
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!running) return;
    const rawDt = clock.getDelta();
    frame(Math.min(rawDt, 0.05), rawDt);
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

  // 调试句柄（scripts/smoke.mjs 无头冒烟依赖此接口；
  // step 用于在无头/限帧环境下手动泵帧，确定性验证机构运动；render=false 时跳过渲染，纯步进飞快）
  return {
    sim,
    getPart: (id) => registry.getPart(id),
    registry,
    camera,
    controls,
    explode,
    step: (dt = 1 / 60, n = 1, render = false) => {
      for (let i = 0; i < n; i++) frame(dt, dt, render);
    },
  };
}
