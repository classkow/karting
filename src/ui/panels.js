import { SYSTEMS, systemMeta } from '../kart/registry.js';
import { icon } from './icons.js';

// ————— UI 面板：部件清单 / 控制台（转速表）/ 信息卡 / 工具提示 / 帮助 —————

function sliderFill(input) {
  const min = +input.min || 0;
  const max = +input.max || 100;
  const p = ((+input.value - min) / (max - min)) * 100;
  input.style.setProperty('--p', p + '%');
}

function bindRange(input, onInput) {
  input.addEventListener('input', () => {
    sliderFill(input);
    onInput(+input.value, input);
  });
  sliderFill(input);
}

// ————— 部件清单 —————
export function initPartsPanel(container, registry, { onSelect, onFocus, onHover, onToggleVis }) {
  const list = container.querySelector('#parts-list');
  const rowEls = new Map();

  for (const sys of SYSTEMS) {
    const parts = registry.partsOfSystem(sys.id);
    if (!parts.length) continue;
    const sec = document.createElement('section');
    sec.className = 'sys-sec';
    sec.innerHTML = `
      <div class="sys-head" role="button" tabindex="0">
        <span class="sys-dot" style="background:${sys.color}"></span>
        <span class="sys-label">${sys.label}</span>
        <span class="sys-count">${parts.length}</span>
        <span class="sys-arrow">${icon('chevron', 14)}</span>
      </div>
      <div class="sys-body"></div>
    `;
    const body = sec.querySelector('.sys-body');
    for (const p of parts) {
      const row = document.createElement('div');
      row.className = 'part-row';
      row.dataset.id = p.id;
      row.innerHTML = `
        <span class="part-name">${p.name}</span>
        <button class="pbtn vis on" title="显示/隐藏">${icon('eye', 13)}</button>
        <button class="pbtn focus" title="聚焦部件">${icon('target', 13)}</button>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.pbtn')) return;
        onSelect(p.id);
      });
      row.addEventListener('pointerenter', () => onHover(p.id));
      row.addEventListener('pointerleave', () => onHover(null));
      row.querySelector('.vis').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const on = !btn.classList.contains('on');
        btn.classList.toggle('on', on);
        btn.innerHTML = icon(on ? 'eye' : 'eye-off', 13);
        row.classList.toggle('part-hidden', !on);
        onToggleVis(p.id, on);
      });
      row.querySelector('.focus').addEventListener('click', (e) => {
        e.stopPropagation();
        onFocus(p.id);
      });
      body.appendChild(row);
      rowEls.set(p.id, row);
    }
    sec.querySelector('.sys-head').addEventListener('click', () => sec.classList.toggle('collapsed'));
    list.appendChild(sec);
  }

  return {
    setActive(id) {
      rowEls.forEach((el, key) => el.classList.toggle('active', key === id));
    },
  };
}

// ————— 转速表（SVG）—————
function tachSVG() {
  const cx = 130, cy = 118, R = 88;
  const a = (v) => -120 + v * 240; // 度，0 在左下，扫过顶部到右下
  const pt = (v, r) => {
    const rad = (a(v) * Math.PI) / 180;
    return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
  };
  const arcPath = (v0, v1, r) => {
    const [x0, y0] = pt(v0, r);
    const [x1, y1] = pt(v1, r);
    const large = a(v1) - a(v0) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  let ticks = '';
  for (let i = 0; i <= 14; i++) {
    const v = i / 14;
    const major = i % 2 === 0;
    const [x0, y0] = pt(v, R - (major ? 14 : 8));
    const [x1, y1] = pt(v, R - 2);
    ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"
      stroke="${i >= 13 ? '#ff5d5d' : '#8fa0b4'}" stroke-width="${major ? 2.2 : 1.2}"/>`;
    if (major) {
      const [lx, ly] = pt(v, R - 27);
      ticks += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" fill="${i >= 13 ? '#ff8484' : '#aebccb'}"
        font-size="12.5" font-weight="600" text-anchor="middle">${i}</text>`;
    }
  }
  return `
    <svg id="tach" viewBox="0 0 260 152">
      <path d="${arcPath(0, 1, R)}" stroke="#232b36" stroke-width="9" fill="none" stroke-linecap="round"/>
      <path d="${arcPath(13 / 14, 1, R)}" stroke="#ff5d5d55" stroke-width="9" fill="none"/>
      ${ticks}
      <g id="needle" transform="rotate(-120 ${cx} ${cy})">
        <path d="M ${cx - 3} ${cy} L ${cx} ${cy - R + 18} L ${cx + 3} ${cy} Z" fill="#ffb547"/>
      </g>
      <circle cx="${cx}" cy="${cy}" r="7" fill="#1a2029" stroke="#39434f" stroke-width="2"/>
      <text id="tach-rpm" x="${cx}" y="${cy + 30}" fill="#f2f6fa" font-size="21" font-weight="700" text-anchor="middle" font-family="Consolas, monospace">0</text>
      <text x="${cx}" y="${cy + 46}" fill="#66788c" font-size="10.5" text-anchor="middle" letter-spacing="2">RPM ×1000</text>
    </svg>
  `;
}

// ————— 控制台 —————
export function initControlPanel(container, api) {
  container.innerHTML = `
    <div class="panel-head">${icon('gauge', 15)}驾驶舱</div>

    <div class="tach-wrap">${tachSVG()}</div>
    <div class="drive-stats">
      <div class="stat"><span class="stat-v" id="st-speed">0</span><span class="stat-l">理论车速 km/h</span></div>
      <div class="stat"><span class="stat-v" id="st-gear">N</span><span class="stat-l">离合状态</span></div>
    </div>

    <div class="ctl-block">
      <button id="btn-engine" class="engine-btn">
        <span class="eb-ic">${icon('play', 16)}</span>
        <span class="eb-tx"><b>启动发动机</b><i id="engine-sub">起动机拖转后怠速运行</i></span>
      </button>

      <div class="row">
        <label>油门开度 <span class="rv" id="v-throttle">0%</span></label>
        <input id="rg-throttle" type="range" min="0" max="100" value="0" data-accent="engine"/>
      </div>
      <div class="row">
        <label>刹车 <span class="rv" id="v-brake">0%</span></label>
        <input id="rg-brake" type="range" min="0" max="100" value="0" data-accent="brake"/>
      </div>
      <div class="row">
        <label>转向 <span class="rv" id="v-steer">0°</span></label>
        <input id="rg-steer" type="range" min="-100" max="100" value="0"/>
      </div>
    </div>

    <div class="panel-head">${icon('layers', 15)}视图与机构</div>
    <div class="ctl-block">
      <div class="row">
        <label>爆炸分解 <span class="rv" id="v-explode">0%</span></label>
        <input id="rg-explode" type="range" min="0" max="100" value="0" data-accent="explode"/>
      </div>
      <div class="view-chips" id="view-chips">
        <button data-view="home" class="vchip active">整车</button>
        <button data-view="front" class="vchip">车头</button>
        <button data-view="engine" class="vchip">动力</button>
        <button data-view="drive" class="vchip">传动</button>
        <button data-view="steer" class="vchip">转向</button>
        <button data-view="brake" class="vchip">制动</button>
        <button data-view="cockpit" class="vchip">座舱</button>
        <button data-view="top" class="vchip">俯视</button>
      </div>
      <div class="toggle-row">
        <button id="tg-rotate" class="tg">${icon('rotate', 13)}<span>自动环绕</span></button>
        <button id="tg-quality" class="tg on">${icon('cpu', 13)}<span>高画质</span></button>
        <button id="tg-sound" class="tg">${icon('volume-off', 13)}<span>音效</span></button>
      </div>
      <button id="btn-reset" class="ghost wide">${icon('home', 13)}视角复位</button>
    </div>
  `;

  const $ = (s) => container.querySelector(s);
  const needle = $('#needle');
  const tachRpm = $('#tach-rpm');
  const stSpeed = $('#st-speed');
  const stGear = $('#st-gear');
  const btnEngine = $('#btn-engine');
  const tgRotate = $('#tg-rotate');
  const tgQuality = $('#tg-quality');
  const tgSound = $('#tg-sound');

  bindRange($('#rg-throttle'), (v) => api.onThrottle(v / 100));
  bindRange($('#rg-brake'), (v) => api.onBrake(v / 100));
  bindRange($('#rg-steer'), (v) => {
    api.onSteer(v / 100);
    $('#v-steer').textContent = Math.round(v * 0.29) + '°';
  });
  bindRange($('#rg-explode'), (v) => {
    api.onExplode(v / 100);
    $('#v-explode').textContent = v + '%';
  });
  // 双击回正：必须回写 sim（走 api.onSteer），否则滑条归零了车还拐着
  $('#rg-steer').addEventListener('dblclick', () => {
    api.onSteer(0);
    setSteerUI(0);
  });

  btnEngine.addEventListener('click', () => api.onEngine());
  tgRotate.addEventListener('click', () => api.onRotate());
  tgQuality.addEventListener('click', () => api.onQuality());
  tgSound.addEventListener('click', () => api.onSound());
  $('#btn-reset').addEventListener('click', () => api.onReset());
  $('#view-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.vchip');
    if (!btn) return;
    container.querySelectorAll('.vchip').forEach((b) => b.classList.toggle('active', b === btn));
    api.onView(btn.dataset.view);
  });

  function setEngineUI(on, cranking) {
    btnEngine.classList.toggle('on', on || cranking);
    btnEngine.querySelector('.eb-ic').innerHTML = icon(on ? 'stop' : 'play', 16);
    btnEngine.querySelector('b').textContent = on ? '熄火' : cranking ? '起动中…' : '启动发动机';
    $('#engine-sub').textContent = on ? '发动机运转中 · 观察剖视缸内活塞' : cranking ? '起动机拖转中…' : '起动机拖转后怠速运行';
    stGear.textContent = on ? (api.getRpm?.() > 3900 ? '接合' : '分离') : '未运转';
  }

  function setSteerUI(v) {
    const input = $('#rg-steer');
    input.value = Math.round(v * 100);
    sliderFill(input);
    $('#v-steer').textContent = Math.round(v * 29) + '°';
  }

  return {
    frame(rpm, speedKmh, engineOn) {
      const v = Math.min(rpm / 14000, 1);
      needle.setAttribute('transform', `rotate(${-120 + v * 240} 130 118)`);
      tachRpm.textContent = Math.round(rpm).toLocaleString('zh-CN');
      stSpeed.textContent = speedKmh.toFixed(1);
      if (engineOn) stGear.textContent = rpm > 3900 ? '接合' : '分离';
    },
    setEngineUI,
    setThrottleUI(v) {
      const input = $('#rg-throttle');
      input.value = Math.round(v * 100);
      sliderFill(input);
      $('#v-throttle').textContent = Math.round(v * 100) + '%';
    },
    setSteerUI,
    setBrakeUI(v) {
      const input = $('#rg-brake');
      input.value = Math.round(v * 100);
      sliderFill(input);
      $('#v-brake').textContent = Math.round(v * 100) + '%';
    },
    setExplodeUI(v) {
      const input = $('#rg-explode');
      input.value = Math.round(v * 100);
      sliderFill(input);
      $('#v-explode').textContent = Math.round(v * 100) + '%';
    },
    setRotateUI(on) {
      tgRotate.classList.toggle('on', on);
    },
    setQualityUI(on) {
      tgQuality.classList.toggle('on', on);
    },
    setSoundUI(on) {
      tgSound.classList.toggle('on', on);
      tgSound.innerHTML = `${icon(on ? 'volume' : 'volume-off', 13)}<span>音效</span>`;
    },
  };
}

// ————— 信息卡 —————
export function initInfoCard(container, { onFocus }) {
  let current = null;
  return {
    show(part) {
      current = part;
      if (!part) {
        container.classList.add('hidden');
        return;
      }
      const sys = systemMeta(part.system);
      const specs = (part.specs ?? [])
        .map(([k, v]) => `<div class="spec"><span>${k}</span><b>${v}</b></div>`)
        .join('');
      container.innerHTML = `
        <div class="info-head">
          <span class="sys-tag" style="--c:${sys.color}"><i></i>${sys.label}</span>
          <strong>${part.name}</strong>
          <div class="info-actions">
            <button id="info-focus" class="ghost sm">${icon('target', 12)}聚焦</button>
            <button id="info-close" class="ghost sm" title="关闭">${icon('close', 13)}</button>
          </div>
        </div>
        ${specs ? `<div class="spec-grid">${specs}</div>` : ''}
        <p>${part.desc}</p>
      `;
      container.classList.remove('hidden');
      container.querySelector('#info-close').addEventListener('click', () => this.show(null));
      container.querySelector('#info-focus').addEventListener('click', () => part && onFocus(part.id));
    },
    get current() {
      return current;
    },
  };
}

// ————— 悬停工具提示 —————
export function initTooltip(el) {
  return {
    move(x, y, text, color) {
      el.innerHTML = `<i style="background:${color}"></i>${text}`;
      el.classList.remove('hidden');
      const pad = 14;
      const w = el.offsetWidth;
      const x2 = Math.min(x + pad, window.innerWidth - w - 10);
      el.style.transform = `translate(${x2}px, ${y + pad}px)`;
    },
    hide() {
      el.classList.add('hidden');
    },
  };
}

// ————— 帮助弹窗 —————
export function initHelp(overlay) {
  const SHORTCUTS = [
    ['空格', '启动 / 熄火'],
    ['W / S', '油门 + / −'],
    ['A / D', '左转 / 右转'],
    ['B', '刹车（按住）'],
    ['E', '爆炸分解 开/合'],
    ['R', '视角复位'],
    ['1 – 8', '切换视角预设'],
    ['Esc', '关闭信息卡 / 弹窗'],
  ];
  overlay.innerHTML = `
    <div class="help-card">
      <div class="help-head"><b>操作指南</b><button id="help-close" class="ghost sm">${icon('close', 13)}</button></div>
      <div class="help-grid">
        ${SHORTCUTS.map(([k, v]) => `<div class="hk"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}
      </div>
      <div class="help-tips">
        <p><b>建议路线：</b>点击「启动发动机」拉高油门，观察透明气缸内的活塞与连杆；</p>
        <p>拖动「爆炸分解」把整车拆开，再逐个点击部件查看原理说明；</p>
        <p>拉满「转向」观察拉杆推动转向节——内外轮转角并不相同（阿克曼几何）。</p>
      </div>
    </div>
  `;
  const show = (v) => overlay.classList.toggle('hidden', !v);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('#help-close')) show(false);
  });
  return { toggle: () => show(overlay.classList.contains('hidden')), show };
}
