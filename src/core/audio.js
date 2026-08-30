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
  return { master, filter, osc1, osc2 };
}

export function updateEngineAudio({ on, cranking, rpm, throttle, muted }) {
  if (muted || (!on && !cranking)) {
    if (nodes) nodes.master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    return;
  }
  if (!ensureCtx()) return;
  if (!nodes) nodes = buildChain();

  const effRpm = cranking ? Math.max(rpm, 400) : rpm;
  const freq = (effRpm / 60) * 1.0; // 单缸二冲程：每转一响
  nodes.osc1.frequency.setTargetAtTime(freq, ctx.currentTime, 0.03);
  nodes.osc2.frequency.setTargetAtTime(freq * 0.5, ctx.currentTime, 0.03);
  nodes.filter.frequency.setTargetAtTime(300 + throttle * 2600 + effRpm * 0.06, ctx.currentTime, 0.05);
  const vol = cranking ? 0.05 : 0.045 + throttle * 0.075;
  nodes.master.gain.setTargetAtTime(vol, ctx.currentTime, 0.06);
}

export function disposeEngineAudio() {
  if (nodes) {
    try { nodes.master.disconnect(); } catch { /* noop */ }
    nodes = null;
  }
}
