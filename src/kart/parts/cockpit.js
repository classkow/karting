import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { M } from '../materials.js';
import { tubeThrough, cylBetween } from '../geometry.js';
import { L } from '../layout.js';

// ————— 操纵与油路：踏板 / 油门拉线 / 油箱 / 燃油管 —————

const refs = {};

function buildPedal(reg, id, name, x, desc, padMat, explodeDir) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.095, 0.46);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.11, 0.02), M.steel);
  arm.position.y = 0.05;
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.052, 0.085, 0.014, 2, 0.005), padMat);
  pad.position.set(0, 0.105, 0.012);
  // 防滑纹
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.004), M.plastic);
    rib.position.set(0, 0.08 + i * 0.024, 0.021);
    pivot.add(rib);
  }
  pivot.add(arm, pad);
  refs[id] = pivot;
  reg.registerPart(pivot, {
    id, name, system: 'cockpit', explodeDir, explodeDist: 0.5,
    specs: [['操作', '脚踩 · 铰链式']],
    desc,
  });
  return pivot;
}

export function buildCockpit(root, reg) {
  buildPedal(
    reg, 'pedal-throttle', '油门踏板', 0.13,
    '油门踏板通过钢拉线拉动化油器节气门。踩得越深，节气门开度越大、转速越高；松开由回位弹簧自动关闭。可以同时观察踏板、拉线走向和化油器里节气门的联动。',
    M.alu, [0.4, 0.4, 0.9]
  );
  buildPedal(
    reg, 'pedal-brake', '刹车踏板', -0.13,
    '刹车踏板通过推杆直推制动主缸。卡丁车只有后刹车，且没有 ABS——重刹时后轮容易抱死侧滑，所以"直线刹完再入弯"是第一课。',
    M.paintRed, [-0.4, 0.4, 0.9]
  );

  // —— 油门拉线（踏板 → 化油器，沿右侧车架走线）——
  const cable = tubeThrough(
    [[0.13, 0.205, 0.445], [0.22, 0.14, 0.36], [0.31, 0.132, 0.05], [0.35, 0.135, -0.18], [0.34, 0.175, -0.30], [0.33, 0.185, -0.352]],
    0.0024, { tubular: 48, radial: 6, mat: M.plastic }
  );
  root.add(cable);
  reg.registerPart(cable, {
    id: 'throttle-cable', name: '油门拉线', system: 'cockpit', explodeDir: [0.5, 0.5, 0], explodeDist: 0.45,
    specs: [['形式', '钢丝拉索 + 回位弹簧']],
    desc: '踏板到化油器之间唯一的机械联系。拉线外套螺旋护套，内芯钢丝只拉不推——所以节气门必须有回位弹簧才能关闭。看它沿车架右侧绕开排气高温区的走线。',
  });

  // —— 油箱 ——
  const tank = new THREE.Group();
  tank.position.set(0.02, 0.30, -0.52);
  const tankBody = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.12, 0.14, 4, 0.03), M.plastic);
  tank.add(tankBody);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.02, 14), M.alu);
  cap.position.set(0, 0.068, 0);
  tank.add(cap);
  // 固定带
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.005, 8, 24), M.steel);
  strap.rotation.y = Math.PI / 2;
  strap.scale.set(0.8, 1.05, 1);
  tank.add(strap);
  root.add(tank);
  reg.registerPart(tank, {
    id: 'fuel-tank', name: '油箱', system: 'cockpit', explodeDir: [0, 0.9, -0.5], explodeDist: 0.65,
    specs: [['容积', '约 8L'], ['位置', '座椅后方']],
    desc: '位于座椅后方的小油箱，靠重力向化油器供油（部分车型用脉动油泵）。卡丁车油耗惊人——竞赛级二冲程每小时要喝掉 15 升以上，一场决赛加满油刚好跑完。',
  });

  // —— 燃油管（油箱 → 化油器）——
  const fuelLine = tubeThrough(
    [[0.075, 0.26, -0.50], [0.24, 0.235, -0.46], [0.31, 0.205, -0.41], [0.33, 0.19, -0.378]],
    0.0032, { tubular: 24, radial: 6, mat: M.paintRed }
  );
  root.add(fuelLine);
  reg.registerPart(fuelLine, {
    id: 'fuel-line', name: '燃油管', system: 'cockpit', explodeDir: [0.6, 0.4, -0.3], explodeDist: 0.45,
    specs: [['介质', '汽油 + 机油混合']],
    desc: '油箱到化油器的透明燃油管。二冲程发动机没有独立润滑系统，机油直接按比例掺进汽油（约 4%），混合油经这里进入曲轴箱，雾化后顺便润滑曲轴轴承。',
  });

  reg.addUpdate((dt, s) => {
    refs['pedal-throttle'].rotation.x = -s.throttle * 0.38;
    refs['pedal-brake'].rotation.x = -s.brake * 0.32;
  });
}
