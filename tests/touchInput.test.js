import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUCH_BRAKE, advanceBrakePressure } from '../src/sim/touchInput.js';

// ————— 触屏刹车踏板行程（输入整形）—————
// 报障口径：手机上"点刹车直接刹停"。触屏按钮是 0/1 信号，历史实现把 brakeTarget
// 一键打满；本模块把按住时长整形成踏板行程（渐进增压/点刹部分制动/松开回弹）。
// 边界：只整形触屏输入通道，不触碰 driving.js 的制动物理；键盘通道保持瞬时全刹
// （桌面零回归，由 smoke 桌面段守护）。

test('常量语义：增压/回弹/收油速率均为正（防手滑写反）', () => {
  assert.ok(TOUCH_BRAKE.rise > 0);
  assert.ok(TOUCH_BRAKE.fall > 0);
  assert.ok(TOUCH_BRAKE.cut > 0);
});

test('点刹 0.1s 给出部分制动（约 0.3，绝不是 1——"一点就刹死"回归锁）', () => {
  let p = 0;
  for (let i = 0; i < 6; i++) p = advanceBrakePressure(p, true, 1 / 60);
  assert.ok(p > 0.2 && p < 0.45, `0.1s 行程 = ${p.toFixed(3)}`);
});

test('按住约 0.35s 行程到满并钳制在 1', () => {
  let p = 0;
  for (let i = 0; i < 21; i++) p = advanceBrakePressure(p, true, 1 / 60);
  assert.equal(p, 1);
  // 继续按住不越界
  p = advanceBrakePressure(p, true, 1);
  assert.equal(p, 1);
});

test('松开快速回弹并钳制在 0', () => {
  let p = 1;
  for (let i = 0; i < 20; i++) p = advanceBrakePressure(p, false, 1 / 60);
  assert.equal(p, 0);
  // 继续松开不越界
  p = advanceBrakePressure(p, false, 1);
  assert.equal(p, 0);
});

test('连续性：小步长积分无跳变（|Δ| ≤ rise·dt）', () => {
  let p = 0;
  for (let i = 0; i < 600; i++) {
    const next = advanceBrakePressure(p, i % 2 === 0, 1 / 240);
    assert.ok(Math.abs(next - p) <= (TOUCH_BRAKE.rise * 1 / 240) + 1e-12, `跳变 ${p} → ${next}`);
    p = next;
  }
});

test('行程点刹-回弹-再点刹可重复（踏板行为一致）', () => {
  let p = advanceBrakePressure(0, true, 0.1);
  const tap1 = p;
  p = advanceBrakePressure(p, false, 0.1);
  const rel = p;
  p = advanceBrakePressure(p, true, 0.1);
  assert.ok(Math.abs(p - tap1) < 1e-12, `再点刹 ${p.toFixed(4)} vs 首点 ${tap1.toFixed(4)}`);
  assert.ok(rel < tap1, '回弹必须低于点刹保持量');
});
