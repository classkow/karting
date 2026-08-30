import * as THREE from 'three';
import { tireNormal, brushedRoughness, carbon } from '../core/textures.js';

// ————— PBR 材质库 —————
// 以 MeshPhysicalMaterial 为主，配合环境光照（IBL）呈现金属/车漆/橡胶质感。

const brushed = brushedRoughness();

export const M = {
  // 铬钼钢车架管（清漆防护层）
  frameTube: new THREE.MeshPhysicalMaterial({
    color: 0xc9d0d9, metalness: 1.0, roughness: 0.22,
    clearcoat: 0.55, clearcoatRoughness: 0.25, envMapIntensity: 1.15,
  }),
  // 阳极氧化铝合金（轮毂/支座）
  alloy: new THREE.MeshPhysicalMaterial({
    color: 0x878e98, metalness: 0.92, roughness: 0.34,
    roughnessMap: brushed, envMapIntensity: 1.0,
  }),
  // 亮铝（机加工件）
  alu: new THREE.MeshPhysicalMaterial({
    color: 0xc4cad2, metalness: 1.0, roughness: 0.24,
    roughnessMap: brushed, envMapIntensity: 1.1,
  }),
  // 深灰铸造铝（曲轴箱）
  castAlu: new THREE.MeshPhysicalMaterial({
    color: 0x727a85, metalness: 0.85, roughness: 0.46,
    roughnessMap: brushed, envMapIntensity: 1.0,
  }),
  // 抛光钢
  steel: new THREE.MeshPhysicalMaterial({ color: 0xb7bec7, metalness: 1.0, roughness: 0.3, envMapIntensity: 1.1 }),
  // 镀铬
  chrome: new THREE.MeshPhysicalMaterial({ color: 0xe4e9ee, metalness: 1.0, roughness: 0.09, envMapIntensity: 1.3 }),
  // 锌金色（链轮）
  zinc: new THREE.MeshPhysicalMaterial({ color: 0xb9903e, metalness: 0.95, roughness: 0.34, envMapIntensity: 1.0 }),
  // 链条钢（微暗，与链轮区分）
  chainSteel: new THREE.MeshPhysicalMaterial({ color: 0x878c93, metalness: 1.0, roughness: 0.42, envMapIntensity: 0.9 }),
  // 赛车红车漆（透明罩光）
  paintRed: new THREE.MeshPhysicalMaterial({
    color: 0xb61e2c, metalness: 0.12, roughness: 0.32,
    clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.0,
  }),
  // 哑光工程塑料（黑色护杠）
  plastic: new THREE.MeshPhysicalMaterial({
    color: 0x191b1f, metalness: 0.05, roughness: 0.52,
    clearcoat: 0.3, clearcoatRoughness: 0.5,
  }),
  // 轮胎橡胶
  rubber: new THREE.MeshPhysicalMaterial({
    color: 0x17181b, metalness: 0.0, roughness: 0.78,
    normalMap: tireNormal(), normalScale: new THREE.Vector2(0.55, 0.55),
    sheen: 0.25, sheenRoughness: 0.9, sheenColor: new THREE.Color(0x404448), envMapIntensity: 0.55,
  }),
  // 碳纤维（底板）
  carbon: new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: carbon(), metalness: 0.25, roughness: 0.34,
    clearcoat: 0.9, clearcoatRoughness: 0.18, envMapIntensity: 0.9,
  }),
  // 玻璃钢座椅（红）
  grp: new THREE.MeshPhysicalMaterial({
    color: 0xa81e2a, metalness: 0.05, roughness: 0.4,
    clearcoat: 0.7, clearcoatRoughness: 0.22,
  }),
  // 座垫织物的深色
  fabric: new THREE.MeshPhysicalMaterial({ color: 0x1d2024, roughness: 0.94, metalness: 0.0, sheen: 0.4, sheenColor: new THREE.Color(0x30343a) }),
  // 剖视气缸（透射玻璃）
  linerGlass: new THREE.MeshPhysicalMaterial({
    color: 0xd9ecf7, metalness: 0.0, roughness: 0.06,
    transmission: 1.0, thickness: 0.004, ior: 1.45,
    side: THREE.DoubleSide, envMapIntensity: 1.2,
  }),
  // 火花塞陶瓷
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf2efe8, metalness: 0.0, roughness: 0.28, clearcoat: 0.6 }),
  // 刹车盘
  brakeDisc: new THREE.MeshPhysicalMaterial({ color: 0x9aa0a8, metalness: 1.0, roughness: 0.42, envMapIntensity: 0.95 }),
  // 金黄铜（轴衬）
  brass: new THREE.MeshPhysicalMaterial({ color: 0xc9a24b, metalness: 1.0, roughness: 0.32 }),
};
