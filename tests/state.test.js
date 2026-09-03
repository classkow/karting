// ————— 仿真状态机单元测试 —————
// 运行：npm test（node --test 显式列文件，勿改回目录模式，Windows 有坑）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, CLUTCH_ENGAGE_RPM } from '../src/sim/state.js';
import { L } from '../src/kart/layout.js';

const DT = 1 / 30;
const pump = (s, n) => { for (let i = 0; i < n; i++) s.step(DT); };

test('起动：拖转 0.9s 后自动点火进入怠速', () => {
  const s = createSim();
  s.startEngine();
  assert.equal(s.engineOn, false);
  assert.ok(s.cranking > 0, '应进入拖转');
  pump(s, 26); // 26 × 1/30 ≈ 0.87s，仍在拖转
  assert.equal(s.engineOn, false, '拖转未结束不应点火');
  assert.ok(s.rpm > 200 && s.rpm < 1000, `拖转转速应为起动机量级，实际 ${s.rpm}`);
  pump(s, 5); // 累计 ≈ 1.03s，拖转已结束
  assert.equal(s.engineOn, true, '0.9s 后应点火');
  pump(s, 20); // 从拖转转速继续向怠速爬升
  assert.ok(s.rpm > 1500, `点火后应接近怠速，实际 ${s.rpm}`);
});

test('拖转中熄火：中止起动且不再自动点火（回归 P0-1）', () => {
  const s = createSim();
  s.startEngine();
  s.step(DT * 9); // 拖转约 0.3s 时中止
  assert.ok(s.cranking > 0, '此前提：仍在拖转中');
  assert.equal(s.toggleEngine(), false, 'toggle 应走熄火分支');
  assert.equal(s.cranking, 0, '拖转倒计时必须清零');
  pump(s, 120); // 远超原拖转剩余时长
  assert.equal(s.engineOn, false, '熄火后不允许再自动点火');
  assert.equal(s.rpm, 0, 'rpm 应衰减到 0');
});

test('熄火后 rpm 衰减到 0', () => {
  const s = createSim();
  s.startEngine();
  pump(s, 40);
  assert.ok(s.rpm > 1000, '前提：引擎已运转');
  s.stopEngine();
  pump(s, 150); // 衰减率 dt*1.6，5s 足够从怠速归零
  assert.equal(s.rpm, 0);
});

test('理论车速 = 真实角速度 × 传动比 × 轮径（km/h）', () => {
  const s = createSim();
  s.startEngine();
  s.throttle = 1;
  pump(s, 120); // 4s 拉到高转
  assert.ok(s.rpm > 5000, `前提：高转速，实际 ${s.rpm}`);
  const ratio = L.clutchR / L.sprocketR;
  const expect = (s.rpm / 60) * Math.PI * 2 * ratio * L.wheelR.r * 3.6;
  assert.ok(Math.abs(s.speedKmh - expect) < 0.5, `speedKmh ${s.speedKmh} ≠ ${expect}`);
  assert.ok(s.speedKmh > 0);
});

test('低速（<200rpm）时理论车速按 0 处理', () => {
  const s = createSim();
  s.startEngine();
  s.throttle = 0;
  pump(s, 40); // 怠速 1800 仍 > 200，用熄火衰减穿过 200 来测低速段
  s.stopEngine();
  let crossed = false;
  for (let i = 0; i < 60; i++) {
    s.step(DT);
    if (s.rpm <= 200) crossed = true;
    if (crossed) assert.equal(s.speedKmh, 0, `rpm=${s.rpm} 时车速应为 0`);
  }
  assert.ok(crossed, '应穿过 200rpm 阈值');
});

test('steer / brake 平滑收敛到目标值', () => {
  const s = createSim();
  s.steer = 1;
  s.brakeTarget = 1;
  pump(s, 60);
  assert.ok(Math.abs(s.steerSmooth - 1) < 1e-6, `steerSmooth 应收敛到 1，实际 ${s.steerSmooth}`);
  assert.ok(Math.abs(s.brake - 1) < 1e-6, `brake 应收敛到 1，实际 ${s.brake}`);
  s.steer = 0;
  s.brakeTarget = 0;
  pump(s, 60);
  assert.ok(Math.abs(s.steerSmooth) < 1e-6);
  assert.ok(Math.abs(s.brake) < 1e-6);
});

test('CLUTCH_ENGAGE_RPM 与引擎说明文案一致（约 4000）', () => {
  assert.equal(CLUTCH_ENGAGE_RPM, 4000);
});
