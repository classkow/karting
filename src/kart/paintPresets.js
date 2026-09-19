// ————— 喷漆预设色板（纯数据 + 依赖注入式应用函数，零渲染依赖可 node --test 直测）—————
// 为什么只做预设不做取色器：产品口径是"简洁优先"，赛车常见涂装色预置 9 档已覆盖
// 展示需求；取色器会把"改漆"引向无约束色域，与展台的机械讲解定位无关。
// 应用函数只写 material.color——真实链路传入共享的 M.paintRed：所有车漆消费面
// （整流罩/侧箱/刹车踏板/燃油管/卡钳/车手服与盔顶）共用该实例，改一处全局生效。
// 色值刻意与路肩红（#c33 系）、UI 强调橙（#ffb547）、轮胎五配方色拉开区分度。

export const PAINT_PRESETS = [
  { id: 'red', name: '赛车红', hex: '#b61e2c' }, // 默认漆（= materials.js paintRed 原色）
  { id: 'blue', name: '竞速蓝', hex: '#1f4fd8' },
  { id: 'green', name: '荧光绿', hex: '#57d61f' },
  { id: 'orange', name: '亮橙', hex: '#ff7a1a' },
  { id: 'silver', name: '钛银', hex: '#b9c1cb' },
  { id: 'white', name: '珠光白', hex: '#eef0ee' },
  { id: 'black', name: '哑黑', hex: '#26292e' },
  { id: 'yellow', name: '柠檬黄', hex: '#e8d31f' },
  { id: 'purple', name: '竞速紫', hex: '#7a3fd1' },
];

export const PAINT_DEFAULT = 'red';

// 按 id 取预设；未知 id（存储被外部污染）回落默认色，保证渲染链路永不 undefined。
export function paintPreset(id) {
  return PAINT_PRESETS.find((p) => p.id === id) ?? PAINT_PRESETS.find((p) => p.id === PAINT_DEFAULT);
}

// 应用：只写 color，不动清漆/金属度等漆面质感参数（materials.js 的定义才是质感单源）。
export function applyPaintPreset(material, preset) {
  material.color.set(preset.hex);
}
