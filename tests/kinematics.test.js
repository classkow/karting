// ————— 机构运动学单元测试 —————
// 运行：npm test（即 node --test tests/kinematics.test.js，勿改回目录模式，Windows 有坑）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pistonStroke, chainPath, solveSteeringAngle } from '../src/sim/kinematics.js';
import { L, tieRodLen } from '../src/kart/layout.js';

const R = L.crankR;    // 曲柄半径（同源 layout.js）
const LROD = L.rodLen; // 连杆长度（同源 layout.js）

// 与实车一致的链轮布置（曲轴链轮 → 后链轮），常量全部同源 layout.js（对照 drivetrain.js 链条包络调用处）
const C1 = { y: L.engine.y, z: L.engine.z - 0.11, r: L.clutchR }; // -0.11 为离合器轴向偏移：layout 无此字段，手抄同步（engine.js 离合器 position）
const C2 = { y: L.axleY, z: L.rearAxleZ, r: L.sprocketR };

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

test('链条包络：总长为正且路径闭合、相位可回绕', () => {
  // 常量契约（先例：state.test.js 守 CLUTCH_ENGAGE_RPM）：layout 调参必须变红，杜绝"静默全绿"假保护
  assert.equal(C1.r, 0.0224, '曲轴链轮 12T 节圆半径契约');
  assert.equal(C2.r, 0.1232, '后链轮 66T 节圆半径契约（= CLUTCH_R × 66/12）');
  const p = chainPath(C1, C2);
  assert.ok(p.total > 0);
  const a = p.pointAt(0);
  const b = p.pointAt(p.total);
  assert.ok(Math.hypot(a.z - b.z, a.y - b.y) < 1e-9, '首尾应重合');
  const c = p.pointAt(p.total * 0.37);
  const d = p.pointAt(p.total * 0.37 + p.total);
  assert.ok(Math.hypot(c.z - d.z, c.y - d.y) < 1e-9, '+total 应与原位同点');
});

test('链条包络：直段是真外公切线（切点处半径 ⊥ 直段）', () => {
  const p = chainPath(C1, C2);
  // 直段长度应等于 √(d² − (r2−r1)²)
  const d = Math.hypot(C2.z - C1.z, C2.y - C1.y);
  const expect = Math.sqrt(d * d - (C2.r - C1.r) ** 2);
  assert.ok(Math.abs(p.segLen - expect) < 1e-12, `直段长度 ${p.segLen} ≠ ${expect}`);

  // 四个切点：pointAt(0)=p1c1, pointAt(segLen)=p1c2, pointAt(segLen+r2·arc2)=p2c2, pointAt(total−r1·arc1)=p2c1
  const p1c1 = p.pointAt(0);
  const p1c2 = p.pointAt(p.segLen);
  const p2c2 = p.pointAt(p.segLen + C2.r * p.wrap.c2);
  const p2c1 = p.pointAt(p.segLen + C2.r * p.wrap.c2 + p.segLen);
  const seg1 = { z: p1c2.z - p1c1.z, y: p1c2.y - p1c1.y };
  const seg2 = { z: p2c1.z - p2c2.z, y: p2c1.y - p2c2.y };
  for (const [pt, c, seg, tag] of [
    [p1c1, C1, seg1, '小轮切点1'],
    [p1c2, C2, seg1, '大轮切点1'],
    [p2c2, C2, seg2, '大轮切点2'],
    [p2c1, C1, seg2, '小轮切点2'],
  ]) {
    const dot = (pt.z - c.z) * seg.z + (pt.y - c.y) * seg.y;
    assert.ok(Math.abs(dot) < 1e-9, `${tag} 半径与直段不垂直: dot=${dot}`);
  }
});

test('链条包络：大轮包角 > π > 小轮包角（开式传动，非交叉缠绕）', () => {
  const p = chainPath(C1, C2);
  // 理论值：ψ = asin((r2−r1)/d)，大轮 π+2ψ，小轮 π−2ψ
  const d = Math.hypot(C2.z - C1.z, C2.y - C1.y);
  const psi = Math.asin((C2.r - C1.r) / d);
  assert.ok(Math.abs(p.wrap.c2 - (Math.PI + 2 * psi)) < 1e-12, '大轮包角');
  assert.ok(Math.abs(p.wrap.c1 - (Math.PI - 2 * psi)) < 1e-12, '小轮包角');
  assert.ok(p.wrap.c2 > Math.PI && p.wrap.c1 < Math.PI);
  assert.ok(Math.abs(p.wrap.c1 + p.wrap.c2 - Math.PI * 2) < 1e-12, '两包角互补');
});

test('链条包络：链节行进方向与链轮正转线速度同向（不反向滑齿）', () => {
  const p = chainPath(C1, C2);
  const eps = 1e-6;
  // 在两段包弧中点采样：链节速度方向应与"正转（rotation.x > 0）"轮面线速度方向一致。
  // 正转线速度（点 = c + r·(cos a, sin a)，a 随正转减小）：(dz, dy) = (y_rel, −z_rel) · ω
  for (const [s, c] of [
    [p.segLen + (C2.r * p.wrap.c2) / 2, C2],
    [p.total - (C1.r * p.wrap.c1) / 2, C1],
  ]) {
    const a = p.pointAt(s - eps);
    const b = p.pointAt(s + eps);
    const mid = p.pointAt(s);
    const v = { z: b.z - a.z, y: b.y - a.y };
    const vRot = { z: mid.y - c.y, y: -(mid.z - c.z) };
    const cos = (v.z * vRot.z + v.y * vRot.y) / (Math.hypot(v.z, v.y) * Math.hypot(vRot.z, vRot.y));
    assert.ok(cos > 0.999, `链速方向与链轮转向不一致: cos=${cos}`);
  }
});

test('链条包络：直线段上相邻采样点间距 ≈ 步长（弧长参数化）', () => {
  const p = chainPath(C1, C2);
  const step = 0.001;
  const near = p.pointAt(p.segLen / 2); // 直段1 内
  const near2 = p.pointAt(p.segLen / 2 + step);
  const dist = Math.hypot(near.z - near2.z, near.y - near2.y);
  assert.ok(Math.abs(dist - step) / step < 0.02, `直段弧长参数化失真: ${dist}`);
});

test('转向刚杆约束：解满足定长条件（全行程扫描）', () => {
  // 常量契约（先例：链条测试守链轮半径契约）：纯派生断言"自身自洽"对几何漂移免疫，
  // 契约把现役转向几何钉住——layout 调参必须先变红、确认可行域后再有意识地更新契约值。
  assert.equal(L.steering.arm, 0.22, '转向臂长契约');
  assert.equal(L.steering.armIn, 0.182, '转向臂内倾契约');
  assert.equal(L.steering.armY, 0.002, '转向臂高契约');
  assert.equal(L.steering.rackHalf, 0.3, '齿条端半距契约');
  assert.equal(L.steering.rackTravel, 0.062, '齿条行程契约');
  assert.equal(L.steering.pinionR, 0.021, '小齿轮节圆半径契约');
  // 几何全部派生自 layout + tieRodLen（与 steering.js 同一来源，改 layout 自动跟随）。
  // 此处以左侧（sign=-1）为样本扫描全行程；vx/vz/armY/rackEnd 符号约定同 steering.js update。
  const sign = -1;
  const geom = {
    vx: -sign * L.steering.armIn,
    vz: -L.steering.arm,
    armY: L.steering.armY,
    rodLen: tieRodLen(sign),
    pivot: { x: sign * L.kingpinX, y: L.kingpinY, z: L.frontAxleZ },
  };
  for (let t = -1; t <= 1.001; t += 0.05) {
    const rackEnd = { x: sign * L.steering.rackHalf + t * L.steering.rackTravel, y: L.rackY, z: L.rackZ };
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

test('转向几何同源：直行位拉杆恰好闭合于 a=0（tieRodLen 与转向器一致）', () => {
  // tieRodLen 的臂端中性位定义（a=0）与齿条直行位必须自洽——否则直行位车轮初始即歪
  for (const sign of [-1, 1]) {
    const a = solveSteeringAngle({
      vx: -sign * L.steering.armIn,
      vz: -L.steering.arm,
      armY: L.steering.armY,
      rodLen: tieRodLen(sign),
      pivot: { x: sign * L.kingpinX, y: L.kingpinY, z: L.frontAxleZ },
      rackEnd: { x: sign * L.steering.rackHalf, y: L.rackY, z: L.rackZ },
      a0: 0,
    });
    assert.ok(Math.abs(a) < 1e-9, `sign=${sign} 直行位解 a=${a}，应恰为 0`);
  }
});

test('转向解暖启动：与冷启动同解（数值稳定）', () => {
  const sign = 1; // 右侧（rackEnd 在满行程外端）
  const base = {
    vx: -sign * L.steering.armIn,
    vz: -L.steering.arm,
    armY: L.steering.armY,
    rodLen: tieRodLen(sign),
    pivot: { x: sign * L.kingpinX, y: L.kingpinY, z: L.frontAxleZ },
    rackEnd: { x: sign * L.steering.rackHalf + L.steering.rackTravel, y: L.rackY, z: L.rackZ },
  };
  const cold = solveSteeringAngle({ ...base, a0: 0 });
  const warm = solveSteeringAngle({ ...base, a0: cold * 0.8 });
  assert.ok(Math.abs(cold - warm) < 1e-9);
});
