// ————— 主销几何举升（kingpin jacking）单元测试 —————
// 运行：npm test（node --test）。几何常量全部同源 layout.js（调参必须变红，杜绝静默全绿）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kingpinAxis, kingpinDrop, solveChassisPose, solveSteeringAngle } from '../src/sim/kinematics.js';
import { L, tieRodLen } from '../src/kart/layout.js';

const GEOM = {
  trackF: 2 * L.kingpinX,
  trackR: 2 * L.rearTrack,
  wheelbase: L.frontAxleZ - L.rearAxleZ,
  kpiGeom: { kpi: L.kingpinKPI, caster: L.kingpinCaster, scrub: L.kingpinScrub, trail: L.kingpinTrail },
};

// 满舵角派生（不再手抄实测数字）：符号约定同 steering.js 现行 update——
// disp = steerSmooth·rackTravel，rackEnd.x = sign·rackHalf + disp；steer=+1 为左转，
// 内侧=左轮（负角、打满），外侧=右轮（负角、阿克曼略小）。几何再调时测试自动跟随。
function fullSteerAngle(sign) {
  const arg = {
    vx: -sign * L.steering.armIn,
    vz: -L.steering.arm,
    armY: L.steering.armY,
    rodLen: tieRodLen(sign),
    pivot: { x: sign * L.kingpinX, y: L.kingpinY, z: L.frontAxleZ },
    rackEnd: { x: sign * L.steering.rackHalf + L.steering.rackTravel, y: L.rackY, z: L.rackZ },
  };
  const cold = solveSteeringAngle({ ...arg, a0: 0 });
  return solveSteeringAngle({ ...arg, a0: cold }); // 暖启动复核，防冷启动未收敛
}
const FULL_L = fullSteerAngle(-1);
const FULL_R = fullSteerAngle(1);

test('举升常量契约与主销轴向：单位向量、上端向内且向后', () => {
  // 常量契约（先例：链条测试守链轮半径契约）
  assert.equal(L.kingpinKPI, (10 * Math.PI) / 180, 'KPI = 10°');
  assert.equal(L.kingpinCaster, (12 * Math.PI) / 180, 'caster = 12°');
  assert.equal(L.kingpinScrub, 0.015, 'scrub = 15mm');
  assert.equal(L.kingpinTrail, 0.02, 'trail = 20mm');
  for (const side of [-1, 1]) {
    const u = kingpinAxis({ ...GEOM.kpiGeom, side });
    assert.ok(Math.abs(Math.hypot(...u) - 1) < 1e-12, '单位向量');
    assert.ok(-side * u[0] > 0, `side=${side} 上端应向内（朝车身中线）`);
    assert.ok(u[2] < 0, `side=${side} 上端应向后（朝车尾）`);
  }
});

test('kingpinDrop：直行归零，采样连续', () => {
  const g = { u: kingpinAxis({ ...GEOM.kpiGeom, side: -1 }), ...GEOM.kpiGeom, side: -1 };
  assert.equal(kingpinDrop(0, g), 0, 'a=0 下沉量必须为 0');
  const step = 1e-3;
  for (let a = -0.62; a < 0.62; a += step) {
    const d0 = kingpinDrop(a, g);
    const d1 = kingpinDrop(a + step, g);
    assert.ok(Number.isFinite(d1));
    assert.ok(Math.abs(d1 - d0) < 1e-5, `a=${a.toFixed(3)} 相邻采样跳变: ${d0} → ${d1}`);
  }
});

test('整车姿态：直行恒等、两轮离地量为 0', () => {
  const p = solveChassisPose(0, 0, GEOM);
  assert.equal(p.heave, 0);
  assert.equal(p.roll, 0);
  assert.equal(p.pitch, 0);
  assert.equal(p.rearLiftL, 0);
  assert.equal(p.rearLiftR, 0);
});

test('整车姿态：满左 vs 满右镜像对称（离地量相等、roll 反号）', () => {
  const pl = solveChassisPose(FULL_L, FULL_R, GEOM);
  const pr = solveChassisPose(-FULL_R, -FULL_L, GEOM); // 右满舵 = 左右镜像
  assert.ok(Math.abs(pl.rearLiftL - pr.rearLiftR) < 1e-12, '内侧离地量镜像相等');
  assert.ok(Math.abs(pl.roll + pr.roll) < 1e-12, 'roll 反号');
  assert.ok(Math.abs(pl.heave - pr.heave) < 1e-12, 'heave 相同');
  assert.ok(pl.rearLiftL > 0 && pr.rearLiftR > 0, '内侧后轮必须离地');
  assert.ok(Math.abs(pl.rearLiftR) < 1e-12, '外侧后轮贴地（支撑点）');
  assert.ok(Math.abs(pr.rearLiftL) < 1e-12, '外侧后轮贴地（支撑点）');
});

test('整车姿态：|a| 渐增时内侧离地量单调不减', () => {
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.025) {
    const p = solveChassisPose(FULL_L * t, FULL_R * t, GEOM);
    assert.ok(p.rearLiftL >= prev - 1e-12, `t=${t.toFixed(3)} 离地量回退: ${prev} → ${p.rearLiftL}`);
    prev = p.rearLiftL;
  }
});

test('整车姿态：满舵量级合理（防单位错误/公式写反）', () => {
  const p = solveChassisPose(FULL_L, FULL_R, GEOM);
  const mm = p.rearLiftL * 1000;
  assert.ok(mm > 0.5 && mm < 50, `满舵内侧后轮离地 ${mm.toFixed(2)}mm 应在 (0.5, 50)mm（参考 3–15mm）`);
  // 单前轮下沉量量级参考 1–4mm
  const dL = kingpinDrop(FULL_L, { u: kingpinAxis({ ...GEOM.kpiGeom, side: -1 }), ...GEOM.kpiGeom, side: -1 });
  assert.ok(Math.abs(dL) * 1000 > 0.5 && Math.abs(dL) * 1000 < 8, `单轮下沉 ${(dL * 1000).toFixed(2)}mm 量级异常`);
  // 小角度线化前提：姿态角 < 2°
  assert.ok(Math.abs(p.roll) < (2 * Math.PI) / 180 && Math.abs(p.pitch) < (2 * Math.PI) / 180, '姿态角应 <2°');
});

test('整车姿态：2mm 软过渡连续（滑块微动姿态不跳变）', () => {
  // 跨越离地阈值（t: 0→1 过渡区）细采样，相邻帧姿态/离地量不得跳变
  let prev = null;
  for (let a = 0; a >= -0.3; a -= 0.002) {
    const p = solveChassisPose(a, a * (FULL_R / FULL_L), GEOM);
    if (prev) {
      assert.ok(Math.abs(p.rearLiftL - prev.rearLiftL) < 1e-4, `a=${a.toFixed(3)} 离地量跳变`);
      assert.ok(Math.abs(p.roll - prev.roll) < 1e-4, `a=${a.toFixed(3)} roll 跳变`);
    }
    prev = p;
  }
});
