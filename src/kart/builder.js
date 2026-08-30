import * as THREE from 'three';
import { buildChassis } from './parts/chassis.js';
import { buildBodywork } from './parts/bodywork.js';
import { buildWheels } from './parts/wheels.js';
import { buildEngine } from './parts/engine.js';
import { buildDrivetrain } from './parts/drivetrain.js';
import { buildSteering } from './parts/steering.js';
import { buildBrakes } from './parts/brakes.js';
import { buildCockpit } from './parts/cockpit.js';
import { allParts } from './registry.js';

// ————— 整车装配 —————
export function buildKart() {
  const root = new THREE.Group();
  root.position.y = 0.02; // 站在展示台上

  buildChassis(root);
  buildBodywork(root);
  buildWheels(root);

  // 发动机系统部件挂在一个总成组下，便于整体微振
  const engineAsm = new THREE.Group();
  root.add(engineAsm);
  buildEngine(root, engineAsm);

  buildDrivetrain(root);   // 依赖曲轴链轮坐标
  buildSteering(root);     // 前轮挂在转向节上，需在车轮逻辑后
  buildBrakes(root);
  buildCockpit(root);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  // 记录每个部件的装配位（爆炸基准）
  for (const p of allParts()) p.group.userData.basePos = p.group.position.clone();

  return root;
}
