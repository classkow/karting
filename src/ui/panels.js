import { SYSTEMS, systemMeta } from '../kart/registry.js';
import { VIEWS } from '../interaction/views.js';
import { CLUTCH_ENGAGE_RPM } from '../sim/state.js';
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
      <div class="sys-head" role="button" tabindex="0" aria-expanded="true">
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
    const head = sec.querySelector('.sys-head');
    const toggle = () => {
      const collapsed = sec.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); // 空格默认滚屏，Enter 默认无操作；统一转为折叠切换
        toggle();
      }
    });
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
      stroke="${i >= 13 ? '#ff8484' : '#566478'}" stroke-width="${major ? 2.2 : 1.2}"/>`;
    if (major) {
      const [lx, ly] = pt(v, R - 27);
      ticks += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" fill="${i >= 13 ? '#ff8484' : '#9fb0c3'}"
        font-size="12" font-weight="600" text-anchor="middle">${i}</text>`;
    }
  }
  return `
    <svg id="tach" viewBox="0 0 260 176">
      <defs>
        <linearGradient id="tach-arc" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stop-color="#3d4b5f"/>
          <stop offset="55%" stop-color="#ffb547"/>
          <stop offset="100%" stop-color="#ff5d5d"/>
        </linearGradient>
        <filter id="needle-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d="${arcPath(0, 1, R)}" stroke="#1d2530" stroke-width="10" fill="none" stroke-linecap="round"/>
      <path d="${arcPath(0, 1, R)}" stroke="url(#tach-arc)" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.34"/>
      <path d="${arcPath(13 / 14, 1, R)}" stroke="#ff5d5d" stroke-width="10" fill="none" opacity="0.55"/>
      ${ticks}
      <g id="needle" transform="rotate(-120 ${cx} ${cy})">
        <path d="M ${cx - 3} ${cy} L ${cx} ${cy - R + 18} L ${cx + 3} ${cy} Z" fill="#ffb547" filter="url(#needle-glow)"/>
      </g>
      <circle cx="${cx}" cy="${cy}" r="8" fill="#171d26" stroke="#3d4b5f" stroke-width="1.5"/>
      <circle cx="${cx}" cy="${cy}" r="2.6" fill="#ffb547"/>
      <text id="tach-rpm" x="${cx}" y="${cy + 34}" fill="#f2f6fa" font-size="21" font-weight="700" text-anchor="middle" font-family="Consolas, 'JetBrains Mono', monospace">0</text>
      <text x="${cx}" y="${cy + 50}" fill="#5c6b7d" font-size="10" text-anchor="middle" letter-spacing="2.5">RPM ×1000</text>
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
        ${Object.entries(VIEWS).map(([id, v], i) =>
          `<button data-view="${id}" class="vchip${i === 0 ? ' active' : ''}" data-key="${i + 1}">${v.label}</button>`
        ).join('')}
      </div>
      <div class="toggle-row">
        <button id="tg-rotate" class="tg">${icon('rotate', 13)}<span>自动环绕</span></button>
        <button id="tg-quality" class="tg on">${icon('cpu', 13)}<span>高画质</span></button>
        <button id="tg-sound" class="tg">${icon('volume-off', 13)}<span>音效</span></button>
      </div>
      <div class="toggle-row jacking-row">
        <button id="tg-jacking" class="tg">${icon('layers', 13)}<span>主销举升演示</span></button>
        <button id="tg-jscale" class="tg" title="教学放大倍率（只放大显示姿态，毫米读数永远报真实值）"><span>放大 1×</span></button>
      </div>
      <div class="row jacking-readout">
        <label>内侧后轮离地<span class="rv" id="v-jacking">—</span></label>
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
  const tgJacking = $('#tg-jacking');
  const tgJscale = $('#tg-jscale');
  const vJacking = $('#v-jacking');

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
  tgJacking.addEventListener('click', () => api.onJacking());
  tgJscale.addEventListener('click', () => api.onJackingScale());
  $('#btn-reset').addEventListener('click', () => api.onReset());
  $('#view-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('.vchip');
    if (!btn) return;
    container.querySelectorAll('.vchip').forEach((b) => b.classList.toggle('active', b === btn));
    api.onView(btn.dataset.view);
  });

  function setEngineUI(on, cranking) {
    btnEngine.classList.toggle('on', on || cranking);
    btnEngine.classList.toggle('starting', cranking && !on);
    btnEngine.querySelector('.eb-ic').innerHTML = icon(on ? 'stop' : 'play', 16);
    btnEngine.querySelector('b').textContent = on ? '熄火' : cranking ? '起动中…' : '启动发动机';
    $('#engine-sub').textContent = on ? '发动机运转中 · 观察剖视缸内活塞' : cranking ? '起动机拖转中…' : '起动机拖转后怠速运行';
    stGear.textContent = on ? (api.getRpm?.() > CLUTCH_ENGAGE_RPM ? '接合' : '分离') : '未运转';
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
      if (engineOn) stGear.textContent = rpm > CLUTCH_ENGAGE_RPM ? '接合' : '分离';
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
    setJackingUI(on, scale) {
      tgJacking.classList.toggle('on', on);
      // 信誉红线：放大必须明示——>1× 时按钮带"教学放大"小字标注
      tgJscale.innerHTML = `<span>放大 ${scale}×${scale > 1 ? '<i class="tg-mini">教学放大</i>' : ''}</span>`;
      if (!on) vJacking.textContent = '—';
    },
    setJackingLift(mm) {
      vJacking.textContent = `${mm.toFixed(1)} mm（真实解算值）`;
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
      container.style.setProperty('--sys-c', sys.color);
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
    ['W / S', '油门 + / −（可长按）'],
    ['A / D', '左转 / 右转（可长按）'],
    ['B', '刹车（按住）'],
    ['E', '爆炸分解 开/合'],
    ['R', '视角复位'],
    ['1 – 8', '切换视角预设'],
    ['Esc', '关闭信息卡 / 弹窗'],
  ];
  const TOUCHES = [
    ['单指拖拽', '旋转视角'],
    ['双指捏合', '缩放'],
    ['双指拖拽', '平移'],
    ['点按部件', '查看原理讲解'],
  ];
  overlay.innerHTML = `
    <div class="help-card">
      <div class="help-head"><b>操作指南</b><button id="help-close" class="ghost sm">${icon('close', 13)}</button></div>
      <div class="help-grid help-kb">
        ${SHORTCUTS.map(([k, v]) => `<div class="hk"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}
      </div>
      <div class="help-grid help-touch">
        ${TOUCHES.map(([k, v]) => `<div class="hk"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}
      </div>
      <div class="help-tips">
        <p><b>建议路线：</b>点击「启动发动机」拉高油门，观察透明气缸内的活塞与连杆；</p>
        <p>拖动「爆炸分解」把整车拆开，再逐个点击部件查看原理说明；</p>
        <p>拉满「转向」观察拉杆推动转向节——内外轮转角并不相同（阿克曼几何）。</p>
        <p>打开「主销举升演示」并打满方向：倾斜主销（内倾/后倾）把车架顶起，内侧后轮真实离地——这就是无差速器卡丁车能过弯的原因（毫米读数为真实解算值，放大仅供教学）。</p>
      </div>
    </div>
  `;
  const show = (v) => overlay.classList.toggle('hidden', !v);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('#help-close')) show(false);
  });
  return { toggle: () => show(overlay.classList.contains('hidden')), show };
}

// ————— 小屏面板折叠（≤880px 时点头栏收起/展开，把视野让给模型）—————
export function initPanelCollapse() {
  const mq = window.matchMedia('(max-width: 880px)');
  for (const sel of ['#parts-panel']) {
    const panel = document.querySelector(sel);
    const head = panel?.querySelector('.panel-head');
    if (!panel || !head) continue;
    head.addEventListener('click', () => {
      if (mq.matches) panel.classList.toggle('panel-collapsed');
    });
    const apply = () => panel.classList.toggle('panel-collapsed', mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
  }

  // 控制面板：小屏下两个区块标题各控各的独立手风琴（点「驾驶舱」不动「视图与机构」，反之亦然）
  const cp = document.querySelector('#control-panel');
  if (cp) {
    const heads = [...cp.querySelectorAll(':scope > .panel-head')];
    const sectionOf = (head) => {
      const blocks = [];
      let n = head.nextElementSibling;
      while (n && !n.classList.contains('panel-head')) { blocks.push(n); n = n.nextElementSibling; }
      return blocks;
    };
    const setSection = (head, collapsed) => {
      head.classList.toggle('sec-collapsed', collapsed);
      sectionOf(head).forEach((b) => { b.style.display = collapsed ? 'none' : ''; });
    };
    for (const head of heads) {
      head.addEventListener('click', () => {
        if (!mq.matches) return; // 大屏区块常驻
        setSection(head, !head.classList.contains('sec-collapsed'));
      });
    }
    const applyCp = () => heads.forEach((h) => setSection(h, mq.matches)); // 进小屏全收起/出大屏全还原
    applyCp();
    mq.addEventListener?.('change', applyCp);
  }
}
