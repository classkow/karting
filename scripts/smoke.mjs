// ————— 无头浏览器冒烟验证（零依赖：Node ≥22 内置 WebSocket + fetch）—————
// 用法：npm run smoke（需先 npm run build）
// 流程：起 vite preview → 拉起 headless Chrome（CDP）→ 加载页面 → 断言机构运动 → 截图
// 产物：.tmp/smoke/*.png（不入库）。退出码非零即失败。
//
// 设计要点：
// - headless Chrome（swiftshader）不按正常节奏驱动 rAF，运动采样改用
//   __kart.step(dt, n) 手动泵帧（确定性、不受帧率影响）；截图仍走 Page.captureScreenshot。
// - preview 端口被占用时直接失败（strictPort），避免误测到陈旧服务的旧产物。
// - vite preview 在本机绑定 localhost(::1)，直连 127.0.0.1 会被拒。

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PREVIEW_PORT = 41987;
const CDP_PORT = 9223;
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

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // 1. 起 preview（直接调 node + vite 入口，绕开 Windows 上 spawn .cmd 的 EINVAL）
  const preview = spawn(process.execPath,
    [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'pipe' });
  await waitFor(async () => (await fetch(PAGE_URL)).ok, 'vite preview 就绪');

  // 2. 拉起 headless Chrome
  const chrome = spawn(findChrome(), [
    '--headless=new', '--use-angle=swiftshader', '--mute-audio', '--no-first-run',
    `--remote-debugging-port=${CDP_PORT}`, '--window-size=1600,900',
    `--user-data-dir=${join(ROOT, '.tmp', 'chrome-profile')}`, 'about:blank',
  ], { stdio: 'pipe' });

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

    const pump = (n) => evalJs(rpc, `__kart.step(1/60, ${n}); "ok"`);

    // 3. 机构运动采样：启动发动机并泵帧，前后对比
    await evalJs(rpc, '__kart.sim.startEngine(); __kart.sim.throttle = 1; "ok"');
    await pump(120); // 拖转 0.9s + 油门拉升
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
    await pump(30);
    const s1 = JSON.parse(await evalJs(rpc, sampleExpr));
    check('发动机点火并拉升转速', s1.rpm > 2000, `rpm=${s1.rpm}`);
    for (const k of Object.keys(s0)) {
      if (k === 'rpm') continue;
      check(`机构运动: ${k} 随引擎转动`, Math.abs(s1[k] - s0[k]) > 1e-6, `${s0[k].toFixed(4)} → ${s1[k].toFixed(4)}`);
    }

    // 4. 阿克曼：满舵时左右轮转角不相等
    await evalJs(rpc, '__kart.sim.steer = 1; "ok"');
    await pump(40);
    const steer = JSON.parse(await evalJs(rpc, `JSON.stringify({
      l: __kart.getPart('spindle-l').group.rotation.y,
      r: __kart.getPart('spindle-r').group.rotation.y,
    })`));
    check('阿克曼几何: 满舵左右轮转角不同', Math.abs(Math.abs(steer.l) - Math.abs(steer.r)) > 0.01,
      `L=${steer.l.toFixed(4)} R=${steer.r.toFixed(4)}`);
    await evalJs(rpc, '__kart.sim.steer = 0; "ok"');
    await pump(40);

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

    // 6. 爆炸分解（截图放最后，避免污染装配态画面）
    await evalJs(rpc, '__kart.explode.setTarget(1); "ok"');
    await pump(60);
    const exploded = JSON.parse(await evalJs(rpc, `JSON.stringify({
      y: __kart.getPart('seat').group.position.y,
      e: __kart.explode.get(),
    })`));
    check('爆炸分解: 座椅上移', exploded.e > 0.9 && exploded.y > 0.1, `explode=${exploded.e.toFixed(2)} seatY=${exploded.y.toFixed(3)}`);

    await shot('03-explode.png', [2.4, 1.6, 2.4], [0, 0.5, 0]);
    await evalJs(rpc, '__kart.explode.setTarget(0); "ok"');

    check('控制台零报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    close();
  } finally {
    chrome.kill();
    preview.kill();
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('冒烟失败:', e.message);
  process.exit(1);
});
