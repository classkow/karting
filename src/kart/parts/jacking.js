import * as THREE from 'three';
import { L } from '../layout.js';
import { solveChassisPose } from '../../sim/kinematics.js';

// ————— 主销举升（jacking effect）：簧载组姿态驱动 —————
// 真实物理：四轮贴地，倾斜主销在转向时把"车架"顶起；内侧后轮离地 =
// 后轴（刚连车架）随车架滚转被带走。整车（含四轮视觉件）挂在 sprung 下，
// 本更新器把解算姿态整体写到 sprung 上——内侧后轮因此 visually 离地。
//
// 信誉红线：姿态全部来自 solveChassisPose 解算，禁止预烘焙/假位移；
// s.jackingScale 只做教学放大（放大显示姿态），面板毫米读数永远报真实值。
//
// 注册时机必须在 buildSteering 之后（registry 按注册序执行）：本更新器读转向
// 更新器写入的 s.steerAngleL/R（同一帧内先解转角、再解姿态，零帧滞后）。

const GEOM = {
  trackF: 2 * L.kingpinX,
  trackR: 2 * L.rearTrack,
  wheelbase: L.frontAxleZ - L.rearAxleZ,
  kpiGeom: { kpi: L.kingpinKPI, caster: L.kingpinCaster, scrub: L.kingpinScrub, trail: L.kingpinTrail },
};

const _e = new THREE.Euler();

export function buildJacking(sprung, reg) {
  reg.addUpdate((dt, s) => {
    const pose = solveChassisPose(s.steerAngleL, s.steerAngleR, GEOM);
    // 面板读数：真实解算值（不乘放大系数），取内侧（离地侧）
    s.jackingLiftMM = Math.max(pose.rearLiftL, pose.rearLiftR) * 1000;

    // sprung 基准姿态恒等，每帧全量覆写、不累积；关闭时 k=0 覆写回恒等
    const k = s.jackingDemo ? s.jackingScale : 0;
    // 平面约定 Δy = heave − roll·x + pitch·z（kinematics.js），
    // 小角度下对应 Euler(x=−pitch, z=−roll)
    _e.set(-pose.pitch * k, 0, -pose.roll * k);
    sprung.quaternion.setFromEuler(_e);
    sprung.position.y = pose.heave * k;
  });
}
