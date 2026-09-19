import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshPhysicalMaterial } from 'three';
import { PAINT_PRESETS, PAINT_DEFAULT, paintPreset, applyPaintPreset } from '../src/kart/paintPresets.js';

// ————— 变更 #44 任务一：喷漆预设色板（纯数据 + 依赖注入式应用函数）—————
// 应用函数签名为 applyPaintPreset(material, preset)：只写 .color，材质实例由调用方
// 注入（真实链路是共享的 M.paintRed——所有车漆消费面改一处全局生效）。本测试用独立
// 构造的 MeshPhysicalMaterial 做替身，materials.js 本体（运行时 canvas 贴图）不进 node。

test('喷漆·色板数据完整性：8~10 项、id 唯一、hex 合法、名称齐备', () => {
  assert.ok(PAINT_PRESETS.length >= 8 && PAINT_PRESETS.length <= 10,
    `色板项数 ${PAINT_PRESETS.length}（要求 8~10）`);
  const ids = PAINT_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id 重复');
  for (const p of PAINT_PRESETS) {
    assert.match(p.hex, /^#[0-9a-f]{6}$/, `${p.id} hex 非法: ${p.hex}`);
    assert.ok(typeof p.name === 'string' && p.name.length >= 2, `${p.id} 缺名称`);
  }
});

test('喷漆·默认色 = 现役赛车红（b61e2c），不改基线观感', () => {
  assert.ok(PAINT_PRESETS.some((p) => p.id === PAINT_DEFAULT), '默认 id 不在色板内');
  assert.equal(paintPreset(PAINT_DEFAULT).hex.toLowerCase(), '#b61e2c',
    '默认漆色必须等于 materials.js 的 paintRed 原色');
});

test('喷漆·应用函数：hex 写入目标材质且只动 color，非漆面材质不受影响', () => {
  const paint = new MeshPhysicalMaterial({ color: 0xb61e2c, metalness: 0.12, roughness: 0.32, clearcoat: 1.0 });
  const rubber = new MeshPhysicalMaterial({ color: 0x17181b, roughness: 0.78 });
  const carbon = new MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.25 });
  const blue = PAINT_PRESETS.find((p) => p.id !== PAINT_DEFAULT);
  assert.ok(blue, '色板除默认色外无其他项');
  applyPaintPreset(paint, blue);
  assert.equal(paint.color.getHex(), parseInt(blue.hex.slice(1), 16), `目标材质色应为 ${blue.hex}`);
  // 漆面质感参数保留（只换色，不重置清漆/金属度）
  assert.equal(paint.clearcoat, 1.0);
  assert.equal(paint.metalness, 0.12);
  assert.equal(paint.roughness, 0.32);
  // 非漆面材质分毫不动
  assert.equal(rubber.color.getHex(), 0x17181b);
  assert.equal(carbon.color.getHex(), 0xffffff);
});

test('喷漆·未知 id 回落默认色（存储被外部污染时不白屏）', () => {
  const p = paintPreset('no-such-color');
  assert.equal(p.id, PAINT_DEFAULT);
});
