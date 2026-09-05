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

// ————— 主销几何举升（kingpin jacking）—————
// 主销并非竖直：内倾 KPI（正视上端向内）+ 后倾 caster（侧视上端向后）。
// 前轮绕该斜轴偏转时，接地点画出的空间弧的最低点在直行位之下——接地点想往地面以下钻，
// 地面不让，于是车架被顶起；刚性车架（无悬挂）把滚转经后轴传出，内侧后轮被抬离地面。
// 这就是无差速器卡丁车能顺利过弯的真正原因：内侧后轮卸载后内外轮速差不再较劲。

// 主销轴单位向量（指向上端）。合成：先绕 x 转 −caster、再绕 z 转 sign·KPI。
// 右手系下绕 +x 正转把 +y 带向 +z（车头），故"上端向后（−z）"取 −caster；
// 左轮 sign=−1 时上端 x 分量为 +（向内），右轮镜像。返回 [ux, uy, uz]。
export function kingpinAxis({ kpi, caster, side }) {
  return [
    -side * Math.cos(caster) * Math.sin(kpi),
    Math.cos(caster) * Math.cos(kpi),
    -Math.sin(caster),
  ];
}

// 单个前轮绕倾斜主销转 a 后，接地点相对直行位的下沉量（正值 = 想往地面以下钻）。
// 接地点相对主销延线触地点的水平偏移 r = [side·scrub, 0, −trail]
//（scrub：胎面中心在触地点外侧；trail：接地点在触地点后方，z 向车头故取负）。
// Rodrigues 旋转（与 THREE.applyAxisAngle 同右手系约定），drop = r_y − r'_y。
export function kingpinDrop(a, { u, scrub, trail, side }) {
  const rx = side * scrub;
  const rz = -trail;
  const [ux, uy, uz] = u;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const crossY = uz * rx - ux * rz; // (u×r) 的 y 分量
  const dot = ux * rx + uz * rz;    // u·r（r_y = 0）
  const ry = crossY * s + uy * dot * (1 - c);
  return -ry + 0; // +0 归一 IEEE 负零（a=0 时调用方做严格相等断言）
}

// 整车姿态解：左右前轮转向角 → 车架刚体三自由度（heave/roll/pitch，小角度线化，
// 姿态角 <2° 完全成立）。支撑点 = 左前 + 右前 + 外侧后轮接地点，三点定平面
// h(x,z) = heave − roll·x + pitch·z 使三点贴地；内侧后轮处平面高度即离地量。
// 软过渡：t = clamp01(离地量 / 2mm)，姿态与离地量同乘 t——滑块微动时姿态不跳变。
// a<0 为左转（前轮指向 −x），左转外侧 = 右后轮；直行（和为 0）时任意，取右后。
export function solveChassisPose(aL, aR, geom) {
  const { trackF, trackR, wheelbase, kpiGeom } = geom;
  const dL = kingpinDrop(aL, { u: kingpinAxis({ ...kpiGeom, side: -1 }), ...kpiGeom, side: -1 });
  const dR = kingpinDrop(aR, { u: kingpinAxis({ ...kpiGeom, side: 1 }), ...kpiGeom, side: 1 });
  const zF = wheelbase / 2;
  const zR = -wheelbase / 2;
  const xOuter = aL + aR <= 0 ? trackR / 2 : -trackR / 2;
  const xInner = -xOuter;

  const roll = (dL - dR) / trackF;
  const pitch = ((dL + dR) / 2 - roll * xOuter) / wheelbase;
  const heave = (dL + dR) / 2 - pitch * zF;

  const liftAt = (x) => heave - roll * x + pitch * zR;
  const t = Math.min(1, Math.max(0, liftAt(xInner) / 0.002));
  if (t === 0) return { heave: 0, roll: 0, pitch: 0, rearLiftL: 0, rearLiftR: 0 }; // 未离地 → 恒等（顺带归一 -0）
  return {
    heave: heave * t,
    roll: roll * t,
    pitch: pitch * t,
    rearLiftL: liftAt(-trackR / 2) * t,
    rearLiftR: liftAt(trackR / 2) * t,
  };
}
