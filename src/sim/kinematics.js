// ————— 机构运动学（纯数学，零渲染依赖，可用 node --test 直接断言）—————
// 本文件是引擎/传动/转向三处机构解的单一事实来源。

// 曲柄滑块：活塞相对曲轴回转中心的轴向位移
// s(θ) = R·sinθ + √(L² − R²·cos²θ)，θ=π/2 时到达上止点
export function pistonStroke(theta, crankR, rodLen) {
  const c = crankR * Math.cos(theta);
  return crankR * Math.sin(theta) + Math.sqrt(rodLen * rodLen - c * c);
}

// 链条包络：开式链传动两链轮（轴线沿 x，位于 y-z 平面）的闭合路径（外公切线 + 两侧包弧）
// c1/c2 = { y, z, r }。角度约定：点 = c + r·(cos a, sin a)，a 自 +z 轴向 +y 量取。
//
// 几何要点（曾在此穿帮，勿回退）：
// - 两个切点在两轮上共享同一法线方向 t = phi ± beta（开式带的真外公切线），
//   而不是把大轮切点取作小轮切点的对径点（那是交叉带的构造）。
// - 大轮包角 = 2β（>π），小轮包角 = 2π−2β（<π）。
// - 包弧沿"a 减小"方向遍历：rotation.x 正转使轮上点 a 减小，链节因此与链轮同向啮合。
// 返回 { total, pointAt, segLen, wrap }，pointAt 按弧长参数化。
export function chainPath(c1, c2) {
  const dz = c2.z - c1.z;
  const dy = c2.y - c1.y;
  const dist = Math.hypot(dz, dy);
  const phi = Math.atan2(dy, dz);
  // beta = 切点法线与中心连线的夹角；cos β = −(r2−r1)/d，钳制防浮点越界
  const beta = Math.acos(Math.max(-1, Math.min(1, -(c2.r - c1.r) / dist)));
  const t1 = phi + beta; // 切点法线方向 1（两侧共享）
  const t2 = phi - beta; // 切点法线方向 2
  const arc2 = 2 * beta; // c2 包弧（弧度）
  const arc1 = Math.PI * 2 - arc2; // c1 包弧

  const p1c1 = { z: c1.z + c1.r * Math.cos(t1), y: c1.y + c1.r * Math.sin(t1) };
  const p1c2 = { z: c2.z + c2.r * Math.cos(t1), y: c2.y + c2.r * Math.sin(t1) };
  const p2c1 = { z: c1.z + c1.r * Math.cos(t2), y: c1.y + c1.r * Math.sin(t2) };
  const p2c2 = { z: c2.z + c2.r * Math.cos(t2), y: c2.y + c2.r * Math.sin(t2) };
  const segLen = Math.hypot(p1c2.z - p1c1.z, p1c2.y - p1c1.y); // = √(d² − (r2−r1)²)
  const total = segLen + c2.r * arc2 + segLen + c1.r * arc1;

  function pointAt(sIn) {
    let s = ((sIn % total) + total) % total;
    // 直段 1：c1@t1 → c2@t1
    if (s < segLen) {
      const t = s / segLen;
      return { z: p1c1.z + (p1c2.z - p1c1.z) * t, y: p1c1.y + (p1c2.y - p1c1.y) * t };
    }
    s -= segLen;
    // c2 包弧：t1 → t2，沿角度减小方向（与链轮正转同向）
    if (s < c2.r * arc2) {
      const a = t1 - s / c2.r;
      return { z: c2.z + c2.r * Math.cos(a), y: c2.y + c2.r * Math.sin(a) };
    }
    s -= c2.r * arc2;
    // 直段 2：c2@t2 → c1@t2
    if (s < segLen) {
      const t = s / segLen;
      return { z: p2c2.z + (p2c1.z - p2c2.z) * t, y: p2c2.y + (p2c1.y - p2c2.y) * t };
    }
    s -= segLen;
    // c1 包弧：t2 → t1，沿角度减小方向
    const a = t2 - s / c1.r;
    return { z: c1.z + c1.r * Math.cos(a), y: c1.y + c1.r * Math.sin(a) };
  }

  return { total, pointAt, segLen, wrap: { c1: arc1, c2: arc2 } };
}

// 转向梯形刚杆约束：求转向角 a，使 |armEnd(a) − rackEnd| = rodLen。
// 牛顿迭代（a0 暖启动）；armEnd = pivot + Ry(a)·(vx, armY, vz)。
// 返回钳制在 ±clamp 弧度内的解。
export function solveSteeringAngle({ vx, vz, armY, rodLen, pivot, rackEnd, a0 = 0, iters = 6, clamp = 0.62 }) {
  let a = a0;
  for (let it = 0; it < iters; it++) {
    const ex = pivot.x + vx * Math.cos(a) + vz * Math.sin(a);
    const ez = pivot.z - vx * Math.sin(a) + vz * Math.cos(a);
    const dx = ex - rackEnd.x;
    const dy = pivot.y + armY - rackEnd.y;
    const dz = ez - rackEnd.z;
    const f = dx * dx + dy * dy + dz * dz - rodLen * rodLen;
    const df = 2 * (dx * (-vx * Math.sin(a) + vz * Math.cos(a)) + dz * (-vx * Math.cos(a) - vz * Math.sin(a)));
    if (Math.abs(df) < 1e-8) break;
    a -= f / df;
  }
  return Math.max(-clamp, Math.min(clamp, a));
}
