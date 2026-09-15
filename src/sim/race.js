// ————— 比赛状态（纯数学，零渲染依赖，可 node --test 直接断言）—————
// 发车格 / 排名 / 完赛流 / 车间碰撞。视觉（AI 车体克隆）与交互（菜单/结算）不在此。

import { createDrivingState } from './driving.js';
import { L } from '../kart/layout.js';

export const RACE_LAPS = 3;      // 3 圈制
// 比赛配置单源（K-A12）：菜单文案/帮助页/HUD 的 /N 全部读这里
export const RACE_CONFIG = {
  laps: RACE_LAPS,
  opponents: 3, // AI 对手数（与 createRaceEntrants 的 PALETTE 数一致）
};
export const GRID_ROW = 4.2;     // 发车格排距（米）
export const GRID_COL = 1.4;     // 发车格横错（米；正 = 车体 +x 侧 = 驾驶员左，见 sim/track.js 手性注）

// 车间碰撞形状：旋转矩形（OBB），包络从车体几何推导（BUG 1「隔空气撞」修正）——
// - 半宽 = 后轮外缘半距 = L.rearTrack + L.wheelR.w/2 ≈ 0.7225（全车最宽点，总宽 1.445m）
// - 前向 reach = 前保险杠兜圈顶点 z = 0.76 + 0.20 + 0.021 ≈ 0.98（bodywork.js 前杠）
// - 后向 reach = 后保险杠外缘 z = −0.685 − 0.022 ≈ −0.71（bodywork.js 后杠）→ 全长 1.69m
// 旧 KART_RADIUS=1.15 等半径圆把侧向判定放大到 ±2.3m（车宽的 3.2 倍），两车并排
// 隔 0.85m 空气即"撞车"。圆族方案（含 2~3 圆胶囊）对本车这种近方形包络（长宽比
// 1.17）必然顾此失彼：半径取 0.7 配车宽则前后 reach 超 0.3~0.55m（追尾隔空撞），
// 半径收小配车长则侧向欠覆盖（并排轮蹭轮）——故取 SAT 旋转矩形精确贴合。
export const KART_SHAPE = {
  halfW: L.rearTrack + L.wheelR.w / 2,
  halfF: 0.98,
  halfR: 0.71,
};
// 矩形中心在车体系 z = (halfF − halfR)/2，半长 = (halfF + halfR)/2
const KART_CZ = (KART_SHAPE.halfF - KART_SHAPE.halfR) / 2;
const KART_HL = (KART_SHAPE.halfF + KART_SHAPE.halfR) / 2;
// SAT 轴近平局带：包络近方形，两轴重叠深度差 < 此值时改按相对速度接近轴决胜
// （否则正碰/追尾会选到侧向轴 → 法向速度分量≈0 → 冲量丢失；深穿透场景几何本就歧义）
const AXIS_EPS = 0.12;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 发车格位姿：slot 0 最靠前（P1），玩家默认 P4（最后一排、车体 +x 侧列 = 驾驶员左；
// 镜像修正后首弯 MP1 是右弯，故玩家这一列在首弯外侧线上——交替格位的既有安排，非缺陷）
export function gridPose(track, slot) {
  const row = Math.floor(slot / 2);
  const col = slot % 2 === 0 ? -1 : 1;
  const p = track.pointAt(track.startPose.s - (row + 1) * GRID_ROW);
  const nx = p.yaw !== undefined ? Math.cos(p.yaw) : 1; // 体 +x 世界向 (cosψ, −sinψ)
  const nz = -Math.sin(p.yaw);
  return {
    x: p.x + nx * col * GRID_COL,
    z: p.z + nz * col * GRID_COL,
    yaw: p.yaw,
  };
}

// 排名：完赛者优先按完赛用时升序，未完赛按累计里程 total 降序
// （total 以起点线为原点、有符号累计——跨线连续，无 s 回绕歧义）。
// total 相等（同排发车格的浮点残差/强制平手）按 gridSlot 升序破序——发车顺位即名次口径，
// 否则稳定排序按数组序会把玩家（数组 0、slot 3）排到同排 AI 前，初帧显示 P3（P2-1）。
// entrants: [{ id, isPlayer, gridSlot, st(drivingState), finished, finishTime, finishOrder }]
export function rankEntrants(entrants) {
  return [...entrants].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return (b.st.total ?? 0) - (a.st.total ?? 0) || (a.gridSlot ?? 0) - (b.gridSlot ?? 0);
  });
}

// 结算面板数据组装（K-A4 纯函数）：排名 → showResults 入参形状单点化。
// 形状契约：[{ name, isPlayer, finished, finishTime, lapTimeMs }]
// （lapTimeMs = 该车手最佳圈毫秒，未完赛/未计圈为 0，UI 显示 '--:--.-'）。
export function buildResults(ranked) {
  return ranked.map((e) => ({
    name: e.name,
    isPlayer: e.isPlayer,
    finished: e.finished === true,
    finishTime: e.finishTime ?? 0,
    lapTimeMs: e.st?.bestLapMs ?? 0,
  }));
}

// 玩家（或任一车）冲线：记录完赛序号与用时；返回其名次（1 起）
export function finishEntrant(entrants, e, raceTime) {
  if (e.finished) return -1;
  e.finished = true;
  e.finishTime = raceTime;
  e.finishOrder = entrants.filter((x) => x.finished).length;
  return rankEntrants(entrants).indexOf(e) + 1;
}

// ————— 车间碰撞：SAT 旋转矩形 —————

// 单对车的碰撞检测：返回 null（无接触）或 { nx, nz, depth, cx, cz }，
// 法线 (nx,nz) 从 a 指向 b，(cx,cz) 为接触点（世界系）。
// SAT：4 轴投影取最小重叠轴；近平局（深度差 < AXIS_EPS）时按相对速度接近轴决胜，
// 保证正碰/追尾拿到纵向法线、侧擦拿到横向法线。
export function kartContact(a, b) {
  const ca = Math.cos(a.yaw);
  const sa = Math.sin(a.yaw);
  const cb = Math.cos(b.yaw);
  const sb = Math.sin(b.yaw);
  // 矩形中心（世界系）= 状态原点 + 车头方向 × KART_CZ（车头 = (sinψ, cosψ)）
  const ax = a.x + sa * KART_CZ;
  const az = a.z + ca * KART_CZ;
  const bx = b.x + sb * KART_CZ;
  const bz = b.z + cb * KART_CZ;
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) + Math.abs(dz) < 1e-9) return null; // 中心重合退化（旧口径同款守卫）
  // 矩形四角 = 中心 ± 右向·halfW ± 车头·halfL（车体 +x = (cosψ, −sinψ)）
  const rx = KART_SHAPE.halfW;
  const corners = (cx, cz, c, s) => {
    const hx = c * rx;
    const hz = -s * rx;
    const fx = s * KART_HL;
    const fz = c * KART_HL;
    return [
      [cx + hx + fx, cz + hz + fz],
      [cx + hx - fx, cz + hz - fz],
      [cx - hx + fx, cz - hz + fz],
      [cx - hx - fx, cz - hz - fz],
    ];
  };
  const ca4 = corners(ax, az, ca, sa);
  const cb4 = corners(bx, bz, cb, sb);
  const axes = [
    [ca, -sa], [sa, ca], // a 的右向/车头
    [cb, -sb], [sb, cb], // b 的右向/车头
  ];
  // 相对速度（世界系）：接近轴决胜用（世界速度 = 车体系经 yaw 旋出，同冲量段口径）
  const rvx = (b.vx * cb + b.vz * sb) - (a.vx * ca + a.vz * sa);
  const rvz = (-b.vx * sb + b.vz * cb) - (-a.vx * sa + a.vz * ca);

  let minOverlap = Infinity;
  for (const [ux, uz] of axes) {
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const [px, pz] of ca4) {
      const d = px * ux + pz * uz;
      if (d < aMin) aMin = d;
      if (d > aMax) aMax = d;
    }
    for (const [px, pz] of cb4) {
      const d = px * ux + pz * uz;
      if (d < bMin) bMin = d;
      if (d > bMax) bMax = d;
    }
    const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
    if (overlap <= 0) return null;
    if (overlap < minOverlap) minOverlap = overlap;
  }
  // 近平局轴集合里选相对速度投影最大者（接近轴 = 实际发生侵入的方向）
  let bestScore = -Infinity;
  let nx = 0;
  let nz = 0;
  for (const [ux, uz] of axes) {
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const [px, pz] of ca4) {
      const d = px * ux + pz * uz;
      if (d < aMin) aMin = d;
      if (d > aMax) aMax = d;
    }
    for (const [px, pz] of cb4) {
      const d = px * ux + pz * uz;
      if (d < bMin) bMin = d;
      if (d > bMax) bMax = d;
    }
    const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
    if (overlap > minOverlap + AXIS_EPS) continue;
    const approaching = Math.abs(rvx * ux + rvz * uz);
    if (approaching > bestScore) {
      bestScore = approaching;
      // 法线方向 a→b：按中心在该轴上的投影定号
      const sgn = dx * ux + dz * uz >= 0 ? 1 : -1;
      nx = ux * sgn;
      nz = uz * sgn;
    }
  }
  // 接触点 = 两箱沿法线相互最深的支撑点中点（面-面接触落在重叠带内）
  let aBest = -Infinity;
  let aPt = ca4[0];
  let bBest = Infinity;
  let bPt = cb4[0];
  for (const p of ca4) {
    const d = p[0] * nx + p[1] * nz;
    if (d > aBest) { aBest = d; aPt = p; }
  }
  for (const p of cb4) {
    const d = p[0] * nx + p[1] * nz;
    if (d < bBest) { bBest = d; bPt = p; }
  }
  return {
    nx, nz,
    depth: minOverlap,
    cx: (aPt[0] + bPt[0]) * 0.5,
    cz: (aPt[1] + bPt[1]) * 0.5,
  };
}

// 供测试/发车格自洽检查：两车形状是否重叠
export function kartsOverlap(a, b) {
  return kartContact(a, b) !== null;
}

// 成对碰撞分离与响应：等质量 + 法向冲量（恢复系数 0.4）框架不变，法线/接触点
// 随 SAT 矩形修正；偏航扰动方向取接触点真实力矩（旧实现按数组奇偶定正负）。
// states: drivingState[]（含玩家与 AI）。返回发生接触的对数（遥测用）。
export function resolveKartCollisions(states) {
  let contacts = 0;
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i];
      const b = states[j];
      const hit = kartContact(a, b);
      if (!hit) continue;
      contacts++;
      const { nx, nz, depth, cx, cz } = hit;
      // 位置各退一半（分离位移；帧内闭合速度 < 形状厚度，无隧穿，见交付说明推导）
      a.x -= nx * depth * 0.5;
      a.z -= nz * depth * 0.5;
      b.x += nx * depth * 0.5;
      b.z += nz * depth * 0.5;
      // 法向相对速度 → 等质量冲量（世界系）
      const avx = a.vx * Math.cos(a.yaw) + a.vz * Math.sin(a.yaw);
      const avz = -a.vx * Math.sin(a.yaw) + a.vz * Math.cos(a.yaw);
      const bvx = b.vx * Math.cos(b.yaw) + b.vz * Math.sin(b.yaw);
      const bvz = -b.vx * Math.sin(b.yaw) + b.vz * Math.cos(b.yaw);
      const vrel = (bvx - avx) * nx + (bvz - avz) * nz;
      if (vrel < 0) { // 相互接近才施加
        const imp = (-(1 + 0.4) * vrel) / 2;
        const avx2 = avx - imp * nx;
        const avz2 = avz - imp * nz;
        const bvx2 = bvx + imp * nx;
        const bvz2 = bvz + imp * nz;
        // 世界速度转回车体
        const back = (e, wx, wz) => {
          const c = Math.cos(e.yaw);
          const s = Math.sin(e.yaw);
          e.vx = wx * c - wz * s;
          e.vz = wx * s + wz * c;
        };
        back(a, avx2, avz2);
        back(b, bvx2, bvz2);
        // 偏航扰动：接触点力矩方向（力臂归一到 0.9m 克制量级，幅值口径沿用旧 kick）
        const kick = clamp(Math.abs(vrel) * 0.05, 0, 0.35);
        const ta = (cx - a.x) * nz - (cz - a.z) * nx; // a 受 −n 冲量的力矩符号
        const tb = (cz - b.z) * nx - (cx - b.x) * nz; // b 受 +n 冲量的力矩符号
        a.yawRate += clamp(ta / 0.9, -1, 1) * kick;
        b.yawRate += clamp(tb / 0.9, -1, 1) * kick;
      }
    }
  }
  return contacts;
}

// 建一套参赛者（纯状态；AI 车体视觉经 makeVisual 工厂回调创建并挂在 entrant.visual，
// 本模块保持零渲染依赖——工厂由调用方注入）。tier: AI_TIERS 的 id 字符串。
export function createRaceEntrants(tier, track, makeVisual) {
  const PALETTE = [
    { color: 0x1f8a9e, number: '07' },
    { color: 0x6b4fa0, number: '23' },
    { color: 0xc9971f, number: '11' },
  ];
  const entrants = [{
    id: 'player', name: '你 · #88', isPlayer: true,
    st: createDrivingState(), finished: false, finishTime: 0, finishOrder: 0,
    color: 0xb61e2c, number: '88',
  }];
  PALETTE.forEach((pal, i) => {
    entrants.push({
      id: `ai-${i}`, name: `对手 · #${pal.number}`, isPlayer: false,
      tier,
      st: createDrivingState(), finished: false, finishTime: 0, finishOrder: 0,
      color: pal.color, number: pal.number,
      visual: makeVisual ? makeVisual(pal.color, pal.number) : null,
    });
  });
  // 全部摆上发车格并初始化进度追踪。玩家排末位发车（P4，超位是比赛乐趣），
  // AI 依次占 P1-P3。
  const order = entrants.map((e, i) => ({ e, slot: e.isPlayer ? entrants.length - 1 : i - 1 }));
  for (const { e, slot } of order) {
    const pose = gridPose(track, slot);
    e.st.x = pose.x;
    e.st.z = pose.z;
    e.st.yaw = pose.yaw;
    e.st.s = track.nearest(pose.x, pose.z, -1).s;
    e.st.hintIdx = track.startIndex;
    e.gridSlot = slot;
  }
  return entrants;
}
