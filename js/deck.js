// ============================================================
//  deck.js — 5슬롯 덱 렌더링, 카드 선택/사용 로직
// ============================================================

let _deckPlayerKey  = null;
let _deckEnemyKey   = null;
let _deckSlots      = [null, null, null, null, null]; // 로컬 캐시
let _deckGameState  = null;

// 자동 선택/턴 전환 타이머
let _offerAutoTimer  = null; // 10초 자동 카드 선택
let _autoTurnTimer   = null; // 5초 자동 턴 전환 (덱 꽉 참)
let _lastOfferedCards = null; // 현재 제공 중인 카드 캐시

// ── 진화 시스템 ──────────────────────────────────────────
let _evolutionCharges = {}; // originalCardId → count (0~2: 충전 중, 3: 진화 완료)

/** 카드가 진화 상태면 진화 카드 정의를 반환, 아니면 원본 반환 */
function _getEffectiveCard(card) {
  if (!card) return card;
  const evolvedId = EVOLUTION_MAP[card.id];
  if (!evolvedId) return card;
  const count = _evolutionCharges[card.id] || 0;
  if (count >= 3) {
    return { ...CARD_DEFINITIONS[evolvedId], _evolvedFrom: card.id };
  }
  return card;
}

/** 진화 게이지 HTML 생성 */
function _buildChargeGauge(originalId) {
  const evolvedId = EVOLUTION_MAP[originalId];
  if (!evolvedId) return '';
  const count = _evolutionCharges[originalId] || 0;
  const isFull = count >= 3;
  const colorClass = isFull ? 'full' :
    count === 0 ? '' :
    count === 1 ? 'yellow' :
    'green'; // count === 2
  const cells = [...Array(3)].map((_, i) => {
    const filled = isFull || i < count;
    return `<div class="gauge-cell${filled ? ' filled ' + colorClass : ''}"></div>`;
  }).join('');
  const label = isFull ? '⚡진화 준비!' : `진화 ${count}/3`;
  return `<div class="evolution-gauge" title="${label}">${cells}</div>`;
}

function deckInit(playerKey, enemyKey) {
  _deckPlayerKey    = playerKey;
  _deckEnemyKey     = enemyKey;
  _deckSlots        = [null, null, null, null, null];
  _evolutionCharges = {};
  _clearDeckTimers();
  _renderDeckSlots();
}

/** Firebase 덱 스냅샷 수신 시 */
function deckApplySnapshot(deckData) {
  for (let i = 0; i < 5; i++) {
    _deckSlots[i] = deckData?.[i] ? { ...CARD_DEFINITIONS[deckData[i].cardId] } : null;
  }
  _renderDeckSlots();
}

/** 게임 상태 캐시 (canDrop 판단용) */
function deckUpdateState(gameState) {
  _deckGameState = gameState;
}

// ── 덱 렌더링 ────────────────────────────────────────────────

function _renderDeckSlots() {
  const container = document.getElementById('deck-slots');
  if (!container) return;
  const slots = container.querySelectorAll('.deck-slot');

  slots.forEach((slotEl, i) => {
    slotEl.innerHTML = '';
    const card = _deckSlots[i];
    if (card) {
      const cardEl = _createCardElement(card, i, 'deck');
      slotEl.appendChild(cardEl);
    }
  });
}

// ── 타이머 정리 ─────────────────────────────────────────────

function _clearDeckTimers() {
  if (_offerAutoTimer) { clearTimeout(_offerAutoTimer); _offerAutoTimer = null; }
  if (_autoTurnTimer)  { clearTimeout(_autoTurnTimer);  _autoTurnTimer  = null; }
}

// ── 제공 카드 렌더링 ─────────────────────────────────────────

/**
 * @param {Array|null} offeredCards  [{cardId, grade}] 형태의 Firebase 데이터
 * @param {boolean} isMyTurn         내 턴인지 여부
 */
function renderOfferedCards(offeredCards, isMyTurn) {
  // 기존 타이머 초기화
  _clearDeckTimers();

  _lastOfferedCards = offeredCards;

  const container  = document.getElementById('offer-cards');
  const label      = document.getElementById('offer-label');
  const deckFullEl = document.getElementById('deck-full-msg');
  if (!container) return;

  container.innerHTML = '';
  if (deckFullEl) deckFullEl.classList.add('hidden');

  // ── 상대 턴 ──────────────────────────────────────────────
  if (!isMyTurn) {
    if (label) label.textContent = t('offerLabelEnemy');
    const ph = document.createElement('div');
    ph.className = 'offer-placeholder';
    ph.textContent = t('offerPlaceholderEnemy');
    container.appendChild(ph);
    return;
  }

  // ── 내 턴: 덱이 꽉 찬 경우 ──────────────────────────────
  const isDeckFull = _deckSlots.every(s => s !== null);
  if (isDeckFull) {
    if (label) label.textContent = t('offerLabelFull');
    if (deckFullEl) deckFullEl.classList.remove('hidden');

    const ph = document.createElement('div');
    ph.className = 'offer-placeholder';
    ph.textContent = t('offerPlaceholderFull');
    container.appendChild(ph);
    return;
  }

  // ── 내 턴: 카드 대기 중 ──────────────────────────────────
  if (!offeredCards) {
    if (label) label.textContent = t('offerLabelWaiting');
    const ph = document.createElement('div');
    ph.className = 'offer-placeholder';
    ph.textContent = t('offerPlaceholderWaiting');
    container.appendChild(ph);
    return;
  }

  // ── 내 턴: 카드 선택 ────────────────────────────────────
  if (label) label.textContent = t('offerLabelSelect');

  const cardItems = Object.values(offeredCards).filter(Boolean);

  cardItems.forEach(item => {
    const card = { ...CARD_DEFINITIONS[item.cardId] };
    const cardEl = _createCardElement(card, null, 'offer');

    // 클릭으로 바로 덱에 추가
    cardEl.addEventListener('click', () => {
      if (_deckSlots.every(s => s !== null)) return; // 덱 꽉 참 재확인
      _clearDeckTimers();
      addCardToDeck(card);
    });

    container.appendChild(cardEl);
  });
}

// ── 덱에 카드 추가 ───────────────────────────────────────────

function addCardToDeck(card) {
  const emptySlot = _deckSlots.findIndex(s => s === null);
  if (emptySlot === -1) return; // 덱 꽉 참

  _deckSlots[emptySlot] = card;
  writeDeckSlot(_deckPlayerKey, emptySlot, { cardId: card.id, grade: card.grade });
  _renderDeckSlots();

  // 전설·비밀 카드 등장 효과
  if (card.grade === 'legendary' || card.grade === 'secret') showLegendaryFlash();

  // 턴 진행 (제공 카드 소비 → 다음 플레이어 턴)
  if (typeof window.onCardPickedFromOffer === 'function') {
    window.onCardPickedFromOffer();
  }
}

// ── 카드 사용 (드래그 앤 드롭 완료 시) ──────────────────────

/**
 * board.js에서 drop 발생 시 호출됨 (window.onCardUsed)
 * card 파라미터는 이미 _getEffectiveCard()가 적용된 카드 (startStickyDrag 시점에 변환)
 */
window.onCardUsed = function(card, slotIndex, targetOwner, targetPos) {
  // 슬롯 이중 소비 방지
  if (_deckSlots[slotIndex] === null) return;

  // 덱 동결 체크 (얼음전개로 인한 사용 금지)
  const freezeUntil = _deckGameState?.[_deckPlayerKey]?.deckFreezeUntil;
  if (freezeUntil && serverNow() < freezeUntil) {
    const slotsEl = document.getElementById('deck-slots');
    if (slotsEl) {
      slotsEl.classList.add('deck-frozen');
      setTimeout(() => slotsEl.classList.remove('deck-frozen'), 500);
    }
    return;
  }

  if (!deductEnergy(card.energyCost)) return;

  // ── 진화 충전 카운터 업데이트 ──────────────────────────
  const originalId = card._evolvedFrom || card.id;
  if (EVOLUTION_MAP[originalId]) {
    if (card._evolvedFrom) {
      // 진화 카드 사용 → 초기화
      _evolutionCharges[originalId] = 0;
    } else {
      _evolutionCharges[originalId] = (_evolutionCharges[originalId] || 0) + 1;
    }
  }

  // ── 도감 수집 ────────────────────────────────────────
  if (typeof collectCard === 'function') collectCard(card.id);

  // ── dual 타입: 타겟 방향에 따라 실제 효과 카드 결정 ──
  const cardType    = card.type;
  const isOwnTarget = cardType === 'heal' || cardType === 'defense' ||
                      (cardType === 'dual' && targetOwner === 'my');

  const myTowersData    = _deckGameState?.[_deckPlayerKey]?.towers;
  const enemyTowersData = _deckGameState?.[_deckEnemyKey]?.towers;

  const targetTowersData = isOwnTarget ? myTowersData    : enemyTowersData;
  const targetPlayerKey  = isOwnTarget ? _deckPlayerKey  : _deckEnemyKey;

  // dual 카드: 실제 적용할 서브이펙트로 카드를 변환
  let cardForApply = card;
  if (cardType === 'dual' && card.effect?.dualEffect) {
    const subEffect = isOwnTarget ? card.effect.dualEffect.support : card.effect.dualEffect.attack;
    cardForApply = { ...card, type: isOwnTarget ? 'heal' : 'attack', effect: subEffect };
  }

  const rangeCount = getRangeCount(card.targeting);
  const affected   = getAffectedPositions(targetPos, rangeCount);

  _deckSlots[slotIndex] = null;
  _renderDeckSlots(); // 게이지 포함 즉시 재렌더

  const slotEls = document.querySelectorAll('.deck-slot');
  const cardEl  = slotEls[slotIndex]?.querySelector('.card');
  if (cardEl) {
    cardEl.classList.add('card-used');
    setTimeout(() => _renderDeckSlots(), 400);
  }

  // 덱 슬롯이 비워졌으므로 offer 섹션 재렌더 → 덱 꽉 참 메세지/기능 해제
  renderOfferedCards(_deckGameState?.[_deckPlayerKey]?.offeredCards, isMyTurn());

  applyCardUse(
    _deckPlayerKey,
    slotIndex,
    getCurrentEnergy(),
    targetPlayerKey,
    affected,
    cardForApply,
    targetTowersData || {},
    _deckGameState
  );

  // 덱 슬롯이 비워졌으므로 제공 카드 없으면 즉시 새 카드 생성
  if (typeof turnsOnCardUsed === 'function') turnsOnCardUsed();
};

// ── 카드 DOM 생성 ────────────────────────────────────────────

function _createCardElement(card, slotIndex, context) {
  // 덱 슬롯이면 진화 상태 카드를 표시
  const originalId = card._evolvedFrom || card.id;
  const displayCard = context === 'deck' ? _getEffectiveCard(card) : card;
  const isEvolved = !!displayCard._evolvedFrom;

  const el = document.createElement('div');
  el.className = `card grade-${displayCard.grade}${isEvolved ? ' card-evolved' : ''}`;

  if (getCurrentEnergy() < displayCard.energyCost) {
    el.classList.add('cannot-afford');
  }
  if (context === 'offer') {
    el.style.cursor = 'pointer';
  }

  const cardName   = isEvolved ? displayCard.name : tCard(displayCard.id, 'name');
  const cardDesc   = isEvolved ? displayCard.desc : tCard(displayCard.id, 'desc');
  const gradeLabel = t('grade_' + displayCard.grade);
  const gaugeHtml  = context === 'deck' ? _buildChargeGauge(originalId) : '';

  el.innerHTML = `
    <div class="card-icon">${displayCard.icon}</div>
    <div class="card-name">${cardName}</div>
    <div class="card-footer">
      <span class="card-energy-cost">⚡${displayCard.energyCost}</span>
      <span class="card-grade-dot"></span>
    </div>
    ${gaugeHtml}
    <div class="card-tooltip">
      <div class="tooltip-name">${GRADE_EMOJI[displayCard.grade]} ${cardName}${isEvolved ? ' ✨' : ''}</div>
      <div class="tooltip-row">${GRADE_EMOJI[displayCard.grade]} <span>${gradeLabel}</span></div>
      <div class="tooltip-row">⚡ <span>-${displayCard.energyCost}</span></div>
      <div class="tooltip-row">${cardDesc}</div>
    </div>
  `;

  if (context === 'deck') {
    el.addEventListener('click', e => {
      const effectiveCard = _getEffectiveCard(card);
      if (_isMobileTouchDevice()) {
        _autoUseCard(card, slotIndex);
      } else {
        startStickyDrag(e, effectiveCard, slotIndex, el);
      }
    });
  }

  return el;
}

/** 모바일 터치 기기 여부 */
function _isMobileTouchDevice() {
  return navigator.maxTouchPoints > 0;
}

/**
 * 모바일 원탭 자동 사용 — 카드 타입에 맞는 최적 타워에 즉시 사용
 * heal/defense → 내 타워 (킹 우선), attack/control → 적 타워 (좌→우→킹)
 * dual → 적 타워 우선 (공격 효과 기본)
 */
function _autoUseCard(card, slotIndex) {
  const effectiveCard = _getEffectiveCard(card);
  boardSetDraggingCard(effectiveCard, slotIndex);

  const cardType    = effectiveCard.type;
  const isOwnTarget = cardType === 'heal' || cardType === 'defense';
  const orders = isOwnTarget
    ? [['my', 'king'], ['my', 'left'], ['my', 'right']]
    : [['enemy', 'left'], ['enemy', 'right'], ['enemy', 'king']];

  let hit = null;
  for (const [owner, pos] of orders) {
    if (canDropOnTower(owner, pos)) { hit = [owner, pos]; break; }
  }

  boardClearDraggingCard();
  if (!hit) return;
  onCardDropped(effectiveCard, slotIndex, hit[0], hit[1]);
}

/** 덱 꽉 참 여부 */
function isDeckFull() {
  return _deckSlots.every(s => s !== null);
}

/**
 * 30초 자동 턴넘김 시 turns.js에서 호출
 * 제공 카드 중 랜덤 선택 → 덱 추가 → 턴 진행
 * 덱 꽉 찼거나 카드 없으면 그냥 턴 진행
 */
window.deckAutoPickRandom = function() {
  _clearDeckTimers();
  if (_deckSlots.every(s => s !== null) || !_lastOfferedCards) {
    turnsAdvance();
    return;
  }
  const items = Object.values(_lastOfferedCards).filter(Boolean);
  if (!items.length) {
    turnsAdvance();
    return;
  }
  const randomItem = items[Math.floor(Math.random() * items.length)];
  addCardToDeck({ ...CARD_DEFINITIONS[randomItem.cardId] });
  // addCardToDeck 내부에서 onCardPickedFromOffer → turnsAdvance 호출
};

/** 에너지 변화 시 덱 카드 활성화/비활성화 상태 갱신 */
function updateDeckAffordability() {
  const energy = getCurrentEnergy();
  document.querySelectorAll('#deck-slots .card').forEach(cardEl => {
    const costEl = cardEl.querySelector('.card-energy-cost');
    if (!costEl) return;
    const cost = parseInt(costEl.textContent.replace('⚡', ''), 10);
    cardEl.classList.toggle('cannot-afford', energy < cost);
  });
}

// ── 키보드 단축키 (Q/W/E/R/T → 덱 슬롯 1~5 선택) ───────────
const _DECK_HOTKEYS = { q: 0, w: 1, e: 2, r: 3, t: 4 };

document.addEventListener('keydown', e => {
  if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

  const slotIdx = _DECK_HOTKEYS[e.key.toLowerCase()];
  if (slotIdx === undefined) return;

  const card = _deckSlots[slotIdx];
  if (!card) return;

  const slotEls = document.querySelectorAll('#deck-slots .deck-slot');
  const cardEl  = slotEls[slotIdx]?.querySelector('.card');
  if (!cardEl) return;

  const rect = cardEl.getBoundingClientRect();
  const fakeEvent = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const effectiveCard = _getEffectiveCard(card);
  startStickyDrag(fakeEvent, effectiveCard, slotIdx, cardEl);
});

// ── 키보드 단축키 (1/2/3 → 제공 카드 선택) ─────────────────
document.addEventListener('keydown', e => {
  const n = parseInt(e.key);
  if (n < 1 || n > 3) return;
  if (!isMyTurn()) return;
  if (!_lastOfferedCards) return;
  if (_deckSlots.every(s => s !== null)) return;

  const items = Object.values(_lastOfferedCards).filter(Boolean);
  const item  = items[n - 1];
  if (!item) return;

  _clearDeckTimers();
  addCardToDeck({ ...CARD_DEFINITIONS[item.cardId] });
});
