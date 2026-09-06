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

    // 5. 装配态截图（整车 / 传动特写）
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

    check('控制台零报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
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
  process.exit(1);
});
