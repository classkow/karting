import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackModel } from '../src/sim/track.js';
import { resetLapTiming } from '../src/sim/driving.js';
import {
  createRaceEntrants, gridPose, rankEntrants, finishEntrant,
  resolveKartCollisions, kartsOverlap, kartContact,
  RACE_LAPS, GRID_ROW, GRID_COL, KART_SHAPE,
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
  // 相邻两车互不重叠（新碰撞形状口径：SAT 旋转矩形，车宽 1.445/车长 1.69 包络）
  for (let i = 0; i < entrants.length; i++) {
    for (let j = i + 1; j < entrants.length; j++) {
      assert.ok(!kartsOverlap(entrants[i].st, entrants[j].st),
        `${i}-${j} 发车格即碰撞（新形状口径）`);
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

// ————— 碰撞形状（BUG 1 修正：等半径圆 → SAT 旋转矩形）—————
// 主报障场景 = 侧向/斜向：旧 KART_RADIUS=1.15 圆把侧向判定放大到 ±2.3m（车宽 3.2 倍）。
// 场景矩阵：侧擦不误触发 / 侧贴仍触发且法线横向 / 追尾仍触发且速度交换 /
// 斜碰（T-bone）法线正确 / 正碰深穿透分离不穿模。

function mkKart(x, z, yaw, vz = 0, vx = 0) {
  return { x, z, yaw, vz, vx, yawRate: 0 };
}

test('碰撞：侧向擦碰不再隔空误触发（1.6m 间距无接触，旧圆口径 2.3m 必撞）', () => {
  const a = mkKart(0, 0, 0);
  const b = mkKart(1.6, 0, 0); // 并排同向，横向间距 1.6m > 车宽 1.445m
  assert.equal(kartsOverlap(a, b), false, '并排 1.6m 不应接触');
  const contacts = resolveKartCollisions([a, b]);
  assert.equal(contacts, 0);
  assert.equal(a.x, 0, '无接触不得产生分离位移');
});

test('碰撞：侧贴仍触发，法线横向、横向推开+接触点偏航扰动', () => {
  const a = mkKart(0, 0, 0);
  const b = mkKart(1.35, 0, 0); // 1.35m < 1.445m：轮对轮重叠
  const hit = kartContact(a, b);
  assert.ok(hit, '侧贴应接触');
  assert.ok(Math.abs(hit.nx) > 0.9, `法线应横向 nx=${hit.nx.toFixed(3)}`);
  resolveKartCollisions([a, b]);
  const after = Math.abs(b.x - a.x);
  assert.ok(after >= KART_SHAPE.halfW * 2 - 0.05, `分离后横向间距 ${after.toFixed(3)}m（应 ≈ ${(KART_SHAPE.halfW * 2).toFixed(3)}）`);
});

test('碰撞：追尾仍触发——纵向法线 + 前后速度交换感', () => {
  const a = mkKart(0, 0, 0, 10);   // 后车 10m/s
  const b = mkKart(0, 1.6, 0, 2);  // 前车同向 2m/s，尾线 1.6−0.71=0.89 < 头线 0.98 → 接触
  const hit = kartContact(a, b);
  assert.ok(hit, '追尾应接触');
  assert.ok(Math.abs(hit.nz) > 0.9, `法线应纵向 nz=${hit.nz.toFixed(3)}`);
  const contacts = resolveKartCollisions([a, b]);
  assert.equal(contacts, 1);
  // 冲量沿纵向交换：后车显著减速、前车加速，仍同向前行
  assert.ok(a.vz < 6 && a.vz > 0, `后车 vz=${a.vz.toFixed(2)}（应减速但不弹回）`);
  assert.ok(b.vz > a.vz, `前车 vz=${b.vz.toFixed(2)} 应快于后车（速度交换感）`);
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  assert.ok(dist > 1.55, `分离后中心距 ${dist.toFixed(2)}m（应 ≈ 车长 1.69 附近）`);
});

test('碰撞：斜碰（T-bone）分离法线正确——横穿车撞静止车侧面', () => {
  // a 静止朝 +z；b 朝 −x 横穿，车头撞 a 右侧：b 头线 1.5−0.98=0.52 < a 右缘 0.72 → 接触
  const a = mkKart(0, 0, 0, 0);
  const b = mkKart(1.5, 0.2, -Math.PI / 2, 5);
  const hit = kartContact(a, b);
  assert.ok(hit, 'T-bone 应接触');
  assert.ok(Math.abs(hit.nx) > 0.9, `法线应横向 nx=${hit.nx.toFixed(3)}（撞的是侧面）`);
  const contacts = resolveKartCollisions([a, b]);
  assert.equal(contacts, 1);
  // a 从 +x 侧（左侧面）受撞，被推离撞击点 → −x（分离位移 ≈ depth/2）；b 的横穿速度被削
  assert.ok(a.x < -0.05, `a 应被推向 −x（x=${a.x.toFixed(2)}）`);
  assert.ok(a.vx < 0, `a 获得向 −x 的速度（vx=${a.vx.toFixed(2)}）`);
  const bWorldVx = b.vx * Math.cos(b.yaw) + b.vz * Math.sin(b.yaw);
  assert.ok(bWorldVx > -4.5, `b 横穿速度应衰减（world vx=${bWorldVx.toFixed(2)}，初值 −5）`);
});

test('碰撞：正碰深穿透（旧用例等价场景）——分离后大幅衰减、不穿到另一侧', () => {
  // 头对头逼近：深度重叠 0.5m 级别，两轴深度近平局 → 接近轴决胜须给出纵向法线
  const a = mkKart(0, 0, 0, 10);
  const b = mkKart(0, 0.5, Math.PI, 10); // b 朝 −z 前进（车体 vz 为正 = 各自向前）
  const contacts = resolveKartCollisions([a, b]);
  assert.equal(contacts, 1);
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  assert.ok(dist > 1.3, `分离后间距 ${dist.toFixed(2)}m`);
  const rel = Math.abs(a.vz) + Math.abs(b.vz);
  assert.ok(rel < 9, `分离后车体速度和 ${rel.toFixed(1)}（迎面 10+10 应大幅衰减）`);
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
