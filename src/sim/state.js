import { L } from '../kart/layout.js';

// ————— 仿真状态机 —————
// 起动流程：起动机拖转(0.9s) → 点火成功 → 怠速，油门响应；
// 传动比与车轮转速在这里统一结算，各部件更新器只读取。

const IDLE = 1800;
const MAX_RPM = 13800;
// 蹄块式离心离合器接合转速（engine.js 说明文案"约 4000 rpm"以本常量为准）
export const CLUTCH_ENGAGE_RPM = 4000;
const RATIO = L.clutchR / L.sprocketR; // 12T / 66T ≈ 0.182
const WHEEL_R = L.wheelR.r;
const VISUAL_SLOW = 0.2;   // 视觉降速（机构演示用）
const VISUAL_CAP = 150;    // 高转速下的视觉角速度上限（避免频闪）

export function createSim() {
  const s = {
    engineOn: false,
    cranking: 0,
    throttle: 0,
    steer: 0,
    steerSmooth: 0,
    brakeTarget: 0,
    brake: 0,
    rpm: 0,
    omega: 0,
    axleOmega: 0,
    wheelOmega: 0,
    crankAngle: 0,
    chainPhase: 0,
    speedKmh: 0,
    time: 0,
  };

  s.startEngine = () => {
    if (!s.engineOn && s.cranking <= 0) s.cranking = 0.9;
  };
  s.stopEngine = () => {
    s.engineOn = false;
    s.cranking = 0; // 拖转中熄火即中止起动，否则倒计时结束仍会点火
  };
  s.toggleEngine = () => {
    if (s.engineOn || s.cranking > 0) s.stopEngine();
    else s.startEngine();
    return s.engineOn || s.cranking > 0;
  };

  s.step = (dt) => {
    s.time += dt;

    if (s.cranking > 0) {
      // 起动机拖转：低转速带抖动，随后点火
      s.cranking -= dt;
      const target = 420 + Math.sin(s.time * 30) * 130;
      s.rpm += (target - s.rpm) * Math.min(1, dt * 8);
      if (s.cranking <= 0) s.engineOn = true;
    } else if (s.engineOn) {
      // 怠速波动 + 油门响应
      const wobble = 1 + Math.sin(s.time * 11) * 0.012 + Math.sin(s.time * 4.7) * 0.008;
      const target = (IDLE + s.throttle * (MAX_RPM - IDLE)) * wobble;
      const rate = target > s.rpm ? 3.4 : 2.0;
      s.rpm += (target - s.rpm) * Math.min(1, dt * rate);
    } else {
      s.rpm += (0 - s.rpm) * Math.min(1, dt * 1.6);
      if (s.rpm < 5) s.rpm = 0;
    }

    const omegaReal = (s.rpm / 60) * Math.PI * 2;
    s.omega = Math.min(omegaReal * VISUAL_SLOW, VISUAL_CAP);
    s.axleOmega = s.omega * RATIO;
    s.wheelOmega = s.axleOmega; // 后轮与后轴同转速
    s.crankAngle = (s.crankAngle + s.omega * dt) % (Math.PI * 2);
    // 链条相位（弧长米数）在这里统一推进：链速 = 曲轴角速度 × 曲轴链轮节圆半径；
    // pointAt 内部自行回绕，drivetrain 只读
    s.chainPhase += s.omega * L.clutchR * dt;

    // 理论车速（按真实转速折算，非视觉降速值）
    s.speedKmh = s.rpm > 200 ? omegaReal * RATIO * WHEEL_R * 3.6 : 0;

    s.steerSmooth += (s.steer - s.steerSmooth) * Math.min(1, dt * 7);
    s.brake += (s.brakeTarget - s.brake) * Math.min(1, dt * 10);
  };

  return s;
}
