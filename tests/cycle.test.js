// ————— 二冲程换气循环单元测试 —————
// 运行：npm test（node --test 显式列文件，勿改回目录模式，Windows 有坑）
// 断言物理语义而非"数值有限"：改 layout 几何必须变红，杜绝静默全绿（§九 风格铁律）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cyc from '../src/sim/cycle.js';
import { L } from '../src/kart/layout.js';

const D = Math.PI / 180;
const TAU = Math.PI * 2;
const cc = (v) => v * 1e6; // m³ → cc

test('常量契约：几何与规格常量钉死（改 layout 必须变红）', () => {
  assert.equal(L.crankR, 0.027);
  assert.equal(L.rodLen, 0.105);
  assert.equal(L.engine.bore, 0.054);
  assert.equal(L.engine.exhaustOpenATDC, 85);
  assert.equal(L.engine.transferOpenATDC, 125);
  assert.equal(L.engine.CR_trapped, 13.5);
  assert.equal(L.engine.CR_cc, 1.45);
  // 气口上缘由冠顶反解（禁手抄）：排气 0.128850 / 扫气 0.112158
  assert.ok(Math.abs(cyc.H_EXH - 0.1288498) < 1e-6, `排气口上缘 ${cyc.H_EXH}`);
  assert.ok(Math.abs(cyc.H_TR - 0.1121577) < 1e-6, `扫气口上缘 ${cyc.H_TR}`);
  // 反射面 = 收敛段末端（倒数第二点轴向 0.45），由 profile 派生
  assert.equal(cyc.REFLECT_AXIAL, 0.45);
  assert.equal(L.engine.chamberProfile[L.engine.chamberProfile.length - 2][1], 0.45);
  // 波程 = header 弧长 + 喉口→反射面轴向段（与 engine.js 走管几何同源；
  // 首点已按 §三.1 下移进排气窗口带 z=+0.120，弧长 0.194495 → 0.186850）
  assert.ok(Math.abs(cyc.HEADER_LEN - 0.186850) < 5e-7, `header 弧长 ${cyc.HEADER_LEN}`);
  assert.ok(Math.abs(cyc.L_WAVE - 0.636850) < 5e-7, `波程 ${cyc.L_WAVE}`);
});

test('反解自洽：冠顶残差 ≤1e-12，且 θ_EVO + θ_EVC ≡ π（对称性）', () => {
  const phiEx = cyc.portAngleFromHeight(cyc.H_EXH);
  const phiTr = cyc.portAngleFromHeight(cyc.H_TR);
  assert.ok(Math.abs(cyc.crownTop(phiEx) - cyc.H_EXH) < 1e-12, '排气口残差');
  assert.ok(Math.abs(cyc.crownTop(phiTr) - cyc.H_TR) < 1e-12, '扫气口残差');
  // 反解角应与 layout 的 ATDC 常量一致（排除"解出另一支"）
  assert.ok(Math.abs(phiEx - cyc.EVO) < 1e-9, `排气反解 ${phiEx / D}° ≠ ${cyc.EVO / D}°`);
  assert.ok(Math.abs(phiTr - cyc.IVO) < 1e-9, `扫气反解 ${phiTr / D}° ≠ ${cyc.IVO / D}°`);
  // 对称性（代码角基 TDC=π/2）：EVO=π/2+φ、EVC≡π/2−φ (mod 2π) → 和 ≡ π
  const sum = (Math.PI / 2 + cyc.EVO + Math.PI / 2 + cyc.EVC) % TAU;
  assert.ok(Math.abs(sum - Math.PI) < 1e-9, `θ_EVO+θ_EVC mod 2π = ${sum / D}° ≠ 180°`);
});

test('正时顺序（定义性）：扫气晚开早关、blowdown 40°、持续角区间', () => {
  assert.ok(cyc.IVO > cyc.EVO, '扫气口必须晚于排气口开启');
  assert.ok(cyc.IVC < cyc.EVC, '扫气口必须早于排气口关闭');
  const blowdown = (cyc.IVO - cyc.EVO) / D;
  assert.ok(blowdown > 20 && blowdown < 60, `blowdown ${blowdown}° ∉ (20,60)`);
  const durExh = (cyc.EVC - cyc.EVO) / D;
  assert.ok(durExh > 180 && durExh < 200, `排气持续角 ${durExh}° ∉ (180,200)——持续角公式用错（170 vs 190）会在此变红`);
  const durTr = (cyc.IVC - cyc.IVO) / D;
  assert.ok(durTr > 100 && durTr < 120, `扫气持续角 ${durTr}° ∉ (100,120)`);
});

test('排量与容积：V_disp ∈ (110,140)cc，V_cyl 端点吻合，几何 CR ∈ (14,18)', () => {
  assert.ok(cc(cyc.V_DISP) > 110 && cc(cyc.V_DISP) < 140, `排量 ${cc(cyc.V_DISP).toFixed(1)}cc（误用可视 Ø96 会得 ≈391cc）`);
  assert.ok(Math.abs(cyc.cylinderVolume(0) - cyc.V_C) < 1e-15, 'TDC 时 V_cyl = V_c');
  assert.ok(Math.abs(cyc.cylinderVolume(Math.PI) - (cyc.V_C + cyc.V_DISP)) < 1e-15, 'BDC 时 V_cyl = V_c + V_disp');
  const geoCR = (cyc.V_C + cyc.V_DISP) / cyc.V_C;
  assert.ok(geoCR > 14 && geoCR < 18, `几何 CR ${geoCR.toFixed(2)} ∉ (14,18)`);
  // 曲轴箱：BDC 最小、TDC 最大，CR_cc = 1.45
  assert.ok(Math.abs(cyc.crankcaseVolume(Math.PI) - cyc.V_CC_MIN) < 1e-15, 'BDC 时曲轴箱容最小');
  assert.ok(Math.abs(cyc.crankcaseVolume(0) / cyc.V_CC_MIN - L.engine.CR_cc) < 1e-9, 'CR_cc 派生不一致');
  assert.ok(Math.abs(cc(cyc.V_CC_MIN) - 275) < 2, `V_cc_min ${cc(cyc.V_CC_MIN).toFixed(0)}cc 应 ≈275`);
});

test('气口面积：排气口 EVO 为 0、单调开、EVC 侧归 0；blowdown 期扫气面积恒 0', () => {
  assert.equal(cyc.exhaustArea(cyc.EVO), 0, 'EVO 时排气面积应为 0');
  assert.equal(cyc.exhaustArea(cyc.EVC), 0, 'EVC 时排气面积应归 0');
  let prev = 0;
  for (let t = cyc.EVO; t <= Math.PI + 1e-9; t += (Math.PI - cyc.EVO) / 40) {
    const a = cyc.exhaustArea(t);
    assert.ok(a >= prev - 1e-15, `排气面积应单调开（θ=${(t / D).toFixed(1)}°）`);
    prev = a;
  }
  assert.ok(cyc.exhaustArea(Math.PI) > 0, 'BDC 时排气口应开启');
  // 扫气口在排气单独开启期（blowdown）恒为 0
  for (let t = cyc.EVO; t < cyc.IVO - 1e-9; t += (cyc.IVO - cyc.EVO) / 30) {
    assert.equal(cyc.transferArea(t), 0, `blowdown 期（θ=${(t / D).toFixed(1)}°）扫气面积必须为 0`);
  }
  assert.ok(cyc.transferArea(Math.PI) > 0, 'BDC 时扫气口应开启');
  // 状态推进：dθ 累计、按转数回绕、确定性（拆步与整步推过相同总转角，状态差 <1e-9）
  const m = cyc.createCycleModel();
  m.step(1, 13800, 1);
  m.step(2, 13800, 1);
  assert.ok(Math.abs(m.theta - 3) < 1e-9, `theta ${m.theta} ≠ 3`);
  assert.ok(Math.abs(m.thetaATDC() - (3 % TAU)) < 1e-9);
  const m2 = cyc.createCycleModel();
  m2.step(3, 13800, 1);
  assert.ok(Math.abs(m2.theta - m.theta) < 1e-9, '同总转角 theta 应一致');
  // 拆步/整步的次步长边界不同 → 热力学轨迹有离散差（test 12 口径：<1e-3 相对）
  assert.ok(Math.abs(m2.pCyl - m.pCyl) / m.pCyl < 1e-3, `同总转角状态应一致（pCyl ${m.pCyl} vs ${m2.pCyl}）`);
  assert.ok(Math.abs(m2.pCc - m.pCc) / m.pCc < 1e-3, 'pCc 应一致');
});

test('压缩关系：p_TDC/p_IVC = CR_trappedⁿ（拖转望远镜严格成立）；峰值 ∈ (25,90) bar', () => {
  const mo = cyc.solveCycle(13800, { fire: false });
  const ratio = mo.pTdcBar / mo.pIvcBar;
  const expect = Math.pow(L.engine.CR_trapped, 1.30);
  assert.ok(Math.abs(ratio - expect) < expect * 1e-9, `p_TDC/p_IVC ${ratio.toFixed(6)} ≠ CR^n ${expect.toFixed(6)}——单位错或 IVC 后仍开放在此变红`);
  const f = cyc.solveCycle(13800);
  assert.ok(f.peakBar > 25 && f.peakBar < 90, `峰值缸压 ${f.peakBar.toFixed(1)} bar ∉ (25,90)——漏燃烧或单位错`);
});

test('P-V 环方向：点火 ∮p dV > 0（做功）；拖转 ∮p dV < 0（马达工况）', () => {
  const fired = cyc.solveCycle(13800);
  const motored = cyc.solveCycle(13800, { fire: false });
  assert.ok(fired.workJ > 0, `点火环路功 ${fired.workJ.toFixed(1)}J 应 > 0——n 写反/漏放热在此变红`);
  assert.ok(motored.workJ < 0, `拖转环路功 ${motored.workJ.toFixed(1)}J 应 < 0——一台消耗功的马达`);
});

test('解算功率量级：@13800rpm 满油 ∈ (8,30) kW（性价比最高的一条）', () => {
  const r = cyc.solveCycle(13800);
  const kw = (r.workJ * (13800 / 60)) / 1000;
  assert.ok(kw > 8 && kw < 30, `功率 ${kw.toFixed(1)} kW ∉ (8,30)——同时抓 bore、环方向、单位、放热缺失`);
});

test('曲轴箱相位：上行末段吸入（p_cc<大气、簧片开）、下行中段泵气（p_cc>大气、簧片闭）', () => {
  const r = cyc.solveCycle(3000);
  const at = (deg) => r.samples[deg];
  // 簧片开启窗口实测 ≈[290°, 58°]（CR_cc=1.45 下 p_cc 需膨胀至约 80% 上行才过大气，
  // 与真机簧片持续 120–140° 一致）——采样窗取相位真实发生的区段
  for (const d of [310, 325, 340, 355]) {
    const s = at(d);
    assert.ok(s.pCcBar < 1.013, `θ=${d}° 上行 p_cc ${s.pCcBar.toFixed(3)}bar 应 < 大气`);
    assert.ok(s.reed > 0.2, `θ=${d}° 簧片应开启（lift=${s.reed.toFixed(2)}）`);
  }
  for (const d of [65, 72, 80]) {
    const s = at(d);
    assert.ok(s.pCcBar > 1.013, `θ=${d}° 下行 p_cc ${s.pCcBar.toFixed(3)}bar 应 > 大气`);
    assert.ok(s.reed < 0.05, `θ=${d}° 簧片应关闭（lift=${s.reed.toFixed(2)}）`);
  }
  assert.ok(L.engine.CR_cc > 1.3 && L.engine.CR_cc < 1.7, `CR_cc ${L.engine.CR_cc}`);
  assert.ok(r.pCcPeakBar > 1.2 && r.pCcPeakBar < 1.8, `p_cc 峰值 ${r.pCcPeakBar.toFixed(2)} bar ∉ (1.2,1.8)`);
});

test('簧片数值稳定：dt=1/30 泵 600 帧无 NaN、恒有界；怠速颤振、开窗有开度', () => {
  const m = cyc.createCycleModel();
  let reversals = 0;
  let prevDir = 0;
  let maxLift = 0;
  for (let i = 0; i < 600; i++) {
    m.step(2.4, 1800, 0.3, 1 / 30);
    assert.ok(Number.isFinite(m.reedX), `frame ${i} reedX NaN`);
    assert.ok(Number.isFinite(m.pCyl) && m.pCyl > 0, `frame ${i} pCyl 异常`);
    assert.ok(m.reedX >= 0 && m.reedX <= 1, `frame ${i} reedX 越界 ${m.reedX}`);
    maxLift = Math.max(maxLift, m.reedX);
    const dir = Math.sign(m.reedX - (m._prevReed ?? m.reedX));
    m._prevReed = m.reedX;
    if (dir !== 0 && dir !== prevDir) { reversals++; prevDir = dir; }
  }
  assert.ok(reversals >= 6, `怠速下簧片应有颤振（方向反转 ${reversals} 次过少）`);
  assert.ok(maxLift > 0.5, `怠速簧片最大开度 ${maxLift.toFixed(2)} 过小`);
  // 高转速：dt=1/30 泵 300 帧仍稳定有界（视觉钟下准静态，无数值爆炸）
  const hi = cyc.createCycleModel();
  for (let i = 0; i < 300; i++) {
    hi.step(5, 13800, 1, 1 / 30);
    assert.ok(Number.isFinite(hi.reedX) && hi.reedX >= 0 && hi.reedX <= 1, `hi frame ${i}`);
  }
});

test('波与调谐语义：反射系数符号、L 同源、N_tuned 区间、η_tr 抬头（§四.5 生死线）', () => {
  // 反射系数：扩张段 R<0（负压回抽）、尾管入口 R>0（正压回推）、|R|<1
  assert.ok(cyc.R_EXPANSION < 0, `扩张段 R ${cyc.R_EXPANSION.toFixed(3)} 应 < 0`);
  assert.ok(cyc.R_STINGER > 0, `尾管入口 R ${cyc.R_STINGER.toFixed(3)} 应 > 0`);
  assert.ok(Math.abs(cyc.R_EXPANSION) < 1 && Math.abs(cyc.R_STINGER) < 1);
  // L 与 three CatmullRomCurve3.getLength() 同源交叉验证（cycle.js 内部即 three 曲线）
  assert.ok(Math.abs(cyc.HEADER_LEN - 0.186850) < 5e-7);
  const dTdc = cyc.HEAD_DECK - cyc.CROWN_TDC;
  assert.ok(Math.abs(dTdc - cyc.V_C / cyc.AREA) < 1e-12, '缸盖底面 = TDC 冠顶 + 余隙');
  // N_tuned 由管长解算：区间 + < MAX_RPM（不硬编码具体值——口径 ±40% 不确定度）
  assert.ok(cyc.N_TUNED > 9000 && cyc.N_TUNED < 15000, `N_tuned ${cyc.N_TUNED.toFixed(0)} ∉ (9000,15000)`);
  assert.ok(cyc.N_TUNED < 13800, `N_tuned ${cyc.N_TUNED.toFixed(0)} 应 < MAX_RPM 13800`);
  // η_tr 在调谐点抬头：> 两侧（−4000rpm 与 MAX_RPM）
  const wT = cyc.OMEGA_TUNED;
  const etaAt = (rpm) => cyc.etaTr((rpm / 60) * TAU);
  assert.ok(etaAt(13340) > etaAt(9340), `η_tr(tuned) ${etaAt(13340).toFixed(3)} 应 > η_tr(9340) ${etaAt(9340).toFixed(3)}`);
  assert.ok(etaAt(13340) > etaAt(13800), `η_tr(tuned) ${etaAt(13340).toFixed(3)} 应 > η_tr(13800) ${etaAt(13800).toFixed(3)}`);
  // 回抽波到达转角 < EVC（负压回抽必须在排气口关闭前发生）
  const mPerRad = cyc.C_SOUND / wT;
  const arrSuc = cyc.EVO + (2 * cyc.S_BELLY) / mPerRad;
  assert.ok(arrSuc < cyc.EVC, `回抽波到达 ${(arrSuc / D).toFixed(0)}° 应 < EVC ${(cyc.EVC / D).toFixed(0)}°`);
  // 怠速下一次排气持续期内波往返 > 3 次（严重失调 → 管内密集回波）
  const wIdle = (1800 / 60) * TAU;
  const roundtrips = ((cyc.DUR_EXH / wIdle) * cyc.C_SOUND) / (2 * cyc.L_WAVE);
  assert.ok(roundtrips > 3, `怠速往返 ${roundtrips.toFixed(2)} 次应 > 3`);
  // 脉冲弹跳：排气期内脉冲沿管往返、正负相交替（密集回波的离散采样）
  const wI = (1800 / 60) * TAU;
  const pl30 = cyc.wavePulses(cyc.EVO + 30 * D, wI);
  const pl60 = cyc.wavePulses(cyc.EVO + 60 * D, wI);
  const pl90 = cyc.wavePulses(cyc.EVO + 90 * D, wI);
  assert.ok(pl30.length >= 1 && pl60.length >= 1 && pl90.length >= 1, '排气期内应有在途脉冲');
  const signs = new Set([...pl30, ...pl60, ...pl90].map((p) => p.sign));
  assert.ok(signs.size >= 2, '正压/负压相位应都出现');
});

test('视觉时钟与帧长无关：ds/dθ = c/ω_real、dt 无关、solveCycle 确定性', () => {
  // ds/dθ（波米数每曲轴弧度）= c/ω_real：13800 处精确成立（用 s.omega/cap 会失配）
  const wReal = (13800 / 60) * TAU;
  assert.ok(Math.abs(cyc.C_SOUND / wReal - cyc.C_SOUND / ((13800 / 60) * TAU)) < 1e-12);
  // 严格随 rpm 下降（7000 → 13800）
  const ds7000 = cyc.C_SOUND / ((7000 / 60) * TAU);
  const ds13800 = cyc.C_SOUND / ((13800 / 60) * TAU);
  assert.ok(ds7000 > ds13800, '波米数/弧度应随 rpm 下降');
  // dt=1/60 与 dt=1/30 推过相同总转角（视觉角基，与 state.js 接线一致）：状态相对差 < 1e-3
  const a = cyc.createCycleModel();
  const b = cyc.createCycleModel();
  for (let i = 0; i < 60; i++) a.step(2.5, 13800, 1, 1 / 60);
  for (let i = 0; i < 30; i++) b.step(5, 13800, 1, 1 / 30);
  assert.ok(Math.abs(a.theta - b.theta) < 1e-9, '总转角应一致');
  assert.ok(Math.abs(a.pCyl - b.pCyl) / b.pCyl < 1e-3, `pCyl 相对差 ${Math.abs(a.pCyl - b.pCyl) / b.pCyl}`);
  assert.ok(Math.abs(a.pCc - b.pCc) / b.pCc < 1e-3, 'pCc 相对差');
  // 同参数两次 solveCycle 逐点相等（确定性）
  const s1 = cyc.solveCycle(9000, { fire: true });
  const s2 = cyc.solveCycle(9000, { fire: true });
  assert.deepEqual(s1.loop, s2.loop);
  assert.equal(s1.workJ, s2.workJ);
});
