// ————— 赛道装饰物布点（纯数学，零渲染依赖，可 node --test 直接断言）—————
// 树木撒点由中心线法线派生；关键：路面掩码排除——任何候选点若落入任一条腿的路面
// （到最近中心线横向距离 |lat| < halfWidth + 余量）即弃，防止几何修复后仍有树压到相邻腿的路。
// 确定性伪随机（lcg），与截图/冒烟可复现口径一致（AGENTS.md §4：不引入 Math.random）。

const TREE_STEP = 6;        // 每隔 N 个采样点尝试种一棵
const TREE_START_KEEP = 18; // 起点线前后留空（米）
const TREE_ROAD_MARGIN = 3; // 路面排除余量（米）：|lat| < halfWidth + 该值 → 判为落路面，弃

function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

// 返回 [{ x, z, s }]：世界坐标树位与缩放。seed 决定散列，可复现。
export function planTrees(track, seed = 20260912) {
  const rand = lcg(seed);
  const S = track.samples;
  const spots = [];
  for (let i = 0; i < S.length; i += TREE_STEP) {
    if (Math.abs(track.signedDelta(S[i].s - track.startPose.s)) < TREE_START_KEEP) continue;
    if (rand() > 0.55) continue;
    const side = rand() > 0.5 ? 1 : -1;
    const dist = track.halfWidth + 11 + rand() * 26;
    const sp = S[i];
    const x = sp.x + sp.tz * side * dist + (rand() - 0.5) * 6;
    const z = sp.z - sp.tx * side * dist + (rand() - 0.5) * 6;
    const s = 0.75 + rand() * 0.8;
    // 路面掩码排除：候选点若在任何一条腿的路面（含路肩缓冲）内则弃
    const n = track.nearest(x, z, -1);
    if (Math.abs(n.lat) < track.halfWidth + TREE_ROAD_MARGIN) continue;
    spots.push({ x, z, s });
  }
  return spots;
}

export const TREE_ROAD_MARGIN_M = TREE_ROAD_MARGIN;
