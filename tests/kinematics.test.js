// ————— 机构运动学单元测试 —————
// 运行：npm test（即 node --test tests/）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pistonStroke, chainPath, solveSteeringAngle } from '../src/sim/kinematics.js';

const R = 0.035;   // 曲柄半径（同 layout.js）
const LROD = 0.13; // 连杆长度

test('曲柄滑块：上下止点解析值', () => {
  assert.ok(Math.abs(pistonStroke(Math.PI / 2, R, LROD) - (R + LROD)) < 1e-12, '上止点 = R + L');
  assert.ok(Math.abs(pistonStroke(-Math.PI / 2, R, LROD) - (LROD - R)) < 1e-12, '下止点 = L − R');
});

test('曲柄滑块：全周连续且杆长约束恒成立', () => {
  for (let i = 0; i <= 720; i++) {
    const th = (i / 720) * Math.PI * 2;
    const s = pistonStroke(th, R, LROD);
    assert.ok(s >= LROD - R - 1e-9 && s <= LROD + R + 1e-9, `θ=${th} 越界: ${s}`);
    // 连杆约束：侧移 R·cosθ、轴向 s − R·sinθ，斜边必须恒等于杆长
    const c = R * Math.cos(th);
    assert.ok(Math.abs(Math.hypot(c, s - R * Math.sin(th)) - LROD) < 1e-9);
  }
});

test('链条包络：总长为正且路径闭合', () => {
  const p = chainPath({ y: 0.165, z: -0.31, r: 0.0224 }, { y: 0.145, z: -0.53, r: 0.124 });
  assert.ok(p.total > 0);
  const a = p.pointAt(0);
  const b = p.pointAt(p.total);
  const c = p.pointAt(p.total * 0.37);
  assert.ok(Math.hypot(a.z - b.z, a.y - b.y) < 1e-9, '首尾应重合');
  // 相位回绕：+total 与原位同点
  const d = p.pointAt(p.total * 0.37 + p.total);
  assert.ok(Math.hypot(c.z - d.z, c.y - d.y) < 1e-9);
});

test('链条包络：直线段上相邻采样点间距 ≈ 步长', () => {
  const p = chainPath({ y: 0.165, z: -0.31, r: 0.0224 }, { y: 0.145, z: -0.53, r: 0.124 });
  const step = 0.001;
  const q1 = p.pointAt(p.total * 0.6); // 大概率落在大轮包弧上；换 s=segLen/2 检查直段
  const near = p.pointAt(p.total * 0.1); // 第一段紧边直段内
  const near2 = p.pointAt(p.total * 0.1 + step);
  const dist = Math.hypot(near.z - near2.z, near.y - near2.y);
  assert.ok(Math.abs(dist - step) / step < 0.02, `直段弧长参数化失真: ${dist}`);
  assert.ok(Number.isFinite(Math.hypot(q1.z, q1.y)));
});

test('转向刚杆约束：解满足定长条件（全行程扫描）', () => {
  const geom = { vx: 0.034, vz: -0.13, armY: -0.003, rodLen: 0.286, pivot: { x: -0.585, y: 0.135, z: 0.52 } };
  for (let t = -1; t <= 1.001; t += 0.05) {
    const rackEnd = { x: -0.3 + t * 0.062, y: 0.125, z: 0.34 };
    const a = solveSteeringAngle({ ...geom, rackEnd });
    const ex = geom.pivot.x + geom.vx * Math.cos(a) + geom.vz * Math.sin(a);
    const ez = geom.pivot.z - geom.vx * Math.sin(a) + geom.vz * Math.cos(a);
    const len = Math.hypot(ex - rackEnd.x, geom.pivot.y + geom.armY - rackEnd.y, ez - rackEnd.z);
    // 钳制到 ±0.62 的极端情况下允许不闭合，其余必须定长
    if (Math.abs(a) < 0.619) {
      assert.ok(Math.abs(len - geom.rodLen) < 1e-6, `t=${t.toFixed(2)} 杆长漂移: ${len}`);
    }
  }
});

test('转向解暖启动：与冷启动同解（数值稳定）', () => {
  const base = { vx: -0.034, vz: -0.13, armY: -0.003, rodLen: 0.286, pivot: { x: 0.585, y: 0.135, z: 0.52 }, rackEnd: { x: 0.362, y: 0.125, z: 0.34 } };
  const cold = solveSteeringAngle({ ...base, a0: 0 });
  const warm = solveSteeringAngle({ ...base, a0: cold * 0.8 });
  assert.ok(Math.abs(cold - warm) < 1e-9);
});
