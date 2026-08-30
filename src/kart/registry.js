// ————— 部件注册表 —————
// 每个部件：{ id, name, system, desc, specs, group, visible, explodeDir, explodeDist }
// 每帧动画通过 addUpdate 注册的更新器驱动。
//
// 爆炸位移的单一事实来源在 interaction/explode.js：
// 部件 position 一律由 explode 模块写（mechPos ?? basePos + 爆炸偏移），
// 动态件（活塞/连杆/拉杆）的更新器只写 userData.mechPos，静态件不写任何位置。

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

export function createRegistry() {
  const parts = new Map();
  const updaters = [];

  return {
    // 全局动画量（爆炸系数，explode 模块写，部件更新器可读）
    anim: { explode: 0 },

    registerPart(group, def) {
      const part = { ...def, group, visible: true };
      group.userData.partId = def.id;
      group.userData.explodeDir = def.explodeDir ?? [0, 1, 0];
      group.userData.explodeDist = def.explodeDist ?? 0.6;
      parts.set(def.id, part);
      return part;
    },

    getPart(id) {
      return parts.get(id);
    },

    allParts() {
      return [...parts.values()];
    },

    partsOfSystem(system) {
      return [...parts.values()].filter((p) => p.system === system);
    },

    addUpdate(fn) {
      updaters.push(fn);
    },

    runUpdates(dt, s) {
      for (const fn of updaters) fn(dt, s);
    },
  };
}
