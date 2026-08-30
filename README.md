# 卡丁车机械原理 · 交互式三维演示

程序化建模的竞赛卡丁车（CIK 比例）三维机构演示页面。基于 Three.js 的纯运行时生成 —— 零模型文件、零图片资源，构建产物为**单文件 HTML，双击即可离线打开**。

## 怎么打开（三种方式）

| 方式 | 操作 | 适用 |
| --- | --- | --- |
| **双击即看** | 双击项目里的 `start.bat`（或直接双击 `dist/index.html`） | 观看 / 分发给别人，无需任何环境 |
| 本地预览 | `npm run build && npm run preview`，访问终端提示地址 | 模拟服务器环境 |
| 二次开发 | `npm install` 后 `npm run dev`，访问终端提示地址 | 修改代码 |

> 注意：项目根目录的 `index.html` 是**源码入口**，只在 `npm run dev` 下有效，直接双击会看到启动失败提示——这是预期行为，按提示改用 `start.bat` 即可。

## 功能

- **机构演示**：二冲程发动机剖视（曲柄滑块精确解算）、滚子链链传动（链节沿包络路径与齿形链轮啮合）、齿轮齿条转向（拉杆按刚杆约束牛顿迭代求解，阿克曼几何自然涌现）、后轴碟刹（踏板-主缸-卡钳联动）。
- **交互**：8 个视角预设、逐级爆炸分解、部件悬停高亮/点击讲解、部件清单（聚焦/隐藏）、转速仪表盘、自动环绕、键盘快捷键（空格启动、W/S 油门、A/D 转向、B 刹车、E 爆炸、R 复位、1-8 视角、? 帮助）。
- **渲染**：IBL 环境光照 + ACES 色调映射 + GTAO/Bloom/描边后期链（可手动切换，持续低帧率时自动降级为直接渲染）、Canvas 程序化贴图（轮胎法线、拉丝金属、碳纤维、地台刻度）、WebAudio 合成引擎声。
- **健壮性**：启动守护（双击源码入口 / 不支持 WebGL2 时给出可操作指引）、localStorage 访问兜底、后期链失败自动降级。

## 结构

```
src/
├─ core/          stage.js 场景舞台 · postfx.js 后期链 · textures.js 程序化贴图 · audio.js 引擎音
├─ kart/          builder.js 整车装配 · layout.js 整车尺寸 · registry.js 部件注册表
│  ├─ geometry.js 车床/链轮/刹车盘等几何工具
│  └─ parts/      chassis 车架 · bodywork 覆盖件 · wheels 车轮 · engine 发动机
│                 drivetrain 传动 · steering 转向 · brakes 制动 · cockpit 操纵
├─ sim/           state.js 转速状态机（起动/怠速/油门/传动比）
├─ interaction/   picking 拾取描边 · explode 爆炸 · cameraRig 相机
└─ ui/            panels.js 面板 · icons.js 图标
```

架构要点：每个部件通过 `registerPart(group, def)` 注册（名称/系统/说明/爆炸向量），每帧动画由 `addUpdate` 注册的更新器统一驱动；运动学（活塞位移、链条相位、拉杆角度）全部按机构约束解算，而非关键帧。
