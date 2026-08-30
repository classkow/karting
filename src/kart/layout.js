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
  axleY: 0.145,           // 后轴中心高
  rearTrack: 0.62,        // 后轮中心横向

  wheelF: { r: 0.13, w: 0.125 },   // 前轮 半径/宽
  wheelR: { r: 0.145, w: 0.205 },  // 后轮

  engine: { x: 0.33, y: 0.165, z: -0.20 },  // 曲轴中心（曲轴沿 x 轴，右侧车架内侧）
  crankR: 0.027,          // 曲柄半径（行程 54mm，贴合 125cc 真机 Ø54×54.5）
  rodLen: 0.105,          // 连杆中心距 105mm（真机尺寸）
  chainX: 0.395,          // 链条平面（曲轴链轮与后链轮所在 x）
  clutchR: CLUTCH_R,
  sprocketR: 0.124,       // 后链轮节圆半径（66T）
  chainPitch: (2 * Math.PI * CLUTCH_R) / 12, // 链节距 = 链轮齿距：链节与齿严格啮合

  seatZ: -0.26,
  rackY: 0.125,
  rackZ: 0.34,
};
