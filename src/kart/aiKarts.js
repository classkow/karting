import * as THREE from 'three';
import { M } from './materials.js';
import { numberPlate } from '../core/textures.js';
import { updateDriverHead } from './parts/driver.js';

// ————— AI 车体：克隆玩家车 + 逐帧位姿动画 —————
// 刻意不进 registry：AI 车不参与爆炸/拾取/机构更新器（builder 的 refs 是模块级单例，
// 多次整车装配会互相覆盖）。克隆共享几何与大部分材质，仅车漆与号码牌独立。
// 机构动画（活塞/链条等）在克隆上静止——追逐视角下不可察，换来的代价是零 registry 风险。
// 车手随 clone(true) 自带（赛道态克隆时玩家车 driver 可见）：赛车服走 paintRed
// 引用替换自动换本队涂装，头盔/靴/面罩共享材质；头部微动经 driver-head 命名查找。

const _euler = new THREE.Euler();

export function buildAIVisual(playerKart, { color, number }) {
  const clone = playerKart.clone(true);
  // 车漆：换掉共享的 paintRed 的引用
  const paint = M.paintRed.clone();
  paint.color = new THREE.Color(color);
  paint.userData.aiOwned = true; // 克隆独有材质打标（移除时只释放这些，共享材质不动）
  // 号码牌：车身上的圆形贴图网格
  const plateMat = new THREE.MeshStandardMaterial({
    map: numberPlate(number), roughness: 0.35, metalness: 0.05,
  });
  plateMat.userData.aiOwned = true;
  plateMat.map.userData.aiOwned = true;
  clone.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material === M.paintRed) o.material = paint;
    else if (o.geometry?.type === 'CircleGeometry') o.material = plateMat;
  });
  return clone;
}

// 逐帧动画器：root 位姿 / 簧载姿态 / 四轮滚动 / 前轮偏转（绕自身轮心，小角近似主销偏转）/ 车手头部微动
export function createAIVisualAnimator(clone) {
  const sprung = clone.children[0]; // builder 约定：root 第一个孩子是簧载组
  const head = clone.getObjectByName('driver-head');
  const wheels = {};
  clone.traverse((o) => {
    const pid = o.userData?.partId;
    if (pid === 'wheel-fl' || pid === 'wheel-fr' || pid === 'wheel-rl' || pid === 'wheel-rr') {
      wheels[pid] = o;
      o.rotation.order = 'YXZ'; // 先偏转后滚动（外层转向、内层自旋）
    }
  });
  return {
    update(st, shell) {
      clone.position.set(st.x, 0, st.z);
      clone.rotation.y = st.yaw;
      _euler.set(-st.pitch, 0, -st.roll);
      sprung.quaternion.setFromEuler(_euler);
      sprung.position.y = st.heave ?? 0;
      // 后轮随地面速度滚（shell.wheelOmega 由 stepDriving 写入），前轮半径不同另计
      const wRear = shell?.wheelOmega ?? 0;
      if (wheels['wheel-rl']) wheels['wheel-rl'].rotation.x += wRear;
      if (wheels['wheel-rr']) wheels['wheel-rr'].rotation.x += wRear;
      const wFront = st.wheelOmegaF ?? 0;
      if (wheels['wheel-fl']) {
        wheels['wheel-fl'].rotation.x += wFront;
        wheels['wheel-fl'].rotation.y = shell?.steerAngleL ?? 0;
      }
      if (wheels['wheel-fr']) {
        wheels['wheel-fr'].rotation.x += wFront;
        wheels['wheel-fr'].rotation.y = shell?.steerAngleR ?? 0;
      }
      updateDriverHead(head, st); // 车手头部惯性微动（与玩家车同 helper 同口径）
    },
  };
}

// 从场景移除并释放克隆独有材质（几何与共享材质留给原车，绝不 dispose 共享资源）
export function disposeAIVisual(clone) {
  clone.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.userData?.aiOwned) {
          m.map?.dispose?.();
          m.dispose();
        }
      }
    }
  });
}
