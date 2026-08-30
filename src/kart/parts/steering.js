import * as THREE from 'three';
import { M } from '../materials.js';
import { mesh, cylBetween, sprocketGeometry } from '../geometry.js';
import { registerPart, addUpdate, explodeOffset } from '../registry.js';
import { L } from '../layout.js';
import { solveSteeringAngle } from '../../sim/kinematics.js';
import { buildWheel, addRolling } from './wheels.js';

// ————— 转向系统：方向盘 → 转向柱 → 齿轮齿条 → 拉杆 → 转向节 —————
// 拉杆与转向臂按刚性杆约束精确求解（牛顿迭代），几何永不脱节。

const KP_Y = L.kingpinY;          // 主销高度
const KP_X = L.kingpinX;
const KP_Z = L.frontAxleZ;
const ARM = 0.13;                 // 转向臂长（指向车尾）
const ARM_Y = -0.003;
const ARM_IN = 0.034;             // 转向臂内倾量（梯形布置 → 阿克曼几何）
const RACK_Y = L.rackY;
const RACK_Z = L.rackZ;
const RACK_HALF = 0.30;           // 齿条端球铰横向距离
const RACK_TRAVEL = 0.062;        // 齿条全行程（单侧）
const PINION_R = 0.021;           // 小齿轮节圆半径

const refs = {};
const _armEnd = new THREE.Vector3();
const _off = { x: 0, y: 0, z: 0 };

function buildSpindle(side) {
  const sign = side === 'L' ? -1 : 1;
  const pivot = new THREE.Group();
  pivot.position.set(sign * KP_X, KP_Y, KP_Z);
  const kingpin = mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.115, 12), M.chrome, 0, 0, 0);
  const boss = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.055, 14), M.alu, 0, 0, 0);
  pivot.add(kingpin, boss);
  // 转向臂（指向车尾并内倾，构成阿克曼梯形）
  const armDir = Math.atan2(-sign * ARM_IN, -ARM); // 相对 -z 的偏转角
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.014, Math.hypot(ARM, ARM_IN)), M.steel);
  arm.position.set(-sign * ARM_IN / 2, ARM_Y, -ARM / 2);
  arm.rotation.y = armDir;
  pivot.add(arm);
  // 臂端球铰
  const ball = mesh(new THREE.SphereGeometry(0.0115, 14, 10), M.zinc, -sign * ARM_IN, ARM_Y, -ARM);
  pivot.add(ball);
  // 前轮（随转向节偏转）
  const wheel = buildWheel(L.wheelF.r, L.wheelF.w);
  wheel.position.set(0, L.wheelF.r - KP_Y, 0);
  pivot.add(wheel);
  // 纯滚动条件：轮速 = 后轴线速度 / 前轮半径（前轮直径小，转得更快）
  const F_RATIO = L.wheelR.r / L.wheelF.r;
  addRolling(wheel, (s) => s.wheelOmega * F_RATIO);
  const wid = side === 'L' ? 'wheel-fl' : 'wheel-fr';
  registerPart(wheel, {
    id: wid, name: side === 'L' ? '左前轮' : '右前轮', system: 'wheels',
    explodeDir: [sign, 0.1, 0.25], explodeDist: 0.55,
    specs: [['规格', '5.0 × 5 光头胎'], ['驱动', '无（仅转向/滚动）']],
    desc: '前轮通过轮毂轴承浮套在转向节上，只负责转向与滚动，没有任何驱动与制动。卡丁车前轮外倾角与前束都接近 0°，一切以滚阻最小、指向最准为目标。',
  });
  refs[side] = { pivot, wheel };
  return pivot;
}

export function buildSteering(root) {
  // —— 方向盘 ——
  const wheelG = new THREE.Group();
  wheelG.position.set(0, 0.50, 0.30);
  wheelG.rotation.x = -0.30;
  const spin = new THREE.Group(); // 自转层
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.016, 14, 40), M.rubber);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.045, 16), M.plastic);
  hub.rotation.x = Math.PI / 2;
  spin.add(rim, hub);
  const spokeGeo = new THREE.BoxGeometry(0.014, 0.115, 0.016);
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const sp = new THREE.Mesh(spokeGeo, M.plastic);
    sp.position.set(Math.sin(a) * 0.06, Math.cos(a) * 0.06, 0);
    sp.rotation.z = -a;
    spin.add(sp);
  }
  // 顶部回正标记
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.02, 0.018), new THREE.MeshStandardMaterial({ color: 0xffb547, roughness: 0.5 }));
  marker.position.set(0, 0.125, 0);
  spin.add(marker);
  wheelG.add(spin);
  root.add(wheelG);
  refs.spin = spin;
  registerPart(wheelG, {
    id: 'steering-wheel', name: '方向盘', system: 'steering', explodeDir: [0, 0.7, 0.8], explodeDist: 0.6,
    specs: [['直径', 'Ø250mm'], ['助力', '无（纯手动）']],
    desc: '驾驶员的输入接口。卡丁车转向没有助力，路面反馈全部通过转向柱传回手掌——所以卡丁车方向盘小而厚实，顶部有回正标记。看顶部黄色标记即可读出当前转向角。',
  });

  // —— 转向柱 ——
  const column = new THREE.Group();
  column.add(cylBetween(new THREE.Vector3(0, 0.475, 0.325), new THREE.Vector3(0, 0.15, 0.345), 0.012, M.chrome));
  const uJoint = mesh(new THREE.SphereGeometry(0.017, 12, 10), M.steel, 0, 0.15, 0.345);
  column.add(uJoint);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.055, 0.014), M.alloy);
  bracket.position.set(0, 0.155, 0.356);
  column.add(bracket);
  root.add(column);
  registerPart(column, {
    id: 'steering-column', name: '转向柱', system: 'steering', explodeDir: [0, 0.7, 0.5], explodeDist: 0.5,
    specs: [['形式', '双万向节传动轴'], ['倾角', '约 17°']],
    desc: '连接方向盘与转向机的传动轴，两端万向节补偿方向盘与齿轮之间的角度差。它同时也是把路面冲击传回手心的"神经"。',
  });

  // —— 转向机（齿轮齿条）——
  const rackG = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.052), M.alloy);
  housing.position.set(0, RACK_Y, RACK_Z);
  const rackBar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.74, 12), M.chrome);
  rackBar.rotation.z = Math.PI / 2;
  rackBar.position.set(0, RACK_Y, RACK_Z);
  const pinion = new THREE.Mesh(
    sprocketGeometry({ teeth: 14, pitchR: PINION_R, thickness: 0.018, holeR: 0.007 }),
    M.zinc
  );
  pinion.rotation.x = -Math.PI / 2;
  pinion.position.set(0, RACK_Y + 0.017, RACK_Z);
  rackG.add(housing, rackBar, pinion);
  root.add(rackG);
  refs.rackBar = rackBar;
  refs.pinion = pinion;
  refs.rackBase = new THREE.Vector3(0, RACK_Y, RACK_Z);
  registerPart(rackG, {
    id: 'steering-rack', name: '转向机（齿轮齿条）', system: 'steering', explodeDir: [0, 0.8, 0.3], explodeDist: 0.55,
    specs: [['形式', '齿轮齿条式'], ['齿条行程', '±62mm']],
    desc: '转向柱末端的小齿轮（金色，随方向盘转动）与横向齿条啮合，把旋转运动变成齿条左右直线运动。转向比由齿轮半径决定：卡丁车转向机做到极小，以求"手到轮到"的直接感。',
  });

  // —— 转向节（左右）——
  const pivotL = buildSpindle('L');
  const pivotR = buildSpindle('R');
  root.add(pivotL, pivotR);
  registerPart(pivotL, {
    id: 'spindle-l', name: '左转向节', system: 'steering', explodeDir: [-1, 0.3, 0.3], explodeDist: 0.45,
    specs: [['别名', '羊角'], ['运动', '绕主销偏转']],
    desc: '转向节通过主销（竖直销轴）安装在车架前部，前轮经轴承装在它上面。拉杆推动转向臂，整个转向节绕主销偏转——前轮指向前方哪里，由这几十毫米的臂长和拉杆几何精确决定。',
  });
  registerPart(pivotR, {
    id: 'spindle-r', name: '右转向节', system: 'steering', explodeDir: [1, 0.3, 0.3], explodeDist: 0.45,
    specs: [['别名', '羊角'], ['运动', '绕主销偏转']],
    desc: '转向节通过主销安装在车架前部，是前轮的承载与转向枢纽。左右转向节臂、两根拉杆与齿条构成一组空间四连杆机构。',
  });

  // —— 左右拉杆（每帧按刚杆约束求解）——
  const rodL = cylBetween(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0.0075, M.chrome, 10);
  const rodR = cylBetween(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0.0075, M.chrome, 10);
  const ballL = mesh(new THREE.SphereGeometry(0.0115, 12, 10), M.zinc);
  const ballR = mesh(new THREE.SphereGeometry(0.0115, 12, 10), M.zinc);
  root.add(rodL, rodR, ballL, ballR);
  refs.rodL = rodL;
  refs.rodR = rodR;
  refs.ballL = ballL;
  refs.ballR = ballR;

  // 齿条端球铰初始位置 → 计算左右拉杆定长
  const armEndNeutral = (sign) => new THREE.Vector3(sign * (KP_X - ARM_IN), KP_Y + ARM_Y, KP_Z - ARM);
  const rodLenL = new THREE.Vector3(-RACK_HALF, RACK_Y, RACK_Z).distanceTo(armEndNeutral(-1));
  const rodLenR = new THREE.Vector3(RACK_HALF, RACK_Y, RACK_Z).distanceTo(armEndNeutral(1));
  refs.rodLenL = rodLenL;
  refs.rodLenR = rodLenR;
  refs.angleL = 0;
  refs.angleR = 0;

  registerPart(rodL, {
    id: 'tierod-l', name: '左转向拉杆', system: 'steering', explodeDir: [-0.6, 0.5, 0.4], explodeDist: 0.45,
    specs: [['两端', '球铰接头'], ['长度', '定长刚杆']],
    desc: '连接齿条端与左转向节臂的刚性杆，两端为球铰。齿条横移时它推/拉转向臂使车轮偏转。演示时注意：转向角度不是程序"摆"出来的，而是按定长杆约束解算的真实机构运动。',
  });
  registerPart(rodR, {
    id: 'tierod-r', name: '右转向拉杆', system: 'steering', explodeDir: [0.6, 0.5, 0.4], explodeDist: 0.45,
    specs: [['两端', '球铰接头'], ['长度', '定长刚杆']],
    desc: '与左拉杆对称。由于左右转向节到齿条端点的几何不对称，同一段齿条行程会让内外侧车轮产生不同转角——这正是阿克曼转向几何的来源。',
  });

  // ————— 每帧：齿条 → 拉杆 → 转向节（牛顿迭代解刚杆约束）—————
  addUpdate((dt, s) => {
    const disp = s.steerSmooth * RACK_TRAVEL;

    // 齿条平移 + 小齿轮/方向盘转动
    refs.rackBar.position.x = disp;
    refs.pinion.rotation.y = -disp / PINION_R;
    refs.spin.rotation.z = -disp / PINION_R;

    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? -1 : 1;
      const pivot = refs[side].pivot;
      const rackEnd = { x: sign * RACK_HALF + disp, y: RACK_Y, z: RACK_Z };
      const rodLen = side === 'L' ? refs.rodLenL : refs.rodLenR;

      // 定长刚杆约束解转向角（牛顿迭代，纯数学在 sim/kinematics.js）
      const vx = -sign * ARM_IN;
      const vz = -ARM;
      const a = solveSteeringAngle({
        vx, vz, armY: ARM_Y, rodLen,
        pivot: { x: sign * KP_X, y: KP_Y, z: KP_Z },
        rackEnd, a0: refs['angle' + side],
      });
      refs['angle' + side] = a;
      pivot.rotation.y = a;

      // 拉杆与两端球铰（齿条端球铰随拉杆一同爆炸平移）
      _armEnd.set(vx, ARM_Y, vz).applyAxisAngle(new THREE.Vector3(0, 1, 0), a).add(pivot.position);
      const rx = rackEnd.x, ry = rackEnd.y, rz = rackEnd.z;
      const ball = side === 'L' ? refs.ballL : refs.ballR;
      const rod = side === 'L' ? refs.rodL : refs.rodR;
      explodeOffset(rod, _off);
      ball.position.set(rx + _off.x, ry + _off.y, rz + _off.z);
      const len = Math.hypot(_armEnd.x - rx, _armEnd.y - ry, _armEnd.z - rz);
      rod.scale.set(1, len, 1);
      rod.position.set((_armEnd.x + rx) / 2 + _off.x, (_armEnd.y + ry) / 2 + _off.y, (_armEnd.z + rz) / 2 + _off.z);
      rod.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(_armEnd.x - rx, _armEnd.y - ry, _armEnd.z - rz).normalize()
      );
    }
  });
}
