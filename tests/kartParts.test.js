import './helpers/canvasStub.js'; // 必须先于 materials.js：材质库在模块作用域生成 canvas 纹理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { M } from '../src/kart/materials.js';
import { createRegistry } from '../src/kart/registry.js';
import { buildChassis } from '../src/kart/parts/chassis.js';
import { buildWheel } from '../src/kart/parts/wheels.js';
import { L } from '../src/kart/layout.js';
import { PAINT_DEFAULT, PAINT_PRESETS, paintPreset, applyPaintPreset } from '../src/kart/paintPresets.js';

// ————— 装配级不变量（变更 #44 返工：座椅喷漆 + 胎侧环带可见性）—————
// 本套件在 node 里装配真实部件（tests/helpers/canvasStub.js 补最小 DOM），
// 断言的是"生产代码用哪个材质/什么几何"，不是替身之间的关系——grep 材质名审计曾漏掉
// 座椅壳（消费车漆但材质名不叫 paint），只有装配态能守住这类消费面缺口。

// 车床网格 → 母线折线路径（LatheGeometry 按母线点顺序写顶点 ⇒ 有符号 y 的首次出现序即路径序）
// 每行记该条带的半径上下限：旋转体 ⇒ 同一条带半径唯一（min ≈ max）
function lathePath(geo) {
  const pos = geo.attributes.position;
  const rows = new Map();
  for (let i = 0; i < pos.count; i++) {
    const y = +pos.getY(i).toFixed(7);
    const rho = Math.hypot(pos.getX(i), pos.getZ(i));
    const row = rows.get(y);
    if (row) {
      row.min = Math.min(row.min, rho);
      row.max = Math.max(row.max, rho);
    } else rows.set(y, { axial: Math.abs(y), min: rho, max: rho });
  }
  return [...rows.values()];
}

// 胎体旋转体的外包容半径 = 所有穿越 |轴向| q 的母线线段里的最大插值半径。
// 必须按路径线段求、不能按 |轴向| 归并后再连线：胎肩段（半径随轴向回缩）与胎侧锥面
// （半径随轴向外扩）在轴向区间上重叠，归并把折返抹平成一条假的下凹包络，
// 于是埋进胎体里的环带也会被判成"已在轮廓之外"。
function envelopeAt(path, q) {
  let best = -1;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const lo = Math.min(a.axial, b.axial);
    const hi = Math.max(a.axial, b.axial);
    if (q < lo - 1e-7 || q > hi + 1e-7) continue;
    const t = a.axial === b.axial ? 0 : (q - a.axial) / (b.axial - a.axial);
    best = Math.max(best, a.max + (b.max - a.max) * Math.min(Math.max(t, 0), 1));
  }
  assert.ok(best >= 0, `轴向 ${(q * 1000).toFixed(2)}mm 处胎体母线无穿越`);
  return best;
}

test('喷漆·消费面：座椅壳与车身共用同一漆面实例，改色即改座椅', () => {
  const root = new THREE.Group();
  buildChassis(root, createRegistry());
  const shell = root.getObjectByName('seat-shell');
  assert.ok(shell && shell.isMesh, '座椅壳网格缺失或未命名（seat-shell）');
  assert.ok(shell.material === M.paintRed,
    '座椅壳必须挂在车漆共享实例上：另立材质实例就会脱离喷漆链路（变更 #44 缺陷一）');

  const blue = PAINT_PRESETS.find((p) => p.id !== PAINT_DEFAULT);
  applyPaintPreset(M.paintRed, blue);
  assert.equal(shell.material.color.getHex(), parseInt(blue.hex.slice(1), 16),
    `点色板 ${blue.hex} 后座椅壳未变色`);
  applyPaintPreset(M.paintRed, paintPreset(PAINT_DEFAULT)); // 复位，别把色号污染留给同套件的后续断言
});

test('喷漆·非漆面对照：坐垫/靠背软垫是织物，不随车漆变色', () => {
  const root = new THREE.Group();
  buildChassis(root, createRegistry());
  const seat = root.getObjectByName('seat-shell').parent;
  const pads = seat.children.filter((o) => o.isMesh && o !== seat.children[0]);
  assert.equal(pads.length, 3, '坐垫 + 两段靠背软垫');
  const green = PAINT_PRESETS.find((p) => p.name === '荧光绿') ?? PAINT_PRESETS.find((p) => p.id !== PAINT_DEFAULT);
  applyPaintPreset(M.paintRed, green);
  for (const pad of pads) {
    assert.ok(pad.material === M.fabric, '软垫材质应为织物（织物件不喷漆）');
    assert.equal(pad.material.color.getHex(), 0x1d2024, '织物色被车漆链路污染');
  }
  applyPaintPreset(M.paintRed, paintPreset(PAINT_DEFAULT));
});

test('胎侧环带·整条母线抬到胎体外包络之外，且不越胎体名义轮廓', () => {
  // 判据一（可见性）：环带半径 ≥ 同轴向胎体外包容半径 + 0.5mm。
  //   0.5mm 的来历：展台相机 near=0.05 / far=80 / 24bit 深度，在 3.9m 视距处一个深度码
  //   ≈ 3.9²·(1/0.05 − 1/80)/2²⁴ ≈ 0.018mm，0.5mm 即 27 个深度码——既不共面 Z-fighting，
  //   也在"整车视角 1mm≈1px"的可辨量级之上。两侧胎肩的环带还须落在胎体两侧之外。
  // 判据二（不穿模 / 不改名义尺寸）：环带半径 ≤ 胎面冠径、环带轴向 ≤ 胎体最外缘——
  //   外观件不得把轮胎名义半径或名义宽度顶出去（离地间隙、质心高、轮拱横向间隙都锚在它们上）。
  // 两判据在相邻条带之间都是线性插值 ⇒ 差值线性 ⇒ 顶/底两端点满足即整段满足。
  const GAP = 0.0005;
  const EPS = 1e-7; // 顶点坐标存 Float32，公制尺度下的量化噪声（≈0.1µm）
  for (const [label, { r, w }, bolts] of [['后轮', L.wheelR, 4], ['前轮', L.wheelF, 3]]) {
    const wheel = buildWheel(r, w, bolts);
    const tire = wheel.getObjectByName('tire-body');
    assert.ok(tire, `${label}胎体网格缺失或未命名（tire-body）`);
    const path = lathePath(tire.geometry);
    const crown = Math.max(...path.map((row) => row.max));
    const edge = Math.max(...path.map((row) => row.axial));
    const bands = wheel.children.filter((o) => o.name === 'tire-band');
    assert.equal(bands.length, 2, `${label}应两侧各一条环带`);
    let checked = 0;
    for (const band of bands) {
      const bandRows = lathePath(band.geometry);
      assert.equal(bandRows.length, 2, `${label}环带母线应为一条直线段（两端点）`);
      for (const row of bandRows) {
        // 旋转体对称：环带半径与方位角无关 ⇒ 车轮自旋任意角度观感一致
        assert.ok(row.max - row.min < EPS, `${label}环带同一条带半径不唯一，不是旋转面`);
        assert.ok(row.axial <= edge + EPS,
          `${label}环带轴向 ${(row.axial * 1000).toFixed(1)}mm 超出胎体最外缘 ${(edge * 1000).toFixed(1)}mm`);
        assert.ok(row.max <= crown + EPS,
          `${label}环带半径 ${(row.max * 1000).toFixed(1)}mm 超出胎面冠径 ${(crown * 1000).toFixed(1)}mm`);
        const env = envelopeAt(path, row.axial);
        assert.ok(row.max >= env + GAP,
          `${label}环带在轴向 ${(row.axial * 1000).toFixed(1)}mm 处半径 ${(row.max * 1000).toFixed(2)}mm `
          + `未超出胎体外包容半径 ${(env * 1000).toFixed(2)}mm（间隙 ${((row.max - env) * 1000).toFixed(2)}mm < 0.5mm）`);
        checked++;
      }
    }
    assert.equal(checked, 4, `${label}两侧共 4 条母线待验`);
  }
});
