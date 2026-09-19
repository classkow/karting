import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshPhysicalMaterial } from 'three';
import {
  TIRE_COMPOUNDS, TIRE_DEFAULT, tireCompound, applyTireCompound,
} from '../src/kart/tireCompounds.js';

// ————— 变更 #44 任务二：F1 制式五配方轮胎（纯数据 + 依赖注入式应用函数）—————
// 真实链路：四条胎的环带材质 = 共享单例 M.tireBand（改一处 4 轮 8 侧同步）；本测试
// 注入 4 个替身材质，验证应用函数对"传入的每一条环带材质"同步写色、且不动橡胶本体。

test('轮胎·五配方数据完整性：软中硬半雨全雨、id 唯一、hex 合法、中文名齐', () => {
  assert.equal(TIRE_COMPOUNDS.length, 5, `配方数 ${TIRE_COMPOUNDS.length}`);
  const ids = TIRE_COMPOUNDS.map((c) => c.id);
  assert.deepEqual([...ids].sort(), ['hard', 'intermediate', 'medium', 'soft', 'wet'],
    `配方 id 集合 ${ids}`);
  const names = TIRE_COMPOUNDS.map((c) => c.name);
  assert.deepEqual([...names].sort(), ['全雨胎', '半雨胎', '中性胎', '硬胎', '软胎'].sort(),
    `中文名 ${names}`);
  for (const c of TIRE_COMPOUNDS) {
    assert.match(c.hex, /^#[0-9a-f]{6}$/, `${c.id} hex 非法: ${c.hex}`);
  }
  // F1 标准色语义：软=红、中=黄、硬=白、半雨=绿、全雨=蓝（色相判据，不锁死具体色值）
  const hueOf = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
    if (mx === mn) return -1; // 消色差（硬胎白走这条）
    const h = mx === r ? ((g - b) / (mx - mn) + (g < b ? 6 : 0))
      : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
    return h * 60;
  };
  const by = Object.fromEntries(TIRE_COMPOUNDS.map((c) => [c.id, c]));
  const hueSoft = hueOf(by.soft.hex); const hueMed = hueOf(by.medium.hex);
  const hueInter = hueOf(by.intermediate.hex); const hueWet = hueOf(by.wet.hex);
  assert.ok(hueSoft < 30 || hueSoft > 330, `软胎应为红系（hue=${hueSoft.toFixed(0)}）`);
  assert.ok(hueMed > 35 && hueMed < 75, `中性胎应为黄系（hue=${hueMed.toFixed(0)}）`);
  assert.ok(hueInter > 80 && hueInter < 170, `半雨胎应为绿系（hue=${hueInter.toFixed(0)}）`);
  assert.ok(hueWet > 190 && hueWet < 260, `全雨胎应为蓝系（hue=${hueWet.toFixed(0)}）`);
  const hard = by.hard.hex.slice(1).match(/../g).map((x) => parseInt(x, 16));
  assert.ok(hard.every((v) => v >= 220), `硬胎应为白系（${by.hard.hex}）`);
});

test('轮胎·默认配方 = 中性胎（黄），避免与默认红车身撞色', () => {
  assert.equal(TIRE_DEFAULT, 'medium');
  assert.equal(tireCompound(TIRE_DEFAULT).id, 'medium');
});

test('轮胎·应用函数：前后轮 4 组环带材质同步换色，橡胶/轮辋材质不动', () => {
  const bands = ['wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr']
    .map(() => new MeshPhysicalMaterial({ color: 0x17181b, roughness: 0.55 }));
  const rubber = new MeshPhysicalMaterial({ color: 0x17181b, roughness: 0.78 });
  const rim = new MeshPhysicalMaterial({ color: 0x878e98, metalness: 0.92 });
  const wet = tireCompound('wet');
  applyTireCompound(bands, wet);
  const want = parseInt(wet.hex.slice(1), 16);
  for (const [i, b] of bands.entries()) {
    assert.equal(b.color.getHex(), want, `第 ${i + 1} 条环带未同步（${b.color.getHexString()}）`);
  }
  assert.equal(rubber.color.getHex(), 0x17181b, '橡胶被误改');
  assert.equal(rim.color.getHex(), 0x878e98, '轮辋被误改');
});

test('轮胎·未知 id 回落默认配方（存储被外部污染时不白屏）', () => {
  assert.equal(tireCompound('no-such-compound').id, TIRE_DEFAULT);
});
