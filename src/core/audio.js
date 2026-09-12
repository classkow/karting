// ————— 引擎音效合成器（WebAudio，全部本地合成，无音频文件）—————
// 音色：锯齿波基频（做功频率）+ 半频方波 + 进气噪声，音高随 rpm。

let ctx = null;
let nodes = null;

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function buildChain() {
  const c = ctx;
  const master = c.createGain();
  master.gain.value = 0;
  master.connect(c.destination);

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 1.4;
  filter.connect(master);

  const osc1 = c.createOscillator(); // 做功频率（二冲程每转点一次火）
  osc1.type = 'sawtooth';
  const g1 = c.createGain();
  g1.gain.value = 0.55;
  osc1.connect(g1).connect(filter);

  const osc2 = c.createOscillator(); // 半频，厚度
  osc2.type = 'square';
  const g2 = c.createGain();
  g2.gain.value = 0.18;
  osc2.connect(g2).connect(filter);

  // 进气/机械噪声
  const noiseBuf = c.createBuffer(1, c.sampleRate * 1.2, c.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = c.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const ng = c.createGain();
  ng.gain.value = 0.05;
  noise.connect(ng).connect(filter);

  osc1.start();
  osc2.start();
  noise.start();
  return { master, filter, osc1, osc2, noise };
}

export function updateEngineAudio({ on, cranking, rpm, throttle, muted }) {
  if (muted || (!on && !cranking)) {
    if (nodes) nodes.master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    return;
  }
  if (!ensureCtx()) return;
  if (!nodes) nodes = buildChain();

  const effRpm = cranking ? Math.max(rpm, 400) : rpm;
  // 基频 = 二冲程每转一点火（rpm/60），但 30Hz 的次声波听不见：
  // 抬 4 次谐波当主音域（120~920Hz），半频方波垫低频厚度，才是能听的"突突"声
  const freq = (effRpm / 60) * 4;
  nodes.osc1.frequency.setTargetAtTime(freq, ctx.currentTime, 0.03);
  nodes.osc2.frequency.setTargetAtTime(freq * 0.5, ctx.currentTime, 0.03);
  nodes.filter.frequency.setTargetAtTime(600 + throttle * 2600 + effRpm * 0.06, ctx.currentTime, 0.05);
  const vol = cranking ? 0.05 : 0.045 + throttle * 0.075;
  nodes.master.gain.setTargetAtTime(vol, ctx.currentTime, 0.06);
}

export function disposeEngineAudio() {
  if (nodes) {
    for (const n of [nodes.osc1, nodes.osc2, nodes.noise]) {
      try { n.stop(); } catch { /* noop */ }
    }
    try { nodes.master.disconnect(); } catch { /* noop */ }
    nodes = null;
  }
  if (ctx) {
    try { ctx.close(); } catch { /* noop */ }
    ctx = null;
  }
}

// ————— 赛道驾驶音效层（轮胎啸叫 / 路肩颠簸 / 风噪 / 倒计时蜂鸣）—————
// 与引擎声共用 AudioContext；全部本地合成，无音频文件。

let driveNodes = null;

function buildDriveChain(c) {
  const master = c.createGain();
  master.gain.value = 0;
  master.connect(c.destination);

  // 轮胎啸叫：白噪 → 窄带通（~900Hz 的高频"吱吱"）
  const screechBuf = c.createBuffer(1, c.sampleRate * 1.2, c.sampleRate);
  {
    const d = screechBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const screech = c.createBufferSource();
  screech.buffer = screechBuf;
  screech.loop = true;
  const scFilter = c.createBiquadFilter();
  scFilter.type = 'bandpass';
  scFilter.frequency.value = 900;
  scFilter.Q.value = 2.2;
  const scGain = c.createGain();
  scGain.gain.value = 0;
  screech.connect(scFilter).connect(scGain).connect(master);
  screech.start();

  // 路肩/草地颠簸：低频方波抖振
  const rumble = c.createOscillator();
  rumble.type = 'square';
  rumble.frequency.value = 34;
  const rumbleGain = c.createGain();
  rumbleGain.gain.value = 0;
  const rumbleLp = c.createBiquadFilter();
  rumbleLp.type = 'lowpass';
  rumbleLp.frequency.value = 160;
  rumble.connect(rumbleLp).connect(rumbleGain).connect(master);
  rumble.start();

  // 风噪：白噪 → 低通，随车速
  const windBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
  {
    const d = windBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // 简单一阶低通白噪，听感偏"呼呼"而非"沙沙"
      last = last * 0.94 + (Math.random() * 2 - 1) * 0.06;
      d[i] = last * 8;
    }
  }
  const wind = c.createBufferSource();
  wind.buffer = windBuf;
  wind.loop = true;
  const windGain = c.createGain();
  windGain.gain.value = 0;
  wind.connect(windGain).connect(master);
  wind.start();

  return { master, scGain, scFilter, rumble, rumbleGain, windGain };
}

// tel: { screech01, kerb01, grass01, speed01 } 全部 0..1
export function updateDrivingAudio({ active, screech01, kerb01, grass01, speed01 }) {
  if (!active) {
    if (driveNodes && ctx) driveNodes.master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
    return;
  }
  if (!ensureCtx()) return;
  if (!driveNodes) driveNodes = buildDriveChain(ctx);
  const t = ctx.currentTime;
  const sc = Math.min(1, screech01) * 0.16;
  driveNodes.scGain.gain.setTargetAtTime(sc, t, 0.06);
  driveNodes.scFilter.frequency.setTargetAtTime(760 + speed01 * 420, t, 0.1);
  const rumble = Math.max(kerb01 * 0.1, grass01 * 0.07) * (0.5 + speed01 * 0.5);
  driveNodes.rumbleGain.gain.setTargetAtTime(rumble, t, 0.05);
  driveNodes.rumble.frequency.setTargetAtTime(30 + speed01 * 26, t, 0.1);
  driveNodes.windGain.gain.setTargetAtTime(speed01 * speed01 * 0.11, t, 0.15);
  driveNodes.master.gain.setTargetAtTime(1, t, 0.05);
}

export function disposeDrivingAudio() {
  if (!driveNodes) return;
  if (ctx) {
    try { driveNodes.screech?.stop(); } catch { /* noop */ }
    try { driveNodes.rumble.stop(); } catch { /* noop */ }
    try { driveNodes.wind.stop(); } catch { /* noop */ }
  }
  try { driveNodes.master.disconnect(); } catch { /* noop */ }
  driveNodes = null;
}

// 倒计时蜂鸣：3 短（880Hz）+ 1 长（1320Hz）
export function playCountBeep(final = false) {
  if (!ensureCtx()) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = final ? 1320 : 880;
  const dur = final ? 0.55 : 0.16;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
