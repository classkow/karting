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
// 观感口径（2026-09-13 观感升级，对照改前截图自查）：
// - 头身比：盔宽 ≈ 肩宽 0.65（旧版头盔与肩同宽 = "蛋形大头"主因）；
// - 关节球半径 ≤ 肢体半径（旧版关节球 1.2-1.4 倍于肢体 = "竹节人"）；
// - 肘弯 ~140°（旧版全直手臂 = 充气管）；
// - 色块分工：深炭色赛车服主体（全队共享）+ 主色肩带/盔顶（随涂装换色，AI 克隆
//   只换 paintRed 引用，链路原样）+ 白盔 + 深色面罩带 —— 剪影里身体部件可读。
//
// 不进 registry：车手不是机构部件（不参与爆炸/拾取/举升解算，smoke 锁展台几何），
// 也不注册机构动画——静态坐姿 + 头部惯性微动（updateDriverHead，量级克制）。
// 每名车手 4 个 draw call（服红合并 / 服深合并(含靴+手套) / 盔 / 面罩带）。
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
  // 上肢：肩(±0.175,0.60,−0.33) → 肘(±0.21,0.48,−0.02) → 腕(±0.13,0.53,0.28)
  // 肘内角 ≈141°（真实卡丁车手 120-140°：手握 3/9 点、肘外张下垂），肘点外移+下沉。
  // 下肢：髋(±0.095,0.28,−0.24) → 膝(±0.145,0.33,0.10) → 踝(±0.135,0.165,0.40)
  // 大腿 ≈0.36 / 小腿 ≈0.40，膝部抬起 = 座椅直立、腿前伸踩踏板。
  const shL = V(-0.175, 0.60, -0.33);
  const shR = V(0.175, 0.60, -0.33);
  const elL = V(-0.21, 0.48, -0.02);
  const elR = V(0.21, 0.48, -0.02);
  const wrL = V(-0.13, 0.53, 0.28);
  const wrR = V(0.13, 0.53, 0.28);
  const hpL = V(-0.095, 0.28, -0.24);
  const hpR = V(0.095, 0.28, -0.24);
  const knL = V(-0.145, 0.33, 0.10);
  const knR = V(0.145, 0.33, 0.10);
  const anL = V(-0.135, 0.165, 0.40);
  const anR = V(0.135, 0.165, 0.40);

  // —— 赛车服·主色件（M.paintRed：AI 克隆自动换涂装）——
  // 肩带（横贯双肩，压过盔底 → 剪影上"肩比盔宽"）+ 胸前主色块 + 盔顶涂装盖。
  const suit = [
    boxAt(0.37, 0.115, 0.20, 0, 0.615, -0.31, -0.14, 2, 0.035), // 肩带
    boxAt(0.20, 0.20, 0.055, 0, 0.46, -0.175, -0.14, 2, 0.02),  // 胸前色块
  ];
  const suitMesh = new THREE.Mesh(mergeGeometries(suit, false), M.paintRed);
  for (const g of suit) g.dispose();
  suitMesh.name = 'driver-suit';
  driver.add(suitMesh);

  // —— 赛车服·深色主体（全队共享深炭色；含靴与手套）——
  const dark = [
    // 骨盆深坐桶椅 + 躯干后仰贴靠背（胸腹不贴椅，肩背承力 = 直立座椅姿态）
    boxAt(0.30, 0.16, 0.22, 0, 0.285, -0.27, 0, 2, 0.045),
    boxAt(0.315, 0.40, 0.19, 0, 0.475, -0.34, -0.16, 3, 0.055),
    cylBetweenGeo(V(0, 0.65, -0.36), V(0, 0.70, -0.375), 0.038), // 颈
    sphereAt(0.052, shL.x, shL.y, shL.z), sphereAt(0.052, shR.x, shR.y, shR.z), // 肩(≤肩带宽)
    cylBetweenGeo(shL, elL, 0.036), cylBetweenGeo(shR, elR, 0.036),
    sphereAt(0.036, elL.x, elL.y, elL.z), sphereAt(0.036, elR.x, elR.y, elR.z), // 肘(=肢半径)
    cylBetweenGeo(elL, wrL, 0.032), cylBetweenGeo(elR, wrR, 0.032),
    sphereAt(0.04, wrL.x, wrL.y, wrL.z), sphereAt(0.04, wrR.x, wrR.y, wrR.z), // 手套
    sphereAt(0.05, hpL.x, hpL.y, hpL.z), sphereAt(0.05, hpR.x, hpR.y, hpR.z),
    cylBetweenGeo(hpL, knL, 0.052), cylBetweenGeo(hpR, knR, 0.052),
    sphereAt(0.045, knL.x, knL.y, knL.z), sphereAt(0.045, knR.x, knR.y, knR.z), // 膝(=肢半径)
    cylBetweenGeo(knL, anL, 0.040), cylBetweenGeo(knR, anR, 0.040),
    // 赛车靴（深色织物，落在油门/刹车踏板位，藏于车头罩内符合真车布局）
    boxAt(0.10, 0.075, 0.24, anL.x, 0.175, 0.475, 0.12),
    boxAt(0.10, 0.075, 0.24, anR.x, 0.175, 0.475, 0.12),
  ];
  const darkMesh = new THREE.Mesh(mergeGeometries(dark, false), M.fabric);
  for (const g of dark) g.dispose();
  darkMesh.name = 'driver-suit-dark';
  driver.add(darkMesh);

  // —— 头部组（头盔 + 面罩带；updateDriverHead 做惯性微动）——
  const head = new THREE.Group();
  head.name = 'driver-head';
  head.position.set(0, 0.775, -0.395);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 11), M.helmet);
  helmet.scale.set(1, 0.95, 1.08); // 盔体纵向拉长（下颌收窄），宽度收敛 → 盔宽/肩宽 ≈0.65
  helmet.name = 'driver-helmet';
  const visor = new THREE.Mesh(
    boxAt(0.19, 0.05, 0.03, 0, 0.005, 0.095, 0.10, 2, 0.012),
    M.plastic
  );
  visor.name = 'driver-visor';
  // 盔顶涂装帽（主色球冠，半径比盔体大 7‰ → 外壳分色；随 head 微动 + 换涂装）
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.112, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42).toNonIndexed(),
    M.paintRed
  );
  cap.scale.set(1, 0.95, 1.08);
  cap.name = 'driver-helmet-cap';
  head.add(helmet, visor, cap);
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
