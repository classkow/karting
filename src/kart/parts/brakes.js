import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { M } from '../materials.js';
import { mesh, drilledDiscGeometry, tubeThrough, cylBetween } from '../geometry.js';
import { registerPart, addUpdate } from '../registry.js';
import { L } from '../layout.js';

// ————— 制动系统：后轴单碟盘式制动（卡丁车标准布置）—————

const DISC_X = -0.435;
const AXLE_Y = L.axleY;
const AXLE_Z = L.rearAxleZ;

const refs = {};

export function buildBrakes(root) {
  // —— 制动盘（周圈钻孔）——
  const disc = new THREE.Group();
  disc.position.set(DISC_X, AXLE_Y, AXLE_Z);
  const discWheel = new THREE.Mesh(drilledDiscGeometry(0.098, 0.052, 0.0045, 12), M.brakeDisc);
  discWheel.rotation.y = -Math.PI / 2;
  disc.add(discWheel);
  const discHub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.026, 20), M.steel);
  discHub.rotation.z = Math.PI / 2;
  disc.add(discHub);
  root.add(disc);
  refs.disc = disc;
  registerPart(disc, {
    id: 'brake-disc', name: '后制动盘', system: 'brakes', explodeDir: [-0.6, 0.8, 0], explodeDist: 0.55,
    specs: [['直径', 'Ø196mm'], ['布置', '后轴左端 · 单碟']],
    desc: '制动盘随整个后轴一起旋转，周圈钻孔用于散热与排屑。卡丁车绝大多数级别只有这一个后碟刹——刹后轴等于同时刹住两个后轮，制动力分配天然固定，这也是卡丁车入弯前"一次刹到位"驾驶习惯的来源。',
  });

  // —— 制动卡钳（双活塞浮动式）——
  const caliper = new THREE.Group();
  caliper.position.set(DISC_X, AXLE_Y + 0.088, AXLE_Z + 0.028);
  const calBody = new THREE.Mesh(new RoundedBoxGeometry(0.052, 0.06, 0.085, 3, 0.016), M.paintRed);
  caliper.add(calBody);
  // 两侧刹车片（随制动输入夹紧）
  const padGeo = new THREE.BoxGeometry(0.008, 0.024, 0.05);
  const padIn = new THREE.Mesh(padGeo, M.plastic);
  const padOut = new THREE.Mesh(padGeo, M.plastic);
  caliper.add(padIn, padOut);
  refs.padIn = padIn;
  refs.padOut = padOut;
  // 支架
  caliper.add(cylBetween(new THREE.Vector3(0, -0.02, 0.03), new THREE.Vector3(0.02, -0.09, -0.03), 0.008, M.steel));
  root.add(caliper);
  refs.caliper = caliper;
  registerPart(caliper, {
    id: 'brake-caliper', name: '制动卡钳', system: 'brakes', explodeDir: [-0.5, 1, 0.3], explodeDist: 0.55,
    specs: [['形式', '液压双活塞'], ['泵', '踏板直推主缸']],
    desc: '液压卡钳跨在制动盘外缘。踩下踏板，主缸建立油压推动卡钳内的活塞，让刹车片从两侧夹住旋转的盘面。把刹车滑块拉满，可以看到刹车片向盘面夹紧的动作。',
  });

  // —— 制动主缸 + 油管 ——
  const master = new THREE.Group();
  master.position.set(-0.135, 0.152, 0.415);
  const mBody = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.10, 14), M.alu);
  mBody.rotation.z = Math.PI / 2;
  master.add(mBody);
  const reservoir = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.032), M.plastic);
  reservoir.position.y = 0.028;
  master.add(reservoir);
  const pushrod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.09, 8), M.chrome);
  pushrod.rotation.z = Math.PI / 2;
  pushrod.position.set(-0.09, 0, 0.008);
  master.add(pushrod);
  refs.pushrod = pushrod;
  root.add(master);
  registerPart(master, {
    id: 'master-cylinder', name: '制动主缸', system: 'brakes', explodeDir: [-0.4, 0.5, 0.7], explodeDist: 0.5,
    specs: [['原理', '帕斯卡液压放大'], ['推动', '踏板推杆']],
    desc: '液压系统的"泵"。踏板推杆压缩主缸内的刹车油建立压力，经油管传到卡钳。小踩踏力靠液压放大成几百牛的夹紧力——这是帕斯卡原理最直接的工程应用。',
  });

  // 刹车油管（主缸 → 卡钳）
  const line = tubeThrough(
    [[-0.175, 0.152, 0.415], [-0.30, 0.125, 0.30], [-0.33, 0.115, -0.25], [-0.40, 0.15, -0.44], [-0.432, 0.235, -0.495]],
    0.0034, { tubular: 48, radial: 8, mat: M.plastic }
  );
  root.add(line);
  registerPart(line, {
    id: 'brake-line', name: '刹车油管', system: 'brakes', explodeDir: [-0.5, 0.4, 0], explodeDist: 0.45,
    specs: [['介质', 'DOT4 制动液'], ['要求', '钢编防胀管']],
    desc: '主缸到卡钳的压力通道。管路若有气泡或膨胀，踏板会"发软"——所以卡丁车每次上场前都要放气检查。油管沿车架左侧走线，避开发动机与排气高温区。',
  });

  addUpdate((dt, s) => {
    // 刹车片夹紧：间隙 3.5mm → 0.5mm
    const gap = 0.008 + (1 - s.brake) * 0.0035;
    refs.padIn.position.set(-gap, -0.008, 0);
    refs.padOut.position.set(gap, -0.008, 0);
    // 主缸推杆随踏板伸出
    refs.pushrod.position.x = -0.09 + s.brake * 0.008;
  });
}
