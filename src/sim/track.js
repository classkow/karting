// ————— 赛道几何（纯数学，零渲染依赖，可 node --test 直接断言）—————
// 闭合 Catmull-Rom 样条中心线 → 等弧长离散采样表 → 最近点/横向偏移/进度参数化/绕圈检测。
// 坐标系与整车一致：x 向右，z 向车头，y 向上（俯视图 +x 在右、+z 在上）。
// 航向角 yaw：车头方向 = (sin yaw, 0, cos yaw)，与 three.js rotation.y 直接对应。

// 沥青路面全宽（米）。历史默认 7m；1:1 复刻赛道改由 trackData.js 提供口径（12m），
// 此常量保留为旧展台/工具引用的兜底值。
export const TRACK_WIDTH = 7;

// 1:1 复刻赛道：控制点/路宽/起点锚点单源于 trackData.js（程序化提取自参考平面图）。
import { REPLICA_CONTROL_POINTS, REPLICA_START_ANCHOR, TRACK_WIDTH_M } from './trackData.js';

// 闭合 Catmull-Rom 插值（标准 0.5 系数）
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// 平滑一维数组（简单滑动平均，窗口 win，奇数）
function smooth1d(arr, win) {
  const n = arr.length;
  const half = win >> 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -half; j <= half; j++) sum += arr[(i + j + n) % n];
    out[i] = sum / win;
  }
  return out;
}

export function createTrackModel({
  points = REPLICA_CONTROL_POINTS,
  width = TRACK_WIDTH_M,
  sampleStep = 1.0, // 离散采样目标弧长间距（米）
  startAnchor,
} = {}) {
  // 起点锚点只随复刻点集默认生效；自定义点集（试验赛道）回退旧启发式 (0,-60)，
  // 避免复刻锚点把试验赛道的 s=0 转到无关位置（回归 tests/ai、driving、steering 的 lab 赛道）。
  const anchor = startAnchor ?? (points === REPLICA_CONTROL_POINTS ? REPLICA_START_ANCHOR : [0, -60]);
  const N = points.length;

  // —— 1. 按参数密集采样（每段 64 步）拿原始折线 ——
  const raw = [];
  for (let i = 0; i < N; i++) {
    const p0 = points[(i - 1 + N) % N];
    const p1 = points[i];
    const p2 = points[(i + 1) % N];
    const p3 = points[(i + 2) % N];
    for (let j = 0; j < 64; j++) {
      const t = j / 64;
      raw.push([catmullRom(p0[0], p1[0], p2[0], p3[0], t), catmullRom(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }

  // —— 2. 累计弧长 → 按等弧长重采样 ——
  const cum = [0];
  for (let i = 1; i <= raw.length; i++) {
    const a = raw[i - 1];
    const b = raw[i % raw.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[raw.length]; // 闭合周长
  const count = Math.max(64, Math.round(length / sampleStep));
  const step = length / count;
  const samples = []; // { x, z, tx, tz, yaw, s, k }（k = 有符号曲率，正 = 向右转）
  let ri = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (ri < raw.length - 1 && cum[ri + 1] < target) ri++;
    const t = (target - cum[ri]) / Math.max(cum[ri + 1] - cum[ri], 1e-9);
    const ax = raw[ri], bx = raw[(ri + 1) % raw.length];
    samples.push({
      x: ax[0] + (bx[0] - ax[0]) * t,
      z: ax[1] + (bx[1] - ax[1]) * t,
      s: target,
      tx: 0, tz: 0, yaw: 0, k: 0,
    });
  }

  // —— 3. 切线 / 航向 / 有符号曲率（中心差分）——
  const yawArr = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = samples[(i - 1 + count) % count];
    const b = samples[(i + 1) % count];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    samples[i].tx = dx / len;
    samples[i].tz = dz / len;
    yawArr[i] = Math.atan2(samples[i].tx, samples[i].tz);
    samples[i].yaw = yawArr[i];
  }
  const kRaw = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = yawArr[(i - 1 + count) % count];
    const b = yawArr[(i + 1) % count];
    let d = b - a;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    kRaw[i] = d / (2 * step); // 1/m，正 = yaw 增大 = 向右转
  }
  const kSmooth = smooth1d(kRaw, 15);
  for (let i = 0; i < count; i++) samples[i].k = kSmooth[i];

  // —— 4. 起点线：取最接近锚点（默认 = trackData.js 的起步线位置）的采样点，并把采样表旋转到起点线——
  // s=0 即起点线：计圈 wrap、发车格、龙门架三者天然同位（圈时 = 线到线，比赛口径必需）。
  let startIndex = 0;
  let best = Infinity;
  for (let i = 0; i < count; i++) {
    const d = Math.hypot(samples[i].x - anchor[0], samples[i].z - anchor[1]);
    if (d < best) { best = d; startIndex = i; }
  }
  if (startIndex !== 0) {
    const rotated = samples.slice(startIndex).concat(samples.slice(0, startIndex));
    samples.length = 0;
    for (const sp of rotated) samples.push(sp);
    for (let i = 0; i < count; i++) samples[i].s = i * step;
    startIndex = 0;
  }
  const startPose = {
    x: samples[0].x,
    z: samples[0].z,
    yaw: samples[0].yaw,
    s: 0,
  };

  // —— 5. 查询 API ——

  const wrapS = (s) => ((s % length) + length) % length;

  // 最短有符号进度差（±L/2）
  function signedDelta(ds) {
    let d = wrapS(ds);
    if (d > length / 2) d -= length;
    return d;
  }

  // 最近点查询：hintIdx 附近窗口搜索（正常行驶 O(1)），丢失时全表扫描兜底
  function nearest(x, z, hintIdx = -1) {
    let idx = -1;
    let bestD = Infinity;
    if (hintIdx >= 0 && hintIdx < count) {
      const W = 40;
      for (let j = -W; j <= W; j++) {
        const i = (hintIdx + j + count) % count;
        const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2;
        if (d < bestD) { bestD = d; idx = i; }
      }
      // 窗口内命中最差也要在边缘才算可信；太远说明车被拉远了 → 全扫
      if (bestD > 25 * 25) idx = -1;
    }
    if (idx < 0) {
      bestD = Infinity;
      for (let i = 0; i < count; i++) {
        const d = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2;
        if (d < bestD) { bestD = d; idx = i; }
      }
    }
    const sp = samples[idx];
    // 右侧法线（俯视 +x 右 +z 上：切线 (tx,tz) 的行进右侧 = (tz, −tx)）
    const nx = sp.tz;
    const nz = -sp.tx;
    const lat = (x - sp.x) * nx + (z - sp.z) * nz; // 正 = 中心线右侧
    // 连续进度：采样点弧长 + 沿切线投影（钳在半步内，避免越过邻采样点归属）
    const along = Math.max(-step * 0.49, Math.min(step * 0.49, (x - sp.x) * sp.tx + (z - sp.z) * sp.tz));
    return { idx, s: sp.s + along, lat, k: sp.k, sample: sp };
  }

  // 弧长参数化取点（线性插值相邻采样），带单位切线（供 AI 切弯偏置等使用）
  function pointAt(s) {
    let ss = wrapS(s);
    const f = ss / step;
    let i = Math.floor(f) % count;
    const t = f - Math.floor(f);
    const a = samples[i];
    const b = samples[(i + 1) % count];
    let tyaw = a.yaw + (((b.yaw - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: tyaw,
      tx: Math.sin(tyaw),
      tz: Math.cos(tyaw),
      k: a.k,
    };
  }

  // 是否从起点线正向越过（进度 prevS → s）：用于计圈。
  // 两端都先归一到 [0, L)：正向跨线时原始差值落在 (−L, −L/2)，其余情况不可能小于 −L/2。
  function crossedStartForward(prevS, s) {
    return wrapS(s) - wrapS(prevS) < -length / 2;
  }

  return {
    samples, length, width, halfWidth: width / 2,
    startIndex, startPose,
    wrapS, signedDelta, nearest, pointAt, crossedStartForward,
  };
}
