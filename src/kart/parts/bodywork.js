import * as THREE from 'three';
import { M } from '../materials.js';
import { tubeThrough, roundedRectShape, taperByAxis, cylBetween } from '../geometry.js';
import { numberPlate } from '../../core/textures.js';

// ————— 车身覆盖件：整流罩 / 号码牌 / 侧箱 / 前后保险杠 —————

export function buildBodywork(root, reg) {
  // —— 车头整流罩（向车头收窄的流线罩）——
  const nose = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0.36, 0.07);
  shape.lineTo(0.66, 0.078);
  shape.quadraticCurveTo(0.78, 0.085, 0.80, 0.16);
  shape.quadraticCurveTo(0.78, 0.225, 0.66, 0.225);
  shape.lineTo(0.36, 0.225);
  shape.quadraticCurveTo(0.335, 0.15, 0.36, 0.07);
  const noseGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.026,
    bevelSize: 0.026,
    bevelSegments: 3,
    curveSegments: 12,
  });
  noseGeo.translate(0, 0, -0.17);
  taperByAxis(noseGeo, 'x', 'z', 1.0, 0.45); // 沿长度（车头方向）收窄宽度
  const shell = new THREE.Mesh(noseGeo, M.paintRed);
  shell.rotation.y = -Math.PI / 2;
  nose.add(shell);
  // 两侧号码牌（贴合收窄后的侧面）
  const plateGeo = new THREE.CircleGeometry(0.06, 28);
  const plateTex = numberPlate('88');
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.35, metalness: 0.05 }));
    plate.rotation.y = (side * Math.PI) / 2;
    plate.position.set(side * 0.168, 0.148, 0.50);
    nose.add(plate);
  }
  root.add(nose);
  reg.registerPart(nose, {
    id: 'nose', name: '车头整流罩', system: 'chassis', explodeDir: [0, 0.15, 1], explodeDist: 0.85,
    specs: [['材质', 'ABS / 玻纤增强塑料'], ['固定', '快拆扎带']],
    desc: '车头的流线型导流罩，把迎面气流导向驾驶员两侧，降低风阻，并在碰撞中保护腿部与前保险杠之后的结构。比赛规则对整流罩尺寸有严格限制，它必须能在碰撞中脱落以吸收能量。',
  });

  // —— 前保险杠（环抱车头）——
  const bumperF = new THREE.Group();
  const hoopGeo = new THREE.TorusGeometry(0.20, 0.021, 12, 32, Math.PI);
  hoopGeo.rotateX(Math.PI / 2); // 几何级旋转：半环平放、弧顶朝车头
  const arc = new THREE.Mesh(hoopGeo, M.plastic);
  arc.position.set(0, 0.115, 0.76);
  bumperF.add(arc);
  // 与车架相连的侧臂
  bumperF.add(
    cylBetween(new THREE.Vector3(-0.20, 0.115, 0.76), new THREE.Vector3(-0.29, 0.10, 0.60), 0.012, M.plastic),
    cylBetween(new THREE.Vector3(0.20, 0.115, 0.76), new THREE.Vector3(0.29, 0.10, 0.60), 0.012, M.plastic)
  );
  root.add(bumperF);
  reg.registerPart(bumperF, {
    id: 'bumper-front', name: '前保险杠', system: 'chassis', explodeDir: [0, 0, 1], explodeDist: 0.7,
    specs: [['材质', 'HDPE 塑料'], ['功能', '碰撞缓冲']],
    desc: '车头最前方的塑料护杠。卡丁车是可以近距离肉搏的赛车，前杠就是第一道防线：它吸收碰撞能量、保护车架和驾驶员双脚。规则要求它在受到撞击时能整体后移卸力。',
  });

  // —— 后保险杠 ——
  const bumperR = new THREE.Group();
  const bar = tubeThrough(
    [[-0.44, 0.13, -0.66], [0, 0.145, -0.685], [0.44, 0.13, -0.66]],
    0.022, { tubular: 32, radial: 12, mat: M.plastic }
  );
  bumperR.add(bar);
  bumperR.add(
    cylBetween(new THREE.Vector3(-0.44, 0.13, -0.66), new THREE.Vector3(-0.315, 0.11, -0.53), 0.013, M.plastic),
    cylBetween(new THREE.Vector3(0.44, 0.13, -0.66), new THREE.Vector3(0.315, 0.11, -0.53), 0.013, M.plastic)
  );
  root.add(bumperR);
  reg.registerPart(bumperR, {
    id: 'bumper-rear', name: '后保险杠', system: 'chassis', explodeDir: [0, 0.2, -1], explodeDist: 0.7,
    specs: [['材质', 'HDPE 塑料'], ['功能', '防止钻撞后轮']],
    desc: '车尾的全宽护杠，最重要的作用是防止后车"钻撞"——前车头钻入你的后轮会直接把车弹翻。后杠把追尾载荷导向车架纵梁，是安全规则重点检查的部件。',
  });

  // —— 侧箱（避开右侧发动机，位于车架外侧与后轮之间）——
  const pods = new THREE.Group();
  const podShape = roundedRectShape(0.32, 0.115, 0.045); // z-y 轮廓
  const podGeo = new THREE.ExtrudeGeometry(podShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014, bevelSegments: 3, curveSegments: 10 });
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(podGeo, M.paintRed);
    pod.rotation.y = -Math.PI / 2;
    pod.position.set(side * 0.452, 0.118, -0.20);
    pods.add(pod);
  }
  root.add(pods);
  reg.registerPart(pods, {
    id: 'sidepods', name: '侧箱', system: 'chassis', explodeDir: [1, 0.1, 0], explodeDist: 0.75,
    specs: [['材质', 'ABS / 玻纤增强塑料'], ['位置', '座椅两侧']],
    desc: '座椅两侧的塑料护板，保护驾驶员肋部不被别车的车轮碰到，同时梳理流经车身侧面的气流。侧箱由快拆扎带固定，赛后拆下即可完整看到车架侧面。',
  });
}
