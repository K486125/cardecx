// ============================================================
//  effects.js — DOT/HOT 틱 처리
//  두 클라이언트 모두 틱을 돌려 숫자를 보여주고, 실제 HP 변경은
//  대상 타워 주인 클라이언트만 트랜잭션으로 기록한다 (sync.js mutateTower).
//  트랜잭션은 로컬에 즉시 반영되므로 주인 화면은 왕복 대기 없이 갱신된다.
// ============================================================

let _effectsLocalKey = null;
let _effectsEnemyKey = null;
let _activeIntervals = {}; // dotId → { id, firedCount, totalTicks, dot }
let _finishedDotIds  = new Set(); // 마지막 틱이 로컬에서 이미 발사된 dotId
let _effectsGameState = null;

function effectsInit(localKey, enemyKey) {
  _effectsLocalKey = localKey;
  _effectsEnemyKey = enemyKey;
}

/** 이 브라우저가 HP를 기록하는 타워인지 — 내 타워, 그리고 AI 대전이면 AI 타워 */
function _effectsOwnsTower(playerKey) {
  return playerKey === _effectsLocalKey || (!!window.botPlayerKey && playerKey === window.botPlayerKey);
}

function effectsUpdateState(gameState) {
  _effectsGameState = gameState;
}

function effectsCleanup() {
  Object.values(_activeIntervals).forEach(entry => clearInterval(entry.id));
  _activeIntervals = {};
  _finishedDotIds.clear();
}

/**
 * 시간 종료 직전 — 이미 때가 된 틱을 모두 처리한다 (백그라운드 탭에서 늦어진 틱이 빠지지 않도록).
 * 그 뒤 effectsCleanup으로 멈춘다.
 */
function effectsFlushDue() {
  Object.entries(_activeIntervals).forEach(([dotId, entry]) => {
    const due = dotTicksDue(entry, entry.dot.tickInterval);
    while (entry.firedCount < due && entry.id !== null && _activeIntervals[dotId] === entry) {
      _processDotTick(dotId, entry.dot, _effectsOwnsTower(entry.dot.targetPlayer), entry);
    }
  });
}

/**
 * DOT/HOT 한 틱의 결과 — 플레이어 두 명과 관전자가 같은 숫자를 보도록 한 곳에서 계산한다.
 * @param {object} dot    dots/{id}
 * @param {object} tower  대상 타워 현재 상태
 * @param {object} gs     gameState (시전자·대상 플레이어 버프 확인용)
 * @returns {{kind: 'immune'|'mirror'|'damage'|'heal', amount: number}}
 */
function computeDotTick(dot, tower, gs, tickNo, now) {
  if (dot.type === 'heal') {
    // 젖어 있으면 +50% (침수·파도 — 누가 쓴 물이든 · 폭염에 녹은 얼음물) — 토템(흰꽃·숲의정령)은 토템 칸이, 벚꽃은 회복받는 타워가 젖었을 때 (board.js)
    let h = dot.dmgPerTick;
    if (dot.totem && typeof totemSoakedHeal === 'function') h = totemSoakedHeal(h, dot.totem, dot.targetPlayer, now);
    else if (dot.cardId === 'cherry_blossom' && typeof towerSoakedHeal === 'function') h = towerSoakedHeal(h, dot.targetPlayer, dot.targetTower, now);
    return { kind: 'heal', amount: towerAdjustHeal(tower, h, now, _healWithered(dot, gs, now)) };
  }

  // 얼음전개 — 얼어 있는 동안만 들어간다. 폭염에 다 녹거나 땅·돌 카드에 깨지면 끝 (불덩이에 반쯤 녹으면 절반)
  if (dot.cardId === 'ice_deploy' && (tower.frozenMelt >= 2 || !(tower.frozenUntil > now - 1500))) return { kind: 'thawed', amount: 0 };
  // 언 타워를 녹인 폭염은 피해를 넣지 않는다 — 그 사이 늦게 들어온 불탐 줄도 끝낸다 (sync.js applyCardUse)
  if (dot.cardId === 'fire_evo' && tower.frozenMelt === 2 && tower.frozenUntil >= (dot.startedAt || 0) - 1500) return { kind: 'thawed', amount: 0 };

  if (tower.immunityUntil > now) return { kind: 'immune', amount: 0 };

  let dmg = dot.dmgPerTick;
  if (dot.cardId === 'ice_deploy' && tower.frozenMelt === 1) dmg = Math.round(dmg * 0.5);
  // 감전 (2026-10-02 상성) — 젖은 타워(침수·파도 · 폭염에 녹은 얼음물)는 번개 +50%
  if (dot.cardId === 'lightning' && typeof towerSoaked === 'function' && towerSoaked(dot.targetPlayer, dot.targetTower, now)) dmg = Math.round(dmg * 1.5);
  // 별똥별 evo 특성: 시전자가 starlightBurstActiveUntil 중이면 DOT 피해 +20% (자기 자신 제외)
  if (dot.cardId !== 'starlight_burst_evo' && gs?.[dot.sourcePlayer]?.starlightBurstActiveUntil > now) dmg = Math.round(dmg * 1.2);
  dmg = towerAdjustDamage(tower, dmg, now,
    { cardId: dot.cardId, heat: typeof towerHeatPercent === 'function' ? towerHeatPercent(gs, dot.targetPlayer, dot.targetTower, now) : 0 });
  // 오버타임 피해 승수
  if (window.overtimeMultiplier > 1.0) dmg = Math.round(dmg * window.overtimeMultiplier);

  // 거울 반사 — 이 틱은 피해 없이 반사
  return { kind: tower.mirrorUntil > now ? 'mirror' : 'damage', amount: dmg };
}

/** 더위(폭염의 열기) 속 회복인가 — 회복받는 타워나 그 회복을 내는 토템의 칸이 열기 속이면 말라 비틀어져 -25% */
function _healWithered(dot, gs, now) {
  if (typeof heatPercentAt !== 'function') return false;
  // 젖은 타워(녹은 얼음물 등)는 열기에 마르지 않는다 — 물의 회복 +50%만 받는다
  if (typeof towerSoaked === 'function' && towerSoaked(dot.targetPlayer, dot.targetTower, now)) return false;
  if (towerHeatPercent(gs, dot.targetPlayer, dot.targetTower, now) > 0) return true;
  if (!dot.totem) return false;
  const [c, r] = String(dot.totem).split(',').map(Number);
  return Number.isFinite(c) && heatPercentAt(gs, dot.targetPlayer, c, r, now) > 0;
}

/** 물에 꺼진 불의 지속 피해 · 다 녹은 얼음의 지속 피해 — 그 줄을 끝낸다 (주인 화면이 지운다) */
function _endDot(dotId, entry, isMyTower) {
  clearInterval(entry.id);
  entry.id = null;
  _finishedDotIds.add(dotId);
  if (isMyTower) writeDotProgress(dotId, 0);
}

/**
 * 인터벌이 불릴 때 밀린 틱까지 처리할 개수 — 백그라운드 탭은 타이머가 1초 이상으로 늦춰지므로
 * 경과 시간 기준으로 따라잡는다 (늦게라도 모든 틱이 적용·표시된다).
 */
function dotTicksDue(entry, interval) {
  const elapsed = gameNow() - entry.begin;
  return Math.min(entry.totalTicks, Math.floor((elapsed + DOT_TICK_SLACK_MS) / interval));
}
const DOT_TICK_SLACK_MS = 50;

/** Firebase 삭제 확인 전에 로컬 마지막 틱이 발사됐는지 여부 (game.js에서 참조) */
function isLocalDotFinished(dotId) {
  return _finishedDotIds.has(dotId);
}

/**
 * Firebase dots 스냅샷 수신 시 호출
 * 새로운 dotId에 대해서만 인터벌 등록
 */
function effectsApplyDots(dotsData) {
  const currentIds = new Set(Object.keys(dotsData || {}));

  // 사라진 dot 인터벌 제거
  Object.keys(_activeIntervals).forEach(id => {
    if (!currentIds.has(id)) {
      clearInterval(_activeIntervals[id].id);
      _finishedDotIds.delete(id); // Firebase 삭제 확인됐으므로 finished 플래그 해제
      delete _activeIntervals[id];
    }
  });

  // 새로 등장한 dot 인터벌 등록
  Object.entries(dotsData || {}).forEach(([dotId, dot]) => {
    if (_activeIntervals[dotId]) return;
    if (_finishedDotIds.has(dotId)) return;

    const isMyTower = _effectsOwnsTower(dot.targetPlayer);
    const entry = { id: null, firedCount: 0, totalTicks: dot.remainingTicks, dot: dot, begin: gameNow() };

    entry.id = setInterval(() => {
      const due = dotTicksDue(entry, dot.tickInterval);
      while (entry.firedCount < due && entry.id !== null && _activeIntervals[dotId] === entry) {
        _processDotTick(dotId, dot, isMyTower, entry);
      }
    }, dot.tickInterval);

    _activeIntervals[dotId] = entry;
  });
}

/**
 * 무너진 토템의 회복을 멈춘다 (board.js 붕괴).
 * 모든 화면이 자기 틱을 멈춰 회복 숫자가 더 뜨지 않게 하고, 그 타워 주인 화면만 dots 줄을 지운다
 * (틱을 기록하는 쪽이 원래 주인이다).
 * @param {(tag: string) => boolean} match 토템 표시('13,4')가 무너진 범위 안인가
 */
function effectsCancelTotemHeals(match) {
  const touched = new Set();
  Object.entries(_activeIntervals).forEach(([dotId, entry]) => {
    const d = entry.dot;
    if (!d || d.type !== 'heal' || !d.totem || _finishedDotIds.has(dotId) || !match(d.totem)) return;
    clearInterval(entry.id);
    entry.id = null;
    _finishedDotIds.add(dotId);           // 지워졌다는 확인이 올 때까지 다시 걸리지 않게
    if (_effectsOwnsTower(d.targetPlayer)) writeDotProgress(dotId, 0);
    touched.add(d.targetPlayer + '|' + d.targetTower);
  });
  // 타워의 지속 효과 배지에서도 뺀다
  if (typeof updateDotIndicator !== 'function') return;
  touched.forEach(k => {
    const [player, tower] = k.split('|');
    const remaining = Object.entries(_activeIntervals)
      .filter(([id, e]) => !_finishedDotIds.has(id) && e.dot?.targetPlayer === player && e.dot?.targetTower === tower)
      .map(([, e]) => e.dot);
    updateDotIndicator(player === _effectsLocalKey ? 'my' : 'enemy', tower, remaining);
  });
}

/**
 * 토템의 남은 시간이 줄었다 (board.js 지진 · 바람) — 그 토템의 회복 줄에서 ms 만큼의 틱을 뺀다.
 * 모든 화면이 같은 연출을 받아 각자 뺀다. 남은 틱이 없으면 끝 (그 타워 주인 화면이 dots 줄을 고친다)
 */
function effectsShortenTotemHeals(match, ms) {
  Object.entries(_activeIntervals).forEach(([dotId, entry]) => {
    const d = entry.dot;
    if (!d || d.type !== 'heal' || !d.totem || _finishedDotIds.has(dotId) || entry.id === null || !match(d.totem)) return;
    entry.totalTicks = Math.max(entry.firedCount, entry.totalTicks - Math.round(ms / d.tickInterval));
    const mine = _effectsOwnsTower(d.targetPlayer);
    if (entry.totalTicks <= entry.firedCount) _endDot(dotId, entry, mine);
    else if (mine) writeDotProgress(dotId, entry.totalTicks - entry.firedCount);
  });
}

/** 상대 클라이언트용 예상 화면 — 실제 값은 주인 클라이언트의 트랜잭션 결과로 곧 덮인다 */
function _previewTower(owner, pos, towerData, hp, shieldHp) {
  const alive = hp > 0;
  updateTowerDisplay(owner, pos, hp, towerData.maxHp, alive, {
    ...towerData,
    hp, alive,
    shieldHp:    shieldHp > 0 ? shieldHp : null,
    maxShieldHp: shieldHp > 0 ? towerData.maxShieldHp : null,
  });
}

function _processDotTick(dotId, dotTemplate, isMyTower, entry) {
  // 로컬 발사 카운터로 정확한 횟수 제어
  entry.firedCount++;
  const newRemainingTicks = entry.totalTicks - entry.firedCount;

  const currentDot = _effectsGameState?.dots?.[dotId];
  if (!currentDot) {
    clearInterval(entry.id);
    _finishedDotIds.add(dotId);
    delete _activeIntervals[dotId];
    return;
  }

  const { targetPlayer, targetTower, type, dmgPerTick } = currentDot;
  const towerData = _effectsGameState?.[targetPlayer]?.towers?.[targetTower];

  if (!towerData || !towerData.alive) {
    if (isMyTower) writeDotProgress(dotId, 0);
    clearInterval(entry.id);
    delete _activeIntervals[dotId];
    return;
  }

  const owner  = targetPlayer === _effectsLocalKey ? 'my' : 'enemy';
  const now    = gameNow();
  const shield = towerData.shieldHp || 0;

  // ── 보호막 자동 감소 ──────────────────────────────────
  if (type === 'shieldDrain') {
    if (shield <= 0) {
      clearInterval(entry.id);
      delete _activeIntervals[dotId];
      _finishedDotIds.add(dotId);
      if (isMyTower) writeDotProgress(dotId, 0);
      return;
    }
    if (isMyTower) {
      applyShieldDrainTick(dotId, targetPlayer, targetTower, dmgPerTick, newRemainingTicks);
    } else {
      _previewTower(owner, targetTower, towerData, towerData.hp, shield - Math.min(shield, dmgPerTick));
    }
    if (newRemainingTicks <= 0) {
      clearInterval(entry.id);
      entry.id = null;
      _finishedDotIds.add(dotId);
    }
    return;
  }

  if (type === 'damage') {
    // 물에 꺼진 불 (2026-10-02 상성) — 남은 불 피해는 들어가지 않는다 (board.js boardFireDoused)
    if ((currentDot.cardId === 'flame' || currentDot.cardId === 'fire_evo') && typeof boardFireDoused === 'function' &&
        boardFireDoused(targetPlayer, targetTower, currentDot.cardId, now)) { _endDot(dotId, entry, isMyTower); return; }
    const tick      = computeDotTick(currentDot, towerData, _effectsGameState, entry.firedCount, now);
    const actualDmg = tick.amount;
    if (tick.kind === 'thawed') { _endDot(dotId, entry, isMyTower); return; }
    if (tick.kind === 'immune') {
      showTowerHit(owner, targetTower, 0, 'immune');
      if (isMyTower) writeDotProgress(dotId, newRemainingTicks);
    } else if (tick.kind === 'mirror') {
      // 거울 반사 — 이 틱은 피해 없음, 경고 아이콘 후 3초 뒤 반사
      if (isMyTower) {
        applyDotMirrorTick(dotId, targetPlayer, targetTower, actualDmg, currentDot.sourcePlayer, newRemainingTicks);
      }
    } else {
      showTowerHit(owner, targetTower, actualDmg, 'dot', actualDmg > currentDot.dmgPerTick);   // 증폭으로 더 들어가면 크리티컬
      // 바위 지옥의 지속 피해는 '튀는 돌가루'다 — 들어갈 때마다 타워에서 튄다
      if (currentDot.cardId === 'rock_hell' && typeof playStoneDust === 'function') {
        playStoneDust(owner, targetTower);
      }

      if (isMyTower) {
        applyDotDamageTick(dotId, targetPlayer, targetTower, actualDmg, newRemainingTicks, currentDot.cardId);
      } else {
        const absorbed = Math.min(shield, actualDmg);
        _previewTower(owner, targetTower, towerData,
          Math.max(0, towerData.hp - (actualDmg - absorbed)), shield - absorbed);
      }
    }
  } else {
    // ── 치유 ──────────────────────────────────────────
    const healAmount = computeDotTick(currentDot, towerData, _effectsGameState, entry.firedCount, now).amount;
    const newHp      = Math.min(towerData.maxHp, towerData.hp + healAmount);

    showTowerHit(owner, targetTower, healAmount, 'heal');

    if (isMyTower) {
      applyHotTick(dotId, targetPlayer, targetTower, healAmount, newRemainingTicks);
    } else {
      _previewTower(owner, targetTower, towerData, newHp, shield);
    }
  }

  if (newRemainingTicks <= 0) {
    clearInterval(entry.id);
    entry.id = null;
    // Firebase 삭제 확인 전에 재등록 방지를 위해 _activeIntervals 항목은 유지,
    // 대신 finished 플래그로 표시하여 UI에서 즉시 뱃지 제거
    _finishedDotIds.add(dotId);
    if (typeof updateDotIndicator === 'function') {
      const remaining = [];
      Object.entries(_activeIntervals).forEach(([id, e]) => {
        if (!_finishedDotIds.has(id) &&
            e.dot?.targetPlayer === targetPlayer &&
            e.dot?.targetTower  === targetTower) {
          remaining.push(e.dot);
        }
      });
      updateDotIndicator(owner, targetTower, remaining);
    }
  }
}
