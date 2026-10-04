// ============================================================
//  sync.js — Firebase read/write 게이트웨이
//  모든 DB 쓰기는 이 파일의 함수를 통해서만 수행
// ============================================================

let _syncRoomCode = null;
let _activeListeners = []; // { ref, event, handler } 목록

function syncInit(roomCode) {
  _syncRoomCode = roomCode;
  initServerTime();
}

function syncCleanup() {
  _activeListeners.forEach(({ ref, event, handler }) => {
    ref.off(event, handler);
  });
  _activeListeners = [];
}

function _track(ref, event, handler) {
  ref.on(event, handler);
  _activeListeners.push({ ref, event, handler });
  return () => ref.off(event, handler);
}

// ── 읽기 리스너 ─────────────────────────────────────────────

/** gameState 실시간 리스너 */
function listenGameState(callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState`);
  return _track(ref, 'value', snap => callback(snap.val()));
}


// ══════════════════════════════════════════════════════════
//  예약 피해 (pendingHits)
//
//  연출이 끝나는 시각에 들어가야 하는 피해를, 카드를 쓰는 순간 DB에 예약해 둔다.
//  예전에는 시전자 브라우저의 setTimeout이 유일한 실행자였다 — 그 사이에 끊기면
//  카드와 에너지는 쓰였는데 피해는 영영 안 들어갔다.
//
//  누가 처리하나: 제때(applyAt)는 시전자가, 그때까지 아무도 안 잡았으면
//  PENDING_GRACE_MS 뒤에 맞는 쪽이 잡는다. 둘 다 눌러도 선점 트랜잭션이
//  한 명만 통과시키므로 두 번 들어가지 않는다.
//
//  선점에 성공한 뒤에 피해를 넣는 이유: 오프라인이면 트랜잭션이 서버 확인까지
//  대기했다가, 재접속 시 이미 상대가 처리해 사라진 예약에 대해 실패로 끝난다.
//  그래서 늦게 돌아온 쪽이 같은 피해를 또 넣는 일이 없다.
// ══════════════════════════════════════════════════════════
const PENDING_GRACE_MS = 1500;   // 시전자가 이만큼 못 하면 맞는 쪽이 대신 처리한다

let _pendingLocalKey = null;
let _pendingTimers   = {};       // id → setTimeout
let _pendingDone     = new Set();

function pendingHitsInit(localKey) {
  _pendingLocalKey = localKey;
  pendingHitsCleanup();
}

function pendingHitsCleanup() {
  Object.values(_pendingTimers).forEach(clearTimeout);
  _pendingTimers = {};
  _pendingDone.clear();
}

/** pendingHits 실시간 */
function listenPendingHits(callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/pendingHits`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 카드를 쓰는 순간 예약을 남긴다 — 이 쓰기는 즉시 나간다 */
function writePendingHit(row) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/pendingHits/${uniqueId()}`).set(row);
}

/**
 * 예약 하나를 적용한다 — 시전자와 맞는 쪽 누가 몇 번을 불러도 효과는 정확히 한 번 들어간다.
 *
 * 예전엔 '먼저 선점(claimedBy)하고 그다음 적용'이었다. 선점과 적용이 따로라서, 선점한 쪽이 그 사이에
 * 사라지면 상대는 '이미 누가 잡았다'고 보고 손을 대지 않아 피해가 통째로 빠졌다.
 * 지금은 적용하는 쓰기 자체가 '이미 넣었는가'를 함께 확인하고 기록한다 (applyCardUse의 hitId):
 *   · 타워 변화 — 타워 트랜잭션 안에서 towers/{pos}/applied/{hitId}를 보고, 없을 때만 바꾸며 표시를 남긴다
 *   · 그 밖의 효과(지속 효과 줄·에너지 흡수·덱 동결) — gameState/appliedHits/{hitId}와 한 번의 다중 쓰기로
 *     묶는다. 규칙이 이미 있는 appliedHits/{hitId}를 거부하므로 두 번째 쓰기는 통째로 거절된다
 * 둘 다 끝나야 예약을 지운다. 그 전에 사라져도 다른 쪽이 다시 부르면 된다 — 이미 들어간 부분은 건너뛴다.
 */
function _runPendingHit(id, row, gameState) {
  // 톱을 멈춘 표시 — 효과는 없다. 상대 화면이 볼 시간을 준 뒤(applyAt) 지운다
  if (row.sawStop) return db.ref(`rooms/${_syncRoomCode}/gameState/pendingHits/${id}`).remove();
  // 유닛만 맞는 줄 — 공격 범위에 든 상대 소환 유닛(그림리퍼)에 피해 (js/units.js, 유닛마다 한 번)
  if (row.unitsOnly) {
    if (typeof unitsStrike !== 'function') return Promise.resolve();
    return unitsStrike(row.sourcePlayer, row.tiles, row.applyAt, id, row.status)
      .then(() => db.ref(`rooms/${_syncRoomCode}/gameState/pendingHits/${id}`).remove());
  }
  const towers = gameState?.[row.targetPlayer]?.towers || {};
  const card   = { id: row.cardId, type: row.cardType, effect: row.effect || {} };
  return Promise.resolve(applyCardUse(row.sourcePlayer, null, null, row.targetPlayer,
                                      row.positions || [], card, towers, gameState, null, id))
    .then(() => db.ref(`rooms/${_syncRoomCode}/gameState/pendingHits/${id}`).remove());
}

const PENDING_RETRY_MS = 1000;

/**
 * pendingHits 스냅샷 수신 — 내 차례가 된 예약에 타이머를 건다.
 * @param {object|null} data      pendingHits 전체
 * @param {function} getGameState 적용 시점의 최신 gameState를 돌려주는 함수
 */
function pendingHitsApply(data, getGameState) {
  const ids = new Set(Object.keys(data || {}));
  Object.keys(_pendingTimers).forEach(id => {
    if (!ids.has(id)) { clearTimeout(_pendingTimers[id]); delete _pendingTimers[id]; _pendingDone.delete(id); }
  });
  // 톱 — 시전자가 손을 뗐다는 표시. 모든 화면(관전자 포함)이 그 톱을 빼낸다 (board.js)
  Object.values(data || {}).forEach(row => {
    if (row?.sawStop && typeof boardSawRemoteStop === 'function') boardSawRemoteStop(row.sawStop);
  });
  if (!_pendingLocalKey) return;

  Object.entries(data || {}).forEach(([id, row]) => {
    if (_pendingTimers[id] || _pendingDone.has(id)) return;
    if (!row) return;
    // 시전자와 맞는 쪽만 처리한다 — 관전자는 보기만 한다
    const mine = row.sourcePlayer === _pendingLocalKey;
    const theirs = row.targetPlayer === _pendingLocalKey;
    if (!mine && !theirs) return;

    // 시전자는 제때, 맞는 쪽은 그래도 안 들어오면 뒤늦게. 둘이 겹쳐도 효과는 한 번이다
    const at    = (row.applyAt || 0) + (mine ? 0 : PENDING_GRACE_MS);
    const run = () => {
      delete _pendingTimers[id];
      if (_pendingDone.has(id)) return;
      if (window.matchInputLocked) return;
      const wait = Math.max(at - gameNow(), gamePauseLeft());
      if (wait > 0) { _pendingTimers[id] = setTimeout(run, wait + 20); return; }
      _pendingDone.add(id);
      _runPendingHit(id, row, getGameState()).catch(err => {
        // 쓰기가 실패했다 (규칙 거부가 아닌 오류) — 예약은 남아 있으니 잠시 뒤 다시 한다
        console.warn('예약 피해 적용 실패 — 다시 시도:', err);
        _pendingDone.delete(id);
        if (!_pendingTimers[id]) _pendingTimers[id] = setTimeout(run, PENDING_RETRY_MS);
      });
    };
    _pendingTimers[id] = setTimeout(run, Math.max(0, at - gameNow()));
  });
}

/** dots 실시간 */
function listenDots(callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/dots`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 내 offeredCards 리스너 */
function listenOfferedCards(playerKey, callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/offeredCards`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 내 덱 실시간 */
function listenDeck(playerKey, callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/deck`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** winner 실시간 감지 — null 포함 항상 callback 호출 (game.js에서 skip 로직 처리) */
function listenWinner(callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/winner`);
  return _track(ref, 'value', snap => {
    callback(snap.val()); // null 포함 항상 호출 — _skipFirstWinner 로직이 올바르게 동작하도록
  });
}

/** 방 상태(waiting/playing/finished, 방 삭제 시 null) 실시간 */
function listenRoomStatus(callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/status`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 관전자 실시간 감지 */
function listenSpectators(callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/spectators`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/**
 * 관전자 등록.
 *
 * onDisconnect().remove()는 연결이 끊기는 순간 한 번 실행되고 끝이다 — 인터넷이 잠깐
 * 끊겼다 돌아오면 등록은 지워진 채로 남아 관전자 수에서 영영 빠진다.
 * 그래서 연결이 살아날 때마다 다시 쓰고 다시 건다 (presence.js의 플레이어 좌석과 같은 방식).
 */
let _specConnRef = null, _specConnCb = null;
function writeSpectatorJoin() {
  const uid = currentUid();
  if (!uid) return;
  const ref = db.ref(`rooms/${_syncRoomCode}/spectators/${uid}`);
  const arm = () => {
    ref.onDisconnect().remove();
    ref.set(true).catch(err => console.warn('관전자 등록 실패:', err));
  };
  if (_specConnRef) _specConnRef.off('value', _specConnCb);
  _specConnRef = db.ref('.info/connected');
  _specConnCb  = snap => { if (snap.val() === true) arm(); };
  _specConnRef.on('value', _specConnCb);
}

/** 관전자 퇴장 — 다시 등록하는 감시부터 끄고 지운다 */
function writeSpectatorLeave() {
  if (_specConnRef) { _specConnRef.off('value', _specConnCb); _specConnRef = null; _specConnCb = null; }
  const uid = currentUid();
  if (!uid) return;
  const ref = db.ref(`rooms/${_syncRoomCode}/spectators/${uid}`);
  ref.onDisconnect().cancel();
  ref.remove();
}

// ── 쓰기 함수 ────────────────────────────────────────────────

/** 에너지 업데이트 */
function writeEnergy(playerKey, newEnergy, newTick = false) {
  const updates = { [`gameState/${playerKey}/energy`]: newEnergy };
  if (newTick) updates[`gameState/${playerKey}/lastEnergyTick`] = serverTimestamp();
  return db.ref(`rooms/${_syncRoomCode}`).update(updates);
}

/** 덱 슬롯 한 칸 업데이트 */
function writeDeckSlot(playerKey, slotIndex, cardData) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/deck/${slotIndex}`).set(cardData);
}

/** 제공 카드 3장 쓰기 */
function writeOfferedCards(playerKey, cards) {
  const data = {};
  cards.forEach((c, i) => { data[i] = { cardId: c.id, grade: c.grade }; });
  return db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/offeredCards`).set(data);
}

/** 제공 카드 비우기 */
function clearOfferedCards(playerKey) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/offeredCards`).set(null);
}

// ── 타워 트랜잭션 ────────────────────────────────────────────
/**
 * 타워 하나를 서버의 최신 값 기준으로 원자적으로 수정한다.
 * 두 클라이언트가 각자 본 HP로 덮어쓰면 서로의 피해·회복이 사라지므로
 * 타워 필드(hp·보호막·버프)는 반드시 이 함수로만 쓴다.
 * (같은 타워 경로에 set/update를 섞으면 진행 중인 트랜잭션이 취소된다)
 *
 * @param {(t: object, out: object) => (false|void)} mutator
 *   t   — 수정할 타워 복사본 (null을 넣은 필드는 삭제됨)
 *   out — 결과 기록용. 트랜잭션이 재시도될 때마다 새로 만들어진다
 *   false를 반환하면 아무것도 쓰지 않는다
 * @returns {Promise<{ committed: boolean, out: object }>}
 */
function mutateTower(playerKey, pos, mutator) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/towers/${pos}`);
  let out = {};
  return ref.transaction(cur => {
    out = {};
    if (cur === null) return null;             // 로컬 캐시에 없음 → 서버 값으로 다시 호출됨
    const t = { ...cur };
    if (mutator(t, out) === false) return;     // 변경 없음 → 중단
    return t;
  }).then(({ committed }) => ({ committed, out }))
    .catch(err => {
      console.error('타워 갱신 실패:', err);
      return { committed: false, out: {}, error: err };
    });
}

// 타워에 남기는 '이미 넣은 예약' 표시는 이만큼만 들고 있는다 — 그보다 늦게 오는 중복은 없다
// (예약은 몇 초 안에 처리되고, 오래 끊긴 쪽은 5초 유예 뒤 기권패로 경기가 동결돼 타워 쓰기가 막힌다)
const APPLIED_KEEP_MS = 60000;

function _markApplied(map, hitId, now) {
  const next = {};
  Object.entries(map || {}).forEach(([k, v]) => { if (typeof v === 'number' && now - v < APPLIED_KEEP_MS) next[k] = v; });
  next[hitId] = now;
  return next;
}

// ── 결과 통계 ─────────────────────────────────────────────────
// 받은 피해(dmgTaken)·받은 회복(healTaken)을 타워 안에 HP와 같은 트랜잭션으로 누적한다.
// 따로 기록하면 HP만 반영되고 통계가 빠지거나(끊김·종료 직전) 두 번 세어질 수 있다.
//   입힌 피해 = 상대 타워 3개의 dmgTaken 합 (보호막 흡수 포함 — 화면에 뜬 피해 숫자와 같다)
//   회복량    = 내 타워 3개의 healTaken 합 (실제로 오른 HP)

/** 보호막이 먼저 흡수한 뒤 HP 차감 */
function _towerDamage(t, dmg) {
  if (dmg > 0) t.dmgTaken = (t.dmgTaken || 0) + dmg;
  let remaining = dmg;
  const shield  = t.shieldHp || 0;
  if (shield > 0) {
    const absorbed = Math.min(shield, remaining);
    remaining -= absorbed;
    const left = shield - absorbed;
    t.shieldHp = left > 0 ? left : null;
    if (left <= 0) t.maxShieldHp = null;
  }
  t.hp = Math.max(0, (t.hp || 0) - remaining);
  if (t.hp === 0) t.alive = false;
}

/** 최대 HP까지 회복, 실제 회복량 반환 */
function _towerHeal(t, amount) {
  const before = t.hp || 0;
  t.hp = Math.min(t.maxHp, before + Math.max(0, amount));
  const healed = t.hp - before;
  if (healed > 0) t.healTaken = (t.healTaken || 0) + healed;
  return healed;
}

// ── 더위 (폭염, 2026-10-02) ─────────────────────────────────
// 폭염이 지나간 칸에서 열기가 올라오는 동안, 그 칸에 선 대상(타워·소환 유닛)은 모든 카드 피해를 percent% 더 받는다.
// gameState/heatZones/{id} = { victim, c0, r0, c1, r1 (p1 기준 칸), from, until (게임 시간), percent }
// 시전할 때 한 번 써 두면 모든 화면·피해를 넣는 쪽이 같은 값을 본다.
const TOWER_TILE_P1 = {
  p1: { left: [4, 2],  king: [3, 4],  right: [4, 6] },
  p2: { left: [11, 2], king: [12, 4], right: [11, 6] }
};

/** 그 칸(p1 기준)이 그 시각 더위 속인가 — 겹치면 가장 센 것 하나 */
function heatPercentAt(gs, victim, col, row, now) {
  let best = 0;
  Object.values(gs?.heatZones || {}).forEach(z => {
    if (!z || z.victim !== victim || now < z.from || now >= z.until) return;
    if (col < z.c0 || col > z.c1 || row < z.r0 || row > z.r1) return;
    best = Math.max(best, z.percent || 0);
  });
  return best;
}

/** 그 타워가 더위 속인가 (%) */
function towerHeatPercent(gs, victim, pos, now) {
  const t = TOWER_TILE_P1[victim]?.[pos];
  return t ? heatPercentAt(gs, victim, t[0], t[1], now) : 0;
}

/** 더위 구역 기록 (R은 p1 기준 칸) */
function writeHeatZone(victim, R, from, until, percent) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/heatZones/${uniqueId()}`).set({
    victim, c0: R.c0, r0: R.r0, c1: R.c1, r1: R.r1, from: Math.round(from), until: Math.round(until), percent
  }).catch(err => console.warn('더위 기록 실패:', err));
}

// ── 크리티컬 (2026-10-03) ─────────────────────────────────
// 기본 피해보다 크게 들어간 피해는 황금색 숫자로 보인다 (instantHits type 'crit' — 규칙의 type 길이 안).
//   · 한 방의 몫이 카드 기본값보다 크다 — 돌 · 화살 차징, 토네이도 최고 피해(40)
//   · 받는 쪽 증폭으로 더 들어갔다 — 악몽 · 파멸의 낙인 · 더위 · 쇄빙 · 별똥별 · 오버타임 등
// 바위 지옥처럼 타워마다 몫이 정해진 카드는 그 몫(카드 값보다 작다)이 기본이라 크리티컬이 아니다.
const CRIT_BASE = { tornado: 39 };   // 토네이도는 거리에 따라 16~40 — 최고(40)일 때만

function critBase(cardId) {
  if (CRIT_BASE[cardId] != null) return CRIT_BASE[cardId];
  const d = typeof CARD_DEFINITIONS !== 'undefined' ? CARD_DEFINITIONS[cardId]?.effect?.damage : null;
  return typeof d === 'number' ? d : Infinity;
}

/** 이 한 방이 크리티컬인가 — base: 이 한 방에 실린 몫(차징 포함), dealt: 실제로 들어간 피해 */
function isCritHit(cardId, base, dealt) {
  return dealt > base || base > critBase(cardId);
}

// 철벽이 80%를 막는 '직선 공격' 카드 — 나머지(칸·원 범위 카드)는 50%
const LINE_ATTACK_CARDS = new Set([
  'wooden_sword', 'dual_sword', 'arrow', 'love_arrow', 'wind', 'tornado', 'thorn_evo', 'wave_evo'
]);

/**
 * 받는 타워의 증폭·감소 디버프/버프로 피해 보정
 * @param {object} ctx { cardId — 철벽의 직선/범위 구분, heat — 더위 % (towerHeatPercent) }
 */
function towerAdjustDamage(t, dmg, now, ctx = {}) {
  if (t.damageAmpUntil        > now) dmg = Math.round(dmg * (1 + (t.damageAmpPercent        || 0) / 100));
  // 쇄빙 (2026-10-02 상성) — 얼어붙은 타워는 깨지기 쉽다: 땅·돌 카드 피해 +30% (그 한 방에 얼음이 깨진다)
  if (SHATTER_CARDS.has(ctx.cardId) && towerFrozen(t, now)) dmg = Math.round(dmg * SHATTER_MUL);
  // 언 타워에 떨어진 불덩이 — 얼음이 불을 받아 내 피해가 절반 (대신 얼음이 반쯤 녹는다)
  if (ctx.cardId === 'flame' && towerFrozen(t, now)) dmg = Math.round(dmg * ICE_FIRE_CUT);
  if (t.doomSealUntil         > now) dmg = Math.round(dmg * (1 + (t.doomSealPercent         || 0) / 100));
  if (ctx.heat > 0)                  dmg = Math.round(dmg * (1 + ctx.heat / 100));
  // 감소 — 직선 공격 몫이 따로 적혀 있으면(철벽) 직선 카드에는 그 값을 쓴다
  const line = LINE_ATTACK_CARDS.has(ctx.cardId);
  const cut = (p, lp) => (line && lp ? lp : (p || 0)) / 100;
  if (t.damageReductionUntil  > now) dmg = Math.round(dmg * (1 - cut(t.damageReductionPercent,  t.damageReductionLinePercent)));
  return dmg;
}

/**
 * 그 타워에 서 있는 방어막 — 'brick' | 'iron' | null (벽돌 · 철벽은 한 타워에 하나)
 * 철벽만 직선 공격 몫(linePercent)을 따로 적는다
 */
function towerWallKind(t, now) {
  if (!t || !(t.damageReductionUntil > now)) return null;
  return t.damageReductionLinePercent ? 'iron' : 'brick';
}

/** 이 카드(벽돌 · 철벽)를 그 타워에 놓을 수 있는가 — 비어 있거나 같은 방어막이면 (연장) */
function towerWallAllows(t, card, now) {
  const dr = card?.effect?.damageReduction;
  if (!dr) return true;
  const kind = towerWallKind(t, now);
  return !kind || kind === (dr.linePercent ? 'iron' : 'brick');
}

/**
 * 힐량 감소 디버프 적용
 * @param {boolean} withered 더위(폭염의 열기) 속 — 말라 비틀어져 회복 25% 감소 (2026-10-02 상성)
 */
function towerAdjustHeal(t, heal, now, withered = false) {
  if (withered) heal = Math.floor(heal * (1 - HEAT_HEAL_CUT));
  return t.healReductionUntil > now ? Math.floor(heal * (1 - (t.healReductionPercent || 20) / 100)) : heal;
}

// ── 상성 (2026-10-02) ───────────────────────────────────────
const HEAT_HEAL_CUT = 0.25;                                   // 더위 속 회복 -25%
const SHATTER_CARDS = new Set(['earthquake', 'collapse', 'rock', 'rock_hell']);
const SHATTER_MUL = 1.3;                                      // 언 타워에 땅·돌 카드 +30%

// ── 얼음 (얼음전개, 2026-10-02 리워크 2) ─────────────────────
// 타워 필드: frozenFrom · frozenUntil · frozenMelt
//   frozenMelt  1 — 불덩이에 반쯤 녹았다 (남은 동결 동안 동결 피해 50%)
//               2 — 폭염에 다 녹았다. 녹은 얼음은 타워 둘레 3×3칸의 물이 되어 ICE_POOL_MS 동안 증발한다
//               3 — 땅·돌 카드에 깨졌다 (쇄빙)
//   2 · 3이면 frozenUntil = 풀린 시각.
// 언 동안 맞은 쪽은 카드를 하나도 못 쓴다 — 얼음을 녹이는 건 얼린 쪽(상대)의 불뿐이다.
const ICE_FIRE_CUT = 0.5;                                     // 언 타워에 불덩이 피해 50%
const ICE_POOL_MS  = 3000;                                    // 폭염에 녹은 물이 마르는 시간
const ICE_MELT_BY  = { flame: 1, fire_evo: 2 };               // 불덩이 반쯤 · 폭염 다

/** 얼음전개로 얼어 있는가 */
function towerFrozen(t, now) {
  return !!t && t.frozenUntil > now && !(t.frozenMelt >= 2);
}

/** 폭염에 녹은 얼음물이 아직 고여 있는가 — 젖은 상태 (회복 +50% · 감전) */
function towerIcePool(t, now) {
  return !!t && t.frozenMelt === 2 && now >= t.frozenUntil - 50 && now < t.frozenUntil + ICE_POOL_MS;
}

/** 얼음이 풀린다 (트랜잭션 안) — 2 녹음 · 3 깨짐 */
function _iceRelease(t, now, how) {
  t.frozenMelt  = how;
  t.frozenUntil = now;
}

/** 늘어난 얼음 — 덱 동결도 그 얼음이 풀릴 때까지 (더 길면 그대로) */
function _iceHoldDeckFreeze(playerKey, until) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/deckFreezeUntil`)
    .transaction(cur => (typeof cur === 'number' && cur >= until) ? undefined : until)
    .catch(err => console.warn('덱 동결 늘리기 실패:', err));
}

/**
 * 얼음이 풀린 뒤 — 그 플레이어의 다른 타워가 더 얼어 있지 않으면 덱 동결도 풀린다.
 * @param {string[]} released 방금 풀린 타워 (같은 호출에서 함께 풀린 것 — 아직 스냅샷에 안 왔을 수 있다)
 */
function _iceLiftDeckFreeze(playerKey, released, now) {
  const gs = typeof getGameState === 'function' ? getGameState() : null;
  const towers = gs?.[playerKey]?.towers || {};
  const still = ['left', 'king', 'right'].some(p => !released.includes(p) && towers[p]?.alive !== false && towerFrozen(towers[p], now));
  if (still || !(gs?.[playerKey]?.deckFreezeUntil > now)) return null;
  return db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/deckFreezeUntil`).set(now)
    .catch(err => console.warn('덱 동결 풀기 실패:', err));
}

/** 더위 구역을 지운다 (물이 불을 끄면 열기도 식는다) */
function removeHeatZone(id) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/heatZones/${id}`).remove()
    .catch(err => console.warn('더위 지우기 실패:', err));
}

/** 즉시 피해·회복 플로팅 숫자 기록 */
function _writeHits(hits) {
  if (!hits.length) return null;
  const upd = {};
  hits.forEach(h => { upd[`gameState/instantHits/${uniqueId()}`] = h; });
  return db.ref(`rooms/${_syncRoomCode}`).update(upd);
}

/**
 * 카드 사용
 * 에너지·덱·DOT 등록은 한 번의 다중 경로 업데이트로, 타워 변경은 타워별 트랜잭션으로 기록한다.
 * 피해 보정·면역·반사 판정도 트랜잭션 안에서 서버 최신 타워 기준으로 한다.
 * @param {string} actingPlayer    'p1' | 'p2'
 * @param {number} slotIndex       덱 슬롯 인덱스
 * @param {number} newEnergy       차감 후 에너지
 * @param {string} targetPlayer    대상 플레이어
 * @param {string[]} targetPositions 대상 타워 위치 배열
 * @param {object} card            카드 정의
 * @param {object} currentTowers   현재 타워 상태 { left, king, right } — 살아있는 대상 선별에만 사용
 * @param {object|null} slotAfter   사용 후 그 슬롯에 남는 값 (개수가 남으면 { cardId, grade, count })
 */
function applyCardUse(actingPlayer, slotIndex, newEnergy, targetPlayer, targetPositions, card, currentTowers, currentGameState, slotAfter = null, hitId = null) {
  const updates = {};
  const now     = gameNow();
  // 예약 적용(hitId) — 타워 밖의 효과를 '이미 넣었다' 표시와 한 번의 쓰기로 묶는다 (규칙이 두 번째를 거부)
  if (hitId) updates[`gameState/appliedHits/${hitId}`] = now;

  // slotIndex가 null이면 '피해만' 넣는 호출이다 — 에너지와 덱 칸은 이미 기록됐다.
  // 바위 지옥처럼 한 장으로 여러 번 나눠 들어가는 카드가 쓴다. 3초 뒤에 덱 칸을
  // 다시 쓰면 그 사이에 새로 들어온 카드를 지워 버린다.
  if (slotIndex !== null) {
    updates[`gameState/${actingPlayer}/energy`]          = newEnergy;
    updates[`gameState/${actingPlayer}/deck/${slotIndex}`] = slotAfter;
  }

  const effect = card.effect;

  // 사거리 카드를 허공에 썼을 때는 targetPositions가 비어 온다.
  // 그럴 땐 상대에게 거는 효과(덱 동결·에너지 흡수)도 같이 빗나간 것이다.
  // 사거리가 없는 카드는 항상 대상이 채워져 오므로 영향이 없다.
  const hitSomething = targetPositions.length > 0;

  // ── 글로벌 효과 (타워 위치 무관) ──
  if (effect.deckFreeze && hitSomething) {
    // 얼음전개는 언 타워마다 따로 들어온다 — 더하지 않고 '지금부터 duration'과 남은 것 중 긴 쪽
    // 이미 언 타워에 또 쓰면 그 얼음이 늘어난 만큼 (아래 타워 트랜잭션과 같은 값 — 짧은 쪽이 덮어쓰지 않게)
    const curFreeze = currentGameState?.[targetPlayer]?.deckFreezeUntil || 0;
    let until = now + effect.deckFreeze.duration;
    if (effect.freeze) targetPositions.forEach(p => {
      const ct = currentTowers?.[p];
      if (towerFrozen(ct, now)) until = Math.max(until, ct.frozenUntil + effect.freeze.duration);
    });
    updates[`gameState/${targetPlayer}/deckFreezeUntil`] = Math.max(curFreeze, until);
  }

  // 상대 에너지를 깎는다 (바람 스매시).
  // 남의 energy를 여기서 직접 쓰면 안 된다 — 에너지는 각자 자기 것을 들고 있어서
  // 맞은 쪽의 다음 회복 틱이 그대로 덮어써 버린다. 신호만 보내고 깎는 것은 맞은 쪽이 한다.
  if (effect.energyDrain && hitSomething) {
    updates[`gameState/instantHits/${uniqueId()}`] = {
      targetPlayer,
      targetTower: targetPositions[0] || 'king',
      type:        'energyDrain',
      amount:      effect.energyDrain,
      sourcePlayer: actingPlayer,
      ts:          now
    };
  }

  if (effect.energyBurst) {
    const duration = effect.energyBurst.ticks * effect.energyBurst.interval;
    updates[`gameState/${actingPlayer}/energyBurstUntil`]   = now + duration;
    updates[`gameState/${actingPlayer}/energyBurstPerTick`] = effect.energyBurst.perTick;
  }

  // 시전자 쪽 피해 보정 — 별똥별 evo 특성(어택 카드 +20%), 오버타임 승수
  const starlightUntil = currentGameState?.[actingPlayer]?.starlightBurstActiveUntil;
  const starlightOn    = starlightUntil && now < starlightUntil && card.type === 'attack';
  const overtimeMul    = window.overtimeMultiplier > 1.0 ? window.overtimeMultiplier : 1;

  const towerJobs = [];
  const iceReleased = [];   // 이 호출로 얼음이 풀린 타워 — 다 끝나면 덱 동결도 풀지 본다
  // 얼린 쪽이 던진 불 — 언 타워를 녹인다 (맞은 쪽은 언 동안 카드를 못 쓴다 · 내 불로 내 얼음은 못 녹인다)
  const meltBy = actingPlayer !== targetPlayer ? (ICE_MELT_BY[card.id] || 0) : 0;

  targetPositions.forEach(pos => {
    const tower = currentTowers[pos];
    if (!tower || !tower.alive) return;
    // 폭염 → 언 타워: 얼음이 다 녹을 뿐 폭염의 피해(폭발 · 불탐)는 들어가지 않는다
    const thawOnly = meltBy >= 2 && towerFrozen(tower, now);

    // ── DOT 등록 (단일 객체 또는 배열 모두 지원) ──────
    if (effect.dot && !thawOnly) {
      const dotList = Array.isArray(effect.dot) ? effect.dot : [effect.dot];
      dotList.forEach(dotDef => {
        const dotEntry = {
          targetPlayer,
          targetTower:    pos,
          type:           'damage',
          dmgPerTick:     dotDef.dmgPerTick,
          tickInterval:   dotDef.tickInterval,
          remainingTicks: dotDef.ticks,
          startedAt:      serverTimestamp(),
          sourcePlayer:   actingPlayer,
          cardId:         card.id
        };
        updates[`gameState/dots/${uniqueId()}`] = dotEntry;
      });
    }

    // ── HOT 등록 ───────────────────────────────────────
    if (effect.hot) {
      const hotEntry = {
        targetPlayer,
        targetTower:    pos,
        type:           'heal',
        dmgPerTick:     effect.hot.healPerTick,
        tickInterval:   effect.hot.tickInterval,
        remainingTicks: effect.hot.ticks,
        startedAt:      serverTimestamp(),
        sourcePlayer:   actingPlayer,
        cardId:         card.id          // 연출이 있는 카드는 지속 효과 아이콘을 달지 않는다 (board.js updateDotIndicator)
      };
      // 토템 회복 — 어느 칸의 토템인지 ('13,4', p1 화면 기준). 붕괴가 이걸 보고 멈춘다 (effects.js)
      if (effect.hot.totem) hotEntry.totem = effect.hot.totem;
      updates[`gameState/dots/${uniqueId()}`] = hotEntry;
    }

    // ── 타워 변경 (트랜잭션) — 타워 필드를 건드리는 효과가 있을 때만 ──
    const touchesTower = effect.damageReduction || effect.shield !== undefined || effect.immunity || effect.freeze ||
                         effect.reflect || effect.damageAmp || effect.healReduction ||
                         effect.percentDrain || effect.damage || effect.heal;
    if (!touchesTower) return;

    towerJobs.push(mutateTower(targetPlayer, pos, (t, out) => {
      // 예약 적용 — 이 타워에 이미 들어갔으면 아무것도 하지 않는다 (같은 트랜잭션이라 확인과 적용 사이에 틈이 없다)
      if (hitId && t.applied && t.applied[hitId]) { out.already = true; return false; }
      if (t.alive === false) return false;
      out.hits   = [];
      out.dealt  = 0;
      out.healed = 0;
      const hit = (type, amount) => out.hits.push({ targetPlayer, targetTower: pos, amount, type, sourcePlayer: actingPlayer, ts: now });

      // ── 방어 효과 ──────────────────────────────────────
      if (effect.damageReduction) {
        // 벽돌 · 철벽 (2026-10-02) — 한 타워에 방어막은 하나. linePercent(직선 공격 몫, 철벽 80%)가 있으면 철벽이다.
        // 같은 방어막을 또 놓으면 남은 시간에 원래 지속 시간만큼 더하고, 다른 방어막은 서 있는 동안 놓지 못한다
        const line = effect.damageReduction.linePercent || null;
        const dur  = effect.damageReduction.duration;
        if (t.damageReductionUntil > now) {
          if (!!t.damageReductionLinePercent === !!line) t.damageReductionUntil += dur;
        } else {
          t.damageReductionFrom        = now;
          t.damageReductionUntil       = now + dur;
          t.damageReductionPercent     = effect.damageReduction.percent;
          t.damageReductionLinePercent = line;
        }
        t.damageReduction2Until = null;
      }

      if (effect.shield !== undefined) {
        if ((t.shieldHp || 0) > 0) {
          // 이미 보호막 활성 — 새 보호막의 50%를 타워 HP로 회복
          const healed = _towerHeal(t, Math.round(effect.shield * 0.5));
          if (healed > 0) { out.healed += healed; hit('heal', healed); }
        } else {
          t.shieldHp    = effect.shield;
          t.maxShieldHp = effect.shield;
          out.shieldGranted = true;   // 보호막 자동 감소 DOT는 실제로 부여된 경우에만
        }
      }

      if (effect.immunity) t.immunityUntil = now + effect.immunity.duration;

      // 얼음전개 — 아래서부터 얼어붙는다 (면역 중이면 얼지 않는다). 그림은 board.js가 이 값으로 그린다.
      // 이미 얼어 있으면 다시 얼리지 않고 남은 시간에 지속 시간만 더한다 (차오른 얼음 · 반쯤 녹은 정도는 그대로)
      if (effect.freeze && !(t.immunityUntil > now)) {
        if (towerFrozen(t, now)) {
          t.frozenUntil += effect.freeze.duration;
        } else {
          t.frozenFrom  = now;
          t.frozenUntil = now + effect.freeze.duration;
          t.frozenMelt  = null;
        }
        out.frozenUntil = t.frozenUntil;
      }

      // 반사 방어막 설치
      if (effect.reflect) {
        t.mirrorUntil   = now + effect.reflect.duration;
        t.mirrorPercent = effect.reflect.percent;
      }

      // ── 컨트롤 효과 ────────────────────────────────────
      if (effect.damageAmp) {
        if (card.id === 'doom_seal') {
          // 파멸의 낙인 전용 슬롯 — 악몽과 독립 중첩
          t.doomSealUntil   = now + effect.damageAmp.duration;
          t.doomSealPercent = effect.damageAmp.percent;
        } else {
          t.damageAmpUntil   = now + effect.damageAmp.duration;
          t.damageAmpPercent = effect.damageAmp.percent;
        }
      }

      // 힐량 감소 디버프
      if (effect.healReduction) {
        t.healReductionUntil   = now + effect.healReduction.duration;
        t.healReductionPercent = effect.healReduction.percent;
      }

      // ── 퍼센트 드레인 (그림리퍼) — 보호막 무시, 내 킹 회복은 커밋 후 ──
      if (effect.percentDrain) {
        const drainDmg = Math.floor(t.hp * effect.percentDrain.damagePercent / 100);
        if (drainDmg > 0) {
          t.hp = Math.max(0, t.hp - drainDmg);
          if (t.hp === 0) t.alive = false;
          t.dmgTaken = (t.dmgTaken || 0) + drainDmg;
          out.dealt += drainDmg;
          hit('damage', drainDmg);
          out.drainHeal = Math.floor(drainDmg * effect.percentDrain.healPercent / 100);
        }
      }

      // ── 불이 얼음을 녹인다 — 폭염은 피해 없이 다 녹이고(물이 고인다), 불덩이는 절반 피해 뒤 반쯤 녹인다 ──
      const frozenNow = towerFrozen(t, now);
      if (meltBy >= 2 && frozenNow) {
        _iceRelease(t, now, 2);
        out.iceReleased = true;
        hit('thaw', 0);
        if (hitId) t.applied = _markApplied(t.applied, hitId, now);
        return;
      }

      // ── 즉시 피해 ──────────────────────────────────────
      if (effect.damage && t.alive !== false) {
        if (t.immunityUntil > now) {
          hit('immune', 0);   // 면역 — 플로팅 숫자만 표시
        } else {
          let dmg = towerAdjustDamage(t, effect.damage, now,
            { cardId: card.id, heat: towerHeatPercent(currentGameState, targetPlayer, pos, now) });
          if (starlightOn)     dmg = Math.round(dmg * 1.2);
          if (overtimeMul > 1) dmg = Math.round(dmg * overtimeMul);

          if (t.mirrorUntil > now) {
            // 반사 — 피해 차단, 경고 아이콘 후 3초 뒤 시전자 킹으로 반사
            out.reflect     = Math.round(dmg * (1 + (t.mirrorPercent || 70) / 100));
            t.mirrorUntil   = null;
            t.mirrorPercent = null;
          } else {
            _towerDamage(t, dmg);
            out.dealt += dmg;
            hit(isCritHit(card.id, effect.damage, dmg) ? 'crit' : 'damage', dmg);
            // 쇄빙 — 땅·돌 카드가 언 타워를 치면 얼음이 깨져 동결이 바로 풀린다
            if (frozenNow && SHATTER_CARDS.has(card.id)) { _iceRelease(t, now, 3); out.iceReleased = true; }
          }
        }
      }
      if (meltBy === 1 && frozenNow && towerFrozen(t, now) && !(t.frozenMelt >= 1)) t.frozenMelt = 1;

      // ── 즉시 치유 ──────────────────────────────────────
      if (effect.heal && t.alive !== false) {
        const withered = towerHeatPercent(currentGameState, targetPlayer, pos, now) > 0;
        const healed = _towerHeal(t, towerAdjustHeal(t, effect.heal, now, withered));
        if (healed > 0) { out.healed += healed; hit('heal', healed); }
      }
      if (hitId) t.applied = _markApplied(t.applied, hitId, now);
    }).then(({ committed, out, error }) => {
      if (hitId && error) throw error;           // 예약 적용이 오류로 끝났다 — 예약을 남겨 다시 하게 한다
      if (!committed || !out.hits) return;
      const jobs0 = [];
      if (out.iceReleased) iceReleased.push(pos);
      if (out.frozenUntil && effect.deckFreeze) jobs0.push(_iceHoldDeckFreeze(targetPlayer, out.frozenUntil));

      const jobs = [_writeHits(out.hits), ...jobs0];
      if (out.shieldGranted && effect.shieldDecay) {
        jobs.push(db.ref(`rooms/${_syncRoomCode}/gameState/dots/${uniqueId()}`).set({
          targetPlayer,
          targetTower:    pos,
          type:           'shieldDrain',
          dmgPerTick:     effect.shieldDecay.rate,
          tickInterval:   effect.shieldDecay.interval,
          remainingTicks: Math.ceil(effect.shield / effect.shieldDecay.rate),
          startedAt:      serverTimestamp(),
          sourcePlayer:   actingPlayer
        }));
      }
      if (out.drainHeal > 0) jobs.push(_drainHealKing(actingPlayer, out.drainHeal, now));
      if (out.reflect)       _mirrorChainStep(targetPlayer, pos, actingPlayer, 'king', out.reflect, 0);
      return Promise.all(jobs);
    }));
  });

  // ── 카드별 특성 처리 ────────────────────────────────────
  // slotIndex가 null이면 '예약된 피해만' 넣는 호출이다
  // 특성은 카드를 쓸 때 이미 걸렸으므로 여기서 또 걸면 중복이다.
  const cardTraits = slotIndex !== null;
  if (cardTraits && card.id === 'starlight_burst_evo') {
    // 별똥별 evo 특성: 3초간 아군 어택 카드 피해 +20%
    updates[`gameState/${actingPlayer}/starlightBurstActiveUntil`] = now + 3000;
  }

  let writePromise = db.ref(`rooms/${_syncRoomCode}`).update(updates);
  if (hitId) {
    // 이미 넣은 예약이면 규칙이 appliedHits/{hitId}를 거부해 쓰기 전체가 거절된다 — 정상(이미 들어감)
    writePromise = writePromise.catch(err => {
      if (/permission/i.test(String(err?.code || err?.message || err))) return 'already';
      throw err;
    });
  }
  const towersDone = Promise.all(towerJobs).then(r => {
    if (iceReleased.length) _iceLiftDeckFreeze(targetPlayer, iceReleased, now);
    return r;
  });
  return Promise.all([writePromise, towersDone]);
}

/** 그림리퍼 드레인 — 시전자 킹 회복 (킹이 살아있을 때만) */
function _drainHealKing(actingPlayer, amount, ts) {
  return mutateTower(actingPlayer, 'king', (t, out) => {
    if (t.alive === false) return false;
    out.healed = _towerHeal(t, amount);
    if (out.healed <= 0) return false;
  }).then(({ committed, out }) => {
    if (!committed || !(out.healed > 0)) return;
    return _writeHits([{ targetPlayer: actingPlayer, targetTower: 'king', amount: out.healed, type: 'heal', sourcePlayer: actingPlayer, ts }]);
  });
}

/**
 * 반사 발사체 체인 — 경고 아이콘 3초 뒤 도착하면 피해 적용, 도착 타워에도 거울이 있으면 다시 반사
 */
function _mirrorChainStep(fromPlayer, fromPos, toPlayer, toPos, damage, depth) {
  if (depth > 8) return;

  const handleImpact = () => {
    const now = gameNow();
    mutateTower(toPlayer, toPos, (t, out) => {
      if (t.alive === false) return false;
      if (t.mirrorUntil > now) {
        // 거울 있으면 피해 차단 — 다음 체인만 예약
        out.next        = Math.round(damage * (1 + (t.mirrorPercent || 70) / 100));
        t.mirrorUntil   = null;
        t.mirrorPercent = null;
      } else {
        _towerDamage(t, damage);
        out.hit = true;
      }
    }).then(({ committed, out }) => {
      if (!committed) return;
      if (out.next) {
        _mirrorChainStep(toPlayer, toPos, fromPlayer, 'king', out.next, depth + 1);
      } else if (out.hit) {
        _writeHits([{ targetPlayer: toPlayer, targetTower: toPos, amount: damage, type: 'damage', sourcePlayer: fromPlayer, ts: now }]);
      }
    });
  };

  // 양쪽 클라이언트에 경고 아이콘 표시 (mirrorWarn instantHit)
  db.ref(`rooms/${_syncRoomCode}/gameState/instantHits/${uniqueId()}`).set({
    targetPlayer: toPlayer, targetTower: toPos,
    amount: 0, type: 'mirrorWarn',
    sourcePlayer: fromPlayer, ts: serverNow()
  });
  setTimeout(handleImpact, 3000);
}

// ── DOT / HOT 틱 (대상 타워 주인 클라이언트가 호출) ───────────

/** 남은 틱 수 기록, 0이면 dot 삭제 */
function writeDotProgress(dotId, remainingTicks) {
  const path = `rooms/${_syncRoomCode}/gameState/dots/${dotId}`;
  return remainingTicks <= 0
    ? db.ref(path).remove()
    : db.ref(`${path}/remainingTicks`).set(remainingTicks);
}

/**
 * DOT 피해 한 틱 — dmg는 보정이 끝난 값. 보호막·HP는 서버 최신 값에서 차감
 * @param {string} cardId 쇄빙 — 땅·돌 카드(지진)의 틱이 언 타워에 들어가면 얼음이 깨진다
 */
function applyDotDamageTick(dotId, targetPlayer, targetTower, dmg, remainingTicks, cardId = null) {
  const now = gameNow();
  return mutateTower(targetPlayer, targetTower, (t, out) => {
    if (t.alive === false) return false;
    _towerDamage(t, dmg);
    if (dmg > 0 && SHATTER_CARDS.has(cardId) && towerFrozen(t, now)) { _iceRelease(t, now, 3); out.iceReleased = true; }
  }).then(({ committed, out }) => {
    if (committed && out.iceReleased) _iceLiftDeckFreeze(targetPlayer, [targetTower], now);
    return writeDotProgress(dotId, committed ? remainingTicks : 0);
  });
}

/** DOT 한 틱이 거울에 막힘 — 거울을 소모하고 시전자 킹으로 반사 (거울이 이미 없으면 그대로 피해) */
function applyDotMirrorTick(dotId, targetPlayer, targetTower, dmg, sourcePlayer, remainingTicks) {
  const now = gameNow();
  return mutateTower(targetPlayer, targetTower, (t, out) => {
    if (t.alive === false) return false;
    if (t.mirrorUntil > now) {
      out.reflect     = Math.round(dmg * (1 + (t.mirrorPercent || 70) / 100));
      t.mirrorUntil   = null;
      t.mirrorPercent = null;
    } else {
      _towerDamage(t, dmg);
    }
  }).then(({ committed, out }) => {
    if (committed && out.reflect) _mirrorChainStep(targetPlayer, targetTower, sourcePlayer, 'king', out.reflect, 0);
    return writeDotProgress(dotId, committed ? remainingTicks : 0);
  });
}

/** 보호막 자동 감소 한 틱 — 보호막이 다 떨어졌으면 dot 종료 */
function applyShieldDrainTick(dotId, targetPlayer, targetTower, drain, remainingTicks) {
  return mutateTower(targetPlayer, targetTower, t => {
    const shield = t.shieldHp || 0;
    if (t.alive === false || shield <= 0) return false;
    const left = Math.max(0, shield - drain);
    t.shieldHp = left > 0 ? left : null;
    if (left <= 0) t.maxShieldHp = null;
  }).then(({ committed }) => writeDotProgress(dotId, committed ? remainingTicks : 0));
}

/** HOT 한 틱 — 살아있는 타워만 회복 (죽은 타워에 HP를 쓰면 잘못된 종료 판정이 난다) */
function applyHotTick(dotId, targetPlayer, targetTower, heal, remainingTicks) {
  return mutateTower(targetPlayer, targetTower, t => {
    if (t.alive === false) return false;
    _towerHeal(t, heal);
  }).then(({ committed }) => writeDotProgress(dotId, committed ? remainingTicks : 0));
}

/** 매치 타이머 시작 시각 기록 (P1만 호출) */
function writeMatchTimerStart(ts) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/matchTimerStartedAt`).set(ts);
}

/** 오버타임 시작 시각 원자 기록 — 먼저 쓰는 클라이언트가 권한 확보 */
function writeOvertimeStart(ts) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/overtimeStartedAt`).transaction(current => {
    if (current === null || current === undefined) return ts;
    return; // 이미 기록됨 — abort
  });
}

/** 진화 카운터 Firebase 저장 */
function writeEvolutionCharges(playerKey, charges) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/evolutionCharges`).set(charges);
}

/**
 * 경기 동결 — 종료 시각(endedAt)을 한 번만 기록한다. 이후 타워 쓰기는 규칙이 거부하므로
 * 이 시점의 상태가 최종 결과(승자·부순 타워·피해량·회복량)가 된다.
 */
function freezeMatch() {
  return db.ref(`rooms/${_syncRoomCode}/gameState/endedAt`).transaction(cur => {
    if (cur === null || cur === undefined) return serverNow();
    return;   // 이미 동결됨
  });
}

/** 서버의 최신 gameState — 결과는 로컬 캐시(예상 표시 포함)가 아니라 이 값으로 계산한다 */
function readFinalGameState() {
  return db.ref(`rooms/${_syncRoomCode}/gameState`).get().then(snap => snap.val());
}

/**
 * 승자 기록 — 트랜잭션으로 먼저 쓴 한 명만 확정. 결과 화면은 모두 listenWinner로 받은 값을 쓴다.
 */
function writeWinner(winner, reason) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/winner`).transaction(current => {
    if (current === null || current === undefined) return winner;
    return;
  }).then(result => {
    if (!result.committed) return;
    return db.ref(`rooms/${_syncRoomCode}/gameState/winReason`).set(reason)
      .catch(err => console.error('writeWinner reason failed:', err))
      .then(() => ensureRoomFinished());
  }).catch(err => {
    console.error('writeWinner transaction failed:', err);
  });
}

/**
 * 승자가 정해진 방을 'finished'로 — 아직 'playing'일 때만 바꾼다.
 * (이미 대기실로 되돌려진 방을 다시 finished로 덮어쓰지 않도록 트랜잭션)
 */
function ensureRoomFinished() {
  return db.ref(`rooms/${_syncRoomCode}/status`).transaction(s => (s === 'playing' ? 'finished' : undefined))
    .catch(err => console.error('방 종료 상태 기록 실패:', err));
}

/** 이모티콘 반응 쓰기 */
function writeEmoji(playerKey, emoji) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/emoji/${playerKey}`).set({ emoji });
}

/** 이모티콘 지우기 */
function clearEmoji(playerKey) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/emoji/${playerKey}`).set(null);
}

/** 이모티콘 반응 실시간 감청 */
function listenEmoji(playerKey, callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/emoji/${playerKey}`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 시전 연출 신호 — 피해보다 먼저 보내 상대·관전자도 같은 연출을 본다 */
function writeCastFx(sourcePlayer, targetPlayer, targetTower, castId, fxDX, fxDY) {
  const row = {
    targetPlayer, targetTower, amount: 0, type: 'cast_' + castId,
    sourcePlayer, ts: serverNow(),
  };
  // 설치형 연출 — 타워가 아니라 '놓은 자리'에 재생된다.
  // 상대 화면은 좌우가 뒤집혀 있으므로 그쪽 킹 타워 기준으로 다시 계산한다 (game.js)
  if (typeof fxDX === 'number' && typeof fxDY === 'number') {
    row.fxDX = fxDX;
    row.fxDY = fxDY;
  }
  return db.ref(`rooms/${_syncRoomCode}/gameState/instantHits/${uniqueId()}`).set(row)
    .catch(err => console.error('시전 신호 실패:', err));
}

/** 즉시 피해 숫자 표시용 child_added 리스너 */
function listenInstantHits(callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/instantHits`);
  return _track(ref, 'child_added', snap => callback(snap, snap.val()));
}

