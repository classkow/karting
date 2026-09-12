import * as THREE from 'three';

// ————— 赛道驾驶相机：追逐·远（跑跑卡丁车默认机位）/ 追逐·近 / 座舱 —————
// 与 OrbitControls 互斥：赛道模式下 controls 停更，由本模块每帧直写相机。
// 手感要点：位置弹簧平滑（快跟）、视线点前探（过弯时自然甩向弯心）、速度抬 FOV、
// 草地/路肩抖动、贴地钳制。座舱机位刚性绑定车体（含侧倾），保留路肩颠簸。

export const DRIVE_CAMS = [
  { id: 'chase-far', label: '追逐·远', dist: 6.4, height: 2.7, ahead: 7.0, fov: 55, kPos: 5.2, kLook: 9 },
  { id: 'chase-near', label: '追逐·近', dist: 3.9, height: 1.55, ahead: 5.5, fov: 62, kPos: 7.5, kLook: 11 },
  { id: 'cockpit', label: '座舱', fov: 74 },
];

const _kartPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _desired = new THREE.Vector3();
const _lookDesired = new THREE.Vector3();
const _q = new THREE.Quaternion();

export function initDriveCamera(camera) {
  let mode = 0;
  let fovNow = camera.fov;
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  let snapped = false;

  function snap() {
    snapped = false;
  }

  function update(dt, kartRoot, tel) {
    const cfg = DRIVE_CAMS[mode];
    _kartPos.copy(kartRoot.position);
    // kart 直挂 scene（无父级变换），四元数即世界姿态——不必等 matrixWorld 刷新
    _q.copy(kartRoot.quaternion);
    _fwd.set(0, 0, 1).applyQuaternion(_q);

    if (cfg.id === 'cockpit') {
      // 座舱：头部位姿刚性跟车（含举升/侧倾姿态），路肩与草地加高频微颤
      _desired.set(0, 0.615, -0.16).applyQuaternion(_q).add(_kartPos);
      _lookDesired.copy(_fwd).multiplyScalar(12).add(_desired);
      _lookDesired.y -= 1.1;
      if (!snapped) { pos.copy(_desired); look.copy(_lookDesired); snapped = true; }
      else { pos.copy(_desired); look.lerp(_lookDesired, 1 - Math.exp(-dt * 14)); }
      const jitter = (tel.onKerb * 0.012 + tel.grassShake * 0.02) * Math.min(1, tel.speed / 8);
      pos.y += (Math.random() - 0.5) * jitter;
      setFov(cfg.fov, dt);
    } else {
      _desired.copy(_kartPos).addScaledVector(_fwd, -cfg.dist).addScaledVector(_up, cfg.height);
      _lookDesired.copy(_kartPos).addScaledVector(_fwd, cfg.ahead).addScaledVector(_up, 0.45);
      if (!snapped) { pos.copy(_desired); look.copy(_lookDesired); snapped = true; }
      else {
        pos.lerp(_desired, 1 - Math.exp(-dt * cfg.kPos));
        look.lerp(_lookDesired, 1 - Math.exp(-dt * cfg.kLook));
      }
      // 草地/路肩抖动：速度越快越明显
      const shake = (tel.grassShake * 0.05 + tel.onKerb * 0.025) * Math.min(1, tel.speed / 10);
      pos.x += (Math.random() - 0.5) * shake;
      pos.y += (Math.random() - 0.5) * shake;
      pos.y = Math.max(pos.y, 0.35); // 贴地钳制
      // 速度感：FOV 随车速抬升（最多 +14°）
      setFov(cfg.fov + Math.min(14, tel.speed * 0.42), dt);
    }

    camera.position.copy(pos);
    camera.lookAt(look);
  }

  function setFov(target, dt) {
    fovNow += (target - fovNow) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - fovNow) > 0.05) {
      camera.fov = fovNow;
      camera.updateProjectionMatrix();
    }
  }

  return {
    update,
    snap,
    cycle() {
      mode = (mode + 1) % DRIVE_CAMS.length;
      snap();
      return DRIVE_CAMS[mode];
    },
    apply(id) {
      const i = DRIVE_CAMS.findIndex((c) => c.id === id);
      if (i >= 0 && i !== mode) { mode = i; snap(); }
      return DRIVE_CAMS[mode];
    },
    get mode() { return DRIVE_CAMS[mode]; },
  };
}
