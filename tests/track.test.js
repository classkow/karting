import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackModel, TRACK_WIDTH } from '../src/sim/track.js';

const track = createTrackModel();

test('赛道：闭合连续（首尾采样间距 ≈ 采样步长）', () => {
  const s = track.samples;
  const n = s.length;
  const gap = Math.hypot(s[n - 1].x - s[0].x, s[n - 1].z - s[0].z);
  const step = track.length / n;
  assert.ok(gap < step * 1.6, `gap=${gap.toFixed(3)} step=${step.toFixed(3)}`);
});

test('赛道：周长在合理区间（350–800m 的卡丁车冲刺赛道）', () => {
  assert.ok(track.length > 350 && track.length < 800, `length=${track.length.toFixed(1)}m`);
});

test('赛道：采样弧长均匀（相邻间距偏差 < 2%）', () => {
  const s = track.samples;
  const step = track.length / s.length;
  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    const b = s[(i + 1) % s.length];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    assert.ok(Math.abs(d - step) < step * 0.02, `i=${i} d=${d.toFixed(4)} step=${step.toFixed(4)}`);
  }
});

test('赛道：切线为单位向量且与采样行进方向一致（进度推进为正）', () => {
  const s = track.samples;
  for (let i = 0; i < s.length; i++) {
    assert.ok(Math.abs(Math.hypot(s[i].tx, s[i].tz) - 1) < 1e-9);
  }
  // 沿 s 推进 10m，与 pointAt 路径一致地前进（不回退多圈）
  const p0 = track.pointAt(100);
  const p1 = track.pointAt(110);
  const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  assert.ok(d > 8 && d < 12, `d=${d.toFixed(2)}`);
});

test('赛道：最近点查询——中心线上横向偏移 ≈ 0（<1mm，弦插值 vs 弧线的固有偏差），进度连续', () => {
  // 沿中心线取几个位置验证
  for (const s of [0, 50, 137.5, track.length - 3]) {
    const p = track.pointAt(s);
    const n = track.nearest(p.x, p.z, -1);
    assert.ok(Math.abs(n.lat) < 1e-2, `s=${s} lat=${n.lat}`);
    assert.ok(Math.abs(track.signedDelta(n.s - s)) < 0.8, `s=${s} got=${n.s.toFixed(3)}`);
  }
});

test('赛道：横向偏移符号——中心线右侧为正', () => {
  // 在起点处取右法线方向偏移 2m 的点
  const sp = track.samples[track.startIndex];
  const nx = sp.tz;
  const nz = -sp.tx;
  const n = track.nearest(sp.x + nx * 2, sp.z + nz * 2, -1);
  assert.ok(n.lat > 1.5 && n.lat < 2.5, `lat=${n.lat.toFixed(3)}`);
});

test('赛道：绕圈检测——正向跨起点算一圈，反向不算', () => {
  const L = track.length;
  const s0 = L - 2; // 起点线前 2m
  assert.equal(track.crossedStartForward(s0, 1), true); // 越过起点
  assert.equal(track.crossedStartForward(1, s0), false); // 倒退回去不是
  assert.equal(track.crossedStartForward(100, 120), false); // 正常推进
});

test('赛道：起点位姿在起跑直道上且航向与切线一致', () => {
  const p = track.startPose;
  // 起跑直道沿 +x 行驶（控制点 1→2 航向）：yaw ≈ +π/2
  assert.ok(Math.abs(Math.sin(p.yaw) - 1) < 0.3, `yaw=${p.yaw}`);
  const sp = track.samples[track.startIndex];
  assert.ok(Math.abs(sp.x - p.x) < 1e-9 && Math.abs(sp.z - p.z) < 1e-9);
});

test('赛道：弯道曲率明显高于直道（路肩布置依据）', () => {
  let kMax = 0;
  let kMinStraight = Infinity;
  for (const sp of track.samples) {
    kMax = Math.max(kMax, Math.abs(sp.k));
    // 直道判定：曲率小于 1/60（半径 >60m）
    if (Math.abs(sp.k) < 1 / 60) kMinStraight = Math.min(kMinStraight, Math.abs(sp.k));
  }
  assert.ok(kMax > 1 / 25, `kMax=${kMax.toFixed(4)}（最小弯半径 ${(1 / kMax).toFixed(1)}m）`);
  assert.ok(kMax < 1 / 8, `弯不能小到不可驾驶：kMax=${kMax.toFixed(4)}`);
});

test('赛道：宽度口径一致', () => {
  assert.equal(track.halfWidth, TRACK_WIDTH / 2);
});
