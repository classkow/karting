import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackModel } from '../src/sim/track.js';
import {
  kerbSpans, curvatureRuns, KERB_RADIUS_GUARD, KERB_CURV_WINDOW, KERB_K_THRESHOLD, KERB_INNER_EDGE,
} from '../src/sim/kerbSpans.js';

const track = createTrackModel();
const S = track.samples;

// 测试独立复算"未平滑局部曲率"（±3 采样窗最值），不 import 实现的 localCurvature，
// 免得判据与被测代码同源自证。口径：raw[i] = |yaw(i+1)−yaw(i)|/ds，ds = 周长/采样数。
function rawLocalK(win = KERB_CURV_WINDOW) {
  const n = S.length, ds = track.length / n;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let d = S[(i + 1) % n].yaw - S[i].yaw;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    raw[i] = Math.abs(d) / ds;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = -win; j <= win; j++) m = Math.max(m, raw[(i + j + n) % n]);
    out[i] = m;
  }
  return out;
}
const kLoc = rawLocalK();

// ————— 工具：把一条带展开成世界 xz 平面的逐段四边形（路肩共面 → 二维判交）—————
function bandQuads(span) {
  const quads = [];
  for (let j = 0; j < span.len; j++) {
    const a = S[(span.i0 + j) % S.length];
    const b = S[(span.i0 + j + 1) % S.length];
    const na = { x: a.tz, z: -a.tx };
    const nb = { x: b.tz, z: -b.tx };
    const P = (p, n, o) => ({ x: p.x + n.x * o, z: p.z + n.z * o });
    // 与 trackScene.ribbonGeometry 同一构造：同一采样点两侧边共用该点法线
    quads.push([P(a, na, span.offA[j]), P(a, na, span.offB[j]), P(b, nb, span.offB[j]), P(b, nb, span.offA[j])]);
  }
  return quads;
}
const tri = (q) => [[q[0], q[1], q[2]], [q[0], q[2], q[3]]];
const ccw = (t) => {
  const [a, b, c] = t;
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) >= 0 ? [a, b, c] : [a, c, b];
};
const sideOf = (a, b, p) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
// Sutherland–Hodgman：凸多边形裁凸多边形 → 交面积（clip 必须是 CCW）
function clipArea(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length];
      const fp = sideOf(a, b, p), fq = sideOf(a, b, q);
      if (fp >= 0) out.push(p);
      if ((fp > 0 && fq < 0) || (fp < 0 && fq > 0)) {
        const t = fp / (fp - fq);
        out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
  }
  if (out.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < out.length; i++) {
    const p = out[i], q = out[(i + 1) % out.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}
const bbox = (p) => ({
  x0: Math.min(...p.map((v) => v.x)), x1: Math.max(...p.map((v) => v.x)),
  z0: Math.min(...p.map((v) => v.z)), z1: Math.max(...p.map((v) => v.z)),
});
const hits = (a, b) => !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0);

// 共面重叠普查：所有面积 > 0.01 m² 的三角对（同一四边形拆出的两个三角不算自交）
function coplanarOverlaps(spans) {
  const tris = [];
  for (const span of spans) for (const q of bandQuads(span)) for (const t of tri(q)) tris.push(ccw(t));
  const boxes = tris.map(bbox);
  const out = [];
  for (let i = 0; i < tris.length; i++) {
    for (let j = i + 1; j < tris.length; j++) {
      if (!hits(boxes[i], boxes[j])) continue;
      const a = clipArea(tris[i], tris[j]);
      if (a > 0.01) out.push({ i, j, area: a });
    }
  }
  return out;
}

test('路肩：每个采样点的偏移受 0.8/局部曲率 护栏约束（不塌进圆心区）', () => {
  // 判据系数 0.8 来自任务包 §1 修法 a（带边到曲率中心留 2 成半径余量）。实现把系数
  // 放宽到 0.8 以上、或某个采样点越界，本用例即红（反例：guard=Infinity 见末用例）。
  assert.ok(KERB_RADIUS_GUARD <= 0.8, `护栏系数 ${KERB_RADIUS_GUARD} 不得大于 0.8`);
  const spans = kerbSpans(track);
  assert.ok(spans.length >= 20, `带数 ${spans.length}（14 个弯段 × 2 侧）`);
  const bad = [];
  for (const span of spans) {
    for (let j = 0; j < span.len; j++) {
      const k = kLoc[(span.i0 + j) % S.length];
      if (k < 1e-6) continue;
      const limit = 0.8 / k;
      const worst = Math.max(Math.abs(span.offA[j]), Math.abs(span.offB[j]));
      if (worst > limit + 1e-9) bad.push(`i0=${span.i0} j=${j} 偏移 ${worst.toFixed(2)} > 上限 ${limit.toFixed(2)}`);
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} 个采样点的带边越过 0.8/|k| 护栏`);
});

test('路肩：run 级判据——弯心最紧处 outer ≤ 0.8/|k|peak(run)（任务包 §2.2 字面口径）', () => {
  const spans = kerbSpans(track);
  const runs = curvatureRuns(track, KERB_K_THRESHOLD);
  const bad = [];
  for (const run of runs) {
    let peak = 0, peakPos = run[0];
    for (const i of run) if (Math.abs(S[i].k) > peak) { peak = Math.abs(S[i].k); peakPos = i; }
    if (peak < 1e-6) continue;
    // 该 run 内偏移最大的那条带，在弯心采样点处的远边缘
    let worst = 0;
    for (const span of spans.filter((sp) => sp.i0 === run[0] && sp.len === run.length)) {
      const j = run.indexOf(peakPos);
      worst = Math.max(worst, Math.abs(span.offA[j]), Math.abs(span.offB[j]));
    }
    if (worst > 0.8 / peak + 1e-9) bad.push(`run s=${S[run[0]].s.toFixed(0)} worst=${worst.toFixed(2)} > ${(0.8 / peak).toFixed(2)}`);
  }
  assert.deepEqual(bad, [], '弯心最紧处的带边必须落在 0.8/|k| 内');
});

test('路肩：带体不跨中轴（两侧偏移同号且不为零 → 不会翻到对向路面）', () => {
  const spans = kerbSpans(track);
  const bad = [];
  for (const span of spans) {
    for (let j = 0; j < span.len; j++) {
      const a = span.offA[j], b = span.offB[j];
      if (!(Math.sign(a) === span.side || a === 0) || !(Math.sign(b) === span.side || b === 0)) {
        bad.push(`i0=${span.i0} j=${j} offA=${a.toFixed(2)} offB=${b.toFixed(2)} side=${span.side}`);
      }
      if (Math.abs(b - a) > track.halfWidth + 2) bad.push(`i0=${span.i0} j=${j} 带宽异常 ${(b - a).toFixed(2)}`);
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} 处越轴/带宽异常`);
});

test('路肩：带与带之间无共面重叠（Z-fighting 验收判据）', () => {
  const spans = kerbSpans(track);
  const over = coplanarOverlaps(spans);
  assert.deepEqual(over.slice(0, 5).map((o) => `tri#${o.i}×tri#${o.j}=${o.area.toFixed(3)}m²`), [],
    `${over.length} 对三角共面重叠（面积 >0.01m²）`);
});

test('路肩：反例控制——护栏关掉（= 修复前铺法）在发卡弯必然塌进圆心区并共面交叠', () => {
  // 把 R03 Bug2 的病灶钉成可重放事实：guard=Infinity 复刻旧的固定 [5.94,7.15] 铺法。
  const bare = kerbSpans(track, { guard: Infinity });
  const guarded = kerbSpans(track);
  // 无护栏时最紧处：带远边缘越过曲率中心（到圆心距 <0 = 翻折）
  let worstEdge = Infinity;
  for (const span of bare) {
    for (let j = 0; j < span.len; j++) {
      const k = kLoc[(span.i0 + j) % S.length];
      if (k < 1e-6) continue;
      const edge = Math.max(Math.abs(span.offA[j]), Math.abs(span.offB[j]));
      worstEdge = Math.min(worstEdge, 1 / k - edge);
    }
  }
  assert.ok(worstEdge < 0, `无护栏时带远边缘最深处越过曲率中心 ${(-worstEdge).toFixed(2)}m（修复前实测）`);
  assert.ok(coplanarOverlaps(bare).length > 0, '无护栏时必须存在共面重叠（否则本用例失去反例意义）');
  assert.equal(coplanarOverlaps(guarded).length, 0, '加护栏后共面重叠必须为 0');
});

test('路肩：弯段切分与阈值口径不变（≥12 个 run，最紧弯半径 >3m 可驾驶）', () => {
  const runs = curvatureRuns(track, KERB_K_THRESHOLD);
  assert.ok(runs.length >= 12, `弯段数 ${runs.length}`);
  let kMax = 0;
  for (const sp of track.samples) kMax = Math.max(kMax, Math.abs(sp.k));
  assert.ok(1 / kMax > 3, `最紧局部半径 ${(1 / kMax).toFixed(2)}m`);
});

// ————— 变更 #44 任务三：不入侵 / 平滑 / 覆盖不回退（判据数字来自派发方基线取证）—————

// 带体展开为逐样本"内沿/外沿幅值"（内沿 = 近路缘一侧，外沿 = 远路缘一侧）
function bandMags(spans) {
  const out = [];
  for (const span of spans) {
    for (let j = 0; j < span.len; j++) {
      const a = Math.abs(span.offA[j]);
      const b = Math.abs(span.offB[j]);
      out.push({ i: (span.i0 + j) % S.length, inner: Math.min(a, b), outer: Math.max(a, b) });
    }
  }
  return out;
}

test('路肩·不入侵：任意带样本内沿 ≥ halfWidth−0.06−0.01（基线 312 点入侵 → 修后 0）', () => {
  // 0.06 = 设计内嵌 KERB_INNER_EDGE，0.01 = 任务包容差。基线 0338083 实测 312 个采样点
  // 内沿越过该界（发卡顶点处整条带被 clamp 到 |off|=2.39m，横躺在沥青上）。
  const limit = track.halfWidth - KERB_INNER_EDGE - 0.01;
  const bad = [];
  for (const m of bandMags(kerbSpans(track))) {
    if (m.inner < limit) bad.push(`i=${m.i} 内沿 ${m.inner.toFixed(2)} < ${limit.toFixed(2)}`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} 个带样本内沿入侵路面`);
});

test('路肩·平滑：任意带相邻采样点外沿变化率 ≤ 0.25 m/m（基线峰值 3.52 → 修后达标）', () => {
  // 护栏 lim=0.8/|k| 沿弧长台阶式跳变（"不设限"→clamp 一步 7.15→2.39m），基线逐点取
  // min 使外沿出现断崖，肉眼即锯齿/断带（1m 弧长采样，跳变米数 = 变化率米每米）。
  const ds = track.length / S.length;
  let peak = 0;
  let where = '';
  const spans = kerbSpans(track);
  for (const span of spans) {
    for (let j = 1; j < span.len; j++) {
      const prev = Math.max(Math.abs(span.offA[j - 1]), Math.abs(span.offB[j - 1]));
      const cur = Math.max(Math.abs(span.offA[j]), Math.abs(span.offB[j]));
      const rate = Math.abs(cur - prev) / ds;
      if (rate > peak) { peak = rate; where = `i0=${span.i0} j=${j} (${prev.toFixed(2)}→${cur.toFixed(2)}m)`; }
    }
  }
  assert.ok(peak <= 0.25, `外沿相邻变化率峰值 ${peak.toFixed(2)} m/m @ ${where}`);
});

test('路肩·覆盖不回退：总弧长 ≥ 基线 60% 且发卡顶点前后 10m 弧段内两侧均有带外路面带', () => {
  // 反"全删了事"：基线（0338083）总弧长 = Σ run 长度 ×2 侧 ≈ 875.5m。
  const spans = kerbSpans(track);
  const ds = track.length / S.length;
  const baselineArc = curvatureRuns(track, KERB_K_THRESHOLD).reduce((acc, r) => acc + r.length, 0) * ds;
  const totalArc = spans.reduce((acc, sp) => acc + sp.len * ds, 0);
  assert.ok(totalArc >= baselineArc * 0.6,
    `修后总弧长 ${totalArc.toFixed(0)}m < 基线 ${baselineArc.toFixed(0)}m 的 60%`);
  // 发卡顶点（未平滑 |k| 最值采样点）前后各 10m 弧段内，必须存在"外路面带"
  // （内沿 ≥ halfWidth−0.06−0.01 且带宽 > 0）——顶点处允许收窄/消失，但两侧 10m 内要有带。
  let apex = 0;
  for (let i = 0; i < S.length; i++) if (kLoc[i] > kLoc[apex]) apex = i;
  const limit = track.halfWidth - KERB_INNER_EDGE - 0.01;
  const good = bandMags(spans).filter((m) => m.outer - m.inner > 0 && m.inner >= limit).map((m) => m.i);
  const hasInWindow = (from, to) => good.some((i) => (i >= from && i <= to));
  const n = S.length;
  const backFrom = (apex - Math.ceil(10 / ds) + n) % n;
  const fwdTo = (apex + Math.ceil(10 / ds)) % n;
  // 前后窗都不跨起点线回绕时直接判（发卡位于 s≈754m，赛道长 ≈858m，窗口不绕环）
  assert.ok(backFrom < apex && apex < fwdTo, `窗口跨回绕，需扩展本用例（backFrom=${backFrom} apex=${apex} fwdTo=${fwdTo}）`);
  assert.ok(hasInWindow(backFrom, apex - 1), `顶点前 10m（i∈[${backFrom},${apex - 1}]）无外路面带`);
  assert.ok(hasInWindow(apex + 1, fwdTo), `顶点后 10m（i∈[${apex + 1},${fwdTo}]）无外路面带`);
});
