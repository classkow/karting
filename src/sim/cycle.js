// ————— 二冲程换气循环（零维准静态模型，纯数学，零渲染依赖）—————
// 与 sim/kinematics.js 同级地位的"单一事实来源"：气口正时、容积、气口面积、
// 波程、缸压/曲轴箱压/簧片/压力波，全部由 layout 几何 + 规格常量派生。
//
// 转角基（§四.6/§四.7，全模型同基）：ATDC 弧度 = 上止点后曲轴角。
// 屏幕上的活塞、气体云、压力波、正时圆盘都是这一角度的确定函数——
// 慢放只放慢时间轴，任何量随转角的关系不变，相对时序永远是真值。
// 唯一例外：簧片阀固有频率（真实时间量，按 §四.4 显式声明跟视觉时钟）。
// 波速换算用真实 ω（ds/dθ = c/ω_real，§四.7），绝不用被 cap 绑定的 s.omega。
// 视觉口径（§五.6，可辩护）：轴向 1:1、径向为可视性放大；因 bore 恒定，
// 容积比 ≡ 气柱高度比 → 屏上压缩收缩比/充气效率等一切比值都是真值，
// 只有绝对容积需用真机 bore 0.054 换算（绝不用可视 Ø0.096）。

import { L } from '../kart/layout.js';
import { pistonStroke } from './kinematics.js';
import { CatmullRomCurve3, Vector3 } from 'three';

const TAU = Math.PI * 2;
const D = Math.PI / 180;

// ————— 几何（曲柄滑块同源）—————
export const CRANK_R = L.crankR;
export const ROD_LEN = L.rodLen;
export const BORE = L.engine.bore;                // 实际缸径 54mm（视觉径向放大，§五.6）
export const PISTON_HALF = 0.025;                 // 活塞半高（冠顶到活塞销）
export const AREA = (Math.PI * BORE * BORE) / 4;  // 缸径截面积 m²
export const STROKE = CRANK_R * 2;                // 0.054
export const CROWN_TDC = CRANK_R + ROD_LEN + PISTON_HALF; // 冠顶上止点 +0.157
export const CROWN_BDC = ROD_LEN - CRANK_R + PISTON_HALF; // 冠顶下止点 +0.103
export const V_DISP = AREA * STROKE;              // 排量 m³（≈123.67cc，125cc 级）

// 冠顶高度（ATDC 角）= 活塞销位移 s(θ) + 活塞半高
export function crownTop(thetaATDC) {
  return pistonStroke(Math.PI / 2 + thetaATDC, CRANK_R, ROD_LEN) + PISTON_HALF;
}

// ————— 气口正时：layout 给 ATDC 开启角，上缘高度由冠顶反解（禁手抄）—————
export const EVO = L.engine.exhaustOpenATDC * D;   // 排气口开 85°ATDC
export const IVO = L.engine.transferOpenATDC * D;  // 扫气口开 125°ATDC
export const EVC = TAU - EVO;                      // 排气口关 275°ATDC
export const IVC = TAU - IVO;                      // 扫气口关 235°ATDC
export const H_EXH = crownTop(EVO);                // 排气口上缘 +0.128850
export const H_TR = crownTop(IVO);                 // 扫气口上缘 +0.112158
export const DUR_EXH = EVC - EVO;                  // 190°
export const DUR_TR = IVC - IVO;                   // 110°
export const BLOWDOWN = IVO - EVO;                 // 40°

// 二分反解：给定气口上缘高度 h，求开启偏角 φ（ATDC，[0,π] 内 crownTop(φ)
// 严格单调减 → 解唯一）。禁牛顿：扫气口上缘只高于 BDC 冠顶 ≈9.16mm，
// s−s_BDC ≈ ½R(1−R/L)ψ² 二次退化、ds/dφ→0，牛顿会跳支；二分免疫。
// （crownTop 直接吃 ATDC 角；附录A 校准脚本里的 crown(π/2+m) 是"代码角"口径，二者一致。）
export function portAngleFromHeight(h) {
  if (h <= CROWN_BDC || h >= CROWN_TDC) {
    throw new RangeError(`气口上缘 ${h.toFixed(6)} 超出可解域 (${CROWN_BDC.toFixed(4)}, ${CROWN_TDC.toFixed(4)})`);
  }
  let lo = 0;
  let hi = Math.PI;
  for (let i = 0; i < 90; i++) {
    const m = (lo + hi) / 2;
    if (crownTop(m) > h) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

// ————— 反射面与波程 —————
// 反射面 = 收敛段末端：profile 中最后一个显著收缩段（|Δr/Δx| > 0.1）的终点，
// 即近直尾管（0.45→0.48 段 r 0.021→0.020）的起点。对现 profile 恰为轴向 0.45。
// （不用"最大收缩梯度"启发式：实算最大梯度段是 0.33→0.40，会误得 0.40。）
export function reflectAxialFromProfile(profile) {
  for (let i = profile.length - 1; i > 0; i--) {
    const drdx = Math.abs(profile[i][0] - profile[i - 1][0]) / (profile[i][1] - profile[i - 1][1]);
    if (drdx > 0.1) return profile[i][1];
  }
  return profile[0][1];
}
export const REFLECT_AXIAL = reflectAxialFromProfile(L.engine.chamberProfile);

// 反射系数（面积突断面，r = (A1−A2)/(A1+A2)，波自 A1 侧入射）：
// 扩张段（喉口→腹径）r<0 → 负压回抽；尾管入口（收敛末端→尾管）r>0 → 正压回推。
// ⚠️ 原稿公式 (A₂−A₁)/(A₂+A₁) 的符号与其自述"扩张段 R<0"相反，此处以物理符号为准（§四.5）。
const PROFILE_AREA = (r) => Math.PI * r * r;
export const R_EXPANSION =
  (PROFILE_AREA(L.engine.chamberProfile[0][0]) - PROFILE_AREA(L.engine.chamberProfile[4][0])) /
  (PROFILE_AREA(L.engine.chamberProfile[0][0]) + PROFILE_AREA(L.engine.chamberProfile[4][0]));
export const R_STINGER =
  (PROFILE_AREA(L.engine.chamberProfile[7][0]) - PROFILE_AREA(L.engine.chamberProfile[8][0])) /
  (PROFILE_AREA(L.engine.chamberProfile[7][0]) + PROFILE_AREA(L.engine.chamberProfile[8][0]));

// 波程 = header 弧长（CatmullRom，与 engine.js 走管几何同源）+ 喉口→反射面轴向段。
// 传播方向：喉口 → header 两点 → 喉口（header 与 engine.js 的三点折线同一条曲线）。
const HEADER_PTS = [
  new Vector3(L.engine.x + 0.10, L.engine.chamberY, L.engine.chamberZ0),
  new Vector3(L.engine.x + L.engine.headerRel[1][0], L.engine.y + L.engine.headerRel[1][1], L.engine.z + L.engine.headerRel[1][2]),
  new Vector3(L.engine.x + L.engine.headerRel[0][0], L.engine.y + L.engine.headerRel[0][1], L.engine.z + L.engine.headerRel[0][2]),
];
export const HEADER_LEN = new CatmullRomCurve3(HEADER_PTS, false, 'centripetal').getLength();
export const L_WAVE = HEADER_LEN + REFLECT_AXIAL;   // ≈0.636850（§三.1 首点下移后）
// 吸引波（负压回抽）的有效反射面取扩张段中点（扩张沿程反射的等效平面）
export const S_BELLY = HEADER_LEN + L.engine.chamberProfile[4][1] / 2;  // 腹位 0.26 之半 ≈0.13

// ————— 容积 —————
// V_c 由声称的 trapped 压缩比反解（扫气口关闭位起算）——不是魔数。
export const TRAPPED_STROKE = CROWN_TDC - crownTop(IVO);   // 44.842mm
export const V_TRAPPED = AREA * TRAPPED_STROKE;            // ≈102.70cc
export const V_C = V_TRAPPED / (L.engine.CR_trapped - 1);  // ≈8.216cc
export const HEAD_DECK = CROWN_TDC + V_C / AREA;           // 缸盖底面 ≈+0.1606（云顶固定端面）

// 气缸容积（ATDC 角）：冠顶以上的可变容积 + 余隙
export function cylinderVolume(thetaATDC) {
  return V_C + AREA * (CROWN_TDC - crownTop(thetaATDC));
}

// 曲轴箱：活塞下行压缩（下止点时箱容最小）。V_cc_min 由 CR_cc 反解——
// 规格常量口径（§四.2），几何包络 4.2L 仅供参照，歧管内腔不计入（簧片关闭即隔离）。
export const V_CC_MIN = V_DISP / (L.engine.CR_cc - 1);     // ≈274.8cc
export function crankcaseVolume(thetaATDC) {
  return V_CC_MIN + AREA * (crownTop(thetaATDC) - CROWN_BDC);
}

// ————— 气口面积 —————
// 窗口高度按真机比例：排气 ≈0.35×行程、扫气 ≈0.30×行程（上缘由正时定，下缘为设计值）。
export const EXH_PORT_H = 0.35 * STROKE;
export const TR_PORT_H = 0.30 * STROKE;
export const H_EXH_LO = H_EXH - EXH_PORT_H;   // ≈+0.110
export const H_TR_LO = H_TR - TR_PORT_H;      // ≈+0.096
// 宽度按真机 125cc 比例取缸径周长的分数（排气单口 ≈30mm、扫气 3–5 口合计 ≈59mm）。
export const W_EXH = 0.18 * Math.PI * BORE;
export const W_TR = 0.35 * Math.PI * BORE;

// 开启高度：冠顶降到上缘开始开、降到下缘全开（面积 = 宽 × 开高）
export function exhaustOpenHeight(thetaATDC) {
  return Math.min(H_EXH - crownTop(thetaATDC), EXH_PORT_H);
}
export function transferOpenHeight(thetaATDC) {
  return Math.min(H_TR - crownTop(thetaATDC), TR_PORT_H);
}
export function exhaustArea(thetaATDC) {
  return W_EXH * Math.max(0, exhaustOpenHeight(thetaATDC));
}
export function transferArea(thetaATDC) {
  return W_TR * Math.max(0, transferOpenHeight(thetaATDC));
}

// ————— 零维热力学（§四.3，阶段2）—————
export const P_ATM = 101325;      // Pa
export const C_SOUND = 543;       // 排气声速 m/s（γ=1.33、R=287、T≈775K，§四.5）
const N_COMP = 1.30;              // 压缩多变指数
const N_EXP = 1.28;               // 膨胀多变指数（燃烧放热后）
// 拖转（无燃烧）膨胀有效指数高于压缩：燃气向缸壁散热，∮p dV < 0 马达工况（test 7）。
// 原稿 n_e=1.28<n_c 在无放热时反而 ∮>0（永动机），故拖转口径单列。
const N_EXP_MOTOR = 1.36;
const N_CC = 1.36;                // 曲轴箱多变指数
const IGN = TAU - 20 * D;         // 点火 20°BTDC
const BURN_DUR = 40 * D;          // 燃烧持续 40°
const WIEBE_M = 2;                // Wiebe m（§五.1 固定值，不做双区标定）
const WIEBE_A = 5;
// 放热压比增益：p ×(1+GAIN·x_wiebe)（增量式用 ln(1+GAIN) 保证全燃烧恰乘 (1+GAIN)，
// 不复利过冲）。复核轮标定 GAIN=1.5（峰值 ≈70bar，竞赛 2T 量级）——原稿 1.6 倍率
// 积分出 ≈4–5kW，低于其自身 test 8 下限 8kW。
const BURN_GAIN = 1.5;
const BURN_K = Math.log(1 + BURN_GAIN);
const K_EXH = 10;                 // 排气吹出速率 1/rad（全开）
const K_TR = 6;                   // 扫气充填速率 1/rad
const K_CC_IN = 0.5;              // 簧片开启时曲轴箱充填速率 1/rad（簧片流通面积有限 →
                                  //  吸气期 p_cc 低于大气 ≈0.15–0.25bar，这正是簧片升度来源）
const K_CC_DIS = 4;               // 扫气口开时曲轴箱向气缸放电速率 1/rad（§四.3 三节点网络）
export const P_REF_REED = 15000;  // 簧片全开压差 Pa
const REED_ZETA = 0.08;           // 簧片阻尼比
const REED_WN = L.engine.reedFn * TAU;
const MAX_STEP_RAD = 2 * D;       // 内部步长 ≤2°（§四.6）

// Wiebe 放热分数（点火 20°BTDC、持续 40°；每转各自成窗）
export function wiebeX(thetaATDC) {
  let x = (thetaATDC - IGN) % TAU;
  if (x < 0) x += TAU;
  if (x >= BURN_DUR) return 1;
  return 1 - Math.exp(-WIEBE_A * Math.pow(x / BURN_DUR, WIEBE_M + 1));
}

// 波到达角（吸引波=扩张段反射、回推波=收敛段末端反射）与调谐转速
// 调谐：回波真实时间 2L/c = 排气持续期真实时间（DUR_EXH/ω）→ ω_tuned = DUR_EXH·c/(2L)
export const OMEGA_TUNED = (DUR_EXH * C_SOUND) / (2 * L_WAVE);   // ≈1414 rad/s
export const N_TUNED = (OMEGA_TUNED * 60) / TAU;                 // ≈13,500 rpm（由管长解算，§四.5）

function waveArrivals(omega) {
  const mPerRad = C_SOUND / omega;   // 每曲轴弧度波走的米数（ds/dθ = c/ω_real，§四.7）
  return {
    suc: (EVO + (2 * S_BELLY) / mPerRad) % TAU,
    push: (EVO + (2 * L_WAVE) / mPerRad) % TAU,
  };
}

const bump = (x, w) => Math.exp(-((x / w) ** 2));
const angDist = (a, b) => {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
};

// 排气口外背压：大气 + 到达波叠加（吸引波抽、回推波推）——幅值随转速增长（§四.5 生死线）
export function backPressure(thetaATDC, omega) {
  const { suc, push } = waveArrivals(omega);
  const amp = P_ATM * 0.32 * Math.min(1.3, omega / OMEGA_TUNED);
  return P_ATM + amp * (bump(angDist(thetaATDC, push), 0.35) - bump(angDist(thetaATDC, suc), 0.30));
}

// 充气效率：回推波到达角与 EVC 的重合度（调谐点附近抬头）——同一套波运动学派生
export function etaTr(omega) {
  const push = EVO + (2 * L_WAVE) / (C_SOUND / omega);
  const err = Math.abs(push - EVC) / TAU;
  return 0.72 + 0.28 * Math.exp(-((err / 0.05) ** 2));
}

// 视觉用波脉冲列表（§五.5：纯函数、无积分、无漂移）
// 每次排气事件（EVO）发射的主脉冲走四段：发出(+) → 扩张段反射(−，负压回抽) →
// 透射过扩张段(+) → 收敛段末端反射(+，回推)。u = 沿波程的归一化位置（0 喉口 → 1 反射面）。
// 振幅按反射系数衰减（|R|<1）。θ 为 ATDC、ω 为真实角速度——慢放只放慢时间轴，
// 脉冲随转角的关系不变（§四.7）。
export function wavePulses(theta, omega) {
  const mPerRad = C_SOUND / omega;
  const pulses = [];
  const evoLast = EVO + Math.floor((theta - EVO) / TAU) * TAU; // 距 theta 最近的 EVO
  const nEmit = 4;
  for (let k = 0; k < nEmit; k++) {
    const thEmit = evoLast - k * TAU;
    const d = theta - thEmit;
    if (d < 0) continue;
    let remain = d * mPerRad;
    let dir = 1;                  // +1 远离端口，−1 回向端口
    let sign = 1;                 // +1 压缩（正压），−1 抽吸（负压）
    let strength = 1;
    let guard = 0;
    while (strength >= 0.06 && guard++ < 24) {
      if (remain < L_WAVE) {
        const sPos = dir > 0 ? remain : L_WAVE - remain;
        pulses.push({ u: sPos / L_WAVE, sign, strength });
        break;
      }
      remain -= L_WAVE;
      if (dir > 0) { dir = -1; strength *= 0.55; }  // 收敛段末端反射（R>0）
      else { dir = 1; sign = -sign; }               // 排气口反射（开口端 R≈−1）
    }
  }
  return pulses;
}

// 波状态文字（UI 读数）
export function waveStateText(thetaATDC, omega) {
  const { suc, push } = waveArrivals(omega);
  if (angDist(thetaATDC, push) < 0.35) return '反射回推';
  if (angDist(thetaATDC, suc) < 0.30) return '负压回抽';
  return thetaATDC >= EVO && thetaATDC < EVC ? '正压波下行' : '排气口关闭';
}

// ————— 单步压力推进（角度制，被 solveCycle 与逐帧 step 共用）—————
// 单一压力 p 顺序推进：多变（压缩 N_C / 膨胀 N_E，拖转 N_EXP_MOTOR）+ 排气吹出
// （IVC 前）+ 扫气充填（IVC 前）+ 燃烧放热累进（§五.1）。物理时序：燃烧压力在
// blowdown/换气中随排气自然消失，下一循环 IGN 处无修正不连续。
// IVC 后视为封闭（§四.2 口径）：p_TDC/p_IVC = CR_trappedⁿ 望远镜严格成立。
function cylPressureStep(theta, p, dTheta, omega, pCc, fire) {
  const v1 = cylinderVolume(theta);
  const v2 = cylinderVolume(theta + dTheta);
  const n = v2 > v1 ? (fire ? N_EXP : N_EXP_MOTOR) : N_COMP;
  let p2 = p * Math.pow(v1 / v2, n);
  if (theta < IVC) {
    const aExh = exhaustArea(theta);
    if (aExh > 0) {
      const aFull = W_EXH * EXH_PORT_H;
      // 背压波动是燃烧排气波的产物；拖转排气安静，背压恒为大气
      const pBack = fire ? backPressure(theta, omega) : P_ATM;
      p2 += (pBack - p2) * K_EXH * (aExh / aFull) * dTheta;
    }
    const aTr = transferArea(theta);
    if (aTr > 0 && pCc > p2) {
      p2 += (pCc - p2) * K_TR * dTheta;
    }
  }
  if (fire) {
    const dx = Math.max(0, wiebeX(theta + dTheta) - wiebeX(theta));
    if (dx > 0) p2 += p2 * BURN_K * dx;
  }
  return Math.max(p2, P_ATM * 0.05);
}

const BURN_FINE = 0.25 * D; // solveCycle 燃烧窗细步
const inBurnWindow = (th) => {
  let x = (th - IGN + TAU + 3 * D) % TAU;
  return x < BURN_DUR + 6 * D;
};

// 曲轴箱（统一方程）：多变（压缩/膨胀）+ 扫气口开时向气缸放电（§四.3 三节点网络的
// 曲轴箱→气缸通道）+ 簧片充填（p 低于大气时开启；簧片流通面积有限 → 吸气期 p_cc 低于
// 大气 ≈0.15–0.25bar，这正是簧片升度与"泵气"的来源）。没有放电通道时 p_cc 在上行
// 全程高于大气、簧片永不开启（复核轮实测教训）；下行时容积压缩与充填同存，
// p_cc 过大气后簧片关闭、转纯多变。
function ccPressureStep(theta, pCc, dTheta, pCyl) {
  const v1 = crankcaseVolume(theta);
  const v2 = crankcaseVolume(theta + dTheta);
  let p = pCc * Math.pow(v1 / v2, N_CC);
  const aTrFrac = transferArea(theta) / (W_TR * TR_PORT_H);
  if (aTrFrac > 0 && p > pCyl) {
    p += (pCyl - p) * Math.min(1, K_CC_DIS * aTrFrac * dTheta);
  }
  if (p < P_ATM) p += (P_ATM - p) * Math.min(1, K_CC_IN * dTheta);
  return p;
}

// 稳态解：1° 步进跑 revs 圈收敛，末圈按整度采样（IVC=235°/EVC=275°/TDC=360° 均为整度格点，
// test 6 的 p_TDC/p_IVC = CRⁿ 望远镜因此严格成立）。fire=false 为拖转工况（无燃烧）。
export function solveCycle(rpm, { fire = true, revs = 12 } = {}) {
  const omega = (rpm / 60) * TAU;
  let p = P_ATM;
  let pCc = P_ATM;
  for (let rev = 0; rev < revs; rev++) {
    const last = rev === revs - 1;
    const loop = last ? [] : null;
    const samples = last ? [] : null;
    let work = 0;
    let peak = 0;
    let pTdc = 0;
    let pIvc = 0;
    let pCcPeak = 0;
    // 固定 1° 网格（IVC=235° / TDC=360° 均为整点 → test 6 望远镜严格成立）；
    // 燃烧窗内的 1° 步再 4 等分（0.25°）消化 Wiebe 陡段。
    for (let deg = 0; deg < 360; deg++) {
      const thRad = deg * D;
      const v1 = cylinderVolume(thRad);
      const p1 = p;
      const sub = inBurnWindow(thRad) || inBurnWindow((deg + 1) * D) ? 4 : 1;
      for (let ss = 0; ss < sub; ss++) {
        p = cylPressureStep((deg + ss / sub) * D, p, D / sub, omega, pCc, fire);
        pCc = ccPressureStep((deg + ss / sub) * D, pCc, D / sub, p);
      }
      const pCyl = p;
      const v2 = cylinderVolume((deg + 1) * D);
      work += ((p1 + pCyl) / 2) * (v2 - v1);   // ∮p dV（梯形，膨胀为正）
      if (pCyl > peak) peak = pCyl;
      if (pCc > pCcPeak) pCcPeak = pCc;
      if (last) {
        loop.push([v2 * 1e6, pCyl / 1e5]);
        samples.push({ theta: deg, pCylBar: pCyl / 1e5, pCcBar: pCc / 1e5, reed: Math.max(0, Math.min(1, (P_ATM - pCc) / P_REF_REED)) });
        if (deg === Math.round(IVC / D)) pIvc = p1;      // IVC=235° 整点
        if (deg === 359) pTdc = pCyl;                    // 步进至 TDC
      }
    }
    if (last) {
      return {
        loop, samples,
        workJ: work,
        powerW: work * (rpm / 60),
        peakBar: peak / 1e5,
        pTdcBar: pTdc / 1e5,
        pIvcBar: pIvc / 1e5,
        pCcPeakBar: pCcPeak / 1e5,
        etaTr: etaTr(omega),
        omega,
        fire,
      };
    }
  }
}

// ————— 状态推进（逐帧；dθ = s.omega·dt 视觉角基，§四.6）—————
export function createCycleModel() {
  const m = {
    theta: 0,          // ATDC 弧度（累计不取模）
    revs: 0,
    rpm: 0,
    throttle: 0,
    pCyl: P_ATM,
    pCc: P_ATM,
    fresh: 0,
    reedX: 0,          // 簧片开度（闭式二阶状态，跟视觉时钟 §四.4）
    reedV: 0,
    pBackBar: P_ATM / 1e5,
    etaTrNow: 1,
    subSteps: 0,
  };

  m.step = (dTheta, rpm, throttle, dt = 1 / 60) => {
    if (!Number.isFinite(dTheta) || dTheta <= 0 || !(dt > 0)) return;
    const omegaReal = (rpm / 60) * TAU;
    let th = m.theta % TAU;
    let remaining = dTheta;
    let guard = 0;
    while (remaining > 1e-12 && guard++ < 800) {
      // 绝对网格对齐（0.25°/2° 两种格距均自 θ=0 对齐）：不同帧长拆分同一条网格，
      // 轨迹逐点一致 → test 12 的 dt 无关性严格成立
      let hMax = inBurnWindow(th) ? BURN_FINE : MAX_STEP_RAD;
      const nextBoundary = (Math.floor(th / hMax + 1e-9) + 1) * hMax;
      const h = Math.min(hMax, nextBoundary - th, remaining);
      const dtSub = (dt * h) / dTheta;   // 该子步对应的视觉时长（簧片跟视觉时钟 §四.4）
      const thRad = th;
      m.pCyl = cylPressureStep(thRad, m.pCyl, h, omegaReal, m.pCc, true);
      m.pCc = ccPressureStep(thRad, m.pCc, h, m.pCyl);
      const aTr = transferArea(thRad);
      if (aTr > 0 && m.pCc > m.pCyl) m.fresh += (1 - m.fresh) * K_TR * h;
      // 簧片闭式状态转移（分片常力精确解，无条件稳定 §四.4/test 10）
      const u = Math.max(0, Math.min(1, (P_ATM - m.pCc) / P_REF_REED));
      const e = Math.exp(-REED_ZETA * REED_WN * dtSub);
      const wd = REED_WN * Math.sqrt(1 - REED_ZETA * REED_ZETA);
      const A = m.reedX - u;
      const B = (m.reedV + REED_ZETA * REED_WN * A) / wd;
      const c = Math.cos(wd * dtSub);
      const s2 = Math.sin(wd * dtSub);
      const x2 = u + e * (A * c + B * s2);
      const v2v = e * (m.reedV * c - (A * wd + REED_ZETA * REED_WN * B) * s2);
      m.reedX = Math.max(0, Math.min(1, x2));
      m.reedV = x2 <= 0 || x2 >= 1 ? 0 : v2v; // 机械止动：触限即吸能
      m.etaTrNow = etaTr(omegaReal);
      th = (th + h) % TAU;
      remaining -= h;
    }
    m.subSteps = guard;
    m.theta += dTheta;                 // 累计不取模（revs 由派生）
    m.revs = Math.floor(m.theta / TAU);
    m.rpm = rpm;
    m.throttle = throttle;
  };

  m.thetaATDC = () => m.theta % TAU;
  m.thetaDeg = () => ((m.theta % TAU) / D);
  m.pvPoint = () => [cylinderVolume(m.theta % TAU) * 1e6, m.pCyl / 1e5]; // P-V 活动点
  m.readouts = () => ({
    pCylBar: m.pCyl / 1e5,
    pCcBar: m.pCc / 1e5,
    reedLift: m.reedX,
    waveState: waveStateText(m.theta % TAU, (m.rpm / 60) * TAU),
    etaTr: m.etaTrNow,
    thetaDeg: (m.theta % TAU) / D,
    vCc: cylinderVolume(m.theta % TAU) * 1e6,   // P-V 环活动点（cc, bar）
    revs: m.revs,
  });
  return m;
}
