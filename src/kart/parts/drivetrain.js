import * as THREE from 'three';
import { M } from '../materials.js';
import { cylBetween, sprocketGeometry } from '../geometry.js';
import { L } from '../layout.js';
import { chainPath } from '../../sim/kinematics.js';
import { CRANK, CHAIN_X, CLUTCH_R } from './engine.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3(1, 1, 1);
const _xAxis = new THREE.Vector3(1, 0, 0);

// ————— 传动系统：后轴 / 轴承座 / 后链轮 / 链条 —————
// 开式链传动：曲轴 12T → 后轴 66T，减速比约 5.5:1，无差速器。

const SPROCKET_R = L.sprocketR;
const AXLE_Y = L.axleY;
const AXLE_Z = L.rearAxleZ;

const refs = {};

export function buildDrivetrain(root, reg) {
  // —— 后轴 ——
  // 组原点必须在轴心线上：rotation.x 是绕自身轴自转，不是绕世界原点公转
  const axle = new THREE.Group();
  axle.position.set(0, AXLE_Y, AXLE_Z);
  axle.add(
    cylBetween(new THREE.Vector3(-L.rearTrack, 0, 0), new THREE.Vector3(L.rearTrack, 0, 0), 0.025, M.chrome, 16)
  );
  // 轴端花键轮毂座
  for (const side of [-1, 1]) {
    const hubSeat = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 16), M.steel);
    hubSeat.rotation.z = Math.PI / 2;
    hubSeat.position.set(side * (L.rearTrack - 0.03), 0, 0);
    axle.add(hubSeat);
  }
  root.add(axle);
  refs.axle = axle;
  reg.registerPart(axle, {
    id: 'rear-axle', name: '后轴', system: 'drivetrain', explodeDir: [0, 1, -0.3], explodeDist: 0.65,
    specs: [['直径', 'Ø50mm 实心钢轴'], ['形式', '整体式 · 无差速器']],
    desc: '实心钢制整体后轴，左右后轮与链轮全部刚性固定在它上面——卡丁车没有差速器！过弯时内外侧后轮被迫同速旋转，多余转速只能靠轮胎滑移和车架形变消化。这正是卡丁车"甩尾过弯"特性的机械根源。',
  });

  // —— 轴承座 ——
  const hangers = new THREE.Group();
  for (const hx of [-0.315, 0.315, 0.36]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, 0.05), M.alloy);
    block.position.set(hx, AXLE_Y - 0.038, AXLE_Z);
    hangers.add(block);
    const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.028, 18), M.castAlu);
    bearing.rotation.z = Math.PI / 2;
    bearing.position.set(hx, AXLE_Y, AXLE_Z);
    hangers.add(bearing);
  }
  root.add(hangers);
  reg.registerPart(hangers, {
    id: 'bearing-hangers', name: '轴承座', system: 'drivetrain', explodeDir: [0, 0.8, -0.5], explodeDist: 0.5,
    specs: [['数量', '3 个（含链轮座）'], ['轴承', '自润滑球轴承']],
    desc: '把后轴通过滚动轴承悬挂在车架上的支座。轴承座的数量与跨度决定后轴的支撑刚度——拆掉一个轴承座后轴会变"软"，抓地特性随之改变，这是常见的快速调校手段。',
  });

  // —— 后链轮（66 齿）——
  const sprocket = new THREE.Group();
  sprocket.position.set(CHAIN_X, AXLE_Y, AXLE_Z);
  const sprocketWheel = new THREE.Mesh(
    sprocketGeometry({ teeth: 66, pitchR: SPROCKET_R, thickness: 0.006, holeR: 0.022, lightHoles: 6, lightR: 0.13 }),
    M.zinc
  );
  sprocketWheel.rotation.y = -Math.PI / 2;
  sprocket.add(sprocketWheel);
  const sprocketHub = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 18), M.steel);
  sprocketHub.rotation.z = Math.PI / 2;
  sprocket.add(sprocketHub);
  root.add(sprocket);
  refs.sprocket = sprocket;
  reg.registerPart(sprocket, {
    id: 'rear-sprocket', name: '后链轮', system: 'drivetrain', explodeDir: [0.5, 0.9, -0.3], explodeDist: 0.55,
    specs: [['齿数', '66T'], ['节圆直径', 'Ø246mm']],
    desc: '固定在后轴上的大齿盘。链条把曲轴链轮（12T）的动力传到这里，减速比 = 66 ÷ 12 ≈ 5.5。想加速猛就换大后齿盘，想要极速就换小的——换齿比是卡丁车赛场最常见的"调校"。',
  });

  // —— 链条（滚子链，沿包络路径循环）——
  const path = chainPath(
    { z: CRANK.z - 0.11, y: CRANK.y, r: CLUTCH_R },
    { z: AXLE_Z, y: AXLE_Y, r: SPROCKET_R }
  );
  const PITCH = L.chainPitch;
  const LINKS = Math.round(path.total / PITCH);
  const pitchActual = path.total / LINKS;

  const chain = new THREE.Group();
  // 每节 = 2 片链板（全部实例共用 1 个 draw call）+ 内节滚子（再 1 个 draw call）
  // 原来是 ~160 个 Group × 2-3 个 Mesh ≈ 400 个 draw call
  const plateGeo = new THREE.BoxGeometry(0.0022, 0.0085, pitchActual * 0.62);
  const rollerGeo = new THREE.CylinderGeometry(0.0038, 0.0038, 0.0068, 8);
  rollerGeo.rotateX(Math.PI / 2); // 与旧版 roller.rotation.x=π/2 等效，烘进几何
  const plates = new THREE.InstancedMesh(plateGeo, M.chainSteel, LINKS * 2);
  // 滚子只挂在奇数链节上：floor(LINKS/2) 恰好用满，不留一个未定位的冗余实例在原点
  const rollers = new THREE.InstancedMesh(rollerGeo, M.steel, Math.floor(LINKS / 2));
  plates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rollers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  chain.add(plates, rollers);
  root.add(chain);
  refs.chain = chain;
  refs.plates = plates;
  refs.rollers = rollers;
  refs.path = path;
  refs.pitch = pitchActual;
  reg.registerPart(chain, {
    id: 'chain', name: '传动链条', system: 'drivetrain', explodeDir: [0.7, 0.6, 0], explodeDist: 0.55,
    specs: [['配比', '12T × 66T'], ['减速比', '5.5 : 1']],
    desc: '开式滚子链，没有壳体保护——链条状态需要每次上场前检查：过紧增加摩擦损耗并勒弯后轴，过松会跳齿甚至脱落。演示中链节沿真实的外公切线包络运行，节距与齿距严格一致：链轮每转过一个齿，链条恰好走过一节。',
  });

  reg.addUpdate((dt, s) => {
    refs.axle.rotation.x += s.axleOmega * dt; // 后轴与链轮同速旋转（说明词承诺过"随轴转"）
    refs.sprocket.rotation.x += s.axleOmega * dt;

    // 链节沿包络路径循环，线速度 = ω·r（与链轮齿严格啮合）；实例矩阵就地刷新
    let rollerIdx = 0;
    for (let i = 0; i < LINKS; i++) {
      const s0 = s.chainPhase + i * refs.pitch;
      const p = refs.path.pointAt(s0);
      const p2 = refs.path.pointAt(s0 + refs.pitch * 0.5);
      _q.setFromAxisAngle(_xAxis, -Math.atan2(p2.y - p.y, p2.z - p.z));
      for (const px of [-0.0068, 0.0068]) {
        _pos.set(CHAIN_X + px, p.y, p.z);
        _m4.compose(_pos, _q, _scl);
        refs.plates.setMatrixAt(i * 2 + (px < 0 ? 0 : 1), _m4);
      }
      if (i % 2 === 1) {
        _pos.set(CHAIN_X, p.y, p.z);
        _m4.compose(_pos, _q, _scl);
        refs.rollers.setMatrixAt(rollerIdx++, _m4);
      }
    }
    refs.plates.instanceMatrix.needsUpdate = true;
    refs.rollers.instanceMatrix.needsUpdate = true;
  });
}
