import * as THREE from 'three';
import { asphaltMap, grassMap, kerbMap, checkerMap, skyMap, bannerMap } from './textures.js';
import { planTrees } from '../sim/props.js';

// ————— 赛道世界：路面 / 路肩 / 起点龙门架 / 轮胎墙 / 树木 / 天空 —————
// 与展台（stage.js 的 showroom 组）互斥显示：进赛道 → 赛道世界可见、展台隐藏。
// 所有贴图运行时生成（textures.js），保持单文件、零外部资源。

const KERB_K = 1 / 32;    // 曲率阈值（半径 <32m 的弯道两侧铺路肩）
const TIRE_K = 1 / 40;    // 轮胎墙阈值（半径 <40m 的弯道外侧垒轮胎）

// 确定性伪随机（截图/冒烟可复现，不用 Math.random）
function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

// 中心线带状网格：samples 的 [i0, i1) 区段（可回绕），左右偏移 offA/offB（米，沿行进右法线，
// 负值 = 左侧），y 为铺装高度，vScale = 每米弧长的贴图 v 重复数。
function ribbonGeometry(track, i0, i1, offA, offB, y, vScale) {
  const n = i1 - i0;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  const norm = new Float32Array((n + 1) * 2 * 3);
  const idx = [];
  const S = track.samples;
  for (let j = 0; j <= n; j++) {
    const sp = S[(i0 + j) % S.length];
    const nx = sp.tz;  // 行进右侧法线
    const nz = -sp.tx;
    const ax = sp.x + nx * offA;
    const az = sp.z + nz * offA;
    const bx = sp.x + nx * offB;
    const bz = sp.z + nz * offB;
    const v = sp.s * vScale;
    pos.set([ax, y, az, bx, y, bz], j * 6);
    uv.set([0, v, 1, v], j * 4);
    norm.set([0, 1, 0, 0, 1, 0], j * 6);
    if (j < n) {
      const r = j * 2;
      // 绕序保证法线朝上：(A, A', B) 与 (B, A', B')——右×前 = +y（此前 A,B,A' 朝下不可见）
      idx.push(r, r + 2, r + 1, r + 1, r + 2, r + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geo.setIndex(idx);
  return geo;
}

// 高曲率区段（首尾回绕合并，最小长度 minRun）
function curvatureRuns(track, kThreshold, minRun = 5) {
  const S = track.samples;
  const n = S.length;
  const flag = S.map((sp) => Math.abs(sp.k) > kThreshold);
  // 找一个非弯起点，避免回绕段被切成两截
  let head = flag.findIndex((f) => !f);
  if (head < 0) head = 0;
  const runs = [];
  let run = [];
  for (let j = 0; j < n; j++) {
    const i = (head + j) % n;
    if (flag[i]) run.push(i);
    else if (run.length) {
      if (run.length >= minRun) runs.push(run);
      run = [];
    }
  }
  if (run.length >= minRun) runs.push(run);
  return runs;
}

export function buildTrackScene(track) {
  const group = new THREE.Group();
  group.name = 'track-world';
  const rand = lcg(20260912);

  // —— 天空球（不参与雾，远处地平线由贴图渐变收束）——
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, 32, 18),
    new THREE.MeshBasicMaterial({ map: skyMap(), side: THREE.BackSide, fog: false })
  );
  group.add(sky);

  // —— 草地大地面 ——
  const grassTex = grassMap();
  grassTex.repeat.set(150, 150);
  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(400, 64),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0, envMapIntensity: 0.5 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  grass.receiveShadow = true;
  group.add(grass);

  // —— 沥青路面（全周 ribbon，y=0 与车轮接地面一致）——
  const road = new THREE.Mesh(
    ribbonGeometry(track, 0, track.samples.length, -track.halfWidth, track.halfWidth, 0.01, 0.25),
    new THREE.MeshStandardMaterial({ map: asphaltMap(), roughness: 0.94, metalness: 0, envMapIntensity: 0.35 })
  );
  road.receiveShadow = true;
  group.add(road);

  // —— 路肩（弯道两侧红白条纹，微凸 2cm）——
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbMap(), roughness: 0.62, metalness: 0.04, envMapIntensity: 0.45 });
  for (const run of curvatureRuns(track, KERB_K)) {
    for (const side of [-1, 1]) {
      const inner = side * (track.halfWidth - 0.06);
      const outer = side * (track.halfWidth + 1.15);
      const mesh = new THREE.Mesh(
        ribbonGeometry(track, run[0], run[0] + run.length, Math.min(inner, outer), Math.max(inner, outer), 0.028, 0.5),
        kerbMat
      );
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // —— 起点线 + 龙门架（局部系：+z = 行进方向，+x = 行进右侧）——
  const startG = new THREE.Group();
  startG.position.set(track.startPose.x, 0, track.startPose.z);
  startG.rotation.y = track.startPose.yaw;

  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(track.width, 1.8),
    new THREE.MeshStandardMaterial({ map: checkerMap(), roughness: 0.8, envMapIntensity: 0.3 })
  );
  // 格子 ≈0.5m：u = 路宽/0.5/8 格，v = 1.8/0.5/8 格
  {
    const uv = startLine.geometry.attributes.uv;
    const su = track.width / 0.5 / 8;
    const sv = 1.8 / 0.5 / 8;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.y = 0.022;
  startG.add(startLine);

  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a313c, roughness: 0.5, metalness: 0.6 });
  const postGeo = new THREE.BoxGeometry(0.28, 5.6, 0.28);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(side * (track.halfWidth + 1.0), 2.8, 0);
    post.castShadow = true;
    startG.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(track.width + 2.3, 0.5, 0.3), postMat);
  beam.position.y = 5.35;
  beam.castShadow = true;
  startG.add(beam);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(track.width + 2.2, 1.0),
    new THREE.MeshBasicMaterial({ map: bannerMap(), side: THREE.DoubleSide })
  );
  banner.position.y = 4.75;
  banner.rotation.y = Math.PI; // 正面朝来车方向（背面给过线后的车手看，镜像无碍）
  startG.add(banner);
  group.add(startG);

  // —— 轮胎墙：弯道外侧垒轮胎（InstancedMesh）——
  {
    const spots = [];
    for (const run of curvatureRuns(track, TIRE_K, 4)) {
      for (let j = 0; j < run.length; j += 3) {
        const sp = track.samples[run[j]];
        const side = sp.k > 0 ? -1 : 1; // 弯向外侧（k>0 右弯 → 外侧在左）
        spots.push({ x: sp.x + sp.tz * side * (track.halfWidth + 2.1), z: sp.z - sp.tx * side * (track.halfWidth + 2.1), a: rand() * Math.PI });
      }
    }
    if (spots.length) {
      const tireGeo = new THREE.TorusGeometry(0.42, 0.16, 8, 14);
      const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.92, envMapIntensity: 0.4 });
      const tires = new THREE.InstancedMesh(tireGeo, tireMat, spots.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      spots.forEach((s, i) => {
        e.set(Math.PI / 2, 0, s.a);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(s.x, 0.17, s.z), q, new THREE.Vector3(1, 1, 1));
        tires.setMatrixAt(i, m4);
      });
      tires.castShadow = true;
      tires.instanceMatrix.needsUpdate = true;
      group.add(tires);
    }
  }

  // —— 树木：树干 + 双层锥形树冠（InstancedMesh × 2，散在缓冲区外）——
  // 布点（含路面掩码排除、确定性 lcg）委托给纯数学 sim/props.js，可 node --test 断言。
  {
    const spots = planTrees(track);
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 7);
    trunkGeo.translate(0, 1.1, 0);
    const crownGeo = new THREE.ConeGeometry(1.7, 3.6, 8);
    crownGeo.translate(0, 3.6, 0);
    const crown2Geo = new THREE.ConeGeometry(1.25, 2.6, 8);
    crown2Geo.translate(0, 5.4, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x3d5c2e, roughness: 0.95 });
    const crown2Mat = new THREE.MeshStandardMaterial({ color: 0x476b35, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
    const crowns2 = new THREE.InstancedMesh(crown2Geo, crown2Mat, spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m4.compose(new THREE.Vector3(s.x, -0.05, s.z), new THREE.Quaternion(), new THREE.Vector3(s.s, s.s, s.s));
      trunks.setMatrixAt(i, m4);
      crowns.setMatrixAt(i, m4);
      crowns2.setMatrixAt(i, m4);
    });
    for (const im of [trunks, crowns, crowns2]) {
      im.castShadow = true;
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    }
  }

  return group;
}
