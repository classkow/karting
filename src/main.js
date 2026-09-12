import { createApp } from './app.js';

// 入口：启动守护在 index.html 的内联脚本中（探测 window.__kart 是否出现）
window.__kart = createApp();

// —— ?debug=1 真机诊断浮层（真机自查清单配套工具，见交付说明）——
// 手机浏览器打开 https://…/?debug=1，屏幕底部常驻三行关键事实（视口/DPR/触摸/
// WebGL2/当前模式/Edge 版本），点一下消失。用于回报「毛玻璃」类真机问题时的取数。
if (new URLSearchParams(location.search).has('debug')) {
  const el = document.createElement('div');
  el.id = 'diag-overlay';
  el.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'bottom:8px',
    'z-index:300', 'background:rgba(5,7,11,.85)', 'color:#9fe08a',
    'font:11px/1.6 Consolas,monospace', 'padding:6px 10px', 'border-radius:6px',
    'pointer-events:auto', 'cursor:pointer', 'max-width:94vw',
    'white-space:pre-wrap', 'text-align:center',
  ].join(';');
  let webgl2 = false;
  try { webgl2 = !!document.createElement('canvas').getContext('webgl2'); } catch { /* 不支持 */ }
  const edgeVer = navigator.userAgent.match(/Edg(?:A|iOS)?\/[\d.]+/) ?? ['非 Edge UA'];
  const update = () => {
    const vv = window.visualViewport ? Math.round(window.visualViewport.height) : innerHeight;
    const mode = window.__kart?.mode ?? 'boot';
    el.textContent = [
      `${innerWidth}x${innerHeight} 可视${vv} @${devicePixelRatio}x`,
      `touch:${'ontouchstart' in window || navigator.maxTouchPoints > 0} webgl2:${webgl2} mode:${mode}`,
      `${edgeVer[0]}`,
    ].join('\n');
  };
  update();
  window.addEventListener('resize', update);
  const timer = setInterval(update, 1000);
  el.addEventListener('click', () => {
    clearInterval(timer);
    el.remove();
  });
  document.body.appendChild(el);
}
