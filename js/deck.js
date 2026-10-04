// ============================================================
//  deck.js — 5슬롯 덱 렌더링, 카드 선택/사용 로직
// ============================================================

// 한 슬롯에는 같은 카드만 쌓인다 — 슬롯 = { card, count }
const DECK_SLOT_COUNT = 5;
const DECK_STACK_MAX  = 9;

let _deckPlayerKey  = null;
let _deckEnemyKey   = null;
let _deckSlots      = [null, null, null, null, null]; // 로컬 캐시 ({ card, count } | null)
let _deckGameState  = null;
let _selectedSlot   = null;   // 지금 들고 있는(선택한) 슬롯 — 개수 표시·강조용
let _pendingCard    = null;   // 자리가 없어 대기 중인 카드 { card, from: 'evolution'|'offer' }

// 자동 선택/턴 전환 타이머
let _lastOfferedCards = null; // 현재 제공 중인 카드 캐시

// 카드 미리보기 상태
let _previewActive         = false;
let _previewTimer          = null;
let _previewOfferedKey     = null;
let _hasPickedCard         = false; // 첫 선택 이후부터 미리보기 활성화
let _previewSelectedIdx    = null;  // 미리보기 중 찜한 카드 위치 인덱스 (0/1/2)

// ── 진화 시스템 ──────────────────────────────────────────
let _evolutionCharges = {}; // originalCardId → count (0~2: 충전 중, 3: 진화 완료)

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

// ── 슬롯 헬퍼 ────────────────────────────────────────────────

/** Firebase에 쓸 슬롯 값 */
function _slotValue(slot) {
  return slot ? { cardId: slot.card.id, grade: slot.card.grade, count: slot.count } : null;
}

function _writeSlot(i) {
  writeDeckSlot(_deckPlayerKey, i, _slotValue(_deckSlots[i]));
}

/** 같은 카드가 쌓여 있는 슬롯 (상한 미만) */
function _findStackSlot(cardId) {
  return _deckSlots.findIndex(s => s && s.card.id === cardId && s.count < DECK_STACK_MAX);
}

function _findEmptySlot() {
  return _deckSlots.findIndex(s => s === null);
}

/** 카드 한 장을 덱에 넣는다 — 같은 카드가 있으면 개수만 늘린다. 자리가 없으면 false */
function _placeCard(card) {
  const stack = _findStackSlot(card.id);
  if (stack !== -1) {
    _deckSlots[stack].count++;
    _writeSlot(stack);
    _renderDeckSlots();
    return true;
  }
  const empty = _findEmptySlot();
  if (empty === -1) return false;
  _deckSlots[empty] = { card: { ...card }, count: 1 };
  _writeSlot(empty);
  _renderDeckSlots();
  return true;
}

/** 대기 중인 카드를 자리가 나면 자동으로 넣는다 */
function _tryPlacePending() {
  if (!_pendingCard) return;
  if (_placeCard(_pendingCard.card)) _clearPendingCard();
}

/** 자리가 없다 — 대체할 슬롯을 고르게 한다 (슬롯 더블클릭) */
function _setPendingCard(card, from) {
  _pendingCard = { card: { ...card }, from };
  _renderReplaceBanner();
  _renderDeckSlots();
}

function _clearPendingCard() {
  _pendingCard = null;
  _renderReplaceBanner();
  _renderDeckSlots();
  // 대기 중에는 새 카드 제공이 멈춰 있었다 — 다시 받기 시작
  if (typeof turnsOnCardUsed === 'function') turnsOnCardUsed();
}

/** 대기 중인 카드가 있는지 (turns.js·UI에서 참조) */
function deckHasPendingCard() {
  return !!_pendingCard;
}

function _renderReplaceBanner() {
  const el = document.getElementById('deck-replace-banner');
  if (!el) return;
  el.classList.toggle('hidden', !_pendingCard);
  if (!_pendingCard) return;
  const name = tCard(_pendingCard.card.id, 'name');
  el.innerHTML = `<span class="replace-card">${_pendingCard.card.icon} ${name}</span>` +
                 `<span class="replace-text">${t('deckFullReplace')}</span>`;
}

/** 대체 — 고른 슬롯의 카드는 개수와 상관없이 모두 버려진다 */
function _replaceSlot(i) {
  if (!_pendingCard || deckInputLocked()) return;
  _deckSlots[i] = { card: _pendingCard.card, count: 1 };
  _writeSlot(i);
  _clearPendingCard();
  _renderDeckSlots();
}

// 대체할 슬롯 고르기 — 슬롯이 가득 차 대기 중인 카드가 있을 때만 동작한다.
// 같은 슬롯을 연속 두 번 클릭 (브라우저 dblclick은 첫 클릭에서 슬롯이 다시 그려지면 놓칠 수 있어 직접 센다)
const DECK_DBLCLICK_MS = 450;
let _lastSlotClick = { i: -1, t: 0 };

document.getElementById('deck-slots')?.addEventListener('click', e => {
  const slotEl = e.target.closest('.deck-slot');
  if (!slotEl) return;
  const i     = +slotEl.dataset.slot;
  const now   = Date.now();
  const isDbl = _lastSlotClick.i === i && now - _lastSlotClick.t < DECK_DBLCLICK_MS;
  _lastSlotClick = { i, t: now };
  if (!isDbl || !_pendingCard || deckInputLocked()) return;
  // 두 번째 클릭은 카드 사용으로 새지 않게 여기서 멈춘다
  e.stopPropagation();
  e.preventDefault();
  cancelStickyDrag();
  _replaceSlot(i);
}, true);

/** 들고 있는 슬롯 표시 — board.js가 카드를 집고 놓을 때 호출 */
function deckSetSelectedSlot(i) {
  if (_selectedSlot === i) return;
  _selectedSlot = i;
  _renderDeckSlots();
}

function deckInit(playerKey, enemyKey) {
  _deckPlayerKey    = playerKey;
  _deckEnemyKey     = enemyKey;
  _deckSlots        = [null, null, null, null, null];
  _evolutionCharges = {};
  _selectedSlot     = null;
  _pendingCard      = null;
  _cancelPreview();
  _hasPickedCard = false;
  _renderReplaceBanner();
  _renderDeckSlots();

  // 개발자 모드면 제공 카드를 기다리지 않고 바로 검색기를 띄운다
  if (typeof devModeOn === 'function' && devModeOn()) {
    devRenderPicker(document.getElementById('offer-cards'), document.getElementById('offer-label'));
  }
}

/** 재접속 시 Firebase에서 진화 카운터 복원 */
function deckApplyEvolutionCharges(chargesData) {
  if (!chargesData) return;
  _evolutionCharges = { ...chargesData };
  _renderDeckSlots();
}

/** Firebase 덱 스냅샷 수신 시 */
function deckApplySnapshot(deckData) {
  for (let i = 0; i < DECK_SLOT_COUNT; i++) {
    const item = deckData?.[i];
    const def  = item ? CARD_DEFINITIONS[item.cardId] : null;
    _deckSlots[i] = def ? { card: { ...def }, count: clamp(item.count || 1, 1, DECK_STACK_MAX) } : null;
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
    const slot = _deckSlots[i];
    // 대체 대기 중에는 모든 슬롯이 대체 대상
    slotEl.classList.toggle('slot-replaceable', !!_pendingCard);
    slotEl.classList.toggle('slot-selected', _selectedSlot === i && !!slot);
    if (!slot) return;
    const cardEl = _createCardElement(slot.card, i, 'deck');
    if (slot.count > 1) {
      const badge = document.createElement('span');
      badge.className = 'card-count';
      badge.textContent = 'x' + slot.count;
      cardEl.appendChild(badge);
    }
    slotEl.appendChild(cardEl);
  });
}

// ── 타이머 정리 ─────────────────────────────────────────────

// ── 제공 카드 렌더링 ─────────────────────────────────────────

/**
 * @param {Array|null} offeredCards  [{cardId, grade}] 형태의 Firebase 데이터
 */
function renderOfferedCards(offeredCards) {
  // 기존 타이머 초기화

  _lastOfferedCards = offeredCards;

  const container  = document.getElementById('offer-cards');
  const label      = document.getElementById('offer-label');
  const deckFullEl = document.getElementById('deck-full-msg');
  if (!container) return;

  // 개발자 모드 — 카드 선택 대신 카드 검색기 (js/dev.js)
  if (typeof devModeOn === 'function' && devModeOn()) {
    if (deckFullEl) deckFullEl.classList.add('hidden');
    devRenderPicker(container, label);
    return;
  }

  container.innerHTML = '';
  if (deckFullEl) deckFullEl.classList.add('hidden');

  // 덱이 꽉 차도 카드는 계속 보여 준다 — 고르면 대체할 슬롯을 지정하게 된다
  if (_deckSlots.every(s => s !== null) && deckFullEl) deckFullEl.classList.remove('hidden');

  // ── 내 턴: 카드 대기 중 ──────────────────────────────────
  if (!offeredCards) {
    // 카드를 이미 고른 뒤라면 waiting 메시지 없이 빈 상태로 대기 (곧 미리보기로 전환)
    if (_hasPickedCard) {
      if (label) label.textContent = t('offerLabelPreview');
      return;
    }
    if (label) label.textContent = t('offerLabelWaiting');
    const ph = document.createElement('div');
    ph.className = 'offer-placeholder';
    ph.textContent = t('offerPlaceholderWaiting');
    container.appendChild(ph);
    return;
  }

  // ── 내 턴: 카드 선택 ────────────────────────────────────
  const cardItems = Object.values(offeredCards).filter(Boolean);
  const newKey = cardItems.map(i => i.cardId).join(',');

  // 새 카드 세트 → 카드를 한 번 이상 고른 뒤에만 미리보기
  if (newKey !== _previewOfferedKey) {
    _cancelPreview();
    _previewOfferedKey = newKey;
    if (_hasPickedCard) {
      _previewActive = true;
      _startOfferPreviewCountdown(label);
    }
  }

  if (label) label.textContent = _previewActive ? t('offerLabelPreview') : t('offerLabelSelect');

  cardItems.forEach((item, idx) => {
    const card = { ...CARD_DEFINITIONS[item.cardId] };
    const cardEl = _createCardElement(card, null, 'offer');

    if (_previewActive) {
      if (_previewSelectedIdx === idx) _appendCheckIcon(cardEl);
      cardEl.addEventListener('click', () => _setPreviewSelection(idx));
    } else {
      cardEl.addEventListener('click', () => {
        if (deckInputLocked() || _pendingCard) return;
        addCardToDeck(card);
      });
    }

    container.appendChild(cardEl);
  });
}

// ── 입력 잠금 ────────────────────────────────────────────────
// 매치 종료 판정이 나면(결과 화면 연출 중 포함) 카드 선택·사용을 모두 막는다.
// 단축키 연타로 덱만 채워지거나, 이미 확정된 경기에 쓰기를 시도하는 것을 막는다.
function deckInputLocked() {
  return !!window.matchInputLocked;
}

/**
 * 지금 덱의 카드를 고를 수 없는가 — 그림리퍼 컷씬 중(게임 시간이 멈춤) · 얼음전개로 덱이 얼어 있는 동안.
 * 이때 단축키(Q~T)나 클릭으로 카드를 집으면 범위 표시가 뜨거나 쓰이기까지 했다 → 아예 집지 못하게 한다.
 */
function deckSelectBlocked(card = null) {
  if (deckInputLocked()) return true;
  if (typeof gamePaused === 'function' && gamePaused()) return true;
  return deckFrozenFor(card);
}

/**
 * 얼음전개로 덱이 얼어 카드를 못 쓰는가 — 언 동안엔 어떤 카드도 쓸 수 없다 (불 카드도).
 * 언 타워를 녹이는 건 얼린 쪽만 할 수 있다 (불덩이 · 폭염 — sync.js applyCardUse)
 */
function deckFrozenFor(card) {
  const freezeUntil = _deckGameState?.[_deckPlayerKey]?.deckFreezeUntil;
  return !!(freezeUntil && gameNow() < freezeUntil);
}

/** 얼어 있는 동안 고르려 하면 — 덱이 잠깐 떨린다 (얼음 표시) */
function _deckNotifyFrozen() {
  const slotsEl = document.getElementById('deck-slots');
  if (!slotsEl) return;
  slotsEl.classList.remove('deck-frozen');
  void slotsEl.offsetWidth;
  slotsEl.classList.add('deck-frozen');
  setTimeout(() => slotsEl.classList.remove('deck-frozen'), 500);
}

/** 매치 종료 — 타이머·미리보기를 끄고 제공 카드 영역을 비운다 (game.js _lockMatchInput) */
function deckLockInput() {
  cancelStickyDrag();
  _cancelPreview();
  _lastOfferedCards = null;
  const container = document.getElementById('offer-cards');
  if (container) container.innerHTML = '';
  const label = document.getElementById('offer-label');
  if (label) label.textContent = t('offerLabelFull');
  const deckFullEl = document.getElementById('deck-full-msg');
  if (deckFullEl) deckFullEl.classList.add('hidden');
}

// ── 덱에 카드 추가 ───────────────────────────────────────────

function addCardToDeck(card) {
  if (deckInputLocked()) return;
  if (_pendingCard) return;   // 먼저 대체할 슬롯을 고르거나 슬롯을 비워야 한다

  _cancelPreview();
  _hasPickedCard     = true;  // 이후 카드 세트부터 미리보기 활성화
  _previewOfferedKey = null;  // 다음 제공 시 새 미리보기 트리거

  // 같은 카드는 한 슬롯에 개수로 쌓이고, 자리가 아예 없으면 대체할 슬롯을 고르게 한다
  if (!_placeCard(card)) _setPendingCard(card, 'offer');

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
 * 한 번 쓸 때 그 슬롯의 개수가 1 줄고, 0이 되면 슬롯이 빈다.
 */
window.onCardUsed = function(card, slotIndex, targetOwner, targetPos, applyDelayMs = 0, opts = null) {
  // 매치 종료 판정 중·이후엔 사용 불가
  if (window.matchInputLocked) return;
  if (typeof gamePaused === 'function' && gamePaused()) return;   // 컷씬 중 (게임 시간이 멈춰 있다)
  // 슬롯 이중 소비 방지
  if (!_deckSlots[slotIndex]) return;

  // 덱 동결 체크 (얼음전개로 인한 사용 금지 — 모든 카드)
  if (deckFrozenFor(card)) {
    const slotsEl = document.getElementById('deck-slots');
    if (slotsEl) {
      slotsEl.classList.add('deck-frozen');
      setTimeout(() => slotsEl.classList.remove('deck-frozen'), 500);
    }
    return;
  }

  if (!deductEnergy(card.energyCost)) return;


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

  // 투척(돌)처럼 쓸 때마다 피해가 달라지는 카드 — board.js가 정한 값으로 바꿔 끼운다
  if (typeof opts?.damage === 'number' && cardForApply.effect) {
    cardForApply = { ...cardForApply, effect: { ...cardForApply.effect, damage: opts.damage } };
  }

  // 토템의 회복에는 '어느 칸의 토템인가'를 붙인다 — 붕괴가 그 토템을 무너뜨리면 회복도 찾아서 멈춘다
  if (opts?.totem && cardForApply.effect?.hot) {
    cardForApply = { ...cardForApply, effect: { ...cardForApply.effect, hot: { ...cardForApply.effect.hot, totem: opts.totem } } };
  }

  // 설치형(원형 토템)은 원 안에 들어온 타워만 효과를 받는다 — board.js가 골라 보낸다.
  // 빈 땅에 놓아 아무 타워도 안 들어오면 그대로 설치되고 아무 효과도 없다 (자리 잡는 법을 익히도록)
  const rangeCount = getRangeCount(card.targeting);
  const affected   = opts?.positions || getAffectedPositions(targetPos, rangeCount);

  // ── 슬롯에서 한 장 소모 ────────────────────────────────
  const slot = _deckSlots[slotIndex];
  slot.count -= 1;
  if (slot.count <= 0) _deckSlots[slotIndex] = null;
  if (_selectedSlot === slotIndex && !_deckSlots[slotIndex]) _selectedSlot = null;

  const slotEls = document.querySelectorAll('.deck-slot');
  const cardEl  = slotEls[slotIndex]?.querySelector('.card');
  if (cardEl) cardEl.classList.add('card-used');
  setTimeout(() => _renderDeckSlots(), 400);
  _renderDeckSlots();

  // ── 진화 ────────────────────────────────────────────────
  // 같은 카드를 3번 쓰면 진화 카드가 '새 카드'로 빈 슬롯에 생긴다.
  // 슬롯이 꽉 차 있으면 대체할 슬롯을 고를 때까지 기다린다.
  if (EVOLUTION_MAP[card.id]) {
    const charge = (_evolutionCharges[card.id] || 0) + 1;
    if (charge >= 3) {
      _evolutionCharges[card.id] = 0;
      const evolved = { ...CARD_DEFINITIONS[EVOLUTION_MAP[card.id]] };
      if (!_placeCard(evolved)) _setPendingCard(evolved, 'evolution');
      showLegendaryFlash();
    } else {
      _evolutionCharges[card.id] = charge;
    }
    writeEvolutionCharges(_deckPlayerKey, _evolutionCharges);
  }

  // 자리가 나면 대기 중이던 카드를 넣는다
  _tryPlacePending();

  // 덱 슬롯이 비워졌으므로 offer 섹션 재렌더 → 덱 꽉 참 메세지/기능 해제
  renderOfferedCards(_deckGameState?.[_deckPlayerKey]?.offeredCards);

  // 연출이 있는 카드: 상대 화면에도 같은 연출이 보이도록 시전 신호를 먼저 보내고,
  // 피해는 연출이 끝나는 시점에 기록한다 (에너지·슬롯은 이미 소모됨 — 중복 사용 불가)
  const apply = () => {
    if (window.matchInputLocked) return;
    applyCardUse(
      _deckPlayerKey,
      slotIndex,
      getCurrentEnergy(),
      targetPlayerKey,
      affected,
      cardForApply,
      targetTowersData || {},
      _deckGameState,
      _slotValue(_deckSlots[slotIndex])   // 남은 개수 (없으면 null)
    );
  };
  // ── 소환 (그림리퍼) ── 에너지·덱 칸을 기록하고, 컷씬 멈춤과 유닛을 한 번에 쓴다 (js/units.js)
  if (opts?.summon && typeof unitsSummon === 'function') {
    applyCardUse(_deckPlayerKey, slotIndex, getCurrentEnergy(), _deckEnemyKey, [],
                 { ...card, effect: {} }, enemyTowersData || {}, _deckGameState,
                 _slotValue(_deckSlots[slotIndex]));
    unitsSummon(_deckPlayerKey, opts.summon.col, opts.summon.row, opts.summon.target);
    if (typeof turnsOnCardUsed === 'function') turnsOnCardUsed();
    return;
  }

  // 공격 범위에 든 상대 소환 유닛 — 피해가 들어가는 순간의 자리로 판정한다
  if (opts?.unitStrike && typeof unitsWriteStrike === 'function') {
    unitsWriteStrike(_deckPlayerKey, opts.unitStrike.tiles, opts.unitStrike.delayMs);
  }
  // 침수·파도 — 시각마다 따로 (줄마다 물살 · 틱마다 범위)
  if (opts?.unitStrikeList && typeof unitsWriteStrike === 'function') {
    opts.unitStrikeList.forEach(s => unitsWriteStrike(_deckPlayerKey, s.tiles, s.delayMs, s.status));
  }

  // 연출이 있는 카드는 상대·관전자 화면에서도 같은 연출이 돌아야 한다 (지연 여부와 무관)
  // 연출 id에 차징 단계가 붙어 있을 수 있다 ('stone@3') — 상대도 같은 속도로 봐야 한다
  // 연출은 '놓은 진영' 기준이다 — 내 진영에 쏜 화살처럼 피해 대상(상대)과 연출 자리(내 진영)가 다를 수 있다
  const fxTargetKey = targetOwner === 'my' ? _deckPlayerKey : _deckEnemyKey;
  if (card.cast) writeCastFx(_deckPlayerKey, fxTargetKey, targetPos, opts?.castId || card.cast, opts?.dx, opts?.dy, opts?.castKey);

  // ── 대상마다 따로 들어가는 카드 (바위 지옥) ──────────────
  // 덩이마다 도착 시각·피해·돌가루가 다르다. 에너지와 덱 칸은 지금 한 번만 기록하고,
  // 덩이별 피해는 각자의 도착 시각에 '피해만' 넣는다 (slotIndex null).
  // 빈 배열도 '이 카드는 덩이 단위로 들어간다'는 뜻이다 —
  // 토네이도를 아무 타워도 닿지 않는 줄에 놓으면 그냥 지나가고 피해가 없다.
  // 길이로 검사하면 평소 경로로 새어 들어가 엉뚱한 타워를 때린다.
  if (Array.isArray(opts?.shots)) {
    const towers = targetTowersData || {};
    applyCardUse(_deckPlayerKey, slotIndex, getCurrentEnergy(), targetPlayerKey, [],
                 { ...cardForApply, effect: {} }, towers, _deckGameState,
                 _slotValue(_deckSlots[slotIndex]));
    // 덩이마다 따로 예약한다 — 중간에 끊겨도 남은 덩이가 들어간다
    opts.shots.forEach(shot => {
      writePendingHit({
        sourcePlayer: _deckPlayerKey,
        targetPlayer: targetPlayerKey,
        positions:    [shot.pos],
        cardId:       cardForApply.id,
        cardType:     cardForApply.type,
        // 덩이마다 효과가 따로 올 수 있다 (침수: 물살 30 · 가라앉는 동안의 지속 피해)
        effect:       shot.effect || (shot.dot ? { damage: shot.damage, dot: shot.dot } : { damage: shot.damage }),
        applyAt:      gameNow() + shot.flyMs
      });
    });
    if (typeof turnsOnCardUsed === 'function') turnsOnCardUsed();
    return;
  }

  if (applyDelayMs > 0) {
    // 연출이 끝나는 시각에 들어갈 피해 — 지금 예약만 남기고 실제 적용은
    // pendingHits가 맡는다. 이 사이에 내가 끊겨도 맞는 쪽이 대신 넣는다.
    // 에너지와 덱 칸은 지금 바로 기록한다 (중복 사용 방지 · 상대 화면 갱신).
    applyCardUse(_deckPlayerKey, slotIndex, getCurrentEnergy(), targetPlayerKey, [],
                 { ...cardForApply, effect: {} }, targetTowersData || {}, _deckGameState,
                 _slotValue(_deckSlots[slotIndex]));
    writePendingHit({
      sourcePlayer: _deckPlayerKey,
      targetPlayer: targetPlayerKey,
      positions:    affected,
      cardId:       cardForApply.id,
      cardType:     cardForApply.type,
      effect:       cardForApply.effect || {},
      applyAt:      gameNow() + applyDelayMs
    });
  } else {
    apply();
  }

  // 덱 슬롯이 비워졌으므로 제공 카드 없으면 즉시 새 카드 생성
  if (typeof turnsOnCardUsed === 'function') turnsOnCardUsed();
};

// ── 카드 DOM 생성 ────────────────────────────────────────────

function _createCardElement(card, slotIndex, context) {
  const originalId  = card.id;
  const displayCard = card;
  const isEvolved   = EVOLUTION_ORIGIN[card.id] !== undefined;   // 진화로 태어난 카드

  const el = document.createElement('div');
  el.className = `card grade-${displayCard.grade}${isEvolved ? ' card-evolved' : ''}`;

  if (getCurrentEnergy() < displayCard.energyCost && context !== 'offer') {
    el.classList.add('cannot-afford');
  }
  if (context === 'offer') {
    el.style.cursor = 'pointer';
  }
  cardApplyArt(el, displayCard);

  const cardName   = tCard(displayCard.id, 'name');
  const cardDesc   = tCard(displayCard.id, 'desc');
  const gradeLabel = t('grade_' + displayCard.grade);
  const gaugeHtml  = context === 'deck' ? _buildChargeGauge(originalId) : '';

  el.innerHTML = `
    <div class="card-icon">${displayCard.icon}</div>
    <div class="card-name">${cardName}</div>
    <div class="card-footer">
      <span class="card-energy-cost" title="에너지 ${displayCard.energyCost}">${displayCard.energyCost}</span>
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
      if (deckSelectBlocked(card)) { if (!deckInputLocked()) _deckNotifyFrozen(); return; }
      // 같은 카드를 다시 누르면 선택 해제
      if (boardIsHoldingCard() && _selectedSlot === slotIndex) { cancelStickyDrag(); return; }
      // 앞선 공격 연출이 아직 도는 중이면 고를 수 없다
      if (castBlocked(card)) { castNotifyBlocked(); return; }
      if (_isMobileTouchDevice()) _autoUseCard(card, slotIndex);
      else                        startStickyDrag(e, card, slotIndex, el);
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
  if (deckInputLocked()) return;
  if (castBlocked(card)) { castNotifyBlocked(); return; }
  const effectiveCard = card;
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

// 키를 '뗄 때' 한 번 동작한다. 누를 때 동작하면, 꾹 누르고 있는 동안 키 반복 입력이
// 계속 들어와 '집기 → 놓기 → 집기…'를 번갈아 하며 범위 표시가 깜빡였다.
// 누른 키를 적어 두고 그 키를 뗄 때만 처리한다 (반복 입력·다른 곳에서 누른 키는 무시).
const _hotkeyHeld = new Set();

function _deckHotkeyKey(e) {
  if (deckInputLocked() || (typeof gamePaused === 'function' && gamePaused())) return null;   // 컷씬 중엔 단축키도 듣지 않는다
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return null;
  const k = (e.key || '').toLowerCase();
  return _DECK_HOTKEYS[k] === undefined ? null : k;
}

document.addEventListener('keydown', e => {
  const k = _deckHotkeyKey(e);
  if (k) _hotkeyHeld.add(k);
});
// 창을 벗어나 키를 떼면 keyup이 안 온다 — 다음에 누를 때 엉키지 않게 비운다
window.addEventListener('blur', () => _hotkeyHeld.clear());

document.addEventListener('keyup', e => {
  const k = _deckHotkeyKey(e);
  if (!k || !_hotkeyHeld.has(k)) return;
  _hotkeyHeld.delete(k);
  const slotIdx = _DECK_HOTKEYS[k];

  const slot = _deckSlots[slotIdx];
  if (!slot) return;
  if (deckFrozenFor(slot.card)) { _deckNotifyFrozen(); return; }                         // 얼음전개 — 어떤 카드도 쓸 수 없다
  if (boardIsHoldingCard() && _selectedSlot === slotIdx) { cancelStickyDrag(); return; }   // 같은 키 = 해제
  if (castBlocked(slot.card)) { castNotifyBlocked(); return; }

  const slotEls = document.querySelectorAll('#deck-slots .deck-slot');
  const cardEl  = slotEls[slotIdx]?.querySelector('.card');
  if (!cardEl) return;

  // 카드(또는 사거리)는 지금 마우스 위치에 바로 붙는다
  const p = boardPointer();
  startStickyDrag({ clientX: p.x, clientY: p.y }, slot.card, slotIdx, cardEl);
});

// ── 키보드 단축키 (1/2/3 → 제공 카드 선택 / 미리보기 중엔 찜하기) ──
document.addEventListener('keydown', e => {
  if (deckInputLocked()) return;
  if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
  const n = parseInt(e.key);
  if (n < 1 || n > 3) return;
  if (!_lastOfferedCards) return;
  if (_pendingCard) return;

  const items = Object.values(_lastOfferedCards).filter(Boolean);
  const item  = items[n - 1];
  if (!item) return;

  if (_previewActive) {
    _setPreviewSelection(n - 1);
    return;
  }

  addCardToDeck({ ...CARD_DEFINITIONS[item.cardId] });
});

// ── 카드 미리보기 헬퍼 ────────────────────────────────────────

function _cancelPreview() {
  if (_previewTimer) { clearInterval(_previewTimer); _previewTimer = null; }
  _previewActive      = false;
  _previewSelectedIdx = null;
  const el = document.getElementById('offer-preview-indicator');
  if (el) el.classList.add('hidden');
}

function _getOrCreatePreviewIndicator() {
  let el = document.getElementById('offer-preview-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'offer-preview-indicator';
    el.className = 'offer-preview-indicator';
    el.innerHTML = `<span class="material-symbols-outlined offer-spin-icon">playing_cards</span><span id="offer-preview-num" class="offer-preview-num">5</span>`;
    const header = document.querySelector('.offer-header');
    if (header) header.appendChild(el);
  }
  el.classList.remove('hidden');
  return el;
}

function _startOfferPreviewCountdown(labelEl) {
  if (_previewTimer) { clearInterval(_previewTimer); _previewTimer = null; }

  _getOrCreatePreviewIndicator();
  const numEl = document.getElementById('offer-preview-num');

  let count = 5;
  if (numEl) numEl.textContent = count;

  _previewTimer = setInterval(() => {
    count--;
    if (numEl) numEl.textContent = Math.max(0, count);

    if (count <= 0) {
      clearInterval(_previewTimer);
      _previewTimer  = null;
      _previewActive = false;

      const indicator = document.getElementById('offer-preview-indicator');
      if (indicator) indicator.classList.add('hidden');

      // 찜한 카드가 있으면 자동 덱 추가
      if (!deckInputLocked() && !_pendingCard && _previewSelectedIdx !== null && _lastOfferedCards) {
        const items = Object.values(_lastOfferedCards).filter(Boolean);
        const picked = items[_previewSelectedIdx];
        _previewSelectedIdx = null;
        if (picked) {
          addCardToDeck({ ...CARD_DEFINITIONS[picked.cardId] });
          return;
        }
      }
      _previewSelectedIdx = null;

      if (labelEl) labelEl.textContent = t('offerLabelSelect');

      // 클릭 이벤트 활성화를 위해 카드 재렌더
      const container = document.getElementById('offer-cards');
      if (container && _lastOfferedCards) {
        container.innerHTML = '';
        const items = Object.values(_lastOfferedCards).filter(Boolean);
        items.forEach(item => {
          const card = { ...CARD_DEFINITIONS[item.cardId] };
          const cardEl = _createCardElement(card, null, 'offer');
          cardEl.addEventListener('click', () => {
            if (deckInputLocked() || _pendingCard) return;
            addCardToDeck(card);
          });
          container.appendChild(cardEl);
        });
      }
    }
  }, 1000);
}

function _appendCheckIcon(cardEl) {
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined preview-check-icon';
  icon.textContent = 'check_circle';
  cardEl.appendChild(icon);
}

function _setPreviewSelection(idx) {
  if (_previewSelectedIdx === idx) return;
  _previewSelectedIdx = idx;
  const container = document.getElementById('offer-cards');
  if (!container || !_lastOfferedCards) return;
  container.innerHTML = '';
  const items = Object.values(_lastOfferedCards).filter(Boolean);
  items.forEach((item, i) => {
    const card = { ...CARD_DEFINITIONS[item.cardId] };
    const cardEl = _createCardElement(card, null, 'offer');
    if (_previewSelectedIdx === i) _appendCheckIcon(cardEl);
    cardEl.addEventListener('click', () => _setPreviewSelection(i));
    container.appendChild(cardEl);
  });
}
