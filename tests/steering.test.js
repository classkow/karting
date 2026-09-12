import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initShortcuts } from '../src/interaction/shortcuts.js';
import { createSim } from '../src/sim/state.js';
import { createTrackModel } from '../src/sim/track.js';
import { createDrivingState, resetDrivingState, stepDriving } from '../src/sim/driving.js';

// ————— 赛道转向方向契约（回归用户报告：左右键反向）—————
// three.js 右手系 y 向上，追逐相机在车后朝前看时：
//   yaw 减小 → 前方目标偏向屏幕右侧（three.js Vector3.project 已验证 ndcX>0）
//   即驾驶员视角的右转。因此键盘【右】必须使 yaw 减小、【左】使 yaw 增大。
// 展台模式的历史映射（左→steer+1）不在此回归范围。

// 浏览器全局桩（shortcuts.js 只挂事件监听，不需要真实 DOM）
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { getElementById() { return null; }, body: {} };

function makeHarness() {
  const sim = createSim();
  sim.engineOn = true;
  sim.rpm = 6000;
  const noop = () => {};
  const keys = initShortcuts({
    sim,
    ctrl: new Proxy({}, { get: () => noop }),
    explode: { get: () => 0, setTarget: noop },
    rig: { applyView: noop },
    help: { toggle: noop, show: noop },
    infoCard: { show: noop },
    picking: { select: noop },
    trackApi: { isTrack: () => true, autoThrottle: () => false },
  });
  return { sim, keys };
}

test('转向契约：赛道模式按【左】→ sim.steer 向 −1 方向（前轮角为正 → yaw 增大）', () => {
  const { sim, keys } = makeHarness();
  keys.press('left', true);
  for (let i = 0; i < 30; i++) keys.update(1 / 60);
  assert.ok(sim.steer < -0.2, `按左 0.5s 后 steer=${sim.steer.toFixed(3)}（应为负）`);
  keys.press('left', false);
});

test('转向契约：赛道模式按【右】→ sim.steer 向 +1 方向（前轮角为负 → yaw 减小）', () => {
  const { sim, keys } = makeHarness();
  keys.press('right', true);
  for (let i = 0; i < 30; i++) keys.update(1 / 60);
  assert.ok(sim.steer > 0.2, `按右 0.5s 后 steer=${sim.steer.toFixed(3)}（应为正）`);
  keys.press('right', false);
});

test('转向契约：松手自动回正', () => {
  const { sim, keys } = makeHarness();
  keys.press('right', true);
  for (let i = 0; i < 30; i++) keys.update(1 / 60);
  keys.press('right', false);
  for (let i = 0; i < 60; i++) keys.update(1 / 60);
  assert.equal(sim.steer, 0, `松手 1s 后 steer=${sim.steer}`);
});

test('端到端：满舵右转（steerAngle<0）→ yaw 减小 = 追逐相机下的屏幕右转', () => {
  // 转向解算口径同 smoke（steer=1 → aL≈−0.30 / aR≈−0.19，阿克曼内轮角更大）
  const lab = createTrackModel({
    points: [[-80, -350], [0, -358], [80, -350], [86, -175], [86, 0], [86, 175], [80, 350], [0, 358], [-80, 350], [-86, 175], [-86, 0], [-86, -175]],
    width: 14,
  });
  const sim = createSim();
  sim.engineOn = true;
  sim.rpm = 6000;
  sim.throttle = 1;
  const st = createDrivingState();
  resetDrivingState(st, lab, 0);
  st.x = 86;
  st.z = -300;
  st.yaw = 0; // 朝 +z
  const tick = () => {
    sim.step(1 / 60);
    stepDriving(st, sim, lab, 1 / 60);
  };
  for (let i = 0; i < 60 * 4; i++) tick();
  assert.ok(st.speed > 10, `预设车速 ${st.speed.toFixed(1)}`);
  const yaw0 = st.yaw;
  sim.steer = 1; // 键盘【右】按满对应的输入
  sim.steerSmooth = 1;
  sim.steerAngleL = -0.3;
  sim.steerAngleR = -0.19;
  for (let i = 0; i < 60; i++) tick();
  assert.ok(st.yaw < yaw0 - 0.05, `yaw ${yaw0.toFixed(3)} → ${st.yaw.toFixed(3)}（应减小=屏幕右转）`);
});

test('端到端：满舵左转（steerAngle>0）→ yaw 增大 = 追逐相机下的屏幕左转', () => {
  const lab = createTrackModel({
    points: [[-80, -350], [0, -358], [80, -350], [86, -175], [86, 0], [86, 175], [80, 350], [0, 358], [-80, 350], [-86, 175], [-86, 0], [-86, -175]],
    width: 14,
  });
  const sim = createSim();
  sim.engineOn = true;
  sim.rpm = 6000;
  sim.throttle = 1;
  const st = createDrivingState();
  resetDrivingState(st, lab, 0);
  st.x = 86;
  st.z = -300;
  st.yaw = 0;
  const tick = () => {
    sim.step(1 / 60);
    stepDriving(st, sim, lab, 1 / 60);
  };
  for (let i = 0; i < 60 * 4; i++) tick();
  const yaw0 = st.yaw;
  sim.steer = -1; // 键盘【左】按满对应的输入
  sim.steerSmooth = -1;
  sim.steerAngleL = 0.3;
  sim.steerAngleR = 0.19;
  for (let i = 0; i < 60; i++) tick();
  assert.ok(st.yaw > yaw0 + 0.05, `yaw ${yaw0.toFixed(3)} → ${st.yaw.toFixed(3)}（应增大=屏幕左转）`);
});
