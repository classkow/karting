// ————— 界面格式化单源（K 评审 A-7）—————
// 圈时/总时口径单点化：hud.js 与 trackMenu.js 原先各有一份逐字相同的实现。

export function fmtMs(ms) {
  if (!ms) return '--:--.-';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}
