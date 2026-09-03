# 卡丁车机械原理 · 交互式三维演示

**Kart Mechanics — Interactive 3D Demo**

[English](#english) | 中文

程序化建模的竞赛卡丁车（CIK 比例）三维机构演示页面。基于 Three.js 的纯运行时生成 —— 零模型文件、零图片资源，构建产物为**单文件 HTML，双击即可离线打开**。

## 怎么打开

| 方式 | 操作 | 适用 |
| --- | --- | --- |
| **双击即看** | 双击项目里的 `start.bat`（或直接双击 `dist/index.html`） | 观看 / 分发给别人，无需任何环境 |
| 本地预览 | `npm run build && npm run preview`，访问终端提示地址 | 模拟服务器环境 |
| 二次开发 | `npm install` 后 `npm run dev`，访问终端提示地址 | 修改代码 |
| 单元测试 | `npm test`（Node 内置 runner，零依赖） | 机构数学回归 |
| 静态检查 | `npm run lint`（ESLint flat config，只拦真问题） | 提交前 |
| 冒烟验证 | `npm run smoke`（headless Chrome CDP，零依赖） | 改动后整体回归 |

> 注意：项目根目录的 `index.html` 是**源码入口**，只在 `npm run dev` 下有效，直接双击会看到启动失败提示——这是预期行为，按提示改用 `start.bat` 即可。

## 功能

- **机构演示**：二冲程发动机剖视（曲柄滑块精确解算）、滚子链链传动（链节沿开式包络与齿形链轮严格啮合）、齿轮齿条转向（拉杆按刚杆约束牛顿迭代求解，阿克曼几何自然涌现）、后轴碟刹（踏板-主缸-卡钳联动）。
- **交互**：8 个视角预设、逐级爆炸分解、部件悬停高亮/点击讲解、部件清单（聚焦/隐藏）、转速仪表盘、自动环绕、键盘快捷键（空格启动、W/S 油门、A/D 转向——均可**长按持续输入**、B 刹车、E 爆炸、R 复位、1-8 视角、? 帮助）；小屏设备面板可折叠、帮助页含触屏手势说明。
- **渲染**：IBL 环境光照 + ACES 色调映射 + GTAO/Bloom/描边后期链（可手动切换，持续低帧率时自动降级为直接渲染）、Canvas 程序化贴图（轮胎法线、拉丝金属、碳纤维、地台刻度）、WebAudio 合成引擎声。
- **健壮性**：启动守护（双击源码入口 / 不支持 WebGL2 时给出可操作指引）、localStorage 访问兜底、后期链失败自动降级。

## 结构

```
src/
├─ main.js        薄入口（启动守护后 createApp）
├─ app.js         应用装配与主循环
├─ core/          stage.js 场景舞台 · postfx.js 后期链 · textures.js 程序化贴图
│                 audio.js 引擎音 · fpsGuard.js 帧率统计与自动降级
├─ kart/          builder.js 整车装配 · layout.js 整车尺寸 · registry.js 部件注册表
│  ├─ geometry.js 车床/链轮/刹车盘等几何工具
│  └─ parts/      chassis 车架 · bodywork 覆盖件 · wheels 车轮 · engine 发动机
│                 drivetrain 传动 · steering 转向 · brakes 制动 · cockpit 操纵
├─ sim/           state.js 转速状态机（起动/怠速/油门/传动比） · kinematics.js 机构运动学纯数学（可单测）
├─ interaction/   picking 拾取描边 · explode 爆炸 · cameraRig 相机 · shortcuts 快捷键
├─ ui/            panels.js 面板 · icons.js 图标
└─ scripts/       smoke.mjs 无头冒烟验证（零依赖 CDP，泵帧确定性断言）
```

架构要点：

- 部件通过 `registry.registerPart(group, def)` 注册（名称/系统/说明/爆炸向量）；registry 是**显式实例**（`createRegistry()`），builder/parts/ui/interaction 全部经参数注入，无模块级隐式单例。
- 每帧顺序：`sim.step`（状态机）→ `registry.runUpdates`（各部件更新器写机构位姿，动态件只写 `userData.mechPos`）→ `explode.update`（爆炸位移唯一出口：`position = (mechPos ?? basePos) + dir·t`）→ 渲染。机构位移与爆炸位移不会互相覆盖。
- 运动学（活塞位移、链条包络相位、拉杆角度）全部按机构约束解算，单一事实来源在 `src/sim/kinematics.js`（零渲染依赖，`npm test` 直接断言上下止点、链条切线/包角/链速方向、转向定长约束）。
- 性能：链条走 `InstancedMesh`（约 200 实例）、车架桁架合并为 1 次绘制；悬停射线经 rAF 节流且跳过实例网格；弱 GPU 下后期链持续低于 24fps 自动降级（只作用本次会话）。

## English

Procedurally modeled racing kart (CIK proportions) in interactive 3D — pure runtime generation with Three.js: no model files, no image assets, and the build output is a **single-file HTML that opens offline with a double click**.

Highlights:

- **Mechanisms, not animations**: crank-slider solved analytically, roller chain strictly meshing tooth-shaped sprockets along an open envelope, rack-and-pinion steering with tie rods solved by fixed-length Newton iteration (Ackermann geometry emerges naturally), pedal–master-cylinder–caliper brake linkage.
- **Interaction**: 8 camera presets, progressive exploded view, hover highlight & per-part engineering explainers, tachometer, keyboard driving with **hold-to-steer / hold-throttle** (Space start/stop, W/S throttle, A/D steer, B brake, E explode, R reset, 1–8 presets, ? help).
- **Rendering**: IBL + ACES tone mapping + GTAO/Bloom/outline post chain (auto-degrades on sustained low FPS), canvas-generated textures (tire normals, brushed metal, carbon fiber, platform dial), WebAudio-synthesized engine sound.
- **Engineering quality**: 16 kinematics & state-machine unit tests (`npm test`), zero-dependency headless smoke test with regression cases (`npm run smoke`), ESLint clean, GitHub Actions gate on every push (`.github/workflows/ci.yml`).

## License

[MIT](LICENSE)
