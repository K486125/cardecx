// ============================================================
//  board.js — 타워 렌더링, HP 바, 드래그&드롭 타깃
// ============================================================

let _boardPlayerKey   = null; // 'p1' | 'p2'
let _boardEnemyKey    = null;
let _boardCurrentCard = null; // 현재 드래그 중인 카드 정보
let _boardDeckSlot    = null; // 드래그 중인 덱 슬롯 인덱스
let _boardGameState   = null; // 최신 gameState 캐시

// 타워 ID 매핑 헬퍼
function _towerId(owner, pos) {
  return `tower-${owner}-${pos}`;  // 'tower-enemy-left', 'tower-my-king' 등
}

function boardInit(playerKey, enemyKey) {
  _boardPlayerKey = playerKey;
  _boardEnemyKey  = enemyKey;
}

/** 게임 상태 캐시 갱신 (game.js에서 호출) */
function boardUpdateState(gameState) {
  _boardGameState = gameState;
}

// ── 타워 HP 업데이트 ────────────────────────────────────────

/**
 * @param {'my'|'enemy'} owner
 * @param {'left'|'king'|'right'} pos
 * @param {number} hp
 * @param {number} maxHp
 * @param {boolean} alive
 * @param {object} [towerData]  전체 타워 객체 (실드·부활 등 표시용)
 */
function updateTowerDisplay(owner, pos, hp, maxHp, alive, towerData = {}) {
  const towerId = _towerId(owner, pos);
  const towerEl = document.getElementById(towerId);
  if (!towerEl) return;

  if (!alive) {
    if (towerEl.classList.contains('destroyed')) return;
    towerEl.classList.add('destroyed');
    towerEl.classList.add('tower-explode');
    towerEl.classList.remove('pending-revival');
    setTimeout(() => towerEl.classList.remove('tower-explode'), 700);
    return;
  }

  towerEl.classList.remove('destroyed');

  // 부활 예약 표시 (킹 타워에 검은 링 + 카운트)
  if (pos === 'king') {
    towerEl.classList.toggle('pending-revival', !!towerData.pendingRevival);
    const labelEl = towerEl.querySelector('.tower-label');
    if (labelEl) {
      const revCount = typeof towerData.pendingRevival === 'number' ? towerData.pendingRevival : (towerData.pendingRevival ? 1 : 0);
      labelEl.textContent = revCount > 0 ? `KING ×${revCount}` : 'King';
    }
  }

  // 방어 효과 배지 (피해감소 → shield, 면역 → health_and_safety, 중첩 포함)
  const _now        = serverNow();
  const isDmgReduc  = !!(towerData.damageReductionUntil  && _now < towerData.damageReductionUntil) ||
                      !!(towerData.damageReduction2Until && _now < towerData.damageReduction2Until);
  const isImmune    = !!(towerData.immunityUntil && _now < towerData.immunityUntil);
  const hasDefense  = isDmgReduc || isImmune;
  towerEl.classList.toggle('has-defense', hasDefense);
  const badgeEl = towerEl.querySelector('.tower-defense-badge');
  if (badgeEl) {
    badgeEl.textContent = isImmune ? 'health_and_safety' : 'shield';
    badgeEl.style.color = isImmune ? '#69f0ae' : '#64b5f6';
  }

  // 악몽 배지 (damageAmp 활성 시 좌측 하단)
  const hasNightmare = !!(towerData.damageAmpUntil && _now < towerData.damageAmpUntil);
  towerEl.classList.toggle('has-nightmare', hasNightmare);

  // 파멸의 낙인 배지 (doomSeal 활성 시 우측 하단, 🔱)
  const hasDoomSeal = !!(towerData.doomSealUntil && _now < towerData.doomSealUntil);
  towerEl.classList.toggle('has-doom-seal', hasDoomSeal);

  // 반사 거울 배지 (mirrorUntil 활성 시 좌측 상단, 🪞)
  const hasMirror = !!(towerData.mirrorUntil && _now < towerData.mirrorUntil);
  towerEl.classList.toggle('has-mirror', hasMirror);

  // 힐량 감소 배지 (healReductionUntil 활성 시 우측 상단, 🐍)
  const hasHealReduction = !!(towerData.healReductionUntil && _now < towerData.healReductionUntil);
  towerEl.classList.toggle('has-heal-reduction', hasHealReduction);

  const hpBar  = document.getElementById(`hpbar-${owner}-${pos}`);
  const hpText = document.getElementById(`hptext-${owner}-${pos}`);
  if (!hpBar || !hpText) return;

  const isShielded  = (towerData.shieldHp || 0) > 0;
  const displayHp   = isShielded ? towerData.shieldHp   : hp;
  const displayMax  = isShielded ? towerData.maxShieldHp : maxHp;
  const pct         = Math.max(0, (displayHp / (displayMax || 1)) * 100);

  hpBar.style.width = pct + '%';

  if (isShielded) {
    hpBar.style.background = 'var(--hp-shield)';
    hpBar.classList.remove('critical');
    hpText.textContent = `🛡️${displayHp}/${displayMax}`;
  } else {
    if (pct > 50)       hpBar.style.background = 'var(--hp-high)';
    else if (pct > 25)  hpBar.style.background = 'var(--hp-mid)';
    else                hpBar.style.background = 'var(--hp-low)';

    hpBar.classList.toggle('critical', pct <= 15);
    hpText.textContent = `${hp}/${maxHp}`;
  }
}

/** Firebase towers 스냅샷 → 타워 디스플레이 일괄 업데이트 */
function applyTowersSnapshot(owner, towersData) {
  if (!towersData) return;
  ['left', 'king', 'right'].forEach(pos => {
    const t = towersData[pos];
    if (t) updateTowerDisplay(owner, pos, t.hp, t.maxHp, t.alive, t);
  });
}

// ── 피격 애니메이션 & 플로팅 숫자 ──────────────────────────

function showTowerHit(owner, pos, amount, type = 'damage') {
  const towerEl = document.getElementById(_towerId(owner, pos));
  if (!towerEl) return;
  if (type !== 'immune' && towerEl.classList.contains('destroyed')) return;

  if (type !== 'immune') {
    towerEl.classList.add('tower-hit');
    setTimeout(() => towerEl.classList.remove('tower-hit'), 350);
  }

  const rect = towerEl.getBoundingClientRect();
  const num  = document.createElement('div');
  num.className = `floating-number ${type}`;
  if (type === 'immune') {
    num.textContent = '면역';
  } else if (type === 'heal') {
    num.textContent = `+${amount}`;
  } else {
    num.textContent = `-${amount}`;
  }
  // 좌/중/우 3위치에서 랜덤하게 나타남
  const _xRatios = [0.15, 0.5, 0.85];
  const _xRatio  = _xRatios[Math.floor(Math.random() * _xRatios.length)];
  num.style.left = (rect.left + rect.width * _xRatio) + 'px';
  num.style.top  = (rect.top) + 'px';
  document.body.appendChild(num);
  setTimeout(() => num.remove(), 1500);
}

// ── DOT 인디케이터 ───────────────────────────────────────────

function updateDotIndicator(owner, pos, dotEntries) {
  const el = document.getElementById(`dot-${owner}-${pos}`);
  if (!el) return;
  el.innerHTML = '';
  const towerEl = document.getElementById(_towerId(owner, pos));
  if (towerEl?.classList.contains('destroyed')) return;
  dotEntries.forEach(entry => {
    if (entry.type === 'shieldDrain') return; // 보호막 감소는 HP바로 표시됨
    const badge = document.createElement('span');
    badge.className = `dot-badge ${entry.type === 'damage' ? 'damage-badge' : 'heal-badge'}`;
    if (entry.type === 'damage') {
      badge.innerHTML = '<span class="material-symbols-outlined">explosion</span>';
    } else {
      badge.textContent = '💚';
    }
    badge.title = `${entry.type === 'damage' ? '피해' : '치유'} ${entry.dmgPerTick}/s × ${entry.remainingTicks}`;
    el.appendChild(badge);
  });
}

// ── 클릭-부착 카드 이동 시스템 ──────────────────────────────
// 카드 클릭 → 마우스에 달라붙음 → 타워 위에서 하이라이팅 → 클릭으로 사용

let _dragClone            = null;
let _dragHighlightedTower = null;
let _dragSourceEl         = null;
let _stickyMode           = false;

function _getGameScale() {
  const el = document.getElementById('screen-game');
  if (!el) return 1;
  const m = new DOMMatrix(getComputedStyle(el).transform);
  return Math.abs(m.a) || 1;
}

function _moveStickyClone(cx, cy) {
  if (!_dragClone) return;
  const scale = _getGameScale();
  const w = parseFloat(_dragClone.style.width)  * scale;
  const h = parseFloat(_dragClone.style.height) * scale;
  _dragClone.style.left = (cx - w / 2) + 'px';
  _dragClone.style.top  = (cy - h / 2) + 'px';
}

/** deck.js의 click 핸들러에서 호출 — 카드를 커서에 부착 */
function startStickyDrag(e, card, slotIndex, sourceEl) {
  // 이미 부착 중이면 취소 후 새 카드로 교체
  if (_stickyMode) _cancelStickyDrag();

  boardSetDraggingCard(card, slotIndex);
  _dragSourceEl = sourceEl;
  _stickyMode   = true;
  sourceEl.classList.add('dragging');
  document.body.style.cursor = 'crosshair';

  const scale = _getGameScale();
  _dragClone = sourceEl.cloneNode(true);
  _dragClone.style.cssText = [
    'position:fixed',
    `width:${sourceEl.offsetWidth}px`,
    `height:${sourceEl.offsetHeight}px`,
    `transform:scale(${scale})`,
    'transform-origin:top left',
    'pointer-events:none',
    'z-index:9999',
    'opacity:0.92',
    'transition:none',
    'margin:0'
  ].join(';');
  document.body.appendChild(_dragClone);
  _moveStickyClone(e.clientX, e.clientY);

  document.addEventListener('pointermove', _onStickyMove);
  document.addEventListener('keydown',     _onStickyKeyDown);
  // setTimeout으로 현재 클릭 이벤트가 끝난 뒤 document click 감지 시작
  setTimeout(() => {
    if (_stickyMode) document.addEventListener('click', _onStickyClick);
  }, 0);
}

function _onStickyMove(e) {
  _moveStickyClone(e.clientX, e.clientY);

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const tower = under?.closest?.('.tower');

  if (_dragHighlightedTower && _dragHighlightedTower !== tower) {
    _dragHighlightedTower.classList.remove('drag-over', 'drag-over-heal');
    _dragHighlightedTower = null;
  }
  if (tower) {
    const owner = tower.dataset.owner;
    const pos   = tower.dataset.pos;
    if (canDropOnTower(owner, pos)) {
      const _ct = _boardCurrentCard?.type;
      let hlClass = 'drag-over';
      if (_ct === 'heal' || _ct === 'defense') hlClass = 'drag-over-heal';
      else if (_ct === 'dual') hlClass = (owner === 'my') ? 'drag-over-heal' : 'drag-over';
      tower.classList.add(hlClass);
      _dragHighlightedTower = tower;
    }
  }
}

function _onStickyClick(e) {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const tower = under?.closest?.('.tower');

  if (tower && _boardCurrentCard) {
    const owner = tower.dataset.owner;
    const pos   = tower.dataset.pos;
    if (canDropOnTower(owner, pos)) {
      onCardDropped(_boardCurrentCard, _boardDeckSlot, owner, pos);
    }
  }
  _cancelStickyDrag();
}

function _onStickyKeyDown(e) {
  if (e.key === 'Escape') _cancelStickyDrag();
}

function _cancelStickyDrag() {
  _stickyMode = false;
  document.removeEventListener('pointermove', _onStickyMove);
  document.removeEventListener('click',       _onStickyClick);
  document.removeEventListener('keydown',     _onStickyKeyDown);
  document.body.style.cursor = '';

  if (_dragHighlightedTower) {
    _dragHighlightedTower.classList.remove('drag-over', 'drag-over-heal');
    _dragHighlightedTower = null;
  }
  if (_dragClone)    { _dragClone.remove(); _dragClone = null; }
  if (_dragSourceEl) { _dragSourceEl.classList.remove('dragging'); _dragSourceEl = null; }
  boardClearDraggingCard();
}

/** setupDragTargets — 포인터 이벤트 방식으로 대체됨 */
function setupDragTargets() {}

/** 드래그 시작 시 board에 현재 카드 등록 */
function boardSetDraggingCard(card, slotIndex) {
  _boardCurrentCard = card;
  _boardDeckSlot    = slotIndex;
}

/** 드래그 종료 시 초기화 */
function boardClearDraggingCard() {
  _boardCurrentCard = null;
  _boardDeckSlot    = null;
}

/**
 * 이 타워에 드롭 가능한지 검사
 *   attack / control → enemy 타워
 *   heal / defense   → my 타워
 *   revival(defense) → my 킹 타워 (죽어있어도 허용)
 */
function canDropOnTower(owner, pos) {
  if (!_boardCurrentCard) return false;
  if (!_boardGameState) return false;

  const cardType    = _boardCurrentCard.type;
  const isDual      = cardType === 'dual';
  const isOwnTarget = cardType === 'heal' || cardType === 'defense';

  if (!isDual) {
    if (isOwnTarget  && owner !== 'my')    return false;
    if (!isOwnTarget && owner !== 'enemy') return false;
  }

  const dataKey   = owner === 'my' ? _boardPlayerKey : _boardEnemyKey;
  const towerData = _boardGameState[dataKey]?.towers?.[pos];
  if (!towerData) return false;

  // 부활 카드 전용: 킹 타워에만 허용, 죽어있어도 가능
  if (_boardCurrentCard.effect?.revival) {
    return pos === 'king';
  }

  if (!towerData.alive) return false;
  return true;
}

/**
 * 드롭 이벤트 처리 — deck.js의 onCardUsed 콜백으로 전달
 */
function onCardDropped(card, slotIndex, targetOwner, targetPos) {
  if (typeof window.onCardUsed === 'function') {
    window.onCardUsed(card, slotIndex, targetOwner, targetPos);
  }
}

/**
 * 반사 경고 표시 — towerEl 위에 ⚠️ 아이콘 3초 후 onExpire 호출
 */
const _mirrorWarningTimeouts = [];

function showMirrorWarning(towerEl, onExpire) {
  const rect = towerEl.getBoundingClientRect();
  const warn = document.createElement('div');
  warn.className = 'mirror-warning-icon';
  warn.style.left = (rect.left + rect.width  / 2) + 'px';
  warn.style.top  = (rect.top  + rect.height / 2) + 'px';
  document.body.appendChild(warn);

  const t = setTimeout(() => {
    warn.classList.add('fading');
    setTimeout(() => warn.remove(), 400);
    onExpire();
  }, 3000);
  _mirrorWarningTimeouts.push(t);
}

function clearMirrorWarnings() {
  _mirrorWarningTimeouts.forEach(clearTimeout);
  _mirrorWarningTimeouts.length = 0;
  document.querySelectorAll('.mirror-warning-icon').forEach(el => el.remove());
}

/** 전설 카드 등장 플래시 */
function showLegendaryFlash() {
  const el = document.createElement('div');
  el.className = 'legendary-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
