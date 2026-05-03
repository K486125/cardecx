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

/** gameState 전체 한 번 읽기 */
function readGameState() {
  return db.ref(`rooms/${_roomCode}/gameState`).once('value');
}

/** gameState 실시간 리스너 */
function listenGameState(callback) {
  const ref = db.ref(`rooms/${_roomCode}/gameState`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 특정 플레이어 towers 실시간 */
function listenTowers(playerKey, callback) {
  const ref = db.ref(`rooms/${_roomCode}/gameState/${playerKey}/towers`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** dots 실시간 */
function listenDots(callback) {
  const ref = db.ref(`rooms/${_roomCode}/gameState/dots`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 상대방 offeredCards 리스너 (턴 상태 감지용) */
function listenTurnNumber(callback) {
  const ref = db.ref(`rooms/${_roomCode}/gameState/turnNumber`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 내 offeredCards 리스너 */
function listenOfferedCards(playerKey, callback) {
  const ref = db.ref(`rooms/${_roomCode}/gameState/${playerKey}/offeredCards`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 내 덱 실시간 */
function listenDeck(playerKey, callback) {
  const ref = db.ref(`rooms/${_roomCode}/gameState/${playerKey}/deck`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 에너지 실시간 */
function listenEnergy(playerKey, callback) {
  const ref = db.ref(`rooms/${_roomCode}/gameState/${playerKey}/energy`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** winner 실시간 감지 — null 포함 항상 callback 호출 (game.js에서 skip 로직 처리) */
function listenWinner(callback) {
  const ref = db.ref(`rooms/${_roomCode}/gameState/winner`);
  return _track(ref, 'value', snap => {
    callback(snap.val()); // null 포함 항상 호출 — _skipFirstWinner 로직이 올바르게 동작하도록
  });
}

/** 관전자 실시간 감지 */
function listenSpectators(callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/spectators`);
  return _track(ref, 'value', snap => callback(snap.val()));
}

/** 관전자 등록 (onDisconnect 포함) */
function writeSpectatorJoin(nickname) {
  const ref = db.ref(`rooms/${_syncRoomCode}/spectators/${nickname}`);
  ref.set(true);
  ref.onDisconnect().remove();
}

/** 관전자 퇴장 */
function writeSpectatorLeave(nickname) {
  db.ref(`rooms/${_syncRoomCode}/spectators/${nickname}`).remove();
}

/** 플레이어 칭호 쓰기 */
function writePlayerTitle(playerKey, title) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/title`).set(title || '타이틀 없음');
}

/** 플레이어 칭호 실시간 리스너 */
function listenPlayerTitle(playerKey, callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/${playerKey}/title`);
  return _track(ref, 'value', snap => callback(snap.val()));
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
  return db.ref(`rooms/${_roomCode}/gameState/${playerKey}/deck/${slotIndex}`).set(cardData);
}

/** 제공 카드 3장 쓰기 */
function writeOfferedCards(playerKey, cards) {
  const data = {};
  cards.forEach((c, i) => { data[i] = { cardId: c.id, grade: c.grade }; });
  return db.ref(`rooms/${_roomCode}/gameState/${playerKey}/offeredCards`).set(data);
}

/** 제공 카드 비우기 */
function clearOfferedCards(playerKey) {
  return db.ref(`rooms/${_roomCode}/gameState/${playerKey}/offeredCards`).set(null);
}

/** 턴 번호 증가 */
function incrementTurnNumber(currentTurn) {
  return db.ref(`rooms/${_roomCode}/gameState/turnNumber`).set(currentTurn + 1);
}

// ── 스탯 추적 ─────────────────────────────────────────────────
let _statsPlayerKey  = null;
let _statsTotalDmg   = 0;
let _statsTotalHeal  = 0;

function statsInit(playerKey) {
  _statsPlayerKey = playerKey;
  _statsTotalDmg  = 0;
  _statsTotalHeal = 0;
}

function _trackDmgStat(dmg) {
  if (!_statsPlayerKey || dmg <= 0) return;
  _statsTotalDmg += dmg;
  db.ref(`rooms/${_syncRoomCode}/gameState/${_statsPlayerKey}/stats/totalDmg`).set(_statsTotalDmg);
}

function _trackHealStat(heal) {
  if (!_statsPlayerKey || heal <= 0) return;
  _statsTotalHeal += heal;
  db.ref(`rooms/${_syncRoomCode}/gameState/${_statsPlayerKey}/stats/totalHeal`).set(_statsTotalHeal);
}

/**
 * 카드 사용 — 원자적 다중 경로 업데이트
 * @param {string} actingPlayer    'p1' | 'p2'
 * @param {number} slotIndex       덱 슬롯 인덱스
 * @param {number} newEnergy       차감 후 에너지
 * @param {string} targetPlayer    대상 플레이어
 * @param {string[]} targetPositions 대상 타워 위치 배열
 * @param {object} card            카드 정의
 * @param {object} currentTowers   현재 타워 상태 { left, king, right }
 */
function applyCardUse(actingPlayer, slotIndex, newEnergy, targetPlayer, targetPositions, card, currentTowers, currentGameState) {
  const updates = {};
  const now     = serverNow();

  updates[`gameState/${actingPlayer}/energy`]          = newEnergy;
  updates[`gameState/${actingPlayer}/deck/${slotIndex}`] = null;

  const effect = card.effect;

  // ── 글로벌 효과 (타워 위치 무관) ──
  if (effect.deckFreeze) {
    const curFreeze = currentGameState?.[targetPlayer]?.deckFreezeUntil || 0;
    const baseTime  = Math.max(now, curFreeze);
    updates[`gameState/${targetPlayer}/deckFreezeUntil`] = baseTime + effect.deckFreeze.duration;
  }

  if (effect.energyBurst) {
    const duration = effect.energyBurst.ticks * effect.energyBurst.interval;
    updates[`gameState/${actingPlayer}/energyBurstUntil`]   = now + duration;
    updates[`gameState/${actingPlayer}/energyBurstPerTick`] = effect.energyBurst.perTick;
  }

  const pendingChains = [];

  targetPositions.forEach(pos => {
    const tower = currentTowers[pos];
    if (!tower) return;

    if (!tower.alive) return;

    // ── 방어 효과 ──────────────────────────────────────
    if (effect.damageReduction) {
      const curRedUntil = tower.damageReductionUntil || 0;
      if (now < curRedUntil) {
        // 슬롯1 활성 → 슬롯2에 중첩
        updates[`gameState/${targetPlayer}/towers/${pos}/damageReduction2Until`]   = now + effect.damageReduction.duration;
        updates[`gameState/${targetPlayer}/towers/${pos}/damageReduction2Percent`] = effect.damageReduction.percent;
      } else {
        updates[`gameState/${targetPlayer}/towers/${pos}/damageReductionUntil`]   = now + effect.damageReduction.duration;
        updates[`gameState/${targetPlayer}/towers/${pos}/damageReductionPercent`] = effect.damageReduction.percent;
      }
    }

    if (effect.shield !== undefined) {
      const currentShield = tower.shieldHp || 0;
      if (currentShield > 0) {
        // 이미 보호막 활성 — 새 보호막의 50%를 타워 HP로 회복
        const healAmount = Math.round(effect.shield * 0.5);
        const newHp = Math.min(tower.maxHp, (tower.hp || 0) + healAmount);
        updates[`gameState/${targetPlayer}/towers/${pos}/hp`] = newHp;
      } else {
        updates[`gameState/${targetPlayer}/towers/${pos}/shieldHp`]    = effect.shield;
        updates[`gameState/${targetPlayer}/towers/${pos}/maxShieldHp`] = effect.shield;
      }
    }

    // 보호막 자동 감소 DOT 등록 (보호막이 실제로 부여된 경우에만)
    if (effect.shieldDecay && effect.shield !== undefined && !(tower.shieldHp > 0)) {
      const decayTicks  = Math.ceil(effect.shield / effect.shieldDecay.rate);
      const shieldDrainId = uniqueId();
      updates[`gameState/dots/${shieldDrainId}`] = {
        targetPlayer,
        targetTower:    pos,
        type:           'shieldDrain',
        dmgPerTick:     effect.shieldDecay.rate,
        tickInterval:   effect.shieldDecay.interval,
        remainingTicks: decayTicks,
        startedAt:      serverTimestamp(),
        sourcePlayer:   actingPlayer
      };
    }

    if (effect.immunity) {
      updates[`gameState/${targetPlayer}/towers/${pos}/immunityUntil`] = now + effect.immunity.duration;
    }

    // 반사 방어막 설치
    if (effect.reflect) {
      updates[`gameState/${targetPlayer}/towers/${pos}/mirrorUntil`]   = now + effect.reflect.duration;
      updates[`gameState/${targetPlayer}/towers/${pos}/mirrorPercent`] = effect.reflect.percent;
    }

    // ── 컨트롤 효과 ────────────────────────────────────
    if (effect.damageAmp) {
      if (card.id === 'doom_seal') {
        // 파멸의 낙인 전용 슬롯 — 악몽과 독립 중첩
        updates[`gameState/${targetPlayer}/towers/${pos}/doomSealUntil`]   = now + effect.damageAmp.duration;
        updates[`gameState/${targetPlayer}/towers/${pos}/doomSealPercent`] = effect.damageAmp.percent;
      } else {
        updates[`gameState/${targetPlayer}/towers/${pos}/damageAmpUntil`]   = now + effect.damageAmp.duration;
        updates[`gameState/${targetPlayer}/towers/${pos}/damageAmpPercent`] = effect.damageAmp.percent;
      }
    }

    // 힐량 감소 디버프
    if (effect.healReduction) {
      updates[`gameState/${targetPlayer}/towers/${pos}/healReductionUntil`]   = now + effect.healReduction.duration;
      updates[`gameState/${targetPlayer}/towers/${pos}/healReductionPercent`] = effect.healReduction.percent;
    }

    // ── 퍼센트 드레인 (그림리퍼) ───────────────────────
    if (effect.percentDrain) {
      const drainDmg = Math.floor(tower.hp * effect.percentDrain.damagePercent / 100);
      if (drainDmg > 0) {
        const newHp = Math.max(0, tower.hp - drainDmg);
        updates[`gameState/${targetPlayer}/towers/${pos}/hp`] = newHp;
        if (newHp === 0) updates[`gameState/${targetPlayer}/towers/${pos}/alive`] = false;

        _trackDmgStat(drainDmg);
        const drainHitId = uniqueId();
        updates[`gameState/instantHits/${drainHitId}`] = {
          targetPlayer, targetTower: pos, amount: drainDmg, type: 'damage', sourcePlayer: actingPlayer, ts: now
        };

        // 내 킹 타워 회복
        const healAmount = Math.floor(drainDmg * effect.percentDrain.healPercent / 100);
        if (healAmount > 0) {
          const myKing = currentGameState?.[actingPlayer]?.towers?.king;
          if (myKing && myKing.alive !== false) {
            const prevKingHp = updates[`gameState/${actingPlayer}/towers/king/hp`] !== undefined
              ? updates[`gameState/${actingPlayer}/towers/king/hp`]
              : myKing.hp;
            const newKingHp = Math.min(myKing.maxHp, prevKingHp + healAmount);
            updates[`gameState/${actingPlayer}/towers/king/hp`] = newKingHp;
            _trackHealStat(healAmount);
            const healHitId = uniqueId();
            updates[`gameState/instantHits/${healHitId}`] = {
              targetPlayer: actingPlayer, targetTower: 'king', amount: healAmount, type: 'heal', sourcePlayer: actingPlayer, ts: now
            };
          }
        }
      }
    }

    // ── 즉시 피해 ──────────────────────────────────────
    if (effect.damage) {
      const hitId = uniqueId();
      if (tower.immunityUntil && now < tower.immunityUntil) {
        // 면역 — 플로팅 숫자만 표시
        updates[`gameState/instantHits/${hitId}`] = { targetPlayer, targetTower: pos, amount: 0, type: 'immune', sourcePlayer: actingPlayer, ts: now };
      } else {
        let dmg = effect.damage;

        if (tower.damageAmpUntil && now < tower.damageAmpUntil) {
          dmg = Math.round(dmg * (1 + (tower.damageAmpPercent || 0) / 100));
        }
        if (tower.doomSealUntil && now < tower.doomSealUntil) {
          dmg = Math.round(dmg * (1 + (tower.doomSealPercent || 0) / 100));
        }
        if (tower.damageReductionUntil && now < tower.damageReductionUntil) {
          dmg = Math.round(dmg * (1 - (tower.damageReductionPercent || 0) / 100));
        }
        if (tower.damageReduction2Until && now < tower.damageReduction2Until) {
          dmg = Math.round(dmg * (1 - (tower.damageReduction2Percent || 0) / 100));
        }

        // 오버타임 피해 승수
        if (window.overtimeMultiplier && window.overtimeMultiplier > 1.0) {
          dmg = Math.round(dmg * window.overtimeMultiplier);
        }

        // 반사 감지 — 거울 있으면 피해 차단, 경고 아이콘으로 3초 후 반사
        if (tower.mirrorUntil && now < tower.mirrorUntil) {
          const mPct = tower.mirrorPercent || 70;
          pendingChains.push({
            fromPlayer: targetPlayer, fromPos: pos,
            toPlayer:   actingPlayer, toPos: 'king',
            damage:     Math.round(dmg * (1 + mPct / 100))
          });
          updates[`gameState/${targetPlayer}/towers/${pos}/mirrorUntil`]   = null;
          updates[`gameState/${targetPlayer}/towers/${pos}/mirrorPercent`] = null;
        } else {
          _trackDmgStat(dmg);
          updates[`gameState/instantHits/${hitId}`] = { targetPlayer, targetTower: pos, amount: dmg, type: 'damage', sourcePlayer: actingPlayer, ts: now };

          let remaining = dmg;
          const curShield = tower.shieldHp || 0;
          if (curShield > 0) {
            const absorbed   = Math.min(curShield, remaining);
            remaining       -= absorbed;
            const newShield  = curShield - absorbed;
            updates[`gameState/${targetPlayer}/towers/${pos}/shieldHp`]    = newShield > 0 ? newShield : null;
            if (newShield <= 0) {
              updates[`gameState/${targetPlayer}/towers/${pos}/maxShieldHp`] = null;
            }
          }

          const newHp = Math.max(0, tower.hp - remaining);
          updates[`gameState/${targetPlayer}/towers/${pos}/hp`] = newHp;
          if (newHp === 0) updates[`gameState/${targetPlayer}/towers/${pos}/alive`] = false;
        }
      }
    }

    // ── DOT 등록 (단일 객체 또는 배열 모두 지원) ──────
    if (effect.dot) {
      const dotList = Array.isArray(effect.dot) ? effect.dot : [effect.dot];
      dotList.forEach(dotDef => {
        const dotId = uniqueId();
        updates[`gameState/dots/${dotId}`] = {
          targetPlayer,
          targetTower:    pos,
          type:           'damage',
          dmgPerTick:     dotDef.dmgPerTick,
          tickInterval:   dotDef.tickInterval,
          remainingTicks: dotDef.ticks,
          startedAt:      serverTimestamp(),
          sourcePlayer:   actingPlayer
        };
      });
    }

    // ── 즉시 치유 ──────────────────────────────────────
    if (effect.heal) {
      const healRedPct   = (tower.healReductionUntil && now < tower.healReductionUntil)
        ? (tower.healReductionPercent || 20) : 0;
      const adjustedHeal = healRedPct > 0 ? Math.floor(effect.heal * (1 - healRedPct / 100)) : effect.heal;
      const newHp        = Math.min(tower.maxHp, tower.hp + adjustedHeal);
      const actualHeal   = newHp - tower.hp;
      _trackHealStat(actualHeal);
      updates[`gameState/${targetPlayer}/towers/${pos}/hp`] = newHp;
      if (actualHeal > 0) {
        const healHitId = uniqueId();
        updates[`gameState/instantHits/${healHitId}`] = { targetPlayer, targetTower: pos, amount: actualHeal, type: 'heal', sourcePlayer: actingPlayer, ts: now };
      }
    }

    // ── HOT 등록 ───────────────────────────────────────
    if (effect.hot) {
      const hotId = uniqueId();
      updates[`gameState/dots/${hotId}`] = {
        targetPlayer,
        targetTower:    pos,
        type:           'heal',
        dmgPerTick:     effect.hot.healPerTick,
        tickInterval:   effect.hot.tickInterval,
        remainingTicks: effect.hot.ticks,
        startedAt:      serverTimestamp(),
        sourcePlayer:   actingPlayer
      };
    }
  });

  const writePromise = db.ref(`rooms/${_syncRoomCode}`).update(updates);
  if (pendingChains.length > 0) {
    writePromise.then(() => {
      pendingChains.forEach(c => _mirrorChainStep(c.fromPlayer, c.fromPos, c.toPlayer, c.toPos, c.damage, 0));
    });
  }
  return writePromise;
}

/**
 * 반사 발사체 체인 — 총알이 도착하면 피해 적용 후 다음 거울 확인
 */
function _mirrorChainStep(fromPlayer, fromPos, toPlayer, toPos, damage, depth) {
  if (depth > 8) return;

  const toOwner = toPlayer === _statsPlayerKey ? 'my' : 'enemy';
  const toEl    = document.getElementById(`tower-${toOwner}-${toPos}`);

  const handleImpact = () => {
    const gs = typeof window.getGameState === 'function' ? window.getGameState() : null;
    const toTower = gs?.[toPlayer]?.towers?.[toPos];
    if (!toTower || toTower.alive === false) return;

    const now = serverNow();
    const upd = {};

    // 거울 있으면 피해 차단 — 다음 체인만 예약
    if (toTower.mirrorUntil && now < toTower.mirrorUntil) {
      const mPct    = toTower.mirrorPercent || 70;
      const nextDmg = Math.round(damage * (1 + mPct / 100));
      upd[`gameState/${toPlayer}/towers/${toPos}/mirrorUntil`]   = null;
      upd[`gameState/${toPlayer}/towers/${toPos}/mirrorPercent`] = null;
      db.ref(`rooms/${_syncRoomCode}`).update(upd).then(() => {
        _mirrorChainStep(toPlayer, toPos, fromPlayer, 'king', nextDmg, depth + 1);
      });
      return;
    }

    // 실드 흡수 후 HP 차감
    let remaining = damage;
    const curShield = toTower.shieldHp || 0;
    if (curShield > 0) {
      const abs = Math.min(curShield, remaining);
      remaining -= abs;
      const newShield = curShield - abs;
      upd[`gameState/${toPlayer}/towers/${toPos}/shieldHp`]    = newShield > 0 ? newShield : null;
      if (newShield <= 0) upd[`gameState/${toPlayer}/towers/${toPos}/maxShieldHp`] = null;
    }
    const newHp = Math.max(0, toTower.hp - remaining);
    upd[`gameState/${toPlayer}/towers/${toPos}/hp`]    = newHp;
    if (newHp === 0) upd[`gameState/${toPlayer}/towers/${toPos}/alive`] = false;

    const hitId = uniqueId();
    upd[`gameState/instantHits/${hitId}`] = {
      targetPlayer: toPlayer, targetTower: toPos,
      amount: damage, type: 'damage',
      sourcePlayer: fromPlayer, ts: now
    };
    db.ref(`rooms/${_syncRoomCode}`).update(upd);
  };

  // 양쪽 클라이언트에 경고 아이콘 표시 (mirrorWarn instantHit)
  const warnId = uniqueId();
  db.ref(`rooms/${_syncRoomCode}/gameState/instantHits/${warnId}`).set({
    targetPlayer: toPlayer, targetTower: toPos,
    amount: 0, type: 'mirrorWarn',
    sourcePlayer: fromPlayer, ts: serverNow()
  });
  setTimeout(handleImpact, 3000);
}

/**
 * DOT 한 틱 처리 — HP + 실드 + 부활 동시 처리
 * @param {number|undefined} newShieldHp  undefined 이면 실드 변경 없음
 * @param {boolean} clearRevival          true 이면 pendingRevival 제거
 */
function applyDotTickFull(dotId, targetPlayer, targetTower, newHp, newAlive, newRemainingTicks, newShieldHp, newRevivalValue) {
  const updates = {};
  // newHp === undefined → hp 필드 미기록 (shieldDrain 전용: HP 불변이므로 덮어쓰기 방지)
  if (newHp !== undefined) {
    updates[`gameState/${targetPlayer}/towers/${targetTower}/hp`] = newHp;
    if (!newAlive) updates[`gameState/${targetPlayer}/towers/${targetTower}/alive`] = false;
  }

  if (newShieldHp !== undefined) {
    updates[`gameState/${targetPlayer}/towers/${targetTower}/shieldHp`] = newShieldHp > 0 ? newShieldHp : null;
    if (newShieldHp <= 0) {
      updates[`gameState/${targetPlayer}/towers/${targetTower}/maxShieldHp`] = null;
    }
  }
  // newRevivalValue: undefined = no change, null = clear, number = new count
  if (newRevivalValue !== undefined && newRevivalValue !== false) {
    updates[`gameState/${targetPlayer}/towers/${targetTower}/pendingRevival`] = newRevivalValue;
  }

  if (newRemainingTicks <= 0) {
    updates[`gameState/dots/${dotId}`] = null;
  } else {
    updates[`gameState/dots/${dotId}/remainingTicks`] = newRemainingTicks;
  }

  return db.ref(`rooms/${_syncRoomCode}`).update(updates);
}

/** 하위 호환용 래퍼 */
function applyDotTick(dotId, targetPlayer, targetTower, newHp, newAlive, newRemainingTicks) {
  return applyDotTickFull(dotId, targetPlayer, targetTower, newHp, newAlive, newRemainingTicks, undefined, false);
}

/**
 * HOT 한 틱 처리 — 타워가 살아있을 때만 HP 업데이트 (transaction으로 alive 보장)
 * 죽은 타워에 HP를 덮어쓰면 alive=false 상태에서 hp>0이 되어 잘못된 게임 종료 트리거됨
 */
function applyHotTick(dotId, targetPlayer, targetTower, newHp, maxHp, newRemainingTicks) {
  const towerRef = db.ref(`rooms/${_syncRoomCode}/gameState/${targetPlayer}/towers/${targetTower}`);
  return towerRef.transaction(tower => {
    if (!tower || tower.alive === false) return; // abort — 죽은 타워엔 힐 금지
    return { ...tower, hp: Math.min(newHp, maxHp) };
  }).then(({ committed }) => {
    const updates = {};
    // 타워가 죽어서 commit 안됐거나 마지막 틱이면 dot 제거
    if (!committed || newRemainingTicks <= 0) {
      updates[`gameState/dots/${dotId}`] = null;
    } else {
      updates[`gameState/dots/${dotId}/remainingTicks`] = newRemainingTicks;
    }
    return db.ref(`rooms/${_syncRoomCode}`).update(updates);
  });
}

/**
 * 승자 기록 (transaction으로 중복 방지)
 */
function writeWinner(winner, reason) {
  return db.ref(`rooms/${_roomCode}/gameState/winner`).transaction(current => {
    if (current === null || current === undefined) return winner;
    return; // 이미 설정됨 — 중단
  }).then(result => {
    if (!result.committed) return;
    return db.ref(`rooms/${_syncRoomCode}/gameState/winReason`).set(reason).then(() => {
      // 즉시 로비에서 숨기기
      return db.ref(`rooms/${_syncRoomCode}/status`).set('finished').then(() => {
        // 15초 후 방 데이터 완전 삭제
        setTimeout(() => db.ref(`rooms/${_syncRoomCode}`).remove(), 15000);
      });
    });
  });
}

/** 타워 HP 직접 쓰기 (재접속 복구용) */
function writeTowerHp(playerKey, pos, hp, alive) {
  return db.ref(`rooms/${_roomCode}/gameState/${playerKey}/towers/${pos}`).update({ hp, alive });
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

/** 채팅 메시지 쓰기 */
function writeChat(playerKey, text) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/chat/${playerKey}`).set({ text, ts: Date.now() });
}

/** 채팅 메시지 지우기 */
function clearChat(playerKey) {
  return db.ref(`rooms/${_syncRoomCode}/gameState/chat/${playerKey}`).set(null);
}

/** 즉시 피해 숫자 표시용 child_added 리스너 */
function listenInstantHits(callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/instantHits`);
  return _track(ref, 'child_added', snap => callback(snap, snap.val()));
}

/** 채팅 메시지 실시간 감청 */
function listenChat(playerKey, callback) {
  const ref = db.ref(`rooms/${_syncRoomCode}/gameState/chat/${playerKey}`);
  return _track(ref, 'value', snap => callback(snap.val()));
}
