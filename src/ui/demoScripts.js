import { VIEWS } from '../interaction/views.js';

// ————— 演示序列脚本（一等数据：时间轴 + 动作 + 字幕定稿）—————
// 每个动作: { t: 秒, view?, steer?, throttle?, explode?, jacking?, scale?, caption? }
// view 值必须是 src/interaction/views.js 的 VIEWS 键名；数值范围同面板滑条。
// 字幕文案为定稿（可改标点不改事实与口径）；caption 为 null/缺省 = 清空字幕。
export const DEMO_SCRIPTS = [
  {
    id: 'crank', label: '曲柄滑块', duration: 32, autoStart: true, actions: [
      { t: 0,  view: 'engine', caption: '这台卡丁车的心脏：一台二冲程发动机。' },
      { t: 4,  caption: '先点火——起动机拖转，然后进入怠速。' },
      { t: 4.2, throttle: 0, caption: null }, // 点火走 autoStart（播放开始时启动引擎）
      { t: 10, throttle: 0.65, caption: '油门给上，注意透明缸套里的活塞。' },
      { t: 15, caption: '活塞上下往复，通过连杆推动曲轴旋转。' },
      { t: 21, caption: '曲柄半径 27 毫米、连杆 105 毫米——行程 54 毫米，和真机一样。' },
      { t: 27, caption: '这就是曲柄滑块机构：把往复运动变成旋转。' },
    ],
  },
  {
    id: 'jacking', label: '无差速为什么能过弯', duration: 38, actions: [
      { t: 0,  view: 'home', caption: '卡丁车的后轴是一根整轴——没有差速器。' },
      { t: 6,  caption: '没有差速器，过弯时内外侧后轮转速必然不同，按理说要互相较劲。' },
      { t: 11, jacking: 1, scale: 8, steer: 1, view: 'jacking', caption: '但你看：打满方向，内侧后轮离地了。' },
      { t: 18, caption: '主销内倾 10 度、后倾 12 度——打方向时，前轮把车架顶起。' },
      { t: 25, caption: '车架没有悬挂，侧倾刚性地传到后轴：内侧后轮被抬离地面。' },
      { t: 31, caption: '离了地的后轮不再较劲——这就是无差速也能过弯的原因。' },
      { t: 37, steer: 0, jacking: 0, caption: '（离地毫米数是真实解算值，8 倍只是教学放大。）' },
    ],
  },
  {
    id: 'ackermann', label: '阿克曼转向', duration: 27, actions: [
      // 任务包原文写 view:'steering'，VIEWS 实际键名为 'steer'（views.js），以实际代码为准
      { t: 0,  view: 'steer', caption: '打方向时，左右前轮的转角并不相同。' },
      { t: 5,  steer: 0.7, caption: '看转向拉杆：齿条横移，推动两只转向节。' },
      { t: 12, caption: '内侧轮转得多，外侧轮转得少——这就是阿克曼几何。' },
      { t: 18, caption: '它让两条轮胎的延长线交汇于同一瞬间中心，轮胎才不打滑。' },
      { t: 24, steer: 0, caption: '这个转角差是机构几何解算出来的，不是摆出来的。' },
    ],
  },
];

// 结构校验：返回问题列表（空数组 = 合法）。播放器装载时自检剔除坏脚本，单测亦独立断言。
// 只查结构与范围，不查文案内容——文案由单测守（每条 ≥3 条非空中文）。
export function validateDemoScript(script) {
  const problems = [];
  const push = (msg) => problems.push(`${script.id ?? '(无 id)'}: ${msg}`);
  if (!script || typeof script !== 'object') return ['脚本必须是对象'];
  if (typeof script.id !== 'string' || !script.id) push('缺少 id');
  if (typeof script.label !== 'string' || !script.label) push('缺少 label');
  if (!Number.isFinite(script.duration) || script.duration <= 0) push(`duration 非法: ${script.duration}`);
  if (!Array.isArray(script.actions) || !script.actions.length) {
    push('actions 必须为非空数组');
    return problems;
  }
  let prevT = -Infinity;
  for (const [i, a] of script.actions.entries()) {
    if (!Number.isFinite(a.t) || a.t < 0) push(`actions[${i}] t 非法: ${a.t}`);
    else if (a.t < prevT) push(`actions[${i}] t=${a.t} 早于上一个动作 t=${prevT}（须按 t 升序）`);
    else prevT = a.t;
    if ('view' in a && !(a.view in VIEWS)) push(`actions[${i}] view 不存在: ${a.view}`);
    for (const k of ['steer', 'throttle']) {
      if (k in a && !(Number.isFinite(a[k]) && a[k] >= -1 && a[k] <= 1)) push(`actions[${i}] ${k} 越界 [-1,1]: ${a[k]}`);
    }
    if ('explode' in a && !(Number.isFinite(a.explode) && a.explode >= 0 && a.explode <= 1)) {
      push(`actions[${i}] explode 越界 [0,1]: ${a.explode}`);
    }
    if ('jacking' in a && a.jacking !== 0 && a.jacking !== 1) push(`actions[${i}] jacking 只允许 0/1: ${a.jacking}`);
    if ('scale' in a && ![1, 4, 8].includes(a.scale)) push(`actions[${i}] scale 只允许 1/4/8: ${a.scale}`);
    if ('caption' in a && a.caption !== null && typeof a.caption !== 'string') push(`actions[${i}] caption 只允许字符串或 null`);
  }
  const lastT = script.actions[script.actions.length - 1]?.t ?? 0;
  if (Number.isFinite(script.duration) && Number.isFinite(lastT) && script.duration < lastT) {
    push(`duration(${script.duration}) < 最后动作 t(${lastT})`);
  }
  return problems;
}
