import * as THREE from 'three';

// ————— 相机：视角预设 + 平滑飞行补间 —————

export const VIEWS = {
  home:    { label: '整车', pos: [2.7, 1.15, 2.75], tgt: [0, 0.28, 0] },
  front:   { label: '车头', pos: [0.85, 0.6, 3.2], tgt: [0, 0.25, 0.35] },
  engine:  { label: '动力', pos: [1.62, 0.66, -0.5], tgt: [0.42, 0.2, -0.12] },
  drive:   { label: '传动', pos: [1.75, 0.52, -0.95], tgt: [0.45, 0.16, -0.45] },
  steer:   { label: '转向', pos: [1.25, 0.95, 1.7], tgt: [0, 0.22, 0.45] },
  brake:   { label: '制动', pos: [-1.55, 0.55, -1.5], tgt: [-0.32, 0.16, -0.5] },
  cockpit: { label: '座舱', pos: [0.9, 1.0, 0.62], tgt: [0, 0.34, 0.0] },
  top:     { label: '俯视', pos: [0.02, 3.4, 0.03], tgt: [0, 0, 0] },
};

export function initCameraRig(camera, controls) {
  let tween = null;

  function flyTo(pos, tgt, dur = 0.9) {
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
