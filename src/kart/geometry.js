import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ————— 几何构建工具 —————

const UP = new THREE.Vector3(0, 1, 0);

export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// 平滑管道（CatmullRom，适合排气管/线缆）
export function tubeThrough(points, radius, { tubular = 64, radial = 12, mat, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, radius, radial, closed), mat);
}

// 两点间圆柱
const _dir = new THREE.Vector3();
export function cylBetween(a, b, r, mat, radial = 12) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, radial), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  _dir.copy(b).sub(a).normalize();
  m.quaternion.setFromUnitVectors(UP, _dir);
  return m;
}

// 车床曲线：profile = [[半径, 轴向y], ...]
export function lathe(profile, segments = 48) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  return new THREE.LatheGeometry(pts, segments);
}

// 空间桁架：nodes + edges → 圆管 + 节点球（模拟焊点）
// 单一材质、整体注册为一个部件 → 焊接后合并成 1 个 draw call（45 件 → 1 件）
export function frameTubes(nodes, edges, radius, mat, radial = 14) {
  const geos = [];
  const P = nodes.map((n) => new THREE.Vector3(...n));
  const tmp = new THREE.Object3D();
  for (const [i, j] of edges) {
    const len = P[i].distanceTo(P[j]);
    const g = new THREE.CylinderGeometry(radius, radius, len, radial);
    tmp.position.copy(P[i]).add(P[j]).multiplyScalar(0.5);
    tmp.quaternion.setFromUnitVectors(UP, _dir.copy(P[j]).sub(P[i]).normalize());
    tmp.updateMatrix();
    g.applyMatrix4(tmp.matrix);
    geos.push(g);
  }
  const jointGeo = new THREE.SphereGeometry(radius * 1.18, radial, radial / 2);
  const seen = new Set();
  for (const [i, j] of edges) {
    for (const k of [i, j]) {
      if (seen.has(k)) continue;
      seen.add(k);
      const g = jointGeo.clone();
      g.translate(P[k].x, P[k].y, P[k].z);
      geos.push(g);
    }
  }
  jointGeo.dispose();
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  const m = new THREE.Mesh(merged, mat);
  m.name = 'frame-tubes';
  const grp = new THREE.Group();
  grp.add(m);
  return grp;
}

// 链轮 / 齿轮：真实齿形（根部圆弧 + 齿顶圆弧），带轴孔与减重孔
export function sprocketGeometry({ teeth, pitchR, thickness, holeR, lightHoles = 0, lightR = 0.15 }) {
  const root = pitchR * 0.9;
  const tip = pitchR * 1.055;
  const step = (Math.PI * 2) / teeth;
  const s = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    if (i === 0) s.moveTo(Math.cos(a) * root, Math.sin(a) * root);
    s.absarc(0, 0, root, a, a + step * 0.42);
    s.absarc(0, 0, tip, a + step * 0.52, a + step * 0.9);
  }
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  s.holes.push(hole);
  for (let i = 0; i < lightHoles; i++) {
    const a = (i / lightHoles) * Math.PI * 2;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * pitchR * 0.55, Math.sin(a) * pitchR * 0.55, pitchR * lightR, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.18,
    bevelSize: thickness * 0.12,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

// 刹车盘：环形 + 周圈钻孔
export function drilledDiscGeometry(rOut, rIn, thickness, holes = 10) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rOut, 0, Math.PI * 2);
  const hub = new THREE.Path();
  hub.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  s.holes.push(hub);
  const holeR = (rOut - rIn) * 0.11;
  const ringR = (rOut + rIn) / 2 + (rOut - rIn) * 0.14;
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * Math.PI * 2;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * ringR, Math.sin(a) * ringR, holeR, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

// 圆角矩形 Shape
export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  return s;
}

// 按 lengthAxis 线性缩放 widthAxis（把挤出体收成锥形，用于整流罩）
// taperByAxis(geo, 'x', 'z', 1.0, 0.45)：沿 x（长度）从 1 到 0.45 缩放 z（宽度）
export function taperByAxis(geo, lengthAxis, widthAxis, from, to) {
  const pos = geo.attributes.position;
  const li = { x: 0, y: 1, z: 2 }[lengthAxis];
  const wi = { x: 0, y: 1, z: 2 }[widthAxis];
  let lMin = Infinity, lMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const l = pos.array[i * 3 + li];
    if (l < lMin) lMin = l;
    if (l > lMax) lMax = l;
  }
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.array[i * 3 + li] - lMin) / (lMax - lMin);
    pos.array[i * 3 + wi] *= from + (to - from) * t;
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

