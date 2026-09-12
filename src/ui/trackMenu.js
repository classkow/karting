import { AI_TIERS } from '../sim/ai.js';
import { RACE_LAPS } from '../sim/race.js';
import { icon } from './icons.js';

// ————— 赛道模式菜单 + 比赛结算面板 —————
// 进赛道先出菜单（练习 / 比赛·三档难度）；冲线出结算。两块浮层都允许指针交互，
// 其余区域仍让位给画布。

const fmtMs = (ms) => {
  if (!ms) return '--:--.-';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
};

const TIER_DESC = {
  rookie: '冷静的节奏跑者 · 圈速慢你 8% 以上',
  elite: '有威胁的对手 · 弯速接近极限',
  champion: '贴着抓地极限开的快手 · 想赢得干净利落',
};

export function initTrackMenu(container, { storage, onPractice, onRace, onExit, onAgain }) {
  const savedTier = storage.get('kart.raceTier');
  const tierKeys = Object.keys(AI_TIERS);

  container.innerHTML = `
    <div id="tm-panel" class="tm-wrap">
      <div class="tm-card">
        <div class="tm-head"><b>选择赛道模式</b><span>3 名电脑对手 · ${RACE_LAPS} 圈制</span></div>
        <button class="tm-item" data-mode="practice">
          <i class="tm-ic">${icon('target', 18)}</i>
          <span class="tm-tx"><b>单车练习</b><i>独自跑圈 · 不限圈数 · 计时热身</i></span>
        </button>
        ${tierKeys.map((k) => `
        <button class="tm-item tm-race${savedTier === k ? ' last' : ''}" data-mode="race" data-tier="${k}">
          <i class="tm-ic tm-t${k}">${icon('spark', 18)}</i>
          <span class="tm-tx"><b>比赛 · ${AI_TIERS[k].label}</b><i>${TIER_DESC[k]}</i></span>
          ${savedTier === k ? '<em class="tm-last">上次</em>' : ''}
        </button>`).join('')}
        <button class="tm-item tm-exit" data-mode="exit">
          <i class="tm-ic">${icon('home', 18)}</i>
          <span class="tm-tx"><b>返回展台</b><i>回到机构演示（Esc）</i></span>
        </button>
      </div>
    </div>
    <div id="tm-results" class="tm-wrap hidden"></div>
  `;

  const elPanel = container.querySelector('#tm-panel');
  const elResults = container.querySelector('#tm-results');

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.tm-item');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === 'practice') onPractice?.();
    else if (mode === 'race') onRace?.(btn.dataset.tier);
    else if (mode === 'exit') onExit?.();
  });

  return {
    showMenu() {
      elResults.classList.add('hidden');
      elPanel.classList.remove('hidden');
      container.classList.remove('hidden');
    },
    hide() {
      elPanel.classList.add('hidden');
      elResults.classList.add('hidden');
      container.classList.add('hidden');
    },
    get visible() {
      return !container.classList.contains('hidden');
    },
    get menuVisible() {
      return !elPanel.classList.contains('hidden');
    },

    // results: [{ name, isPlayer, finished, finishTime, lapTimeMs, position }]
    showResults(results, { tier }) {
      elPanel.classList.add('hidden');
      const won = results[0]?.isPlayer;
      elResults.innerHTML = `
        <div class="tm-card tm-result">
          <div class="tm-head"><b>${won ? '🏆 胜利！' : '比赛结束'}</b><span>${AI_TIERS[tier]?.label ?? ''} · ${RACE_LAPS} 圈</span></div>
          <div class="tm-rows">
            ${results.map((r, i) => `
              <div class="tm-row${r.isPlayer ? ' me' : ''}">
                <b class="tm-pos">${i + 1}</b>
                <span class="tm-name">${r.name}</span>
                <span class="tm-time">${r.finished ? fmtMs(r.finishTime * 1000) : '未完赛'}</span>
                <span class="tm-best">最佳 ${fmtMs(r.lapTimeMs)}</span>
              </div>`).join('')}
          </div>
          <div class="tm-actions">
            <button class="ghost sm" data-mode="again">再来一局</button>
            <button class="ghost sm" data-mode="menu">更换模式</button>
            <button class="ghost sm" data-mode="exit">返回展台</button>
          </div>
        </div>
      `;
      elResults.classList.remove('hidden');
      container.classList.remove('hidden');
      elResults.querySelectorAll('.tm-actions button').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mode;
          if (mode === 'again') onAgain?.();
          else if (mode === 'menu') this.showMenu();
          else if (mode === 'exit') onExit?.();
        });
      });
    },
    get resultsVisible() {
      return !elResults.classList.contains('hidden');
    },
  };
}
