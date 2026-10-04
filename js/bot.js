// ============================================================
//  bot.js — AI 상대 (규칙 기반)
//
//  · AI는 방의 p2 자리에 앉는다 (players/p2.bot = true, 자리 주인은 사람 플레이어의 uid).
//  · 사람 플레이어의 브라우저가 AI 몫을 대신 돌린다 — 에너지 충전, 카드 받기(사람과 같은 5초 간격),
//    진화 카운트, 카드 사용 판단. 카드 사용은 사람과 똑같이 applyCardUse로 기록하므로
//    피해·회복·결과 계산은 사람끼리의 대전과 같다. AI 타워의 DOT 틱은 effects.js가 처리한다.
//  · 판단 함수(botChooseAction · botChooseOffer)는 화면·DB와 무관한 순수 함수 —
//    같은 규칙을 시뮬레이터(학습용)에서도 그대로 쓴다.
// ============================================================

const BOT_LEVELS = {
  //          판단 간격  카드 받기 간격  첫 카드   엉뚱한 선택  방어·회복 판단  아껴 쓰기
  easy:   { thinkMs: 2600, pickMs: 7000, firstPickMs: 2500, mistake: 0.35, defend: false, save: false },
  normal: { thinkMs: 1100, pickMs: 5000, firstPickMs: 1200, mistake: 0,    defend: true,  save: true  },
};
const BOT_LEVEL_IDS = Object.keys(BOT_LEVELS);
const BOT_STACK_MAX = 9;   // deck.js DECK_STACK_MAX와 같아야 한다
const BOT_POS = ['left', 'king', 'right'];

// ── 순수 판단 함수 ────────────────────────────────────────────

const _botAlive = t => !!t && t.alive !== false;

/** 효과가 주는 총 피해 (즉시 + DOT 전체, 증폭 전) */
function _botEffectDamage(effect) {
  if (!effect) return 0;
  let total = effect.damage || 0;
  const dots = effect.dot ? (Array.isArray(effect.dot) ? effect.dot : [effect.dot]) : [];
  dots.forEach(d => {
    for (let i = 0; i < d.ticks; i++) {
      total += d.dmgPerTick;
    }
  });
  return total;
}

/** 효과가 주는 총 회복 */
function _botEffectHeal(effect) {
  if (!effect) return 0;
  return (effect.heal || 0) + (effect.hot ? effect.hot.healPerTick * effect.hot.ticks : 0);
}

/** 타워에 걸린 DOT 중 아직 남은 피해 (보낸 쪽 기준 필터) */
function _botPendingDot(gs, targetKey, pos, sourceKey) {
  let sum = 0;
  Object.values(gs?.dots || {}).forEach(d => {
    if (d.type !== 'damage' || d.targetPlayer !== targetKey || d.targetTower !== pos) return;
    if (sourceKey && d.sourcePlayer !== sourceKey) return;
    sum += (d.dmgPerTick || 0) * (d.remainingTicks || 0);
  });
  return sum;
}

/** 대상 타워의 증폭·감소·면역을 반영한 피해 배율 (0이면 면역) */
function _botDamageMul(t, card, now) {
  if (t.immunityUntil > now) return 0;
  let m = 1;
  // 얼음 상성 (sync.js) — 언 타워에 폭염은 피해 없이 녹이기만, 불덩이는 절반 · 땅·돌 카드는 30% 더 (얼음이 깨진다)
  if (typeof towerFrozen === 'function' && towerFrozen(t, now)) {
    if (card.id === 'fire_evo') return 0;
    if (card.id === 'flame') m *= ICE_FIRE_CUT;
    if (SHATTER_CARDS.has(card.id)) m *= SHATTER_MUL;
  }
  if (t.damageAmpUntil        > now) m *= 1 + (t.damageAmpPercent        || 0) / 100;
  if (t.doomSealUntil         > now) m *= 1 + (t.doomSealPercent         || 0) / 100;
  if (t.damageReductionUntil  > now) m *= 1 - (t.damageReductionPercent  || 0) / 100;
  return m;
}

/** dual 카드를 대상 쪽에 맞는 실제 효과 카드로 (deck.js onCardUsed와 같은 규칙) */
function botCardForSide(card, ownSide) {
  if (card.type !== 'dual' || !card.effect?.dualEffect) return card;
  const sub = ownSide ? card.effect.dualEffect.support : card.effect.dualEffect.attack;
  return { ...card, type: ownSide ? 'heal' : 'attack', effect: sub };
}

// 타워가 선 칸 (내 화면 기준). 상대 진영은 좌우 거울이라 타워끼리의 위치 관계가 같다 — game.html의 --col/--row
const BOT_TOWER_TILES = { left: [4, 2], king: [3, 4], right: [4, 6] };

/**
 * 그 타워를 겨눴을 때 실제로 맞는 타워들.
 * 칸 범위 카드(지진·붕괴)는 그 타워 칸을 가운데로 놓은 범위에 든 타워만 맞는다 — targeting(range2 등)으로
 * 세면 지진을 두 타워짜리로 잘못 알고 너무 높게 친다. 화면을 읽지 않는 순수 함수라 시뮬레이터에서도 쓸 수 있다.
 */
function botAffectedPositions(card, pos) {
  const st = typeof CAST_STYLES !== 'undefined' && card.cast ? CAST_STYLES[card.cast] : null;
  if (st?.shape === 'area' && typeof castAreaRect === 'function' && BOT_TOWER_TILES[pos]) {
    const [c, r] = BOT_TOWER_TILES[pos];
    const R = castAreaRect(st, c, r);
    return BOT_POS.filter(p => { const [pc, pr] = BOT_TOWER_TILES[p]; return pc >= R.c0 && pc <= R.c1 && pr >= R.r0 && pr <= R.r1; });
  }
  return getAffectedPositions(pos, getRangeCount(card.targeting));
}

/**
 * AI가 쓴 범위 공격에 든 상대 소환 유닛 — 사람이 쓸 때(board.js onCardDropped)와 같은 칸·같은 피해.
 * 칸은 AI 자기 시점(내 타워가 왼쪽)으로 세고, p1 기준으로 바꿔 넘긴다.
 *   지진·붕괴 — 겨눈 타워 칸을 가운데로 한 범위 전부
 *   토네이도  — 놓은 칸에서 멈추는 열까지, 다 자란 폭 안의 줄 (멀리 갈수록 세다)
 */
function _botUnitStrike(style, card, act, place, hitMs) {
  if (typeof unitsWriteStrike !== 'function' || !style) return;
  const toP1 = c => (_bot.key === 'p1' ? c : 15 - c);
  const tiles = [];
  if (style.shape === 'area' && BOT_TOWER_TILES[act.pos]) {
    const [c, r] = BOT_TOWER_TILES[act.pos];
    const R = castAreaRect(style, 15 - c, r);
    const eff = card.effect || {};
    const dots = Array.isArray(eff.dot) ? eff.dot : eff.dot ? [eff.dot] : [];
    const dmg = (eff.damage || 0) + dots.reduce((s, d) => s + (d.dmgPerTick || 0) * (d.ticks || 0), 0);
    for (let cc = R.c0; cc <= R.c1; cc++) for (let rr = R.r0; rr <= R.r1; rr++) tiles.push([toP1(cc), rr, dmg]);
  } else if (style.shape === 'tile' && place?.point) {
    // 화면 칸 → AI 시점 칸 (AI는 이 화면에서 오른쪽에 있다)
    const hostCol = Math.floor(place.point.x / TILE), row = Math.floor(place.point.y / TILE);
    const col = 15 - hostCol;
    const stopCol = place.targets.length ? Math.min(...place.targets.map(h => h.col)) : 14;
    const rad = tornadoRadius(col);
    for (let cc = col; cc <= stopCol; cc++) for (let rr = 0; rr < 9; rr++) {
      if (Math.abs((rr - row) * TILE) > rad) continue;
      tiles.push([toP1(cc), rr, tornadoDamage(Math.max(1, cc - col))]);
    }
  }
  if (tiles.length) unitsWriteStrike(_bot.key, tiles, hitMs);
}

/** 그림리퍼를 놓을 칸 — 그 줄의 내 타워 바로 앞. 사람의 칸 규칙(unitSummonTarget)을 그대로 쓴다 */
function botSummonPlace(pos, enemyTowers) {
  if (typeof unitSummonTarget !== 'function' || !BOT_TOWER_TILES[pos]) return null;
  const [c, r] = BOT_TOWER_TILES[pos];
  const col = c + 1;
  return unitSummonTarget(col, r, enemyTowers) === pos ? { col, row: r } : null;
}

/** 공격 카드를 적 pos에 썼을 때의 가치 */
function _botAttackValue(card, v, pos) {
  const towers = v.gs[v.enemy]?.towers || {};
  const myKing = v.gs[v.me]?.towers?.king;
  const base   = _botEffectDamage(card.effect);
  let value = 0;
  // 그림리퍼 — 그 줄 타워 앞까지 걸어가 2초마다 벤다. 사람과 같은 칸 규칙으로 놓을 수 있는 줄만
  if (card.effect?.summon) {
    const t = towers[pos];
    if (!_botAlive(t) || !botSummonPlace(pos, towers)) return 0;
    const mine = Object.values(v.gs.units || {}).filter(u => u && u.owner === v.me && u.diedAt == null).length;
    return Math.max(0, 420 + (t.hp <= card.effect.summon.damage * 5 ? 120 : 0) - mine * 150);
  }
  botAffectedPositions(card, pos).forEach(p => {
    const t = towers[p];
    if (!_botAlive(t)) return;
    // 이미 걸어 둔 내 DOT로 곧 깎일 체력 — 과잉 피해를 피하고 처치 여부를 판단
    const hpLeft = Math.max(0, t.hp - _botPendingDot(v.gs, v.enemy, p, v.me)) + (t.shieldHp || 0);
    if (card.effect.percentDrain) {
      const drain = Math.floor(t.hp * card.effect.percentDrain.damagePercent / 100);
      const heal  = Math.min(Math.floor(drain * card.effect.percentDrain.healPercent / 100),
                             _botAlive(myKing) ? myKing.maxHp - myKing.hp : 0);
      value += drain + heal;
      return;
    }
    const mul = _botDamageMul(t, card, v.now);
    if (mul === 0) return;
    const dmg = base * mul * (v.overtimeMul || 1);
    if (t.mirrorUntil > v.now) { value -= dmg * 0.8; return; }   // 반사 — 내 킹이 맞는다
    if (hpLeft <= 0) return;                                      // 이미 쓰러질 타워
    value += Math.min(dmg, hpLeft);
    if (dmg >= hpLeft) value += p === 'king' ? 5000 : 60;         // 처치 보너스 (킹 = 승리)
  });
  // 힐량 감소 디버프 — 덤
  if (card.effect.healReduction) value += 10;
  return value;
}

// ── 토템 상성 (2026-10-04) ────────────────────────────────
// 상대 토템(숲의정령 · 흰꽃)이 앞으로 줄 회복 = 막을 수 있는 회복. 단일 카드는 토템 하나를 노리고(듀얼 검 · 톱은 없앰,
// 바람은 남은 시간 -2초), 범위 카드는 그 범위에 든 토템만큼 덤으로 친다 (불 · 가시 · 붕괴는 없애고 지진은 -2초).
const BOT_TOTEM_CARDS = { dual_sword: 'remove', thorn_evo: 'remove', wind: 'cut' };
const BOT_TOTEM_AREA  = { flame: 'remove', fire_evo: 'remove', thorn: 'remove', collapse: 'remove', earthquake: 'cut' };

/**
 * 상대 토템 목록 (이 화면 칸) — 회복 줄(dots)에서 모은다.
 * @returns {Array<{col,row,heal,perSec,leftMs}>} heal = 남은 회복 합, perSec = 1초 회복
 */
function botEnemyTotems(v) {
  if (typeof _totemTagLocal !== 'function') return [];
  const by = {};
  Object.values(v.gs?.dots || {}).forEach(d => {
    if (!d || d.type !== 'heal' || !d.totem || d.targetPlayer !== v.enemy) return;
    const l = _totemTagLocal(d.totem);
    if (!l || (typeof totemOnTile === 'function' && !totemOnTile(l.col, l.row))) return;
    const k = l.col + ',' + l.row;
    const o = by[k] || (by[k] = { col: l.col, row: l.row, heal: 0, perSec: 0 });
    o.heal   += (d.dmgPerTick || 0) * (d.remainingTicks || 0);
    o.perSec += (d.dmgPerTick || 0) * 1000 / (d.tickInterval || 1000);
  });
  return Object.values(by).map(o => ({ ...o, leftMs: typeof totemLeftMs === 'function' ? totemLeftMs(o.col, o.row) : 5000 }));
}

/** 토템에 이 효과를 주면 막는 회복 */
function _botTotemWorth(t, how) {
  if (how === 'remove' || t.leftMs <= TOTEM_CUT_MS_BOT) return t.heal;
  return Math.min(t.heal, t.perSec * TOTEM_CUT_MS_BOT / 1000);
}
const TOTEM_CUT_MS_BOT = 2000;   // board.js TOTEM_CUT_MS와 같다

/** 범위 카드를 그 타워에 썼을 때 범위에 드는 상대 토템의 값 (이 화면 칸 — 상대는 왼쪽) */
function _botAreaTotemBonus(card, pos, totems) {
  const how = BOT_TOTEM_AREA[card.id];
  if (!how || !totems.length || !BOT_TOWER_TILES[pos] || typeof castAreaRect !== 'function') return 0;
  const st = typeof cardCastStyle === 'function' ? cardCastStyle(card) : null;
  if (!st) return 0;
  const [tc, tr] = BOT_TOWER_TILES[pos];
  const R = st.burn ? castAreaRect(st, tc + 1, tr + 1) : castAreaRect(st, tc, tr);
  return totems.filter(t => t.col >= R.c0 && t.col <= R.c1 && t.row >= R.r0 && t.row <= R.r1)
               .reduce((s, t) => s + _botTotemWorth(t, how), 0);
}

/** 내 쪽 카드(회복·방어)를 내 pos에 썼을 때의 가치 */
function _botSupportValue(card, v, pos, energyLeft) {
  const e = card.effect;
  const towers = v.gs[v.me]?.towers || {};
  let value = 0;
  if (e.energyBurst) {
    if (v.overtime) return 0;
    const gain = e.energyBurst.perTick * e.energyBurst.ticks;
    return Math.max(0, Math.min(gain, 100 - energyLeft) - 10) * 1.5;
  }
  getAffectedPositions(pos, getRangeCount(card.targeting)).forEach(p => {
    const t = towers[p];
    if (!_botAlive(t)) return;
    const threat = _botPendingDot(v.gs, v.me, p, v.enemy);
    const danger = 1 - t.hp / t.maxHp;
    const heal = _botEffectHeal(e);
    if (heal) {
      const reduce = t.healReductionUntil > v.now ? 1 - (t.healReductionPercent || 20) / 100 : 1;
      value += Math.min(heal * reduce, t.maxHp - t.hp + threat * 0.5);
    }
    // 벽돌 · 철벽 — 한 타워에 하나. 다른 방어막이 서 있으면 못 놓고, 같은 방어막이면 연장이라 덜 급하다
    if (e.damageReduction && towerWallAllows(t, card, v.now)) {
      const extend = towerWallKind(t, v.now) ? 0.5 : 1;
      value += (threat * e.damageReduction.percent / 100 + danger * 40) * extend;
    }
    if (e.shield !== undefined) value += Math.min(e.shield, threat + danger * 60);
    if (e.immunity && !(t.immunityUntil > v.now)) value += threat + danger * 30;
    if (e.reflect && !(t.mirrorUntil > v.now)) value += 30 + danger * 60 + (p === 'king' ? 20 : 0);
  });
  return value;
}

/** 적에게 거는 방해 카드의 가치 */
function _botControlValue(card, v, pos, deck) {
  const e = card.effect;
  // 얼음전개 — 4×4칸에 든 타워를 얼려 1초마다 피해 + 언 타워가 있으면 덱 동결
  if (e.freeze) {
    const foe = v.gs[v.enemy] || {};
    const towers = foe.towers || {};
    let dmg = 0;
    botAffectedPositions(card, pos).forEach(p => {
      const t = towers[p];
      if (!_botAlive(t) || towerFrozen(t, v.now)) return;
      dmg += Math.min(t.hp, _botEffectDamage(e) * _botDamageMul(t, card, v.now));
    });
    if (!dmg) return 0;
    return dmg + (foe.deckFreezeUntil > v.now + 2000 ? 0 : 40 + (foe.energy || 0) * 0.8);
  }
  if (e.deckFreeze) {
    const foe = v.gs[v.enemy] || {};
    if (foe.deckFreezeUntil > v.now + 2000) return 0;
    return 40 + (foe.energy || 0) * 0.8;
  }
  if (e.damageAmp) {
    // 증폭 — 곧 들어갈 내 DOT와 손에 든 공격 카드 피해를 키운다
    const towers = v.gs[v.enemy]?.towers || {};
    const followUp = deck.reduce((m, c) => (c && c.type === 'attack' ? Math.max(m, _botEffectDamage(c.effect)) : m), 0);
    let value = 0;
    getAffectedPositions(pos, getRangeCount(card.targeting)).forEach(p => {
      const t = towers[p];
      if (!_botAlive(t) || t.mirrorUntil > v.now || t.immunityUntil > v.now) return;
      const amped = card.id === 'doom_seal' ? t.doomSealUntil > v.now : t.damageAmpUntil > v.now;
      if (amped) return;
      value += (_botPendingDot(v.gs, v.enemy, p, v.me) + followUp * 0.5) * e.damageAmp.percent / 100;
    });
    return value;
  }
  return 0;
}

/**
 * 이번에 쓸 카드와 대상 — 쓸 게 없으면 null.
 * @param {object} v  { gs, me, enemy, now, energy, deck:[카드|null ×5], charges, overtime, overtimeMul, level }
 * @param {() => number} rand  0~1 난수 (시뮬레이터에서 시드 고정용)
 * @returns {{ slot, ownSide, pos, card } | null}  card = 진화·dual 반영된 실제 카드
 */
function botChooseAction(v, rand = Math.random) {
  const cfg = BOT_LEVELS[v.level] || BOT_LEVELS.normal;
  const me = v.gs?.[v.me], foe = v.gs?.[v.enemy];
  if (!me?.towers || !foe?.towers) return null;
  // 얼음전개로 덱이 얼었다 — 어떤 카드도 쓸 수 없다 (사람과 같다)
  const frozen = me.deckFreezeUntil > v.now;

  const effDeck = v.deck;
  const options = [];
  const totems = botEnemyTotems(v);
  effDeck.forEach((card, slot) => {
    if (!card) return;
    if (frozen) return;
    if (v.blocked?.includes(card.id)) return;   // 연출이 도는 중이거나 놓을 자리가 없는 카드
    // 단일 카드로 상대 토템 하나를 노린다 (토템을 치면 타워는 맞지 않는다)
    const how = BOT_TOTEM_CARDS[card.id];
    if (how) totems.forEach(t => {
      options.push({ slot, ownSide: false, pos: 'king', card, value: _botTotemWorth(t, how), cost: card.energyCost, totem: t });
    });
    const sides = card.type === 'dual' ? [false, true]
                : (card.type === 'heal' || card.type === 'defense') ? [true] : [false];
    sides.forEach(ownSide => {
      const c = botCardForSide(card, ownSide);
      BOT_POS.forEach(pos => {
        const t = (ownSide ? me : foe).towers[pos];
        if (!_botAlive(t)) return;
        let value;
        if (ownSide)                 value = cfg.defend ? _botSupportValue(c, v, pos, v.energy - card.energyCost) : 5;
        else if (c.type === 'control') value = _botControlValue(c, v, pos, effDeck);
        else                           value = _botAttackValue(c, v, pos) + _botAreaTotemBonus(c, pos, totems);
        options.push({ slot, ownSide, pos, card, value, cost: card.energyCost });
      });
    });
  });

  const affordable = options.filter(o => o.cost <= v.energy && o.value > 0);
  if (!affordable.length) return null;

  // 쉬움 — 가끔 아무 카드나 아무 대상에
  if (cfg.mistake && rand() < cfg.mistake) {
    const o = affordable[Math.floor(rand() * affordable.length)];
    return { slot: o.slot, ownSide: o.ownSide, pos: o.pos, card: o.card, totem: o.totem || null };
  }

  // 효율(가치/에너지)이 가장 좋은 선택. 에너지가 넘칠 땐 절대 가치를 더 본다
  const score = o => o.value / Math.max(1, o.cost) + (v.energy >= 90 ? o.value / 100 : 0);
  affordable.sort((a, b) => score(b) - score(a));
  const best = affordable[0];

  // 아껴 쓰기 — 훨씬 강한 카드가 곧 가능해지면 싼 카드로 에너지를 흩지 않는다
  if (cfg.save && v.energy < 90) {
    const bigger = options.filter(o => o.cost > v.energy && o.value > best.value * 2.5 && o.cost - v.energy <= 25);
    const deckFull = v.deck.every(Boolean);
    if (bigger.length && !deckFull && best.value < 5000) return null;
  }
  return { slot: best.slot, ownSide: best.ownSide, pos: best.pos, card: best.card, totem: best.totem || null };
}

/** 카드 한 장의 대략적인 가치 (받을 카드 고르기·대체할 슬롯 고르기에 사용) */
function _botStaticWorth(c, v) {
  const e = c.effect || {};
  const range = getRangeCount(c.targeting);
  const myTowers = v.gs?.[v.me]?.towers || {};
  const hurt = BOT_POS.reduce((a, p) => a + (_botAlive(myTowers[p]) ? myTowers[p].maxHp - myTowers[p].hp : 0), 0);
  let val;
  if (e.summon) val = 600;
  else if (c.type === 'attack' || c.type === 'dual') val = _botEffectDamage(c.type === 'dual' ? e.dualEffect.attack : e) * range + (e.percentDrain ? 500 : 0);
  else if (c.type === 'heal') val = Math.min(_botEffectHeal(e) * range, hurt + 40);
  else if (c.type === 'control') val = e.deckFreeze ? 120 : 90 * range;
  else val = e.energyBurst ? 60 : 70;
  // 진화가 가까운 카드는 더 값지다
  if (EVOLUTION_MAP[c.id]) val *= 1 + (v.charges?.[c.id] || 0) * 0.25;
  return val / Math.sqrt(Math.max(1, c.energyCost));
}

/** 받은 카드 3장 중 덱에 넣을 카드의 번호 */
function botChooseOffer(cards, v, rand = Math.random) {
  const cfg = BOT_LEVELS[v.level] || BOT_LEVELS.normal;
  if (cfg.mistake && rand() < cfg.mistake) return Math.floor(rand() * cards.length);
  let bestIdx = 0;
  cards.forEach((c, i) => { if (_botStaticWorth(c, v) > _botStaticWorth(cards[bestIdx], v)) bestIdx = i; });
  return bestIdx;
}

// ── 게임 연결 (사람 플레이어의 브라우저에서 AI 몫을 돌림) ─────────

let _bot = null;

/**
 * @param {'p1'|'p2'} key       AI 자리
 * @param {'p1'|'p2'} enemyKey  사람 자리
 * @param {string} level        'easy' | 'normal'
 */
function botStart(key, enemyKey, level) {
  botStop();
  const cfg = BOT_LEVELS[level] ? level : 'normal';
  _bot = {
    key, enemyKey, level: cfg, cfg: BOT_LEVELS[cfg],
    energy: 100, deck: [null, null, null, null, null], charges: {},   // 슬롯 = { card, count }
    busy: {},                                   // 카드 id → 이 시각까지 잠김 (사람의 연출 잠금과 같다)
    burstUntil: 0, regenAcc: 0, timers: [], stopped: false,
  };
  window.botPlayerKey = key;   // effects.js — AI 타워의 DOT 틱도 이 브라우저가 기록

  // 에너지 — 사람과 같은 규칙: 3초마다 +5, 오버타임엔 1초마다 +10, 호박마차는 5초간 매초 +10
  _bot.timers.push(setInterval(_botEnergyTick, 1000));
  _bot.timers.push(setTimeout(_botPickLoop, _bot.cfg.firstPickMs));
  _bot.timers.push(setTimeout(_botThinkLoop, _bot.cfg.thinkMs + 800));
}

function botStop() {
  if (!_bot) return;
  _bot.stopped = true;
  _bot.timers.forEach(id => { clearInterval(id); clearTimeout(id); });
  _bot = null;
  window.botPlayerKey = null;
}

function _botActive() {
  // 컷씬 중엔 사람처럼 아무것도 못 한다 (에너지도 멈춘다)
  return _bot && !_bot.stopped && !window.matchInputLocked && !(typeof gamePaused === 'function' && gamePaused());
}

function _botSetEnergy(val) {
  const next = clamp(val, 0, ENERGY_MAX);
  if (next === _bot.energy) return;
  _bot.energy = next;
  writeEnergy(_bot.key, next, true);
}

function _botEnergyTick() {
  if (!_botActive()) return;
  let gain = 0;
  if (window.overtimeActive) {
    gain = 10;
  } else {
    _bot.regenAcc += 1;
    if (_bot.regenAcc >= 3) { _bot.regenAcc = 0; gain += ENERGY_REGEN; }
    if (gameNow() < _bot.burstUntil) gain += 10;
  }
  if (gain) _botSetEnergy(_bot.energy + gain);
}

function _botView() {
  return {
    gs: window.getGameState(), me: _bot.key, enemy: _bot.enemyKey, now: gameNow(),
    energy: _bot.energy, deck: _bot.deck.map(s => s?.card || null), charges: _bot.charges,
    overtime: !!window.overtimeActive,
    overtimeMul: window.overtimeMultiplier > 1 ? window.overtimeMultiplier : 1,
    level: _bot.level,
    blocked: Object.keys(_bot.busy).filter(id => _bot.busy[id] > Date.now()),
  };
}

/** 슬롯 기록 */
function _botWriteSlot(i) {
  const slot = _bot.deck[i];
  writeDeckSlot(_bot.key, i, slot ? { cardId: slot.card.id, grade: slot.card.grade, count: slot.count } : null);
}

/** 카드 한 장 넣기 — 같은 카드는 쌓고(최대 9), 자리가 없으면 false */
function _botPlaceCard(card) {
  const stack = _bot.deck.findIndex(s => s && s.card.id === card.id && s.count < BOT_STACK_MAX);
  if (stack !== -1) { _bot.deck[stack].count++; _botWriteSlot(stack); return true; }
  const empty = _bot.deck.findIndex(s => s === null);
  if (empty === -1) return false;
  _bot.deck[empty] = { card: { ...card }, count: 1 };
  _botWriteSlot(empty);
  return true;
}

/** 자리가 없을 때 — 지금 덱에서 가장 값이 낮은 슬롯을 버리고 넣는다 (사람의 '대체'에 해당) */
function _botReplaceWorst(card) {
  const v = _botView();
  const worth = c => (c ? _botStaticWorth(c, v) : -1);
  let worstIdx = 0;
  _bot.deck.forEach((slot, i) => { if (worth(slot?.card) < worth(_bot.deck[worstIdx]?.card)) worstIdx = i; });
  if (worth(card) <= worth(_bot.deck[worstIdx]?.card)) return;   // 새 카드가 더 나쁘면 버린다
  _bot.deck[worstIdx] = { card: { ...card }, count: 1 };
  _botWriteSlot(worstIdx);
}

/** 카드 받기 — 사람처럼 일정 간격으로 3장 중 1장 */
function _botPickLoop() {
  if (!_bot || _bot.stopped) return;
  if (_botActive()) {
    const offer = drawCards(3);
    const card  = offer[botChooseOffer(offer, _botView())];
    if (!_botPlaceCard(card)) _botReplaceWorst(card);
  }
  _bot.timers.push(setTimeout(_botPickLoop, _bot.cfg.pickMs));
}

function _botThinkLoop() {
  if (!_bot || _bot.stopped) return;
  if (_botActive()) {
    const v = _botView();
    if (v.gs && !v.gs.winner) {
      const act = botChooseAction(v);
      if (act) _botUseCard(act, v);
    }
  }
  const jitter = _bot.cfg.thinkMs * (0.7 + Math.random() * 0.6);
  _bot.timers.push(setTimeout(_botThinkLoop, jitter));
}

/** 카드 사용 — deck.js onCardUsed와 같은 순서 (에너지 → 진화 카운트 → 대상 → applyCardUse).
 *  사람과 같은 규칙을 지킨다: 같은 카드의 연출이 도는 동안은 다시 못 쓰고, 토템·토네이도는
 *  사람이 놓을 수 있는 칸에만 놓으며, 바위 지옥·토네이도는 덩이(타워)마다 자기 피해·시각으로 들어간다. */
function _botUseCard(act, v) {
  const card  = act.card;
  const style = cardCastStyle(card);
  const shape = style?.shape;
  const slot  = _bot.deck[act.slot];
  if (!slot || card.energyCost > _bot.energy) return;
  // 사람과 같은 잠금 — 같은 카드의 연출이 끝나기 전에는 또 못 쓴다 (board.js castBlocked)
  if (style && style.hitMs > 0 && (_bot.busy[card.id] || 0) > Date.now()) return;

  const targetKey = act.ownSide ? _bot.key : _bot.enemyKey;
  const owner = targetKey === _bot.key ? 'enemy' : 'my';   // AI 자리는 화면에서 'enemy'
  const towersNow = () => window.getGameState()?.[targetKey]?.towers || {};

  // 설치 자리 — 사람과 같은 규칙으로 고른다. 놓을 곳이 없으면 카드를 쓰지 않는다 (에너지도 그대로)
  let place = null;
  if (shape === 'circle' && typeof boardBestTotemTile === 'function') {
    const heal = _botEffectHeal(card.effect);
    const towers = v.gs[targetKey]?.towers || {};
    // 범위에 드는 타워마다 — 채울 수 있는 체력만큼 (가득 차 있어도 조금은 친다: 곧 맞을 수 있다)
    place = boardBestTotemTile(owner, style.radius, pos => {
      const t = towers[pos];
      return t ? Math.min(heal, t.maxHp - t.hp) + 1 : 0;
    });
    if (!place) { _bot.busy[card.id] = Date.now() + 3000; return; }   // 세울 칸이 없다 — 잠시 다른 카드를 본다
  } else if (shape === 'summon') {
    place = botSummonPlace(act.pos, v.gs[_bot.enemyKey]?.towers || {});
    if (!place) { _bot.busy[card.id] = Date.now() + 3000; return; }
  } else if (shape === 'tile' && typeof boardBestTornadoTile === 'function') {
    const towers = v.gs[targetKey]?.towers || {};
    place = boardBestTornadoTile(owner, (pos, dmg) => Math.min(dmg, towers[pos]?.hp || 0));
    if (!place) { _bot.busy[card.id] = Date.now() + 3000; return; }
  }

  _bot.energy -= card.energyCost;

  // 한 장 소모 — 개수가 남으면 슬롯 유지
  slot.count -= 1;
  if (slot.count <= 0) _bot.deck[act.slot] = null;

  // 진화 — 3번 쓰면 진화 카드가 새 카드로 생긴다 (자리가 없으면 가장 값싼 슬롯 대체)
  if (EVOLUTION_MAP[card.id]) {
    const charge = (_bot.charges[card.id] || 0) + 1;
    if (charge >= 3) {
      _bot.charges[card.id] = 0;
      const evolved = { ...CARD_DEFINITIONS[EVOLUTION_MAP[card.id]] };
      if (!_botPlaceCard(evolved)) _botReplaceWorst(evolved);
    } else {
      _bot.charges[card.id] = charge;
    }
    writeEvolutionCharges(_bot.key, _bot.charges);
  }

  if (card.effect?.energyBurst) {
    _bot.burstUntil = v.now + card.effect.energyBurst.ticks * card.effect.energyBurst.interval;
  }

  const after = _bot.deck[act.slot];
  const slotAfter = after ? { cardId: after.card.id, grade: after.card.grade, count: after.count } : null;
  let cardUse = botCardForSide(card, act.ownSide);
  // 칸 범위 카드(지진·붕괴)는 그 타워 칸을 가운데로 놓은 범위에 든 타워만 맞는다
  let positions = botAffectedPositions(card, act.pos);

  // 에너지·덱 칸만 지금 기록 (피해는 덩이·연출마다 따로) — deck.js의 '덩이 단위' 경로와 같다
  const recordUse = () => applyCardUse(_bot.key, act.slot, _bot.energy, targetKey, [],
                                       { ...cardUse, effect: {} }, towersNow(), window.getGameState(), slotAfter);
  const hitOnly = (pos, effect) => applyCardUse(_bot.key, null, null, targetKey, [pos],
                                                { ...cardUse, effect }, towersNow(), window.getGameState(), null);

  // ── 상대 토템 하나 — 듀얼 검은 베고, 톱은 반토막 내고, 바람은 남은 시간 -2초 (타워는 맞지 않는다) ──
  // 연출이 그 칸의 토템을 찾아 상성을 건다 (board.js — 사람이 쓸 때와 같은 '@t' · 톱 점)
  if (act.totem && style) {
    if (typeof totemOnTile === 'function' && !totemOnTile(act.totem.col, act.totem.row)) return;
    const tc = _tileCenter(act.totem.col, act.totem.row);
    const point = _groundToStage(tc.x, tc.y);
    const fxId = style.saw ? 'saw@' + Math.random().toString(36).slice(2, 8) + '@0' : card.cast + '@t';
    _bot.busy[card.id] = Date.now() + (style.saw ? style.hitMs + style.totemCutMs + 400 : style.endMs);
    playCastFx(fxId, owner, 'king', point);
    recordUse();
    return;
  }

  // ── 소환 (그림리퍼) — 사람과 같은 칸 규칙 · 같은 컷씬 ──
  if (shape === 'summon' && place) {
    recordUse();
    unitsSummon(_bot.key, _bot.key === 'p1' ? place.col : 15 - place.col, place.row, act.pos);
    return;
  }

  // ── 침수 — 겨눈 타워 칸을 가운데로 한 4칸 폭 범위. 줄마다 물살 · 다 흐른 뒤 가라앉는 동안 ──
  if (style?.flood && !act.ownSide && BOT_TOWER_TILES[act.pos]) {
    const toP1 = c => (_bot.key === 'p1' ? c : 15 - c);
    const [tc, tr] = BOT_TOWER_TILES[act.pos];
    const R = castAreaRect(style, 15 - tc, tr);                     // AI 시점 (상대 타워가 오른쪽)
    const plan = castFloodPlan(style, R, positions.map(p => ({ pos: p, row: BOT_TOWER_TILES[p][1] })));
    _bot.busy[card.id] = Date.now() + style.endMs;
    // 이 화면에서 AI는 오른쪽 — 범위를 뒤집어 그 가운데 금을 보낸다 (사람이 쓸 때와 같은 범위가 그려진다)
    const hc0 = 15 - R.c1, cols = R.c1 - R.c0 + 1;
    playCastFx(card.cast, owner, act.pos, { x: (hc0 + cols / 2) * TILE, y: (Math.floor((R.r0 + R.r1) / 2) + 0.5) * TILE });
    recordUse();
    plan.shots.forEach(s => setTimeout(() => { if (_botActive()) hitOnly(s.pos, s.effect || { damage: s.damage }); }, s.flyMs));
    if (typeof unitsWriteStrike === 'function') {
      plan.unitStrikes.forEach(us => unitsWriteStrike(_bot.key, us.tiles.map(([c, r, d]) => [toP1(c), r, d]), us.delayMs, us.status));
    }
    return;
  }
  // ── 가시 — 겨눈 타워 칸에 2×2 (이 화면 기준 범위 — 받는 연출과 같은 칸). 솟는 순간 45 · 박힌 채 7 × 4 ──
  if (style?.thorn && !act.ownSide && BOT_TOWER_TILES[act.pos]) {
    const hostToP1 = c => (_bot.enemyKey === 'p1' ? c : 15 - c);
    const [tc, tr] = BOT_TOWER_TILES[act.pos];
    const R = castAreaRect(style, tc, tr);                          // 이 화면(사람 시점) 칸 — _playAreaFx가 그리는 범위
    const inR = BOT_POS.filter(p => { const [pc, pr] = BOT_TOWER_TILES[p]; return pc >= R.c0 && pc <= R.c1 && pr >= R.r0 && pr <= R.r1; });
    const plan = castThornPlan(style, R, inR.map(p => ({ pos: p })));
    _bot.busy[card.id] = Date.now() + style.endMs;
    playCastFx(card.cast, owner, act.pos);
    recordUse();
    plan.shots.forEach(s => setTimeout(() => { if (_botActive()) hitOnly(s.pos, s.effect); }, s.flyMs));
    if (typeof unitsWriteStrike === 'function') {
      plan.unitStrikes.forEach(us => unitsWriteStrike(_bot.key, us.tiles.map(([c, r, d]) => [hostToP1(c), r, d]), us.delayMs, us.status));
    }
    return;
  }
  // ── 불덩이 — 겨눈 타워 칸이 든 2×2 (그 칸의 오른쪽 아래 꼭짓점이 한가운데). 떨어지는 순간 28 · 불길 속 6 × 5 ──
  // ── 폭염   — 겨눈 타워 칸을 가운데로 3×7. 폭발 49 · 불타는 동안 9 × 5 · 이어서 열기(더위) ──
  if ((style?.burn || style?.blast) && !act.ownSide && BOT_TOWER_TILES[act.pos]) {
    const hostToP1 = c => (_bot.enemyKey === 'p1' ? c : 15 - c);
    const [tc, tr] = BOT_TOWER_TILES[act.pos];                      // 이 화면(사람 시점) 칸
    const R = style.burn ? castAreaRect(style, tc + 1, tr + 1) : castAreaRect(style, tc, tr);
    const inR = BOT_POS.filter(p => { const [pc, pr] = BOT_TOWER_TILES[p]; return pc >= R.c0 && pc <= R.c1 && pr >= R.r0 && pr <= R.r1; });
    const targets = inR.filter(p => towersNow()?.[p]?.alive !== false).map(p => ({ pos: p }));
    const plan = style.burn ? castFireballPlan(style, R, targets) : castHeatwavePlan(style, R, targets);
    const point = style.burn ? { x: (R.c0 + 1) * TILE, y: (R.r0 + 1) * TILE }
                             : _tileCenter((R.c0 + R.c1) / 2, (R.r0 + R.r1) / 2);
    _bot.busy[card.id] = Date.now() + (style.burn ? style.flyMs + 600 : style.hitMs + style.burnMs);
    playCastFx(card.cast, owner, act.pos, point);
    recordUse();
    if (style.blast && typeof writeHeatZone === 'function') {
      const a = hostToP1(R.c0), b = hostToP1(R.c1);
      const tm = heatwaveZoneTimes(style), now = gameNow();
      writeHeatZone(_bot.enemyKey, { c0: Math.min(a, b), c1: Math.max(a, b), r0: R.r0, r1: R.r1 },
                    now + tm.from, now + tm.until, style.heatPercent);
    }
    plan.shots.forEach(s => setTimeout(() => { if (_botActive()) hitOnly(s.pos, s.effect); }, s.flyMs));
    if (typeof unitsWriteStrike === 'function') {
      plan.unitStrikes.forEach(us => unitsWriteStrike(_bot.key, us.tiles.map(([c, r, d]) => [hostToP1(c), r, d]), us.delayMs, us.status));
    }
    return;
  }
  // ── 얼음전개 — 겨눈 타워 칸을 가운데로 4×4 (이 화면 기준 범위). 얼어붙는 순간 동결 + 1초마다 12 · 덱 동결 ──
  if (style?.ice && !act.ownSide && BOT_TOWER_TILES[act.pos]) {
    const hostToP1 = c => (_bot.enemyKey === 'p1' ? c : 15 - c);
    const [tc, tr] = BOT_TOWER_TILES[act.pos];
    const R = castAreaRect(style, tc, tr);
    const inR = BOT_POS.filter(p => { const [pc, pr] = BOT_TOWER_TILES[p]; return pc >= R.c0 && pc <= R.c1 && pr >= R.r0 && pr <= R.r1; });
    const targets = inR.filter(p => towersNow()?.[p]?.alive !== false).map(p => ({ pos: p }));
    const plan = castIcePlan(style, R, targets);
    _bot.busy[card.id] = Date.now() + style.hitMs + 600;
    // 짝수 칸 범위 — 가운데 금을 보낸다 (_playAreaFx가 반올림해 같은 범위를 만든다)
    playCastFx(card.cast, owner, act.pos, { x: (R.c0 + style.cols / 2) * TILE, y: (R.r0 + style.rows / 2) * TILE });
    recordUse();
    plan.shots.forEach(s => setTimeout(() => { if (_botActive()) hitOnly(s.pos, s.effect); }, s.flyMs));
    if (typeof unitsWriteStrike === 'function') {
      plan.unitStrikes.forEach(us => unitsWriteStrike(_bot.key, us.tiles.map(([c, r, d]) => [hostToP1(c), r, d]), us.delayMs, us.status));
    }
    return;
  }
  // ── 톱 — 겨눈 타워 앞에서 끝까지(6초) 썬다. 0.5초마다 7 ──
  if (style?.saw && !act.ownSide && BOT_TOWER_TILES[act.pos]) {
    const hostToP1 = c => (_bot.enemyKey === 'p1' ? c : 15 - c);
    const [tc, tr] = BOT_TOWER_TILES[act.pos];
    const sw = style.saw;
    _bot.busy[card.id] = Date.now() + style.endMs;
    // 필드 가운데 줄에서 다가간다 — 위 타워는 아래에서, 아래 타워는 위에서 비스듬히 (사람이 쓸 때와 같은 '방향' 부호)
    const code = tr < 4 ? -3 : tr > 4 ? 3 : 0;
    playCastFx('saw@' + Math.random().toString(36).slice(2, 8) + '@' + code, owner, act.pos);
    recordUse();
    const tiles = [[hostToP1(tc), tr, sw.damage], [hostToP1(tc + 1), tr, sw.damage]];   // 그 타워 칸과 앞 칸
    for (let k = 1; k <= Math.floor(sw.holdMs / sw.tickMs); k++) {
      setTimeout(() => {
        if (!_botActive()) return;
        hitOnly(act.pos, { damage: sw.damage });
        if (typeof unitsWriteStrike === 'function') unitsWriteStrike(_bot.key, tiles, 0);
      }, k * sw.tickMs);
    }
    return;
  }
  // ── 파도 — 상대 진영 맨 앞(사람과 같은 자리)에서 출발 ──
  if (shape === 'wave' && !act.ownSide) {
    const toP1 = c => (_bot.key === 'p1' ? c : 15 - c);
    const c0 = WAVE_START_COL;                                      // 상대 진영 맨 앞 (사람과 같은 자리)
    const plan = castWavePlan(style, c0, p => towersNow()?.[p]?.alive !== false);
    _bot.busy[card.id] = Date.now() + plan.endMs;
    playCastFx(card.cast, owner, 'king', _tileCenter(MAP_COLS - 1 - (c0 + Math.floor(style.cols / 2)), Math.floor(MAP_ROWS / 2)));
    recordUse();
    plan.shots.forEach(s => setTimeout(() => { if (_botActive()) hitOnly(s.pos, { damage: s.damage }); }, s.flyMs));
    if (typeof unitsWriteStrike === 'function') {
      plan.unitStrikes.forEach(us => unitsWriteStrike(_bot.key, us.tiles.map(([c, r, d]) => [toP1(c), r, d]), us.delayMs, us.status));
    }
    return;
  }

  // ── 덩이마다 따로 들어가는 카드 ─────────────────────────
  if (shape === 'throw3') {
    // 바위 지옥 — 부서진 타워 몫은 킹으로 절반 (사람과 같은 castThrow3Shots)
    const shots = castThrow3Shots(style, owner).filter(Boolean);
    if (!shots.length) return;
    _bot.busy[card.id] = Date.now() + style.endMs;
    playCastFx(card.cast, owner, 'king');
    recordUse();
    shots.forEach(shot => setTimeout(() => {
      if (_botActive()) hitOnly(shot.pos, shot.dot ? { damage: shot.damage, dot: shot.dot } : { damage: shot.damage });
    }, shot.flyMs));
    return;
  }
  if (shape === 'tile' && place) {
    // 토네이도 — 놓은 칸에서 닿는 타워마다 거리만큼의 피해
    _bot.busy[card.id] = Date.now() + style.endMs;
    const hitMs = playCastFx(card.cast, owner, 'king', place.point);
    recordUse();
    _botUnitStrike(style, cardUse, act, place, hitMs);
    place.targets.forEach(h => setTimeout(() => { if (_botActive()) hitOnly(h.pos, { damage: h.damage }); }, hitMs));
    return;
  }

  // 토템 — 고른 칸에 서고, 범위 안 타워만 회복. 회복 줄에 칸 표시를 붙인다 (붕괴가 찾아 멈춘다)
  let fxPoint = null;
  if (shape === 'circle' && place) {
    positions = place.positions;
    fxPoint = _tileCenter(place.col, place.row);
    if (cardUse.effect?.hot) {
      cardUse = { ...cardUse, effect: { ...cardUse.effect, hot: { ...cardUse.effect.hot, totem: totemTag(place.col, place.row) } } };
    }
  }

  const apply = () => applyCardUse(_bot.key, act.slot, _bot.energy, targetKey, positions, cardUse,
                                   towersNow(), window.getGameState(), slotAfter);

  // 시전 연출이 있는 카드는 사람이 쓸 때와 똑같이 — 휘두르는 연출 뒤에 피해가 들어간다
  // 사랑의 화살은 '회복이냐'를 연출 id에 붙인다 (board.js _playShotFx)
  const fxId = style?.love && act.ownSide ? castFxId(card.cast, 1) : card.cast;
  const hitMs = playCastFx(fxId, owner, act.pos, fxPoint);
  if (style && hitMs > 0) _bot.busy[card.id] = Date.now() + Math.max(style.endMs, hitMs + 300);
  if (!act.ownSide && style?.shape === 'area') _botUnitStrike(style, cardUse, act, null, hitMs);
  if (hitMs > 0) setTimeout(() => { if (_botActive()) apply(); }, hitMs);
  else apply();   // 지연이 없는 연출(회복 등)은 바로 적용된다
}
