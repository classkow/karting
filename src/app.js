import * as THREE from 'three';
import { createStage } from './core/stage.js';
import { createPostFX } from './core/postfx.js';
import { updateEngineAudio, disposeEngineAudio } from './core/audio.js';
import { createFpsGuard } from './core/fpsGuard.js';
import { buildKart } from './kart/builder.js';
import { createRegistry, systemMeta } from './kart/registry.js';
import { createSim } from './sim/state.js';
import { solveCycle as solveCycleModel } from './sim/cycle.js';
import { initExplode } from './interaction/explode.js';
import { initPicking } from './interaction/picking.js';
import { initCameraRig } from './interaction/cameraRig.js';
import { initShortcuts } from './interaction/shortcuts.js';
import { initPartsPanel, initControlPanel, initInfoCard, initTooltip, initHelp, initPanelCollapse, initDemoCaption } from './ui/panels.js';
import { createDemoPlayer } from './ui/demoPlayer.js';

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

  // 动效敏感用户：默认不自动环绕，相机切换改为直切（无补间）
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const registry = createRegistry();
  const sim = createSim();
  const kart = buildKart(registry);
  scene.add(kart);

  const explode = initExplode(registry);
  // ctrl / demoPlayer 稍后创建（初始化顺序），用前置声明打破引用环
  let ctrl = null;
  let demoPlayer = null;
  const rig = initCameraRig(camera, controls, {
    onStopAutoRotate: () => ctrl?.setRotateUI(false),
    instantFly: reduceMotion,
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
    // 滑条是用户输入通道：拖动任一滑条 = 演示播放中的手动介入 → 暂停
    onThrottle(v) {
      demoPlayer?.interfere();
      sim.throttle = v;
      ctrl.setThrottleUI(v);
    },
    onSteer(v) {
      demoPlayer?.interfere();
      sim.steer = v;
    },
    onBrake(v) {
      demoPlayer?.interfere();
      sim.brakeTarget = v;
    },
    onExplode(v) {
      demoPlayer?.interfere();
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
    onJacking() {
      sim.jackingDemo = sim.jackingDemo ? 0 : 1;
      ctrl.setJackingUI(sim.jackingDemo === 1, sim.jackingScale);
      if (sim.jackingDemo) rig.applyView('jacking'); // 关闭时不强制切回视角
    },
    onJackingScale() {
      const seq = [1, 4, 8];
      sim.jackingScale = seq[(seq.indexOf(sim.jackingScale) + 1) % seq.length];
      ctrl.setJackingUI(sim.jackingDemo === 1, sim.jackingScale);
    },
    onCycleSlow() {
      sim.visualSlow = sim.visualSlow === 0.004 ? 0.2 : 0.004;
      ctrl.setCycleSlowUI(sim.visualSlow === 0.004);
    },
    onDemoChip(id) {
      demoPlayer?.loadAndPlay(id); // 点 chip = 装载并立即开播（会自己讲的展台）
    },
    onDemoToggle() {
      demoPlayer?.toggle();
    },
    getRpm: () => sim.rpm,
  });
  usePostfx = prefs.quality && !!fx;
  ctrl.setQualityUI(prefs.quality);
  ctrl.setSoundUI(prefs.sound);
  ctrl.setRotateUI(!reduceMotion);

  const help = initHelp(document.getElementById('help-overlay'));
  document.getElementById('btn-help').addEventListener('click', () => help.toggle());
  initPanelCollapse();

  // ————— 演示播放器（字幕浮层独立于面板，小屏折叠时仍可见）—————
  demoPlayer = createDemoPlayer({
    sim,
    rig,
    explode,
    ctrl,
    infoCard,
    caption: initDemoCaption(),
  });

  // ————— 拾取 —————
  const lastPointer = [0, 0];
  canvas.addEventListener('pointermove', (e) => {
    lastPointer[0] = e.clientX;
    lastPointer[1] = e.clientY;
  });

  const picking = initPicking({    canvas,
    camera,
    kartRoot: kart,
    registry,
    hoverPass: fx?.hoverPass ?? noopPass,
    selectPass: fx?.selectPass ?? noopPass,
    onHover(id, x, y) {
      if (id) {
        const p = registry.getPart(id);
        tooltip.move(x ?? lastPointer[0], y ?? lastPointer[1], p.name, systemMeta(p.system).color);
      } else {
        tooltip.hide();
      }
    },
    onSelect(part) {
      infoCard.show(part);
      partsPanel.setActive(part?.id ?? null);
    },
  });

  // 用户拖拽时停止自动环绕；演示播放中拖画布 = 手动介入 → 暂停
  canvas.addEventListener('pointerdown', () => {
    demoPlayer?.interfere();
    if (controls.autoRotate) {
      controls.autoRotate = false;
      ctrl.setRotateUI(false);
    }
  });

  const driveKeys = initShortcuts({ sim, ctrl, explode, rig, help, infoCard, picking });

  // 演示播放中按任意驾驶键 = 手动介入 → 暂停（旁观监听，不改动 shortcuts.js 的输入处理）
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'b'
      || k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') {
      demoPlayer?.interfere();
    }
  });

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
  let lastJackReadout = 0; // 举升读数节流（100ms）
  let lastSteerReadout = 0; // 内外轮转角读数节流（100ms）
  let lastCycleReadout = 0; // 换气循环读数节流（100ms）
  let lastPvRender = 0; // P-V 稳态环重算节流（250ms，§7.3）
  let lastPvKey = ''; // P-V 分桶键（250rpm × 5% 油门）
  const pvCache = new Map();
  let steerWasCentered = true; // 上一帧是否回中（回中沿立即刷一次"—"，避免残留旧角度）

  function frame(dt, rawDt = dt, render = true) {
    driveKeys.update(dt); // 长按 W/S/A/D 的持续输入
    demoPlayer.update(dt); // 演示时间轴先推进：动作写入 sim 后同帧参与解算
    sim.step(dt);
    registry.runUpdates(dt, sim); // 各部件先写机构位姿（动态件写 mechPos）
    explode.update(dt);           // 再由爆炸模块统一落 position —— 动态件零帧滞后
    rig.update(dt);
    controls.update();

    ctrl.frame(sim.rpm, sim.speedKmh, sim.engineOn);

    // 举升读数：每帧解算、100ms 节流刷 DOM（真实值，不乘教学放大系数）
    if (sim.jackingDemo && sim.time - lastJackReadout > 0.1) {
      lastJackReadout = sim.time;
      ctrl.setJackingLift(sim.jackingLiftMM);
    }

    // 换气循环读数：直读 sim.cycle 解算值，100ms 节流刷 DOM（无系数）
    if (sim.time - lastCycleReadout > 0.1) {
      lastCycleReadout = sim.time;
      ctrl.setCycleReadouts(sim.cycle.readouts());
    }

    // 正时圆盘指针 + P-V 活动点：每帧一次 setAttribute（直读模型状态）
    ctrl.setCycleNeedle(sim.cycle.thetaDeg());
    const [pvV, pvP] = sim.cycle.pvPoint();
    ctrl.setPVDot(pvV, pvP);

    // P-V 稳态环：分桶缓存（250rpm × 5% 油门）+ 250ms 节流重算（§7.3）
    {
      const pvKey = Math.max(400, Math.round(sim.rpm / 250) * 250) + '|' + Math.round(sim.throttle * 20) / 20;
      if (pvKey !== lastPvKey && sim.time - lastPvRender > 0.25) {
        lastPvRender = sim.time;
        lastPvKey = pvKey;
        if (!pvCache.has(pvKey)) {
          if (pvCache.size > 40) pvCache.clear(); // 防桶无限增长
          pvCache.set(pvKey, solveCycleModel(Math.max(400, Math.round(sim.rpm / 250) * 250), Math.round(sim.throttle * 20) / 20));
        }
        const solved = pvCache.get(pvKey);
        ctrl.setPVLoop(solved.loop, solved.peakBar);
      }
    }

    // 内外轮转角读数（阿克曼）：直读左右前轮解算角，100ms 节流刷 DOM；
    // |steerSmooth|<0.01 判回中。内轮=|角度|大者，差 = 内 − 外（恒 ≥0）。
    const steerCentered = Math.abs(sim.steerSmooth) < 0.01;
    if (steerCentered !== steerWasCentered || (!steerCentered && sim.time - lastSteerReadout > 0.1)) {
      steerWasCentered = steerCentered;
      lastSteerReadout = sim.time;
      if (steerCentered) {
        ctrl.setSteerAngles();
      } else {
        const aL = (sim.steerAngleL * 180) / Math.PI;
        const aR = (sim.steerAngleR * 180) / Math.PI;
        const inner = Math.max(Math.abs(aL), Math.abs(aR));
        const outer = Math.min(Math.abs(aL), Math.abs(aR));
        ctrl.setSteerAngles(inner, outer, inner - outer);
      }
    }

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

  // 卸载/进 bfcache 时释放音频资源；从 bfcache 恢复后 ctx/nodes 为空，会自动重建
  window.addEventListener('pagehide', disposeEngineAudio);

  // ————— WebGL 上下文丢失恢复 —————
  // 驱动重置 / GPU 进程崩溃 / 移动端后台回收：不停主循环会持续报错并黑屏，
  // 停下来弹遮罩给用户一条可操作的恢复路径。丢失期间丢掉累积 dt，恢复后不跳帧。
  const glLostOverlay = document.getElementById('gl-lost');
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // 允许之后触发 webglcontextrestored
    running = false;
    glLostOverlay.classList.remove('hidden');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    clock.getDelta(); // 丢弃中断期 dt，恢复瞬间不快进
    running = true;
    glLostOverlay.classList.add('hidden');
  });
  document.getElementById('gl-restore').addEventListener('click', () => {
    renderer.forceContextRestore();
  });

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    stage.setSize(w, h);
    fx?.setSize(w, h);
  });

  // ————— 开场：装配完成后推进镜头（reduce-motion 用户已在初始位姿，跳过）—————
  controls.autoRotate = !reduceMotion;
  if (!reduceMotion) {
    setTimeout(() => {
      rig.applyView('home', 1.3);
    }, 250);
  }

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
    demoPlayer,
    step: (dt = 1 / 60, n = 1, render = false) => {
      for (let i = 0; i < n; i++) frame(dt, dt, render);
    },
  };
}
