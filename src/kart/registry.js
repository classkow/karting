// ————— 部件注册表 —————
// 每个部件：{ id, name, system, desc, specs, group, visible, explodeDir, explodeDist }
// 每帧动画通过 addUpdate 注册的更新器驱动。

export const SYSTEMS = [
  { id: 'chassis', label: '车架车身', color: '#e0564f' },
  { id: 'wheels', label: '车轮', color: '#aeb8c6' },
  { id: 'steering', label: '转向系统', color: '#4cc2ff' },
  { id: 'engine', label: '动力系统', color: '#ffb547' },
  { id: 'drivetrain', label: '传动系统', color: '#c9a24b' },
  { id: 'brakes', label: '制动系统', color: '#ff5d5d' },
  { id: 'cockpit', label: '操纵与油路', color: '#8fd460' },
];

export const systemMeta = (id) => SYSTEMS.find((s) => s.id === id) ?? { label: id, color: '#888' };

const parts = new Map();
const updaters = [];

export function registerPart(group, def) {
  const part = { ...def, group, visible: true };
  group.userData.partId = def.id;
  group.userData.explodeDir = def.explodeDir ?? [0, 1, 0];
  group.userData.explodeDist = def.explodeDist ?? 0.6;
  parts.set(def.id, part);
  return part;
}

export function getPart(id) {
  return parts.get(id);
}

export function allParts() {
  return [...parts.values()];
}

export function partsOfSystem(system) {
  return allParts().filter((p) => p.system === system);
}

export function addUpdate(fn) {
  updaters.push(fn);
}

export function runUpdates(dt, s) {
  for (const fn of updaters) fn(dt, s);
}

// 全局动画量（供部件更新器与爆炸模块共享）
export const anim = { explode: 0 };

const _off = { x: 0, y: 0, z: 0 };

// 计算部件在当前爆炸系数下的位移偏置（写入传入对象并返回）
export function explodeOffset(group, out = _off) {
  const d = group.userData.explodeDir;
  const dist = (group.userData.explodeDist ?? 0.6) * anim.explode;
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  out.x = (d[0] / n) * dist;
  out.y = (d[1] / n) * dist;
  out.z = (d[2] / n) * dist;
  return out;
}

