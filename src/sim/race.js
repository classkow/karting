// ————— 比赛状态（纯数学，零渲染依赖，可 node --test 直接断言）—————
// 发车格 / 排名 / 完赛流 / 车间碰撞。视觉（AI 车体克隆）与交互（菜单/结算）不在此。

import { createDrivingState } from './driving.js';

export const RACE_LAPS = 3;      // 3 圈制
export const KART_RADIUS = 1.15; // 车间碰撞半径（米，车长 2.1 的一半略收）
export const GRID_ROW = 4.2;     // 发车格排距（米）
export const GRID_COL = 1.4;     // 发车格横错（米，右正）

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 发车格位姿：slot 0 最靠前（P1），玩家默认 P4（最后一排内圈）
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
// entrants: [{ id, isPlayer, st(drivingState), finished, finishTime, finishOrder }]
export function rankEntrants(entrants) {
  return [...entrants].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return (b.st.total ?? 0) - (a.st.total ?? 0);
  });
}

// 玩家（或任一车）冲线：记录完赛序号与用时；返回其名次（1 起）
export function finishEntrant(entrants, e, raceTime) {
  if (e.finished) return -1;
  e.finished = true;
  e.finishTime = raceTime;
  e.finishOrder = entrants.filter((x) => x.finished).length;
  return rankEntrants(entrants).indexOf(e) + 1;
}

// 成对碰撞分离：等质量 + 法向冲量（恢复系数 0.4）+ 轻微 yaw 扰动。
// states: drivingState[]（含玩家与 AI）。返回发生接触的对数（遥测用）。
export function resolveKartCollisions(states) {
  let contacts = 0;
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const a = states[i];
      const b = states[j];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= KART_RADIUS * 2 || dist < 1e-6) continue;
      contacts++;
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = KART_RADIUS * 2 - dist;
      // 位置各退一半
      a.x -= nx * overlap * 0.5;
      a.z -= nz * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.z += nz * overlap * 0.5;
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
        // 轻微 yaw 扰动（被顶一下的感觉）
        const kick = clamp(Math.abs(vrel) * 0.05, 0, 0.35);
        a.yawRate += (i % 2 ? 1 : -1) * kick;
        b.yawRate += (j % 2 ? 1 : -1) * kick;
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
