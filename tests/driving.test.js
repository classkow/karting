import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackModel } from '../src/sim/track.js';
import {
  createDrivingState, resetDrivingState, stepDriving,
  engineTorque, PHYS,
} from '../src/sim/driving.js';
import { createSim, CLUTCH_ENGAGE_RPM } from '../src/sim/state.js';

// 正式赛道：计圈 / 发车 / 软墙 / 草地等"世界耦合"行为
const track = createTrackModel();
// 试验赛道：700m 直道的大椭圆——纵向与转向物理不受弯道撞墙干扰
const OVAL = [
  [-80, -350], [0, -358], [80, -350],
  [86, -175], [86, 0], [86, 175],
  [80, 350], [0, 358], [-80, 350],
  [-86, 175], [-86, 0], [-86, -175],
];
const lab = createTrackModel({ points: OVAL, width: 14 });

function scene({ steer = 0, time = 10, trackModel = track } = {}) {
  const sim = createSim();
  sim.engineOn = true;
  sim.rpm = CLUTCH_ENGAGE_RPM + 300;
  sim.throttle = 1;
  sim.steer = steer;
  sim.steerSmooth = steer;
  sim.steerAngleL = steer * -0.3;
  sim.steerAngleR = steer * -0.26; // 左右略不同 = 阿克曼
  sim.time = time;
  const st = createDrivingState();
  resetDrivingState(st, trackModel, sim.time);
  return { sim, st, trackModel };
}

// 真实帧序：sim.step（状态机）→ stepDriving（动力学），与 app.frame 一致
function tick(sc, dt = 1 / 60, opts = {}) {
  sc.sim.step(dt);
  stepDriving(sc.st, sc.sim, sc.trackModel, dt, opts);
}

test('发动机外特性：峰值 ≈27.5Nm@9500，断油衰减，低转速起步扭矩可用', () => {
  assert.ok(Math.abs(engineTorque(9500) - 27.5) < 0.2);
  assert.ok(engineTorque(3000) > 10 && engineTorque(3000) < 20, `3000rpm=${engineTorque(3000).toFixed(1)}`);
  assert.ok(engineTorque(13800) < engineTorque(11000), '断油区扭矩必须回落');
  assert.equal(engineTorque(0), 0);
});

test('静置不给油：离合器分离，车不动', () => {
  const sc = scene({});
  sc.sim.throttle = 0;
  sc.sim.rpm = 1800; // 怠速
  for (let i = 0; i < 120; i++) tick(sc);
  assert.equal(sc.st.speed, 0);
  assert.equal(sc.st.x, track.startPose.x);
  assert.equal(sc.st.z, track.startPose.z);
});

test('满油起步：加速前进，转速被负载压住（起步喘振）后随车速爬升', () => {
  const sc = scene({});
  for (let i = 0; i < 30; i++) tick(sc); // 0.5s：仍在打滑区
  assert.ok(sc.sim.rpm < 4300 && sc.sim.rpm > CLUTCH_ENGAGE_RPM * 0.85,
    `打滑期显示转速 ${sc.sim.rpm.toFixed(0)}（应被压在接合带附近，远离自由加速的 13800）`);
  assert.ok(sc.st.speed > 1.5, `0.5s 车速 ${sc.st.speed.toFixed(2)} m/s`);
  for (let i = 0; i < 60 * 3; i++) tick(sc);
  assert.ok(sc.st.speed > 8, `3 秒后车速 ${sc.st.speed.toFixed(1)} m/s`);
  assert.ok(sc.sim.speedKmh > 25, `speedKmh=${sc.sim.speedKmh.toFixed(1)}`);
  // 车速起来后离合锁止，显示转速 = 后轮折算转速（直驱口径）
  const expectRpm = (sc.st.vz / (2 * Math.PI * PHYS.wheelRear)) * 60 * PHYS.gear;
  assert.ok(Math.abs(sc.sim.rpm - expectRpm) < expectRpm * 0.02,
    `锁止后 rpm ${sc.sim.rpm.toFixed(0)} vs 轮速折算 ${expectRpm.toFixed(0)}`);
});

test('直道极速有物理上界（90–140km/h，125cc 直驱口径）', () => {
  const sc = scene({ trackModel: lab });
  let vMax = 0;
  for (let i = 0; i < 60 * 30; i++) {
    tick(sc);
    vMax = Math.max(vMax, sc.st.speed);
  }
  const kmh = vMax * 3.6;
  assert.ok(kmh > 90 && kmh < 140, `极速 ${kmh.toFixed(1)} km/h`);
});

test('转向方向：sim.steer=+1 → 前轮角为负 → yaw 减小（追逐相机下即屏幕右转）', () => {
  const sc = scene({ trackModel: lab });
  for (let i = 0; i < 60 * 3; i++) tick(sc); // 先直线加速
  const yaw0 = sc.st.yaw;
  sc.sim.steer = 1;
  sc.sim.steerSmooth = 1;
  sc.sim.steerAngleL = -0.3;
  sc.sim.steerAngleR = -0.26;
  for (let i = 0; i < 60; i++) tick(sc);
  assert.ok(sc.st.yaw < yaw0 - 0.05, `yaw ${yaw0.toFixed(3)} → ${sc.st.yaw.toFixed(3)}`);
});

test('高速 vs 低速同舵：高速转弯半径显著更大（轮胎饱和 → 转向不足/甩尾边界）', () => {
  // 低速：2s 加速到 ≈7m/s，满舵 0.6s —— 接近运动学转弯半径
  const slow = scene({ trackModel: lab });
  for (let i = 0; i < 60 * 2; i++) tick(slow);
  slow.sim.steer = 1;
  slow.sim.steerSmooth = 1;
  slow.sim.steerAngleL = -0.3;
  slow.sim.steerAngleR = -0.26;
  for (let i = 0; i < 60 * 0.6; i++) tick(slow);
  const rSlow = Math.abs(slow.st.speed / slow.st.yawRate);

  // 高速：8s 加速到 ≈25m/s+，同样满舵 0.3s —— 瞬时横摆远小于低速比例
  const fast = scene({ trackModel: lab });
  for (let i = 0; i < 60 * 8; i++) tick(fast);
  assert.ok(fast.st.speed > 22, `预设车速 ${fast.st.speed.toFixed(1)}`);
  fast.sim.steer = 1;
  fast.sim.steerSmooth = 1;
  fast.sim.steerAngleL = -0.3;
  fast.sim.steerAngleR = -0.26;
  for (let i = 0; i < 60 * 0.3; i++) tick(fast);
  const rFast = Math.abs(fast.st.speed / fast.st.yawRate);
  assert.ok(rFast > rSlow * 2.5, `转弯半径 高速 ${rFast.toFixed(1)}m vs 低速 ${rSlow.toFixed(1)}m`);
});

test('制动：峰值减速度不超过单后碟物理上限（≈0.75g）', () => {
  const sc = scene({ trackModel: lab });
  for (let i = 0; i < 60 * 12; i++) tick(sc);
  sc.sim.throttle = 0;
  sc.sim.brakeTarget = 1;
  sc.sim.brake = 1;
  let aMax = 0;
  let vPrev = sc.st.speed;
  for (let i = 0; i < 60 * 4 && sc.st.speed > 0.3; i++) {
    tick(sc);
    aMax = Math.max(aMax, (vPrev - sc.st.speed) / (1 / 60));
    vPrev = sc.st.speed;
  }
  const decelG = aMax / 9.81;
  assert.ok(decelG > 0.2 && decelG <= 0.78, `峰值减速度 ${decelG.toFixed(2)}g`);
});

test('漂移：Shift 按下后轮附着下降（同工况横摆率放大）', () => {
  const mk = () => {
    const sc = scene({ trackModel: lab });
    for (let i = 0; i < 60 * 3; i++) tick(sc); // 直线加速到 ≈10m/s
    sc.sim.steer = 0.35;
    sc.sim.steerSmooth = 0.35;
    sc.sim.steerAngleL = -0.105;
    sc.sim.steerAngleR = -0.091;
    return sc;
  };
  const a = mk();
  const b = mk();
  b.sim.driftHeld = true;
  for (let i = 0; i < 60; i++) {
    tick(a);
    tick(b);
  }
  assert.ok(b.st.drifting, '中速带舵按 Shift 应进入漂移态');
  assert.ok(Math.abs(b.st.yawRate) > Math.abs(a.st.yawRate) * 1.15,
    `漂移 yawRate ${b.st.yawRate.toFixed(2)} vs 正常 ${a.st.yawRate.toFixed(2)}`);
});

test('倒计时锁止：轰油门不走车', () => {
  const sc = scene({});
  sc.sim.throttle = 1;
  for (let i = 0; i < 60 * 2; i++) tick(sc, 1 / 60, { launchLock: true });
  assert.equal(sc.st.speed, 0);
});

test('草地惩罚：冲出路面后显著减速并被压到草地平衡速（≈45km/h）', () => {
  const sc = scene({ trackModel: lab });
  // 摆到右侧直道末端起步，12s 全油门拉到 ≈37m/s（仍在 700m 直道内）
  sc.st.x = 86;
  sc.st.z = -300;
  sc.st.yaw = 0;
  for (let i = 0; i < 60 * 12; i++) tick(sc);
  assert.ok(sc.st.speed > 33, `预设车速 ${sc.st.speed.toFixed(1)}`);
  // 强行把车平移到中心线外 9.5m（试验赛道半宽 7m，草地缓冲区内、软墙 12m 之前）
  const sp = lab.samples[sc.st.hintIdx];
  sc.st.x += sp.tz * 9.5;
  sc.st.z += -sp.tx * 9.5;
  const v0 = sc.st.speed;
  for (let i = 0; i < 60 * 8; i++) tick(sc);
  assert.ok(sc.st.onGrass > 0.8, `onGrass=${sc.st.onGrass.toFixed(2)}`);
  assert.ok(sc.st.speed < 17 && sc.st.speed < v0 * 0.5,
    `草地 8s：${v0.toFixed(1)} → ${sc.st.speed.toFixed(1)} m/s（沿收敛曲线趋向草地平衡速 ≈12.7m/s）`);
});

test('软墙：横向冲不出中心线外 margin+2m', () => {
  const sc = scene({});
  for (let i = 0; i < 60 * 6; i++) tick(sc);
  const sp = track.samples[sc.st.hintIdx];
  sc.st.x += sp.tz * 30; // 甩到很远
  sc.st.z += -sp.tx * 30;
  for (let i = 0; i < 60 * 3; i++) tick(sc);
  const n = track.nearest(sc.st.x, sc.st.z, -1);
  assert.ok(Math.abs(n.lat) < track.halfWidth + PHYS.wallMargin + 2,
    `lat=${n.lat.toFixed(2)} 上限=${(track.halfWidth + PHYS.wallMargin + 2).toFixed(2)}`);
});

test('遥测：wheelOmega 与真实车速一致（地面滚动口径），姿态目标有界', () => {
  const sc = scene({ trackModel: lab });
  for (let i = 0; i < 60 * 6; i++) tick(sc);
  const expectOmega = Math.min(sc.st.vz / PHYS.wheelRear, PHYS.visualCap);
  assert.ok(Math.abs(sc.sim.wheelOmega - expectOmega) < 1e-6,
    `wheelOmega=${sc.sim.wheelOmega.toFixed(2)} 期望=${expectOmega.toFixed(2)}`);
  assert.ok(Math.abs(sc.st.roll) < 0.1 && Math.abs(sc.st.pitch) < 0.06);
});

test('计圈：沿赛道推进一整圈 → lap+1、圈时合理', () => {
  const sc = scene({});
  // 沿中心线拖车（每帧按 15m/s 前进，时间由 sim.step 自然流动）。
  // s=0 即起点线（track.js 已旋转），多走几步越过线让 wrap 计圈发生。
  let s = track.startPose.s;
  for (let i = 0; i < Math.ceil(track.length / 0.25) + 6; i++) {
    const p = track.pointAt(s);
    sc.st.x = p.x;
    sc.st.z = p.z;
    sc.st.yaw = p.yaw;
    sc.st.vx = 0;
    sc.st.vz = 15;
    tick(sc);
    s = track.wrapS(s + 0.25);
  }
  assert.equal(sc.st.lap, 1, `lap=${sc.st.lap}`);
  assert.ok(sc.st.lastLapMs > 8000, `lastLapMs=${sc.st.lastLapMs}`);
  assert.ok(Math.abs(sc.st.lastLapMs - (track.length / 15) * 1000) < (track.length / 15) * 1000 * 0.15,
    `圈时 ${(sc.st.lastLapMs / 1000).toFixed(1)}s vs 路径时间 ${(track.length / 15).toFixed(1)}s`);
});

test('倒计时锁定期：按住刹车不得触发倒车辅助（P1-1，变红抽查锚点）', () => {
  const sc = scene({});
  sc.sim.throttle = 0;
  sc.sim.brakeTarget = 1;
  sc.sim.brake = 1;
  const x0 = sc.st.x;
  const z0 = sc.st.z;
  for (let i = 0; i < 180; i++) tick(sc, 1 / 60, { launchLock: true }); // 3s
  assert.ok(Math.abs(sc.st.vz) < 0.01, `3s 后 vz=${sc.st.vz.toFixed(3)}（锁定期不得倒车）`);
  assert.ok(Math.hypot(sc.st.x - x0, sc.st.z - z0) < 0.05, `3s 位移 ${Math.hypot(sc.st.x - x0, sc.st.z - z0).toFixed(3)}m（<0.05m）`);
});

test('respawn 语义：resetDrivingState 摆回发车位并清速度', () => {
  const sc = scene({});
  for (let i = 0; i < 60 * 5; i++) tick(sc);
  resetDrivingState(sc.st, track, sc.sim.time);
  assert.equal(sc.st.speed, 0);
  assert.equal(sc.st.lap, 0);
  assert.ok(Math.hypot(sc.st.x - track.startPose.x, sc.st.z - track.startPose.z) < 1e-9);
});
