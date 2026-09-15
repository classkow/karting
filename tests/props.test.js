import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackModel } from '../src/sim/track.js';
import { planTrees, TREE_ROAD_MARGIN_M } from '../src/sim/props.js';

const track = createTrackModel();

// §2.5-4：装饰物落位——树木撒点跑一遍，落在路面掩码内的树 = 0。
// 反例基线：09-13 朴素撒点（无路面排除）在坏几何上 32 棵压路面；即便本单几何已修好，
// 朴素撒点在新几何上仍有 28 棵压到相邻腿的路面（树沿法线外推 17–43m 会跨腿）。
// 结构性保险 = planTrees 内置的路面掩码排除（|lat| < halfWidth + 余量 即弃）。
test('装饰物：树木撒点全部落在路面掩码外（|lat| ≥ 半宽）', () => {
  const spots = planTrees(track);
  assert.ok(spots.length > 10, `树数 ${spots.length}（应有一批树）`);
  let onRoad = 0;
  for (const t of spots) {
    const n = track.nearest(t.x, t.z, -1);
    if (Math.abs(n.lat) < track.halfWidth) onRoad++;
  }
  assert.equal(onRoad, 0, `落路面树数=${onRoad}（应 0）`);
});

test('装饰物：树木布点确定性（同种子两次一致，无 Math.random）', () => {
  const a = planTrees(track);
  const b = planTrees(track);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.ok(a[i].x === b[i].x && a[i].z === b[i].z && a[i].s === b[i].s, `第 ${i} 棵不一致`);
  }
});

test('装饰物：路面排除余量为正（半宽 + 余量 > 半宽，留出路面外安全距离）', () => {
  assert.ok(TREE_ROAD_MARGIN_M > 0, `余量=${TREE_ROAD_MARGIN_M}`);
  const spots = planTrees(track);
  for (const t of spots) {
    const n = track.nearest(t.x, t.z, -1);
    assert.ok(Math.abs(n.lat) >= track.halfWidth, `树压路面 lat=${n.lat.toFixed(2)}`);
  }
});
