# 卡丁车机械原理 · 交互式三维演示

**Kart Mechanics — Interactive 3D Demo**

[English](#english) | 中文

程序化建模的竞赛卡丁车（CIK 比例）三维机构演示页面。基于 Three.js 的纯运行时生成 —— 零模型文件、零图片资源，构建产物为**单文件 HTML，双击即可离线打开**。

## 怎么打开

| 方式 | 操作 | 适用 |
| --- | --- | --- |
| **在线试玩** | 打开 https://classkow.github.io/karting/ | 手机/电脑直接玩，无需下载 |
| **双击即看** | 双击项目里的 `start.bat`（或直接双击 `dist/index.html`） | 观看 / 分发给别人，无需任何环境 |
| 本地预览 | `npm run build && npm run preview`，访问终端提示地址 | 模拟服务器环境 |
| 二次开发 | `npm install` 后 `npm run dev`，访问终端提示地址 | 修改代码 |
| 单元测试 | `npm test`（Node 内置 runner，零依赖） | 机构数学回归 |
| 静态检查 | `npm run lint`（ESLint flat config，只拦真问题） | 提交前 |
| 冒烟验证 | `npm run smoke`（headless Chrome CDP，零依赖） | 改动后整体回归 |

> 注意：项目根目录的 `index.html` 是**源码入口**，只在 `npm run dev` 下有效，直接双击会看到启动失败提示——这是预期行为，按提示改用 `start.bat` 即可。

## 功能

- **赛道驾驶（跑跑卡丁车式）**：点顶栏「🏁 上赛道」出模式菜单。
  - **多车比赛**：与 3 名电脑对手跑 3 圈，双排发车格玩家末位起步，实时位次（P2/4）与 LAP x/3，冲线出结算面板。AI 与玩家跑**同一套物理**（不作弊），三档难度——**新锐组 / 精英组 / 王者组**——差距全部来自真实圈速能力（弯中加速度上限、极速、前瞻与切弯、起步反应、操作稳定性依次递增，无橡皮筋），车与车有碰撞可以卡位。
  - **单车练习**：独自跑圈计时热身，不限圈数。
  - 追逐·远 / 追逐·近 / 座舱三种视角（V 键切换），速度越快 FOV 越张，轮胎打滑有啸叫、路肩草地会颠簸。物理按真车口径：离心离合器 4000 转才接合（起步转速喘振可见）、125cc 二冲程直驱扭矩曲线、无差速器、单后碟刹（弯前刹不住会推头）、Shift 漂移甩尾 + 出弯 BOOST、冲出路面草地重罚、软墙兜底。HUD：圈速/上次/最佳（最佳圈存浏览器）、迷你转速条、小地图、逆行警告；触屏设备自动出现转向/刹车/漂移按钮 + 自动油门。
- **机构演示**：二冲程发动机剖视（曲柄滑块精确解算）、滚子链链传动（链节沿开式包络与齿形链轮严格啮合）、齿轮齿条转向（拉杆按刚杆约束牛顿迭代求解，阿克曼几何自然涌现）、后轴碟刹（踏板-主缸-卡钳联动）、主销举升效应（内倾/后倾主销 + 刚性车架解算车架姿态，打满方向时内侧后轮真实离地，毫米读数为真实解算值，教学放大有明示）、二冲程换气循环（气口正时几何反解、曲轴箱扫气泵、簧片阀压差开合、压力波管外光环可视化，配正时圆盘与 P-V 示功环）。
- **交互**：赛道/展台双模式；展台 9 个视角预设、逐级爆炸分解、部件悬停高亮/点击讲解、部件清单（聚焦/隐藏）、转速仪表盘、自动环绕、键盘快捷键（空格启动、W/S 油门、A/D 转向——均可**长按持续输入**、B 刹车、E 爆炸、R 复位、C 换气慢放、1-8 视角、? 帮助）；小屏设备面板可折叠、帮助页含触屏手势说明。
- **渲染**：IBL 环境光照 + ACES 色调映射 + GTAO/Bloom/描边后期链（可手动切换，持续低帧率时自动降级为直接渲染）、Canvas 程序化贴图（轮胎法线、拉丝金属、碳纤维、地台刻度、沥青/草地/路肩/天空）、WebAudio 合成引擎声 + 轮胎啸叫/颠簸/风噪/倒计时蜂鸣。
- **健壮性**：启动守护（双击源码入口 / 不支持 WebGL2 时给出可操作指引）、localStorage 访问兜底、后期链失败自动降级、WebGL 上下文丢失恢复、赛道模式主光阴影相机随车移动。

## 结构

```
src/
├─ main.js        薄入口（启动守护后 createApp）
├─ app.js         应用装配与主循环（展台/赛道双模式切换）
├─ core/          stage.js 场景舞台（展台组化+世界切换） · postfx.js 后期链 · textures.js 程序化贴图
│                 audio.js 引擎声+驾驶音效 · fpsGuard.js 帧率统计与自动降级 · trackScene.js 赛道世界
├─ kart/          builder.js 整车装配 · layout.js 整车尺寸 · registry.js 部件注册表
│  ├─ geometry.js 车床/链轮/刹车盘等几何工具
│  └─ parts/      chassis 车架 · bodywork 覆盖件 · wheels 车轮 · engine 发动机
│                 drivetrain 传动 · steering 转向 · jacking 举升姿态 · brakes 制动 · cockpit 操纵
├─ sim/           state.js 转速状态机（起动/怠速/油门/传动比） · kinematics.js 机构运动学纯数学（可单测）
│                 cycle.js 二冲程换气循环零维模型（可单测） · track.js 赛道几何纯数学（可单测）
│                 driving.js 卡丁车动力学纯数学（离合/轮胎摩擦圆/漂移，可单测）
│                 ai.js AI 车手三档难度（纯追踪+前瞻制动，可单测） · race.js 发车格/排名/碰撞（可单测）
├─ interaction/   picking 拾取描边 · explode 爆炸 · cameraRig 相机 · driveCamera 驾驶相机 · shortcuts 快捷键（双模式）
├─ ui/            panels.js 面板 · hud.js 赛道 HUD · trackMenu.js 模式菜单/结算 · icons.js 图标
└─ scripts/       smoke.mjs 无头冒烟验证（零依赖 CDP，泵帧确定性断言）
```

架构要点：

- 部件通过 `registry.registerPart(group, def)` 注册（名称/系统/说明/爆炸向量）；registry 是**显式实例**（`createRegistry()`），builder/parts/ui/interaction 全部经参数注入，无模块级隐式单例。
- 每帧顺序：`sim.step`（状态机）→（赛道模式）`stepDriving`（动力学，写真实轮速/车速/负载转速）→ `registry.runUpdates`（各部件更新器写机构位姿，动态件只写 `userData.mechPos`；驾驶位姿更新器注册序最后落位）→ `explode.update`（爆炸位移唯一出口：`position = (mechPos ?? basePos) + dir·t`）→ 渲染。机构位移与爆炸位移不会互相覆盖。
- 运动学（活塞位移、链条包络相位、拉杆角度）与车辆动力学（离合/轮胎/摩擦圆）全部按约束解算，单一事实来源在 `src/sim/`（零渲染依赖，`npm test` 直接断言上下止点、链条切线/包角、转向定长约束、起步喘振、转向不足、制动上限、漂移附着、计圈）。
- 展台与赛道是两个互斥世界：stage 的展台物件收进 `showroom` 组整体显隐，赛道世界（路面/路肩/龙门架/轮胎墙/树/天空）由 `trackScene.js` 惰性构建一次；切换时雾/远裁剪面/阴影相机范围同步换挡。
- 性能：链条走 `InstancedMesh`（约 200 实例）、车架桁架合并为 1 次绘制、轮胎墙与树木实例化；悬停射线经 rAF 节流且跳过实例网格；弱 GPU 下后期链持续低于 24fps 自动降级（只作用本次会话）。

## English

Procedurally modeled racing kart (CIK proportions) in interactive 3D — pure runtime generation with Three.js: no model files, no image assets, and the build output is a **single-file HTML that opens offline with a double click**.

Highlights:

- **Track driving (KartRider-style)**: hit "🏁 上赛道" in the top bar, launch on a 3-2-1 countdown and lap the circuit with live timing. Three cameras (far chase / near chase / cockpit, V to cycle), speed-widened FOV, tire screech, kerb & grass rumble. The physics is honest: centrifugal clutch engages at 4000 rpm (visible launch rev sag), a 125cc two-stroke direct-drive torque curve, no differential, rear-disc-only braking (brake late and you understeer), Shift to drift with an exit BOOST, grass penalty off-track and soft barriers. HUD: current/last/best lap (best persisted), mini tach, minimap, wrong-way warning; touch devices get steering/brake/drift buttons with auto-throttle.
- **Mechanisms, not animations**: crank-slider solved analytically, roller chain strictly meshing tooth-shaped sprockets along an open envelope, rack-and-pinion steering with tie rods solved by fixed-length Newton iteration (Ackermann geometry emerges naturally), pedal–master-cylinder–caliper brake linkage, and kingpin jacking — inclined kingpins (KPI/caster) lift the rigid frame when steering, genuinely unloading the inside rear wheel (real solved millimetres; optional teaching magnification is always labelled).
- **Interaction**: showroom/track dual mode; 9 camera presets, progressive exploded view, hover highlight & per-part engineering explainers, tachometer, keyboard driving with **hold-to-steer / hold-throttle** (Space start/stop, W/S throttle, A/D steer, B brake, E explode, R reset, 1–8 presets, ? help).
- **Rendering**: IBL + ACES tone mapping + GTAO/Bloom/outline post chain (auto-degrades on sustained low FPS), canvas-generated textures (tire normals, brushed metal, carbon fiber, platform dial, asphalt/grass/kerbs/sky), WebAudio-synthesized engine sound plus screech/rumble/wind/countdown beeps.
- **Engineering quality**: 85 unit tests covering kinematics, state machine, kingpin jacking, demo scripts, the two-stroke gas-exchange cycle, track geometry, vehicle dynamics, AI drivers and race state (`npm test`), zero-dependency headless smoke test with regression cases including the track mode (`npm run smoke`), ESLint clean, GitHub Actions gate on every push (`.github/workflows/ci.yml`).

## License

[MIT](LICENSE)
