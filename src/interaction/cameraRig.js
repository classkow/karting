import * as THREE from 'three';
import { VIEWS } from './views.js';

// ————— 相机：视角预设 + 平滑飞行补间 —————

export function initCameraRig(camera, controls, { onStopAutoRotate, instantFly = false } = {}) {
  let tween = null;

  function flyTo(pos, tgt, dur = 0.9) {
    // 自动环绕会与本补间争夺相机控制权：飞行前先停下（并同步外部按钮状态）
    if (controls.autoRotate) {
      controls.autoRotate = false;
      onStopAutoRotate?.();
    }
    // 动效敏感用户（prefers-reduced-motion）：直接落到目标位姿，不补间
    if (instantFly) {
      camera.position.set(...pos);
      controls.target.set(...tgt);
      return;
    }
    tween = {
      t: 0,
      dur,
      fromPos: camera.position.clone(),
      fromTgt: controls.target.clone(),
      toPos: new THREE.Vector3(...pos),
      toTgt: new THREE.Vector3(...tgt),
    };
  }

  function applyView(name, dur = 0.9) {
    const v = VIEWS[name];
    if (v) flyTo(v.pos, v.tgt, dur);
  }

  function update(dt) {
    if (!tween) return;
    tween.t += dt / tween.dur;
    const t = Math.min(tween.t, 1);
    const k = t * t * (3 - 2 * t); // smoothstep
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    controls.target.lerpVectors(tween.fromTgt, tween.toTgt, k);
    if (t >= 1) tween = null;
  }

  return { flyTo, applyView, update };
}
