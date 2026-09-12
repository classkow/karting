import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackModel } from '../src/sim/track.js';
import { resetLapTiming } from '../src/sim/driving.js';
import {
  createRaceEntrants, gridPose, rankEntrants, finishEntrant,
  resolveKartCollisions, RACE_LAPS, GRID_ROW, GRID_COL, KART_RADIUS,
} from '../src/sim/race.js';

const track = createTrackModel();

test('比赛：发车格全部在起点线后、双排错列、玩家末位', () => {
  const entrants = createRaceEntrants('elite', track, null);
  assert.equal(entrants.length, 4);
  assert.equal(entrants.filter((e) => e.isPlayer).length, 1);
  for (const e of entrants) {
    assert.ok(e.gridSlot >= 0 && e.gridSlot <= 3, `slot=${e.gridSlot}`);
    // 发车位在起点线后（进度为负 → wrap 到 L-δ）
    const distBehind = (track.startPose.s - e.st.s + track.length) % track.length;
    assert.ok(distBehind > 0.5 && distBehind < GRID_ROW * 3, `slot ${e.gridSlot} 距线 ${distBehind.toFixed(1)}m`);
    // 朝向切线方向（yaw 与起点同向：都是 +x 出发 ≈ π/2）
    assert.ok(Math.abs(e.st.yaw - track.startPose.yaw) < 0.3, `yaw 偏差 ${Math.abs(e.st.yaw - track.startPose.yaw).toFixed(2)}`);
  }
  const player = entrants.find((e) => e.isPlayer);
  assert.equal(player.gridSlot, 3, '玩家应末位发车（P4）');
  // 横向错列：同排两车 lat 符号相反、间距 ≈ 2·GRID_COL
  const row0 = entrants.filter((e) => e.gridSlot % 2 === 0 || e.gridSlot === 0);
  const slots = entrants.map((e) => e.gridSlot).sort((a, b) => a - b);
  assert.deepEqual(slots, [0, 1, 2, 3]);
  assert.ok(row0.length === 2);
  const [a, b] = entrants.filter((e) => e.gridSlot <= 1).sort((x, y) => x.gridSlot - y.gridSlot);
  const gap = Math.hypot(a.st.x - b.st.x, a.st.z - b.st.z);
  assert.ok(gap > GRID_COL * 1.4 && gap < GRID_COL * 2.6, `同排间距 ${gap.toFixed(2)}m`);
  // 相邻两车互不重叠（碰撞半径口径）
  for (let i = 0; i < entrants.length; i++) {
    for (let j = i + 1; j < entrants.length; j++) {
      const d = Math.hypot(entrants[i].st.x - entrants[j].st.x, entrants[i].st.z - entrants[j].st.z);
      assert.ok(d > KART_RADIUS * 1.6, `${i}-${j} 间距 ${d.toFixed(2)}m 过近`);
    }
  }
});

test('比赛：排名按累计里程（跨线连续），完赛者按完赛用时优先', () => {
  const entrants = createRaceEntrants('elite', track, null);
  const [a, b, c, player] = entrants;
  // total = 相对起点线的有符号累计里程：b 刚过线 5m（一圈跑完 389m→total=L+5 口径略），
  // 直接构造跨线场景：a 停在.Line 前 3m（total=−3），b 过线 5m（total=+5）→ b 应排前
  a.st.total = -3;
  b.st.total = 5;
  c.st.total = track.length - 5; // 差 5m 一整圈：还没过线，但里程大 → 排最前
  player.st.total = 50;
  let ranked = rankEntrants(entrants);
  assert.deepEqual(ranked.map((e) => e.id), [c.id, player.id, b.id, a.id]);
  // c 完赛 → 按完赛排第一，其余按 total
  finishEntrant(entrants, c, 95.3);
  ranked = rankEntrants(entrants);
  assert.equal(ranked[0].id, c.id);
  assert.equal(ranked[0].finishOrder, 1);
});

test('比赛：完赛判定（3 圈）与重复冲线幂等', () => {
  const entrants = createRaceEntrants('rookie', track, null);
  const e = entrants[0];
  e.st.lap = RACE_LAPS;
  const pos = finishEntrant(entrants, e, 120.5);
  assert.equal(pos, 1);
  assert.equal(e.finished, true);
  assert.equal(e.finishTime, 120.5);
  // 再冲一次不算
  e.st.lap = RACE_LAPS + 1;
  assert.equal(finishEntrant(entrants, e, 200), -1);
  assert.equal(e.finishTime, 120.5);
});

test('比赛：碰撞分离——重叠的车被推开且法向速度交换', () => {
  const entrants = createRaceEntrants('rookie', track, null);
  const [a, b] = entrants;
  // 摆成头对头逼近：a 朝 +z 前进，b 掉头朝 −z 前进（车体 vz 为正 = 各自向前）
  a.st.x = 0; a.st.z = 0; a.st.yaw = 0; a.st.vx = 0; a.st.vz = 10;
  b.st.x = 0.1; b.st.z = 0.5; b.st.yaw = Math.PI; b.st.vx = 0; b.st.vz = 10;
  const contacts = resolveKartCollisions(entrants.map((e) => e.st));
  assert.equal(contacts, 1);
  const dist = Math.hypot(b.st.x - a.st.x, b.st.z - a.st.z);
  assert.ok(dist >= KART_RADIUS * 2 - 0.15, `分离后间距 ${dist.toFixed(2)}m（应 ≈ ${KART_RADIUS * 2}）`);
  // 迎面相对速度应显著衰减（冲量交换），且没有穿模到另一侧
  const rel = Math.abs(a.st.vz) + Math.abs(b.st.vz);
  assert.ok(rel < 8, `分离后车体速度和 ${rel.toFixed(1)}（迎面 10+10 应大幅衰减）`);
});

test('比赛：初帧排名——total 相等按 gridSlot 升序破序，玩家 P4（P2-1，变红抽查锚点）', () => {
  const entrants = createRaceEntrants('elite', track, null);
  for (const e of entrants) resetLapTiming(e.st, 0, track);
  // 真实发车格的 total 有 mm 级浮点差（横向偏移改变最近点投影），显示上同为 −8.4m——
  // 排名不能依赖浮点运气，必须按 gridSlot 破序。这里强制同排 total 精确相等。
  const bySlot = (s) => entrants.find((e) => e.gridSlot === s);
  bySlot(0).st.total = -4.2;
  bySlot(1).st.total = -4.2;
  bySlot(2).st.total = -8.4;
  const player = entrants.find((e) => e.isPlayer);
  player.st.total = -8.4;
  let ranked = rankEntrants(entrants);
  assert.equal(ranked.indexOf(player), 3, `初帧玩家应 P4，实际 P${ranked.indexOf(player) + 1}`);
  // 构造"数组序在前但 slot 更大"的精确平手：玩家（数组0/slot3）vs ai-0（数组1/slot0）
  player.st.total = entrants[1].st.total = -8.4;
  ranked = rankEntrants(entrants);
  assert.ok(ranked.indexOf(entrants[1]) < ranked.indexOf(player),
    'total 相等时 slot 小者应在前（ai-0 slot0 应排在玩家 slot3 前）');
});

test('比赛：gridPose 网格横向偏移方向交替', () => {
  const p0 = gridPose(track, 0);
  const p1 = gridPose(track, 1);
  // slot 0 与 1 同排：纵差小、横向差 ≈ 2·GRID_COL
  // 前向单位向量 = (sinψ, cosψ)，体 +x = (cosψ, −sinψ)
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const along = Math.abs(dx * Math.sin(p0.yaw) + dz * Math.cos(p0.yaw));
  const across = Math.abs(dx * Math.cos(p0.yaw) - dz * Math.sin(p0.yaw));
  assert.ok(along < 0.5, `同排纵向差 ${along.toFixed(2)}m 应≈0`);
  assert.ok(Math.abs(across - GRID_COL * 2) < 0.4, `同排横向差 ${across.toFixed(2)}m 应≈${GRID_COL * 2}`);
});
