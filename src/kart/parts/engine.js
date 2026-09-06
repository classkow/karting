import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { M } from '../materials.js';
import { lathe, tubeThrough, sprocketGeometry, cylBetween } from '../geometry.js';
import { L } from '../layout.js';
import { pistonStroke as strokeFn } from '../../sim/kinematics.js';
import * as cycle from '../../sim/cycle.js';

// ————— 动力系统：二冲程单缸发动机（剖视）—————
// 曲轴沿 x 轴（与后轴平行），活塞沿 z 轴往复 —— 标准曲柄滑块机构。
// 气缸做透明剖视处理，可直接观察活塞-连杆-曲轴的联动。

export const CRANK = { x: L.engine.x, y: L.engine.y, z: L.engine.z };
export const CRANK_R = L.crankR;
export const ROD_LEN = L.rodLen;
export const CHAIN_X = L.chainX;
export const CLUTCH_R = L.clutchR;

// 活塞位移（曲柄滑块标准解，纯数学在 sim/kinematics.js）
export function pistonStroke(theta) {
  return strokeFn(theta, CRANK_R, ROD_LEN);
}

const refs = {};
const _pin = new THREE.Vector3();
const _pistonPin = new THREE.Vector3();
const _cloudP = new THREE.Vector3();
const _cloudS = new THREE.Vector3(1, 1, 1);
const _cloudQ = new THREE.Quaternion();
const _cloudM = new THREE.Matrix4();
const _cloudC = new THREE.Color();
const cycDeg = (rad) => (rad * 180) / Math.PI;

export function buildEngine(root, asm, reg) {
  const { x, y, z } = CRANK;
  const TAU = Math.PI * 2;

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
  // 鳍片切弧（阶段3）：z=+0.097/+0.109 压扫气窗口带（−x 侧）、z=+0.121 压排气窗口带
  // （+x 侧）——压带的鳍片在窗口弧段开缺口，让出气口流道（§三.2）；z=+0.133 在
  // 排气带上缘之外、header 下移后亦不相交，保持整环。
  const finGeoFull = () => new THREE.CylinderGeometry(0.075, 0.075, 0.0028, 24, 1, true);
  const FIN_CUTS = {
    1: { center: 1.5 * Math.PI, half: 1.2 },  // 扫气带（−x）
    2: { center: 1.5 * Math.PI, half: 1.2 },  // 扫气带（−x）
    3: { center: 0.5 * Math.PI, half: 1.0 },  // 排气带（+x）
  };
  for (let i = 0; i < 5; i++) {
    const cut = FIN_CUTS[i];
    const fin = new THREE.Mesh(
      cut
        ? new THREE.CylinderGeometry(0.075, 0.075, 0.0028, 24, 1, true, cut.center + cut.half, TAU - 2 * cut.half)
        : finGeoFull(),
      M.castAlu
    );
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
  reg.registerPart(block, {
    id: 'engine-block', name: '缸体与曲轴箱', system: 'engine', explodeDir: [0.7, 0.7, 0], explodeDist: 0.65,
    specs: [['形式', '二冲程 · 风冷单缸'], ['排量', `${(cycle.V_DISP * 1e6).toFixed(1)}cc（125cc 级）`], ['散热', '缸筒散热片']],
    desc: '发动机本体：下部是曲轴箱（内含曲轴，其箱体容积还兼作扫气泵，一次压缩比 ≈1.45），上部环形薄片是散热片——风冷二冲程靠它把缸壁热量散给迎面气流。发动机通过安装板刚性吊在车架右侧，是卡丁车后部的重要受力构件。',
  });

  // —— 透明缸套（分带开窗剖视，阶段3）——
  // 四段堆叠（轴向互不重叠；窗口上缘 = 正时边，全部由 sim/cycle.js 派生）：
  //   [+0.050, +0.096]        全环（扫气带以下）
  //   [+0.096, +0.112158]     扫气窗口带（−x 侧开口）
  //   [+0.112158, +0.128850]  排气窗口带（+x 侧开口）
  //   [+0.128850, +0.220]     全环（排气带以上）
  // θ 约定（rotation.x=π/2 后）：CylinderGeometry 顶点 x=r·sinθ、z=r·cosθ →
  //   θ=0 指向父系 −y、θ=π/2 → +x（正对 header）、θ=π → +y、θ=3π/2 → −x（扫气侧）。
  // 注册对象由 Mesh 改为 Group（爆炸写 group.position 仍成立，§6.3）。
  const linerGroup = new THREE.Group();
  const LINER_R = 0.052;
  const WIN_TR = { center: 1.5 * Math.PI, half: 1.05 };  // 扫气窗（−x 侧）
  const WIN_EXH = { center: 0.5 * Math.PI, half: 0.85 }; // 排气窗（+x 侧）
  const linerBands = [
    { z0: 0.050, z1: cycle.H_TR_LO, win: null },
    { z0: cycle.H_TR_LO, z1: cycle.H_TR, win: WIN_TR },
    { z0: cycle.H_TR, z1: cycle.H_EXH, win: WIN_EXH },
    { z0: cycle.H_EXH, z1: 0.220, win: null },
  ];
  for (const b of linerBands) {
    const geo = b.win
      ? new THREE.CylinderGeometry(LINER_R, LINER_R, b.z1 - b.z0, 28, 1, true, b.win.center + b.win.half, TAU - 2 * b.win.half)
      : new THREE.CylinderGeometry(LINER_R, LINER_R, b.z1 - b.z0, 28, 1, true);
    const seg = new THREE.Mesh(geo, M.linerGlass);
    seg.rotation.x = Math.PI / 2;
    seg.position.set(x, y, z + (b.z0 + b.z1) / 2);
    linerGroup.add(seg);
  }
  // 缸盖底面圆盘（z+0.1606 = TDC 冠顶 + 余隙，sim/cycle.js 派生的固定端面）：
  // 封住气体云的视觉顶盖，也让余隙体积可见（此前 liner 顶敞口无收束）
  const headDisc = new THREE.Mesh(new THREE.CylinderGeometry(LINER_R, LINER_R, 0.005, 28), M.castAlu);
  headDisc.rotation.x = Math.PI / 2;
  headDisc.position.set(x, y, z + cycle.HEAD_DECK + 0.0025);
  linerGroup.add(headDisc);
  // 扫气 duct ×3：曲轴箱 → 扫气窗口带（−x 侧，微上倾；铸在缸体上的真实走道）
  for (const dz of [-0.0085, 0, 0.0085]) {
    linerGroup.add(cylBetween(
      new THREE.Vector3(x - 0.020, y - 0.012, z + 0.052 + dz),
      new THREE.Vector3(x - 0.0545, y - 0.004, z + 0.104 + dz),
      0.0085, M.castAlu
    ));
  }
  asm.add(linerGroup);
  reg.registerPart(linerGroup, {
    id: 'cylinder', name: '气缸（透明剖视）', system: 'engine', explodeDir: [0.7, 0.8, 0.2], explodeDist: 0.8,
    specs: [['缸径 × 行程', `Ø${(cycle.BORE * 1000).toFixed(0)} × ${(cycle.STROKE * 1000).toFixed(1)}mm`], ['气口', '活塞阀：排气 1×扫气 3']],
    desc: `透明缸套剖视，可直接看到活塞往复与缸壁上的气口。气口正时由几何反解（sim/cycle.js）：排气口 ${Math.round(cycDeg(cycle.EVO))}°ATDC 开、${Math.round(cycDeg(cycle.EVC))}°ATDC 关（持续 ${Math.round(cycle.DUR_EXH / (Math.PI / 180))}°），扫气口 ${Math.round(cycDeg(cycle.IVO))}°ATDC 开、${Math.round(cycDeg(cycle.IVC))}°ATDC 关（持续 ${Math.round(cycle.DUR_TR / (Math.PI / 180))}°），排气先开 ${Math.round(cycle.BLOWDOWN / (Math.PI / 180))}° 即"blowdown"。二冲程没有气门凸轮机构：活塞本身就是气门的开关——下行先开排气口、再开扫气口，曲轴箱里预压缩的新鲜混合气涌进气缸完成换气。口径：轴向 1:1、径向为可视性放大（缸径恒定 → 容积比 ≡ 气柱高度比，屏上压缩收缩比是真值）；几何压缩比 ${((cycle.V_C + cycle.V_DISP) / cycle.V_C).toFixed(2)}（余隙全算），trapped 压缩比 ${L.engine.CR_trapped}（自扫气口关闭位起算）。`,
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
  const PISTON_BASE = z + pistonStroke(0); // s(0)=0.1015 为行程中点（非下止点）；真实下止点 θ=3π/2
  piston.position.set(x, y, PISTON_BASE);
  piston.userData.mechPos = new THREE.Vector3(x, y, PISTON_BASE); // 动态件：机构位姿
  asm.add(piston);
  refs.piston = piston;
  reg.registerPart(piston, {
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
  rod.userData.mechPos = new THREE.Vector3(x, y + CRANK_R, z); // 动态件：机构位姿（曲柄销处）
  asm.add(rod);
  refs.rod = rod;
  reg.registerPart(rod, {
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
  reg.registerPart(crank, {
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
  reg.registerPart(flywheel, {
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
  reg.registerPart(clutch, {
    id: 'clutch', name: '离心离合器 + 曲轴链轮', system: 'engine', explodeDir: [0.8, 0.6, -0.4], explodeDist: 0.7,
    specs: [['接合转速', '约 4000 rpm'], ['齿数', '12T']],
    desc: '卡丁车没有离合踏板！蹄块式离心离合器装在曲轴端：转速低时蹄块被弹簧拉住空转，转速升高后蹄块被甩开压住离合器壳——超过约 4000 rpm 自动接合起步。"起步 = 给油"，这就是卡丁车的驾驶方式。',
  });

  // —— 化油器（节气门可见；阶段3 尾移 45mm 让出簧片阀座空间，§三.3 修订）——
  const CARB_Z_OFF = -0.180;
  const carb = new THREE.Group();
  carb.position.set(x, y + 0.015, z + CARB_Z_OFF);
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
  reg.registerPart(carb, {
    id: 'carburetor', name: '化油器', system: 'engine', explodeDir: [-0.2, 0.5, -1], explodeDist: 0.8,
    specs: [['形式', '膜片式 · 节气门可动'], ['控制', '油门拉线']],
    desc: '化油器利用气流经过文氏管时的负压把燃油吸出雾化。油门拉线控制的不是"油量"而是节气门（尾端可见的圆片）：开度越大 → 进气越多 → 吸出的油也越多 → 转速越高。盯着它能看到圆片随油门转动。它的下游经短歧管接簧片阀座再进曲轴箱。',
  });

  // —— 进气歧管（短）+ 簧片阀（阶段3 新增，§三.3/§6.4 修订口径）——
  // 化油器尾移后，其朝曲轴箱端沿倾斜轴（+0.22 上翘）经短歧管接簧片阀座，
  // 阀座贴曲轴箱后壁（z≈−0.28）。簧片瓣铰支在阀座后端面，随解算压差开度摆动。
  const reedAxis = new THREE.Vector3(0, Math.sin(0.22), Math.cos(0.22));
  const reedE0 = new THREE.Vector3(x, y + 0.015, z + CARB_Z_OFF)
    .add(new THREE.Vector3(0, Math.sin(0.22) * 0.0425, Math.cos(0.22) * 0.0425)); // venturi 朝箱端
  const manifold = cylBetween(
    reedE0.clone(),
    reedE0.clone().addScaledVector(reedAxis, 0.024),
    0.031, M.alu
  );
  asm.add(manifold);
  reg.registerPart(manifold, {
    id: 'intake-manifold', name: '进气歧管', system: 'engine', explodeDir: [-0.2, 0.6, -0.9], explodeDist: 0.85,
    specs: [['长度', '≈24mm'], ['口径', 'Ø62（视觉口径）']],
    desc: '连接化油器与簧片阀座的短歧管。真机上这段是耐油橡胶管，允许一点角度误差；视觉口径随化油器径向放大（§五.6）。',
  });
  const reedGroup = new THREE.Group();
  const reedB0 = reedE0.clone().addScaledVector(reedAxis, 0.024);
  const reedB1 = reedE0.clone().addScaledVector(reedAxis, 0.060); // 座体贴到曲轴箱后壁 z≈−0.28
  reedGroup.add(cylBetween(reedB0.clone(), reedB1.clone(), 0.028, M.castAlu));
  const reedCage = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.036, 20, 1, true), M.alu);
  reedCage.position.copy(reedB0.clone().addScaledVector(reedAxis, 0.018));
  reedCage.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), reedAxis);
  reedGroup.add(reedCage);
  // 簧片瓣 ×2：铰支在阀座后端面，开启时自由端向曲轴箱方向摆开（rotation.y 随升度）
  const petals = new THREE.Group();
  petals.position.copy(reedB0);
  petals.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), reedAxis);
  for (const py of [-0.009, 0.009]) {
    const petal = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.013, 0.0008), M.steel);
    petal.position.set(0, py, 0.009);
    petals.add(petal);
  }
  reedGroup.add(petals);
  refs.petals = petals;
  asm.add(reedGroup);
  reg.registerPart(reedGroup, {
    id: 'reed-valve', name: '簧片阀', system: 'engine', explodeDir: [-0.2, 0.7, -0.8], explodeDist: 0.85,
    specs: [['形式', 'V 型双瓣片'], ['开启', '压差自控（无凸轮）']],
    desc: '曲轴箱的进气门。两片薄钢瓣铰支在阀座上：活塞上行、曲轴箱压力低于大气时被吸开，新鲜混合气涌入；活塞下行、曲轴箱开始压缩时自动关死——单向阀，开关完全由压差决定，没有凸轮轴参与。固有频率约 700Hz，高转速下近似随压差准静态开合。',
  });

  // —— 缸内/曲轴箱充量气体云（阶段4，§6.1/§五.2）——
  // 单个 InstancedMesh ≈150 实例（与链条同待遇：picking 跳过 InstancedMesh、不投影）。
  // 材质 transparent:false + instanceColor + depthWrite（§五.2：透射目标只渲 opaque，
  // 透明粒子云会被 linerGlass 吞掉）。粒子有确定性 (u,v) 身份（LCG 种子），位置 =
  // f(u, v, 冠顶/缸盖底/曲轴箱容) —— 整团云随压缩可见地收缩变密，禁止逐帧随机重采样。
  const CLOUD_N_CYL = 90;
  const CLOUD_N_CC = 60;
  const cloudGeo = new THREE.SphereGeometry(0.0042, 6, 5);
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const cloud = new THREE.InstancedMesh(cloudGeo, cloudMat, CLOUD_N_CYL + CLOUD_N_CC);
  cloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cloud.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((CLOUD_N_CYL + CLOUD_N_CC) * 3).fill(1), 3);
  cloud.instanceColor.setUsage(THREE.DynamicDrawUsage);
  cloud.userData.noShadow = true;
  cloud.frustumCulled = false;
  let cloudSeed = 42; // LCG：确定性
  const cloudRnd = () => (cloudSeed = (cloudSeed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const cloudUV = [];
  for (let i = 0; i < CLOUD_N_CYL; i++) cloudUV.push({ region: 0, a: cloudRnd(), b: cloudRnd(), c: cloudRnd() });
  for (let i = 0; i < CLOUD_N_CC; i++) cloudUV.push({ region: 1, a: cloudRnd(), b: cloudRnd(), c: cloudRnd() });
  asm.add(cloud);
  reg.registerPart(cloud, {
    id: 'charge-gas', name: '缸内充量（可视化）', system: 'engine', explodeDir: [0.6, 0.9, 0.1], explodeDist: 0.6,
    specs: [['着色', '蓝=新鲜 · 橙=废气'], ['口径', '真实解算 · 径向为可视放大']],
    desc: '气缸与曲轴箱里的气体被做成粒子云：蓝色是新鲜混合气，橙色是高温废气。压缩时整团云被压进余隙（屏上气柱收缩比 = 几何压缩比，真值）；换气时橙蓝渐变。粒子位置是曲轴角的确定函数，与活塞、气口正时严格同相。',
  });
  refs.cloud = cloud;

  // —— 排气膨胀室（在侧箱上方、后轮内侧走管；profile/header 全部同源 layout，阶段3 下移首点）——
  const exhaust = new THREE.Group();
  const headerTube = tubeThrough(
    [
      [x + L.engine.headerRel[0][0], y + L.engine.headerRel[0][1], z + L.engine.headerRel[0][2]],
      [x + L.engine.headerRel[1][0], y + L.engine.headerRel[1][1], z + L.engine.headerRel[1][2]],
      [x + 0.10, L.engine.chamberY, L.engine.chamberZ0],
    ],
    0.024, { tubular: 32, radial: 12, mat: M.chrome }
  );
  exhaust.add(headerTube);
  const headerCurve = headerTube.geometry.parameters.path; // §2.5：TubeGeometry 自带等弧长 path
  const chamberGeo = lathe(L.engine.chamberProfile, 28);
  chamberGeo.rotateX(Math.PI / 2);
  const chamber = new THREE.Mesh(chamberGeo, M.steel);
  const dir = new THREE.Vector3(-0.03, 0.005, -0.48).normalize();
  chamber.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  chamber.position.set(x + 0.10, L.engine.chamberY, L.engine.chamberZ0);
  exhaust.add(chamber);
  const silencer = new THREE.Group();
  silencer.position.set(x + 0.065, L.engine.chamberY - 0.015, -0.70);
  const silBody = new THREE.Mesh(new RoundedBoxGeometry(0.062, 0.062, 0.17, 3, 0.026), M.alu);
  silBody.rotation.x = -0.05;
  silencer.add(silBody);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 14), M.plastic);
  tip.rotation.x = Math.PI / 2;
  tip.position.z = -0.088;
  silencer.add(tip);
  exhaust.add(silencer);
  // 36mm 连接管：膨胀室出口 → 消音器入口（阶段3 补齐，§三.3）
  const chExit = new THREE.Vector3(x + 0.10, L.engine.chamberY, L.engine.chamberZ0).addScaledVector(dir, 0.48);
  exhaust.add(cylBetween(
    chExit,
    new THREE.Vector3(x + 0.065, L.engine.chamberY - 0.015, -0.6155),
    0.020, M.steel
  ));
  // —— 压力波视觉：管外发光环（阶段5，§6.2/§5.3/§5.7）——
  // 不剖切膨胀室（lathe 无 phiLength §5.7）；环 = torus 套管，位置/取向沿 header 曲线与
  // 膨胀室轴线；颜色 ×3 过 Bloom 阈值（§5.3）、transparent:false；正压暖/负压冷（§6.2）。
  const Z_UNIT = new THREE.Vector3(0, 0, 1);
  const chamberThroat = new THREE.Vector3(x + 0.10, L.engine.chamberY, L.engine.chamberZ0);
  const WAVE_RING_N = 8;
  const waveRingGeo = new THREE.TorusGeometry(1, 0.16, 8, 28);
  const waveRingMatPos = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a4d).multiplyScalar(3) });
  const waveRingMatNeg = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4d9aff).multiplyScalar(3) });
  const waveRings = [];
  for (let i = 0; i < WAVE_RING_N; i++) {
    const ring = new THREE.Mesh(waveRingGeo, waveRingMatPos);
    ring.visible = false;
    exhaust.add(ring);
    waveRings.push(ring);
  }
  // 膨胀室轴向位置的当地半径（profile 线性插值；a 为喉口起算的轴向距离）
  const chamberRadiusAt = (a) => {
    const prof = L.engine.chamberProfile;
    for (let i = 1; i < prof.length; i++) {
      if (a <= prof[i][1]) {
        const t = (a - prof[i - 1][1]) / (prof[i][1] - prof[i - 1][1]);
        return prof[i - 1][0] + (prof[i][0] - prof[i - 1][0]) * t;
      }
    }
    return prof[prof.length - 1][0];
  };
  exhaust.add(cylBetween(new THREE.Vector3(x + 0.08, 0.28, -0.40), new THREE.Vector3(0.31, 0.115, -0.44), 0.007, M.steel));
  asm.add(exhaust);
  reg.registerPart(exhaust, {
    id: 'exhaust', name: '排气膨胀室', system: 'engine', explodeDir: [1, 0.5, -0.4], explodeDist: 0.8,
    specs: [['形式', '锥形谐调膨胀室'], ['作用', '压力波泵气'], ['调谐点', `≈${(cycle.N_TUNED / 1000).toFixed(1)}k rpm（由管长解算）`]],
    desc: `二冲程的排气管绝不是简单的消音管，它是一件精密乐器：扩张段让排气压力波膨胀产生负压回抽，收敛段把反射回来的压力波在排气口关闭前推回气缸——相当于用声波给气缸"扫气充气"。调谐转速由管长解算 ≈${(cycle.N_TUNED / 1000).toFixed(1)}k rpm（口径：回波一个往返恰等于排气持续期 ${Math.round(cycle.DUR_EXH / (Math.PI / 180))}°），功率带因此贴着红线。橙色环=正压、蓝色环=负压。二冲程的高升功率，一半功劳在它。`,
  });

  // ————— 每帧机构更新 —————
  reg.addUpdate((dt, s) => {
    const th = s.crankAngle;

    // 曲轴系旋转（explode 模块负责平移，这里只管自转）
    refs.crank.rotation.x = th;
    refs.flywheel.rotation.x = th;
    refs.clutch.rotation.x = th;

    // 活塞（曲柄滑块解）：只写机构位姿 mechPos，爆炸偏移由 explode 统一叠加
    const stroke = pistonStroke(th);
    refs.piston.userData.mechPos.set(x, y, z + stroke);

    // 连杆：杆组原点 = 曲柄销（几何从原点沿 +z 展开到杆长），旋转对准活塞销
    _pin.set(x, y + CRANK_R * Math.cos(th), z + CRANK_R * Math.sin(th));
    _pistonPin.set(x, y, z + stroke);
    refs.rod.userData.mechPos.copy(_pin);
    refs.rod.rotation.x = Math.atan2(_pin.y - _pistonPin.y, _pistonPin.z - _pin.z);

    // 节气门随油门开度旋转（0 关闭 → 约 77° 全开）
    refs.butterfly.rotation.x = Math.PI / 2 + s.throttle * 1.35;

    // 簧片瓣随解算升度摆开（sim/cycle 闭式积分状态直读，§6.4）
    refs.petals.rotation.y = s.cycle.reedX * 0.9;

    // 气体云：确定性 (u,v) → 位置/颜色，随曲轴角与充气状态变化（§6.1）
    {
      const thATDC = s.cycle.thetaATDC();
      const crown = cycle.crownTop(thATDC);
      const hCol = Math.max(cycle.HEAD_DECK - crown, 0.0009);
      const fresh = s.cycle.fresh;
      for (let i = 0; i < cloudUV.length; i++) {
        const q = cloudUV[i];
        let px, py, pz, cr, cg, cb;
        if (q.region === 0) {
          const rr = Math.sqrt(q.a) * 0.048;
          const ang = q.b * TAU;
          px = x + rr * Math.sin(ang);
          py = y + rr * Math.cos(ang);
          pz = z + crown + q.c * hCol;
          cr = 1.00 - 0.45 * fresh;
          cg = 0.42 + 0.35 * fresh;
          cb = 0.25 + 0.55 * fresh;
        } else {
          const rr = 0.056 + q.a * 0.019;
          const ang = q.b * TAU;
          px = x - 0.07 + q.c * 0.14;   // 沿曲轴轴向铺在箱体内 x∈[0.26,0.40]（箱体 [0.245,0.415]）
          py = y + rr * Math.cos(ang);
          pz = z + rr * Math.sin(ang);
          cr = 0.35 + 0.25 * fresh;
          cg = 0.62 + 0.20 * fresh;
          cb = 1.00;
        }
        _cloudP.set(px, py, pz);
        _cloudS.set(1, 1, 1);
        _cloudM.compose(_cloudP, _cloudQ, _cloudS);
        refs.cloud.setMatrixAt(i, _cloudM);
        _cloudC.setRGB(cr, cg, cb);
        refs.cloud.setColorAt(i, _cloudC);
      }
      refs.cloud.instanceMatrix.needsUpdate = true;
      refs.cloud.instanceColor.needsUpdate = true;
    }

    // 压力波视觉：解析脉冲列表 → 管外发光环（位置/取向/极性/衰减，§6.2）
    {
      const pulses = cycle.wavePulses(s.cycle.thetaATDC(), (s.rpm / 60) * TAU);
      for (let i = 0; i < waveRings.length; i++) {
        const ring = waveRings[i];
        const pl = pulses[i];
        if (!pl) { ring.visible = false; continue; }
        const sPos = pl.u * cycle.L_WAVE;
        if (sPos <= cycle.HEADER_LEN) {
          const u = sPos / cycle.HEADER_LEN;
          ring.position.copy(headerCurve.getPointAt(u));
          ring.quaternion.setFromUnitVectors(Z_UNIT, headerCurve.getTangentAt(u));
          ring.scale.setScalar(0.028);
        } else {
          const a = sPos - cycle.HEADER_LEN;
          ring.position.copy(chamberThroat).addScaledVector(dir, a);
          ring.quaternion.setFromUnitVectors(Z_UNIT, dir);
          ring.scale.setScalar(chamberRadiusAt(a) + 0.004);
        }
        ring.material = pl.sign > 0 ? waveRingMatPos : waveRingMatNeg;
        ring.visible = true;
      }
    }

    // 发动机总成微振（怠速颗粒感）
    const vib = s.engineOn ? 0.0006 + s.throttle * 0.0012 : 0;
    asm.position.set(
      Math.sin(s.crankAngle * 2) * vib,
      Math.sin(s.crankAngle * 4 + 1.3) * vib * 0.6,
      0
    );
  });
}
