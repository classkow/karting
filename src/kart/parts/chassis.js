import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { M } from '../materials.js';
import { mesh, frameTubes, roundedRectShape, extrudeShape } from '../geometry.js';
import { registerPart } from '../registry.js';
import { L } from '../layout.js';

// ————— 车架车身：管梁桁架 / 底板 / 座椅 —————

export function buildChassis(root) {
  const R = 0.016; // Ø32mm 铬钼钢管

  // —— 管梁车架 ——
  const N = [
    [-L.railX, L.frameY, 0.44],  // 0  左纵梁前端
    [L.railX, L.frameY, 0.44],   // 1  右纵梁前端
    [-L.railX, L.frameY, 0.30],  // 2
    [L.railX, L.frameY, 0.30],   // 3
    [-L.railX, L.frameY, -0.06], // 4
    [L.railX, L.frameY, -0.06],  // 5
    [-0.30, 0.102, -0.44],       // 6  左后
    [0.30, 0.102, -0.44],        // 7  右后
    [-0.315, 0.108, -0.53],      // 8  左轴承座
    [0.315, 0.108, -0.53],       // 9  右轴承座
    [-L.kingpinX, 0.105, 0.52],  // 10 左主销下节点
    [L.kingpinX, 0.105, 0.52],   // 11 右主销下节点
    [-0.20, 0.175, -0.12],       // 12 左座椅支承
    [0.20, 0.175, -0.12],        // 13
    [-0.22, 0.165, -0.38],       // 14 左座椅后支承
    [0.22, 0.165, -0.38],        // 15
    [0.36, 0.125, -0.13],        // 16 发动机吊装左点（右侧车架）
    [0.36, 0.125, -0.29],        // 17
    [0, 0.098, 0.30],            // 18 前横梁中点
    [0, 0.138, 0.345],           // 19 转向柱支架
  ];
  const E = [
    [0, 2], [2, 4], [4, 6], [6, 8],        // 左纵梁
    [1, 3], [3, 5], [5, 7], [7, 9],        // 右纵梁
    [0, 1], [2, 3], [4, 5], [6, 7], [8, 9],// 横梁
    [2, 10], [3, 11], [10, 11],            // 前三角 → 主销
    [12, 13], [14, 15], [4, 12], [5, 13],  // 座椅支承
    [6, 14], [7, 15], [12, 14], [13, 15],
    [5, 16], [7, 17], [16, 17],            // 发动机安装架
    [18, 19],                              // 转向柱支架
  ];
  const frame = frameTubes(N, E, R, M.frameTube);
  root.add(frame);
  registerPart(frame, {
    id: 'frame', name: '管梁车架', system: 'chassis', explodeDir: [0, 0, 0], explodeDist: 0,
    specs: [['管材', 'Ø32 × 1.8mm 铬钼钢'], ['形式', '空间桁架，无悬挂'], ['工艺', 'TIG 焊接 + 人工时效']],
    desc: '卡丁车的骨架，由铬钼钢管焊接成空间桁架。它没有悬架——车架本身的微小弹性形变就是"悬挂"：过弯时后内侧车轮会被顶得微微抬起，帮助车尾保持抓地。车架刚度是调校核心，过硬则难以入弯，过软则指向模糊。',
  });

  // —— 底板 ——
  const floorShape = roundedRectShape(0.62, 0.86, 0.08);
  const floorGeo = new THREE.ExtrudeGeometry(floorShape, { depth: 0.012, bevelEnabled: false, curveSegments: 12 });
  const floor = new THREE.Mesh(floorGeo, M.carbon);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.048, 0.02);
  root.add(floor);
  registerPart(floor, {
    id: 'floor', name: '底盘底板', system: 'chassis', explodeDir: [0, -1, 0], explodeDist: 0.5,
    specs: [['材质', '碳纤维/铝合金复合板'], ['厚度', '约 10mm']],
    desc: '安装在车架下方的平板，与管梁共同构成底盘的刚性箱体，同时托住驾驶员的小腿与脚。它还让车底气流更平整。底板与座椅的安装角度会改变车架受载方式，也是调校手段之一。',
  });

  // —— 座椅（玻璃钢桶形座椅）——
  const seat = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0.17, 0.105);
  s.lineTo(0.17, 0.20);
  s.quadraticCurveTo(0.05, 0.215, -0.02, 0.215);
  s.quadraticCurveTo(-0.10, 0.30, -0.125, 0.44);
  s.quadraticCurveTo(-0.135, 0.545, -0.185, 0.565);
  s.lineTo(-0.19, 0.28);
  s.quadraticCurveTo(-0.185, 0.14, -0.14, 0.105);
  s.closePath();
  const shellGeo = new THREE.ExtrudeGeometry(s, { depth: 0.30, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.022, bevelSegments: 3, curveSegments: 14 });
  const shell = new THREE.Mesh(shellGeo, M.grp);
  shell.rotation.y = -Math.PI / 2;
  seat.add(shell);
  // 坐垫与靠背软垫（贴合在壳体外表面）
  const cush = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.035, 0.19, 3, 0.014), M.fabric);
  cush.position.set(0, 0.228, 0.075);
  const back = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.32, 0.026, 3, 0.012), M.fabric);
  back.position.set(0, 0.39, -0.145);
  back.rotation.x = 0.30;
  seat.add(cush, back);
  seat.position.set(0, 0, L.seatZ);
  root.add(seat);
  registerPart(seat, {
    id: 'seat', name: '赛车座椅', system: 'chassis', explodeDir: [0, 1, -0.2], explodeDist: 0.85,
    specs: [['材质', '玻璃钢 / 碳纤维'], ['安装', '硬连接，无减振']],
    desc: '玻璃钢桶形座椅，直接螺栓固定在车架上，中间没有一层橡胶垫。座椅的软硬与安装孔位直接决定车架的受力与形变——换一个座椅安装位置，过弯特性就会不同，所以座椅位置是卡丁车最重要的调校项目。',
  });
}
