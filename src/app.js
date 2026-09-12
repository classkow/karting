import * as THREE from 'three';
import { createStage } from './core/stage.js';
import { createPostFX } from './core/postfx.js';
import { updateEngineAudio, disposeEngineAudio, updateDrivingAudio, disposeDrivingAudio, playCountBeep } from './core/audio.js';
import { createFpsGuard } from './core/fpsGuard.js';
import { buildKart } from './kart/builder.js';
import { createRegistry, systemMeta } from './kart/registry.js';
import { createSim } from './sim/state.js';
import { solveCycle as solveCycleModel } from './sim/cycle.js';
import { createTrackModel } from './sim/track.js';
import { createDrivingState, resetDrivingState, resetLapTiming, respawnOnTrack, stepDriving } from './sim/driving.js';
import { createAIController, createAIShell, stepAI } from './sim/ai.js';
import { createRaceEntrants, rankEntrants, finishEntrant, resolveKartCollisions, RACE_LAPS } from './sim/race.js';
import { buildTrackScene } from './core/trackScene.js';
import { initExplode } from './interaction/explode.js';
import { initPicking } from './interaction/picking.js';
import { initCameraRig } from './interaction/cameraRig.js';
import { initShortcuts } from './interaction/shortcuts.js';
import { initDriveCamera, DRIVE_CAMS } from './interaction/driveCamera.js';
import { initPartsPanel, initControlPanel, initInfoCard, initTooltip, initHelp, initPanelCollapse, initDemoCaption } from './ui/panels.js';
import { createDemoPlayer } from './ui/demoPlayer.js';
import { initTrackHUD } from './ui/hud.js';
import { initTrackMenu } from './ui/trackMenu.js';
import { buildAIVisual, createAIVisualAnimator, disposeAIVisual } from './kart/aiKarts.js';

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

  // ————— 赛道世界（惰性构建，进赛道才生成）—————
  const track = createTrackModel();
  const practiceDriving = createDrivingState(); // 练习模式（也是菜单/展台还原）用的驾驶状态
  let driving = practiceDriving; // 当前受控车的 driving 状态（比赛时切到发车格实例）
  let trackSceneObj = null;
  const driveCam = initDriveCamera(camera);
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  let race = null; // 比赛态：{ tier, entrants, playerE, racers[], raceTime, over }

  // 驾驶位姿更新器：注册序在所有部件更新器之后（buildKart 内各系统先跑），
  // 赛道模式下最后落位——机构位姿（转向/举升解）同帧生效，零帧滞后。
  const _poseEuler = new THREE.Euler();
  registry.addUpdate((dt, s) => {
    if (!s.drivingActive) return;
    kart.position.set(driving.x, 0, driving.z);
    kart.rotation.y = driving.yaw;
    // 簇载组姿态 = 真实举升解 + 动态侧倾/俯仰（stepDriving 已合成，jacking 更新器此时让位）
    _poseEuler.set(-driving.pitch, 0, -driving.roll);
    const sprung = kart.userData.sprung;
    sprung.quaternion.setFromEuler(_poseEuler);
    sprung.position.y = driving.heave ?? 0;
    // 前轮按地面速度滚动（后轮由 wheels 更新器按 s.wheelOmega 滚，半径不同分开口径）
    const wfl = registry.getPart('wheel-fl')?.group;
    const wfr = registry.getPart('wheel-fr')?.group;
    if (wfl) wfl.rotation.x += driving.wheelOmegaF * dt;
    if (wfr) wfr.rotation.x += driving.wheelOmegaF * dt;
  });

  const explode = initExplode(registry);
  // ctrl / demoPlayer 稍后创建（初始化顺序），用前置声明打破引用环
  let ctrl = null;
  let demoPlayer = null;
  const rig = initCameraRig(camera, controls, {
    onStopAutoRotate: () => ctrl?.setRotateUI(false),
    instantFly: reduceMotion,
  });

  // ————— 模式状态（展台 / 赛道）—————
  let mode = 'showroom';
  const countdown = { active: false, t: 0, lastShown: null };

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
  const btnTrack = document.getElementById('btn-track');

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

  // ————— 赛道 HUD —————
  const hud = initTrackHUD(document.getElementById('track-hud'), {
    track,
    storage,
    touch: isTouch,
    // onHold 必须经 options 传入：hud.js 的按钮处理器读的是解构参数，
    // 返回对象上事后补属性（旧写法）永远接不上 → 触屏按钮全灭（手机适配 P0 根因之一）
    onHold: (dir, on) => driveKeys.press(dir, on),
    onCamCycle() {
      hud.setCam(driveCam.cycle());
    },
    onExit: () => exitTrack(),
  });

  // ————— 赛道模式菜单（练习 / 比赛·三档）—————
  const menu = initTrackMenu(document.getElementById('track-menu'), {
    storage,
    onPractice: () => beginActivity('practice'),
    onRace: (tier) => beginActivity({ race: tier }),
    onExit: () => exitTrack(),
    onAgain: () => beginActivity({ race: race?.tier ?? 'elite' }),
  });

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

  const driveKeys = initShortcuts({
    sim, ctrl, explode, rig, help, infoCard, picking,
    trackApi: {
      isTrack: () => mode === 'track',
      onCamCycle: () => hud.setCam(driveCam.cycle()),
      onRespawn: () => {
        if (mode !== 'track' || menu.menuVisible) return;
        countdown.active = false;
        hud.setCountdown(null);
        // 比赛：原地救车（保进度）；练习：回起点重新发车
        if (race && !race.over) respawnOnTrack(driving, track);
        else resetDrivingState(driving, track, sim.time);
      },
      onExit: () => backOrExit(),
      autoThrottle: () => isTouch && hud.autoThrottle(), // 自动油门只属于触屏方案
    },
  });

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

  // ————— 模式切换：展台 ↔ 赛道 —————
  function enterTrack() {
    if (mode === 'track') return;
    try {
    mode = 'track';
    // 展台态全部收干净：演示/信息卡/爆炸/举升/慢放/环绕
    demoPlayer?.stop();
    infoCard.show(null);
    picking.select(null);
    picking.enabled = false;
    explode.setTarget(0);
    ctrl.setExplodeUI(0);
    sim.jackingDemo = 0;
    ctrl.setJackingUI(false, sim.jackingScale);
    if (sim.visualSlow !== 0.2) {
      sim.visualSlow = 0.2;
      ctrl.setCycleSlowUI(false);
    }
    controls.autoRotate = false;
    ctrl.setRotateUI(false);

    // 世界切换 + 车摆发车位，出模式菜单（练习 / 比赛三档由用户选）
    if (!trackSceneObj) trackSceneObj = buildTrackScene(track);
    scene.add(trackSceneObj);
    stage.setWorld('track');
    controls.enabled = false; // OrbitControls 停更（chase 相机接管相机）
    sim.drivingActive = true;
    resetDrivingState(driving, track, sim.time);
    kart.position.set(driving.x, 0, driving.z);
    kart.rotation.y = driving.yaw;
    driveCam.snap();
    hud.setCam(DRIVE_CAMS[0]);
    hud.setRaceInfo(null);
    document.getElementById('track-hud').classList.remove('hidden');
    document.body.classList.add('track-mode');
    btnTrack.textContent = '← 返回展台';
    countdown.active = false;
    menu.showMenu();
    } catch (e) {
      // 真机上若建世界/切世界抛错（GPU/纹理限制等），给出可截图的错误卡而不是无声冻结
      console.error('进入赛道失败:', e);
      menu.showError(`enterTrack: ${e?.message ?? e}`);
    }
  }

  function exitTrack() {
    if (mode !== 'track') return;
    mode = 'showroom';
    countdown.active = false;
    hud.setCountdown(null);
    menu.hide();
    cleanupRace();
    hud.setRaceInfo(null);
    sim.drivingActive = false;
    updateDrivingAudio({ active: false });
    // 驾驶输入与车辆状态归零
    sim.throttle = 0;
    sim.steer = 0;
    sim.brakeTarget = 0;
    sim.driftHeld = false;
    ctrl.setThrottleUI(0);
    ctrl.setSteerUI(0);
    ctrl.setBrakeUI(0);
    // 世界与相机还原
    scene.remove(trackSceneObj);
    stage.setWorld('showroom');
    controls.enabled = true;
    kart.position.set(0, 0.02, 0);
    kart.rotation.y = 0;
    document.getElementById('track-hud').classList.add('hidden');
    document.body.classList.remove('track-mode');
    btnTrack.textContent = '🏁 上赛道';
    picking.enabled = true;
    // 追逐相机会改 FOV（速度感），退出时还原展台口径（stage 初始 40）
    camera.fov = 40;
    camera.updateProjectionMatrix();
    rig.applyView('home', 1.1);
  }

  // ————— 活动（练习 / 比赛）生命周期 —————
  function cleanupRace() {
    if (!race) return;
    for (const r of race.racers) {
      scene.remove(r.visual);
      disposeAIVisual(r.visual);
    }
    race = null;
    hud.setRaceInfo(null);
  }

  function beginActivity(mode) {
    menu.hide();
    countdown.active = false;
    cleanupRace();
    hud.setCountdown(null);
    if (mode === 'practice') {
      // 练习：单车从起点线发车，圈时从 GO 起算
      cleanupRace();
      driving = practiceDriving;
      resetDrivingState(driving, track, sim.time);
      kart.position.set(driving.x, 0, driving.z);
      kart.rotation.y = driving.yaw;
    } else {
      // 比赛：玩家 + 3 名同档 AI，双排发车格，玩家末位（P4）
      const tier = mode.race;
      storage.set('kart.raceTier', tier);
      const entrants = createRaceEntrants(
        tier,
        track,
        (color, number) => buildAIVisual(kart, { color, number }),
      );
      race = {
        tier,
        entrants,
        playerE: entrants[0],
        racers: [],
        raceTime: 0,
        over: false,
      };
      for (let i = 1; i < entrants.length; i++) {
        const e = entrants[i];
        const visual = e.visual; // race.js 经工厂回调创建并挂在 entrant 上
        scene.add(visual);
        race.racers.push({
          e,
          shell: createAIShell(),
          ai: createAIController(e.tier, i),
          visual,
          animator: createAIVisualAnimator(visual),
        });
      }
      driving = entrants[0].st; // 受控车切到玩家发车格实例
      kart.position.set(driving.x, 0, driving.z);
      kart.rotation.y = driving.yaw;
      for (const r of race.racers) r.animator.update(r.e.st, r.shell);
      sim.throttle = 0;
      sim.brakeTarget = 0;
    }
    driveCam.snap();
    startCountdown();
  }

  // Esc：菜单开着 = 退出赛道；否则（练习/比赛进行中）= 弃赛回菜单
  function backOrExit() {
    if (menu.menuVisible) {
      exitTrack();
      return;
    }
    cleanupRace();
    driving = practiceDriving;
    resetDrivingState(driving, track, sim.time);
    kart.position.set(driving.x, 0, driving.z);
    kart.rotation.y = driving.yaw;
    hud.setRaceInfo(null);
    driveCam.snap();
    menu.showMenu();
  }

  function startCountdown() {
    countdown.active = true;
    countdown.t = 3.7;
    countdown.lastShown = null;
  }

  btnTrack.addEventListener('click', () => (mode === 'track' ? exitTrack() : enterTrack()));

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
    driveKeys.update(dt); // 长按 W/S/A/D 的持续输入（双模式语义）
    demoPlayer.update(dt); // 演示时间轴先推进：动作写入 sim 后同帧参与解算
    sim.step(dt);

    let raceOthers = null; // 比赛 AI 的小地图位置（随帧传给 HUD）
    if (sim.drivingActive) {
      // ——— 赛道模式分支：倒计时 → 动力学 → 比赛推进 → 驾驶音效/相机/HUD ———
      const menuOpen = menu.visible;
      const trackLocked = countdown.active || menuOpen || (race && race.over);

      if (countdown.active) {
        countdown.t -= dt;
        const shown = countdown.t > 0.6 ? Math.min(3, Math.ceil(countdown.t - 0.6)) : 'go';
        if (shown !== countdown.lastShown) {
          countdown.lastShown = shown;
          if (shown === 'go') {
            playCountBeep(true);
            if (!sim.engineOn && sim.cranking <= 0) sim.startEngine(); // 忘了点火也照常发车
            if (race) {
              for (const e of race.entrants) resetLapTiming(e.st, sim.time, track); // 发车格已摆好，只重置计时
            } else {
              resetDrivingState(driving, track, sim.time); // 练习：圈时从 GO 起算
            }
            hud.setCountdown('go');
          } else {
            playCountBeep(false);
            hud.setCountdown(shown);
          }
        }
        if (countdown.t <= 0.15) {
          countdown.active = false;
          hud.setCountdown(null);
        }
      }

      stepDriving(driving, sim, track, dt, { launchLock: trackLocked });

      // ——— 比赛推进：AI 决策/物理 → 车间碰撞 → 完赛判定 → 排名 ———
      if (race && !menuOpen) {
        if (!countdown.active && !race.over) race.raceTime += dt;
        for (const r of race.racers) {
          stepAI(r.ai, r.e.st, r.shell, track, dt, { launchLock: countdown.active });
          if (r.ai.wantReset) respawnOnTrack(r.e.st, track); // 卡死自救（保进度）
          stepDriving(r.e.st, r.shell, track, dt, { launchLock: countdown.active });
          r.animator.update(r.e.st, r.shell);
          if (!r.e.finished && r.e.st.lap >= RACE_LAPS) {
            finishEntrant(race.entrants, r.e, race.raceTime);
          }
        }
        resolveKartCollisions(race.entrants.map((e) => e.st));
        // 玩家冲线 → 结算面板（AI 继续在背景里跑完）
        if (!race.over && driving.lap >= RACE_LAPS) {
          finishEntrant(race.entrants, race.playerE, race.raceTime);
          race.over = true;
          sim.throttle = 0;
          ctrl.setThrottleUI(0);
          const ranked = rankEntrants(race.entrants);
          menu.showResults(ranked.map((e) => ({
            name: e.name,
            isPlayer: e.isPlayer,
            finished: e.finished,
            finishTime: e.finishTime,
            lapTimeMs: e.st.bestLapMs,
          })), { tier: race.tier });
        }
        // 位次只在 GO 后更新：倒计时里 total 全为网格基准的瞬态（静止蠕动 ±1cm），
        // 显示出来是随机名次，误导（GO 时 resetLapTiming 会给出真实网格基准）
        if (!countdown.active) {
          const rankedNow = rankEntrants(race.entrants);
          hud.setRaceInfo({
            pos: rankedNow.indexOf(race.playerE) + 1,
            total: race.entrants.length,
            laps: RACE_LAPS,
          });
        }
      }

      updateDrivingAudio({
        active: prefs.sound,
        screech01: driving.slip01,
        kerb01: driving.onKerb,
        grass01: driving.onGrass,
        speed01: Math.min(1, driving.speed / 38),
      });
      if (race) raceOthers = race.racers.map((r) => ({ x: r.e.st.x, z: r.e.st.z }));
    }

    registry.runUpdates(dt, sim); // 各部件先写机构位姿（动态件写 mechPos；驾驶位姿更新器最后落位）
    explode.update(dt);           // 再由爆炸模块统一落 position —— 动态件零帧滞后

    if (sim.drivingActive) {
      driveCam.update(dt, kart, driving);
      stage.followKey(kart.position); // 主光阴影相机跟车
      hud.frame(sim, driving, dt, raceOthers);
    } else {
      rig.update(dt);
      controls.update();
    }

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
  window.addEventListener('pagehide', () => {
    disposeEngineAudio();
    disposeDrivingAudio();
  });

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
    track,
    get driving() { return driving; }, // 比赛模式会切到发车格实例，必须动态取（P2-2）
    driveKeys,
    enterTrack,
    exitTrack,
    menu,
    get race() { return race; },
    get mode() { return mode; },
    step: (dt = 1 / 60, n = 1, render = false) => {
      for (let i = 0; i < n; i++) frame(dt, dt, render);
    },
  };
}
