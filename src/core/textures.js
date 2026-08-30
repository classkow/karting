import * as THREE from 'three';

// ————— Canvas 程序化纹理工厂 —————
// 所有贴图在运行时生成，构建产物保持单文件、零外部资源。

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, { srgb = false, repeat, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// 灰度高度图 → 法线图（Sobel）
export function heightToNormal(src, strength = 2) {
  const w = src.width;
  const h = src.height;
  const sctx = src.getContext('2d');
  const data = sctx.getImageData(0, 0, w, h).data;
  const height = (x, y) => {
    x = (x + w) % w;
    y = (y + h) % h;
    return data[(y * w + x) * 4] / 255;
  };
  const [out, ctx] = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        (height(x - 1, y - 1) + 2 * height(x - 1, y) + height(x - 1, y + 1) -
         height(x + 1, y - 1) - 2 * height(x + 1, y) - height(x + 1, y + 1)) * strength;
      const dy =
        (height(x - 1, y - 1) + 2 * height(x, y - 1) + height(x + 1, y - 1) -
         height(x - 1, y + 1) - 2 * height(x, y + 1) - height(x + 1, y + 1)) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// 轮胎表面：周向细纹 + 橡胶颗粒噪声 → 法线
let _tireNormal = null;
export function tireNormal() {
  if (_tireNormal) return _tireNormal;
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, S, S);
  // 周向细纹（横向线）
  for (let y = 0; y < S; y += 2) {
    ctx.fillStyle = `rgba(0,0,140,${0.10 + Math.random() * 0.08})`;
    ctx.fillRect(0, y, S, 1);
  }
  // 颗粒噪声
  for (let i = 0; i < 2600; i++) {
    const a = Math.random() * 0.16;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,140,${a})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1);
  }
  _tireNormal = toTexture(heightToNormal(c, 1.6), { repeat: [24, 2] });
  return _tireNormal;
}

// 拉丝金属粗糙度图（水平拉丝 + 噪点）
let _brushed = null;
export function brushedRoughness() {
  if (_brushed) return _brushed;
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = '#6d6d6d';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    const g = 90 + Math.random() * 90;
    ctx.fillStyle = `rgba(${g},${g},${g},0.5)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 30 + Math.random() * 90, 1);
  }
  _brushed = toTexture(c, { repeat: [3, 3] });
  return _brushed;
}

// 碳纤维斜纹
let _carbon = null;
export function carbon() {
  if (_carbon) return _carbon;
  const S = 128;
  const cell = 16;
  const [c, ctx] = makeCanvas(S);
  for (let y = 0; y < S / cell; y++) {
    for (let x = 0; x < S / cell; x++) {
      const horiz = (x + y) % 2 === 0;
      const g = ctx.createLinearGradient(x * cell, y * cell, horiz ? (x + 1) * cell : x * cell, horiz ? y * cell : (y + 1) * cell);
      g.addColorStop(0, '#202226');
      g.addColorStop(0.5, '#3a3d44');
      g.addColorStop(1, '#17181c');
      ctx.fillStyle = g;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  _carbon = toTexture(c, { srgb: true, repeat: [5, 5] });
  return _carbon;
}

// 展示地台：同心环 + 角度刻度 + 中心准星
let _platform = null;
export function platformMap() {
  if (_platform) return _platform;
  const S = 1024;
  const [c, ctx] = makeCanvas(S);
  const base = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  base.addColorStop(0, '#1b2029');
  base.addColorStop(0.75, '#141920');
  base.addColorStop(1, '#0e1218');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  ctx.translate(S / 2, S / 2);
  // 同心环
  for (let r = 60; r < S / 2; r += 74) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(140,170,210,0.055)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // 外圈角度刻度（每 15°）
  const R1 = S / 2 - 26, R2 = S / 2 - 10;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const long = i % 6 === 0;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R1, Math.sin(a) * R1);
    ctx.lineTo(Math.cos(a) * (long ? R2 - 14 : R2), Math.sin(a) * (long ? R2 - 14 : R2));
    ctx.strokeStyle = long ? 'rgba(255,181,71,0.35)' : 'rgba(140,170,210,0.18)';
    ctx.lineWidth = long ? 3 : 2;
    ctx.stroke();
  }
  // 中心准星
  ctx.strokeStyle = 'rgba(255,181,71,0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-26, 0); ctx.lineTo(26, 0);
  ctx.moveTo(0, -26); ctx.lineTo(0, 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 40, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(140,170,210,0.14)';
  ctx.lineWidth = 2;
  ctx.stroke();
  _platform = toTexture(c, { srgb: true });
  return _platform;
}

// 地面粗糙度：细微噪声
let _floorRough = null;
export function floorRoughness() {
  if (_floorRough) return _floorRough;
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    const g = 50 + Math.random() * 60;
    ctx.fillStyle = `rgba(${g},${g},${g},0.35)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  _floorRough = toTexture(c, { repeat: [10, 10] });
  return _floorRough;
}

// 影棚背景：垂直渐变 + 中央光晕（贴在巨大球内侧）
let _backdrop = null;
export function backdrop() {
  if (_backdrop) return _backdrop;
  const [c, ctx] = makeCanvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#05070b');
  g.addColorStop(0.42, '#10161f');
  g.addColorStop(0.58, '#1a2330');
  g.addColorStop(0.75, '#0b0f16');
  g.addColorStop(1, '#040508');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  const glow = ctx.createRadialGradient(512, 300, 0, 512, 300, 420);
  glow.addColorStop(0, 'rgba(96,128,168,0.20)');
  glow.addColorStop(1, 'rgba(96,128,168,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 512);
  _backdrop = toTexture(c, { srgb: true });
  return _backdrop;
}

// 车头号码牌贴图
export function numberPlate(num = '88') {
  const S = 256;
  const [c, ctx] = makeCanvas(S);
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#111418';
  ctx.lineWidth = 14;
  ctx.strokeRect(10, 10, S - 20, S - 20);
  ctx.fillStyle = '#111418';
  ctx.font = `900 ${S * 0.52}px 'Arial Black', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(num, S / 2, S * 0.54);
  return toTexture(c, { srgb: true });
}
