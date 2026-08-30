import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { platformMap, floorRoughness, backdrop } from './textures.js';

// ————— 舞台：渲染器 / 影棚灯光 / 地台 / 背景 —————

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0e15, 0.05);

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 80);
  camera.position.set(4.3, 2.0, 4.4); // 开场从远处推进（首帧即可看清整车）

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.28, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.35;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.autoRotateSpeed = 0.9;

  // 环境光照用完即弃：IBL 贴图和 PMREM 资源不留 GPU 里
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0.65;
  envScene.dispose();
  pmrem.dispose();

  // 三点布光：暖主光（投影）/ 冷辅光 / 逆光轮廓
  const key = new THREE.DirectionalLight(0xfff1dd, 3.2);
  key.position.set(3.4, 5.4, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.015;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.7);
  fill.position.set(-4.5, 2.6, -1.5);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xdfeaff, 1.6);
  rim.position.set(-1.6, 3.2, -5.0);
  scene.add(rim);

  scene.add(new THREE.HemisphereLight(0x9db4d0, 0x11141a, 0.5));

  // 影棚背景球（渐变 + 中央光晕）
  const backdropSphere = new THREE.Mesh(
    new THREE.SphereGeometry(34, 32, 20),
    new THREE.MeshBasicMaterial({ map: backdrop(), side: THREE.BackSide, fog: false })
  );
  scene.add(backdropSphere);

  // 地面（微反光深色地坪）
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(16, 64),
    new THREE.MeshStandardMaterial({
      color: 0x0c0e12, roughness: 0.42, metalness: 0.06,
      roughnessMap: floorRoughness(), envMapIntensity: 0.55,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 展示转台（同心刻度地台）
  const topMat = new THREE.MeshStandardMaterial({
    map: platformMap(), roughness: 0.3, metalness: 0.16, envMapIntensity: 0.85,
  });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.5, metalness: 0.3 });
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.42, 1.46, 0.04, 96),
    [sideMat, topMat, sideMat]
  );
  platform.position.y = -0.001;
  platform.receiveShadow = true;
  scene.add(platform);

  function setSize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  return { renderer, scene, camera, controls, setSize, key };
}
