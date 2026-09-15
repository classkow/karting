import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackModel } from '../src/sim/track.js';
import { createDrivingState, resetDrivingState, stepDriving } from '../src/sim/driving.js';
import { createAIController, createAIShell, stepAI, AI_TIERS, AI_TIER_ORDER } from '../src/sim/ai.js';

const lab = createTrackModel({
  points: [[-80, -350], [0, -358], [80, -350], [86, -175], [86, 0], [86, 175], [80, 350], [0, 358], [-80, 350], [-86, 175], [-86, 0], [-86, -175]],
  width: 14,
});

// 完整 AI 场景：sim 壳 + driving 状态 + 控制器，一帧步进
function aiTick(ai, st, shell, dt = 1 / 60) {
  stepAI(ai, st, shell, lab, dt, { launchLock: false });
  stepDriving(st, shell, lab, dt);
}

// 传送车辆并刷新进度追踪（否则 AI 还盯着发车线附近的前瞻点）
function place(st, x, z, yaw = 0, trackModel = lab) {
  st.x = x;
  st.z = z;
  st.yaw = yaw;
  const n = trackModel.nearest(x, z, -1);
  st.s = n.s;
  st.hintIdx = n.idx;
}

test('AI：前方目标在体 +x 侧 → 前轮角为正（yaw 增大转向目标，符号契约）', () => {
  const st = createDrivingState();
  resetDrivingState(st, lab, 0);
  // 车在右侧直道中心，把目标点人为放到体 +x 侧：直接把车横移到中线左侧 −3m，
  // AI 追踪中心线 → 目标在体 +x 侧 → steerAngle 应为正
  place(st, 86 - 3, -300, 0);
  st.vz = 15;
  const ai = createAIController('elite');
  const shell = createAIShell();
  aiTick(ai, st, shell);
  assert.ok(shell.steerAngleL > 0.02, `steerAngleL=${shell.steerAngleL.toFixed(3)}（目标在 +x 侧应为正）`);
});

test('AI：直道上追踪中心线（横向偏差收敛）', () => {
  const st = createDrivingState();
  resetDrivingState(st, lab, 0);
  place(st, 86 - 4, -300, 0);
  const ai = createAIController('elite');
  const shell = createAIShell();
  for (let i = 0; i < 60 * 8; i++) aiTick(ai, st, shell);
  const lat = lab.nearest(st.x, st.z, st.hintIdx).lat;
  assert.ok(Math.abs(lat) < 2.2, `8s 后横向偏差 ${lat.toFixed(2)}m（应收敛到中线附近的小幅振荡内）`);
  assert.ok(st.speed > 20, `速度 ${st.speed.toFixed(1)}（应在推进）`);
});

test('AI：高速接近急弯会制动（前弯限速 < 当前速时输出刹车）', () => {
  // 1:1 复刻赛道：起点线后的起步直道沿 −x（西）行驶，正前方 ≈30m 即 MP1 直角弯
  // （R≈10m，弯速预算 ≈38km/h）——38m/s 冲入必须立刻制动。
  const track = createTrackModel();
  const st = createDrivingState();
  resetDrivingState(st, track, 0);
  // 从起点位姿沿切线方向前进 30m（起点直道上、MP1 弯前）
  const p0 = track.pointAt(track.startPose.s - 30);
  place(st, p0.x, p0.z, p0.yaw, track);
  st.vz = 38; // 直接给高速：38m/s 远超弯道限速且制动距离不足 → 必须立刻刹
  st.speed = 38; // speed 是 stepDriving 的遥测字段，这里手动同步（不经完整物理帧）
  const ai = createAIController('champion');
  const shell = createAIShell();
  for (let i = 0; i < 10; i++) stepAI(ai, st, shell, track, 1 / 60, { launchLock: false }); // 越过 0.06s 起步反应
  assert.ok(shell.brake > 0.3, `brake=${shell.brake.toFixed(2)}（高速临弯应制动）`);
  assert.equal(shell.throttle, 0);
});

test('AI：卡死自救信号（低速 2.5s 触发 wantReset，恢复行驶后清除）', () => {
  const st = createDrivingState();
  resetDrivingState(st, lab, 0);
  const ai = createAIController('elite');
  const shell = createAIShell();
  // 模拟"动力全失"（如被顶出赛道趴窝）：决策照常、但速度恒 0；在 wantReset 首次触发的
  // 那一帧断言（触发后计数即归零，3s 整再读会错过）。
  let fired = false;
  for (let i = 0; i < 60 * 5 && !fired; i++) {
    stepAI(ai, st, shell, lab, 1 / 60, { launchLock: false });
    shell.throttle = 0; // 强制无动力
    stepDriving(st, shell, lab, 1 / 60);
    if (ai.wantReset) fired = true;
  }
  assert.equal(fired, true, `stuckT=${ai.stuckT.toFixed(2)}（2.5s 低速应触发自救信号）`);
  // 恢复动力后信号应清除
  st.vz = 10;
  aiTick(ai, st, shell);
  assert.equal(ai.wantReset, false);
});

test('AI 三档节奏排序：整圈模拟完赛用时 王者 < 精英 < 新锐（真实能力差，无橡皮筋）', () => {
  const lapOf = (tierId) => {
    const st = createDrivingState();
    resetDrivingState(st, lab, 0);
    const ai = createAIController(tierId, 7);
    const shell = createAIShell();
    let t = 0;
    const dt = 1 / 60;
    let lastS = st.s;
    let lapStart = 0;
    let lapTime = 0;
    for (let i = 0; i < 60 * 150; i++) {
      // 训练期：先给它一段热身（模拟从发车开始跑）
      stepAI(ai, st, shell, lab, dt, { launchLock: false });
      stepDriving(st, shell, lab, dt);
      t += dt;
      // 过线检测（s=0 即线）
      const d = st.s - lastS;
      if (d < -lab.length / 2 && t - lapStart > 10) {
        lapTime = t - lapStart;
        break;
      }
      lastS = st.s;
      if (i === 0) lapStart = t;
    }
    return lapTime;
  };
  const tRookie = lapOf('rookie');
  const tElite = lapOf('elite');
  const tChampion = lapOf('champion');
  assert.ok(tRookie > 0 && tElite > 0 && tChampion > 0, `圈时 ${tRookie.toFixed(1)}/${tElite.toFixed(1)}/${tChampion.toFixed(1)}s 应都完赛`);
  assert.ok(tChampion < tElite && tElite < tRookie,
    `圈时应 王者(${tChampion.toFixed(1)}s) < 精英(${tElite.toFixed(1)}s) < 新锐(${tRookie.toFixed(1)}s)`);
  // 新锐慢得可感知（≥8%）；王者在 1752m 试验赛道上平均时速应 >72km/h（有真实威胁）
  assert.ok(tRookie > tChampion * 1.08, `新锐应比王者慢 ≥8%（实际 ${(tRookie / tChampion).toFixed(2)}×）`);
  assert.ok(tChampion < lab.length / 20, `王者单圈 ${tChampion.toFixed(1)}s 应快于均速 20m/s（${(lab.length / 20).toFixed(0)}s）`);
});

test('AI：起步反应延迟分级（ GO 后新锐比王者晚给油）', () => {
  const mk = (tier) => {
    const st = createDrivingState();
    resetDrivingState(st, lab, 0);
    const ai = createAIController(tier);
    const shell = createAIShell();
    for (let i = 0; i < 12; i++) { // GO 后 0.2s
      stepAI(ai, st, shell, lab, 1 / 60, { launchLock: false });
    }
    return shell.throttle;
  };
  const champ = mk('champion');
  const rook = mk('rookie');
  assert.ok(champ > 0.1, `王者 0.2s 内应给油（throttle=${champ.toFixed(2)}）`);
  assert.equal(rook, 0, `新锐 0.2s 内应还在反应（throttle=${rook.toFixed(2)}）`);
});

test('AI：三档参数单调递增（新锐 < 精英 < 王者）', () => {
  for (const k of ['aLat', 'aLong', 'topSpeed', 'lookaheadMin', 'apexOffset', 'steerRate', 'throttleCap']) {
    const [r, e, c] = AI_TIER_ORDER.map((id) => AI_TIERS[id][k]);
    assert.ok(r < e && e < c, `${k}: ${r} < ${e} < ${c} 不成立`);
  }
  for (const k of ['reaction', 'noise']) {
    const [r, e, c] = AI_TIER_ORDER.map((id) => AI_TIERS[id][k]);
    assert.ok(r > e && e > c, `${k}: ${r} > ${e} > ${c} 不成立（应为递减）`);
  }
});

test('AI：切弯偏置取号 = 驾驶员系弯内侧（R03 镜像后 k 语义实证的控制器侧）', () => {
  // 判据链：① k 的符号语义由 tests/track.test.js 钉到纸面平面图（k<0 = 右弯，15 段弯全序列表）；
  // ② lat>0 = 中心线偏车体 +x 一侧 = 驾驶员左（track.js 手性注）；
  // ③ 故「AI 切在弯内侧」⟺ 前瞻目标点偏置后的横向归属 sign(aimLat) = sign(tgt.k)。
  // 注：本判据对手性取反不变（镜像时 lat 与 k 同时反号），它证明的是「镜像后 AI 走线不会
  // 退化成切外弯」；镜像本身由 tests/track.test.js 的纸面序列表把守。
  const track = createTrackModel();
  const cfg = AI_TIERS.champion;
  const bad = [];
  const flag = track.samples.map((sp) => Math.abs(sp.k) > 1 / 32);
  const runs = [];
  let cur = [];
  for (let i = 0; i < flag.length; i++) {
    if (flag[i]) cur.push(i);
    else if (cur.length) { if (cur.length >= 5) runs.push(cur); cur = []; }
  }
  if (cur.length >= 5) runs.push(cur);
  assert.ok(runs.length >= 12, `复刻赛道弯段数 ${runs.length}（应 ≥12）`);
  for (const r of runs) {
    const s0 = track.samples[r[0]].s, s1 = track.samples[r[r.length - 1]].s;
    const sMid = (s0 + s1) / 2;
    const vGuess = Math.sqrt(cfg.aLat / Math.abs(track.pointAt(sMid).k)); // 弯中稳态车速量级
    const look = Math.min(22, Math.max(cfg.lookaheadMin, cfg.lookaheadMin + vGuess * cfg.lookaheadGain));
    const tgt = track.pointAt(sMid + look);
    const off = cfg.apexOffset * Math.min(1, Math.abs(tgt.k) * 30);
    if (off < 0.2) continue; // 该前瞻点几乎不偏置（出弯直道），不参与判号
    const ax = tgt.x + tgt.tz * Math.sign(tgt.k) * off;
    const az = tgt.z - tgt.tx * Math.sign(tgt.k) * off;
    const aimLat = track.nearest(ax, az, -1).lat;
    if (Math.sign(aimLat) !== Math.sign(tgt.k)) {
      bad.push(`弯 s=${s0.toFixed(0)}~${s1.toFixed(0)}：tgt.k=${tgt.k.toFixed(3)} 但偏置后 lat=${aimLat.toFixed(2)}（切到弯外侧）`);
    }
  }
  assert.deepEqual(bad, [], '王者组每个弯的切弯偏置必须落在该弯内侧');
});

test('AI：镜像后王者组在 1:1 复刻赛道完整一圈不冲出路面（走线闭环回归）', () => {
  const track = createTrackModel();
  const st = createDrivingState();
  resetDrivingState(st, track, 0);
  const ai = createAIController('champion', 7);
  const shell = createAIShell();
  const dt = 1 / 60;
  let lastS = st.s;
  let maxLat = 0;
  let lapTime = 0;
  let finished = false;
  for (let i = 0; i < 60 * 160 && !finished; i++) {
    stepAI(ai, st, shell, track, dt, { launchLock: false });
    stepDriving(st, shell, track, dt);
    maxLat = Math.max(maxLat, Math.abs(st.lat));
    if (st.s - lastS < -track.length / 2) finished = true;
    lastS = st.s;
    lapTime += dt;
  }
  assert.ok(finished, '王者组应在 160s 内完成一圈');
  // 圈时上界推导：857m ÷ 均速 ≥6.1m/s（AI 实测均速 ≈10.9m/s，此处取 1.8 倍宽容带）= 140s
  assert.ok(lapTime < 140, `圈时 ${lapTime.toFixed(1)}s 应 < 140s`);
  assert.ok(maxLat < track.halfWidth, `全程最大横向偏移 ${maxLat.toFixed(2)}m 应 < 半宽 ${track.halfWidth}m（不冲出沥青）`);
});

test('AI 三档在 1:1 复刻赛道（含发卡）整圈节奏排序：王者 < 精英 < 新锐', () => {
  // 变更背景：复刻赛道含 R≈4.4m 发卡，调参前王者组以 2 倍弯速预算冲出弯心
  // （圈时 108.3s 慢于精英 102.2s，单调性反向——红记录见交付说明）；修复
  // （制动预算折扣 + 发卡弯速裕度 + 近段加密扫描）后单调性成立。
  const track = createTrackModel();
  const lapOf = (tierId) => {
    const st = createDrivingState();
    resetDrivingState(st, track, 0);
    const ai = createAIController(tierId, 7);
    const shell = createAIShell();
    let t = 0;
    const dt = 1 / 60;
    let lastS = st.s;
    let lapStart = 0;
    let lapTime = 0;
    for (let i = 0; i < 60 * 300; i++) {
      stepAI(ai, st, shell, track, dt, { launchLock: false });
      stepDriving(st, shell, track, dt);
      t += dt;
      const d = st.s - lastS;
      if (d < -track.length / 2 && t - lapStart > 10) {
        lapTime = t - lapStart;
        break;
      }
      lastS = st.s;
      if (i === 0) lapStart = t;
    }
    return lapTime;
  };
  const tRookie = lapOf('rookie');
  const tElite = lapOf('elite');
  const tChampion = lapOf('champion');
  assert.ok(tRookie > 0 && tElite > 0 && tChampion > 0, `圈时 ${tRookie.toFixed(1)}/${tElite.toFixed(1)}/${tChampion.toFixed(1)}s 应都完赛`);
  assert.ok(tChampion < tElite && tElite < tRookie,
    `圈时应 王者(${tChampion.toFixed(1)}s) < 精英(${tElite.toFixed(1)}s) < 新锐(${tRookie.toFixed(1)}s)`);
});

