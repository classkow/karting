import * as THREE from 'three';

// ————— 几何构建工具 —————

export const UP = new THREE.Vector3(0, 1, 0);

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
export function frameTubes(nodes, edges, radius, mat, radial = 14) {
  const g = new THREE.Group();
  const P = nodes.map((n) => new THREE.Vector3(...n));
  for (const [i, j] of edges) g.add(cylBetween(P[i], P[j], radius, mat, radial));
  const jointGeo = new THREE.SphereGeometry(radius * 1.18, radial, radial / 2);
  const seen = new Set();
  for (const [i, j] of edges) {
    for (const k of [i, j]) {
      if (seen.has(k)) continue;
      seen.add(k);
      const s = new THREE.Mesh(jointGeo, mat);
      s.position.copy(P[k]);
      g.add(s);
    }
  }
  return g;
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

// 沿 Shape 轮廓挤出（含倒角），深度沿 +z，居中
export function extrudeShape(shape, depth, { bevel = depth * 0.18, curveSegments = 16 } = {}) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments,
  });
  geo.translate(0, 0, -depth / 2 - (bevel > 0 ? 0 : 0));
  return geo;
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

// 链条包络：两圆（轴线沿 x，位于 y-z 平面）之间的闭合路径
// c1 = 曲轴小链轮（z, y, r），c2 = 后轴大链轮
export function chainPath(c1, c2) {
  const dz = c2.z - c1.z;
  const dy = c2.y - c1.y;
  const dist = Math.hypot(dz, dy);
  const phi = Math.atan2(dy, dz);
  const alpha = Math.acos((c2.r - c1.r) / dist);
  const aS1 = phi + alpha;   // 小轮上切点角
  const aS2 = phi - alpha;
  const spanS = ((aS2 - aS1) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const aL1 = aS1 + Math.PI;
  const aL2 = aS2 + Math.PI;
  const spanL = ((aL2 - aL1) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const segLen = Math.hypot(
    c2.z + c2.r * Math.cos(aL1) - (c1.z + c1.r * Math.cos(aS1)),
    c2.y + c2.r * Math.sin(aL1) - (c1.y + c1.r * Math.sin(aS1))
  );
  const total = segLen + c2.r * spanL + segLen + c1.r * spanS;

  function pointAt(sIn) {
    let s = ((sIn % total) + total) % total;
    if (s < segLen) {
      const t = s / segLen;
      return {
        z: c1.z + c1.r * Math.cos(aS1) + t * (c2.z + c2.r * Math.cos(aL1) - c1.z - c1.r * Math.cos(aS1)),
        y: c1.y + c1.r * Math.sin(aS1) + t * (c2.y + c2.r * Math.sin(aL1) - c1.y - c1.r * Math.sin(aS1)),
      };
    }
    s -= segLen;
    if (s < c2.r * spanL) {
      const a = aL1 + s / c2.r;
      return { z: c2.z + c2.r * Math.cos(a), y: c2.y + c2.r * Math.sin(a) };
    }
    s -= c2.r * spanL;
    if (s < segLen) {
      const t = s / segLen;
      return {
        z: c2.z + c2.r * Math.cos(aL2) + t * (c1.z + c1.r * Math.cos(aS2) - c2.z - c2.r * Math.cos(aL2)),
        y: c2.y + c2.r * Math.sin(aL2) + t * (c1.y + c1.r * Math.sin(aS2) - c2.y - c2.r * Math.sin(aL2)),
      };
    }
    s -= segLen;
    const a = aS2 + s / c1.r;
    return { z: c1.z + c1.r * Math.cos(a), y: c1.y + c1.r * Math.sin(a) };
  }

  return { total, pointAt };
}
