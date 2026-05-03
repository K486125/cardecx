// ============================================================
//  effects.js — DOT/HOT 틱 처리
//  targetPlayer === 로컬 플레이어인 경우만 해당 클라이언트가 HP 업데이트
// ============================================================

let _effectsLocalKey = null;
let _effectsEnemyKey = null;
let _activeIntervals = {}; // dotId → { id, firedCount, totalTicks, dot }
let _finishedDotIds  = new Set(); // 마지막 틱이 로컬에서 이미 발사된 dotId
let _effectsGameState = null;
let _optHp = {}; // `${playerKey}_${pos}` → { hp, dir:'down'|'up', expires } — 낙관적 HP 덮어쓰기 방지

function effectsInit(localKey, enemyKey) {
  _effectsLocalKey = localKey;
  _effectsEnemyKey = enemyKey;
}

function effectsUpdateState(gameState) {
  _effectsGameState = gameState;
}

function effectsCleanup() {
  Object.values(_activeIntervals).forEach(entry => clearInterval(entry.id));
  _activeIntervals = {};
  _finishedDotIds.clear();
  _optHp = {};
}

/**
 * listenGameState가 낙관적 DOT/HOT 업데이트를 구버전 HP로 되돌리지 않도록 클램핑.
 * game.js에서 applyTowersSnapshot 호출 전에 사용.
 */
function effectsClampTowers(playerKey, towers) {
  if (!towers) return towers;
  const now = Date.now();
  let result = null;
  ['left', 'king', 'right'].forEach(pos => {
    const key = `${playerKey}_${pos}`;
    const opt = _optHp[key];
    if (!opt) return;
    if (now > opt.expires) { delete _optHp[key]; return; }
    const t = (result || towers)[pos];
    if (!t) return;
    // dir:'down'(DOT) → 서버가 구버전(높은 HP)으로 되돌리려 할 때 차단
    // dir:'up'(HOT)  → 서버가 구버전(낮은 HP)으로 되돌리려 할 때 차단
    const shouldClamp = opt.dir === 'down' ? t.hp > opt.hp : t.hp < opt.hp;
    // 서버가 따라잡았더라도 즉시 삭제하지 않고 자연 만료까지 유지.
    if (!shouldClamp) return;
    if (!result) result = { ...towers };
    result[pos] = { ...t, hp: opt.hp };
  });
  return result || towers;
}

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

    const isMyTower = dot.targetPlayer === _effectsLocalKey;
    const entry = { id: null, firedCount: 0, totalTicks: dot.remainingTicks, dot: dot };

    entry.id = setInterval(() => {
      _processDotTick(dotId, dot, isMyTower, entry);
    }, dot.tickInterval);

    _activeIntervals[dotId] = entry;
  });
}

function _processDotTick(dotId, dotTemplate, isMyTower, entry) {
  // 로컬 발사 카운터로 정확한 횟수 제어
  entry.firedCount++;
  const newRemainingTicks = entry.totalTicks - entry.firedCount;

  const currentDot = _effectsGameState?.dots?.[dotId];
  if (!currentDot) {
    clearInterval(entry.id);
    delete _activeIntervals[dotId];
    return;
  }

  const { targetPlayer, targetTower, type, dmgPerTick } = currentDot;
  const towerData = _effectsGameState?.[targetPlayer]?.towers?.[targetTower];

  if (!towerData || !towerData.alive) {
    if (isMyTower) {
      db.ref(`rooms/${window.gameRoomCode}/gameState/dots/${dotId}`).remove();
    }
    clearInterval(entry.id);
    delete _activeIntervals[dotId];
    return;
  }

  // 낙관적 HP 오버라이드 — Firebase 왕복 전 다음 틱에도 최신 HP/실드 사용 (데미지 누락 방지)
  const optKey       = `${targetPlayer}_${targetTower}`;
  const opt          = _optHp[optKey];
  let effectiveHp     = towerData.hp;
  let effectiveShield = towerData.shieldHp || 0;
  if (opt && Date.now() <= opt.expires) {
    if (opt.dir === 'down' && opt.hp < towerData.hp) {
      effectiveHp = opt.hp;
      if (opt.shieldHp !== undefined) effectiveShield = opt.shieldHp;
    } else if (opt.dir === 'up' && opt.hp > towerData.hp) {
      effectiveHp = opt.hp;
    }
  }

  const owner = targetPlayer === _effectsLocalKey ? 'my' : 'enemy';
  const now   = serverNow();

  // ── 보호막 자동 감소 ──────────────────────────────────
  if (type === 'shieldDrain') {
    if (effectiveShield <= 0) {
      clearInterval(entry.id);
      delete _activeIntervals[dotId];
      _finishedDotIds.add(dotId);
      if (isMyTower) {
        db.ref(`rooms/${window.gameRoomCode}/gameState/dots/${dotId}`).remove();
      }
      return;
    }
    const drain     = Math.min(effectiveShield, dmgPerTick);
    const newShield = effectiveShield - drain;

    _optHp[optKey] = { hp: effectiveHp, shieldHp: newShield, dir: 'down', expires: Date.now() + 2000 };
    updateTowerDisplay(owner, targetTower, effectiveHp, towerData.maxHp, true, {
      ...towerData,
      shieldHp:    newShield > 0 ? newShield : null,
      maxShieldHp: newShield > 0 ? towerData.maxShieldHp : null,
    });

    if (isMyTower) {
      // shieldDrain은 HP를 변경하지 않으므로 undefined 전달 → hp 덮어쓰기 방지
      applyDotTickFull(dotId, targetPlayer, targetTower, undefined, undefined, newRemainingTicks, newShield, undefined);
    }
    if (newRemainingTicks <= 0) {
      clearInterval(entry.id);
      entry.id = null;
      _finishedDotIds.add(dotId);
    }
    return;
  }

  if (type === 'damage') {
    // ── 면역 체크 ─────────────────────────────────────
    if (towerData.immunityUntil && now < towerData.immunityUntil) {
      showTowerHit(owner, targetTower, 0, 'immune');
      if (isMyTower) {
        if (newRemainingTicks <= 0) {
          db.ref(`rooms/${window.gameRoomCode}/gameState/dots/${dotId}`).remove();
        } else {
          db.ref(`rooms/${window.gameRoomCode}/gameState/dots/${dotId}/remainingTicks`).set(newRemainingTicks);
        }
      }
    } else {
      // ── 실제 피해 계산 ────────────────────────────
      let actualDmg = dmgPerTick;

      if (towerData.damageAmpUntil && now < towerData.damageAmpUntil) {
        actualDmg = Math.round(actualDmg * (1 + (towerData.damageAmpPercent || 0) / 100));
      }
      if (towerData.doomSealUntil && now < towerData.doomSealUntil) {
        actualDmg = Math.round(actualDmg * (1 + (towerData.doomSealPercent || 0) / 100));
      }
      if (towerData.damageReductionUntil && now < towerData.damageReductionUntil) {
        actualDmg = Math.round(actualDmg * (1 - (towerData.damageReductionPercent || 0) / 100));
      }
      if (towerData.damageReduction2Until && now < towerData.damageReduction2Until) {
        actualDmg = Math.round(actualDmg * (1 - (towerData.damageReduction2Percent || 0) / 100));
      }

      // 오버타임 피해 승수
      if (window.overtimeMultiplier && window.overtimeMultiplier > 1.0) {
        actualDmg = Math.round(actualDmg * window.overtimeMultiplier);
      }

      // ── 거울 반사 — 이 틱만 피해 차단, 경고 아이콘으로 3초 후 반사 ───
      if (towerData.mirrorUntil && now < towerData.mirrorUntil && isMyTower) {
        const mPct    = towerData.mirrorPercent || 70;
        const reflDmg = Math.round(actualDmg * (1 + mPct / 100));
        const srcPlayer = currentDot.sourcePlayer;
        db.ref(`rooms/${window.gameRoomCode}`).update({
          [`gameState/${targetPlayer}/towers/${targetTower}/mirrorUntil`]:   null,
          [`gameState/${targetPlayer}/towers/${targetTower}/mirrorPercent`]: null,
        }).then(() => {
          _effectsMirrorChainStep(targetPlayer, targetTower, srcPlayer, 'king', reflDmg, 0);
        });
        if (newRemainingTicks <= 0) {
          db.ref(`rooms/${window.gameRoomCode}/gameState/dots/${dotId}`).remove();
        } else {
          db.ref(`rooms/${window.gameRoomCode}/gameState/dots/${dotId}/remainingTicks`).set(newRemainingTicks);
        }
      } else {
        // ── HP/실드 계산 (낙관적 값 기반) ──────
        let remaining   = actualDmg;
        let newShieldHp = effectiveShield;

        if (newShieldHp > 0) {
          const absorbed = Math.min(newShieldHp, remaining);
          remaining     -= absorbed;
          newShieldHp   -= absorbed;
        }

        const rawHp      = Math.max(0, effectiveHp - remaining);
        const finalHp    = rawHp;
        const finalAlive = rawHp > 0;

        const shieldArg = (effectiveShield > 0 || newShieldHp !== effectiveShield)
          ? newShieldHp
          : undefined;

        // ── 즉시 화면 반영 (Firebase 왕복 대기 없이) ──
        // DOT 데미지 시전자 클라이언트에서 누적 스탯 추적
        if (currentDot.sourcePlayer === _effectsLocalKey && actualDmg > 0) {
          if (typeof _trackDmgStat === 'function') _trackDmgStat(actualDmg);
        }
        _optHp[optKey] = { hp: finalHp, shieldHp: newShieldHp, dir: 'down', expires: Date.now() + 2000 };
        showTowerHit(owner, targetTower, actualDmg, 'dot');
        updateTowerDisplay(owner, targetTower, finalHp, towerData.maxHp, finalAlive, {
          ...towerData,
          hp:         finalHp,
          alive:      finalAlive,
          shieldHp:   shieldArg !== undefined ? (shieldArg > 0 ? shieldArg : null) : towerData.shieldHp,
          maxShieldHp: (shieldArg !== undefined && shieldArg <= 0) ? null : towerData.maxShieldHp,
        });

        if (isMyTower) {
          applyDotTickFull(dotId, targetPlayer, targetTower, finalHp, finalAlive, newRemainingTicks, shieldArg, undefined);
        }
      }
    }
  } else {
    // ── 치유 ──────────────────────────────────────────
    let healAmount = dmgPerTick;
    // 힐량 감소 디버프 적용
    if (towerData.healReductionUntil && now < towerData.healReductionUntil) {
      healAmount = Math.floor(healAmount * (1 - (towerData.healReductionPercent || 20) / 100));
    }
    const newHp      = Math.min(towerData.maxHp, effectiveHp + healAmount);
    const actualHeal = newHp - effectiveHp;

    // ── 즉시 화면 반영 (Firebase 왕복 대기 없이) ──
    _optHp[optKey] = { hp: newHp, dir: 'up', expires: Date.now() + 2000 };
    showTowerHit(owner, targetTower, healAmount, 'heal');
    updateTowerDisplay(owner, targetTower, newHp, towerData.maxHp, true, { ...towerData, hp: newHp });

    // HOT 시전자 클라이언트에서 치유량 통계 추적
    if (currentDot.sourcePlayer === _effectsLocalKey && actualHeal > 0) {
      _trackHealStat(actualHeal);
    }

    if (isMyTower) {
      applyHotTick(dotId, targetPlayer, targetTower, newHp, towerData.maxHp, newRemainingTicks);
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

/**
 * effects.js 전용 반사 체인 스텝 — DOT 반사 총알 도착 시 호출
 */
function _effectsMirrorChainStep(fromPlayer, fromPos, toPlayer, toPos, damage, depth) {
  if (depth > 8) return;

  const toOwner = toPlayer === _effectsLocalKey ? 'my' : 'enemy';
  const toEl    = document.getElementById(`tower-${toOwner}-${toPos}`);

  const handleImpact = () => {
    const toTower = _effectsGameState?.[toPlayer]?.towers?.[toPos];
    if (!toTower || toTower.alive === false) return;

    const now = serverNow();
    const upd = {};

    // 거울 있으면 피해 차단 — 다음 체인만 예약
    if (toTower.mirrorUntil && now < toTower.mirrorUntil) {
      const mPct    = toTower.mirrorPercent || 70;
      const nextDmg = Math.round(damage * (1 + mPct / 100));
      upd[`gameState/${toPlayer}/towers/${toPos}/mirrorUntil`]   = null;
      upd[`gameState/${toPlayer}/towers/${toPos}/mirrorPercent`] = null;
      db.ref(`rooms/${window.gameRoomCode}`).update(upd).then(() => {
        _effectsMirrorChainStep(toPlayer, toPos, fromPlayer, 'king', nextDmg, depth + 1);
      });
      return;
    }

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
    db.ref(`rooms/${window.gameRoomCode}`).update(upd);
  };

  // 양쪽 클라이언트에 경고 아이콘 표시 (mirrorWarn instantHit)
  const warnId = uniqueId();
  db.ref(`rooms/${window.gameRoomCode}/gameState/instantHits/${warnId}`).set({
    targetPlayer: toPlayer, targetTower: toPos,
    amount: 0, type: 'mirrorWarn',
    sourcePlayer: fromPlayer, ts: serverNow()
  });
  setTimeout(handleImpact, 3000);
}
