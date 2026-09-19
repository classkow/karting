// ————— 路肩偏移带规划（纯数学，零渲染依赖，可 node --test 直接断言）—————
// 为什么要有护栏：trackScene 早期把每个曲率 run 两侧都铺固定偏移 [halfWidth−0.06, halfWidth+1.15]
// = [5.94, 7.15] m、同一高度 y=0.028 的 ribbon。复刻赛道发卡顶点真实局部半径只有 ≈4m
// （未平滑 |k| 峰值 0.21~0.25），固定偏移直接越过曲率中心 → 带子自身翻折交叠，两片共面同高
// 的三角互相压着 → 视角一动就高频 Z-fighting（用户报障 R03 Bug 2）。
// 判据：偏移带任一点到该点曲率中心的距离必须为正，且留 2 成半径余量，
// 即单侧偏移上限 = KERB_RADIUS_GUARD / 局部曲率（|k|→0 的直道段不设限）。
// 局部曲率取未平滑值并按 KERB_CURV_WINDOW 扩窗取最值，见 localCurvature()。
// 渲染层（core/trackScene.js）只消费这里给出的区间，不再自己算偏移。
//
// 变更 #44（任务三）：护栏逐点取 min 会产生两类新伤——护栏低于内沿名义的采样点被
// "硬 clamp 进路面"（入侵），且"不设限→clamp"的过渡是台阶（不平滑）。现铺法两步走：
// 先切"可行块"（护栏上限 ≥ 内沿名义的连续段，块外的点不铺带——发卡顶点路肩收尖/消失），
// 再在块内取护栏曲线的最大 KERB_EDGE_SLOPE-Lipschitz 下界（限制事件摊进斜率里）。
// 判据与取证见 tests/kerbSpans.test.js「变更 #44 任务三」用例组。
//
// 符号口径沿用 sim/track.js：偏移沿车体 +x 侧法线 (tz, −tx) 计正（= 驾驶员左）；
// k<0 = 右弯 → 弯心在该法线的负侧。

export const KERB_K_THRESHOLD = 1 / 32; // 半径 <32m 的弯道两侧铺路肩
export const KERB_INNER_EDGE = 0.06;    // 带内沿嵌进路面边缘 6cm
export const KERB_OUTER_EDGE = 1.15;    // 带外沿铺到路缘外 1.15m
export const KERB_RADIUS_GUARD = 0.8;   // 偏移上限 = 0.8 × 局部半径
export const KERB_CURV_WINDOW = 3;      // 局部曲率扩窗（±3 采样点 = ±3m）
export const KERB_Y = 0.028;            // 路肩铺装高度（微凸沥青 2.8cm）
// 变更 #44 任务三：不入侵 + 平滑两判据（派发方基线取证：310 点入侵、外沿跳变峰值 3.52 m/m）
export const KERB_EDGE_SLOPE = 0.22;    // 带边外沿沿弧长最大变化率（米/米）；验收判据 0.25，留余量
export const KERB_MIN_BLOCK = 3;        // 可行块最少采样点数（≈3m 弧长），短于不铺（悬浮碎片）

// 高曲率区段（首尾回绕合并，最小长度 minRun 个采样点）。轮胎墙布置同源。
export function curvatureRuns(track, kThreshold = KERB_K_THRESHOLD, minRun = 5) {
  const S = track.samples;
  const n = S.length;
  const flag = S.map((sp) => Math.abs(sp.k) > kThreshold);
  // 找一个非弯起点，避免回绕段被切成两截
  let head = flag.findIndex((f) => !f);
  if (head < 0) head = 0;
  const runs = [];
  let run = [];
  for (let j = 0; j < n; j++) {
    const i = (head + j) % n;
    if (flag[i]) run.push(i);
    else if (run.length) {
      if (run.length >= minRun) runs.push(run);
      run = [];
    }
  }
  if (run.length >= minRun) runs.push(run);
  return runs;
}

// 逐采样点的"真实局部曲率"（1/m，未平滑，取 ±win 采样窗的最大值）。
// 为什么不用 samples[].k：track.js 的 k 经 ±7m 滑动平均，把发卡顶点 R≈4m 摊成 R≈10m
// （同一现象在 ai.js cornerMargin 注释里有记录）。偏移带翻折的判据是 |k|·offset < 1 在
// 每个采样点局部成立，用被摊薄的 k 会漏掉翻折：护栏若按平滑 k 取阈值，发卡内侧带的共面
// 自交叠依旧存在（数量级：数百对三角）；按本函数的未平滑值才归零——反例可重放见
// tests/kerbSpans.test.js（guard: Infinity = 修复前铺法）。
export function localCurvature(track, win = KERB_CURV_WINDOW) {
  const S = track.samples;
  const n = S.length;
  const ds = track.length / n;
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

// 返回 [{ i0, len, side, offA, offB }]：每个可行块每侧一条带（一个弯段可产生多条），
// offA/offB 为逐采样点的有符号横向偏移（米，offA ≤ offB，沿车体 +x 侧法线计正）。
export function kerbSpans(track, {
  threshold = KERB_K_THRESHOLD,
  guard = KERB_RADIUS_GUARD,
  innerEdge = KERB_INNER_EDGE,
  outerEdge = KERB_OUTER_EDGE,
  win = KERB_CURV_WINDOW,
  slope = KERB_EDGE_SLOPE,
  minBlock = KERB_MIN_BLOCK,
} = {}) {
  const hw = track.halfWidth;
  const innerNominal = hw - innerEdge;
  const outerNominal = hw + outerEdge;
  const kLoc = localCurvature(track, win);
  const spans = [];
  for (const run of curvatureRuns(track, threshold)) {
    const n = run.length;
    // 逐点可行上限：名义外沿 ∩ 半径护栏（直道不设限）
    const hi = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const ka = kLoc[run[j]];
      hi[j] = ka > 1e-6 ? Math.min(outerNominal, guard / ka) : outerNominal;
    }
    // 可行块 = hi ≥ 内沿名义的连续采样段（长度 ≥ minBlock）。hi < innerNominal 的采样点
    // 不可铺：护栏把整条带逼进路面边缘以内——#44 修复前正是对这些点"硬 clamp"，
    // 带体横躺在沥青上（310 个入侵点）且带边台阶跳变（峰值 3.52 m/m）。
    // 块内取 hi 的最大 slope-Lipschitz 下界 g（两程扫描，g[j]=min_k hi[k]+slope·|j−k|）：
    // 护栏 lim 沿弧长是台阶式的（发卡入口 7.15→2.39 一步到位），下界扫描把所有限制事件
    // 摊进 ≤slope 的斜率里，带体在块边界收尖成楔形而非断带。块内恒有 hi ≥ innerNominal，
    // 故 g ≥ innerNominal（下界是若干 ≥innerNominal 项的 min），内沿钉死 innerNominal
    // （变化率 0），外沿 = g ∈ [innerNominal, hi] ⊆ 护栏内。
    let a = 0;
    while (a < n) {
      if (hi[a] < innerNominal) { a++; continue; }
      let b = a;
      while (b + 1 < n && hi[b + 1] >= innerNominal) b++;
      if (b - a + 1 >= minBlock) {
        const g = hi.slice(a, b + 1);
        for (let j = 1; j < g.length; j++) g[j] = Math.min(g[j], g[j - 1] + slope);
        for (let j = g.length - 2; j >= 0; j--) g[j] = Math.min(g[j], g[j + 1] + slope);
        const len = b - a + 1;
        for (const side of [-1, 1]) {
          // 有符号：side=+1 沿 +x 法线，side=−1 反向；offA 恒 ≤ offB
          const offA = new Float64Array(len);
          const offB = new Float64Array(len);
          for (let j = 0; j < len; j++) {
            const magA = innerNominal;          // 近路缘一侧：设计内嵌 6cm，恒不入侵
            const magB = Math.max(g[j], magA);  // 远路缘一侧：护栏 + 平滑下界（浮点兜底 ≥magA）
            offA[j] = side > 0 ? magA : -magB;
            offB[j] = side > 0 ? magB : -magA;
          }
          spans.push({ i0: run[a], len, side, offA, offB });
        }
      }
      a = b + 1;
    }
  }
  return spans;
}
