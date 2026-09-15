// ————— 多角度截图工具（复用 smoke 的 CDP 管线；产物 .tmp/shots/*.png）—————
// 每个 shot: { name, setup?, pos, tgt, frames?, dt? }
// - setup: 截图前的页面侧准备（进赛道/选模式等）
// - pos/tgt: 页面侧 JS 表达式（逗号分隔三数），相机在泵帧后设置、再泵 1 帧呈现
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PREVIEW_PORT = 40000 + (process.pid % 10000);
const CDP_PORT = 20000 + (process.pid % 10000);
const CDP_URL = `http://localhost:${CDP_PORT}`;
const PROFILE_DIR = join(ROOT, '.tmp', `chrome-profile-${process.pid}`);
const PAGE_URL = `http://localhost:${PREVIEW_PORT}/`;
const OUT_DIR = join(ROOT, '.tmp', 'shots');
const TIMEOUT = 60_000;

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
  throw new Error('未找到 Chrome/Edge');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = TIMEOUT) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { }
    if (Date.now() - t0 > timeout) throw new Error(`等待超时: ${what}`);
    await sleep(300);
  }
}
async function connectCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连接失败')); });
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
    }
  };
  return {
    rpc: (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++msgId; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    }),
    close: () => ws.close(),
  };
}
async function evalJs(rpc, expression) {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`页面执行失败: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
  return r.result.value;
}
function killTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(proc.pid), '/F', '/T'], { stdio: 'ignore' });
  else { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); } }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const SHOTS = JSON.parse(process.argv[2] ?? '[]');
  const preview = spawn(process.execPath,
    [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'pipe' });
  let ready = false;
  // eslint-disable-next-line no-control-regex -- 匹配 ANSI 色码是本行的唯一目的
  const ANSI = /\x1b\[[0-9;]*m/g;
  preview.stdout.on('data', (d) => { if (String(d).replace(ANSI, '').includes('Local:')) ready = true; });
  await waitFor(() => ready, 'vite preview');
  const chrome = spawn(findChrome(), [
    '--headless=new', '--use-angle=swiftshader', '--mute-audio', '--no-first-run',
    `--remote-debugging-port=${CDP_PORT}`, '--window-size=1400,1400',
    `--user-data-dir=${PROFILE_DIR}`, 'about:blank',
  ], { stdio: 'pipe' });
  try {
    const target = await waitFor(async () => {
      const list = await (await fetch(`${CDP_URL}/json/list`)).json();
      return list.find((t) => t.type === 'page');
    }, 'CDP target');
    const { rpc, close } = await connectCDP(target.webSocketDebuggerUrl);
    await rpc('Runtime.enable');
    await rpc('Page.enable');
    await rpc('Page.navigate', { url: PAGE_URL });
    await waitFor(() => evalJs(rpc, '!!window.__kart'), '应用启动');
    let first = true;
    for (const shot of SHOTS) {
      if (!first) {
        await rpc('Page.navigate', { url: PAGE_URL });
        await waitFor(() => evalJs(rpc, '!!window.__kart'), '重载应用');
      }
      first = false;
      if (shot.setup) await evalJs(rpc, shot.setup);
      await evalJs(rpc, `__kart.step(${shot.dt ?? '1/30'}, ${shot.frames ?? 2}, true); 'ok'`);
      const camInfo = await evalJs(rpc, `(() => {
        const c = __kart.camera;
        __kart.step(1/30, 60, true); // 冲完残留的 rig 补间（无头环境 rAF 稀疏，启动补间长期未完成）
        c.position.set(${shot.pos});
        __kart.controls.target.set(${shot.tgt ?? '0, 0.3, 0'});
        __kart.controls.update();
        __kart.step(1/30, 1, true);
        return JSON.stringify(__kart.camera.position.toArray().map((v) => +v.toFixed(2)));
      })()`);
      const img = await rpc('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT_DIR, shot.name), Buffer.from(img.data, 'base64'));
      console.log('  截图', shot.name, 'cam=', camInfo);
    }
    close();
  } finally {
    killTree(chrome);
    killTree(preview);
  }
}
main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
