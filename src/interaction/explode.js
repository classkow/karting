import * as THREE from 'three';

// ————— 爆炸分解 —————
// 部件位移的单一事实来源：每帧 position = (mechPos ?? basePos) + dir · dist · t。
// - basePos：静态件的装配位（builder 装配后记录）
// - mechPos：动态件（活塞/连杆/拉杆）由自身更新器每帧写入的机构位姿（不含爆炸偏移）
// 主循环顺序必须 runUpdates → explode.update：动态件位置零帧滞后。

const _off = new THREE.Vector3();

export function initExplode(registry) {
  const state = { current: 0, target: 0 };

  function update(dt) {
    const k = Math.min(1, dt * 4);
    state.current += (state.target - state.current) * k;
    if (Math.abs(state.target - state.current) < 0.0005) state.current = state.target;
    for (const p of registry.allParts()) {
      const g = p.group;
      const base = g.userData.mechPos ?? g.userData.basePos;
      if (!base) continue;
      const [dx, dy, dz] = g.userData.explodeDir;
      const d = g.userData.explodeDist * state.current;
      const n = Math.hypot(dx, dy, dz) || 1;
      _off.set((dx / n) * d, (dy / n) * d, (dz / n) * d);
      g.position.set(base.x + _off.x, base.y + _off.y, base.z + _off.z);
    }
  }

  return {
    update,
    setTarget: (v) => (state.target = v),
    get: () => state.current,
  };
}
