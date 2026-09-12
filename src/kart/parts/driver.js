import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M } from '../materials.js';

// ————— 坐姿车手（赛道模式专用；展台保持裸车）—————
// 程序化低模人形，姿态按真实卡丁车口径：直立桶椅内臀部深坐、双臂前伸握住方向盘
// 外缘（方向盘 steering.js @(0,0.50,0.30) 倾角 −0.30）、双腿前伸脚踩踏板
// （cockpit.js 油门 +0.13 / 刹车 −0.13 @z≈0.46）、戴头盔无遮挡。所有坐标为簧载组
// 车体系（y=0 地面），与座椅（L.seatZ 桶形壳体 + 织物软垫）实测对位，落座贴合。
//
// 不进 registry：车手不是机构部件（不参与爆炸/拾取/举升解算，smoke 锁展台几何），
// 也不注册机构动画——静态坐姿 + 头部惯性微动（updateDriverHead，量级克制）。
// 赛车服用 M.paintRed：AI 克隆（aiKarts.js 只换 paintRed 引用）自动换上本队涂装，
// 头盔全队亮白便于识别。每名车手 4 个 draw call（服/靴/盔/面罩，同材质合并几何）。
// 展台默认 visible=false（buildKart 装配即隐藏），进赛道由 app.js 点亮；
// AI 克隆发生在赛道态（可见态克隆），车手随 clone(true) 自然带上。

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 变换后几何件（合并用）：盒/球/圆柱 → 位移 + 旋转落到车体系。
// 统一转非索引：RoundedBoxGeometry 内部 toNonIndexed（非索引），Sphere/Cylinder
// 是索引几何——mergeGeometries 要求索引性一致，混排返回 null（渲染期才炸）。
function boxAt(w, h, d, x, y, z, rx = 0, seg = 2, r = 0.02) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2.05));
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}
function sphereAt(r, x, y, z, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 10, 8).toNonIndexed();
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}
function cylBetweenGeo(a, b, r, radial = 9) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, radial).toNonIndexed();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()
  );
  g.applyQuaternion(q);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildDriver(root) {
  const driver = new THREE.Group();
  driver.name = 'driver';

  // —— 关节布局（车体系，米）——
  // 上肢：肩(±0.155,0.62,−0.35) → 肘(±0.17,0.555,−0.03) → 腕(±0.115,0.53,0.29)
  // 全臂长 ≈0.64，几乎打直 = 双臂前伸握 3-9 点位方向盘外缘（真实卡丁车姿态）
  // 下肢：髋(±0.095,0.28,−0.24) → 膝(±0.155,0.33,0.10) → 踝(±0.135,0.165,0.40)
  // 大腿 ≈0.36 / 小腿 ≈0.40，膝部抬起 = 座椅直立、腿前伸踩踏板
  const shL = V(-0.155, 0.62, -0.35);
  const shR = V(0.155, 0.62, -0.35);
  const elL = V(-0.17, 0.555, -0.03);
  const elR = V(0.17, 0.555, -0.03);
  const wrL = V(-0.115, 0.53, 0.29);
  const wrR = V(0.115, 0.53, 0.29);
  const hpL = V(-0.095, 0.28, -0.24);
  const hpR = V(0.095, 0.28, -0.24);
  const knL = V(-0.155, 0.33, 0.10);
  const knR = V(0.155, 0.33, 0.10);
  const anL = V(-0.135, 0.165, 0.40);
  const anR = V(0.135, 0.165, 0.40);

  // —— 赛车服（M.paintRed：AI 克隆自动换涂装）——
  const suit = [
    // 骨盆深坐桶椅 + 躯干后仰贴靠背（胸腹不贴椅，肩背承力 = 直立座椅姿态）
    boxAt(0.30, 0.17, 0.21, 0, 0.285, -0.27, 0, 2, 0.05),
    boxAt(0.32, 0.45, 0.20, 0, 0.47, -0.345, -0.16, 3, 0.06),
    cylBetweenGeo(V(0, 0.655, -0.37), V(0, 0.72, -0.385), 0.042), // 颈
    sphereAt(0.05, shL.x, shL.y, shL.z), sphereAt(0.05, shR.x, shR.y, shR.z),
    cylBetweenGeo(shL, elL, 0.042), cylBetweenGeo(shR, elR, 0.042),
    sphereAt(0.046, elL.x, elL.y, elL.z), sphereAt(0.046, elR.x, elR.y, elR.z),
    cylBetweenGeo(elL, wrL, 0.036), cylBetweenGeo(elR, wrR, 0.036),
    sphereAt(0.047, wrL.x, wrL.y, wrL.z), sphereAt(0.047, wrR.x, wrR.y, wrR.z), // 握轮手套
    sphereAt(0.06, hpL.x, hpL.y, hpL.z), sphereAt(0.06, hpR.x, hpR.y, hpR.z),
    cylBetweenGeo(hpL, knL, 0.055), cylBetweenGeo(hpR, knR, 0.055),
    sphereAt(0.058, knL.x, knL.y, knL.z), sphereAt(0.058, knR.x, knR.y, knR.z),
    cylBetweenGeo(knL, anL, 0.042), cylBetweenGeo(knR, anR, 0.042),
  ];
  const suitMesh = new THREE.Mesh(mergeGeometries(suit, false), M.paintRed);
  for (const g of suit) g.dispose();
  suitMesh.name = 'driver-suit';
  driver.add(suitMesh);

  // —— 赛车靴（深色织物，落在油门/刹车踏板位，藏于车头罩内符合真车布局）——
  const boots = [
    boxAt(0.10, 0.075, 0.24, anL.x, 0.175, 0.475, 0.12),
    boxAt(0.10, 0.075, 0.24, anR.x, 0.175, 0.475, 0.12),
  ];
  const bootsMesh = new THREE.Mesh(mergeGeometries(boots, false), M.fabric);
  for (const g of boots) g.dispose();
  bootsMesh.name = 'driver-boots';
  driver.add(bootsMesh);

  // —— 头部组（头盔 + 面罩；updateDriverHead 做惯性微动）——
  const head = new THREE.Group();
  head.name = 'driver-head';
  head.position.set(0, 0.785, -0.40);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 11), M.helmet);
  helmet.scale.set(1, 1.06, 1.12); // 盔体纵向拉长（下颌收窄）
  helmet.name = 'driver-helmet';
  const visor = new THREE.Mesh(
    boxAt(0.21, 0.055, 0.035, 0, 0.005, 0.108, 0.10, 2, 0.014),
    M.plastic
  );
  visor.name = 'driver-visor';
  head.add(helmet, visor);
  driver.add(head);

  driver.visible = false; // 展台裸车（赛道态由 app.js 点亮；AI 克隆发生在可见态）
  root.add(driver);
  return driver;
}

// 头部惯性微动（克制量级）：随车体侧倾/俯仰反向残留 ≤0.09rad，头部略滞后于车身。
// 玩家车由 app.js 驾驶位姿更新器调用，AI 车由 aiKarts.js 动画器调用（同一 helper）。
export function updateDriverHead(head, st) {
  if (!head) return;
  head.rotation.x = 0.1 - (st.pitch ?? 0) * 0.5;                       // 制动点头/加速抬头的惯性残留
  head.rotation.z = clamp((st.roll ?? 0) * 0.55, -0.09, 0.09);        // 侧倾滞后（左转左侧抬起 → 头向右残留）
}
