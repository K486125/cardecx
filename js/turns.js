// ============================================================
//  turns.js — 카드 제공 순환 (실시간 대전 — 턴 없음)
//  카드를 하나 고르면 곧바로 다음 카드 3장을 제공한다 (두 플레이어 각자)
// ============================================================

let _turnsLocalKey   = null;
let _refreshTimer    = null;
let _hasPendingOffer = false;

const OFFER_COOLDOWN = 0; // 카드 선택 즉시 다음 카드 제공 (미리보기 5s가 대기 역할)

function turnsInit(localKey) {
  _turnsLocalKey   = localKey;
  _hasPendingOffer = false;
}

/** 게임 시작 직후 첫 카드 즉시 제공 */
function turnsStartOffering() {
  _generateAndWriteOfferedCards();
}

function _generateAndWriteOfferedCards() {
  // 덱이 꽉 차도 제공한다 — 슬롯을 대체해서 넣을 수 있다 (deck.js). 대체 대기 중일 때만 멈춘다.
  if (typeof deckHasPendingCard === 'function' && deckHasPendingCard()) return;
  _hasPendingOffer = true;
  const cards = drawCards(3);
  writeOfferedCards(_turnsLocalKey, cards);
}

function _scheduleNextOffer() {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null;
    _generateAndWriteOfferedCards();
  }, OFFER_COOLDOWN);
}

/** 제공 카드 하나를 골랐을 때 deck.js에서 호출 */
window.onCardPickedFromOffer = function() {
  _hasPendingOffer = false;
  clearOfferedCards(_turnsLocalKey);
  _scheduleNextOffer();
};

/** 덱에서 카드를 써서 빈 슬롯이 생겼을 때 deck.js에서 호출 */
function turnsOnCardUsed() {
  if (_refreshTimer || _hasPendingOffer) return;
  _generateAndWriteOfferedCards();
}

function turnsCleanup() {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
  _hasPendingOffer = false;
}
