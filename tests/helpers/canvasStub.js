// ————— node 侧 canvas 替身（测试基础设施，非用例）—————
// kart/materials.js 在模块作用域调用 core/textures.js 的纹理工厂（document.createElement('canvas')），
// 想在 node 里装配真实部件（断言座椅壳的材质归属、胎侧环带与胎体的包络关系）就得先补一层最小 DOM。
// 目标只有两个：不抛异常、产出可构造的 CanvasTexture。像素内容对几何/材质断言无意义，
// 因此未知的 2D 接口一律吞成 no-op；读数接口返回真实零值缓冲（法线图求解等循环照常跑完）。

const MAX_PIXELS = 1024 * 1024; // 纹理工厂最大 1024×512，留一倍余量，防替身被误用时吃满内存

function buffer(w, h) {
  const width = Math.max(0, Math.trunc(Number(w)) || 0);
  const height = Math.max(0, Math.trunc(Number(h)) || 0);
  const n = Math.min(width * height, MAX_PIXELS);
  return { width, height, data: new Uint8ClampedArray(n * 4) };
}

function context2d(canvas) {
  const sink = () => undefined;
  const impl = {
    canvas,
    getImageData: (_x, _y, w, h) => buffer(w, h),
    createImageData: (w, h) => buffer(w, h),
    putImageData: sink,
    createLinearGradient: () => ({ addColorStop: sink }),
    createRadialGradient: () => ({ addColorStop: sink }),
    createConicGradient: () => ({ addColorStop: sink }),
    createPattern: () => ({ setTransform: sink }),
    measureText: () => ({
      width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0,
    }),
    getLineDash: () => [],
  };
  return new Proxy(impl, {
    get: (t, k) => (k in t ? t[k] : sink),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

function canvasStub() {
  const el = { width: 0, height: 0, style: {} };
  el.getContext = (kind) => (kind === '2d' ? context2d(el) : null);
  el.toDataURL = () => 'data:,';
  return el;
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: (tag) => (String(tag).toLowerCase() === 'canvas' ? canvasStub() : { style: {} }),
  };
}
