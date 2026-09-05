import * as THREE from 'three';
import { M } from '../materials.js';
import { mesh, cylBetween, sprocketGeometry } from '../geometry.js';
import { L } from '../layout.js';
import { solveSteeringAngle } from '../../sim/kinematics.js';
import { buildWheel } from './wheels.js';

// ————— 转向系统：方向盘 → 转向柱 → 齿轮齿条 → 拉杆 → 转向节 —————
// 拉杆与转向臂按刚性杆约束精确求解（牛顿迭代），几何永不脱节。
// 注意：拉杆组自身注册 explodeDist: 0——不做独立爆炸平移；
// 其端点每帧从转向节/齿条的当前位置（含各自爆炸偏移）解出，机构在爆炸中也保持连接。

const KP_Y = L.kingpinY;          // 主销高度
const KP_X = L.kingpinX;
const KP_Z = L.frontAxleZ;
const KPI = L.kingpinKPI;         // 主销内倾（正视上端向内）
const CASTER = L.kingpinCaster;   // 主销后倾（侧视上端向后）
const ARM = 0.22;                 // 转向臂长（指向车尾）
const ARM_Y = 0.002;
const ARM_IN = 0.182;             // 转向臂内倾量（梯形布置 → 阿克曼几何）
// 三值可行域被两侧夹死，收紧任一侧即无解（按 layout 尺寸实测推得）：
// ① 球铰/臂身/拉杆退出前轮轮胎包络：臂身只能从轮辋桶外缘(ρ=0.0832)与胎圈(ρ=0.091)之间的
//    开口穿过 → 斜率 ARM/ARM_IN ≲ 1.21，且 ARM_Y 越大臂身越早贴上轮辋桶（故取近轴高度）；
// ② 内轮侧拉杆不得进入死点：|主销→臂端| + 拉杆定长 ≥ |主销→齿条端|max(0.394)，即臂端须落在
//    以主销与齿条端为焦点的椭圆之外 → 斜率 ≲1.21 时臂端总长须 ≥ 0.28m。
// 两式的交角即此处取值（改前 ARM=0.13/ARM_IN=0.034 的臂身斜率 3.8，只能穿胎而过）。
const RACK_Y = L.rackY;
const RACK_Z = L.rackZ;
const RACK_HALF = 0.30;           // 齿条端球铰横向距离
const RACK_TRAVEL = 0.062;        // 齿条全行程（单侧）
const PINION_R = 0.021;           // 小齿轮节圆半径

const refs = {};
const _armEnd = new THREE.Vector3();
const _rackEnd = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _qYaw = new THREE.Quaternion();
const _qAxis = new THREE.Quaternion();

// 主销倾斜四元数 Q_tilt = Q_z(sign·KPI) × Q_x(−caster)（先绕 x 后绕 z）：
// 右手系下绕 +x 正转把 +y 带向 +z（车头），故"上端向后"取 −caster；
// 左轮 sign=−1 时上端 +x（向内），右轮镜像。视觉验收：主销上端相对下端向内且向后。
// 与 kinematics.js 的 kingpinAxis（同款合成施加于 +y）互为渲染侧/解算侧同一几何。
function kingpinTilt(sign) {
  return new THREE.Quaternion()
    .setFromAxisAngle(_Z, sign * KPI)
    .multiply(new THREE.Quaternion().setFromAxisAngle(_X, -CASTER));
}

// 转向节拆两层：knuckleMount（固定侧，注册部件本体，爆炸位移作用于它）承载倾斜的主销
// 视觉件；steerGroup（转动侧，子级）承载转向臂/球铰/前轮。直行位前轮保持竖直（主销与
// 轮轴夹角由转向节结构吸收，真车同理），偏转 = 绕倾斜主销轴转 a，即世界姿态
// R_axis(a) = Q_tilt·Q_yaw(a)·Q_tilt⁻¹——相对直行位恰为绕斜轴的纯旋转。
function buildSpindle(reg, side) {
  const sign = side === 'L' ? -1 : 1;
  const qTilt = kingpinTilt(sign);
  const mount = new THREE.Group();
  mount.position.set(sign * KP_X, KP_Y, KP_Z);
  mount.quaternion.copy(qTilt);
  const kingpin = mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.115, 12), M.chrome, 0, 0, 0);
  const boss = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.055, 14), M.alu, 0, 0, 0);
  mount.add(kingpin, boss);
  const steer = new THREE.Group();
  mount.add(steer);
  // 转向臂（指向车尾并内倾，构成阿克曼梯形）
  const armDir = Math.atan2(-sign * ARM_IN, -ARM); // 相对 -z 的偏转角
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.014, Math.hypot(ARM, ARM_IN)), M.steel);
  arm.position.set(-sign * ARM_IN / 2, ARM_Y, -ARM / 2);
  arm.rotation.y = armDir;
  steer.add(arm);
  // 臂端球铰
  const ball = mesh(new THREE.SphereGeometry(0.0115, 14, 10), M.zinc, -sign * ARM_IN, ARM_Y, -ARM);
  steer.add(ball);
  // 前轮（随转向节偏转。卡丁车是后驱车：展示台静止场景下前轮无动力、不空转，
  // 只有后轮被链条驱动——前轮不做滚动更新是有意为之，不是漏了）
  const wheel = buildWheel(L.wheelF.r, L.wheelF.w);
  wheel.position.set(0, L.wheelF.r - KP_Y, 0);
  steer.add(wheel);
  const wid = side === 'L' ? 'wheel-fl' : 'wheel-fr';
  reg.registerPart(wheel, {
    id: wid, name: side === 'L' ? '左前轮' : '右前轮', system: 'wheels',
    explodeDir: [sign, 0.1, 0.25], explodeDist: 0.55,
    specs: [['规格', '5.0 × 5 光头胎'], ['驱动', '无（仅转向）']],
    desc: '前轮通过轮毂轴承浮套在转向节上，没有驱动也没有制动——卡丁车是后驱车，所以在展示台上空转的只有后轮。前轮外倾角与前束都接近 0°，一切以滚阻最小、指向最准为目标。',
  });
  refs[side] = { mount, steer, wheel, qTilt, qTiltInv: qTilt.clone().invert() };
  return mount;
}

export function buildSteering(root, reg) {
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
  reg.registerPart(wheelG, {
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
  reg.registerPart(column, {
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
  refs.rackG = rackG;
  refs.rackBar = rackBar;
  refs.pinion = pinion;
  reg.registerPart(rackG, {
    id: 'steering-rack', name: '转向机（齿轮齿条）', system: 'steering', explodeDir: [0, 0.8, 0.3], explodeDist: 0.55,
    specs: [['形式', '齿轮齿条式'], ['齿条行程', '±62mm']],
    desc: '转向柱末端的小齿轮（金色，随方向盘转动）与横向齿条啮合，把旋转运动变成齿条左右直线运动。转向比由齿轮半径决定：卡丁车转向机做到极小，以求"手到轮到"的直接感。',
  });

  // —— 转向节（左右）——
  const mountL = buildSpindle(reg, 'L');
  const mountR = buildSpindle(reg, 'R');
  root.add(mountL, mountR);
  reg.registerPart(mountL, {
    id: 'spindle-l', name: '左转向节', system: 'steering', explodeDir: [-1, 0.3, 0.3], explodeDist: 0.45,
    specs: [['别名', '羊角'], ['运动', '绕倾斜主销偏转（内倾10°/后倾12°）']],
    desc: '转向节通过主销安装在车架前部，前轮经轴承装在它上面。拉杆推动转向臂，整个转向节绕主销偏转——前轮指向前方哪里，由这几十毫米的臂长和拉杆几何精确决定。主销并非竖直——内倾约 10°、后倾约 12°。打方向时前轮绕斜轴转动会把车架顶起（举升效应），刚性车架把侧倾传到后轴，内侧后轮因此离地——这就是没有差速器的卡丁车也能顺利过弯的原因。打开「主销举升演示」打满方向，盯着内侧后轮看。',
  });
  reg.registerPart(mountR, {
    id: 'spindle-r', name: '右转向节', system: 'steering', explodeDir: [1, 0.3, 0.3], explodeDist: 0.45,
    specs: [['别名', '羊角'], ['运动', '绕倾斜主销偏转（内倾10°/后倾12°）']],
    desc: '转向节通过主销安装在车架前部，是前轮的承载与转向枢纽。左右转向节臂、两根拉杆与齿条构成一组空间四连杆机构。与左侧相同，主销带约 10° 内倾与 12° 后倾——打方向时前轮绕斜轴转动产生举升效应，把内侧后轮抬离地面（打开「主销举升演示」可实测真实离地毫米数）。',
  });

  // —— 左右拉杆（杆身 + 齿条端球铰 合并为一个部件组）——
  const mkTieRod = () => {
    const g = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 1, 10), M.chrome); // 单位长杆，y 轴向，逐帧缩放
    const ball = mesh(new THREE.SphereGeometry(0.0115, 12, 10), M.zinc);
    g.add(bar, ball);
    g.userData.mechPos = new THREE.Vector3(0, RACK_Y, RACK_Z); // 动态件：机构位姿
    root.add(g);
    return { g, bar, ball };
  };
  refs.tieL = mkTieRod();
  refs.tieR = mkTieRod();

  // 齿条端球铰初始位置 → 计算左右拉杆定长
  const armEndNeutral = (sign) => new THREE.Vector3(sign * (KP_X - ARM_IN), KP_Y + ARM_Y, KP_Z - ARM);
  refs.rodLenL = new THREE.Vector3(-RACK_HALF, RACK_Y, RACK_Z).distanceTo(armEndNeutral(-1));
  refs.rodLenR = new THREE.Vector3(RACK_HALF, RACK_Y, RACK_Z).distanceTo(armEndNeutral(1));
  refs.angleL = 0;
  refs.angleR = 0;

  reg.registerPart(refs.tieL.g, {
    id: 'tierod-l', name: '左转向拉杆', system: 'steering', explodeDir: [0, 0, 0], explodeDist: 0,
    specs: [['两端', '球铰接头'], ['长度', '定长刚杆']],
    desc: '连接齿条端与左转向节臂的刚性杆，两端为球铰。齿条横移时它推/拉转向臂使车轮偏转。演示时注意：转向角度不是程序"摆"出来的，而是按定长杆约束解算的真实机构运动。',
  });
  reg.registerPart(refs.tieR.g, {
    id: 'tierod-r', name: '右转向拉杆', system: 'steering', explodeDir: [0, 0, 0], explodeDist: 0,
    specs: [['两端', '球铰接头'], ['长度', '定长刚杆']],
    desc: '与左拉杆对称。由于左右转向节到齿条端点的几何不对称，同一段齿条行程会让内外侧车轮产生不同转角——这正是阿克曼转向几何的来源。',
  });

  // ————— 每帧：齿条 → 拉杆 → 转向节（牛顿迭代解刚杆约束）—————
  reg.addUpdate((dt, s) => {
    const disp = s.steerSmooth * RACK_TRAVEL;

    // 齿条平移 + 小齿轮/方向盘转动
    refs.rackBar.position.x = disp;
    refs.pinion.rotation.y = -disp / PINION_R;
    refs.spin.rotation.z = -disp / PINION_R;

    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? -1 : 1;
      const { mount, steer, qTilt, qTiltInv } = refs[side];
      const tie = side === 'L' ? refs.tieL : refs.tieR;
      const rodLen = side === 'L' ? refs.rodLenL : refs.rodLenR;

      // 定长刚杆约束解转向角（在装配位几何上求解——爆炸只是展示位移，不改变机构关系）
      const vx = -sign * ARM_IN;
      const vz = -ARM;
      const a = solveSteeringAngle({
        vx, vz, armY: ARM_Y, rodLen,
        pivot: { x: sign * KP_X, y: KP_Y, z: KP_Z },
        rackEnd: { x: sign * RACK_HALF + disp, y: RACK_Y, z: RACK_Z },
        a0: refs['angle' + side],
      });
      refs['angle' + side] = a;
      if (side === 'L') s.steerAngleL = a; else s.steerAngleR = a; // 供举升姿态解算读取

      // 绕倾斜主销轴转 a：R_axis(a) = Q_tilt·Q_yaw(a)·Q_tilt⁻¹。
      // steerGroup 是 mount（自带 Q_tilt）的子级，局部四元数 = Q_tilt⁻¹·R_axis(a)，
      // 直行位世界姿态恒等——前轮保持竖直，偏转时自然带上外倾变化。
      // 已知近似：求解器解的是水平面几何（假设竖直轴）。主销倾斜 ≤12° 时臂端轨迹偏离
      // 水平面 ≈ 臂长×(1−cos) 量级 < 3mm，对转角解的误差 <2%，演示口径够用，求解器不改。
      _qYaw.setFromAxisAngle(_UP, a);
      _qAxis.copy(qTilt).multiply(_qYaw).multiply(qTiltInv); // R_axis(a)
      steer.quaternion.copy(qTiltInv).multiply(_qAxis);

      // 拉杆两端世界坐标（从邻居当前位置读取，含其爆炸偏移——爆炸位移由 explode
      // 统一写入各部件 position，此处读取的是上一帧的结果，过渡动画中有 1 帧松弛，不可察觉）
      _armEnd.set(vx, ARM_Y, vz).applyQuaternion(_qAxis).add(mount.position);
      const rg = refs.rackG.position; // rackG 组原点为 (0,0,0)，其 position 即整组爆炸偏移
      _rackEnd.set(sign * RACK_HALF + disp + rg.x, RACK_Y + rg.y, RACK_Z + rg.z);

      // 拉杆组：mechPos = 两端中点（explode 写入 position），杆身/球铰在组内吸收端点差
      _mid.addVectors(_armEnd, _rackEnd).multiplyScalar(0.5);
      tie.g.userData.mechPos.copy(_mid);
      _dir.subVectors(_armEnd, _rackEnd);
      tie.bar.scale.set(1, _dir.length(), 1);
      tie.bar.quaternion.setFromUnitVectors(_UP, _dir.normalize());
      tie.ball.position.subVectors(_rackEnd, _mid);
    }
  });
}
