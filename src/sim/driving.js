// ————— 卡丁车赛道动力学（纯数学，零渲染依赖，可 node --test 直接断言）—————
// 单位：米 / 秒 / 牛 / 千克 / 弧度。车体坐标系：x 为横轴（正 = yaw 增大方向，
// 追逐相机下的"屏幕左转"侧），z 为纵轴（前正），y 向上。
// yaw 与 three.js rotation.y 同约定：车头 = (sin yaw, 0, cos yaw)，yaw 增大 = 朝 +x 偏转。
// 注意：前轮角 a>0 → yaw 增大；键盘【右】映射 sim.steer=+1 → 转向解算角为负 → yaw 减小
// （screens-right 右转）——方向契约回归见 tests/steering.test.js。
//
// 物理口径（真实卡丁车特性，全部按真机量级）：
// - 离心离合器：曲轴 <4000rpm 不传递动力；起步时离合打滑、转速被负载压到接合带
//   （表现 = 转速表先坠到 ~3700 再随车速爬升，"起步喘振"）。
// - 无变速箱：12T 曲轴链轮 → 66T 后链轮直驱（减速比 5.5），扭矩曲线即全部动力。
// - 无差速器：后轴整体；弯中内侧后轮由主销举升卸载（jacking，真实解算），
//   驱动力受"摩擦圆"约束——弯中给油会挤占侧向抓地（转向过度倾向），与真车一致。
// - 单后碟刹：只刹后轴；重刹后轴变轻（载荷前移）→ 制动力上限受后轴附着约束。
// - 轮胎：线性侧偏刚度 + 摩擦圆饱和；前轮侧偏刚度略高于后轮 → 速度上来自然转向不足。

import { L } from '../kart/layout.js';
import { CLUTCH_ENGAGE_RPM } from './state.js';
import { solveChassisPose } from './kinematics.js';

// ————— 物理常量（单一事实来源，测试直接引用）—————
export const PHYS = {
  mass: 155,               // 整备+车手（kg，75 + 80）
  wheelbase: L.frontAxleZ - L.rearAxleZ, // 1.05 m
  cgToFront: 0.63,         // 质心到前轴（前轴静轴荷 ≈40%）
  cgHeight: 0.26,          // 质心高（m）
  wheelRear: L.wheelR.r,   // 0.145 后轮半径
  wheelFront: L.wheelF.r,  // 0.13 前轮半径
  gear: 66 / 12,           // 5.5（发动机→后轮升扭）
  iz: 85,                  // 绕质心横转惯量（kg·m²）
  muF: 1.38,               // 前轮峰值附着（光头热胎）
  muR: 1.32,               // 后轮峰值附着（略低 → 温和转向不足）
  stiffF: 9.0,             // 前轮侧偏刚度/轴荷（1/rad；饱和滑移角 ≈ μ/stiff ≈ 8.8°）
  stiffR: 9.6,             // 后轮侧偏刚度（略硬 → 稳态收敛）
  dragCdA: 0.36,           // 风阻系数×迎面面积（车+车手俯身）
  rollRes: 0.013,          // 滚动阻力系数（热光头胎在沥青）
  brakeForceMax: 2600,     // 后碟最大制动力（N；受后轴附着再钳制）
  reverseSpeed: 2.2,       // 倒车辅助限速（m/s，纯 usability 让步）
  grassGrip: 0.42,         // 草地附着系数
  grassRoll: 0.09,         // 草地滚动阻力增量
  wallMargin: 5.0,         // 软墙：中心线外该距离处兜住（米）
  visualCap: 130,          // 车轮视觉角速度上限（rad/s，防频闪，同展台口径）
};

// 125cc 竞赛二冲程外特性（N·m）：峰值 ≈27.5Nm@9000（≈36hp），断油前快速衰减
const TORQUE_CURVE = [
  [2500, 11], [4000, 18], [6000, 23.5], [8000, 27], [9500, 27.5],
  [11000, 26], [12500, 21.5], [13300, 14], [13800, 5],
];

export function engineTorque(rpm) {
  if (rpm <= TORQUE_CURVE[0][0]) return TORQUE_CURVE[0][1] * Math.max(0, rpm / TORQUE_CURVE[0][0]);
  for (let i = 1; i < TORQUE_CURVE.length; i++) {
    const [r1, t1] = TORQUE_CURVE[i];
    const [r0, t0] = TORQUE_CURVE[i - 1];
    if (rpm <= r1) return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
  }
  return 0;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;

// 主销举升姿态解算的几何（与 kart/parts/jacking.js 同源 layout，导出复用避免手抄）
const JACK_GEOM = {
  trackF: 2 * L.kingpinX,
  trackR: 2 * L.rearTrack,
  wheelbase: L.frontAxleZ - L.rearAxleZ,
  kpiGeom: { kpi: L.kingpinKPI, caster: L.kingpinCaster, scrub: L.kingpinScrub, trail: L.kingpinTrail },
};

export function createDrivingState() {
  return {
    // 位姿与速度（车体系：vx 右正，vz 前正）
    x: 0, z: 0, yaw: 0,
    vx: 0, vz: 0, yawRate: 0,
    axSmooth: 0,          // 纵向加速度平滑值（载荷转移用）
    // 赛道关系
    s: 0,                 // 沿赛道进度（m）
    hintIdx: -1,          // 最近点查询暖启动
    lat: 0,               // 横向偏移（右正）
    onGrass: 0,           // 0..1 草地深度
    onKerb: 0,            // 0..1 路肩
    // 圈计时
    lap: 0,               // 已完成圈数
    lapStart: 0,          // 本圈起始时刻（sim.time，s）
    lastLapMs: 0,
    bestLapMs: 0,
    started: false,       // 越过起点线后开始计时
    wrongWayT: 0,         // 逆行累计（s）
    total: 0,             // 相对起点线的累计里程（米，发车格为负）——比赛排名用（跨线连续，无回绕歧义）
    // 漂移 / boost
    drifting: false,
    driftT: 0,
    boostT: 0,
    // 遥测（HUD / 相机 / 音频读）
    slip01: 0,            // 轮胎滑动量 0..1（啸叫音量）
    speed: 0,             // 真实速度（m/s，合速度）
    wheelOmegaF: 0,       // 前轮视觉角速度（rad/s）
    roll: 0, pitch: 0,    // 动态姿态目标（rad，叠加在真实举升解之上）
    grassShake: 0,        // 相机抖动幅度
  };
}

// 发车位置摆到位（清计时）
export function resetDrivingState(st, track, simTime = 0) {
  const p = track.startPose;
  st.x = p.x;
  st.z = p.z;
  st.yaw = p.yaw;
  st.vx = 0;
  st.vz = 0;
  st.yawRate = 0;
  st.axSmooth = 0;
  st.s = p.s;
  st.lat = 0;
  st.onGrass = 0;
  st.onKerb = 0;
  st.lap = 0;
  st.lapStart = simTime;
  st.lastLapMs = 0;
  st.started = false;
  st.wrongWayT = 0;
  st.drifting = false;
  st.driftT = 0;
  st.boostT = 0;
  st.slip01 = 0;
  st.speed = 0;
  st.roll = 0;
  st.pitch = 0;
  st.hintIdx = track.startIndex;
}

// 每帧推进。s = sim 状态机（读 throttle/brake/steerAngleL/R/rpm，写 wheelOmega/speedKmh/rpm）。
// launchLock：倒计时期间锁动力（允许轰油门，不允许走车）。

// 原地救车：摆回最近中心线点、清速度、朝切线方向。保留 s 进度与圈计时（比赛 R 键 /
// AI 卡死自救用——不回起点、不算抄近路）。
export function respawnOnTrack(st, track) {
  const n = track.nearest(st.x, st.z, st.hintIdx);
  const p = track.pointAt(n.s);
  st.x = p.x;
  st.z = p.z;
  st.yaw = p.yaw;
  st.vx = 0;
  st.vz = 0;
  st.yawRate = 0;
  st.axSmooth = 0;
  st.s = n.s;
  st.lat = 0;
  st.hintIdx = n.idx;
  st.onGrass = 0;
  st.onKerb = 0;
  st.drifting = false;
  st.boostT = 0;
  st.wrongWayT = 0;
  return st;
}

// 只重置圈计时（GO 时刻用）：不动位姿/速度——发车格已摆好。
// total 以"当前到起点线的有符号距离"为基准（发车格在负区），此后随行驶累计。
export function resetLapTiming(st, simTime, track) {
  st.lap = 0;
  st.lapStart = simTime;
  st.lastLapMs = 0;
  st.started = false;
  st.wrongWayT = 0;
  st.total = track ? track.signedDelta(st.s) : 0;
  return st;
}export function stepDriving(st, s, track, dt, { launchLock = false } = {}) {
  const P = PHYS;
  const m = P.mass;
  const g = 9.81;

  // ——— 输入 ———
  const throttle = launchLock ? 0 : clamp01(s.throttle);
  const brake = clamp01(s.brake);
  const steerAngle = (s.steerAngleL + s.steerAngleR) / 2; // 阿克曼解算角（左负右正…左转为负）
  const driftWanted = !!s.driftHeld && !launchLock;

  // ——— 赛道关系 ———
  const near = track.nearest(st.x, st.z, st.hintIdx);
  st.hintIdx = near.idx;
  const prevS = st.s;
  st.s = near.s;
  st.lat = near.lat;
  const absLat = Math.abs(near.lat);
  const grassDepth = clamp01((absLat - track.halfWidth) / 1.5);
  st.onGrass = grassDepth;
  st.onKerb = (absLat > track.halfWidth - 0.8 && absLat <= track.halfWidth + 0.25)
    ? clamp01((absLat - (track.halfWidth - 0.8)) / 0.8) : 0;

  // 表面附着
  const gripMul = lerp(1, P.grassGrip, grassDepth) * (st.onKerb > 0 ? lerp(1, 0.9, st.onKerb) : 1);
  const rollAdd = grassDepth * P.grassRoll;
  st.grassShake = grassDepth;

  // ——— 静轴荷基准 ———
  const lf = P.cgToFront;
  const lr = P.wheelbase - lf;
  const FzF0 = m * g * (lr / P.wheelbase);

  // ——— 离合器 / 发动机 ———
  // 后轮转速折算发动机转速（直驱 5.5:1）
  const wheelRPM = (Math.abs(st.vz) / (2 * Math.PI * P.wheelRear)) * 60 * P.gear;
  const engaged = !launchLock && s.rpm >= CLUTCH_ENGAGE_RPM && throttle > 0.02;
  let rpmEff = s.rpm;
  let fDrive = 0;
  let wheelspin = 0;
  if (engaged) {
    const slipping = wheelRPM < CLUTCH_ENGAGE_RPM;
    rpmEff = Math.max(wheelRPM, CLUTCH_ENGAGE_RPM * 0.92); // 打滑期转速被压在接合带（起步喘振）
    const T = engineTorque(rpmEff) * throttle * (slipping ? 0.85 : 1);
    fDrive = (T * P.gear) / P.wheelRear;
  }
  // 转速显示/声效：接合期由轮速直接接管（直驱 = 发动机转速即轮速×传动比；
  // 打滑期被负载压在接合带 = "起步喘振"）。松油门后状态机自会拉回怠速，不在此干预。
  if (engaged) s.rpm = rpmEff;

  // 倒车辅助：停稳后按住刹车（无油门）缓慢倒车
  const reversing = brake > 0.5 && throttle < 0.05 && st.vz < 0.5 && st.vz > -P.reverseSpeed;
  if (reversing) fDrive = -m * 1.1;

  // ——— 阻力（草地颠簸额外放大气动/滚动阻力：冲出路面后能真实减速）———
  const drag = 0.5 * 1.2 * P.dragCdA * (1 + 6 * grassDepth) * st.vz * Math.abs(st.vz);
  const roll = (P.rollRes + rollAdd) * m * g * Math.sign(st.vz) * (Math.abs(st.vz) > 0.05 ? 1 : 0);

  // ——— 漂移（跑跑卡丁车式 Shift 甩尾）———
  const speed = Math.hypot(st.vx, st.vz);
  const canDrift = driftWanted && speed > 4.5 && throttle > 0.08;
  if (canDrift && !st.drifting) { st.drifting = true; st.driftT = 0; }
  if (st.drifting) {
    st.driftT += dt;
    if (!canDrift) {
      // 出弯：漂够时长给一发推进（Δv≈2m/s 分摊在 boost 窗口内）
      st.drifting = false;
      if (st.driftT > 0.55 && grassDepth < 0.3) st.boostT = 0.6;
    }
  }
  if (st.boostT > 0) {
    st.boostT -= dt;
    fDrive += m * 3.6; // ≈ +2.2 m/s
  }
  const muRBase = P.muR * gripMul;
  const muR = muRBase * (st.drifting ? 0.58 : 1) * (brake > 0.7 ? 0.88 : 1);
  const stiffR = P.stiffR * (st.drifting ? 0.42 : 1) * (brake > 0.7 ? 0.8 : 1);

  // ——— 轮胎侧偏滑移角（只依赖速度场，迭代外算一次）———
  const vLongSafe = Math.max(Math.abs(st.vz), 1.2); // 低速防奇异（分母）
  const slipF = steerAngle - Math.atan2(st.vx + st.yawRate * lf, vLongSafe);
  const slipR = -Math.atan2(st.vx - st.yawRate * lr, vLongSafe);

  // ——— 载荷 ↔ 轮胎力 不动点（两轮迭代）———
  // 制动力改变纵向加速度 → 加速度改变载荷转移 → 转移改变后轴附着 → 又反过来钳制制动力。
  // 单次估算（用上帧加速度）会让首帧制动借到滞后、峰值虚高；两轮迭代即收敛。
  let axEst = st.axSmooth; // 暖启动
  let fYF = 0, fYR = 0;
  let fLongTotal = 0;
  for (let iter = 0; iter < 2; iter++) {
    const transfer = (m * axEst * P.cgHeight) / P.wheelbase;
    const FzF = Math.max(0.15 * m * g, FzF0 - transfer);
    const FzR = Math.max(0.15 * m * g, m * g - FzF);

    // 制动（单后碟：制动力上限受后轴附着约束）
    const fBrake = Math.min(brake * P.brakeForceMax, muRBase * FzR * 0.95) * (st.vz > 0.05 ? 1 : 0);

    // 轮胎侧偏（线性 + 摩擦圆饱和；前轮刚度略高 → 速度上去自然转向不足）
    const fMaxF = P.muF * gripMul * FzF;
    const fMaxR = muR * FzR;
    const fYFI = clamp(P.stiffF * FzF * slipF, -fMaxF, fMaxF);
    const fYRI = clamp(stiffR * FzR * slipR, -fMaxR, fMaxR);

    // 驱动力受后轴摩擦圆约束（弯中给油挤占侧向抓地 → 转向过度/甩尾）
    const fDriveAvail = Math.sqrt(Math.max(fMaxR * fMaxR - fYRI * fYRI, 0));
    const fDriveApplied = clamp(fDrive, -fDriveAvail, fDriveAvail);
    if (iter === 1 && Math.abs(fDrive) > fDriveAvail + 1) {
      wheelspin = clamp01((Math.abs(fDrive) - fDriveAvail) / (0.35 * fMaxR));
    }

    fLongTotal = fDriveApplied - drag - roll - fBrake - fYFI * Math.sin(steerAngle);
    fYF = fYFI;
    fYR = fYRI;
    axEst = fLongTotal / m;
  }

  // ——— 低速运动学混合 ———
  // |vz| 很小时侧偏模型退化：混入运动学自行车模型（yawRate = v·tanδ/L），横速直接压掉
  const wKin = clamp01((2.2 - Math.abs(st.vz)) / 2.2);

  // ——— 车体系积分 ———
  const fLatTotal = fYF * Math.cos(steerAngle) + fYR;
  const axLong = fLongTotal / m + st.yawRate * st.vx;
  const axLat = fLatTotal / m - st.yawRate * st.vz;

  let yawAcc = (lf * fYF * Math.cos(steerAngle) - lr * fYR) / P.iz;
  if (st.drifting) yawAcc += steerAngle * 260 / P.iz; // 漂移中随打方向的甩尾助力（跑跑味）

  st.vx += axLat * dt;
  st.vz += axLong * dt;
  st.yawRate += yawAcc * dt;
  st.yawRate *= 1 - Math.min(1, dt * (st.drifting ? 1.2 : 2.6)); // 航向角阻尼（漂移时放松）

  const yawRateKin = (Math.abs(st.vz) * Math.tan(steerAngle)) / P.wheelbase;
  st.yawRate = lerp(st.yawRate, yawRateKin, wKin);
  st.vx *= 1 - wKin * 0.85;

  st.axSmooth = lerp(st.axSmooth, fLongTotal / m, Math.min(1, dt * 6));

  // 世界系位置积分（车头 = (sinψ, cosψ)，车体 +x = (cosψ, −sinψ)）
  const cy = Math.cos(st.yaw);
  const sy = Math.sin(st.yaw);
  st.x += (st.vx * cy + st.vz * sy) * dt;
  st.z += (-st.vx * sy + st.vz * cy) * dt;
  st.yaw += st.yawRate * dt;

  // ——— 软墙：中心线外 margin 处沿法线兜回，法向速度清零 ———
  if (absLat > track.halfWidth + P.wallMargin) {
    const sp = near.sample;
    const over = absLat - (track.halfWidth + P.wallMargin);
    const sgn = Math.sign(near.lat);
    st.x -= sp.tz * sgn * over;
    st.z -= -sp.tx * sgn * over;
    // 法向（世界系）速度分量清零
    const vwx = st.vx * cy + st.vz * sy;
    const vwz = -st.vx * sy + st.vz * cy;
    const nwx = sp.tz * sgn;
    const nwz = -sp.tx * sgn;
    const vn = vwx * nwx + vwz * nwz;
    if (vn > 0) {
      const dvx = vn * nwx;
      const dvz = vn * nwz;
      st.vx -= (dvx * cy - dvz * sy);
      st.vz -= (dvx * sy + dvz * cy);
    }
    st.yawRate *= 0.5;
  }

  // ——— 圈计数 / 逆行 / 累计里程 ———
  const dProg = track.signedDelta(st.s - prevS);
  st.total += dProg; // 有符号累计（倒车会回退排名，诚实口径）
  if (st.started && track.crossedStartForward(prevS, st.s) && st.speed > 3) {
    const lapMs = (s.time - st.lapStart) * 1000;
    if (lapMs > 8000) { // 防抖：一圈至少 8s
      st.lap += 1;
      st.lastLapMs = lapMs;
      if (!st.bestLapMs || lapMs < st.bestLapMs) st.bestLapMs = lapMs;
      st.lapStart = s.time;
    }
  }
  if (!st.started && st.speed > 3) st.started = true;
  if (st.started && dProg < -0.02 && st.speed > 2) st.wrongWayT += dt;
  else st.wrongWayT = Math.max(0, st.wrongWayT - dt * 2);

  // ——— 遥测输出 ———
  st.speed = Math.hypot(st.vx, st.vz);
  st.slip01 = clamp01(Math.max(
    Math.abs(slipF) / 0.22,
    Math.abs(slipR) / 0.22,
    wheelspin,
    st.drifting ? 0.75 : 0,
  ) * (grassDepth > 0.4 ? 0.3 : 1));
  // 车轮真实滚动角速度（后轮 = 地面速度/轮径；前轮半径不同另算）——覆盖展台的频闪上限口径
  const omegaRear = clamp(st.vz / P.wheelRear, -P.visualCap, P.visualCap);
  s.wheelOmega = omegaRear;
  st.wheelOmegaF = clamp(st.vz / P.wheelFront, -P.visualCap, P.visualCap);
  s.speedKmh = st.speed * 3.6; // 真实车速（覆盖状态机的理论车速口径）

  // ——— 动态姿态目标（真实举升解 + 动态侧倾/俯仰，位姿更新器落位）———
  // roll/pitch 均为 solveChassisPose 口径（位姿更新器写 Euler(−pitch, 0, −roll)，
  // 与 kart/parts/jacking.js 的落位式一致）：roll>0 = 左侧抬起，pitch>0 = 车头下沉。
  const jack = solveChassisPose(s.steerAngleL, s.steerAngleR, JACK_GEOM);
  const ayG = fLatTotal / m / g;
  // 弯中动态侧倾：离心把车身上部压向外侧 = 内侧抬起。左转 ayG<0（向心力指向弯心=车体左侧）
  // → roll 增大（左侧抬起），与举升解同向叠加。
  const rollDyn = clamp(-ayG * 0.028, -0.05, 0.05);
  const pitchDyn = clamp(-st.axSmooth * 0.012, -0.018, 0.018); // 加速抬头（ax>0 → pitch<0）/ 制动点头
  st.roll = clamp(jack.roll + rollDyn, -0.09, 0.09);
  st.pitch = clamp(jack.pitch + pitchDyn, -0.05, 0.05);
  st.heave = jack.heave;

  return st;
}
