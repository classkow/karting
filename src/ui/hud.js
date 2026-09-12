import { DRIVE_CAMS } from '../interaction/driveCamera.js';

// ————— 赛道 HUD：圈速计时 / 迷你转速表 / 小地图 / 倒计时 / 触屏驾驶 —————
// DOM 写入全部节流：速度/时间 10Hz、转速条与小地图 30Hz、圈数与消息仅在变化时写。
// 最佳圈经 storage 持久化（file:// 与隐私模式下由调用方注入的 storage 兜底）。

const fmtMs = (ms) => {
  if (!ms) return '--:--.-';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
};

export function initTrackHUD(container, { track, storage, onCamCycle, onExit, onHold, touch = false }) {
  container.innerHTML = `
    <div class="hud-top">
      <span class="hud-lap">LAP <b id="hud-lap">0</b><i id="hud-laps" class="hidden">/3</i></span>
      <span class="hud-pos hidden" id="hud-pos">P–</span>
      <span class="hud-cur" id="hud-cur">0:00.0</span>
      <span class="hud-sub">上次 <b id="hud-last">--:--.-</b></span>
      <span class="hud-sub">最佳 <b id="hud-best">${fmtMs(+(storage.get('kart.bestLapMs') || 0))}</b></span>
    </div>
    <div class="hud-center" id="hud-center"></div>
    <div class="hud-bl">
      <div class="hud-speed"><b id="hud-speed">0</b><i>km/h</i></div>
      <div class="hud-clutch" id="hud-clutch">离合分离</div>
      <canvas id="hud-tach" width="150" height="46"></canvas>
    </div>
    <div class="hud-br">
      <canvas id="hud-map" width="168" height="168"></canvas>
      <div class="hud-btns">
        <button id="hud-cam" class="ghost sm">${DRIVE_CAMS[0].label} <kbd>V</kbd></button>
        <button id="hud-exit" class="ghost sm">返回展台 <kbd>Esc</kbd></button>
      </div>
    </div>
    <div class="hud-hint" id="hud-hint">W 油门 · S 刹车/倒车 · A/D 转向 · Shift 漂移 · V 换视角 · R 回到起点</div>
    ${touch ? `
    <div class="hud-touch">
      <div class="ht-group ht-left">
        <button class="ht-btn" data-press="left">◀</button>
        <button class="ht-btn" data-press="right">▶</button>
      </div>
      <div class="ht-group ht-right">
        <button class="ht-btn ht-sm" data-press="drift">漂移</button>
        <button class="ht-btn ht-sm" data-press="brake">刹车</button>
      </div>
      <button id="hud-auto" class="tg on"><span>自动油门</span></button>
    </div>` : ''}
  `;

  const $ = (s) => container.querySelector(s);
  const elLap = $('#hud-lap');
  const elLaps = $('#hud-laps');
  const elPos = $('#hud-pos');
  const elCur = $('#hud-cur');
  const elLast = $('#hud-last');
  const elBest = $('#hud-best');
  const elSpeed = $('#hud-speed');
  const elClutch = $('#hud-clutch');
  const elCenter = $('#hud-center');
  const elHint = $('#hud-hint');
  const tach = $('#hud-tach');
  const tachCtx = tach.getContext('2d');
  const map = $('#hud-map');
  const mapCtx = map.getContext('2d');

  $('#hud-cam').addEventListener('click', () => onCamCycle?.());
  $('#hud-exit').addEventListener('click', () => onExit?.());
  const autoBtn = $('#hud-auto');
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      autoThrottle = !autoThrottle;
      autoBtn.classList.toggle('on', autoThrottle);
    });
  }

  let autoThrottle = true; // 触屏默认自动油门
  let lastLapShown = -1;
  let lastBestShown = 0;
  let prevBoost = 0;
  let wrongWayShown = false;
  let hintTimer = 0;
  let mapScale = null;
  let raceInfo = null; // { pos, total, laps }（比赛模式）

  // —— 小地图底图：赛道中心线一次性预渲染 ——
  const mapBase = document.createElement('canvas');
  mapBase.width = map.width;
  mapBase.height = map.height;
  {
    const c = mapBase.getContext('2d');
    const S = track.samples;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const sp of S) {
      minX = Math.min(minX, sp.x); maxX = Math.max(maxX, sp.x);
      minZ = Math.min(minZ, sp.z); maxZ = Math.max(maxZ, sp.z);
    }
    const pad = 14;
    const scale = Math.min((map.width - pad * 2) / (maxX - minX), (map.height - pad * 2) / (maxZ - minZ));
    const px = (x) => pad + (x - minX) * scale + ((map.width - pad * 2) - (maxX - minX) * scale) / 2;
    const py = (z) => map.height - (pad + (z - minZ) * scale + ((map.height - pad * 2) - (maxZ - minZ) * scale) / 2);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(10,14,20,0.88)';
    c.lineWidth = Math.max(5, track.width * scale);
    c.beginPath();
    S.forEach((sp, i) => (i ? c.lineTo(px(sp.x), py(sp.z)) : c.moveTo(px(sp.x), py(sp.z))));
    c.closePath();
    c.stroke();
    c.strokeStyle = 'rgba(126,148,175,0.55)';
    c.lineWidth = 1.4;
    c.stroke();
    // 起点线缺口标记
    const st0 = track.samples[track.startIndex];
    c.fillStyle = '#ffb547';
    c.beginPath();
    c.arc(px(st0.x), py(st0.z), 3.2, 0, Math.PI * 2);
    c.fill();
    mapScale = { px, py, scale };
  }

  // —— 触屏按钮：按下/抬起统一走回调（app 接到 driveKeys 的持续输入通道）——
  container.querySelectorAll('.ht-btn').forEach((btn) => {
    const dir = btn.dataset.press;
    const down = (e) => { e.preventDefault(); onHold?.(dir, true); btn.classList.add('active'); };
    const up = (e) => { e.preventDefault(); onHold?.(dir, false); btn.classList.remove('active'); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  });

  const setCenter = (html) => {
    if (html === null) { elCenter.innerHTML = ''; elCenter.classList.remove('show'); return; }
    if (elCenter.innerHTML !== html) { elCenter.innerHTML = html; }
    elCenter.classList.add('show');
  };

  return {
    autoThrottle: () => autoThrottle,
    // 比赛信息（null = 练习模式，隐藏位次与 /3）
    setRaceInfo(info) {
      raceInfo = info;
    },

    // 大字消息（倒计时/GO）
    setCountdown(n) {
      if (n == null) { setCenter(null); return; }
      setCenter(n === 'go' ? '<b class="hud-go">GO!</b>' : `<b class="hud-count">${n}</b>`);
    },
    flashBoost() {
      setCenter('<b class="hud-boost">BOOST!</b>');
      setTimeout(() => { if (elCenter.querySelector('.hud-boost')) setCenter(null); }, 900);
    },

    // 每帧遥测（内部按通道节流写 DOM）；others = 比赛 AI 的 {x,z} 列表（小地图灰点）
    frame(sim, st, dt, others = null) {
      // 圈数（变化时）；比赛模式附加 x/3 与位次
      if (st.lap !== lastLapShown) {
        lastLapShown = st.lap;
        elLap.textContent = st.lap;
      }
      if (raceInfo) {
        const lapTxt = `/${raceInfo.laps}`;
        if (elLaps.textContent !== lapTxt) elLaps.textContent = lapTxt;
        elLaps.classList.remove('hidden');
        elPos.classList.remove('hidden');
        const posTxt = `P${raceInfo.pos}`;
        if (elPos.textContent !== posTxt) elPos.textContent = posTxt;
      } else {
        elLaps.classList.add('hidden');
        elPos.classList.add('hidden');
      }
      // 最佳圈（变化时 + 持久化）
      if (st.bestLapMs && st.bestLapMs !== lastBestShown) {
        lastBestShown = st.bestLapMs;
        elBest.textContent = fmtMs(st.bestLapMs);
        try { storage.set('kart.bestLapMs', String(Math.round(st.bestLapMs))); } catch { /* 忽略 */ }
      }
      // 计时/速度（10Hz）
      this._acc = (this._acc ?? 1) + dt;
      if (this._acc > 0.1) {
        this._acc = 0;
        elCur.textContent = st.started ? fmtMs((sim.time - st.lapStart) * 1000) : '0:00.0';
        elLast.textContent = fmtMs(st.lastLapMs);
        elSpeed.textContent = Math.round(st.speed * 3.6);
        elClutch.textContent = sim.engineOn
          ? (sim.rpm > 3900 ? '离合接合' : '离合分离')
          : '引擎未运转';
      }
      // 迷你转速条 + 小地图（30Hz）
      this._tachAcc = (this._tachAcc ?? 1) + dt;
      if (this._tachAcc > 1 / 30) {
        this._tachAcc = 0;
        drawTach(sim.rpm);
        drawMap(st, others);
      }
      // 逆行警告
      const wrong = st.wrongWayT > 1.2;
      if (wrong !== wrongWayShown) {
        wrongWayShown = wrong;
        if (wrong) setCenter('<b class="hud-wrong">⚠ 逆行</b>');
        else setCenter(null);
      }
      // 漂移出弯 BOOST（上升沿）
      if (st.boostT > 0 && prevBoost <= 0) this.flashBoost();
      prevBoost = st.boostT;
      // 操作提示 8s 后淡出
      if (hintTimer < 9) {
        hintTimer += dt;
        if (hintTimer >= 9) elHint.classList.add('fade');
      }
    },

    setCam(cfg) {
      $('#hud-cam').innerHTML = `${cfg.label} <kbd>V</kbd>`;
    },
  };

  function drawTach(rpm) {
    const w = tach.width;
    const h = tach.height;
    tachCtx.clearRect(0, 0, w, h);
    const v = Math.min(rpm / 14000, 1);
    const red = 13300 / 14000;
    // 底槽
    tachCtx.fillStyle = '#1d2530';
    tachCtx.fillRect(0, h - 12, w, 8);
    // 红区
    tachCtx.fillStyle = 'rgba(255,93,93,0.4)';
    tachCtx.fillRect(w * red, h - 12, w * (1 - red), 8);
    // 当前值
    tachCtx.fillStyle = v > red ? '#ff5d5d' : '#ffb547';
    tachCtx.fillRect(0, h - 12, w * v, 8);
    tachCtx.fillStyle = '#8fa0b4';
    tachCtx.font = "10px Consolas, monospace";
    tachCtx.fillText('RPM', 0, h - 16);
    tachCtx.fillStyle = '#e8edf4';
    tachCtx.fillText(Math.round(rpm).toLocaleString('zh-CN'), w - 62, h - 16);
  }

  function drawMap(st, others = null) {
    if (!mapScale) return;
    mapCtx.clearRect(0, 0, map.width, map.height);
    mapCtx.drawImage(mapBase, 0, 0);
    // 对手灰点（画在玩家之下层）
    if (others) {
      mapCtx.fillStyle = 'rgba(160,175,195,0.9)';
      for (const o of others) {
        mapCtx.beginPath();
        mapCtx.arc(mapScale.px(o.x), mapScale.py(o.z), 3, 0, Math.PI * 2);
        mapCtx.fill();
      }
    }
    const x = mapScale.px(st.x);
    const y = mapScale.py(st.z);
    // 车辆三角（航向：世界 nose=(sinψ,cosψ) → 画布 (sinψ, −cosψ)）
    const ang = Math.atan2(-Math.cos(st.yaw), Math.sin(st.yaw));
    mapCtx.save();
    mapCtx.translate(x, y);
    mapCtx.rotate(ang);
    mapCtx.fillStyle = '#ffb547';
    mapCtx.beginPath();
    mapCtx.moveTo(7, 0);
    mapCtx.lineTo(-5, 4.4);
    mapCtx.lineTo(-5, -4.4);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.strokeStyle = '#0a0e14';
    mapCtx.lineWidth = 1.2;
    mapCtx.stroke();
    mapCtx.restore();
  }
}
