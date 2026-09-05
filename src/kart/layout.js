// ————— 整车布局常量（单位：米，接近 CIK 竞赛卡丁车真实比例）—————
// 坐标系：x 向右，y 向上，z 向车头

const CLUTCH_R = 0.0224; // 曲轴链轮节圆半径（12T）

export const L = {
  platformY: 0.02,        // 展示台面高度（车体 y 基准）
  frameY: 0.098,          // 主纵梁中心高
  railX: 0.29,            // 主纵梁半距
  frontAxleZ: 0.52,       // 前轴
  rearAxleZ: -0.53,       // 后轴
  kingpinX: 0.585,        // 主销横向
  kingpinY: 0.135,
  kingpinKPI: (10 * Math.PI) / 180,    // 主销内倾（正视上端向内）
  kingpinCaster: (12 * Math.PI) / 180, // 主销后倾（侧视上端向后）
  kingpinScrub: 0.015,    // 主销延线触地点到胎面中心的横向距（CIK 量级）
  kingpinTrail: 0.02,     // 纵向拖距（接地点在主销延线触地点之后）
  axleY: 0.145,           // 后轴中心高
  rearTrack: 0.62,        // 后轮中心横向

  wheelF: { r: 0.13, w: 0.125 },   // 前轮 半径/宽
  wheelR: { r: 0.145, w: 0.205 },  // 后轮

  engine: { x: 0.33, y: 0.165, z: -0.20 },  // 曲轴中心（曲轴沿 x 轴，右侧车架内侧）
  crankR: 0.027,          // 曲柄半径（行程 54mm，贴合 125cc 真机 Ø54×54.5）
  rodLen: 0.105,          // 连杆中心距 105mm（真机尺寸）
  chainX: 0.395,          // 链条平面（曲轴链轮与后链轮所在 x）
  clutchR: CLUTCH_R,
  // 后链轮节圆半径按齿比精确取 66/12 倍：链节距在两个链轮上严格一致（真啮合），减速比恰为 5.5
  sprocketR: CLUTCH_R * (66 / 12),
  chainPitch: (2 * Math.PI * CLUTCH_R) / 12, // 链节距 = 链轮齿距：链节与齿严格啮合

  seatZ: -0.26,
  rackY: 0.125,
  rackZ: 0.34,

  // 转向器几何（齿轮齿条 → 转向臂 → 拉杆），可行域注释见文末 tieRodLen 处
  steering: {
    arm: 0.22,         // 转向臂长（指向车尾）
    armY: 0.002,       // 转向臂高（近轴高度）
    armIn: 0.182,      // 转向臂内倾量（梯形布置 → 阿克曼几何）
    rackHalf: 0.30,    // 齿条端球铰横向距离
    rackTravel: 0.062, // 齿条全行程（单侧）
    pinionR: 0.021,    // 小齿轮节圆半径
  },
};

// 转向三值可行域被两侧夹死，收紧任一侧即无解（按 layout 尺寸实测推得）：
// ① 球铰/臂身/拉杆退出前轮轮胎包络：臂身只能从轮辋桶外缘(ρ=0.0832)与胎圈(ρ=0.091)之间的
//    开口穿过 → 斜率 arm/armIn ≲ 1.21，且 armY 越大臂身越早贴上轮辋桶（故取近轴高度）；
// ② 内轮侧拉杆不得进入死点：|主销→臂端| + 拉杆定长 ≥ |主销→齿条端|max(0.394)，即臂端须落在
//    以主销与齿条端为焦点的椭圆之外 → 斜率 ≲1.21 时臂端总长须 ≥ 0.28m。
// 两式的交角即上述取值（改前 arm=0.13/armIn=0.034 的臂身斜率 3.8，只能穿胎而过）。

// 拉杆定长（直行位）：齿条端球铰到转向臂端球铰的装配距离。
// steering.js 装配与转向单测都从本函数取值——改上面任何几何，拉杆长自动跟随，杜绝手抄漂移。
export function tieRodLen(sign) {
  const armEndX = sign * (L.kingpinX - L.steering.armIn);
  const armEndY = L.kingpinY + L.steering.armY;
  const armEndZ = L.frontAxleZ - L.steering.arm;
  const rackEndX = sign * L.steering.rackHalf;
  return Math.hypot(armEndX - rackEndX, armEndY - L.rackY, armEndZ - L.rackZ);
}
