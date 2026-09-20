import './helpers/canvasStub.js'; // aiKarts → materials.js 在模块作用域生成 canvas 纹理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAIVisualAnimator } from '../src/kart/aiKarts.js';

// ————— AI 视觉动画器的帧率无关性（评审 #3）—————
// 轮角是 ∫ω·dt 的累加，ω 的单位是 rad/s。用同一真实时长的两种分片跑同一段常量 ω，
// 轮角必须一致：把 rad/s 当 rad/帧累加时，60fps 的视觉角速度是真实值的 60 倍、15fps 是 15 倍，
// 同一场比赛在 120Hz 手机与 60Hz 桌面上轮速看起来差一倍。
// 手搓最小场景图（三个带 userData.partId 的 Object3D）而不是装配整车：
// 本项断言的是动画器的积分口径，与零件几何无关。

function rig() {
  const root = new THREE.Group();
  const sprung = new THREE.Object3D(); // animator 约定：children[0] = 簧载组
  root.add(sprung);
  const wheels = {};
  for (const id of ['wheel-rl', 'wheel-fl', 'wheel-fr']) {
    const w = new THREE.Object3D();
    w.userData.partId = id;
    root.add(w);
    wheels[id] = w;
  }
  return { wheels, anim: createAIVisualAnimator(root) };
}

test('AI 轮角对分片不敏感：1/15 与 1/60 跑同一真实时长结果一致', () => {
  // ω 锚在真实量级：55km/h ÷ 后轮半径 0.145m ≈ 38.8rad/s；前轮半径小 ⇒ 同地面速度转得更快
  const OMEGA_R = 38.79;
  const OMEGA_F = 47.0;
  const T = 1; // 真实时长 1s
  const run = (dt) => {
    const { wheels, anim } = rig();
    const st = { x: 0, z: 0, yaw: 0, pitch: 0, roll: 0, heave: 0, wheelOmegaF: OMEGA_F };
    const shell = { wheelOmega: OMEGA_R, steerAngleL: 0.2, steerAngleR: -0.2 };
    for (let i = 0; i < Math.round(T / dt); i++) anim.update(st, shell, dt);
    return wheels;
  };
  const coarse = run(1 / 15);
  const fine = run(1 / 60);
  for (const [id, omega] of [['wheel-rl', OMEGA_R], ['wheel-fl', OMEGA_F], ['wheel-fr', OMEGA_F]]) {
    const a = coarse[id].rotation.x;
    const b = fine[id].rotation.x;
    assert.ok(Math.abs(a - b) < 1e-6,
      `${id} 1s 轮角随分片变化：15 帧 ${a.toFixed(3)}rad vs 60 帧 ${b.toFixed(3)}rad（比值 ${(a / b).toFixed(2)}，应为 1）`);
    assert.ok(Math.abs(a - omega * T) < 1e-6,
      `${id} 1s 滚过 ${a.toFixed(3)}rad，∫ω·dt 应为 ${(omega * T).toFixed(3)}rad`);
  }
});

test('AI 前轮偏转直读解算角，不参与滚动积分', () => {
  const { wheels, anim } = rig();
  const st = { x: 0, z: 0, yaw: 0, pitch: 0, roll: 0, heave: 0, wheelOmegaF: 47 };
  const shell = { wheelOmega: 38.79, steerAngleL: 0.24, steerAngleR: -0.21 };
  for (let i = 0; i < 30; i++) anim.update(st, shell, 1 / 60);
  assert.ok(Math.abs(wheels['wheel-fl'].rotation.y - 0.24) < 1e-12,
    `左前轮偏转 ${wheels['wheel-fl'].rotation.y.toFixed(4)}rad ≠ 解算角 0.24rad`);
  assert.ok(Math.abs(wheels['wheel-fr'].rotation.y + 0.21) < 1e-12,
    `右前轮偏转 ${wheels['wheel-fr'].rotation.y.toFixed(4)}rad ≠ 解算角 -0.21rad`);
  assert.equal(wheels['wheel-rl'].rotation.y, 0, '后轮不受转向输入');
});
