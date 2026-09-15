import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackModel } from '../src/sim/track.js';
import { TRACK_WIDTH_M } from '../src/sim/trackData.js';
import { REPLICA_BOUNDARY_POINTS } from '../src/sim/trackBoundary.js';

const track = createTrackModel();

test('赛道：闭合连续（首尾采样间距 ≈ 采样步长）', () => {
  const s = track.samples;
  const n = s.length;
  const gap = Math.hypot(s[n - 1].x - s[0].x, s[n - 1].z - s[0].z);
  const step = track.length / n;
  assert.ok(gap < step * 1.6, `gap=${gap.toFixed(3)} step=${step.toFixed(3)}`);
});

test('赛道：周长在合理区间（宽度锚标定下 ≈858m，包络导出区间 750–960m）', () => {
  // 断言变更白名单（§2.3 口径裁定：路宽优先于总长）：旧值 1000–1400m 系按图注 1200m 标定；
  // 新赛道以底部直道内沿=12m 为宽度锚（k=0.15584 m/px），中轴长由几何自然导出 ≈858m。
  // 区间推导：俯视包络 ≈182m×97m，凸包周长 ≈558m；含发卡填充系数 1.3–1.7 → 725–948m，取 750–960。
  assert.ok(track.length > 750 && track.length < 960, `length=${track.length.toFixed(1)}m`);
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
  // 断言变更白名单（赛道 1:1 复刻）：起步直道按图面比赛方向自东向西（−x）行驶，
  // 航向 yaw ≈ −π/2（sin ≈ −1）；旧赛道沿 +x（sin ≈ +1）。
  assert.ok(Math.abs(Math.sin(p.yaw) + 1) < 0.3, `yaw=${p.yaw}`);
  const sp = track.samples[track.startIndex];
  assert.ok(Math.abs(sp.x - p.x) < 1e-9 && Math.abs(sp.z - p.z) < 1e-9);
});

test('赛道：弯道曲率明显高于直道（路肩布置依据）', () => {
  let kMax = 0;
  for (const sp of track.samples) {
    kMax = Math.max(kMax, Math.abs(sp.k));
  }
  assert.ok(kMax > 1 / 25, `kMax=${kMax.toFixed(4)}（最小弯半径 ${(1 / kMax).toFixed(1)}m）`);
  // 断言变更白名单（赛道 1:1 复刻）：旧上界 1/8（R>8m）对应旧程序化赛道；
  // 复刻赛道含图面发卡弯，平滑后最小弯径 ≈4.4m。物理下界：卡丁车满锁最小
  // 转弯半径 ≈ L/tan(δmax) ≈ 1.05/0.577 ≈ 1.8m，取 3m 界 = 物理下界 + 65% 裕度。
  assert.ok(kMax < 1 / 3, `弯不能小到不可驾驶：kMax=${kMax.toFixed(4)}`);
});

test('赛道：宽度口径一致（复刻赛道取图注 10–14m 均值 12m）', () => {
  // 断言变更白名单（赛道 1:1 复刻）：宽度单源从 TRACK_WIDTH(7) 改为 trackData 的 TRACK_WIDTH_M(12)。
  assert.equal(track.halfWidth, TRACK_WIDTH_M / 2);
  assert.equal(track.width, TRACK_WIDTH_M);
  assert.equal(TRACK_WIDTH_M, 12);
});

// ————— 1:1 复刻几何断言（§2.5 六项，先红后绿记录见交付说明）—————

test('复刻·几何 #1：中轴居中度——中心线采样点到最近边界线距离中位数 ≈ 半宽（±25%）', () => {
  // §2.5-1 key 断言。反例基线：09-13 把边界线当中心线追 → 派发方实测 64% 采样点距边界 <2m；
  // 本单构造红（把边界点云当中心线喂入）p50=0.59m、73%<2m。正确中轴到两侧边界最近距 ≈ 半宽 6m。
  const dbs = track.samples.map((p) => {
    let best = Infinity;
    for (const q of REPLICA_BOUNDARY_POINTS) { const d = (q[0] - p.x) ** 2 + (q[1] - p.z) ** 2; if (d < best) best = d; }
    return Math.sqrt(best);
  });
  dbs.sort((a, b) => a - b);
  const med = dbs[dbs.length >> 1];
  const hw = track.halfWidth;
  assert.ok(Math.abs(med - hw) / hw < 0.25, `中位距边界=${med.toFixed(2)}m vs 半宽=${hw}m（应 ±25% 内）`);
  const under2 = dbs.filter((d) => d < 2).length / dbs.length;
  assert.ok(under2 < 0.05, `${(under2 * 100).toFixed(1)}% 采样点距边界<2m（应≈0；09-13 为 64%）`);
});

test('复刻·几何 #2：异段最小间距 > 路宽（两腿路面不重叠，净距 >3m）', () => {
  // §2.5-2。track.nearest 靠最近采样点定横向归属，两腿一旦贴近横向判读会跳到另一腿（空气墙根因）。
  // 反例基线：09-13 实测 0.07m（路面完全重叠）。判据：弧长相隔 >40m 的采样点最近距 > 路宽 12m。
  const S = track.samples, step = track.length / S.length, gap = Math.ceil(40 / step);
  let m = Infinity;
  for (let i = 0; i < S.length; i++) {
    for (let j = i + gap; j < S.length; j++) {
      if (S.length - (j - i) < gap) break; // 环形：两端弧长相隔也需 >40m
      const d = (S[i].x - S[j].x) ** 2 + (S[i].z - S[j].z) ** 2; if (d < m) m = d;
    }
  }
  const minSep = Math.sqrt(m);
  assert.ok(minSep > track.width, `异段最小间距=${minSep.toFixed(2)}m（应 > 路宽 ${track.width}m；09-13 为 0.07m）`);
  assert.ok(minSep - track.width > 3, `两腿路面净距=${(minSep - track.width).toFixed(2)}m（应 >3m）`);
});

test('复刻·几何 #3：空气墙实测——沿路面 lat=±5m 绕行，触墙帧=0 且左右判读翻转帧=0', () => {
  // §2.5-3。判读口径同 driving.js（track.nearest 含 hint 递进）。反例基线：09-13 lat+5 触墙 48 帧。
  // 半宽 6m、软墙 wallMargin=5m → 触墙判据 |lat|>11m；横向偏移 ±5m（半宽 83%）绕行应在路面内。
  const S = track.samples;
  const scan = (latT) => {
    let wall = 0, flip = 0, prevSign = 0, hint = -1;
    for (let i = 0; i < S.length; i++) {
      const sp = S[i]; const x = sp.x + sp.tz * latT, z = sp.z - sp.tx * latT;
      const n = track.nearest(x, z, hint); hint = n.idx;
      if (Math.abs(n.lat) > track.halfWidth + 5.0) wall++;
      const s = Math.sign(n.lat); if (prevSign && s && s !== prevSign) flip++; prevSign = s;
    }
    return { wall, flip };
  };
  for (const latT of [5, -5]) {
    const r = scan(latT);
    assert.ok(r.wall === 0 && r.flip === 0, `lat=${latT}: 触墙=${r.wall} 翻转=${r.flip}（应 0/0）`);
  }
});

test('复刻·几何 #5：单环拓扑——中心线自交数 = 0', () => {
  // §2.5-5。反例基线：09-13 点列跳线致 Catmull-Rom 自交（实测 3 处）。相邻弦段两两求交（跳过共端点）。
  const P = track.samples.map((p) => ({ x: p.x, y: p.z }));
  const o = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const si = (a, b, c, d) => { const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b); return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)); };
  let n = 0;
  for (let i = 0; i < P.length; i++) {
    const i2 = (i + 1) % P.length;
    for (let j = i + 2; j < P.length; j++) {
      if (i === 0 && j === P.length - 1) continue;
      if (si(P[i], P[i2], P[j], P[(j + 1) % P.length])) n++;
    }
  }
  assert.equal(n, 0, `中心线自交数=${n}（应 0）`);
});

// ————— 标定/口径白名单断言（§2.3 形状优先、路宽优先于总长）—————

test('复刻：周长 = 形状×宽度锚 导出值（图注 1200m 与图面不自洽，见交付说明三方对账）', () => {
  // §2.3 四法极差最高 60%，图注 1200m/127m/10–14m 互斥。取路宽锚（底部直道内沿 12m，k=0.15584）
  // 后中轴长由几何导出 ≈858m。带宽 = 858m ±10%（提取/平滑误差）：772–944m。
  assert.ok(track.length > 772 && track.length < 944, `length=${track.length.toFixed(1)}m`);
});

test('复刻：12 弯（曲率行程聚簇计数，阈值 R<60m、最小弯段 8m、相邻缝隙 ≤6m 可并）', () => {
  // §2.5-6：弯数以图面 MP1–MP12 标注位与中心线实际弯位的对应为准（弯序对照表见交付说明），
  // 不用曲率阈值硬凑 12。此处仅作几何回归的宽松带：相邻弯（双发卡）在阈值下可并簇，故允许 10–14。
  const flag = track.samples.map((s) => Math.abs(s.k) > 1 / 60);
  let runs = 0;
  let run = 0;
  let gap = 0;
  for (let i = 0; i < flag.length; i++) {
    if (flag[i]) { run++; gap = 0; } else {
      gap++;
      if (run > 0 && gap > 6) { if (run >= 8) runs++; run = 0; }
    }
  }
  if (run >= 8) runs++;
  assert.ok(runs >= 10 && runs <= 14, `corner runs=${runs}（应 10–14，图面 12 弯）`);
});

test('复刻：最长直道（底部直道）在宽度锚口径下 ≈63m（图注 127m 不自洽）', () => {
  // §2.3 裁定：形状优先，图注 127m 系把边界线曲折长度当中心线（09-13 病灶）或含全场。
  // 图面唯一长直道＝底部直道，平直段 ≈405px × k(0.15584) ≈ 63m。断言带 45–85m。
  let best = 0;
  let run = 0;
  for (let i = 0; i < track.samples.length * 2; i++) {
    if (Math.abs(track.samples[i % track.samples.length].k) < 1 / 300) { run++; if (run > best) best = run; } else run = 0;
  }
  assert.ok(best > 45 && best < 85, `longest straight=${best}m`);
});

test('复刻：整体轮廓包络（俯视 bbox 对齐图面，宽度锚 + 质心原点）', () => {
  // 原点=中心线质心（世界系），k=0.15584。图面包络 1258×710px → 中轴内缩半宽后 x-span≈182m、z-span≈97m。
  // 断言带宽 ±12%（提取/平滑误差）+ 质心近原点（原点对称性）。旧值系按 1200m 标定（x[-90.5,99.1] z[-53,53.9]）。
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of track.samples) {
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
  }
  assert.ok(maxX - minX > 160 && maxX - minX < 205, `x-span=${(maxX - minX).toFixed(1)}m`);
  assert.ok(maxZ - minZ > 85 && maxZ - minZ < 110, `z-span=${(maxZ - minZ).toFixed(1)}m`);
  assert.ok(Math.abs((maxX + minX) / 2) < 8 && Math.abs((maxZ + minZ) / 2) < 8, `质心偏离原点（应近 0）`);
});

test('复刻：平滑后最小弯径 ≥3m（可驾驶下界：卡丁车满锁最小转弯半径 1.8m + 裕度）', () => {
  let kMax = 0;
  for (const s of track.samples) kMax = Math.max(kMax, Math.abs(s.k));
  assert.ok(1 / kMax >= 3, `min radius=${(1 / kMax).toFixed(2)}m`);
});
