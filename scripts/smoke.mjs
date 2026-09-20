// ————— 无头浏览器冒烟验证（零依赖：Node ≥22 内置 WebSocket + fetch）—————
// 用法：npm run smoke（需先 npm run build）
// 流程：起 vite preview → 拉起 headless Chrome（CDP）→ 加载页面 → 断言机构运动 → 截图
// 产物：.tmp/smoke/*.png（不入库）。退出码非零即失败。
//
// 设计要点：
// - headless Chrome（swiftshader）不按正常节奏驱动 rAF，运动采样改用
//   __kart.step(dt, n) 手动泵帧（确定性、不受帧率影响）；截图仍走 Page.captureScreenshot。
// - preview/CDP 端口与 Chrome 配置目录均按进程号取唯一值，不与残留孤儿进程撞车；
//   Windows 下 Chrome 需 taskkill /T 按进程树杀（child.kill 只杀启动进程）。
// - 全局硬超时 180s，任何环节挂死都以非零码退出。
// - vite preview 在本机绑定 localhost(::1)，直连 127.0.0.1 会被拒。

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// 端口/配置目录按进程号取唯一值：上一轮若异常退出留下孤儿进程，也不会与本轮撞车
const PREVIEW_PORT = 40000 + (process.pid % 10000);
const CDP_PORT = 20000 + (process.pid % 10000);
const PROFILE_DIR = join(ROOT, '.tmp', `chrome-profile-${process.pid}`);
const PAGE_URL = `http://localhost:${PREVIEW_PORT}/`;
const CDP_URL = `http://localhost:${CDP_PORT}`;
const OUT_DIR = join(ROOT, '.tmp', 'smoke');
const TIMEOUT = 120_000;

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function findChrome() {
  for (const p of chromeCandidates) if (existsSync(p)) return p;
  throw new Error('未找到 Chrome/Edge，可设 CHROME_PATH 环境变量指定');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeout = TIMEOUT) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* 未就绪，继续重试 */ }
    if (Date.now() - t0 > timeout) throw new Error(`等待超时: ${what}`);
    await sleep(300);
  }
}

// —— 最小 CDP 客户端 ——
async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP WebSocket 连接失败'));
  });
  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '页面异常');
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') || 'console.error');
    }
  };
  const rpc = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { rpc, consoleErrors, close: () => ws.close() };
}

async function evalJs(rpc, expression) {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(`页面内执行失败: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
  }
  return r.result.value;
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

// 矩形相交判定（桌面/手机两组的重叠断言共用：手机 HUD 避让 + 触屏驾驶层门控）
const overlapRect = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

// Windows 上 child.kill() 只杀启动进程，Chrome 子进程会残留并占用调试端口——按进程树杀
function killTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(proc.pid), '/F', '/T'], { stdio: 'ignore' });
  } else {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // 全局硬超时：任何环节挂死都不无限等待（超时杀进程树后退出码非零）
  const hardTimeout = setTimeout(() => {
    console.error('冒烟失败: 全局超时');
    killTree(chromeRef);
    killTree(previewRef);
    process.exit(2);
  }, 300_000);
  hardTimeout.unref();
  let chromeRef = null;
  let previewRef = null;

  // 1. 起 preview（直接调 node + vite 入口，绕开 Windows 上 spawn .cmd 的 EINVAL）
  // 以子进程 stdout 打印 "Local:" 为就绪标志——这是本进程确实抢到端口的证据（strictPort 下端口被占会直接退出）
  const preview = spawn(process.execPath,
    [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'pipe' });
  previewRef = preview;
  let previewReady = false;
  // vite 会把 ANSI 色码插进 "Local" 与 ":" 之间（Local\x1b[22m:），先剥色码再匹配。
  // eslint-disable-next-line no-control-regex -- 匹配 ANSI 控制字符是本行的唯一目的
  const ANSI = /\x1b\[[0-9;]*m/g;
  preview.stdout.on('data', (d) => { if (String(d).replace(ANSI, '').includes('Local:')) previewReady = true; });
  await waitFor(() => previewReady, 'vite preview 就绪');

  // 2. 拉起 headless Chrome（配置目录随进程号唯一，避免与残留孤儿抢锁）
  const chrome = spawn(findChrome(), [
    '--headless=new', '--use-angle=swiftshader', '--mute-audio', '--no-first-run',
    `--remote-debugging-port=${CDP_PORT}`, '--window-size=1600,900',
    `--user-data-dir=${PROFILE_DIR}`, 'about:blank',
  ], { stdio: 'pipe' });
  chromeRef = chrome;

  try {
    const target = await waitFor(async () => {
      const list = await (await fetch(`${CDP_URL}/json/list`)).json();
      return list.find((t) => t.type === 'page');
    }, 'CDP target 就绪');

    const { rpc, consoleErrors, close } = await connectCDP(target.webSocketDebuggerUrl);
    await rpc('Runtime.enable');
    await rpc('Page.enable');
    await rpc('Page.navigate', { url: PAGE_URL });
    await waitFor(() => evalJs(rpc, '!!window.__kart'), '应用启动（window.__kart）');
    check('应用启动无异常', true);

    // 展台口径：车手装配但不可见（裸车演示，任务包 §一.1）；hidden 类全项目清点——
    // 所有带 hidden 的元素必须真实 display:none（同类"类挂了规则没了"漏网即在此爆红，
    // BUG 3 根因 .tm-wrap.hidden 缺规则在本断言可复现：子元素计算 display 不随父级继承）
    {
      const drv = JSON.parse(await evalJs(rpc, `JSON.stringify((() => {
        const d = __kart.kart.getObjectByName('driver');
        return { exists: !!d, visible: d ? d.visible : null, meshes: d ? d.children.length : 0 };
      })())`));
      check('展台: 车手存在但隐藏（裸车演示口径）', drv.exists && drv.visible === false && drv.meshes === 3,
        JSON.stringify(drv));
      const leaked = JSON.parse(await evalJs(rpc, `JSON.stringify([...document.querySelectorAll('.hidden')]
        .map((el) => ({ sel: el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0], display: getComputedStyle(el).display }))
        .filter((e) => e.display !== 'none'))`));
      check('展台: hidden 类全项目清点——所有 hidden 元素均真实 display:none', leaked.length === 0,
        JSON.stringify(leaked));
    }

    const pump = (n) => evalJs(rpc, `__kart.step(1/30, ${n}); "ok"`);

    // 3. 机构运动采样：启动发动机并泵帧，前后对比
    await evalJs(rpc, '__kart.sim.startEngine(); __kart.sim.throttle = 1; "ok"');
    await pump(45); // 拖转 0.9s + 油门拉升（swiftshader 慢，泵帧走 dt=1/30）
    const sampleExpr = `JSON.stringify({
      axle: __kart.getPart('rear-axle').group.rotation.x,
      sprocket: __kart.getPart('rear-sprocket').group.rotation.x,
      disc: __kart.getPart('brake-disc').group.rotation.x,
      crank: __kart.getPart('crankshaft').group.rotation.x,
      piston: __kart.getPart('piston').group.position.z,
      wheelR: __kart.getPart('wheel-rr').group.rotation.x,
      wheelF: __kart.getPart('wheel-fl').group.rotation.x,
      chain: __kart.getPart('chain').group.children[0].instanceMatrix.array[14],
      rpm: Math.round(__kart.sim.rpm),
    })`;
    const s0 = JSON.parse(await evalJs(rpc, sampleExpr));
    await pump(15);
    const s1 = JSON.parse(await evalJs(rpc, sampleExpr));
    check('发动机点火并拉升转速', s1.rpm > 2000, `rpm=${s1.rpm}`);
    for (const k of Object.keys(s0)) {
      if (k === 'rpm' || k === 'wheelF') continue;
      check(`机构运动: ${k} 随引擎转动`, Math.abs(s1[k] - s0[k]) > 1e-6, `${s0[k].toFixed(4)} → ${s1[k].toFixed(4)}`);
    }
    // 前轮无动力：展示台上前轮不空转（卡丁车是后驱车）——回归用户报障
    check('前轮不空转（后驱车）', Math.abs(s1.wheelF - s0.wheelF) < 1e-9, `wheelF ${s0.wheelF} → ${s1.wheelF}`);
    // 后轴自转轴心必须在其轴心线上（绕世界原点公转 = 横杆甩圈穿帮）——回归用户报障
    const axlePos = JSON.parse(await evalJs(rpc, `JSON.stringify(__kart.getPart('rear-axle').group.position)`));
    check('后轴绕自身轴心自转', Math.abs(axlePos.y - 0.145) < 1e-6 && Math.abs(axlePos.z - (-0.53)) < 1e-6,
      `origin=(${axlePos.x}, ${axlePos.y}, ${axlePos.z})`);

    // 4. 阿克曼：满舵时左右轮转角不相等
    // （转向节拆两层后绕倾斜主销轴以四元数偏转，注册组 rotation.y 恒为 0——
    //   改读转向更新器写入 sim 的解算角；断言阈值与语义不变）
    await evalJs(rpc, '__kart.sim.steer = 1; "ok"');
    await pump(20);
    const steer = JSON.parse(await evalJs(rpc, `JSON.stringify({
      l: __kart.sim.steerAngleL,
      r: __kart.sim.steerAngleR,
    })`));
    check('阿克曼几何: 满舵左右轮转角不同', Math.abs(Math.abs(steer.l) - Math.abs(steer.r)) > 0.01,
      `L=${steer.l.toFixed(4)} R=${steer.r.toFixed(4)}`);
    await evalJs(rpc, '__kart.sim.steer = 0; "ok"');
    await pump(20);

    // 4.5 主销举升：开演示（走面板按钮）、打满左舵（steer=1 → 左转，内侧=左后轮 wheel-rl），
    // 断言簧载姿态非恒等且内侧后轮世界 y 真实升高。
    // 手动泵帧 render=false 不更新 matrixWorld，读取前需 updateWorldMatrix 沿父链刷新。
    const worldSample = (id) => evalJs(rpc, `(() => {
      const g = __kart.getPart('${id}').group;
      g.updateWorldMatrix(true, false);
      const e = g.matrixWorld.elements;
      // 旋转非对角元范数（列主序：恒等时全为 0，姿态变化时非零）
      return JSON.stringify({ y: e[13], rot: Math.hypot(e[1], e[2], e[4], e[6], e[8], e[9]) });
    })()`).then(JSON.parse);
    const baseRL = await worldSample('wheel-rl');
    const baseFrame = await worldSample('frame');
    await evalJs(rpc, `document.getElementById('tg-jacking').click(); "ok"`);
    await evalJs(rpc, '__kart.sim.steer = 1; "ok"');
    await pump(30); // steerSmooth 收敛（速率 7/s，1s 足够）
    const liftRL = await worldSample('wheel-rl');
    const liftFrame = await worldSample('frame');
    check('主销举升: 簧载组姿态非恒等', Math.abs(liftFrame.rot - baseFrame.rot) > 1e-4,
      `车架矩阵旋转项 ${baseFrame.rot.toExponential(2)} → ${liftFrame.rot.toExponential(2)}`);
    check('主销举升: 内侧后轮（wheel-rl）世界 y 升高 > 0.5mm', liftRL.y - baseRL.y > 0.0005,
      `y ${(baseRL.y * 1000).toFixed(2)}mm → ${(liftRL.y * 1000).toFixed(2)}mm（Δ=${((liftRL.y - baseRL.y) * 1000).toFixed(2)}mm）`);
    // 还原：回正 + 关演示，避免污染后续装配态截图
    await evalJs(rpc, '__kart.sim.steer = 0; "ok"');
    await evalJs(rpc, `document.getElementById('tg-jacking').click(); "ok"`);
    await pump(20);

    // 4.65 二冲程换气循环（阶段5 回归，§12.3）：缸压峰值区间、气口正时几何同源、
    // 波状态读数合法、慢放开关、twostroke 脚本装载（三处白名单同步的验收）。
    await evalJs(rpc, '__kart.sim.throttle = 1; "ok"');
    let cycPeak = 0;
    for (let i = 0; i < 24; i++) {
      await pump(2);
      const pNow = await evalJs(rpc, `__kart.sim.cycle.pCyl / 1e5`);
      cycPeak = Math.max(cycPeak, pNow);
    }
    check('换气循环: 缸压峰值在物理区间 (20,120) bar', cycPeak > 20 && cycPeak < 120, `峰值 ${cycPeak.toFixed(1)} bar`);
    const headerZ = await evalJs(rpc, `__kart.getPart('exhaust').group.children[0].geometry.parameters.path.points[0].z + 0.20`);
    check('换气循环: header 首点落在排气窗口带内', headerZ > 0.1122 && headerZ < 0.1289, `z=${Number(headerZ).toFixed(4)}`);
    const waveText = await evalJs(rpc, `__kart.sim.cycle.readouts().waveState`);
    check('换气循环: 波状态读数合法', ['正压波下行', '负压回抽', '反射回推', '排气口关闭'].includes(waveText), waveText);
    await evalJs(rpc, `document.getElementById('tg-slowmo').click(); "ok"`);
    const slowOn = await evalJs(rpc, `__kart.sim.visualSlow`);
    await evalJs(rpc, `document.getElementById('tg-slowmo').click(); "ok"`);
    const slowOff = await evalJs(rpc, `__kart.sim.visualSlow`);
    check('换气慢放: 开关切换 0.004 ↔ 0.2', slowOn === 0.004 && slowOff === 0.2, `${slowOn} → ${slowOff}`);
    await evalJs(rpc, `__kart.demoPlayer.loadAndPlay('twostroke'); "ok"`);
    check('演示播放器: twostroke 脚本装载即播放', (await evalJs(rpc, `__kart.demoPlayer.state`)) === 'playing');
    await evalJs(rpc, `__kart.demoPlayer.stop(); "ok"`);
    await pump(10);

    // 4.6 演示序列播放器：装载 jacking 脚本播放 → 举升段状态 → pointerdown 介入暂停 → stop 复位。
    // （脚本定稿的举升动作在 t=11s，泵帧须越过该点；泵帧一律走 __kart.step，确定性推进）
    await evalJs(rpc, `__kart.demoPlayer.loadAndPlay('jacking'); "ok"`);
    check('演示播放器: 装载 jacking 脚本即进入播放态', (await evalJs(rpc, `__kart.demoPlayer.state`)) === 'playing');
    await pump(375); // 375 × 1/30 = 12.5s，越过 t=11 的举升动作
    const demoMid = JSON.parse(await evalJs(rpc, `JSON.stringify({
      state: __kart.demoPlayer.state,
      time: __kart.demoPlayer.time,
      jacking: __kart.sim.jackingDemo,
      steer: __kart.sim.steer,
      caption: document.getElementById('demo-caption').textContent,
    })`));
    check('演示播放器: 举升段开关打开、转向非零、字幕非空',
      demoMid.jacking === 1 && demoMid.steer !== 0 && demoMid.caption.length > 0,
      `state=${demoMid.state} t=${demoMid.time.toFixed(1)}s jacking=${demoMid.jacking} steer=${demoMid.steer} caption="${demoMid.caption}"`);

    // 模拟手动介入：canvas pointerdown → 暂停且时间轴不再推进。
    // 合成事件没有真实活动指针，OrbitControls 的 setPointerCapture 必然抛 NotFound——
    // 派发期间临时桩掉捕获调用（配对 pointerup 复位控制器状态），避免假报错污染控制台检查。
    await evalJs(rpc, `(() => {
      const el = document.getElementById('scene');
      const orig = el.setPointerCapture;
      el.setPointerCapture = () => {};
      try {
        el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, buttons: 1 }));
        el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0 }));
      } finally {
        el.setPointerCapture = orig;
      }
      return "ok";
    })()`);
    const demoPausedState = await evalJs(rpc, `__kart.demoPlayer.state`);
    const demoPausedTime = await evalJs(rpc, `__kart.demoPlayer.time`);
    await pump(15); // 暂停态下泵帧，时间轴必须冻结
    const demoAfterTime = await evalJs(rpc, `__kart.demoPlayer.time`);
    check('演示播放器: pointerdown 介入 → 暂停且时间轴冻结',
      demoPausedState === 'paused' && Math.abs(demoAfterTime - demoPausedTime) < 1e-9,
      `state=${demoPausedState} t ${demoPausedTime.toFixed(2)} → ${demoAfterTime.toFixed(2)}`);

    // stop 复位：steer/throttle 归零、举升关闭
    await evalJs(rpc, `__kart.demoPlayer.stop(); "ok"`);
    await pump(10);
    const demoReset = JSON.parse(await evalJs(rpc, `JSON.stringify({
      steer: __kart.sim.steer,
      throttle: __kart.sim.throttle,
      jacking: __kart.sim.jackingDemo,
    })`));
    check('演示播放器: stop 复位（转向/油门归零、举升关闭）',
      demoReset.steer === 0 && demoReset.throttle === 0 && demoReset.jacking === 0,
      `steer=${demoReset.steer} throttle=${demoReset.throttle} jacking=${demoReset.jacking}`);

    // 4.8 涂装色板 / 轮胎配方（变更 #44）：真实点选通路 → 共享材质色 / 持久化 / 刷新恢复
    {
      await evalJs(rpc, `document.querySelector('#paint-chips [data-paint="blue"]').click(); "ok"`);
      const paint = JSON.parse(await evalJs(rpc, `JSON.stringify({
        hex: __kart.paintHex(),
        nose: __kart.getPart('nose').group.children[0].material.color.getHexString(),
        pod: __kart.getPart('sidepod-l').group.children[0].material.color.getHexString(),
        pedal: __kart.getPart('pedal-brake').group.children[4].material.color.getHexString(),
        cal: __kart.getPart('brake-caliper').group.children[0].material.color.getHexString(),
        fuel: __kart.getPart('fuel-line').group.material.color.getHexString(),
        suit: __kart.kart.getObjectByName('driver-suit').material.color.getHexString(),
        cap: __kart.kart.getObjectByName('driver-helmet-cap').material.color.getHexString(),
        seat: __kart.getPart('seat').group.getObjectByName('seat-shell').material.color.getHexString(),
        pad: __kart.getPart('seat').group.children[1].material.color.getHexString(),
        frame: __kart.getPart('frame').group.children[0].material.color.getHexString(),
      })`));
      check('展台: 点色板 → paintRed 全消费面同色（罩/侧箱/踏板/卡钳/燃油管/车手服/盔顶/座椅壳）',
        paint.hex === '1f4fd8' && paint.nose === '1f4fd8' && paint.pod === '1f4fd8'
          && paint.pedal === '1f4fd8' && paint.cal === '1f4fd8' && paint.fuel === '1f4fd8'
          && paint.suit === '1f4fd8' && paint.cap === '1f4fd8' && paint.seat === '1f4fd8',
        JSON.stringify(paint));
      // 变更 #44 缺陷一：座椅壳曾独用玻璃钢材质实例，脱离喷漆链路（只喷了车厢没喷座位）
      check('展台: 座椅织物件不喷漆（坐垫/靠背软垫保持织物色 1d2024）', paint.pad === '1d2024', `pad=${paint.pad}`);
      check('展台: 非漆面材质不随喷漆变色（车架管铬钼钢原色）', paint.frame === 'c9d0d9', `frame=${paint.frame}`);
      await evalJs(rpc, `document.querySelector('#tire-chips [data-tire="wet"]').click(); "ok"`);
      const tire = JSON.parse(await evalJs(rpc, `JSON.stringify({
        hex: __kart.tireHex(),
        bands: (() => {
          const out = [];
          __kart.kart.traverse((o) => { if (o.name === 'tire-band') out.push(o.material.color.getHexString()); });
          return out;
        })(),
        rubber: __kart.getPart('wheel-rr').group.children[0].material.color.getHexString(),
      })`));
      check('展台: 切配方 → 前后轮 4 轮 8 侧环带材质同步换色（橡胶本体不动）',
        tire.hex === '2a6fe0' && tire.bands.length === 8 && tire.bands.every((h) => h === '2a6fe0')
          && tire.rubber === '17181b',
        `bands=${tire.bands.length} allBlue=${tire.bands.every((h) => h === '2a6fe0')} rubber=${tire.rubber}`);
      const persist = JSON.parse(await evalJs(rpc, `JSON.stringify({
        p: localStorage.getItem('kart.paint'), t: localStorage.getItem('kart.tire'),
        swActive: document.querySelector('#paint-chips [data-paint="blue"]').classList.contains('active'),
        swDefaultOff: !document.querySelector('#paint-chips [data-paint="red"]').classList.contains('active'),
        tcActive: document.querySelector('#tire-chips [data-tire="wet"]').classList.contains('active'),
      })`));
      check('展台: 喷漆/配方写入 localStorage 且色板/配方选中态跟随',
        persist.p === 'blue' && persist.t === 'wet' && persist.swActive && persist.swDefaultOff && persist.tcActive,
        JSON.stringify(persist));
      await rpc('Page.navigate', { url: PAGE_URL });
      await waitFor(() => evalJs(rpc, '!!window.__kart'), '涂装组重启后应用启动');
      const restored = JSON.parse(await evalJs(rpc, `JSON.stringify({
        hex: __kart.paintHex(), tire: __kart.tireHex(),
        seat: __kart.getPart('seat').group.getObjectByName('seat-shell').material.color.getHexString(),
        paintActive: document.querySelector('#paint-chips [data-paint="blue"]').classList.contains('active'),
        tireActive: document.querySelector('#tire-chips [data-tire="wet"]').classList.contains('active'),
      })`));
      check('展台: 刷新后从 localStorage 恢复喷漆/配方（材质色 + 选中态，含座椅壳）',
        restored.hex === '1f4fd8' && restored.tire === '2a6fe0' && restored.seat === '1f4fd8'
          && restored.paintActive === true && restored.tireActive === true,
        JSON.stringify(restored));
      // 还原默认（红漆 + 中性胎），后续分组截图保持基线观感
      await evalJs(rpc, `(() => {
        document.querySelector('#paint-chips [data-paint="red"]').click();
        document.querySelector('#tire-chips [data-tire="medium"]').click();
        return "ok";
      })()`);
      const backToDefault = await evalJs(rpc, `__kart.paintHex() === 'b61e2c' && __kart.tireHex() === 'f2c12e'`);
      check('展台: 选回默认漆/配方即还原（红漆 b61e2c + 中性黄 f2c12e）', backToDefault === true);
    }

    // 5. 装配态截图（整车 / 传动特写）
    // 开场运镜（app.js：setTimeout 250ms 起、1.3s 补间）由 rig.update(dt) 随泵帧推进，
    // 先跑完再进截图与像素探针：补间未收尾时"同机位连渲两帧取差分"会把相机位移当成画面变化，
    // 环带可见性组的 emMasked 曾因此在同一构建上抖动 4874→7662（阈值 0.9×emMasked 随之忽红忽绿）。
    await sleep(400); // 让 app.js 的 250ms 开场延时真正起跳（补间计时器挂在 setTimeout 上）
    await pump(60); // 60 × 1/30 = 2s > 1.3s 补间（tween.t 按 dt/dur 累加，泵帧即推进）
    async function shot(name, camPos, camTgt) {
      await evalJs(rpc, `(() => {
        document.getElementById('loader').style.display = 'none';
        __kart.camera.position.set(${camPos.join(',')});
        __kart.controls.target.set(${camTgt.join(',')});
        __kart.controls.update();
        return "ok";
      })()`);
      await pump(2); // 让新相机位姿真正渲一帧
      const shot = await rpc('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT_DIR, name), Buffer.from(shot.data, 'base64'));
      console.log(`  截图 .tmp/smoke/${name}`);
    }
    await shot('01-overview.png', [2.7, 1.15, 2.75], [0, 0.28, 0]);
    await shot('02-drivetrain.png', [0.95, 0.75, -0.1], [0.39, 0.15, -0.42]);
    // 发动机剖视特写：先隐去右侧箱避免遮挡（拍完恢复）
    await evalJs(rpc, `__kart.getPart('sidepod-r').group.visible = false; "ok"`);
    await shot('04-engine.png', [0.82, 0.62, 0.55], [0.33, 0.16, -0.16]);
    await evalJs(rpc, `__kart.getPart('sidepod-r').group.visible = true; "ok"`);

    // 5.1 胎侧环带渲染级可见性（变更 #44 返工·缺陷二）
    // 机位刻意停在 01-overview 的默认整车视角（VIEWS.home）：验收口径是"常规视角肉眼可辨"，
    // 不接受贴脸特写机位，也不接受场景图数据自证——所以本组全部判定都在这一帧画幅上逐像素做。
    {
      await evalJs(rpc, `(() => {
        __kart.controls.autoRotate = false; // 自动环绕会让帧间漂移，判定需要同一机位
        __kart.camera.position.set(2.7, 1.15, 2.75);
        __kart.controls.target.set(0, 0.28, 0);
        __kart.controls.update();
        return "ok";
      })()`);
      const homeCam = JSON.parse(await evalJs(rpc, `JSON.stringify({
        pos: __kart.camera.position.toArray().map((v) => +v.toFixed(2)),
        tgt: __kart.controls.target.toArray().map((v) => +v.toFixed(2)),
      })`));
      check('环带可见性: 判定机位 = 默认整车视角 VIEWS.home（非特写）',
        homeCam.pos.join(',') === '2.7,1.15,2.75' && homeCam.tgt.join(',') === '0,0.28,0',
        JSON.stringify(homeCam));

      const band = JSON.parse(await evalJs(rpc, `(() => {
        const gl = document.getElementById('scene');
        const scratch = document.createElement('canvas');
        const sctx = scratch.getContext('2d', { willReadFrequently: true });
        const shoot = () => {
          // 渲染与回读必须在同一 JS 任务里：画布没开 preserveDrawingBuffer，
          // 合帧之后缓冲区就被清，drawImage 会拿到空图。
          __kart.step(1 / 30, 1, true);
          scratch.width = gl.width;
          scratch.height = gl.height;
          sctx.drawImage(gl, 0, 0);
          return sctx.getImageData(0, 0, gl.width, gl.height).data;
        };
        const bands = [];
        const tires = [];
        __kart.kart.traverse((o) => {
          if (o.name === 'tire-band') bands.push(o);
          else if (o.name === 'tire-body') tires.push(o);
        });
        const mats = [...new Set(bands.map((o) => o.material))];
        const out = { bands: bands.length, tires: tires.length, mats: mats.length, canvas: gl.width + 'x' + gl.height };
        const wheels = ['wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr'].map((id) => __kart.getPart(id).group);
        const spin0 = wheels.map((g) => g.rotation.x);
        const emissive0 = mats.map((m) => [m.emissive.getHex(), m.emissiveIntensity]);
        // 品红自发光探针（差分版）：同机位连渲两帧，只切换环带 emissive，统计"变得更品红"的像素。
        // 用差分而非绝对色阈：环带底色（配方黄）本身就带大量绿通道，绝对判据会把亮胎侧漏掉；
        // 自发光不受光照影响，差分仍为零即证明该态下环带一个像素都没画出来 = 被深度遮挡。
        const probeMagenta = () => {
          for (const m of mats) m.emissive.setRGB(0, 0, 0);
          const off = shoot();
          for (const m of mats) m.emissive.setRGB(1, 0, 1);
          const on = shoot();
          let n = 0;
          for (let i = 0; i < on.length; i += 4) {
            const gain = (Math.min(on[i], on[i + 2]) - on[i + 1]) - (Math.min(off[i], off[i + 2]) - off[i + 1]);
            if (gain > 20) n++;
          }
          return n;
        };
        try {
          for (const m of mats) m.emissiveIntensity = 2.0;
          out.emMasked = probeMagenta(); // 装配态：胎体还在，只有不被挡的一侧能被看到
          for (const t of tires) t.visible = false;
          out.emExposed = probeMagenta(); // 隐去 4 个胎体：8 条环带全暴露（分母）
          for (const t of tires) t.visible = true;
          for (const b of bands) b.visible = false;
          out.emBlank = probeMagenta(); // 隐去环带：对照零点
          for (const b of bands) b.visible = true;
          out.emSpin = []; // 滚转角 0/90/180/270°：环带是回转面，可见量必须与转角无关
          for (let k = 0; k < 4; k++) {
            for (const g of wheels) g.rotation.x = (k * Math.PI) / 2;
            out.emSpin.push(probeMagenta());
          }
        } finally {
          mats.forEach((m, i) => { m.emissive.setHex(emissive0[i][0]); m.emissiveIntensity = emissive0[i][1]; });
          wheels.forEach((g, i) => { g.rotation.x = spin0[i]; });
          for (const t of tires) t.visible = true;
          for (const b of bands) b.visible = true;
        }
        // 真实着色（自发光已还原）：换配方前后逐像素比较——报障原话是"轮胎没看到颜色变化"
        const pick = (id) => document.querySelector('#tire-chips [data-tire="' + id + '"]').click();
        const diff = (a, b) => {
          let n = 0;
          for (let i = 0; i < a.length; i += 4) {
            if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
          }
          return n;
        };
        try {
          pick('soft');
          const soft = shoot();
          pick('hard');
          const hard = shoot();
          for (const b of bands) b.visible = false;
          const bare = shoot(); // 与 hard 同态、只隐去环带 ⇒ 差值即环带占据的可见像素
          for (const b of bands) b.visible = true;
          out.pxSoft = diff(soft, bare);
          out.pxBare = diff(hard, bare);
          out.pxSwap = diff(soft, hard); // 软↔硬真正改色的像素（配方切换的可感知证据）
        } finally {
          for (const b of bands) b.visible = true;
          pick('medium'); // 还原默认中性胎，别把配方状态污染留给后续分组
          shoot();
        }
        return JSON.stringify(out);
      })()`));
      check('环带可见性: 4 轮 8 侧环带 + 4 个胎体在场景图内，环带材质为共享单例',
        band.bands === 8 && band.tires === 4 && band.mats === 1, JSON.stringify(band));
      // 零点容 5px：描边/边缘抗锯齿通道会把极个别像素染成品红倾向，单条环带 ≈2000px，
      // 5px 渗漏 <0.3%，既守住"品红只可能来自环带"，又不被 AA 噪声误报。
      check('环带可见性: 探针对照零点（隐去环带后差分像素 ≤5）',
        band.emBlank <= 5, `emBlank=${band.emBlank} canvas=${band.canvas}`);
      // 像素地板的推导：单条环带投影 ≈ 周长 2π·140mm ÷ 2.86mm/px ≈ 300px 长 × 带宽 19mm ÷ 2.86 ≈ 7px
      // ⇒ ≈ 2000px/条。全暴露 8 条 ⇒ 理论 1.6 万 px，地板取 1/8（2000）；装配态只有朝相机的 4 条
      // 不被本侧胎体挡 ⇒ 理论 8000px，地板取 1/4（2000）并要求 ≥35% 全暴露量（缺陷态实测 0）。
      check('环带可见性: 隐去胎体后环带可被渲染（管线完好，缺陷只在几何遮挡）',
        band.emExposed >= 2000, `emExposed=${band.emExposed}`);
      check('环带可见性: 默认整车视角装配态可见 ≥ 35% 全暴露量（未被胎体深度遮挡）',
        band.emExposed > 0 && band.emMasked >= 0.35 * band.emExposed && band.emMasked >= 2000,
        `masked=${band.emMasked} exposed=${band.emExposed} 比例=${band.emExposed ? (band.emMasked / band.emExposed).toFixed(2) : 'n/a'}`);
      check('环带可见性: 随轮自旋 4 个滚转角可见像素恒定（回转面对称，非单角度可见）',
        band.emSpin.every((n) => n >= 0.9 * band.emMasked), JSON.stringify(band.emSpin));
      // 单条环带投影面积量级：周长 2π·0.14m × 带宽 0.019m ≈ 0.017㎡；home 机位 900px 高
      // 对应 3.9m 处 2.86mm/px ⇒ ≈ 2000px/条，4 条朝向相机的胎侧合计数千 px。
      // 阈值取 800px（约 1/3 条环带）做地板，缺陷态实测 0px。
      check('环带可见性: 真实着色下换配方可逐像素看到胎侧改色（软红↔硬白 ≥800px/态）',
        band.pxSoft >= 800 && band.pxBare >= 800 && band.pxSwap >= 800,
        JSON.stringify({ pxSoft: band.pxSoft, pxBare: band.pxBare, pxSwap: band.pxSwap }));
      await shot('08-tire-band-home.png', [2.7, 1.15, 2.75], [0, 0.28, 0]);
    }

    // 6. 爆炸分解（截图放最后，避免污染装配态画面）
    await evalJs(rpc, '__kart.explode.setTarget(1); "ok"');
    await pump(30);
    const exploded = JSON.parse(await evalJs(rpc, `JSON.stringify({
      y: __kart.getPart('seat').group.position.y,
      e: __kart.explode.get(),
    })`));
    check('爆炸分解: 座椅上移', exploded.e > 0.9 && exploded.y > 0.1, `explode=${exploded.e.toFixed(2)} seatY=${exploded.y.toFixed(3)}`);

    // 左右侧箱应向相反方向分离（此前共用一个爆炸方向，两只都往右飞）——回归用户报障
    const pods = JSON.parse(await evalJs(rpc, `JSON.stringify({
      l: __kart.getPart('sidepod-l').group.position.x,
      r: __kart.getPart('sidepod-r').group.position.x,
    })`));
    check('爆炸分解: 左右侧箱背向分离', pods.l < -0.6 && pods.r > 0.6, `L=${pods.l.toFixed(2)} R=${pods.r.toFixed(2)}`);

    await shot('03-explode.png', [2.4, 1.6, 2.4], [0, 0.5, 0]);
    await evalJs(rpc, '__kart.explode.setTarget(0); "ok"');

    // 7. 赛道·练习模式（菜单 → 单车练习 → 倒计时 → 驾驶全链路）
    // K-A1 原子化回滚：状态切换半途注入异常 → exitTrack 全链回滚 → 展台可用
    {
      await evalJs(rpc, `(() => {
        const orig = document.body.classList.add;
        window.__origClassAdd = orig;
        document.body.classList.add = function (c) {
          if (c === 'track-mode') throw new Error('injected rollback probe');
          return orig.call(this, c);
        };
        __kart.enterTrack();
        return __kart.mode;
      })();`);
      await evalJs(rpc, `if (window.__origClassAdd) document.body.classList.add = window.__origClassAdd; 'ok'`);
      const rb = JSON.parse(await evalJs(rpc, `JSON.stringify({
        mode: __kart.mode,
        active: __kart.sim.drivingActive,
        hudHidden: document.getElementById('track-hud').classList.contains('hidden'),
        btn: document.getElementById('btn-track').textContent,
        errCard: !!document.querySelector('.tm-err'),
      })`));
      check('K-A1: enterTrack 半途异常 → 回滚展台（mode/驾驶态/HUD/按钮复位，错误卡可见）',
        rb.mode === 'showroom' && rb.active === false && rb.hudHidden && rb.btn.includes('上赛道') && rb.errCard,
        JSON.stringify(rb));
    }
    await evalJs(rpc, '__kart.enterTrack(); "ok"');
    check('赛道: enterTrack 进入驾驶模式', (await evalJs(rpc, `__kart.mode`)) === 'track');
    check('赛道: 模式菜单可见', await evalJs(rpc, `!document.getElementById('track-menu').classList.contains('hidden')`));
    {
      const geo = JSON.parse(await evalJs(rpc, `JSON.stringify((() => {
        const t = __kart.track;
        let runs = 0, run = 0, gap = 0;
        for (const sp of t.samples) {
          if (Math.abs(sp.k) > 1 / 60) { run++; gap = 0; }
          else { gap++; if (run > 0 && gap > 6) { if (run >= 8) runs++; run = 0; } }
        }
        if (run >= 8) runs++;
        return { len: t.length, runs, w: t.width };
      })())`));
      check('赛道: 复刻周长 ≈858m（宽度锚标定，图注 1200m 不自洽）', geo.len > 772 && geo.len < 944, `len=${geo.len.toFixed(1)}m`);
      check('赛道: 复刻弯道聚簇 10-14（图面 12 弯）', geo.runs >= 10 && geo.runs <= 14, `runs=${geo.runs}`);
      check('赛道: 路宽 = 图注均值 12m', geo.w === 12, `w=${geo.w}`);
    }
    check('赛道: HUD 容器可见', await evalJs(rpc, `!document.getElementById('track-hud').classList.contains('hidden')`));
    // BUG 3 修复断言（先红：基线 .tm-wrap.hidden 无规则 → display:flex 残影层）
    {
      const tm = JSON.parse(await evalJs(rpc, `JSON.stringify({
        results: getComputedStyle(document.getElementById('tm-results')).display,
      })`));
      check('赛道: 未启用的结算容器真实隐藏（tm-wrap.hidden 规则在位）',
        tm.results === 'none', JSON.stringify(tm));
      const hit = await evalJs(rpc, `(() => {
        const btn = document.querySelector('#tm-panel [data-mode="practice"]');
        const r = btn.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return btn === el || btn.contains(el);
      })()`);
      check('赛道: 模式按钮 elementFromPoint 命中自身（无残影层截胡）', hit === true);
    }
    check('赛道: 玩家车手已挂载可见', await evalJs(rpc, `__kart.kart.getObjectByName('driver')?.visible === true`));
    await evalJs(rpc, `document.querySelector('#track-menu [data-mode="practice"]').click(); "ok"`);
    check('赛道: 选练习后菜单关闭', await evalJs(rpc, `document.getElementById('track-menu').classList.contains('hidden')`));
    // P1-1 倒计时锁定期刹车不得倒车（变红抽查锚点）
    await evalJs(rpc, `__kart.driveKeys.press('brake', true); "ok"`);
    // 桌面零回归守护：键盘刹车通道保持"一按即全开"（触屏渐进只属于触屏输入源）
    await pump(2);
    const kbBrakeT = await evalJs(rpc, `__kart.sim.brakeTarget`);
    check('桌面零回归: 键盘刹车按下即全开（brakeTarget=1，触屏渐进不外溢）', kbBrakeT === 1, `brakeTarget=${kbBrakeT}`);
    const brakeP0 = JSON.parse(await evalJs(rpc, `JSON.stringify({ x: __kart.driving.x, z: __kart.driving.z })`));
    await pump(58); // 2s：倒计时仍在中段
    const brakeP1 = JSON.parse(await evalJs(rpc, `JSON.stringify({ x: __kart.driving.x, z: __kart.driving.z })`));
    const brakeMoved = Math.hypot(brakeP1.x - brakeP0.x, brakeP1.z - brakeP0.z);
    check('倒计时: 锁定期踩刹车不倒车（位移<0.1m，P1-1）', brakeMoved < 0.1, `位移 ${brakeMoved.toFixed(2)}m`);
    await evalJs(rpc, `__kart.driveKeys.press('brake', false); "ok"`);
    await pump(30); // 倒计时进入最后 1s
    const cdText = (await evalJs(rpc, `document.getElementById('hud-center').textContent`)).trim();
    check('赛道: 倒计时大字显示', ['1', '2', '3'].includes(cdText), `显示="${cdText}"`);
    await pump(95); // 累计 ≈4.7s：越过 3-2-1-GO
    const goState = JSON.parse(await evalJs(rpc, `JSON.stringify({
      engine: __kart.sim.engineOn, active: __kart.sim.drivingActive,
    })`));
    check('赛道: GO 后自动点火且动力学激活', goState.engine === true && goState.active === true,
      JSON.stringify(goState));

    // 小地图轴向（R03 Bug1 连带）：起点线在世界 +z 极值一侧（= 图面南/底部直道），
    // 修正后 +z 画向屏幕【下】→ 起点橙色标记必须落在画布下 1/3，上 1/3 不得有橙点。
    // 轴向被翻回 BUG 版时，同一标记会画到上 1/3，本项立刻变红。
    const mapInk = JSON.parse(await evalJs(rpc, `(() => {
      const cv = document.getElementById('hud-map');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const H = cv.height, W = cv.width;
      let top = 0, bottom = 0, all = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (d[i + 3] > 200 && Math.abs(d[i] - 255) < 24 && Math.abs(d[i + 1] - 181) < 28 && Math.abs(d[i + 2] - 71) < 40) {
          all++;
          if (y < H / 3) top++;
          else if (y > (2 * H) / 3) bottom++;
        }
      }
      let zmin = Infinity, zmax = -Infinity;
      for (const sp of __kart.track.samples) { if (sp.z < zmin) zmin = sp.z; if (sp.z > zmax) zmax = sp.z; }
      return JSON.stringify({ top, bottom, all, startZNear: (__kart.driving.z - zmin) / (zmax - zmin) });
    })()`));
    check('赛道: 小地图起点标记画在下 1/3（+z 向屏幕下 = 平面图同形）',
      mapInk.all > 20 && mapInk.bottom > 0 && mapInk.top === 0, JSON.stringify(mapInk));

    // 全油门直线（走真实输入通道按住 W）：真实车速上升、位置前进、车轮按地面速度滚
    // 1:1 复刻赛道白名单改锚：宽度锚标定下最长直道＝底部直道（≈63m，s≈772 起）。
    // 全油门/方向检查动态定位到"最长直道起点 +2m"，避免与几何硬编码耦合。
    await evalJs(rpc, `(() => {
      const T = __kart.track, SS = T.samples, stp = T.length / SS.length;
      let bstart = 0, run = 0, best = 0, bi = 0;
      for (let i = 0; i < SS.length; i++) { if (Math.abs(SS[i].k) < 1 / 300) { if (run === 0) bstart = i; run++; if (run > best) { best = run; bi = bstart; } } else run = 0; }
      const p = T.pointAt((bi + 2) * stp);
      const d = __kart.driving;
      d.x = p.x; d.z = p.z; d.yaw = p.yaw;
      const n = T.nearest(d.x, d.z, -1);
      d.s = n.s; d.hintIdx = n.idx; d.vx = 0; d.vz = 0;
      return 'ok';
    })()`);
    await evalJs(rpc, `__kart.driveKeys.press('up', true); "ok"`);
    const d0 = JSON.parse(await evalJs(rpc, `JSON.stringify({ x: __kart.driving.x, z: __kart.driving.z, v: __kart.driving.speed, w: __kart.sim.wheelOmega })`));
    await pump(120); // 4s 全油门
    const d1 = JSON.parse(await evalJs(rpc, `JSON.stringify({ x: __kart.driving.x, z: __kart.driving.z, v: __kart.driving.speed, w: __kart.sim.wheelOmega, kmh: __kart.sim.speedKmh })`));
    const moved = Math.hypot(d1.x - d0.x, d1.z - d0.z);
    // 起步打滑期（离合滑差 0.85 扭矩 + 后轴附着上限）：4s ≈ 45km/h、位移 ≈23m（½at² 自洽）
    check('赛道: 全油门 4s 前进 >20m 且车速 >35km/h', moved > 20 && d1.kmh > 35,
      `moved=${moved.toFixed(1)}m kmh=${d1.kmh.toFixed(1)}`);
    check('赛道: 车轮角速度 = 地面速度/轮径（真实滚动口径）',
      Math.abs(d1.w - Math.min(d1.v / 0.145, 130)) < 1e-6, `ω=${d1.w.toFixed(1)} v=${d1.v.toFixed(1)}`);
    const hudSpeed = await evalJs(rpc, `+document.getElementById('hud-speed').textContent`);
    // HUD 速度 10Hz 节流，加速中允许 ≤2.5km/h 的显示滞后
    check('赛道: HUD km/h 与动力学一致（10Hz 节流容差）', Math.abs(hudSpeed - d1.kmh) < 2.5, `hud=${hudSpeed} real=${d1.kmh.toFixed(1)}`);

    // 车手 draw call 增量：postfx 合成器会把 renderer.info 重置成最后一 pass 计数（恒 1），
    // 先切直渲通道（画质开关）再隐藏/显示各渲一帧取差（车手 = 服/靴/盔/面罩 4 网格 ×1 车；
    // 阴影通道也计入 info，上限放宽到 10）
    {
      await evalJs(rpc, `document.getElementById('tg-quality').click(); "ok"`);
      const dcOff = await evalJs(rpc, `(() => {
        __kart.kart.getObjectByName('driver').visible = false;
        __kart.step(1/30, 2, true);
        return __kart.drawCalls;
      })()`);
      const dcOn = await evalJs(rpc, `(() => {
        __kart.kart.getObjectByName('driver').visible = true;
        __kart.step(1/30, 2, true);
        return __kart.drawCalls;
      })()`);
      await evalJs(rpc, `document.getElementById('tg-quality').click(); "ok"`);
      check('性能: 单车手 draw call 增量 ∈ [3,14]（服红/服深/盔/面罩/盔顶帽 5 网格，含阴影通道）',
        dcOn - dcOff >= 3 && dcOn - dcOff <= 14, `off=${dcOff} on=${dcOn} Δ=${dcOn - dcOff}`);
    }

    // 赛道截图（此时仍在起跑直道上，追逐相机跟车：路面/路肩/轮胎墙/树全入画）
    {
      await pump(2);
      const shotTr = await rpc('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT_DIR, '05-track.png'), Buffer.from(shotTr.data, 'base64'));
      console.log('  截图 .tmp/smoke/05-track.png');
    }

    // 座舱视角（V 键同路径：点 HUD 相机按钮两次 → 座舱）
    await evalJs(rpc, `document.getElementById('hud-cam').click(); document.getElementById('hud-cam').click(); "ok"`);
    await pump(4);
    {
      const shotCk = await rpc('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT_DIR, '06-cockpit.png'), Buffer.from(shotCk.data, 'base64'));
      console.log('  截图 .tmp/smoke/06-cockpit.png');
    }
    await evalJs(rpc, `document.getElementById('hud-cam').click(); "ok"`); // 回追逐·远

    // 方向回归（用户报告的左右反向 BUG）：走真实按键通道，按【左】必须 yaw 增大（屏幕左转）
    const yaw0 = await evalJs(rpc, `__kart.driving.yaw`);
    await evalJs(rpc, `__kart.driveKeys.press('left', true); "ok"`);
    await pump(60); // 2s 带舵
    const yaw1 = await evalJs(rpc, `__kart.driving.yaw`);
    check('赛道: 按【左】yaw 增大（屏幕左转，方向回归）', yaw1 > yaw0 + 0.02, `yaw ${yaw0.toFixed(3)} → ${yaw1.toFixed(3)}`);
    await evalJs(rpc, `__kart.driveKeys.press('left', false); "ok"`);
    await evalJs(rpc, '__kart.sim.steer = 0; "ok"');
    await evalJs(rpc, `__kart.driveKeys.press('up', false); "ok"`);

    // 镜像修正（R03 Bug1，用户报障"左右弯是反的"）：构建产物内的几何实测——
    // 首弯 MP1 在驾驶员系（right = forward × up = (−fz,fx)）必须是右弯，与俱乐部平面图同手性。
    const mirror = JSON.parse(await evalJs(rpc, `(() => {
      const T = __kart.track;
      const fwd = (s, sp) => {
        const a = T.pointAt(s - sp), b = T.pointAt(s + sp);
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
      };
      const g = fwd(60, 6), h = fwd(66, 6);
      return JSON.stringify({
        firstTurn: ((h.x - g.x) * -g.z + (h.z - g.z) * g.x) > 0 ? 'R' : 'L',
        kAt60: T.pointAt(60).k,
      });
    })()`));
    check('赛道: 首弯 MP1 驾驶员系右弯（与平面图同手性，R03 镜像）', mirror.firstTurn === 'R',
      `firstTurn=${mirror.firstTurn} k(s=60)=${mirror.kAt60.toFixed(3)}（右弯应 k<0）`);

    // 7.6 触屏驾驶层 CSS 门控（评审 #1）：body 无 touch-ui 类时驾驶层必须整体退出布局与命中测试。
    // 基线实况：styles.css 没有 .hud-touch 显隐规则（类只写不读），#hud-auto 停在 top:14/right:18
    // 正压顶栏「指南」→ 赛道模式帮助页不可达，驾驶按钮还与小地图互叠。
    {
      const touchProbe = () => evalJs(rpc, `(() => {
        const rect = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
        const disp = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : null; };
        const help = document.getElementById('btn-help');
        const hr = help.getBoundingClientRect();
        const hit = document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
        return JSON.stringify({
          layer: disp('.hud-touch'),
          // #hud-auto 自身规则是 display:flex，计算值不随父级隐藏而变——收口只能按"有没有布局盒"判
          autoLaidOut: (document.getElementById('hud-auto')?.getClientRects().length ?? 0) > 0,
          helpHit: help === hit || help.contains(hit),
          btnHelp: rect(document.getElementById('btn-help')),
          btnTrack: rect(document.getElementById('btn-track')),
          hudMap: rect(document.getElementById('hud-map')),
          hudBl: rect(document.getElementById('hud-bl')),
          autoBtn: rect(document.getElementById('hud-auto')),
          htBtns: [...document.querySelectorAll('.hud-touch .ht-btn')].map((b) => rect(b)),
        });
      })()`).then(JSON.parse);
      const lit = (on) => evalJs(rpc, `document.body.classList.toggle('touch-ui', ${on}); "ok"`);
      const overlapArea = (a, b) => (a && b
        ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
          * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        : 0);
      // 驾驶层每一个可点矩形 × 每一个应保持可达的面板/按钮（相交判据复用 overlapRect，面积只用于报障文本）
      const clashPairs = (g) => {
        const layer = [...g.htBtns, g.autoBtn].filter(Boolean);
        const targets = { btnHelp: g.btnHelp, btnTrack: g.btnTrack, hudMap: g.hudMap, hudBl: g.hudBl };
        const out = [];
        for (const [name, t] of Object.entries(targets)) {
          layer.forEach((l, i) => {
            if (overlapRect(l, t)) out.push(`${i}×${name}=${overlapArea(l, t).toFixed(0)}px²`);
          });
        }
        return out;
      };
      const sizeOf = (g) => [...g.htBtns, g.autoBtn].filter((r) => r && r.width > 0).length;

      await rpc('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
      await pump(2);
      await lit(false);
      const off = await touchProbe();
      check('触屏门控: 未点亮 touch-ui 时 .hud-touch display=none 且 #hud-auto 无布局盒',
        off.layer === 'none' && off.autoLaidOut === false, JSON.stringify({ layer: off.layer, autoLaidOut: off.autoLaidOut }));
      check('触屏门控: 未点亮时 elementFromPoint(指南按钮中心) 命中 #btn-help（帮助页可达）',
        off.helpHit === true, `helpHit=${off.helpHit}`);
      await lit(true);
      const on = await touchProbe();
      await lit(false);
      const offAgain = await touchProbe();
      check('触屏门控: 双向门控——加 body.touch-ui 即有布局盒、去掉即回 none',
        on.layer !== 'none' && on.autoLaidOut === true && offAgain.layer === 'none' && offAgain.autoLaidOut === false,
        JSON.stringify({ on: [on.layer, on.autoLaidOut], off: [offAgain.layer, offAgain.autoLaidOut] }));
      await lit(true);
      const wide = await touchProbe();
      check('触屏门控: 1600×900 点亮态驾驶层真实渲染（5 键 + 开关全有尺寸）',
        wide.htBtns.length === 5 && sizeOf(wide) === 6, JSON.stringify({ n: wide.htBtns.length, sized: sizeOf(wide) }));
      check('触屏门控: 1600×900 点亮态驾驶层与顶栏按钮/小地图/速度面板零重叠',
        clashPairs(wide).length === 0, clashPairs(wide).join(' '));
      check('触屏门控: 1600×900 点亮态「指南」仍可点（驾驶层不再截胡）', wide.helpHit === true);
      await rpc('Emulation.setDeviceMetricsOverride', { width: 1264, height: 625, deviceScaleFactor: 1, mobile: false });
      await pump(2);
      const narrow = await touchProbe();
      check('触屏门控: 1264×625（报障视口）点亮态驾驶层与 HUD/顶栏零重叠',
        clashPairs(narrow).length === 0 && narrow.helpHit === true,
        `${clashPairs(narrow).join(' ')} helpHit=${narrow.helpHit}`);
      await rpc('Emulation.clearDeviceMetricsOverride');
      await lit(false); // 还原桌面档，别把点亮态污染留给后续分组
      await pump(2);
    }

    // 7.7 最佳圈持久化（评审 #8）：换车/新会话首圈慢于存档纪录时，纪录不得被抹掉。
    // 布点方式：把会话最佳清零（= 报障场景"刚换车，st.bestLapMs 从 0 起算"；注意前面全油门
    // +左转那段已经真跑出一个 ~10s 的圈，不清零就测不到首圈语义），再把车放到起点线前 4m、
    // 给正向速度并回填 lapStart，泵帧走真实过线判定（crossedStartForward + 8s 防抖）。
    {
      const pumpLap = (lapMs) => evalJs(rpc, `(() => {
        const T = __kart.track, st = __kart.driving, s = __kart.sim;
        const p = T.pointAt(T.length - 4);
        st.x = p.x; st.z = p.z; st.yaw = p.yaw;
        const n = T.nearest(st.x, st.z, -1);
        st.s = n.s; st.hintIdx = n.idx;
        st.vx = 0; st.vz = 8; st.speed = 8; st.started = true;
        st.bestLapMs = 0; // 换车语义：会话内最佳归零
        st.lapStart = s.time - ${lapMs} / 1000;
        const lap0 = st.lap;
        for (let i = 0; i < 40; i++) __kart.step(1 / 30, 1, false);
        return JSON.stringify({ crossed: st.lap > lap0, best: Math.round(st.bestLapMs) });
      })()`).then(JSON.parse);
      const bestView = () => evalJs(rpc, `JSON.stringify({
        stored: localStorage.getItem('kart.bestLapMs'),
        shown: document.getElementById('hud-best').textContent,
      })`).then((t) => JSON.parse(t));
      await evalJs(rpc, `localStorage.setItem('kart.bestLapMs', '30000'); "ok"`);
      const slow = await pumpLap(40000);
      const slowView = await bestView();
      check('最佳圈: 前置条件成立（确实过线、会话最佳就是这圈 40s）',
        slow.crossed === true && slow.best > 39000 && slow.best < 42000, JSON.stringify(slow));
      check('最佳圈: 40s 慢圈不回退存档 30s 纪录（存储与显示同源）',
        slowView.stored === '30000' && slowView.shown === '0:30.0', JSON.stringify(slowView));
      const fast = await pumpLap(20000);
      const fastView = await bestView();
      check('最佳圈: 更快的圈才写盘（纪录仍可刷新，不是永不写）',
        fast.crossed === true && +fastView.stored > 19000 && +fastView.stored < 30000 && fastView.shown !== '0:30.0',
        JSON.stringify({ ...fast, ...fastView }));
      await evalJs(rpc, `localStorage.removeItem('kart.bestLapMs'); "ok"`); // 清场，不给后续分组留污染
    }

    // 退出练习：展台完整还原
    await evalJs(rpc, '__kart.exitTrack(); "ok"');
    await pump(30);
    const backState = JSON.parse(await evalJs(rpc, `JSON.stringify({
      mode: __kart.mode, y: __kart.getPart('rear-axle').group.position.y,
      hud: document.getElementById('track-hud').classList.contains('hidden'),
      throttle: __kart.sim.throttle, active: __kart.sim.drivingActive,
    })`));
    check('赛道: 退出后回展台（车回展台位、HUD 收起、驾驶态清零）',
      backState.mode === 'showroom' && Math.abs(backState.y - 0.145) < 1e-6 && backState.hud
        && backState.throttle === 0 && backState.active === false,
      JSON.stringify(backState));
    check('赛道: 退出后车手卸载（展台还原裸车）', await evalJs(rpc, `__kart.kart.getObjectByName('driver').visible === false`));

    // 8. 赛道·比赛模式（菜单 → 新锐组 → AI 同场竞技）
    await evalJs(rpc, '__kart.enterTrack(); "ok"');
    await evalJs(rpc, `document.querySelector('#track-menu [data-tier="rookie"]').click(); "ok"`);
    check('比赛: 菜单关闭并创建比赛', await evalJs(rpc, `document.getElementById('track-menu').classList.contains('hidden') && !!__kart.race`));
    check('比赛: 3 名 AI 已上发车格', await evalJs(rpc, `__kart.race.racers.length === 3 && __kart.race.racers.every((r) => isFinite(r.e.st.x))`));
    await pump(140); // ≈4.7s 越过倒计时（AI 反应延迟最慢 0.45s 也已起步）
    await pump(150); // 再 5s：AI 加速到可观测速度（起步打滑期物理口径见 tests/driving.test.js）
    const raceState = JSON.parse(await evalJs(rpc, `JSON.stringify({
      engine: __kart.sim.engineOn,
      aiSpeeds: __kart.race.racers.map((r) => +r.e.st.speed.toFixed(1)),
      hudPos: document.getElementById('hud-pos').textContent,
      hudLaps: document.getElementById('hud-laps').textContent,
      onTrack: __kart.race.racers.map((r) => Math.abs(__kart.track.nearest(r.e.st.x, r.e.st.z, r.e.st.hintIdx).lat).toFixed(1)),
      visuals: __kart.race.racers.every((r) => !!r.e.visual && r.e.visual.parent !== null),
    })`));
    check('比赛: GO 后玩家点火、AI 全部起步', raceState.engine === true && raceState.aiSpeeds.every((v) => v > 3),
      JSON.stringify(raceState));
    check('比赛: __kart.driving 指向当前受控车（P2-2）', await evalJs(rpc, `__kart.driving === __kart.race.playerE.st`));
    check('比赛: HUD 位次 P1-P4 + LAP x/3', /^P[1-4]$/.test(raceState.hudPos) && raceState.hudLaps === '/3',
      `${raceState.hudPos} ${raceState.hudLaps}`);
    check('比赛: AI 都在赛道上（横向偏移 < 半宽+缓冲）', raceState.onTrack.every((v) => Math.abs(+v) < 11),
      raceState.onTrack.join(','));
    check('比赛: AI 车体克隆已入场景', raceState.visuals === true);
    // 评审 #3：AI 轮角必须是 ∫ω·dt 的累加（帧率无关口径）。逐帧泵 20×(1/60) 并用同一 dt
    // 对 shell.wheelOmega 积分，与克隆轮子的实测角增量对账——把 rad/s 当 rad/帧累加时，
    // 实测值会是积分值的 60 倍（同场比赛 120Hz 手机与 60Hz 桌面轮速观感差一倍）。
    {
      const spin = JSON.parse(await evalJs(rpc, `(() => {
        const dt = 1 / 60, N = 20;
        const out = [];
        for (const r of __kart.race.racers) {
          let wheel = null;
          r.visual.traverse((o) => { if (o.userData?.partId === 'wheel-rr') wheel = o; });
          if (!wheel) return JSON.stringify({ err: 'AI 克隆找不到 wheel-rr' });
          const th0 = wheel.rotation.x;
          let acc = 0;
          for (let i = 0; i < N; i++) { __kart.step(dt, 1, false); acc += r.shell.wheelOmega * dt; }
          out.push({ measured: wheel.rotation.x - th0, integral: acc });
        }
        return JSON.stringify(out);
      })()`));
      const bad = Array.isArray(spin) === false
        ? (spin.err ?? 'unknown')
        : spin.filter((s) => Math.abs(s.integral) <= 1
          || Math.abs(s.measured - s.integral) > 1e-6 * Math.abs(s.integral))
          .map((s) => `实测${s.measured.toFixed(2)}rad vs ∫ω·dt ${s.integral.toFixed(2)}rad`).join(' | ');
      check('比赛: AI 车轮视觉滚动角 = ∫ω·dt（帧率无关，非每帧累加 rad/s）',
        bad === '' && Array.isArray(spin) && spin.length === 3, bad);
    }
    check('比赛: AI 克隆含可见车手且赛车服为本队涂装（paintRed 引用替换）', await evalJs(rpc,
      `__kart.race.racers.every((r) => {
        const d = r.visual.getObjectByName('driver');
        const suit = d && d.getObjectByName('driver-suit');
        return !!d && d.visible === true && !!suit && suit.material.color.getHexString() !== 'b61e2c';
      })`));
    check('K-A10: AI 号码牌按 userData 标记识别（clone(true) 后标记存活且已换队涂装）', await evalJs(rpc,
      `__kart.race.racers.every((r) => {
        let ok = false;
        r.visual.traverse((c) => { if (c.userData?.numberPlate === true && !!c.material?.map) ok = true; });
        return ok;
      })`));
    {
      await pump(2);
      const shotRace = await rpc('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT_DIR, '07-race.png'), Buffer.from(shotRace.data, 'base64'));
      console.log('  截图 .tmp/smoke/07-race.png');
    }
    // 冲线结算回归（BUG 3 全链路）：置玩家完成 3 圈 → 真实比赛流出结算面板 →
    // 「更换模式」回菜单。基线红点 = 点击后结算容器 display 仍为 flex（残影层截胡菜单）。
    await evalJs(rpc, '__kart.driving.lap = 3; "ok"');
    await pump(3);
    const fin = JSON.parse(await evalJs(rpc, `JSON.stringify({
      over: __kart.race.over,
      results: __kart.menu.resultsVisible,
      menu: __kart.menu.menuVisible,
    })`));
    check('比赛: 玩家冲线出结算面板（race.over + 结果可见 + 菜单收起）',
      fin.over && fin.results && !fin.menu, JSON.stringify(fin));
    const meRow = await evalJs(rpc, `!!document.querySelector('#tm-results .tm-row.me')`);
    check('K-A4: 结算含玩家行（buildResults 契约：name/isPlayer/finished/finishTime/lapTimeMs）', meRow === true);
    const menuHit = await evalJs(rpc, `(() => {
      const btn = document.querySelector('#tm-results [data-mode="menu"]');
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return btn === el || btn.contains(el);
    })()`);
    check('结算: 「更换模式」按钮 elementFromPoint 命中自身', menuHit === true);
    await evalJs(rpc, `document.querySelector('#tm-results [data-mode="menu"]').click(); "ok"`);
    await pump(2);
    const backMenu = JSON.parse(await evalJs(rpc, `JSON.stringify({
      menu: __kart.menu.menuVisible,
      results: getComputedStyle(document.getElementById('tm-results')).display,
      panel: getComputedStyle(document.getElementById('tm-panel')).display,
    })`));
    check('结算: 点「更换模式」→ 菜单回归且结算容器真实隐藏（回归 BUG 根因）',
      backMenu.menu === true && backMenu.results === 'none' && backMenu.panel !== 'none',
      JSON.stringify(backMenu));

    // 弃赛回菜单（Esc 语义）→ 再退出
    await evalJs(rpc, '__kart.exitTrack(); "ok"');
    await pump(10);
    check('比赛: 退出后比赛清理干净', await evalJs(rpc, `__kart.race === null && document.getElementById('track-menu').classList.contains('hidden')`));

        // 9. 手机视口组（390×844 + touch 仿真，任务包 §1.2 验收口径）
    // 触屏仿真必须在应用创建【前】启用（isTouch 在启动时采样），故本组自带头加载。
    // 先红后绿：M-A~M-F 在未修复基线上为红（见交付说明红绿记录）。
    await rpc('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await rpc('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await rpc('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0' });
    await rpc('Page.navigate', { url: PAGE_URL + '?debug=1' });
    await waitFor(() => evalJs(rpc, '!!window.__kart'), '手机视口应用启动');
    await pump(5);
    // N4 ?debug=1 诊断浮层（防御性修复 D4 的验收；先红：基线无此浮层）
    {
      const diag = JSON.parse(await evalJs(rpc, `JSON.stringify({
        exists: !!document.getElementById('diag-overlay'),
        text: (document.getElementById('diag-overlay')?.textContent ?? '').slice(0, 160),
      })`));
      check('手机: ?debug=1 诊断浮层可见且含视口/DPR/touch 信息（D4）',
        diag.exists && diag.text.includes('x') && diag.text.includes('touch:'), `text="${diag.text}"`);
    }
    const mgeo = () => evalJs(rpc, `(() => {
      const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect().toJSON() ?? null;
      return JSON.stringify({
        vw: innerWidth, vh: innerHeight,
        touchLit: document.body.classList.contains('touch-ui'),
        topbar: rect('#topbar'),
        btnTrack: rect('#btn-track'),
        hudTop: rect('.hud-top'),
        hudBl: rect('.hud-bl'),
        hudBr: rect('.hud-br'),
        hint: rect('.hud-hint'),
        hintHidden: getComputedStyle(document.querySelector('.hud-hint')).display === 'none',
        hudMap: rect('#hud-map'),
        htLeft: [...document.querySelectorAll('.ht-left .ht-btn')].map((b) => b.getBoundingClientRect().toJSON()),
        htRight: [...document.querySelectorAll('.ht-right .ht-btn')].map((b) => b.getBoundingClientRect().toJSON()),
        auto: rect('#hud-auto'),
        menuVisible: !document.getElementById('track-menu').classList.contains('hidden'),
      });
    })()`).then(JSON.parse);

    // M-0 入口可见可点（守护：基线即绿，不计入先红清单）
    {
      const g = await mgeo();
      check('手机: 顶栏上赛道入口在视口内且有可点尺寸',
        g.btnTrack && g.btnTrack.left >= 0 && g.btnTrack.right <= g.vw && g.btnTrack.width > 32 && g.btnTrack.height > 24,
        JSON.stringify(g.btnTrack));
    }
    // 进赛道 → 菜单（守护：基线即绿）
    await evalJs(rpc, '__kart.enterTrack(); "ok"');
    await pump(5);
    {
      const g = await mgeo();
      const card = JSON.parse(await evalJs(rpc, `JSON.stringify((() => {
        const card = document.querySelector('.tm-card');
        const r = card.getBoundingClientRect();
        const buttons = [...card.querySelectorAll('.tm-item')].map((b) => b.getBoundingClientRect().toJSON());
        return { r, buttons, inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
      })())`));
      const cardCss = JSON.parse(await evalJs(rpc, `JSON.stringify((() => {
        const cs = getComputedStyle(document.querySelector('.tm-card'));
        return { position: cs.position, zIndex: cs.zIndex, bgAlpha: cs.backgroundColor.startsWith('rgba') ? +cs.backgroundColor.split(',')[3].replace(')', '') : 1 };
      })())`));
      check('手机: 菜单卡片独立层叠（非 static、z≥1、不透明底，D2）',
        cardCss.position !== 'static' && +cardCss.zIndex >= 1 && cardCss.bgAlpha === 1,
        JSON.stringify(cardCss));
      check('手机: 模式菜单完整显示、五个按钮均在视口内有可点尺寸',
        g.menuVisible && card.inViewport && card.buttons.every((b) => b.width > 100 && b.height > 32 && b.left >= 0 && b.right <= g.vw),
        `card=${JSON.stringify(card.r)}`);
    }
    // 选练习 → 倒计时中采集 HUD 几何（M-A~M-E，先红组）
    await evalJs(rpc, `document.querySelector('#track-menu [data-mode="practice"]').click(); "ok"`);
    await pump(10);
    {
      const g = await mgeo();
      check('手机: 顶栏不被圈速面板覆盖（hud-top 在顶栏下方）',
        g.hudTop && g.topbar && g.hudTop.top >= g.topbar.bottom - 1, `hudTop.top=${g.hudTop.top.toFixed(1)} topbar.bottom=${g.topbar.bottom.toFixed(1)}`);
      // 门控生效的前置证据（守护）：手机档 boot 即点亮 touch-ui，驾驶层必须真的在画面上——
      // 否则下面三条"不遮挡"会因为元素被 display:none 压成 0×0 而空过。
      check('手机: 触屏驾驶层已点亮且按钮真实有尺寸（重叠断言非空过）',
        g.touchLit === true && g.htLeft.every((b) => b.width > 40) && g.htRight.every((b) => b.width > 40),
        `lit=${g.touchLit} htLeft=${g.htLeft.length} htRight=${g.htRight.length}`);
      check('手机: 触屏◀▶已渲染且不遮挡速度面板',
        g.htLeft.length === 2 && g.htLeft.every((b) => !overlapRect(b, g.hudBl)), JSON.stringify({ bl: g.hudBl, htLeft: g.htLeft }));
      check('手机: 油门/刹车/漂移已渲染且不遮挡小地图',
        g.htRight.length === 3 && g.htRight.every((b) => !overlapRect(b, g.hudBr)), JSON.stringify({ br: g.hudBr, htRight: g.htRight }));
      check('手机: 操作提示不溢出视口且不压速度面板/小地图画布（触屏显示触屏提示）',
        (g.hintHidden || (g.hint.left >= 0 && g.hint.right <= g.vw && !overlapRect(g.hint, g.hudBl) && !overlapRect(g.hint, g.hudMap))),
        g.hintHidden ? 'hidden' : `hint=[${g.hint.left.toFixed(0)},${g.hint.top.toFixed(0)},${g.hint.right.toFixed(0)},${g.hint.bottom.toFixed(0)}]`);
      check('手机: 自动油门开关不与顶栏重叠', !overlapRect(g.auto, g.topbar), JSON.stringify({ auto: g.auto, topbar: g.topbar }));
      // N1/N2 真机 GPU 合成盲区防御：毛玻璃(backdrop-filter)在部分移动 GPU 上会把全屏遮罩
      // 及其子树渲染成不可交互的模糊层（本次报障的最佳解释，仿真不可复现）——
      // 手机视口下赛道 UI 一律禁用（先红：基线 .tm-wrap/.hud-* 均有 blur）
      const bf = JSON.parse(await evalJs(rpc, `JSON.stringify({
        tmWrap: getComputedStyle(document.querySelector('.tm-wrap')).backdropFilter,
        hudTop: getComputedStyle(document.querySelector('.hud-top')).backdropFilter,
        hudBl: getComputedStyle(document.querySelector('.hud-bl')).backdropFilter,
        hudMap: getComputedStyle(document.querySelector('#hud-map')).backdropFilter,
        htBtn: getComputedStyle(document.querySelector('.ht-btn')).backdropFilter,
      })`));
      const bfVals = Object.values(bf);
      check('手机: 菜单遮罩无 backdrop-filter（N1）', bf.tmWrap === 'none', `tmWrap=${bf.tmWrap}`);
      check('手机: 赛道 HUD 面板无 backdrop-filter（N2）', bfVals.every((v) => v === 'none'), JSON.stringify(bf));
    }
    // M-F 触屏◀真实按压 → 转向输入进入 sim（先红：接线断时恒 0）
    {
      const steer0 = await evalJs(rpc, '__kart.sim.steer');
      await evalJs(rpc, `document.querySelector('.ht-btn[data-press="left"]').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true, pointerType: 'touch' })); "ok"`);
      await evalJs(rpc, '__kart.step(1 / 60, 40); "ok"'); // 泵 0.67s 模拟时间（不依赖 rAF 帧率）
      const steer1 = await evalJs(rpc, '__kart.sim.steer');
      check('手机: 触屏◀按压产生真实转向输入（steer < -0.05）', steer1 < -0.05, `steer ${steer0} → ${steer1.toFixed(3)}`);
      await evalJs(rpc, `document.querySelector('.ht-btn[data-press="left"]').dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, bubbles: true, pointerType: 'touch' })); "ok"`);
      await evalJs(rpc, '__kart.step(1 / 60, 60); "ok"');
      const steer2 = await evalJs(rpc, '__kart.sim.steer');
      check('手机: 松开触屏转向后自动回正（steer 归零）', Math.abs(steer2) < 0.02, `steer=${steer2.toFixed(3)}`);
      await evalJs(rpc, '__kart.sim.steer = 0; "ok"');
    }
    // M-G 油门踏板：按住加速、松开滑行（报障①"车一直加速"的修复证据）
    // 自动油门默认关闭（手动双踏板为默认方案）；输入通道断言与倒计时锁定期解耦。
    // dispatch 走守卫形式：按钮不存在（未修复基线）时记 null，断言红而不是脚本崩。
    {
      const autoOn = await evalJs(rpc, `document.getElementById('hud-auto')?.classList.contains('on')`);
      check('手机: 自动油门默认关闭（手动双踏板为默认方案）', autoOn === false, `autoOn=${autoOn}`);
      const pressBtn = (sel, id, type) =>
        `(() => { const b = document.querySelector('${sel}'); if (b) b.dispatchEvent(new PointerEvent('${type}', { pointerId: ${id}, bubbles: true, pointerType: 'touch' })); return !!b; })()`;
      await evalJs(rpc, pressBtn('.ht-btn[data-press="up"]', 11, 'pointerdown'));
      await evalJs(rpc, '__kart.step(1 / 60, 60); "ok"'); // 1s 按住油门
      const tOn = await evalJs(rpc, '__kart.sim.throttle');
      await evalJs(rpc, pressBtn('.ht-btn[data-press="up"]', 11, 'pointerup'));
      await evalJs(rpc, '__kart.step(1 / 60, 45); "ok"'); // 0.75s 松开滑行
      const tOff = await evalJs(rpc, '__kart.sim.throttle');
      check('手机: 按住油门 → 油门升到 ~100%', tOn > 0.9, `throttle=${tOn.toFixed(2)}`);
      check('手机: 松开油门 → 自然滑行收油（throttle<0.2，修复"车一直加速"）', tOff < 0.2, `throttle=${tOff.toFixed(2)}`);
    }
    // M-H 触屏刹车渐进：点刹部分制动、按住到满、松开回弹（报障②"点刹车直接刹停"的修复证据）
    {
      const pressBtn = (sel, id, type) =>
        `(() => { const b = document.querySelector('${sel}'); if (b) b.dispatchEvent(new PointerEvent('${type}', { pointerId: ${id}, bubbles: true, pointerType: 'touch' })); return !!b; })()`;
      await evalJs(rpc, pressBtn('.ht-btn[data-press="brake"]', 12, 'pointerdown'));
      await evalJs(rpc, '__kart.step(1 / 60, 6); "ok"'); // 0.1s 点刹
      const bTap = await evalJs(rpc, '__kart.sim.brakeTarget');
      await evalJs(rpc, '__kart.step(1 / 60, 30); "ok"'); // 累计 0.6s 按住 → 行程到底
      const bFull = await evalJs(rpc, '__kart.sim.brakeTarget');
      await evalJs(rpc, pressBtn('.ht-btn[data-press="brake"]', 12, 'pointerup'));
      await evalJs(rpc, '__kart.step(1 / 60, 20); "ok"'); // 松开 0.33s 回弹
      const bRel = await evalJs(rpc, '__kart.sim.brakeTarget');
      check('手机: 点刹 0.1s → 部分制动（0.05<brakeTarget<0.9，不再一点就满）', bTap > 0.05 && bTap < 0.9, `brakeTarget=${bTap.toFixed(2)}`);
      check('手机: 按住 0.6s → 行程到满（brakeTarget=1）', bFull === 1, `brakeTarget=${bFull}`);
      check('手机: 松开 0.33s → 回弹放空（brakeTarget=0）', bRel === 0, `brakeTarget=${bRel}`);
    }
    // M-J 自动油门开关持久化（设置跨刷新保留）+ 油门键置灰反馈
    {
      await evalJs(rpc, `document.getElementById('hud-auto')?.click(); "ok"`);
      const stored = await evalJs(rpc, `localStorage.getItem('kart.autoThrottle')`);
      const gasInert = await evalJs(rpc, `document.querySelector('.ht-btn[data-press="up"]')?.classList.contains('inert')`);
      check('手机: 自动油门开启即持久化且油门键置灰', stored === '1' && gasInert === true, `stored=${stored} inert=${gasInert}`);
      await evalJs(rpc, `document.getElementById('hud-auto')?.click(); "ok"`); // 还原默认（关）
      const storedOff = await evalJs(rpc, `localStorage.getItem('kart.autoThrottle')`);
      check('手机: 自动油门关闭状态持久化', storedOff === '0', `stored=${storedOff}`);
    }
    // 手机比赛流程（守护：桌面段已覆盖核心，这里验证位次在 GO 后正确显示）
    await evalJs(rpc, '__kart.exitTrack(); "ok"');
    await pump(5);
    await evalJs(rpc, '__kart.enterTrack(); "ok"');
    await pump(5);
    await evalJs(rpc, `document.querySelector('#track-menu [data-tier="rookie"]').click(); "ok"`);
    await pump(180); // 6s：倒计时走完、AI 起步
    {
      const rs = JSON.parse(await evalJs(rpc, `JSON.stringify({
        pos: document.getElementById('hud-pos').textContent,
        laps: document.getElementById('hud-laps').textContent,
        aiOnTrack: __kart.race.racers.every((r) => isFinite(r.e.st.x)),
      })`));
      check('手机: 比赛 GO 后位次 P1-P4 与 LAP x/3 正常显示', /^P[1-4]$/.test(rs.pos) && rs.laps === '/3' && rs.aiOnTrack,
        JSON.stringify(rs));
    }
    // 返回展台：小屏展台体验与进赛道前一致（守护）
    await evalJs(rpc, '__kart.exitTrack(); "ok"');
    await pump(10);
    {
      const g = await mgeo();
      check('手机: 返回展台后顶栏入口仍可见可点', g.btnTrack && g.btnTrack.left >= 0 && g.btnTrack.right <= g.vw && g.btnTrack.width > 32,
        JSON.stringify(g.btnTrack));
    }
    await rpc('Emulation.clearDeviceMetricsOverride');
    await rpc('Emulation.setTouchEmulationEnabled', { enabled: false });
    await pump(5);

    const realErrors = consoleErrors.filter((e) => !e.includes('injected rollback probe')); // K-A1 注入探针的预期日志
    check('控制台零报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
    close();
  } finally {
    killTree(chrome);
    killTree(preview);
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('冒烟失败:', e.message);
  if (e.stack) console.error(e.stack.split(String.fromCharCode(10)).slice(0, 6).join(String.fromCharCode(10)));
  process.exit(1);
});
