// ————— F1 制式五配方轮胎（纯数据 + 依赖注入式应用函数，零渲染依赖可 node --test 直测）—————
// 识别语言照搬 F1 轮胎涂装：胎侧彩色标识环（光头胎胎面无沟槽，配方全靠环带色区分）。
// 本期五配方纯外观——不改抓地/磨损参数（物理差异化若要做另开单），因此本模块只带
// id/中文名/色值三个字段，刻意不放 grip 系数，防止"外观数据"被误当物理单源消费。
// 应用函数对传入的环带材质数组逐个写色：真实链路传共享单例 [M.tireBand]，
// 4 轮 8 侧环带一次改色全局同步；测试注入 4 个替身材质验证同步语义。

export const TIRE_COMPOUNDS = [
  { id: 'soft', name: '软胎', hex: '#e0332b' },
  { id: 'medium', name: '中性胎', hex: '#f2c12e' },
  { id: 'hard', name: '硬胎', hex: '#f2f2f2' },
  { id: 'intermediate', name: '半雨胎', hex: '#43b04a' },
  { id: 'wet', name: '全雨胎', hex: '#2a6fe0' },
];

// 默认中性胎（黄）：软胎红与默认红车身撞色，出厂观感必须一眼可辨"这是胎不是漆"。
export const TIRE_DEFAULT = 'medium';

// 按 id 取配方；未知 id（存储被外部污染）回落默认配方，渲染链路永不 undefined。
export function tireCompound(id) {
  return TIRE_COMPOUNDS.find((c) => c.id === id)
    ?? TIRE_COMPOUNDS.find((c) => c.id === TIRE_DEFAULT);
}

export function applyTireCompound(materials, compound) {
  for (const m of materials) m.color.set(compound.hex);
}
