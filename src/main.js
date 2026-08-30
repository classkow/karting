import { createApp } from './app.js';

// 入口：启动守护在 index.html 的内联脚本中（探测 window.__kart 是否出现）
window.__kart = createApp();
