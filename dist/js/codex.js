// ============================================================
//  codex.js — 카드 도감 (수집, UI, 칭호)
// ============================================================

const CODEX_LS_KEY   = 'cardecx_codex';
const CODEX_TITLE_LS = 'cardecx_title';

// 도감에 등록되는 카드 목록 (등급별)
const CODEX_CARDS = {
  common:    ['wooden_sword', 'rock', 'wind', 'earthquake', 'arrow',
              'dual_sword', 'rock_hell', 'strong_wind', 'doom_fragment', 'cupid_arrow'],
  rare:      ['flame', 'wave', 'thorn', 'iron_wall', 'cherry_blossom'],
  epic:      ['lightning', 'tornado', 'forest_spirit', 'shadow_shield', 'starlight_burst', 'pumpkin_carriage'],
  mythic:    ['black_hole', 'nightmare', 'ice_deploy', 'viper', 'mirror'],
  legendary: ['dragon_breath', 'safe_zone', 'celestial_wings', 'doom_seal'],
  secret:    ['apocalypse', 'grim_reaper']
};

const CODEX_TOTAL = Object.values(CODEX_CARDS).reduce((s, a) => s + a.length, 0);

// ── 수집 데이터 ──────────────────────────────────────────────

function _loadCollected() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CODEX_LS_KEY) || '[]'));
  } catch { return new Set(); }
}

function _saveCollected(set) {
  localStorage.setItem(CODEX_LS_KEY, JSON.stringify([...set]));
}

/** 카드 ID를 도감에 추가. 새로 수집됐으면 true 반환 */
function collectCard(cardId) {
  const collected = _loadCollected();
  if (collected.has(cardId)) return false;
  collected.add(cardId);
  _saveCollected(collected);
  _checkTitleUnlock(collected);
  return true;
}

function isCardCollected(cardId) {
  return _loadCollected().has(cardId);
}

function getCollectedCount() {
  return _loadCollected().size;
}

function _checkTitleUnlock(collected) {
  if (collected.size >= CODEX_TOTAL) {
    localStorage.setItem(CODEX_TITLE_LS, '카드 수집가');
    _showTitleToast('🏆 칭호 획득: 카드 수집가');
  }
}

function _showTitleToast(msg) {
  const existing = document.getElementById('codex-title-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'codex-title-toast';
  toast.className = 'codex-title-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 500);
  }, 3500);
}

// ── 도감 모달 렌더링 ─────────────────────────────────────────

function renderCodex() {
  const content = document.getElementById('codex-content');
  if (!content) return;

  const collected = _loadCollected();
  const total = CODEX_TOTAL;
  const count = collected.size;
  const pct   = Math.round((count / total) * 100);

  const gradeOrder  = ['common', 'rare', 'epic', 'mythic', 'legendary', 'secret'];
  const gradeKo     = { common: '일반', rare: '희귀', epic: '에픽', mythic: '신화', legendary: '전설', secret: '비밀' };
  const gradeEmoji  = { common: '⚪', rare: '🟢', epic: '🟣', mythic: '🔴', legendary: '🌟', secret: '🖤' };
  const gradeColor  = { common: '#9e9e9e', rare: '#4caf50', epic: '#9c27b0', mythic: '#e53935', legendary: '#FFD700', secret: '#555' };

  let html = `
    <div class="codex-progress-wrap">
      <div class="codex-progress-label">
        <span>수집 ${count} / ${total}</span>
        <span>${pct}%</span>
      </div>
      <div class="codex-progress-bar-bg">
        <div class="codex-progress-bar-fill" style="width:${pct}%"></div>
      </div>
    </div>`;

  gradeOrder.forEach(grade => {
    const ids = CODEX_CARDS[grade];
    if (!ids) return;
    const gradeCnt = ids.filter(id => collected.has(id)).length;

    html += `
      <div class="codex-section">
        <div class="codex-grade-header" style="color:${gradeColor[grade]}">
          <span>${gradeEmoji[grade]} ${gradeKo[grade]}</span>
          <span class="codex-grade-count">${gradeCnt}/${ids.length}</span>
        </div>
        <div class="codex-cards-row">`;

    ids.forEach(id => {
      const def = typeof CARD_DEFINITIONS !== 'undefined' ? CARD_DEFINITIONS[id] : null;
      if (!def) return;
      const got = collected.has(id);
      const name = got ? def.name : '???';
      const icon = got ? def.icon : '❓';
      html += `
          <div class="codex-card ${got ? 'codex-got' : 'codex-missing'} grade-${grade}" title="${name}">
            <div class="codex-card-icon">${icon}</div>
            <div class="codex-card-name">${name}</div>
          </div>`;
    });

    html += `</div></div>`;
  });

  const hasTitle = localStorage.getItem(CODEX_TITLE_LS) === '카드 수집가';
  if (hasTitle) {
    html += `<div class="codex-title-badge">🏆 칭호: 카드 수집가</div>`;
  }

  content.innerHTML = html;
}

// ── 모달 열기/닫기 (lobby에서 사용) ─────────────────────────

function openCodex() {
  const modal = document.getElementById('codex-modal');
  if (!modal) return;
  renderCodex();
  modal.classList.remove('hidden');
}

function closeCodex() {
  const modal = document.getElementById('codex-modal');
  if (modal) modal.classList.add('hidden');
}
