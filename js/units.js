/* ════════════════════════════════════════════════════════════
   소환 유닛 — 그림리퍼

   ── 규칙 (2026-09-30 사용자 요청) ─────────────────────────
   · 카드를 쓰면 두 플레이어(관전자 포함) 모두에게 컷씬이 뜨고, 그동안 게임 시간은 멈춘다.
   · 컷씬이 끝나면 놓은 칸에서 같은 줄의 상대 타워 앞 칸까지 걸어간다 (한 칸에 1.5초).
   · 도착하면 4초마다 낫을 휘둘러 그 타워에 67 피해 — 한 번 벨 때마다 영혼이 하나 쌓인다 (최대 10).
   · 체력 200 (2026-09-30 너프: 300 → 200). 상대가 쓴 공격 카드의 범위(돌 착지 칸·지진 범위·토네이도 길·화살 길 등)에
     들어 있으면 그 피해를 같이 받는다.
   · 쓰러지면 쌓인 영혼 수만큼 유령(kind 'ghost', 체력 60)이 상대 진영 타워 주변(타워 칸 제외) 빈칸에
     하나씩 솟아나 가장 가까운 타워로 떠서 날아간다. 타워에 닿으면 10 피해를 한 번 주고 서서히 사라진다
     (영혼 10 → 유령 10 → 최대 100 피해). 유령도 상대 카드 범위에 맞는다. 유령은 다시 갈라지지 않는다.
   · 움직이는 중에도 상대 카드에 맞는다 — 피해가 들어가는 순간 몸이 걸친 칸(가운데에서 0.65칸 안)이면 맞는다.
   · 목표 타워가 먼저 무너지면 킹 타워로 방향을 바꾼다.
   · 리퍼끼리 만나면 (같은 줄에서 마주 보고 한 칸 안으로 다가오면) 한 칸에 겹치지 않고 이웃한 두 칸에 멈춰 서서
     서로 싸운다 — 4초마다 서로 67씩 베고, 벨 때마다 영혼이 쌓인다. 살아남은 쪽은 다시 제 타워로 걸어간다.
     (결투: leg.foe = 상대 유닛 id, leg.c·r = 선 칸, leg.t = 만난 시각. 만남은 p1 리퍼를 움직이는 화면이
      두 유닛을 한 트랜잭션으로 바꿔 쓴다. 같은 순간의 맞베기는 둘 다 들어간다 — 누가 먼저 처리해도 결과가 같다)

   ── 네트워크가 나쁠 때 (2026-10-01) ─────────────────────────
   · 만남은 leg로 푼 순수 계산(unitDuelMeet)이다 — 만난 시각·칸이 어느 화면에서나 같고, 결투 기록이 늦게 와도
     모든 화면이 예측한 자리에 먼저 세워 둔다(unitDuelPlan). 결투는 양쪽 화면 누구나 연다 (트랜잭션이 한 번만 받는다).
   · 낫·유령 닿기·결투 베기는 넣기 전에 서버 기준으로 확인한다 (_uLegValidAt 트랜잭션) —
     그 시각에 살아 있었고 그 leg가 유효했을 때만. 그래서 한참 늦은 화면이 이미 쓰러진 리퍼나
     결투에 들어가 무효가 된 낫을 넣지 못한다.
   · 결투에서 이긴 뒤 다시 걷는 시각·영혼은 상대가 쓰러진 시각 기준 — 늦게 알아도 영혼이 더 쌓이지 않는다.

   ── 네트워크 ───────────────────────────────────────────────
   DB: gameState/units/{id}
     { owner, kind, hp, maxHp, speed(한 칸 ms), born, split?, spawned?, diedAt?, soulsAtDeath?,
       leg: { c, r, t, target, n, souls }, applied: { 맞은 예약 id: 시각 } }
   좌표는 p1 화면 기준 칸 (열은 p2 화면에서 15-열로 뒤집힌다).
   움직임은 매 프레임 쓰지 않는다 — '이 칸에서 이 시각(게임 시간)에 출발해 이 타워로'(leg)만 두고
   모든 화면이 같은 식으로 계산한다. 그래서 위치·휘두르는 순간·쌓인 영혼이 모든 화면에서 같다.
   · 낫 한 번 = 예약 피해와 같은 '정확히 한 번' (applyCardUse의 hitId = 유닛_leg번호_몇번째).
     주인 화면이 제때 넣고, 맞는 쪽 화면이 1.5초 늦게 한 번 더 부른다 — 이미 들어갔으면 건너뛴다.
   · 방향 전환·분열·정리는 주인 화면(또는 AI를 돌리는 화면)이 쓴다.
   · 상대 카드에 맞는 것은 pendingHits의 '유닛만' 줄 (sync.js) — 시각(applyAt)의 위치로 판정해
     두 화면이 같은 결과를 얻는다. 유닛의 applied 표시로 두 번 깎이지 않는다.
════════════════════════════════════════════════════════════ */

// 체력 · 피해 · 낫 간격 · 영혼 수 · 유령 피해는 카드(cards.js grim_reaper.effect.summon)가 원본이다
const _REAPER_CARD = CARD_DEFINITIONS.grim_reaper.effect.summon;
const REAPER = {
  hp:           _REAPER_CARD.hp,          // 2026-09-30 너프: 300 → 200
  damage:       _REAPER_CARD.damage,
  swingMs:      _REAPER_CARD.interval,    // 낫 간격 (2026-09-30 너프: 2초 → 4초)
  maxSouls:     _REAPER_CARD.maxSouls,    // 영혼은 10까지만 쌓인다 → 유령 최대 10 (최대 100 피해)
  firstSwingMs: 650,    // 도착하고 첫 낫까지 (들어 올리는 모습이 보이게)
  swingAnimMs:  900,    // 휘두르는 모습 전체 — 피해는 그 한가운데(내리치는 순간)
  walkMs:       1500,   // 한 칸 걷는 데
  runMs:        900,    // 영혼에서 솟은 리퍼는 달린다
  emergeMs:     700,    // 컷씬 뒤 필드에 나타나는 시간 (이 뒤부터 걷는다)
  riseMs:       1000,   // 영혼에서 솟아오르는 시간
  size:         56,     // 모델 1 → 맵 px (키 약 105px — 옆 타워 몸통 정도)
  victimLagMs:  1500,   // 맞는 쪽 화면이 뒤늦게 한 번 더 부르는 여유
  keepDeadMs:   4000,   // 쓰러진 기록을 지우기까지
};
// 유령 — 쓰러진 리퍼의 영혼에서 솟는다
const GHOST = {
  hp:      60,
  damage:  _REAPER_CARD.ghostDamage,     // 타워에 닿으면 한 번
  fadeMs:  1400,   // 닿은 뒤 타워 쪽으로 스며들며 사라지는 시간
  size:    48,
};
const UNIT_TOWER_TILES = { left: [4, 2], king: [3, 4], right: [4, 6] };   // 옆 타워가 킹보다 한 칸 앞 (2026-10-01) · 2026-10-02 두 칸 앞으로
const UNIT_LANES = { 2: 'left', 4: 'king', 6: 'right' };   // 줄 → 그 줄의 타워

let _uGs = null;
let _uRoom = null;          // 'rooms/{code}/gameState'
let _uView = 'p1';          // 이 화면의 시점 (관전자는 p1)
let _uLocal = null;         // 내 자리 (관전자는 null)
const _uVis = {};           // id → 그리는 것들
const _uSwingDone = new Set();
const _uBusy = {};          // id → 방향 전환·분열을 쓰는 중
const _uCutSeen = new Set();
const _uGone = new Set();   // 쓰러지는 모습까지 다 그린 유닛 (DB 기록이 지워지기 전에도 다시 그리지 않는다)
let _uTimer = 0;
let _uHalted = false;       // 경기 끝 — 움직임·낫질·컷씬을 모두 멈춘 채 그대로 둔다

// ── 좌표 ──────────────────────────────────────────────────
function _uEnemy(p) { return p === 'p1' ? 'p2' : 'p1'; }
function unitTowerTile(player, pos) {
  const [c, r] = UNIT_TOWER_TILES[pos];
  return player === 'p1' ? [c, r] : [15 - c, r];
}
function _uIsTowerTile(c, r) {
  return ['p1', 'p2'].some(p => Object.keys(UNIT_TOWER_TILES).some(pos => {
    const [tc, tr] = unitTowerTile(p, pos);
    return tc === c && tr === r;
  }));
}
/** p1 기준 열 ↔ 이 화면 열 (같은 식이 양쪽으로 쓰인다) */
function unitViewCol(c) { return _uView === 'p2' ? 15 - c : c; }

// ── 움직임 (순수 계산 — 모든 화면이 같은 값을 얻는다) ───────────
/** 목표 타워 옆 빈칸 중 출발점에서 가장 가까운 칸 — 같은 줄로 걸어오면 바로 앞 칸 */
function unitStopTile(owner, target, fromC, fromR) {
  const [tc, tr] = unitTowerTile(_uEnemy(owner), target);
  let best = null, bd = Infinity;
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
    if (!dc && !dr) continue;
    const c = tc + dc, r = tr + dr;
    if (c < 0 || c > 15 || r < 0 || r > 8 || _uIsTowerTile(c, r)) continue;
    const d = Math.hypot(c - fromC, r - fromR) + (dr ? 0.01 : 0);   // 같은 거리면 같은 줄
    if (d < bd) { bd = d; best = [c, r]; }
  }
  return best || [tc - 1, tr];
}

// ── 기절 · 둔화 (2026-10-01) ─────────────────────────────────
// 침수에 든 유닛은 물이 빠질 때까지 기절(걸음·낫 모두 멈춤), 파도에 닿은 유닛은 잠깐 둔화(절반 빠르기).
// leg.holds = 'a,b,k;…' — 게임 시각 a~b 동안 그 유닛의 시계가 k배로 흐른다 (기절 0, 둔화 0.5).
// 걸음·낫은 모두 이 '유닛 시계'로 센다 — 모든 화면이 같은 leg로 같은 자리·같은 낫 시각을 얻는다.
const _uHoldCache = new Map();
function _uHolds(L) {
  const s = L?.holds;
  if (!s) return [];
  let v = _uHoldCache.get(s);
  if (!v) {
    v = String(s).split(';').map(p => p.split(',').map(Number))
      .filter(([a, b, k]) => Number.isFinite(a) && b > a && k >= 0 && k < 1)
      .map(([a, b, k]) => ({ a, b, k })).sort((x, y) => x.a - y.a);
    if (_uHoldCache.size > 200) _uHoldCache.clear();
    _uHoldCache.set(s, v);
  }
  return v;
}
function _uHoldsEncode(list) {
  return list.map(h => `${Math.round(h.a)},${Math.round(h.b)},${Math.round(h.k * 100) / 100}`).join(';');
}

/**
 * 구간 하나를 더한다 — 겹치면 더 느린 쪽(k가 작은 쪽). legT 전에 끝난 구간은 버린다.
 * @returns {string} 새 leg.holds
 */
function unitHoldAdd(holdsStr, a, b, k, legT) {
  const list = _uHolds({ holds: holdsStr }).concat([{ a, b, k }]);
  const pts = [...new Set(list.flatMap(h => [h.a, h.b]))].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    if (e <= legT) continue;
    const ks = list.filter(h => h.a <= s && h.b >= e).map(h => h.k);
    if (!ks.length) continue;
    const kk = Math.min(...ks);
    const last = out[out.length - 1];
    if (last && last.b === s && last.k === kk) last.b = e;
    else out.push({ a: s, b: e, k: kk });
  }
  return _uHoldsEncode(out.slice(-12));
}

/** 새 leg(t부터)로 넘겨줄 구간 — t 뒤에 남은 부분만 */
function _uHoldsCarry(L, t) {
  const rest = _uHolds(L).filter(h => h.b > t).map(h => ({ a: Math.max(h.a, t), b: h.b, k: h.k }));
  return rest.length ? { holds: _uHoldsEncode(rest) } : {};
}

/** leg.t부터 t까지 그 유닛의 시계로 흐른 시간 */
function unitClock(u, t) {
  const L = u.leg;
  let e = t - L.t;
  if (e <= 0) return e;
  for (const h of _uHolds(L)) {
    const o = Math.min(t, h.b) - Math.max(L.t, h.a);
    if (o > 0) e -= o * (1 - h.k);
  }
  return e;
}

/** 유닛 시계가 e만큼 흐르는 게임 시각 (unitClock의 거꾸로) */
function unitClockAt(u, e) {
  const L = u.leg;
  if (e <= 0) return L.t + e;
  let t = L.t, acc = 0;
  for (const h of _uHolds(L)) {
    if (h.b <= t) continue;
    const a = Math.max(h.a, t);
    if (acc + (a - t) >= e) return t + (e - acc);
    acc += a - t;
    const seg = (h.b - a) * h.k;
    if (h.k > 0 && acc + seg >= e) return a + (e - acc) / h.k;
    acc += seg;
    t = h.b;
  }
  return t + (e - acc);
}

/** t에 기절·둔화 중인가 — 'stun' | 'slow' | null (그리기용) */
function unitStatusAt(u, t) {
  let k = 1;
  for (const h of _uHolds(u?.leg)) if (h.a <= t && t < h.b) k = Math.min(k, h.k);
  return k <= 0 ? 'stun' : k < 1 ? 'slow' : null;
}

function unitLeg(u) {
  const L = u.leg;
  if (L.foe) return { stop: [L.c, L.r], dist: 0, span: 0, arriveAt: L.t, firstSwing: unitClockAt(u, REAPER.firstSwingMs) };
  const stop = unitStopTile(u.owner, L.target, L.c, L.r);
  const dist = Math.hypot(stop[0] - L.c, stop[1] - L.r);
  const span = dist * (u.speed || REAPER.walkMs);
  return { stop, dist, span, arriveAt: unitClockAt(u, span), firstSwing: unitClockAt(u, span + REAPER.firstSwingMs) };
}

/** t(게임 시간)의 자리 */
function unitPosAt(u, t) {
  const L = u.leg, g = unitLeg(u);
  const ck = unitClock(u, t);
  const k = g.span <= 0 ? 1 : Math.max(0, Math.min(1, ck / g.span));
  return {
    c: L.c + (g.stop[0] - L.c) * k,
    r: L.r + (g.stop[1] - L.r) * k,
    arrived: k >= 1,
    walked: Math.max(0, ck / (u.speed || REAPER.walkMs)),
    leg: g,
  };
}

/** 이 leg에서 t까지 휘두른 횟수 */
function unitSwingsBy(u, t) {
  if (u.kind === 'ghost') return 0;
  const g = unitLeg(u);
  const F = g.span + REAPER.firstSwingMs, ck = unitClock(u, t);
  return ck < F ? 0 : Math.floor((ck - F) / REAPER.swingMs) + 1;
}

/** 이 leg의 k번째(0부터) 낫이 내리치는 게임 시각 */
function unitSwingAt(u, k) {
  return unitClockAt(u, unitLeg(u).span + REAPER.firstSwingMs + k * REAPER.swingMs);
}

/**
 * t에 휘두르는 모습 — 지금 가장 가까운 낫(k)과 그 내리치는 시각(S), 휘두르기 진행(ph 0~1, 아니면 null),
 * 다음 낫까지 남은 시간(next, 유닛 시계 기준 ms). 예측 결투(기록 전)는 기절·둔화 없이 게임 시각 그대로.
 */
function _uSwingPhase(u, g, t) {
  const A = REAPER.swingAnimMs, W = REAPER.swingMs;
  if (g.pred) {
    const k = Math.floor((t - g.firstSwing + A * 0.5) / W);
    const S = g.firstSwing + k * W;
    const ph = (t - (S - A * 0.5)) / A;
    const kn = Math.max(0, Math.floor((t - g.firstSwing) / W) + 1);
    return { k, S, ph: ph >= 0 && ph <= 1 ? ph : null, next: g.firstSwing + kn * W - t, first: g.firstSwing };
  }
  const F = g.span + REAPER.firstSwingMs, ck = unitClock(u, t);
  const k = Math.floor((ck - F + A * 0.5) / W);
  const Sc = F + k * W;
  const ph = (ck - (Sc - A * 0.5)) / A;
  const kn = Math.max(0, Math.floor((ck - F) / W) + 1);
  return { k, S: unitClockAt(u, Sc), ph: ph >= 0 && ph <= 1 ? ph : null, next: F + kn * W - ck, first: g.firstSwing };
}

/** t까지 쌓인 영혼 */
function unitSoulsAt(u, t) {
  const end = u.diedAt != null ? Math.min(t, u.diedAt - 1) : t;
  return Math.min(REAPER.maxSouls, (u.leg.souls || 0) + unitSwingsBy(u, end));
}

// ── 결투 (순수 계산 — 모든 화면이 같은 값을 얻는다) ─────────────
/**
 * p1 리퍼 a와 p2 리퍼 b가 만나는 가장 이른 게임 시각과 선 칸. 둘 다 같은 줄을 곧게 걸을 때만.
 * p1은 +열, p2는 -열로 걸어서 둘 사이(b-a)는 줄기만 한다 → 한 칸(1.0) 이하가 되는 첫 순간을 이분법으로 찾는다.
 * @returns {{t:number, ca:number, cb:number, r:number}|null}
 */
function unitDuelMeet(a, b) {
  const ga = unitLeg(a), gb = unitLeg(b);
  if (ga.stop[1] !== a.leg.r || gb.stop[1] !== b.leg.r || a.leg.r !== b.leg.r) return null;
  const gap = t => unitPosAt(b, t).c - unitPosAt(a, t).c;
  const T0 = Math.max(a.leg.t, b.leg.t);
  const g0 = gap(T0);
  if (g0 < -0.6) return null;                                          // 이미 서로 지나쳐 멀어진다
  let t = T0;
  if (g0 > 1) {
    const T1 = Math.max(ga.arriveAt, gb.arriveAt);
    if (gap(T1) > 1) return null;                                      // 끝까지 가도 안 만난다
    let lo = T0, hi = T1;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (gap(m) > 1) lo = m; else hi = m; }
    t = Math.ceil(hi);
  }
  const pa = unitPosAt(a, t), pb = unitPosAt(b, t);
  const lo = Math.min(gb.stop[0], ga.stop[0]), hi = Math.max(gb.stop[0], ga.stop[0]);
  const ca = Math.max(lo, Math.min(hi - 1, Math.floor((pa.c + pb.c) / 2)));
  return { t, ca, cb: ca + 1, r: a.leg.r };
}

/**
 * 아직 결투 기록이 없는 리퍼들의 만남 예측 — id → { foe, c, r, t }. 먼저 만나는 짝부터, 한 리퍼는 한 짝만.
 * 결투 기록이 늦게 와도 모든 화면이 이 자리에 먼저 세워 둔다 (그리기 · 범위 판정 · 타워 낫 멈춤).
 */
let _uPlanSrc = null, _uPlanVal = {};
function unitDuelPlan(units) {
  if (units === _uPlanSrc) return _uPlanVal;
  const live = Object.entries(units || {}).filter(([, u]) => u?.leg && u.kind !== 'ghost' && u.diedAt == null && !u.leg.foe);
  const pairs = [];
  for (const [aid, a] of live) {
    if (a.owner !== 'p1') continue;
    for (const [bid, b] of live) {
      if (b.owner !== 'p2') continue;
      const m = unitDuelMeet(a, b);
      if (m) pairs.push({ aid, bid, ...m });
    }
  }
  pairs.sort((x, y) => x.t - y.t || (x.aid < y.aid ? -1 : x.aid > y.aid ? 1 : 0) || (x.bid < y.bid ? -1 : x.bid > y.bid ? 1 : 0));
  const plan = {};
  for (const p of pairs) {
    if (plan[p.aid] || plan[p.bid]) continue;
    plan[p.aid] = { foe: p.bid, c: p.ca, r: p.r, t: p.t };
    plan[p.bid] = { foe: p.aid, c: p.cb, r: p.r, t: p.t };
  }
  _uPlanSrc = units;
  _uPlanVal = plan;
  return plan;
}

/** t의 자리 — 결투가 예측됐으면 (기록이 아직 안 왔어도) 그 칸에 서 있다 */
function _uPosAt(id, u, t, plan) {
  const d = !u.leg.foe && plan?.[id];
  if (d && t >= d.t) {
    return { c: d.c, r: d.r, arrived: true, walked: 0, duel: d,
             leg: { stop: [d.c, d.r], dist: 0, span: 0, arriveAt: d.t, firstSwing: d.t + REAPER.firstSwingMs, pred: true } };
  }
  return unitPosAt(u, t);
}

/** 서버 기준 확인 — n번째 leg의 at 시각에 살아 있었고, 그 leg가 아직(또는 그 시각까지) 유효했나 */
function _uLegValidAt(cur, n, at) {
  if (!cur?.leg) return false;
  const cn = cur.leg.n || 0;
  if (cn !== n && !(cn === n + 1 && at < cur.leg.t)) return false;   // 그 뒤 길이 바뀌었다 (방향 전환·결투)
  return cur.diedAt == null || cur.diedAt >= at;                     // 그 시각엔 살아 있었다 (같은 순간은 인정)
}

/**
 * 그 유닛의 행동을 서버 값으로 확인한다. 값은 바꾸지 않는다 — 같은 값을 돌려주는 트랜잭션이라
 * 이 화면에 남은 값이 낡았으면 서버가 거절하고 최신 값으로 다시 확인한다.
 * @returns {Promise<boolean>}
 */
function _uVerify(id, n, at) {
  return db.ref(`${_uRoom}/units/${id}`).transaction(cur => {
    if (cur === null) return null;                                     // 서버 값을 받을 때까지 (정말 없으면 아무것도 안 쓴다)
    return _uLegValidAt(cur, n, at) ? cur : undefined;
  }, undefined, false).then(r => r.committed && r.snapshot.exists() && _uLegValidAt(r.snapshot.val(), n, at));
}

// ── 소환 규칙 (이 화면 기준 칸) ──────────────────────────────
/**
 * 이 칸에 소환할 수 있으면 걸어갈 목표 타워 이름, 아니면 null.
 * 내 진영(강 앞까지)이고, 상대 타워가 앞에 있는 줄이며, 그 줄의 내 타워보다 앞(상대 쪽)이어야 한다.
 * 타워 칸과 내 타워 뒤쪽은 안 된다.
 * 처음엔 옆 타워 줄(2·6행)에만 놓는다. 상대 옆 타워가 둘 다 무너지면 그때부터 킹 줄(4행)에도 놓는다 (2026-10-01).
 */
function unitSummonTarget(col, row, towersEnemy) {
  const pos = UNIT_LANES[row];
  if (!pos) return null;
  if (pos === 'king') {
    const sidesDown = !!towersEnemy && ['left', 'right'].every(p => towersEnemy[p]?.alive === false);
    if (!sidesDown) return null;                                       // 아직 옆 타워가 서 있다
  }
  if (towersEnemy && towersEnemy[pos] && towersEnemy[pos].alive === false) return null;   // 앞에 설 타워가 없다
  const myCol = UNIT_TOWER_TILES[pos][0];
  if (col <= myCol || col > 6) return null;
  return pos;
}

// ── 상태 수신 ────────────────────────────────────────────────
function unitsInit(roomCode, localKey) {
  _uRoom = `rooms/${roomCode}/gameState`;
  _uLocal = localKey || null;
  _uView = localKey || 'p1';
  _uSwingDone.clear();
  _uCutSeen.clear();
  _uGone.clear();
  _uHalted = false;
  clearInterval(_uTimer);
  _uTimer = setInterval(_uDrive, 120);
  if (typeof towers3dAddStep === 'function') towers3dAddStep(_uStep);
}

/**
 * 경기가 끝났다 (킹 붕괴 · 시간 종료 · 기권) — 리퍼를 그 자리에 굳힌다.
 * 낫질(자세 계산 · 낫 꼬리 · 베기 연출), 걷기, 체력 막대, DB 쓰기, 컷씬을 모두 멈춰
 * 타워가 무너지는 종료 연출이 버벅이지 않게 한다.
 */
function unitsHalt() {
  if (_uHalted) return;
  _uHalted = true;
  clearInterval(_uTimer);
  _uTimer = 0;
  if (typeof reaperCutsceneStop === 'function') reaperCutsceneStop();
  Object.values(_uVis).forEach(v => {
    if (v.trail) v.trail.visible = false;
    if (v.hud) v.hud.style.display = 'none';
    if (v.cd) v.cd.style.display = 'none';
    reaperPose(v.group, { t: 0, walk: null, swing: null });      // 휘두르던 중이면 선 자세로
  });
  if (typeof towers3dInvalidate === 'function') towers3dInvalidate();
}

/** board.js boardUpdateState에서 매번 불린다 (플레이어·관전자 모두) */
function unitsOnState(gs) {
  _uGs = gs;
  if (typeof gamePauseSet === 'function') gamePauseSet(gs?.pauses);
  if (_uHalted) return;
  // 새 컷씬
  Object.entries(gs?.pauses || {}).forEach(([id, p]) => {
    if (!p || _uCutSeen.has(id)) return;
    _uCutSeen.add(id);
    _uPlayCut(p);
  });
}

function _uPlayCut(p) {
  const left = p.at + p.dur - serverNow();
  if (left < 300 || typeof reaperCutscene !== 'function') return;
  if (typeof cancelStickyDrag === 'function') cancelStickyDrag();   // 들고 있던 카드를 놓는다
  const name = typeof matchPlayerName === 'function' ? matchPlayerName(p.owner) : '';
  // 소환한 칸 (소환한 사람 시점 — 자기 타워가 왼쪽) · 살아 있는 타워 — 컷씬이 필드와 같은 배치로 세운다
  const u = _uGs?.units?.[p.unit];
  const tile = u?.leg ? { col: p.owner === 'p1' ? u.leg.c : 15 - u.leg.c, row: u.leg.r, target: u.leg.target } : null;
  const towers = _uGs?.[p.owner]?.towers || {};
  const alive = Object.fromEntries(Object.keys(UNIT_TOWER_TILES).map(k => [k, towers[k]?.alive !== false]));
  reaperCutscene({ mine: p.owner === _uView, name, leftMs: left, tile, alive, onEnd: () => towers3dInvalidate?.() });
}

// ── 소환 (카드 사용) ────────────────────────────────────────
/**
 * 리퍼를 놓는다. 컷씬 멈춤과 유닛을 한 번에 쓴다 — 둘 중 하나만 들어가는 일이 없다.
 * @param {'p1'|'p2'} owner
 * @param {number} c,r  p1 기준 칸
 * @param {string} target 걸어갈 타워
 */
function unitsSummon(owner, c, r, target) {
  if (!_uRoom) return Promise.resolve();
  const at  = serverNow();
  const now = gameNow();
  const id  = 'r' + uniqueId();
  const pid = 'c' + uniqueId();
  const unit = {
    owner, kind: 'reaper', hp: REAPER.hp, maxHp: REAPER.hp, speed: REAPER.walkMs, born: now,
    leg: { c, r, t: now + REAPER.emergeMs, target, n: 0, souls: 0 },
  };
  const pause = { at, dur: REAPER_CUT_MS, owner, unit: id };
  return db.ref(_uRoom).update({ [`units/${id}`]: unit, [`pauses/${pid}`]: pause })
    .catch(err => console.error('리퍼 소환 실패:', err));
}

// ── 주인·맞는 쪽 화면이 하는 일 ──────────────────────────────
/** 이 화면이 그 편을 대신 움직이는가 (나, 또는 이 화면이 돌리는 AI) */
function _uDrives(player) {
  return !!player && (player === _uLocal || player === window.botPlayerKey);
}

function _uDrive() {
  const gs = _uGs;
  if (!gs?.units || _uHalted || window.matchInputLocked || gs.winner) return;
  const now = gameNow();
  Object.entries(gs.units).forEach(([id, u]) => {
    if (!u?.leg) return;
    const drive  = _uDrives(u.owner);
    const victim = _uDrives(_uEnemy(u.owner));
    if (!drive && !victim) return;

    if (u.diedAt != null) {
      // 쓰러진 순간과 같은 때의 맞베기는 들어간다 (결투에서 둘이 동시에 쓰러질 수 있다 — 처리 순서와 상관없이)
      if (u.leg.foe) _uSwings(id, u, Math.min(now - (drive ? 0 : REAPER.victimLagMs), u.diedAt), drive);
      if (drive) { _uSplit(id, u); _uForget(id, u, now); }
      return;
    }
    // 결투 상대가 쓰러졌거나 없어졌다 — 다시 제 타워로 (상대가 쓰러진 시각 기준)
    if (u.leg.foe) {
      const foe = gs.units[u.leg.foe];
      if (drive && (!foe || foe.diedAt != null)) { _uResume(id, u, now, foe?.diedAt); return; }
    }
    // 목표가 무너졌으면 킹으로 (유령은 닿기 전까지만)
    const ghost = u.kind === 'ghost';
    const arriveAt = unitLeg(u).arriveAt;
    if (drive && !u.leg.foe && !unitDuelPlan(gs.units)[id] && !(ghost && now >= arriveAt)) {
      const tgt = gs[_uEnemy(u.owner)]?.towers?.[u.leg.target];
      if (tgt && tgt.alive === false && u.leg.target !== 'king') { _uRetarget(id, u, now); return; }
    }
    // 유령 — 닿는 순간 한 번 (주인은 제때, 맞는 쪽은 조금 늦게) · 다 사라지면 기록을 지운다
    if (ghost) {
      if (drive && u.burnFrom) _uBurnStep(id, u, now);
      const lag = drive ? 0 : REAPER.victimLagMs;
      const hitId = `${id}_${u.leg.n || 0}_touch`;
      if (now - lag >= arriveAt && now - arriveAt < 30000 && !_uSwingDone.has(hitId)) {
        _uSwingDone.add(hitId);
        _uGhostTouch(id, u, hitId, arriveAt);
      }
      if (drive && now - arriveAt > GHOST.fadeMs + REAPER.keepDeadMs) _uForgetNow(id);
      return;
    }
    // 화상 — 유닛 주인 화면이 넣는다 (물에 닿으면 꺼진다)
    if (drive && u.burnFrom) _uBurnStep(id, u, now);
    // 낫 — 주인은 제때, 맞는 쪽은 조금 늦게 (이미 들어갔으면 건너뛴다)
    _uSwings(id, u, now - (drive ? 0 : REAPER.victimLagMs), drive);
  });
  // 리퍼끼리 만났나 — 어느 쪽 화면이든 결투를 연다 (한 번만 받아들여진다)
  _uDuelScan(gs, now);
}

/** t까지 휘두른 낫을 (아직 안 들어간 것만) 넣는다 */
function _uSwings(id, u, t, drive) {
  const count = unitSwingsBy(u, t);
  const now = gameNow();
  const n = u.leg.n || 0;
  // 곧 결투에 들어가는 리퍼 — 만나는 순간부터의 타워 낫은 없다 (결투 기록이 늦게 와도)
  const duel = !u.leg.foe && unitDuelPlan(_uGs?.units)[id];
  for (let k = 0; k < count; k++) {
    const at = unitSwingAt(u, k);                                     // 기절·둔화가 있으면 그만큼 늦다
    if (duel && at >= duel.t) break;
    if (at < now - 30000) continue;                                   // 아주 오래된 것은 이미 처리됐다
    const hitId = `${id}_${n}_${k}`;
    if (_uSwingDone.has(hitId)) continue;
    _uSwingDone.add(hitId);
    if (u.leg.foe) _uHitUnit(id, n, u.leg.foe, REAPER.damage, hitId, at);
    else _uSwing(id, u, n, at, hitId);
  }
}

/**
 * 결투 — 같은 줄의 상대 리퍼와 한 칸 안으로 가까워지면 둘을 이웃한 두 칸에 세운다.
 * 모든 계산은 leg(게임 시간)로 하므로 누가 언제 불러도 같은 자리가 나온다.
 */
function _uDuelScan(gs, now) {
  if (!_uDrives('p1') && !_uDrives('p2')) return;                     // 관전자는 쓰지 않는다
  const plan = unitDuelPlan(gs.units);
  Object.entries(plan).forEach(([aid, d]) => {
    const a = gs.units[aid];
    if (!a || a.owner !== 'p1' || d.t > now) return;
    const bid = d.foe, b = gs.units[bid];
    if (b && plan[bid]) _uDuelStart(aid, a, bid, b, d.c, plan[bid].c, d.r, d.t);
  });
}

/** 결투를 연다 — 만난 시각(meetT)·칸은 예측 그대로라 누가 언제 써도 같은 기록이 된다 */
function _uDuelStart(aid, a, bid, b, ca, cb, r, meetT) {
  const key = 'duel_' + aid + '_' + bid;
  if (_uBusy[key]) return;
  _uBusy[key] = true;
  const na = a.leg.n || 0, nb = b.leg.n || 0;
  const sa = unitSoulsAt(a, meetT), sb = unitSoulsAt(b, meetT);
  db.ref(`${_uRoom}/units`).transaction(units => {
    if (units === null) return null;                                   // 서버 값을 받을 때까지
    const A = units[aid], B = units[bid];
    if (!A || !B || A.diedAt != null || B.diedAt != null) return;   // 그사이 바뀌었다 — 다음에 다시 본다
    if ((A.leg.n || 0) !== na || (B.leg.n || 0) !== nb || A.leg.foe || B.leg.foe) return;
    A.leg = { c: ca, r, t: meetT, target: A.leg.target, n: na + 1, souls: sa, foe: bid, ..._uHoldsCarry(A.leg, meetT) };
    B.leg = { c: cb, r, t: meetT, target: B.leg.target, n: nb + 1, souls: sb, foe: aid, ..._uHoldsCarry(B.leg, meetT) };
    return units;
  }).catch(err => console.warn('리퍼 결투 시작 실패:', err))
    .finally(() => { delete _uBusy[key]; });
}

/** 결투에서 이겼다 — 선 칸에서 다시 제 타워로 (목표가 무너졌으면 킹으로) */
function _uResume(id, u, now, foeDiedAt) {
  if (_uBusy[id]) return;
  _uBusy[id] = true;
  const n = u.leg.n || 0;
  // 상대가 쓰러진 순간까지 벤 것만 영혼 — 늦게 알아챈 동안 헛손질한 낫은 세지 않는다.
  // 다시 걷는 시각도 그 순간 기준 (잠깐 숨을 고른 뒤) — 어느 화면에서 늦게 써도 같은 자리다
  const end = foeDiedAt != null ? Math.min(now, foeDiedAt) : now;
  const souls = unitSoulsAt(u, end);
  const startAt = foeDiedAt != null ? foeDiedAt + 400 : now;
  const tgt = _uGs?.[_uEnemy(u.owner)]?.towers?.[u.leg.target];
  const target = tgt && tgt.alive === false ? 'king' : u.leg.target;
  db.ref(`${_uRoom}/units/${id}`).transaction(cur => {
    if (!cur || cur.diedAt != null || !cur.leg || (cur.leg.n || 0) !== n || !cur.leg.foe) return;
    cur.leg = { c: cur.leg.c, r: cur.leg.r, t: startAt, target, n: n + 1, souls, ..._uHoldsCarry(cur.leg, startAt) };
    return cur;
  }).catch(err => console.warn('리퍼 결투 뒤 출발 실패:', err))
    .finally(() => { delete _uBusy[id]; });
}

/**
 * 결투의 낫 한 번 — 상대 유닛 체력을 깎는다. 유닛의 applied로 정확히 한 번.
 * 같은 순간(at)에 쓰러진 상대에게는 들어간다 (맞베기) — 그보다 먼저 쓰러졌으면 들어가지 않는다.
 */
function _uHitUnit(attackerId, n, foeId, dmg, hitId, at) {
  // 벤 쪽과 맞는 쪽을 함께 서버 값으로 본다 — 벤 쪽이 그 시각에 이미 쓰러졌으면(늦게 안 화면) 들어가지 않는다
  return db.ref(`${_uRoom}/units`).transaction(units => {
    if (units === null) return null;                                   // 서버 값을 받을 때까지
    const A = units[attackerId], cur = units[foeId];
    if (!_uLegValidAt(A, n, at) || !cur || !cur.leg) return;
    if (cur.applied && cur.applied[hitId]) return;
    if (cur.diedAt != null && cur.diedAt < at) return;
    cur.applied = { ...(cur.applied || {}), [hitId]: at };
    if (cur.diedAt == null) {                                         // 같은 순간 이미 쓰러졌으면 표시만
      cur.hp = Math.max(0, (cur.hp || 0) - dmg);
      if (cur.hp <= 0) {
        cur.diedAt = at;
        cur.soulsAtDeath = unitSoulsAt({ ...cur, diedAt: null }, at - 1);
      }
    }
    return units;
  }).catch(err => { console.warn('결투 낫 실패 — 다시 시도:', err); _uSwingDone.delete(hitId); });
}

/**
 * 타워에 피해 — 먼저 서버 값으로 '그 시각에 살아 있었고 그 길이 유효했나'를 확인하고 넣는다.
 * 확인에서 떨어지면(이미 쓰러짐·결투로 무효) 넣지 않고 다시 시도하지도 않는다. 통신 오류면 다음에 다시.
 */
function _uTowerHit(id, u, n, at, hitId, dmg, what) {
  const enemy = _uEnemy(u.owner);
  const target = u.leg.target;
  const card = { id: 'grim_reaper', type: 'attack', effect: { damage: dmg } };
  _uVerify(id, n, at)
    .then(ok => {
      if (!ok) return;
      const gs = _uGs;
      return applyCardUse(u.owner, null, null, enemy, [target], card, gs?.[enemy]?.towers || {}, gs, null, hitId);
    })
    .catch(err => { console.warn(what + ' 실패 — 다시 시도:', err); _uSwingDone.delete(hitId); });
}

function _uGhostTouch(id, u, hitId, at) {
  _uTowerHit(id, u, u.leg.n || 0, at, hitId, GHOST.damage, '유령 공격');
}

function _uSwing(id, u, n, at, hitId) {
  _uTowerHit(id, u, n, at, hitId, REAPER.damage, '리퍼 공격');
}

function _uRetarget(id, u, now) {
  if (_uBusy[id]) return;
  _uBusy[id] = true;
  const p = unitPosAt(u, now);
  const souls = unitSoulsAt(u, now);
  const n = u.leg.n || 0;
  db.ref(`${_uRoom}/units/${id}`).transaction(cur => {
    if (!cur || cur.diedAt != null || !cur.leg || (cur.leg.n || 0) !== n || cur.leg.foe) return;   // 이미 바뀌었다
    cur.leg = { c: Math.round(p.c * 100) / 100, r: Math.round(p.r * 100) / 100, t: now, target: 'king', n: n + 1, souls,
                ..._uHoldsCarry(cur.leg, now) };
    return cur;
  }).catch(err => console.warn('리퍼 방향 전환 실패:', err))
    .finally(() => { delete _uBusy[id]; });
}

/** 영혼에서 솟을 칸 — 상대 진영 타워 주변(두 칸 안) 빈칸, 모든 화면이 같은 순서로 섞는다 */
function unitSplitTiles(owner, gs, seedStr, n) {
  const enemy = _uEnemy(owner);
  const towers = gs?.[enemy]?.towers || {};
  const set = new Map();
  Object.keys(UNIT_TOWER_TILES).forEach(pos => {
    if (towers[pos]?.alive === false) return;
    const [tc, tr] = unitTowerTile(enemy, pos);
    for (let dc = -2; dc <= 2; dc++) for (let dr = -2; dr <= 2; dr++) {
      const c = tc + dc, r = tr + dr;
      if (c < 0 || c > 15 || r < 0 || r > 8 || _uIsTowerTile(c, r)) continue;
      set.set(c + ',' + r, [c, r]);
    }
  });
  const tiles = [...set.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let h = 2166136261;
  for (const ch of seedStr) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rand = _rpRand(h);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles.slice(0, n);
}

/** 가장 가까운 살아 있는 상대 타워 */
function _uNearestTarget(owner, gs, c, r) {
  const enemy = _uEnemy(owner);
  let best = 'king', bd = Infinity;
  Object.keys(UNIT_TOWER_TILES).forEach(pos => {
    if (gs?.[enemy]?.towers?.[pos]?.alive === false) return;
    const [tc, tr] = unitTowerTile(enemy, pos);
    const d = Math.hypot(tc - c, tr - r);
    if (d < bd) { bd = d; best = pos; }
  });
  return best;
}

/** 쓰러진 리퍼 — 쌓인 영혼 수(최대 10)만큼 유령 (유령은 다시 갈라지지 않는다) */
function _uSplit(id, u) {
  if (u.split || u.spawned || _uBusy[id]) return;
  _uBusy[id] = true;
  const n = Math.min(REAPER.maxSouls, u.soulsAtDeath || 0);
  const tiles = n > 0 ? unitSplitTiles(u.owner, _uGs, id, n) : [];
  const upd = { [`${id}/spawned`]: true };
  tiles.forEach(([c, r], i) => {
    upd[`${id}c${i}`] = {
      owner: u.owner, kind: 'ghost', split: true, parent: id,
      hp: GHOST.hp, maxHp: GHOST.hp, speed: REAPER.runMs, born: u.diedAt,
      leg: { c, r, t: u.diedAt + REAPER.riseMs, target: _uNearestTarget(u.owner, _uGs, c, r), n: 0, souls: 0 },
    };
  });
  db.ref(`${_uRoom}/units`).update(upd)
    .catch(err => console.warn('리퍼 분열 실패:', err))
    .finally(() => { delete _uBusy[id]; });
}

/** 기록을 지운다 (다 사라진 유령) */
function _uForgetNow(id) {
  if (_uBusy[id]) return;
  _uBusy[id] = true;
  db.ref(`${_uRoom}/units/${id}`).remove().finally(() => { delete _uBusy[id]; });
}

/** 쓰러지고 한참 지난 기록은 지운다 */
function _uForget(id, u, now) {
  if (!u.split && !u.spawned) return;
  if (now - u.diedAt < REAPER.keepDeadMs || _uBusy[id]) return;
  _uBusy[id] = true;
  db.ref(`${_uRoom}/units/${id}`).remove().finally(() => { delete _uBusy[id]; });
}

// ── 상대 카드에 맞는다 ──────────────────────────────────────
/** '열,행,피해;…' (p1 기준) ↔ Map */
function unitTilesEncode(list) {
  return list.map(([c, r, d]) => `${c},${r},${Math.round(d)}`).join(';');
}
function _uTilesDecode(s) {
  const m = new Map();
  String(s || '').split(';').forEach(part => {
    const [c, r, d] = part.split(',').map(Number);
    if (Number.isFinite(c) && Number.isFinite(r) && d > 0) m.set(c + ',' + r, Math.max(d, m.get(c + ',' + r) || 0));
  });
  return m;
}

/**
 * 상대 카드의 범위에 든 유닛에 피해 — at(게임 시간)의 자리로 판정한다.
 * 어느 화면이 몇 번 불러도 한 번만 깎인다 (유닛의 applied).
 * status: { stun: ms } (침수 — at부터 ms 동안 기절) · { slow: ms, k } (파도 — ms 동안 k배 빠르기).
 *   맞은 유닛의 leg.holds에 구간을 더한다 — 피해와 같은 트랜잭션이라 함께 한 번만 들어간다.
 * status.burn: { dmg, n, iv } (불덩이 · 폭염, 2026-10-04) — 맞은 유닛에 불이 붙는다 (화상). 칸이 아니라 유닛에 붙어
 *   iv마다 dmg를 n번 — 걸어서 불 밖으로 나가도 탄다. 물(침수 · 파도 · 녹은 얼음물)에 닿으면 꺼진다 (_uBurnStep).
 *   맞는 순간 이미 젖어 있으면 붙지 않는다.
 */
function unitsStrike(sourcePlayer, tilesStr, at, hitId, status) {
  const tiles = _uTilesDecode(tilesStr);
  if (!tiles.size || !_uRoom) return Promise.resolve();
  const jobs = [];
  Object.entries(_uGs?.units || {}).forEach(([id, u]) => {
    if (!u?.leg || u.owner === sourcePlayer) return;
    if (u.diedAt != null && u.diedAt <= at) return;
    if (at < (u.born ?? u.leg.t)) return;                 // 아직 없었다
    if (u.kind === 'ghost' && at >= unitLeg(u).arriveAt) return;   // 타워에 닿아 스며드는 중
    const p = _uPosAt(id, u, at, unitDuelPlan(_uGs?.units));
    // 걷는 중이면 칸과 칸 사이에 있다 — 몸이 걸친 칸(가운데에서 0.65칸 안)은 모두 맞는 칸이다
    let dmg = 0;
    for (const c of new Set([Math.floor(p.c), Math.ceil(p.c)])) {
      for (const r of new Set([Math.floor(p.r), Math.ceil(p.r)])) {
        if (Math.abs(p.c - c) > 0.65 || Math.abs(p.r - r) > 0.65) continue;
        dmg = Math.max(dmg, tiles.get(c + ',' + r) || 0);
      }
    }
    if (!dmg) return;
    // 더위 (폭염) — 그 순간 몸이 선 칸이 열기 속이면 더 아프다
    const heat = typeof heatPercentAt === 'function' ? heatPercentAt(_uGs, u.owner, Math.round(p.c), Math.round(p.r), at) : 0;
    if (heat > 0) dmg = Math.round(dmg * (1 + heat / 100));
    const ignite = status?.burn && !_uWetAt(p, at);
    jobs.push(db.ref(`${_uRoom}/units/${id}`).transaction(cur => {
      if (!cur || !cur.leg || cur.diedAt != null) return;
      if (cur.applied && cur.applied[hitId]) return;
      _uTakeDamage(cur, dmg, at);
      cur.applied = { ...(cur.applied || {}), [hitId]: at };
      if (cur.hp > 0 && ignite) {
        // 불이 붙는다 — 이미 타고 있으면 새 불로 바뀐다
        cur.burnFrom = at;
        cur.burnN    = status.burn.n;
        cur.burnDmg  = status.burn.dmg;
        cur.burnIv   = status.burn.iv;
        cur.burnOut  = null;
      }
      if (cur.hp <= 0) {
        // 쓰러졌다 (_uTakeDamage가 적었다)
      } else if (status && (status.stun > 0 || status.slow > 0)) {
        const from = Math.max(at, cur.leg.t);
        const ms = status.stun > 0 ? status.stun : status.slow;
        const k = status.stun > 0 ? 0 : Math.max(0.1, Math.min(0.95, Number(status.k) || 0.5));
        if (from + ms > cur.leg.t) cur.leg.holds = unitHoldAdd(cur.leg.holds, from, at + ms, k, cur.leg.t);
      }
      return cur;
    }));
  });
  return Promise.all(jobs);
}

/** 피해를 깎는다 (트랜잭션 안) — 0이 되면 쓰러진 시각 · 그때의 영혼 수를 적는다 */
function _uTakeDamage(cur, dmg, at) {
  cur.hp = Math.max(0, (cur.hp || 0) - dmg);
  if (cur.hp <= 0) {
    cur.diedAt = Math.max(at, cur.born ?? cur.leg.t);
    cur.soulsAtDeath = unitSoulsAt({ ...cur, diedAt: null }, cur.diedAt - 1);
  }
}

/** 그 자리(p1 기준 칸)가 그 시각 젖어 있는가 — 침수 · 파도 · 폭염에 녹은 얼음물 (board.js) */
function _uWetAt(p, t) {
  if (typeof _tileWet !== 'function' || !p) return false;
  return _tileWet(unitViewCol(Math.round(p.c)), Math.round(p.r), t);
}

/** 지금 타고 있는가 (화상) */
function unitBurningAt(u, t) {
  return !!u?.burnFrom && u.burnOut == null && u.diedAt == null && t >= u.burnFrom && t < u.burnFrom + u.burnN * u.burnIv;
}

/**
 * 붙은 불 — 유닛 주인 화면이 iv마다 한 번씩 넣는다 (틱마다 표시를 남겨 정확히 한 번).
 * 틱 사이 · 틱 순간에 물에 닿아 있으면 꺼진다 (burnOut = 꺼진 시각 — 모든 화면이 김을 그린다).
 */
function _uBurnStep(id, u, now) {
  if (!unitBurningAt(u, Math.min(now, u.burnFrom + u.burnN * u.burnIv - 1))) return;
  const plan = unitDuelPlan(_uGs?.units);
  for (let k = 1; k <= u.burnN; k++) {
    const T = u.burnFrom + k * u.burnIv;
    if (T > now) break;
    const hitId = `burn${u.burnFrom}_${k}`;
    if (u.applied?.[hitId] || _uSwingDone.has(id + hitId)) continue;
    const p = _uPosAt(id, u, T, plan);
    if (_uWetAt(p, T)) { _uBurnOut(id, u, T); return; }
    _uSwingDone.add(id + hitId);
    const heat = typeof heatPercentAt === 'function' ? heatPercentAt(_uGs, u.owner, Math.round(p.c), Math.round(p.r), T) : 0;
    const dmg = heat > 0 ? Math.round(u.burnDmg * (1 + heat / 100)) : u.burnDmg;
    const from = u.burnFrom;
    db.ref(`${_uRoom}/units/${id}`).transaction(cur => {
      if (!cur || !cur.leg || cur.diedAt != null || cur.burnFrom !== from || cur.burnOut != null) return;
      if (cur.applied && cur.applied[hitId]) return;
      _uTakeDamage(cur, dmg, T);
      cur.applied = { ...(cur.applied || {}), [hitId]: T };
      return cur;
    }).catch(err => { console.warn('화상 피해 실패 — 다시 시도:', err); _uSwingDone.delete(id + hitId); });
  }
  // 틱 사이에 물에 들어갔다 — 바로 꺼진다
  if (now < u.burnFrom + u.burnN * u.burnIv && _uWetAt(_uPosAt(id, u, now, plan), now)) _uBurnOut(id, u, now);
}

function _uBurnOut(id, u, at) {
  const key = id + 'out' + u.burnFrom;
  if (_uSwingDone.has(key)) return;
  _uSwingDone.add(key);
  const from = u.burnFrom;
  db.ref(`${_uRoom}/units/${id}`).transaction(cur => {
    if (!cur || cur.burnFrom !== from || cur.burnOut != null) return;
    cur.burnOut = Math.round(at);
    return cur;
  }).catch(() => _uSwingDone.delete(key));
}

// ════════════════════════════════════════════════════════════
//  그리기 — 3D 모델 · 머리 위 체력 막대 · 영혼 원 · 낫 베기
// ════════════════════════════════════════════════════════════
function _uFx() { return document.getElementById('fx-layer'); }

function _uMakeVis(id, u) {
  if (typeof reaperBuild !== 'function' || typeof towers3dAddUnit !== 'function') return null;
  const ghost = u.kind === 'ghost';
  const seed = id.length * 131 + id.charCodeAt(id.length - 1);
  const group = ghost ? ghostBuild(seed) : reaperBuild(seed);
  reaperEyes(group, 0.85);   // 필드에서는 늘 눈이 번뜩인다
  // 발밑 표시 — 진영 색 원과 그 둘레를 도는 활 네 개 (브롤스타즈 발밑 원처럼)
  const ring = typeof unitRingBuild === 'function' ? unitRingBuild(u.owner === _uView, ghost ? 0.62 : 0.78) : null;
  if (ring) group.add(ring);
  if (!towers3dAddUnit(group)) return null;
  const hud = document.createElement('div');
  hud.className = 'unit-hud' + (u.owner === _uView ? ' unit-mine' : ' unit-enemy') + (ghost ? ' unit-ghost' : '');
  hud.innerHTML = '<span class="unit-souls"><b>0</b></span><span class="unit-hp"><i></i><em></em></span>';
  _uFx()?.appendChild(hud);
  const trail = !ghost && typeof reaperTrailCreate === 'function' ? reaperTrailCreate() : null;
  if (trail) towers3dAddUnit(trail);
  return { group, ring, hud, trail, hpEl: hud.querySelector('.unit-hp i'), hpNum: hud.querySelector('.unit-hp em'),
           soulEl: hud.querySelector('.unit-souls b'), lastHp: u.hp, lastSouls: -1, swingShown: new Set(),
           born: u.born, dying: null };
}

function _uDropVis(id) {
  const v = _uVis[id];
  if (!v) return;
  towers3dRemoveUnit(v.group);
  reaperDispose(v.group);
  if (v.trail) { towers3dRemoveUnit(v.trail); v.trail.geometry.dispose(); v.trail.material.dispose(); }
  v.hud.remove();
  v.cd?.remove();
  delete _uVis[id];
}

/** 이 화면 기준 맵 좌표 (칸 한가운데) */
function _uMapXY(c, r) { return { x: unitViewCol(c) * 100 + 50, y: r * 100 + 50 }; }

function _uStep() {
  if (_uHalted) return false;                           // 굳힌 채 — 다시 그릴 것이 없다
  const units = _uGs?.units || {};
  const plan = unitDuelPlan(units);
  const now = gameNow();
  const live = new Set();

  Object.entries(units).forEach(([id, u]) => {
    if (!u?.leg) return;
    live.add(id);
    let v = _uVis[id];
    if (!v) {
      if (_uGone.has(id)) return;
      if (u.diedAt != null && now - u.diedAt > 1200) return;   // 들어와 보니 이미 오래전에 쓰러졌다
      v = _uVis[id] = _uMakeVis(id, u);
      if (!v) return;
    }
    const ghost = u.kind === 'ghost';
    const tAt = u.diedAt != null ? Math.min(now, u.diedAt) : now;
    const p = _uPosAt(id, u, tAt, plan);
    const foeId = u.leg.foe || p.duel?.foe;
    // 유령이 타워에 닿았다 — 타워 쪽으로 스며들며 사라진다
    let touchK = -1;
    if (ghost && u.diedAt == null && p.arrived) {
      touchK = Math.min(1, (now - p.leg.arriveAt) / GHOST.fadeMs);
      const [tc, tr] = unitTowerTile(_uEnemy(u.owner), u.leg.target);
      const e = 1 - (1 - touchK) ** 2;
      p.c += (tc - p.c) * 0.5 * e;
      p.r += (tr - p.r) * 0.5 * e;
      if (!v.touched) { v.touched = true; _uGhostTouchFx(u); }
    }
    const xy = _uMapXY(p.c, p.r);
    towers3dPlaceUnit(v.group, xy.x, xy.y, ghost ? GHOST.size : REAPER.size);

    // 바라보는 쪽 — 걸을 땐 가는 쪽, 도착하면 목표 타워. 카메라 쪽으로 조금 돌려 얼굴이 보이게
    let dx, dy;
    if (!p.arrived) {
      const s = p.leg.stop;
      dx = (unitViewCol(s[0]) - unitViewCol(u.leg.c)); dy = s[1] - u.leg.r;
    } else if (foeId && units[foeId]) {
      const fp = _uPosAt(foeId, units[foeId], Math.min(now, units[foeId].diedAt ?? now), plan);
      dx = unitViewCol(fp.c) - unitViewCol(p.c); dy = fp.r - p.r;
    } else {
      const [tc, tr] = unitTowerTile(_uEnemy(u.owner), u.leg.target);
      dx = unitViewCol(tc) - unitViewCol(p.c); dy = tr - p.r;
    }
    if (dx || dy) v.group.rotation.y = towers3dYawFor(dx, dy) * 0.72;
    // 기절(침수) · 둔화(파도) — 기록된 leg의 구간으로 모든 화면이 같은 때 같은 모습
    const status = u.diedAt == null ? unitStatusAt(u, now) : null;
    if (v.ring) unitRingPose(v.ring, now, !p.arrived && now >= u.leg.t && status !== 'stun', v.group.rotation.y);

    // 휘두르기 — 피해가 들어가는 순간이 내리치는 한가운데
    let swing = null;
    const g = p.leg;
    let sp = null;
    if (!ghost && p.arrived && u.diedAt == null) {
      sp = _uSwingPhase(u, g, now);
      const k = sp.k;
      if (k >= 0) {
        const S = sp.S;
        if (sp.ph != null) swing = sp.ph;
        // 내리치는 순간 — 타워에 낫 베기 (모든 화면이 같은 순간에 그린다)
        const key = `${Math.round(sp.first)}_${k}`;   // 예측 결투 → 기록된 결투로 바뀌어도 같은 낫은 한 번만
        if (now >= S && now - S < 600 && !v.swingShown.has(key)) {
          v.swingShown.add(key);
          if (foeId) {
            const fv = _uVis[foeId];
            const fu = units[foeId];
            if (fv && fu && (fu.diedAt == null || fu.diedAt >= S)) _uSlashFx(u, v, { t: now, walk: null }, towers3dUnitPoint(fv.group, 1.1));
          } else {
            const tgt = _uGs?.[_uEnemy(u.owner)]?.towers?.[u.leg.target];
            if (!tgt || tgt.alive !== false) _uSlashFx(u, v, { t: now, walk: null });
          }
        }
      }
    }
    const pose = { t: now, walk: p.arrived || now < u.leg.t ? null : p.walked, swing };
    if (ghost) ghostPose(v.group, { t: now, glide: touchK >= 0 || (!p.arrived && now >= u.leg.t) });
    else reaperPose(v.group, pose);

    // 나타나기 — 컷씬 뒤 놓은 칸에서 · 영혼에서 솟아오르기
    const born = u.born ?? u.leg.t;
    let fade = 1;
    // (씬에 땅이 없어서 아래로 내리면 바닥 밑으로 비쳐 보인다 — 키를 늘리고 줄여서 솟고 꺼지게 한다)
    const sc = v.group.scale.x;
    if (now < u.leg.t) {
      const k = Math.max(0, Math.min(1, (now - born) / Math.max(1, u.leg.t - born)));
      const e = 1 - (1 - k) ** 3;
      fade = Math.min(1, k * 1.6);
      v.group.scale.set(sc * (0.6 + 0.4 * e), sc * Math.max(0.02, e), sc * (0.6 + 0.4 * e));   // 땅에서 솟는다
      if (!v.risen) { v.risen = true; _uRiseFx(xy, u.split); }
    }
    // 쓰러짐 — 기울며 주저앉고 연기로 흩어진다
    if (u.diedAt != null) {
      const k = Math.max(0, Math.min(1, (now - u.diedAt) / 900));
      if (!v.dying) { v.dying = true; _uDeathFx(id, u, xy); }
      fade = 1 - k;
      v.group.rotation.z = -k * 0.45;
      v.group.scale.set(sc * (1 + k * 0.25), sc * (1 - k * 0.7), sc * (1 + k * 0.25));
      if (k >= 1) { _uGone.add(id); _uDropVis(id); return; }
    } else {
      v.group.rotation.z = 0;
    }
    if (touchK >= 0) {
      fade = Math.min(fade, 1 - touchK);
      v.group.scale.set(sc * (1 + touchK * 0.3), sc * (1 + touchK * 0.15), sc * (1 + touchK * 0.3));
      if (touchK >= 1) { _uGone.add(id); _uDropVis(id); return; }
    }
    if (v.fade !== fade) { reaperFade(v.group, fade); v.fade = fade; }

    // 낫이 지나간 자리를 따라 빛나는 꼬리 (조금 전 자세들을 다시 계산해 잇는다)
    if (v.trail) {
      if (swing != null) {
        reaperTrailUpdate(v.trail, v.group, ago => {
          const s = _uSwingPhase(u, g, now - ago);
          return s.k >= 0 ? s.ph : null;
        }, pose, 10);
      } else if (v.trail.visible) {
        v.trail.visible = false;
      }
    }

    // 머리 위 체력 막대 · 영혼 원
    const hp = Math.max(0, u.hp || 0), max = u.maxHp || REAPER.hp;
    const pt = towers3dUnitPoint(v.group, 2.2);
    if (pt) {
      v.hud.style.left = pt.x.toFixed(1) + 'px';
      v.hud.style.top  = pt.y.toFixed(1) + 'px';
    }
    v.hud.style.opacity = (u.diedAt != null ? fade : Math.min(1, fade * 1.5)).toFixed(2);
    if (v.hpShown !== hp) {
      v.hpShown = hp;
      v.hpEl.style.width = (hp / max * 100).toFixed(1) + '%';
      v.hpNum.textContent = hp;
    }
    const souls = unitSoulsAt(u, now);
    if (souls !== v.lastSouls) {
      if (v.lastSouls >= 0 && souls > v.lastSouls) v.hud.classList.remove('soul-pop'), void v.hud.offsetWidth, v.hud.classList.add('soul-pop');
      v.lastSouls = souls;
      v.soulEl.textContent = souls;
    }
    v.hud.classList.toggle('unit-split', !!u.split);
    v.hud.classList.toggle('unit-stunned', status === 'stun');
    v.hud.classList.toggle('unit-slowed', status === 'slow');
    // 더위 (폭염의 열기 속) — 기절·둔화 표가 없을 때만 띄운다 (한 자리에 하나)
    const heat = u.diedAt == null && typeof heatPercentAt === 'function'
      ? heatPercentAt(_uGs, u.owner, Math.round(p.c), Math.round(p.r), now) : 0;
    const burning = unitBurningAt(u, now);
    v.hud.classList.toggle('unit-burning', burning && !status);
    v.hud.classList.toggle('unit-heat', heat > 0 && !status && !burning);
    if (burning && now - (v.emberAt || 0) > 140 && typeof _t3dSpark === 'function') {
      // 몸에 붙은 불 — 불씨가 타오른다
      v.emberAt = now;
      const xy = _uMapXY(p.c, p.r);
      for (let i = 0; i < 2; i++) {
        _t3dSpark(xy.x + (Math.random() - 0.5) * 34, xy.y + (Math.random() - 0.5) * 20, 30 + Math.random() * 70, {
          color: i ? 0xffb347 : 0xff6a1a, life: 500 + Math.random() * 300,
          v: new THREE.Vector3((Math.random() - 0.5) * 20, 80 + Math.random() * 60, 0), g: -20, size: 7 + Math.random() * 6 });
      }
    }
    if (u.burnOut != null && v.burnOutShown !== u.burnOut) {
      // 물에 닿아 꺼졌다 — 흰 김이 피어오른다
      v.burnOutShown = u.burnOut;
      const sp = _uStagePoint(_uMapXY(p.c, p.r));
      if (typeof _spawnDust === 'function') {
        for (let i = 0; i < 3; i++) _spawnDust(sp.x + (i - 1) * 16, sp.y - 40, 90, i * 90, 1100, 'rgba(235, 242, 250, 0.6)');
      }
    }
    if (typeof reaperStatusFx === 'function') reaperStatusFx(v.group, status, now);

    // 낫 대기 — 휘두른 뒤부터 다음 낫까지 몸 한가운데에 원형 게이지와 남은 초 (4s → 3s → 2s → 1s)
    _uCooldown(v, u, sp, now, fade);
    // 맞은 피해 숫자
    if (hp < v.lastHp && pt) _uDamageNum(pt, v.lastHp - hp);
    v.lastHp = hp;
  });

  Object.keys(_uVis).forEach(id => { if (!live.has(id)) _uDropVis(id); });
  return Object.keys(_uVis).length > 0;
}

/**
 * 낫 대기 게이지 — 첫 낫을 휘두른 뒤부터, 몸 한가운데에 원형 게이지와 다음 낫까지 남은 초(4s · 3s · 2s · 1s).
 * 0이 되는 순간 내리치고 곧바로 다시 센다. 로딩 화면 링과 같은 흰빛·회색 (돌아가는 버퍼링 꼬리는 없다).
 * 유닛 시계로 세므로 기절 중엔 멈추고, 둔화 중엔 느리게 찬다 — 낫이 실제로 들어가는 시각과 같다.
 */
function _uCooldown(v, u, sp, now, fade) {
  const show = !!sp && u.kind !== 'ghost' && u.diedAt == null && now >= sp.first && sp.next > 0;
  if (!show) { if (v.cd && v.cd.style.display !== 'none') v.cd.style.display = 'none'; return; }
  if (!v.cd) {
    v.cd = document.createElement('div');
    v.cd.className = 'unit-cd' + (u.owner === _uView ? ' unit-mine' : ' unit-enemy');
    v.cd.innerHTML = '<i class="unit-cd-track"></i><b class="unit-cd-core"><em></em></b>';
    v.cdText = v.cd.querySelector('em');
    _uFx()?.appendChild(v.cd);
  }
  const pt = towers3dUnitPoint(v.group, 1.0);
  if (!pt) return;
  v.cd.style.display = '';
  v.cd.style.left = pt.x.toFixed(1) + 'px';
  v.cd.style.top  = pt.y.toFixed(1) + 'px';
  v.cd.style.opacity = Math.min(1, fade * 1.5).toFixed(2);
  const W = REAPER.swingMs;
  v.cd.style.setProperty('--p', ((1 - Math.min(W, sp.next) / W) * 100).toFixed(1));
  const label = Math.max(1, Math.ceil(sp.next / 1000)) + 's';
  if (v.cdLabel !== label) { v.cdLabel = label; v.cdText.textContent = label; }
}

// ── 연출 (DOM, #fx-layer — 맵 좌표) ─────────────────────────
function _uStagePoint(xy) {
  // 바닥 좌표 → 화면(스테이지) 좌표. 바닥판이 기울어 있으므로 board.js의 변환을 쓴다
  return typeof _groundToStage === 'function' ? _groundToStage(xy.x, xy.y) : xy;
}

function _uDamageNum(pt, amount) {
  const el = document.createElement('div');
  el.className = 'unit-dmg' + (amount >= 100 ? ' big' : '');
  el.textContent = '-' + amount;
  // 다른 숫자(타워 피해 · 다른 유닛)와 겹치지 않는 자리 — 이 숫자는 아래 끝이 기준이라 위로 한 줄 올려 잰다
  const H = amount >= 100 ? 60 : 50;
  const s = typeof fxNumberSpot === 'function'
    ? fxNumberSpot(pt.x, pt.y - 14 - H, Math.max(64, String(amount).length * 30 + 26), H)
    : { x: pt.x + (Math.random() - 0.5) * 30, y: pt.y - 14 - H };
  el.style.left = s.x + 'px';
  el.style.top  = (s.y + H) + 'px';
  _uFx()?.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

/** 유령이 타워에 닿았다 — 창백한 빛이 번지며 흩어진다 */
function _uGhostTouchFx(u) {
  const layer = _uFx();
  const owner = _uEnemy(u.owner) === _uView ? 'my' : 'enemy';
  const c = typeof towers3dTowerPoint === 'function' && towers3dTowerPoint(owner, u.leg.target, 0.45);
  if (!layer || !c) return;
  const el = document.createElement('div');
  el.className = 'fx-ghost-touch';
  el.style.left = c.x + 'px';
  el.style.top  = c.y + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

/**
 * 낫 베기 — 리퍼가 실제로 휘두른 궤적을 따라 그린다.
 * 3D 모델을 내리치는 구간(휘두르기 0.36→0.72)의 자세로 차례로 놓아 보며 날끝이 지나간 점을 화면 좌표로 옮기고,
 * 그 궤적을 타워 위로 옮겨 키운 초승달 자국을 날이 움직인 방향으로 그어 나간다.
 * 그래서 낫을 든 손·휘두르는 방향·리퍼가 선 쪽이 늘 연출과 맞는다 (예전엔 정해진 그림을 좌우로만 뒤집었다).
 */
function _uSlashFx(u, v, pose, at = null) {
  const owner = _uEnemy(u.owner) === _uView ? 'my' : 'enemy';
  const c = at || (typeof towers3dTowerPoint === 'function' && towers3dTowerPoint(owner, u.leg.target, 0.45))
         || (typeof boardTowerCenterStage === 'function' && boardTowerCenterStage(owner, u.leg.target));
  const layer = _uFx();
  if (!c || !layer || !v?.group?.userData?.tip || typeof towers3dProjectWorld !== 'function') return;

  // 날끝이 지나간 길 (화면 좌표)
  const g = v.group, tip = g.userData.tip, w = new THREE.Vector3();
  const raw = [];
  for (let s = 0.36; s <= 0.721; s += 0.024) {
    reaperPose(g, { ...pose, swing: s });
    g.updateMatrixWorld(true);
    tip.getWorldPosition(w);
    const q = towers3dProjectWorld(w);
    if (q) raw.push(q);
  }
  reaperPose(g, pose);
  g.updateMatrixWorld(true);
  if (raw.length < 4) return;

  // 타워 위로 옮기고 키운다 — 모양과 방향은 그대로, 길이는 약 170px
  const mx = raw.reduce((a, p) => a + p.x, 0) / raw.length, my = raw.reduce((a, p) => a + p.y, 0) / raw.length;
  let ext = 0;
  raw.forEach(p => { ext = Math.max(ext, Math.hypot(p.x - mx, p.y - my)); });
  const K = Math.max(1, Math.min(4, 85 / Math.max(1, ext)));
  const pts = raw.map(p => ({ x: c.x + (p.x - mx) * K, y: c.y + (p.y - my) * K }));

  // 초승달 — 가운데가 두껍고 양 끝이 뾰족하다 (궤적의 한쪽으로 부풀린다)
  const N = pts.length;
  const side = [];
  let len = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
    const wdt = 22 * Math.pow(Math.sin(Math.PI * i / (N - 1)), 0.75);
    side.push({ x: pts[i].x - ty / tl * wdt, y: pts[i].y + tx / tl * wdt });
    if (i) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const f = n => n.toFixed(1);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join(' ');
  const cres = line + ' ' + side.slice().reverse().map(p => `L${f(p.x)} ${f(p.y)}`).join(' ') + ' Z';
  const id = 'rs' + Math.random().toString(36).slice(2, 8);
  const p0 = pts[0], p1 = pts[N - 1];

  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('class', 'fx-reaper-slash');
  el.setAttribute('viewBox', '0 0 1600 900');
  el.setAttribute('width', '1600');
  el.setAttribute('height', '900');
  el.innerHTML = `
    <defs>
      <linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="${f(p0.x)}" y1="${f(p0.y)}" x2="${f(p1.x)}" y2="${f(p1.y)}">
        <stop offset="0" stop-color="#8a5cff" stop-opacity="0.2"/>
        <stop offset="0.45" stop-color="#ffffff"/>
        <stop offset="0.8" stop-color="#e3d6ff"/>
        <stop offset="1" stop-color="#9d6bff"/>
      </linearGradient>
      <filter id="${id}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
      <mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="900">
        <path class="rs-reveal" d="${line}" fill="none" stroke="#fff" stroke-width="90" stroke-linecap="round"
              stroke-dasharray="${f(len + 90)}" stroke-dashoffset="${f(len + 90)}"/>
      </mask>
    </defs>
    <g mask="url(#${id}m)">
      <path d="${cres}" fill="#8a5cff" filter="url(#${id}f)" opacity="0.95"/>
      <path d="${cres}" fill="url(#${id}g)"/>
      <path d="${line}" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.9"/>
    </g>`;
  layer.appendChild(el);
  // 날이 움직인 방향으로 그어진다 → 잠깐 머물다 스러진다
  el.querySelector('.rs-reveal').animate([{ strokeDashoffset: len + 90 }, { strokeDashoffset: 0 }],
                                         { duration: 170, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'forwards' });
  el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: 650, fill: 'forwards' });
  setTimeout(() => el.remove(), 700);

  // 검은 파편 — 날이 빠져나간 쪽으로 튄다
  const ex = p1.x - pts[N - 3].x, ey = p1.y - pts[N - 3].y, el2 = Math.hypot(ex, ey) || 1;
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('i');
    s.className = 'fx-reaper-shard';
    s.style.left = c.x + 'px';
    s.style.top  = c.y + 'px';
    const a = Math.atan2(ey / el2, ex / el2) + (Math.random() - 0.5) * 1.3;
    const d = 40 + Math.random() * 60;
    s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
    s.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
    s.style.animationDelay = '0.08s';
    layer.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}

/** 땅에서 솟는 흑백 나선 (컷씬의 포탈을 바닥에 작게) */
function _uRiseFx(xy, small) {
  const layer = _uFx();
  if (!layer) return;
  const s = _uStagePoint(xy);
  const el = document.createElement('div');
  el.className = 'fx-reaper-rise' + (small ? ' small' : '');
  el.style.left = s.x + 'px';
  el.style.top  = s.y + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

/** 쓰러짐 — 검은 연기, 그리고 영혼이 새 리퍼가 솟을 칸으로 날아간다 */
function _uDeathFx(id, u, xy) {
  const layer = _uFx();
  if (!layer) return;
  const s = _uStagePoint(xy);
  const smoke = document.createElement('div');
  smoke.className = 'fx-reaper-smoke';
  smoke.style.left = s.x + 'px';
  smoke.style.top  = (s.y - 40) + 'px';
  layer.appendChild(smoke);
  setTimeout(() => smoke.remove(), 1200);
  if (u.split) return;
  const tiles = unitSplitTiles(u.owner, _uGs, id, Math.min(REAPER.maxSouls, u.soulsAtDeath || 0));
  tiles.forEach(([c, r], i) => {
    const to = _uStagePoint(_uMapXY(c, r));
    const w = document.createElement('div');
    w.className = 'fx-reaper-soul';
    w.style.left = s.x + 'px';
    w.style.top  = (s.y - 50) + 'px';
    layer.appendChild(w);
    w.animate([
      { transform: 'translate(-50%,-50%) scale(0.4)', opacity: 0 },
      { transform: `translate(calc(-50% + ${(to.x - s.x) * 0.5}px), calc(-50% + ${(to.y - s.y) * 0.5 - 90}px)) scale(1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${to.x - s.x}px), calc(-50% + ${to.y - s.y + 40}px)) scale(0.6)`, opacity: 0.9 },
    ], { duration: REAPER.riseMs - 100, delay: i * 40, easing: 'ease-in-out', fill: 'forwards' });
    setTimeout(() => w.remove(), REAPER.riseMs + i * 40 + 50);
  });
}

/**
 * 공격 카드의 범위를 '유닛만 맞는 예약'으로 남긴다 — 피해가 들어가는 순간(지금 + delayMs)의 자리로 판정.
 * 상대 유닛이 하나도 없으면 아무것도 쓰지 않는다.
 * @param {Array<[number, number, number]>} tiles p1 기준 [열, 행, 피해]
 */
function unitsWriteStrike(sourcePlayer, tiles, delayMs, status) {
  if (!tiles?.length || typeof writePendingHit !== 'function') return;
  const any = Object.values(_uGs?.units || {}).some(u => u && u.owner !== sourcePlayer && u.diedAt == null);
  if (!any) return;
  writePendingHit({
    sourcePlayer, targetPlayer: _uEnemy(sourcePlayer), unitsOnly: true,
    tiles: unitTilesEncode(tiles), cardId: 'units', cardType: 'attack',
    applyAt: gameNow() + Math.max(0, delayMs || 0),
    ...(status ? { status } : {}),
  }).catch(err => console.warn('유닛 피해 예약 실패:', err));
}
