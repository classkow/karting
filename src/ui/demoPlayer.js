import { DEMO_SCRIPTS, validateDemoScript } from './demoScripts.js';

// ————— 演示序列播放器 —————
// 时间轴编排器：到点触发动作（视角/驾驶状态/举升/字幕），只写既有系统，自身不做任何机构解算。
// 手动介入（拖画布 / 驾驶键 / 拖滑条）即暂停；播完停在最后状态 2s 后自动复位（视角不强制切回）。

const PAUSE_NOTE = '演示已暂停（点击播放继续）';
const HOLD_AFTER_END = 2;   // 播完停在最后状态的秒数
const PAUSE_NOTE_MS = 2600; // 暂停提示显示时长

export function createDemoPlayer({ sim, rig, explode, ctrl, infoCard, caption }) {
  // 装载期结构自检：坏脚本剔除并告警，不炸主流程（单测另行独立断言脚本质量）
  const scripts = new Map();
  for (const s of DEMO_SCRIPTS) {
    const problems = validateDemoScript(s);
    if (problems.length) {
      console.warn('演示脚本结构问题，已跳过:', problems.join('；'));
      continue;
    }
    scripts.set(s.id, s);
  }

  let script = null;  // 当前装载脚本
  let state = 'idle'; // idle | playing | paused | holding（播完保持，倒计时后复位）
  let t = 0;          // 时间轴（秒）
  let next = 0;       // 下一个待触发动作下标（actions 按 t 升序）
  let holdLeft = 0;   // 播完保持倒计时

  const setCaption = (text) => caption?.set(text ?? null);

  function syncUI() {
    ctrl.setDemoUI({
      scriptId: script?.id ?? null,
      playing: state === 'playing' || state === 'holding',
      armed: state === 'paused',
    });
    ctrl.setDemoProgress(script ? Math.min(t / script.duration, 1) : 0);
  }

  // 动作语义：view=切视角（走 rig 现有补间，reduce-motion 用户由 rig 直切）；
  // steer/throttle/explode 写 sim 与爆炸目标并同步滑条 UI；jacking=开关举升演示；
  // scale=教学放大倍率；caption 缺省/null = 清空字幕。
  function fireAction(a) {
    if (a.view) rig.applyView(a.view);
    if (a.steer !== undefined) { sim.steer = a.steer; ctrl.setSteerUI(a.steer); }
    if (a.throttle !== undefined) { sim.throttle = a.throttle; ctrl.setThrottleUI(a.throttle); }
    if (a.explode !== undefined) { explode.setTarget(a.explode); ctrl.setExplodeUI(a.explode); }
    if (a.jacking !== undefined) {
      sim.jackingDemo = a.jacking;
      ctrl.setJackingUI(sim.jackingDemo === 1, sim.jackingScale);
    }
    if (a.scale !== undefined) {
      sim.jackingScale = a.scale;
      ctrl.setJackingUI(sim.jackingDemo === 1, sim.jackingScale);
    }
    setCaption('caption' in a ? a.caption : null);
  }

  // 结束/停止复位：steer/throttle 归零、爆炸归零、字幕清空；jacking 若被脚本打开则关闭。
  // 视角不强制切回；引擎不熄火（脚本可以怠速收尾，是否熄火留给用户）。
  function resetOutputs() {
    sim.steer = 0;
    ctrl.setSteerUI(0);
    sim.throttle = 0;
    ctrl.setThrottleUI(0);
    explode.setTarget(0);
    ctrl.setExplodeUI(0);
    if (sim.jackingDemo) {
      sim.jackingDemo = 0;
      ctrl.setJackingUI(false, sim.jackingScale);
    }
    setCaption(null);
  }

  function play() {
    if (!script || state === 'playing' || state === 'holding') return;
    if (t === 0) {
      if (script.autoStart) sim.startEngine(); // 点火类脚本：开播即起动，拖转 0.9s 后进入怠速
      infoCard?.show(null); // 收起信息卡，把画面让给字幕
    }
    state = 'playing';
    syncUI();
  }

  function pause() {
    if (state !== 'playing' && state !== 'holding') return;
    state = 'paused';
    caption?.note(PAUSE_NOTE, PAUSE_NOTE_MS);
    syncUI();
  }

  function load(id) {
    const s = scripts.get(id);
    if (!s) return;
    if (state !== 'idle') resetOutputs(); // 上一条可能改过驾驶状态/举升/爆炸
    script = s;
    state = 'idle';
    t = 0;
    next = 0;
    syncUI();
  }

  function stop() {
    resetOutputs();
    state = 'idle'; // 保留装载脚本以便重播
    t = 0;
    next = 0;
    syncUI();
  }

  function toggle() {
    if (state === 'playing' || state === 'holding') pause();
    else play();
  }

  // 手动介入入口（画布 pointerdown / 驾驶键 / 滑条）。非播放态为无操作。
  function interfere() {
    pause();
  }

  // 主循环每帧调用（app.frame 内、sim.step 之前）：推进时间轴并触发到期动作
  function update(dt) {
    if (!script) return;
    if (state === 'playing') {
      t += dt;
      const actions = script.actions;
      while (next < actions.length && actions[next].t <= t) fireAction(actions[next++]);
      ctrl.setDemoProgress(Math.min(t / script.duration, 1));
      if (t >= script.duration) {
        t = script.duration;
        state = 'holding';
        holdLeft = HOLD_AFTER_END;
      }
    } else if (state === 'holding') {
      holdLeft -= dt;
      if (holdLeft <= 0) {
        resetOutputs();
        state = 'idle';
        t = 0;
        next = 0;
        syncUI();
      }
    }
  }

  return {
    load,
    loadAndPlay: (id) => { load(id); play(); },
    play,
    pause,
    toggle,
    stop,
    interfere,
    update,
    get state() { return state; },
    get scriptId() { return script?.id ?? null; },
    get time() { return t; },
  };
}
