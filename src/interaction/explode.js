import { allParts, anim } from '../kart/registry.js';

// ————— 爆炸分解 —————
// 部件沿注册的方向向量平移；发动机内部运动件（活塞/连杆）由自身更新器叠加同一位移。

export function initExplode() {
  const state = { current: 0, target: 0 };

  function update(dt) {
    const k = Math.min(1, dt * 4);
    state.current += (state.target - state.current) * k;
    if (Math.abs(state.target - state.current) < 0.0005) state.current = state.target;
    anim.explode = state.current;
    for (const p of allParts()) {
      const g = p.group;
      const base = g.userData.basePos;
      if (!base) continue;
      const [dx, dy, dz] = g.userData.explodeDir;
      const d = g.userData.explodeDist * state.current;
      const n = Math.hypot(dx, dy, dz) || 1;
      g.position.set(base.x + (dx / n) * d, base.y + (dy / n) * d, base.z + (dz / n) * d);
    }
  }

  return {
    update,
    setTarget: (v) => (state.target = v),
    get: () => state.current,
  };
}
