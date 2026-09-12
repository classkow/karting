import * as THREE from 'three';
import { buildChassis } from './parts/chassis.js';
import { buildBodywork } from './parts/bodywork.js';
import { buildWheels } from './parts/wheels.js';
import { buildEngine } from './parts/engine.js';
import { buildDrivetrain } from './parts/drivetrain.js';
import { buildSteering } from './parts/steering.js';
import { buildJacking } from './parts/jacking.js';
import { buildBrakes } from './parts/brakes.js';
import { buildCockpit } from './parts/cockpit.js';
import { buildDriver } from './parts/driver.js';

// ————— 整车装配 —————
export function buildKart(reg) {
  const root = new THREE.Group();
  root.position.y = 0.02; // 站在展示台上

  // 簧载组：整车（车架/车身/四轮/动力/传动/转向/制动/座舱）全部挂在其下。
  // 主销举升演示把解算出的车架姿态（heave/roll/pitch）整体写到它上面——
  // 四轮贴地、车架被顶起；内侧后轮离地即后轴（刚连车架）随滚转被带走。
  // 各部件的局部坐标语义不变（basePos/爆炸向量不受影响）。
  // 引用挂在 root.userData.sprung 上：赛道驾驶的位姿更新器也要写同一组（app.js）。
  const sprung = new THREE.Group();
  root.add(sprung);
  root.userData.sprung = sprung;

  buildChassis(sprung, reg);
  buildBodywork(sprung, reg);
  buildWheels(sprung, reg);

  // 发动机系统部件挂在一个总成组下，便于整体微振
  const engineAsm = new THREE.Group();
  sprung.add(engineAsm);
  buildEngine(sprung, engineAsm, reg);

  buildDrivetrain(sprung, reg); // 依赖曲轴链轮坐标
  buildSteering(sprung, reg);   // 前轮挂在转向节上，需在车轮逻辑后
  buildJacking(sprung, reg);    // 必须在 buildSteering 之后注册：读其解算角（registry 按注册序执行）
  buildBrakes(sprung, reg);
  buildCockpit(sprung, reg);
  // 车手：不进 registry（非机构部件，不参与爆炸/拾取/举升），默认隐藏 = 展台裸车；
  // 赛道模式由 app.js 点亮，AI 克隆在赛道态发生、车手随 clone(true) 自带。
  buildDriver(sprung);

  root.traverse((o) => {
    // userData.noShadow 标记的网格不投影（气体云等体积视觉效果，§七.3）
    if (o.isMesh && !o.userData.noShadow) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  // 记录每个部件的装配位（爆炸基准；动态件的 mechPos 由更新器每帧覆盖）
  for (const p of reg.allParts()) p.group.userData.basePos = p.group.position.clone();

  return root;
}
