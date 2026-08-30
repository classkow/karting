import * as THREE from 'three';
import { M } from '../materials.js';
import { lathe } from '../geometry.js';
import { L } from '../layout.js';

// ————— 车轮：车床曲线轮胎 + 镁铝合金轮毂 —————
// 轮组局部坐标：轴线沿 x，自旋即 group.rotation.x。
// buildWheel 同时被 wheels.js（后轮）与 steering.js（前轮）复用。

export function buildWheel(r, w, bolts = 3) {
  const g = new THREE.Group();

  // 轮胎：圆肩弧胎冠（比赛用光头胎）
  const tireProfile = [
    [r * 0.70, -w * 0.42],
    [r * 0.90, -w * 0.50],
    [r * 0.985, -w * 0.38],
    [r, -w * 0.16],
    [r * 0.995, 0],
    [r, w * 0.16],
    [r * 0.985, w * 0.38],
    [r * 0.90, w * 0.50],
    [r * 0.70, w * 0.42],
  ];
  const tire = new THREE.Mesh(lathe(tireProfile, 56), M.rubber);
  tire.rotation.z = -Math.PI / 2;
  g.add(tire);

  // 轮辋桶身（开口 C 形截面，带两侧卷边）
  const rimProfile = [
    [r * 0.64, -w * 0.42],
    [r * 0.70, -w * 0.42],
    [r * 0.70, w * 0.42],
    [r * 0.64, w * 0.42],
  ];
  const rim = new THREE.Mesh(lathe(rimProfile, 48), M.alloy);
  rim.rotation.z = -Math.PI / 2;
  g.add(rim);

  // 五辐条（斜置，连接轮毂与桶身）
  const spokeGeo = new THREE.BoxGeometry(0.018, r * 0.48, w * 0.34);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const spoke = new THREE.Mesh(spokeGeo, M.alloy);
    spoke.rotation.x = a;
    spoke.rotation.y = 0.16; // 辐条斜面
    spoke.position.set(0, Math.cos(a) * r * 0.46, -Math.sin(a) * r * 0.46);
    g.add(spoke);
  }

  // 轮毂 + 固定螺栓 + 气门嘴
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.24, r * 0.24, w * 0.62, 24), M.alu);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  const boltGeo = new THREE.CylinderGeometry(0.0085, 0.0085, w * 0.72, 6);
  for (let i = 0; i < bolts; i++) {
    const a = (i / bolts) * Math.PI * 2;
    const bolt = new THREE.Mesh(boltGeo, M.steel);
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(0, Math.cos(a) * r * 0.135, Math.sin(a) * r * 0.135);
    g.add(bolt);
  }
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.026, 8), M.brass);
  valve.position.set(0, r * 0.66, -w * 0.36);
  valve.rotation.x = -0.5;
  g.add(valve);

  return g;
}

export function buildWheels(root, reg) {
  // 后轮（与后轴刚性连接，随轴转动；前轮挂在转向节上，见 steering.js）
  const { wheelR } = L;
  const rl = buildWheel(wheelR.r, wheelR.w, 4);
  rl.position.set(-L.rearTrack, wheelR.r, L.rearAxleZ);
  const rr = buildWheel(wheelR.r, wheelR.w, 4);
  rr.position.set(L.rearTrack, wheelR.r, L.rearAxleZ);
  root.add(rl, rr);
  const rears = [rl, rr];
  reg.registerPart(rl, {
    id: 'wheel-rl', name: '左后轮', system: 'wheels', explodeDir: [-1, 0.1, 0], explodeDist: 0.6,
    specs: [['规格', '7.1 × 5 光头胎'], ['驱动', '与后轴刚性连接']],
    desc: '后轮通过花键轮毂紧固在后轴上，是真正的驱动轮。宽胎面提供驱动所需的接地面积。由于左右后轮被同一根轴锁死，过弯时内侧后轮必须边滑边滚。',
  });
  reg.registerPart(rr, {
    id: 'wheel-rr', name: '右后轮', system: 'wheels', explodeDir: [1, 0.1, 0], explodeDist: 0.6,
    specs: [['规格', '7.1 × 5 光头胎'], ['驱动', '与后轴刚性连接']],
    desc: '后轮是驱动轮，胎宽明显大于前轮。卡丁车用无花纹的光头胎，依靠橡胶配方在工作温度下软化产生抓地力——冷胎时反而非常滑，所以上场前都要"热胎"。',
  });

  reg.addUpdate((dt, s) => {
    for (const w of rears) w.rotation.x += s.wheelOmega * dt;
  });
}

// 供转向节复用：前轮随车速滚动（绕自身 x 轴自转）
export function addRolling(reg, wheel, getOmega) {
  reg.addUpdate((dt, s) => {
    wheel.rotation.x += (getOmega ? getOmega(s) : s.wheelOmega) * dt;
  });
}
