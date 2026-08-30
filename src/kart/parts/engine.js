import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { M } from '../materials.js';
import { mesh, lathe, tubeThrough, sprocketGeometry, cylBetween } from '../geometry.js';
import { registerPart, addUpdate, explodeOffset } from '../registry.js';
import { L } from '../layout.js';

// ————— 动力系统：二冲程单缸发动机（剖视）—————
// 曲轴沿 x 轴（与后轴平行），活塞沿 z 轴往复 —— 标准曲柄滑块机构。
// 气缸做透明剖视处理，可直接观察活塞-连杆-曲轴的联动。

export const CRANK = { x: L.engine.x, y: L.engine.y, z: L.engine.z };
export const CRANK_R = L.crankR;
export const ROD_LEN = L.rodLen;
export const CHAIN_X = L.chainX;
export const CLUTCH_R = L.clutchR;

// 活塞位移：s(θ) = R·sinθ + √(L² − R²·cos²θ)，θ=π/2 时到达上止点
export function pistonStroke(theta) {
  return CRANK_R * Math.sin(theta) + Math.sqrt(ROD_LEN * ROD_LEN - CRANK_R * CRANK_R * Math.cos(theta) ** 2);
}

const refs = {};
const _pin = new THREE.Vector3();
const _pistonPin = new THREE.Vector3();
const _off = new THREE.Vector3();

export function buildEngine(root, asm) {
  const { x, y, z } = CRANK;

  // —— 曲轴箱 + 缸筒散热片 ——
  const block = new THREE.Group();
  const crankcase = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.155, 0.16, 4, 0.02), M.castAlu);
  crankcase.position.set(x, y, z);
  block.add(crankcase);
  const endCap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.018, 24), M.castAlu);
  endCap.rotation.z = Math.PI / 2;
  endCap.position.set(x - 0.092, y, z);
  block.add(endCap);
  // 缸筒基座（曲轴箱顶面 → 缸套下端）
  const jugBase = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.115, 0.05), M.castAlu);
  jugBase.position.set(x, y, z + 0.075);
  block.add(jugBase);
  // 散热片（只包住缸筒下半段，上半段保持透明剖视可见活塞）
  const finGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.0028, 24, 1, true);
  for (let i = 0; i < 5; i++) {
    const fin = new THREE.Mesh(finGeo, M.castAlu);
    fin.rotation.x = Math.PI / 2;
    fin.position.set(x, y, z + 0.085 + i * 0.012);
    block.add(fin);
  }
  // 四根缸盖贯穿螺栓
  for (const [bx, bz] of [[-0.062, -0.055], [0.062, -0.055], [-0.062, 0.055], [0.062, 0.055]]) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.19, 8), M.steel);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(x + bx, y + bz, z + 0.175);
    block.add(bolt);
  }
  // 发动机安装板（连接车架吊装点）
  const mountPlate = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.012, 0.17), M.steel);
  mountPlate.position.set(x + 0.03, y - 0.052, z - 0.02);
  block.add(mountPlate);
  asm.add(block);
  registerPart(block, {
    id: 'engine-block', name: '缸体与曲轴箱', system: 'engine', explodeDir: [0.7, 0.7, 0], explodeDist: 0.65,
    specs: [['形式', '二冲程 · 风冷单缸'], ['排量', '125cc'], ['散热', '缸筒散热片']],
    desc: '发动机本体：下部是曲轴箱（内含曲轴，其箱体容积还兼作扫气泵），上部环形薄片是散热片——风冷二冲程靠它把缸壁热量散给迎面气流。发动机通过安装板刚性吊在车架右侧，是卡丁车后部的重要受力构件。',
  });

  // —— 透明缸套（剖视）——
  const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.16, 28, 1, true), M.linerGlass);
  liner.rotation.x = Math.PI / 2;
  liner.position.set(x, y, z + 0.145);
  asm.add(liner);
  registerPart(liner, {
    id: 'cylinder', name: '气缸（透明剖视）', system: 'engine', explodeDir: [0.7, 0.8, 0.2], explodeDist: 0.8,
    specs: [['缸径 × 行程', 'Ø54 × 54.5mm'], ['特殊', '剖视可见活塞']],
    desc: '这里用透明缸套做剖视，可以直接看到活塞往复。二冲程发动机没有气门凸轮机构：活塞下行时先打开缸壁上的排气口、再打开扫气口，曲轴箱里预压缩的新鲜混合气涌进气缸完成换气——曲轴每转一圈就做功一次，这是它升功率高、嗓音尖锐的原因。',
  });

  // —— 活塞 ——
  const piston = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.05, 24), M.alu);
  crown.rotation.x = Math.PI / 2;
  piston.add(crown);
  for (const dz of [0.017, 0.010]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.0022, 8, 28), M.chainSteel);
    ring.position.z = dz;
    piston.add(ring);
  }
  const wristPin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 12), M.chrome);
  wristPin.rotation.z = Math.PI / 2;
  piston.add(wristPin);
  const PISTON_BASE = z + pistonStroke(0); // 下止点位置为基准
  piston.position.set(x, y, PISTON_BASE);
  asm.add(piston);
  refs.piston = piston;
  registerPart(piston, {
    id: 'piston', name: '活塞', system: 'engine', explodeDir: [0.7, 1, 0.3], explodeDist: 1.0,
    specs: [['运动', '直线往复'], ['密封', '两道活塞环']],
    desc: '燃烧压力推动活塞沿气缸做直线运动。活塞位移由曲轴转角唯一决定：s = R·sinθ + √(L² − R²cos²θ)，这正是"曲柄滑块机构"的标准解。侧向分力由缸壁承担，所以活塞裙部做得较长。',
  });

  // —— 连杆 ——
  const rod = new THREE.Group();
  const rodBody = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1, 12), M.steel);
  rodBody.rotation.x = Math.PI / 2;
  rodBody.position.z = 0.5;
  rod.add(rodBody);
  const bigEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.026, 16), M.steel);
  bigEnd.rotation.z = Math.PI / 2;
  rod.add(bigEnd);
  const smallEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.024, 14), M.steel);
  smallEnd.rotation.z = Math.PI / 2;
  smallEnd.position.z = 1;
  rod.add(smallEnd);
  rod.scale.z = ROD_LEN;
  asm.add(rod);
  refs.rod = rod;
  registerPart(rod, {
    id: 'conrod', name: '连杆', system: 'engine', explodeDir: [0.7, 1, 0], explodeDist: 0.9,
    specs: [['中心距', '105mm'], ['大头', '整体式滚针轴承']],
    desc: '连接活塞销与曲柄销的传力杆。仔细观察它的运动：两端各走一段圆弧，杆身本身做平面复合运动——这种"一边摆一边平移"的姿态正是四连杆机构的魅力。二冲程连杆大头常用整体式滚针轴承，没有分开式连杆盖。',
  });

  // —— 曲轴总成 ——
  const crank = new THREE.Group();
  crank.position.set(x, y, z);
  const journalGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.055, 14);
  for (const dx of [-0.058, 0.058]) {
    const j = new THREE.Mesh(journalGeo, M.chrome);
    j.rotation.z = Math.PI / 2;
    j.position.x = dx;
    crank.add(j);
  }
  const webGeo = new THREE.CylinderGeometry(0.049, 0.049, 0.015, 26);
  for (const dx of [-0.021, 0.021]) {
    const web = new THREE.Mesh(webGeo, M.castAlu);
    web.rotation.z = Math.PI / 2;
    web.position.x = dx;
    crank.add(web);
  }
  // 配重（曲柄销对侧的半圆加厚）
  const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.019, 26, 1, false, Math.PI, Math.PI), M.steel);
  cw.rotation.z = -Math.PI / 2;
  cw.position.x = -0.021;
  crank.add(cw);
  // 曲柄销
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12), M.chrome);
  pin.rotation.z = Math.PI / 2;
  pin.position.set(0, CRANK_R, 0);
  crank.add(pin);
  // 功率输出端（伸向离合器链轮）
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 12), M.chrome);
  stub.rotation.z = Math.PI / 2;
  stub.position.x = 0.085;
  crank.add(stub);
  asm.add(crank);
  refs.crank = crank;
  registerPart(crank, {
    id: 'crankshaft', name: '曲轴', system: 'engine', explodeDir: [0.7, 0.8, -0.3], explodeDist: 0.75,
    specs: [['最高转速', '14000+ rpm'], ['支撑', '两端滚珠轴承']],
    desc: '发动机的输出轴。两片曲柄夹着偏心的曲柄销，销随主轴公转，通过连杆带动活塞往复；对侧的扇形配重抵消往复惯性力。注意曲轴轴线与后轴平行——动力沿轴向经链轮传向后轴，这是卡丁车传动布置的基础。',
  });

  // —— 飞轮（兼磁电机转子）——
  const flywheel = new THREE.Group();
  flywheel.position.set(x - 0.125, y, z);
  const fwDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.024, 32), M.steel);
  fwDisc.rotation.z = Math.PI / 2;
  flywheel.add(fwDisc);
  const fwRim = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 8, 32), M.castAlu);
  fwRim.rotation.y = Math.PI / 2;
  flywheel.add(fwRim);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.014, 0.012), M.plastic);
    slot.position.set(0, Math.cos(a) * 0.048, Math.sin(a) * 0.048);
    slot.rotation.x = -a;
    flywheel.add(slot);
  }
  asm.add(flywheel);
  refs.flywheel = flywheel;
  registerPart(flywheel, {
    id: 'flywheel', name: '飞轮（磁电机）', system: 'engine', explodeDir: [-0.5, 0.8, 0], explodeDist: 0.7,
    specs: [['功能', '储能 + 点火供电'], ['位置', '曲轴左端']],
    desc: '曲轴另一端的大惯量圆盘。单缸机每转只做功一次，飞轮靠转动惯量把"间歇爆发"抹成"连续旋转"。外缘嵌有磁钢，旋转时对定子线圈供电——它同时是点火系统的发电机。',
  });

  // —— 离心离合器 + 曲轴链轮 ——
  const clutch = new THREE.Group();
  clutch.position.set(CHAIN_X, y, z - 0.11);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.042, 22, 1, true), M.alu);
  bell.rotation.z = Math.PI / 2;
  bell.position.x = -0.034;
  clutch.add(bell);
  const bellBack = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.024, 0.012, 22), M.alu);
  bellBack.rotation.z = Math.PI / 2;
  bellBack.position.x = -0.056;
  clutch.add(bellBack);
  const spr = new THREE.Mesh(sprocketGeometry({ teeth: 12, pitchR: CLUTCH_R, thickness: 0.008, holeR: 0.007 }), M.zinc);
  spr.rotation.y = -Math.PI / 2;
  clutch.add(spr);
  asm.add(clutch);
  refs.clutch = clutch;
  registerPart(clutch, {
    id: 'clutch', name: '离心离合器 + 曲轴链轮', system: 'engine', explodeDir: [0.8, 0.6, -0.4], explodeDist: 0.7,
    specs: [['接合转速', '约 4000 rpm'], ['齿数', '12T']],
    desc: '卡丁车没有离合踏板！蹄块式离心离合器装在曲轴端：转速低时蹄块被弹簧拉住空转，转速升高后蹄块被甩开压住离合器壳——超过约 4000 rpm 自动接合起步。"起步 = 给油"，这就是卡丁车的驾驶方式。',
  });

  // —— 化油器（节气门可见）——
  const carb = new THREE.Group();
  carb.position.set(x, y + 0.015, z - 0.135);
  carb.rotation.x = -0.22;
  const venturi = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.085, 20, 1, true), M.alu);
  venturi.rotation.x = Math.PI / 2;
  carb.add(venturi);
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.031, 0.035, 20, 1, true), M.chrome);
  stack.rotation.x = Math.PI / 2;
  stack.position.z = -0.058;
  carb.add(stack);
  const butterfly = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.0016, 20), M.chainSteel);
  butterfly.rotation.x = Math.PI / 2;
  butterfly.position.z = 0.014;
  carb.add(butterfly);
  const bShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.07, 8), M.steel);
  bShaft.rotation.z = Math.PI / 2;
  bShaft.position.z = 0.014;
  carb.add(bShaft);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.04, 14), M.alu);
  bowl.position.y = -0.05;
  carb.add(bowl);
  asm.add(carb);
  refs.butterfly = butterfly;
  registerPart(carb, {
    id: 'carburetor', name: '化油器', system: 'engine', explodeDir: [-0.2, 0.5, -1], explodeDist: 0.8,
    specs: [['形式', '膜片式 · 节气门可动'], ['控制', '油门拉线']],
    desc: '化油器利用气流经过文氏管时的负压把燃油吸出雾化。油门拉线控制的不是"油量"而是节气门（尾端可见的圆片）：开度越大 → 进气越多 → 吸出的油也越多 → 转速越高。盯着它能看到圆片随油门转动。',
  });

  // —— 排气膨胀室（在侧箱上方、后轮内侧走管）——
  const exhaust = new THREE.Group();
  const chamberY = 0.345;
  exhaust.add(tubeThrough(
    [[x + 0.075, y + 0.005, z + 0.16], [x + 0.115, y + 0.15, z + 0.11], [x + 0.10, chamberY, -0.10]],
    0.024, { tubular: 32, radial: 12, mat: M.chrome }
  ));
  const chamberProfile = [
    [0.026, 0], [0.03, 0.05], [0.046, 0.13], [0.06, 0.21], [0.062, 0.26],
    [0.05, 0.33], [0.03, 0.40], [0.021, 0.45], [0.020, 0.48],
  ];
  const chamberGeo = lathe(chamberProfile, 28);
  chamberGeo.rotateX(Math.PI / 2);
  const chamber = new THREE.Mesh(chamberGeo, M.steel);
  const dir = new THREE.Vector3(-0.03, 0.005, -0.48).normalize();
  chamber.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  chamber.position.set(x + 0.10, chamberY, -0.10);
  exhaust.add(chamber);
  const silencer = new THREE.Group();
  silencer.position.set(x + 0.065, chamberY - 0.015, -0.70);
  const silBody = new THREE.Mesh(new RoundedBoxGeometry(0.062, 0.062, 0.17, 3, 0.026), M.alu);
  silBody.rotation.x = -0.05;
  silencer.add(silBody);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 14), M.plastic);
  tip.rotation.x = Math.PI / 2;
  tip.position.z = -0.088;
  silencer.add(tip);
  exhaust.add(silencer);
  exhaust.add(cylBetween(new THREE.Vector3(x + 0.08, 0.28, -0.40), new THREE.Vector3(0.31, 0.115, -0.44), 0.007, M.steel));
  asm.add(exhaust);
  registerPart(exhaust, {
    id: 'exhaust', name: '排气膨胀室', system: 'engine', explodeDir: [1, 0.5, -0.4], explodeDist: 0.8,
    specs: [['形式', '锥形谐调膨胀室'], ['作用', '压力波泵气']],
    desc: '二冲程的排气管绝不是简单的消音管，它是一件精密乐器：扩张段让排气压力波膨胀，收敛段把反射回来的压力波在排气口关闭前推回气缸——相当于用声波给气缸"扫气充气"。二冲程的高升功率，一半功劳在它。',
  });

  // ————— 每帧机构更新 —————
  addUpdate((dt, s) => {
    const th = s.crankAngle;

    // 曲轴系旋转（explode 模块负责平移，这里只管自转）
    refs.crank.rotation.x = th;
    refs.flywheel.rotation.x = th;
    refs.clutch.rotation.x = th;

    // 活塞（曲柄滑块解）
    const stroke = pistonStroke(th);
    explodeOffset(refs.piston, _off);
    refs.piston.position.set(x + _off.x, y + _off.y, PISTON_BASE + _off.z + stroke - pistonStroke(0));

    // 连杆：曲柄销 → 活塞销（始终位于 y-z 平面内）
    _pin.set(x, y + CRANK_R * Math.cos(th), z + CRANK_R * Math.sin(th));
    _pistonPin.set(x, y, z + stroke);
    explodeOffset(refs.rod, _off);
    refs.rod.position.set(
      (_pin.x + _pistonPin.x) / 2 + _off.x,
      (_pin.y + _pistonPin.y) / 2 + _off.y,
      (_pin.z + _pistonPin.z) / 2 + _off.z
    );
    refs.rod.rotation.x = Math.atan2(_pin.y - _pistonPin.y, _pistonPin.z - _pin.z);

    // 节气门随油门开度旋转（0 关闭 → 约 77° 全开）
    refs.butterfly.rotation.x = Math.PI / 2 + s.throttle * 1.35;

    // 发动机总成微振（怠速颗粒感）
    const vib = s.engineOn ? 0.0006 + s.throttle * 0.0012 : 0;
    asm.position.set(
      Math.sin(s.crankAngle * 2) * vib,
      Math.sin(s.crankAngle * 4 + 1.3) * vib * 0.6,
      0
    );
  });
}
