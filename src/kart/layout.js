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

  crankR: 0.027,          // 曲柄半径（行程 54mm）
  rodLen: 0.105,          // 连杆中心距 105mm（真机尺寸）

  engine: {
    x: 0.33, y: 0.165, z: -0.20,  // 曲轴中心（曲轴沿 x 轴，右侧车架内侧）

    // ————— 二冲程换气循环规格常量（任务包 §四，单一事实来源）—————
    // 缸径/正时/压缩比为真机 125cc 竞赛机口径；视觉几何（活塞 Ø96/缸套 Ø104）是
    // 径向可视性放大（§五.6）：容积比 ≡ 气柱高度比，屏幕上的压缩比仍是真值。
    bore: 0.054,            // 实际缸径 54mm（视觉 Ø96/Ø104 勿用于容积）
    exhaustOpenATDC: 85,    // 排气口开：85°ATDC（= 95°BBDC），上缘 +0.128850
    transferOpenATDC: 125,  // 扫气口开：125°ATDC（= 55°BBDC），上缘 +0.112158
    CR_trapped: 13.5,       // 扫气口关闭位起算的压缩比（真机 13–14.5）
    CR_cc: 1.45,            // 曲轴箱一次压缩比（真机 1.35–1.6）
    reedFn: 700,            // 簧片阀固有频率 Hz（唯一依赖真实时间的量，显示跟视觉时钟）
    chamberY: 0.345,        // 膨胀室轴线绝对高度
    chamberZ0: -0.10,       // 膨胀室喉口绝对 z
    headerRel: [[0.075, 0.005, 0.120], [0.115, 0.15, 0.11]], // header 前两点（相对曲轴中心偏移；首点已下移进排气窗口带 z∈[0.1122,0.1289]，§三.1）
    chamberProfile: [       // 膨胀室母线 [半径, 轴向]，轴向 0 = 喉口
      [0.026, 0], [0.03, 0.05], [0.046, 0.13], [0.06, 0.21], [0.062, 0.26],
      [0.05, 0.33], [0.03, 0.40], [0.021, 0.45], [0.020, 0.48],
    ],
  },

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
