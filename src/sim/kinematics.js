// ————— 机构运动学（纯数学，零渲染依赖，可用 node --test 直接断言）—————
// 本文件是引擎/传动/转向三处机构解的单一事实来源。

// 曲柄滑块：活塞相对曲轴回转中心的轴向位移
// s(θ) = R·sinθ + √(L² − R²·cos²θ)，θ=π/2 时到达上止点
export function pistonStroke(theta, crankR, rodLen) {
  const c = crankR * Math.cos(theta);
  return crankR * Math.sin(theta) + Math.sqrt(rodLen * rodLen - c * c);
}

// 链条包络：两圆（轴线沿 x，位于 y-z 平面）之间的闭合路径（外公切线 + 两侧包弧）
// c1/c2 = { y, z, r }
export function chainPath(c1, c2) {
  const dz = c2.z - c1.z;
  const dy = c2.y - c1.y;
  const dist = Math.hypot(dz, dy);
  const phi = Math.atan2(dy, dz);
  const alpha = Math.acos((c2.r - c1.r) / dist);
  const aS1 = phi + alpha;   // 小轮上切点角
  const aS2 = phi - alpha;
  const spanS = ((aS2 - aS1) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const aL1 = aS1 + Math.PI;
  const aL2 = aS2 + Math.PI;
  const spanL = ((aL2 - aL1) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const segLen = Math.hypot(
    c2.z + c2.r * Math.cos(aL1) - (c1.z + c1.r * Math.cos(aS1)),
    c2.y + c2.r * Math.sin(aL1) - (c1.y + c1.r * Math.sin(aS1))
  );
  const total = segLen + c2.r * spanL + segLen + c1.r * spanS;

  function pointAt(sIn) {
    let s = ((sIn % total) + total) % total;
    if (s < segLen) {
      const t = s / segLen;
      return {
        z: c1.z + c1.r * Math.cos(aS1) + t * (c2.z + c2.r * Math.cos(aL1) - c1.z - c1.r * Math.cos(aS1)),
        y: c1.y + c1.r * Math.sin(aS1) + t * (c2.y + c2.r * Math.sin(aL1) - c1.y - c1.r * Math.sin(aS1)),
      };
    }
    s -= segLen;
    if (s < c2.r * spanL) {
      const a = aL1 + s / c2.r;
      return { z: c2.z + c2.r * Math.cos(a), y: c2.y + c2.r * Math.sin(a) };
    }
    s -= c2.r * spanL;
    if (s < segLen) {
      const t = s / segLen;
      return {
        z: c2.z + c2.r * Math.cos(aL2) + t * (c1.z + c1.r * Math.cos(aS2) - c2.z - c2.r * Math.cos(aL2)),
        y: c2.y + c2.r * Math.sin(aL2) + t * (c1.y + c1.r * Math.sin(aS2) - c2.y - c2.r * Math.sin(aL2)),
      };
    }
    s -= segLen;
    const a = aS2 + s / c1.r;
    return { z: c1.z + c1.r * Math.cos(a), y: c1.y + c1.r * Math.sin(a) };
  }

  return { total, pointAt };
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
