// ————— 卡丁车 AI（纯数学，零渲染依赖，可 node --test 直接断言）—————
// AI 与玩家跑完全同一套 stepDriving 物理：控制器只产出输入（油门/刹车/前轮角），
// 写进一张轻量 sim 壳（createAIShell），不做任何物理旁路、不看玩家状态（无橡皮筋）。
//
// 控制策略：
// - 转向 = 纯追踪（pure pursuit）：前瞻目标点取中心线 s+L，按曲率向弯心偏置（切弯），
//   经典 δ = atan2(2·轴距·sinα, 距离)，再做转向速率限制。
// - 速度 = 前瞻制动预算：对前方 0..90m 逐段取弯道限速 v_corner=√(aLat/|k|)，
//   反推当前允许速度 v_allow=√(v_corner²+2·aLong·d)，取最小——天然得到正确的刹车点。
// - 三档难度只差"真实能力"：侧向/纵向加速度上限、极速、前瞻、切弯幅度、转向速率、
//   起步反应、操作噪声，依次递增，无橡皮筋。

import { PHYS } from './driving.js';
import { IDLE_RPM, MAX_RPM, RPM_RISE_RATE, RPM_FALL_RATE } from './state.js';

export const AI_TIERS = {
  rookie: {
    id: 'rookie', label: '新锐组',
    aLat: 8.6, aLong: 4.0, topSpeed: 30.0,      // 弯中上限/制动减速度/直道极速 (m/s², m/s², m/s)
    lookaheadMin: 7.0, lookaheadGain: 0.32,     // 前瞻距离 = min + speed·gain（米）
    apexOffset: 0.0,                            // 切弯偏置（米，0=贴中线走）
    steerRate: 2.6,                             // 前轮角速率上限 (rad/s)
    headingDamp: 0.35,                          // 航向-路切线 阻尼增益（抑制高速织摆）
    reaction: 0.45,                             // GO 后起步延迟 (s)
    noise: 0.045,                               // 转向噪声幅度 (rad)
    throttleCap: 0.88,
  },
  elite: {
    id: 'elite', label: '精英组',
    aLat: 10.6, aLong: 5.2, topSpeed: 33.5,
    lookaheadMin: 9.0, lookaheadGain: 0.55,
    apexOffset: 0.6,
    steerRate: 3.4,
    headingDamp: 0.55,
    reaction: 0.2,
    noise: 0.018,
    throttleCap: 0.96,
  },
  champion: {
    id: 'champion', label: '王者组',
    aLat: 12.2, aLong: 5.8, topSpeed: 33.8,
    lookaheadMin: 10.0, lookaheadGain: 0.55,
    apexOffset: 1.4,
    steerRate: 4.2,
    headingDamp: 0.8,
    reaction: 0.06,
    noise: 0,
    throttleCap: 1.0,
  },
};

export const AI_TIER_ORDER = ['rookie', 'elite', 'champion'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const MAX_STEER_ANGLE = 0.3; // 前轮角物理上限（rad，与阿克曼解算满舵量级一致）
// 制动预算折扣：vAllow 扫描假设从前瞻点一路直线刹到弯心，但发卡末段必须边转边刹
// （摩擦圆被转向占用，实测有效减速 ≈ 直线制动 6-7 折）。不打折会在发卡前 10m 才
// 开始真制动 → understeer 冲进弯心内场（1:1 复刻赛道 MP5/MP6 连发卡实测 30s 草地）。
const BRAKE_BUDGET = 0.7;
// 发卡弯速裕度：平滑采样会低估紧弯真实顶点曲率（±7.5m 窗把 R≈3m 的 U 摊到 R≈4.4m），
// 而 180° 发卡要以贴极限侧向加速度持续 2s+，纯追踪的任何微小误差都会累积成冲出弯心。
// 曲率越大裕度越足：R>20m 维持 0.94，R<12.5m 收到 0.75（真实车手过发卡同样只用 ~8 成极限）。
function cornerMargin(k) {
  return 0.94 - 0.19 * clamp((k - 1 / 20) / (1 / 8 - 1 / 20), 0, 1);
}

// AI 用的轻量 sim 壳：stepDriving 读写字段的最小集合（起步即"已点火、已过接合转速"）
export function createAIShell() {
  return {
    rpm: 6000,
    throttle: 0,
    brake: 0,
    brakeTarget: 0,
    steerAngleL: 0,
    steerAngleR: 0,
    steerSmooth: 0,
    time: 0,
    wheelOmega: 0,
    speedKmh: 0,
    driftHeld: false,
  };
}

export function createAIController(tierId, seed = 1) {
  const cfg = AI_TIERS[tierId] ?? AI_TIERS.elite;
  return {
    tier: cfg.id,
    cfg,
    steer: 0,        // 当前前轮角 (rad，正 = yaw 增大)
    reactionLeft: cfg.reaction,
    stuckT: 0,
    wantReset: false,
    noiseSeed: seed * 17.31,
  };
}

// 每帧决策 + 写壳。st = 该 AI 的 driving 状态，shell = createAIShell()。
export function stepAI(ai, st, shell, track, dt, { launchLock = false } = {}) {
  const cfg = ai.cfg;
  shell.time += dt;

  // ——— 起步反应延迟 ———
  let go = !launchLock;
  if (go && ai.reactionLeft > 0) {
    ai.reactionLeft -= dt;
    go = false;
  }

  // ——— 转向：纯追踪 + 弯心切偏 ———
  const lookDist = clamp(cfg.lookaheadMin + st.speed * cfg.lookaheadGain, cfg.lookaheadMin, 22);
  const tgt = track.pointAt(st.s + lookDist);
  // 切弯：目标点向弯内侧偏置（k>0 = 驾驶员系左弯，内侧沿车体 +x 侧法线 (tz,−tx) → sgn=+1；
  // k<0 右弯反号。符号语义回归见 tests/track.test.js「k 与几何差分同号」+ tests/ai.test.js 切内侧用例）
  const off = cfg.apexOffset * Math.min(1, Math.abs(tgt.k) * 30);
  const sgn = Math.sign(tgt.k);
  const tx = tgt.x + tgt.tz * sgn * off;
  const tz = tgt.z - tgt.tx * sgn * off;

  // 世界 → 车体（体 x 右/体 z 前，同 driving.js 口径）
  const dx = tx - st.x;
  const dz = tz - st.z;
  const cy = Math.cos(st.yaw);
  const sy = Math.sin(st.yaw);
  const localX = dx * cy - dz * sy;
  const localZ = dx * sy + dz * cy;
  const dist = Math.max(Math.hypot(localX, localZ), 0.6);
  // α：目标在体轴前为 0，偏向体 +x 侧为正（体 +x = yaw 增大方向，见 driving.js 头注）
  const alpha = Math.atan2(localX, localZ);

  let delta = Math.atan2(2 * PHYS.wheelbase * Math.sin(alpha), dist);
  // 航向阻尼：车头相对路切线的偏角按比例反打。纯追踪在高速直道上增益极小（δ≈lat·2轴距/L²），
  // 织摆（±1.6m 交替）吃掉弯中抓地裕度 → 进弯甩尾；此项只抑制"车头相对路的摆动"，
  // 弯中车身沿切线时几乎为零，不影响正常转向（难度越高阻尼越强）。
  {
    const road = track.pointAt(st.s);
    let dYaw = st.yaw - road.yaw;
    dYaw = ((dYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    delta -= dYaw * cfg.headingDamp;
  }
  // 操作噪声（新锐手抖；用时间正弦，确定性可复现）
  if (cfg.noise > 0) delta += Math.sin(shell.time * 2.1 + ai.noiseSeed) * cfg.noise;
  delta = clamp(delta, -MAX_STEER_ANGLE, MAX_STEER_ANGLE);
  // 前轮角速率限制（打方向也需要时间）
  const dMax = cfg.steerRate * dt;
  ai.steer += clamp(delta - ai.steer, -dMax, dMax);

  // 轻量阿克曼：内侧轮角略大（对物理影响温和，视觉与前轮滑移更真）
  if (ai.steer >= 0) {
    shell.steerAngleL = ai.steer * 0.92;
    shell.steerAngleR = ai.steer * 1.08;
  } else {
    shell.steerAngleL = ai.steer * 1.08;
    shell.steerAngleR = ai.steer * 0.92;
  }

  // ——— 速度：前瞻制动预算（aLat 留 6% 安全裕度，防贴着极限进弯）———
  // 近段（≤30m）按 3m 加密扫描：1:1 复刻赛道含 R≈4-6m 发卡，6m 步进会跨过顶点
  // 曲率峰（实测王者组以预算 2 倍车速冲出发卡后触发倒车辅助恶性循环）；
  // 自身位置曲率一并纳入，兜住"已处弯中、前瞻点已出弯"的漏看场景。
  let vTarget = cfg.topSpeed;
  {
    const kHere = Math.abs(track.pointAt(st.s).k);
    if (kHere > 1e-4) {
      const vCorner = Math.sqrt((cfg.aLat * cornerMargin(kHere)) / kHere);
      if (vCorner < vTarget) vTarget = vCorner;
    }
  }
  for (let d = 0; d <= 90; d += d < 30 ? 3 : 6) {
    const p = track.pointAt(st.s + d);
    const kc = Math.abs(p.k);
    if (kc < 1e-4) continue;
    const vCorner = Math.sqrt((cfg.aLat * cornerMargin(kc)) / kc);
    const vAllow = Math.sqrt(vCorner * vCorner + 2 * cfg.aLong * BRAKE_BUDGET * d);
    if (vAllow < vTarget) vTarget = vAllow;
  }
  const kNow = Math.abs(tgt.k);
  if (kNow > 1e-4) {
    const vCorner = Math.sqrt((cfg.aLat * Math.min(0.9, cornerMargin(kNow))) / kNow); // 近处弯：常规裕度与发卡裕度取严
    if (vCorner < vTarget) vTarget = vCorner;
  }

  let throttle = 0;
  let brake = 0;
  if (!go) {
    throttle = 0;
    brake = launchLock ? 1 : 0; // 倒计时期间带刹待发
  } else if (st.speed > vTarget + 0.5) {
    brake = clamp((st.speed - vTarget) / 6, 0.3, 1);
  } else {
    throttle = clamp((vTarget - st.speed) / 4, 0.15, cfg.throttleCap);
  }
  shell.throttle = throttle;
  shell.brake = brake;
  shell.brakeTarget = brake;

  // 转速回推：与 sim/state.js 状态机同律（目标转速随油门、上行 3.4/s 下行 2.0/s）。
  // 没有这一步，stepDriving 的离合喘振会把壳 rpm 压到接合带以下且无人推回，
  // AI 起步一帧后就永久分离离合趴窝（回归 tests/ai.test.js 整圈节奏用例）。
  {
    const target = IDLE_RPM + shell.throttle * (MAX_RPM - IDLE_RPM);
    const rate = target > shell.rpm ? RPM_RISE_RATE : RPM_FALL_RATE;
    shell.rpm += (target - shell.rpm) * Math.min(1, dt * rate);
  }

  // ——— 卡死自救信号（位置恢复由调用方做，保持本模块无副作用）———
  if (!launchLock && st.speed < 0.5) ai.stuckT += dt;
  else ai.stuckT = 0;
  ai.wantReset = ai.stuckT > 2.5;
  if (ai.wantReset) ai.stuckT = 0;

  return ai;
}
