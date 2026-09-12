// ————— 触屏刹车踏板行程（输入整形，非物理模型）—————
// 报障口径：手机上"点刹车直接刹停"。触屏按钮是 0/1 信号，历史实现把 brakeTarget
// 一键打满（等效于踏板一脚到底）。本模块把"按住时长"整形成踏板行程：
// 按住渐进增压（≈0.33s 到满）、点刹给部分制动、松开快速回弹（≈0.22s 放空）——
// 与真实驾驶"踩多少刹多少"一致。只整形触屏输入通道，不触碰 driving.js 的
// 制动物理数学（摩擦圆/载荷转移口径原样）；键盘通道保持历史瞬时全刹（桌面零回归）。

export const TOUCH_BRAKE = {
  rise: 3.0, // 1/s：踩下增压速率（0→1 约 0.33s，模拟踏板行程）
  fall: 4.5, // 1/s：松开回弹速率（1→0 约 0.22s，模拟踏板回位）
  cut: 6.0,  // 1/s：刹车重叠期收油速率（松油门+踩刹车是连续动作，油门快速泄掉）
};

// 单步推进踏板压力。braking=true 踩下增压，否则回弹；输出钳制在 [0,1]。
export function advanceBrakePressure(pressure, braking, dt) {
  const next = braking ? pressure + TOUCH_BRAKE.rise * dt : pressure - TOUCH_BRAKE.fall * dt;
  return Math.min(1, Math.max(0, next));
}
