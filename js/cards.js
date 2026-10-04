// ============================================================
//  cards.js — 카드 정의 데이터, 드로우 로직
// ============================================================

const GRADE_WEIGHTS = {
  common:    55,
  rare:      30,
  epic:      12,
  mythic:     2,
  legendary:  0.95,
  secret:     0.05
};

// 등급 한국어 레이블
const GRADE_LABEL = {
  common:    '일반',
  rare:      '희귀',
  epic:      '에픽',
  mythic:    '신화',
  legendary: '전설',
  secret:    '비밀'
};

// 등급 이모지
const GRADE_EMOJI = {
  common:    '⚪',
  rare:      '🟢',
  epic:      '🟣',
  mythic:    '🔴',
  legendary: '🌟',
  secret:    '🖤'
};

/**
 * 카드 타입:
 *   attack   — 적 타워 공격
 *   heal     — 내 타워 치유
 *   defense  — 내 타워 보호 (방어/실드/면역)
 *   control  — 적 타워에 CC기 적용
 *
 * effect 종류:
 *   damage           → 즉시 피해
 *   dot              → { dmgPerTick, ticks, tickInterval(ms) }
 *   heal             → 즉시 치유
 *   hot              → { healPerTick, ticks, tickInterval(ms) }
 *   damageReduction  → { percent, duration(ms) }  피해 감소 버프
 *   shield           → number  보호막 HP 부여
 *   shieldDecay      → { rate, interval(ms) }  보호막 초당 자동 감소
 *   immunity         → { duration(ms) }  피해 면역
 *   damageAmp        → { percent, duration(ms) }  받는 피해 증폭 (적 타워 디버프)
 *   deckFreeze       → { duration(ms) }  덱 사용 금지 (모든 카드)
 *   freeze           → { duration(ms) }  타워 동결 — 얼어 있는 동안만 그 카드의 지속 피해가 들어간다 (얼음전개)
 *   percentDrain     → { damagePercent, healPercent }  현재 HP % 피해 + 킹 힐
 *   energyBurst      → { perTick, ticks, interval(ms) }  에너지 폭발 충전
 *   healReduction    → { percent, duration(ms) }  힐량 감소 디버프
 *   reflect          → { percent, duration(ms) }  피해 반사 방어막
 */
// ── 상성 수치 (2026-10-04) ───────────────────────────────────
// 코드(sync · effects · board · bot)와 카드 설명이 모두 여기서 읽는다 — 값을 바꾸면 설명도 같이 바뀐다
const SYNERGY = {
  shatterPct:        30,     // 쇄빙 — 언 타워에 땅·돌 카드(지진 · 붕괴 · 돌 · 바위 지옥) 피해 +30%
  zapPct:            50,     // 감전 — 젖은 타워에 번개 +50%
  soakHealPct:       50,     // 젖은 쪽 회복(벚꽃 · 흰꽃 · 숲의정령) +50%
  heatHealCutPct:    25,     // 더위(폭염의 열기) 속 회복 -25%
  iceFireCutPct:     50,     // 언 타워에 떨어진 불덩이는 피해의 50%만
  iceHalfMeltCutPct: 50,     // 불덩이에 반쯤 녹은 얼음 — 남은 동결 피해 -50%
  icePoolMs:       3000,     // 폭염에 녹은 얼음물이 고여 있는 시간
  totemCutMs:      2000,     // 지진 · 바람이 줄이는 토템 시간 (이만큼도 안 남았으면 무너진다)
  totemLockMs:     2000,     // 토네이도 · 붕괴 뒤 새 토템을 못 세우는 시간
};

const CARD_DEFINITIONS = {

  // ── 일반 ───────────────────────────────────────────────
  // cast: 카드를 고르면 카드 대신 사거리(부채꼴)가 마우스를 따라다니고,
  //       클릭하면 휘두르는 연출이 끝나는 순간 피해가 들어간다 (board.js CAST_STYLES)
  wooden_sword: {
    cast: 'sword',
    id: 'wooden_sword',
    name: '목검',
    icon: '🗡️',
    grade: 'common',
    energyCost: 1,
    type: 'attack',
    targeting: 'single',
    effect: { damage: 12 },
    desc: '단일 대상 {e.damage} 피해'
  },
  // 투척 — 꾹 눌러 차징하면 더 아프고 더 빠르게 날아간다 (board.js CAST_STYLES.stone)
  rock: {
    cast: 'stone',
    id: 'rock',
    name: '돌',
    icon: '🪨',
    grade: 'common',
    energyCost: 2,
    type: 'attack',
    targeting: 'single',
    effect: { damage: 20 },
    desc: '타일 한 칸 {e.damage} 피해 · Space로 차면 최대 {st.charge.damage.at(-1)} · 셀수록 빠르게 날아간다 (차징 없이는 느리다) · 쇄빙: 언 타워에 {S.shatterPct}% 더 들어가고 얼음이 깨져 동결이 바로 풀린다'
  },
  // 바람 스매시 — 앞으로 두 타일 길이의 일자 사거리, 타워 하나만 친다.
  // 피해와 함께 상대 에너지를 5 깎는다 (board.js CAST_STYLES.windsmash)
  wind: {
    cast: 'windsmash',
    id: 'wind',
    name: '바람',
    icon: '🌬️',
    grade: 'common',
    energyCost: 2,
    type: 'attack',
    targeting: 'single',
    effect: { damage: 24, energyDrain: 5 },
    desc: '단일 {e.damage} 피해 · 상대 에너지 -{e.energyDrain} · 상성: 상대 토템(숲의정령·흰꽃)이 더 가까우면 토템을 쳐 남은 시간 -{sec(S.totemCutMs)}초 ({sec(S.totemCutMs)}초 이하로 남았으면 무너진다) — 단일이라 토템과 타워 중 하나만'
  },
  // 지진 — 3×3칸 범위. 0.7초 땅울림 뒤 3초 동안 칸이 무너지며 1초마다 11 피해.
  // 범위에 닿은 타워는 전부 맞는다 (board.js CAST_STYLES.quake — 지연 0.7초가 거기서 온다)
  earthquake: {
    cast: 'quake',
    id: 'earthquake',
    name: '지진',
    icon: '💥',
    grade: 'common',
    energyCost: 3,
    type: 'attack',
    targeting: 'range2',
    effect: { dot: { dmgPerTick: 9, ticks: 3, tickInterval: 1000 } },
    desc: '{st.cols}×{st.rows}칸 범위 · 땅울림 {sec(st.hitMs)}초 뒤 {sec(dotMs(e.dot))}초간 {per(e.dot.tickInterval)} {e.dot.dmgPerTick} 피해 (총 {tot(e)}) · 상성: 범위 안 상대 토템의 남은 시간 -{sec(S.totemCutMs)}초 ({sec(S.totemCutMs)}초 이하로 남았으면 무너지고 회복도 멈춘다) · 쇄빙: 언 타워에 {S.shatterPct}% 더 들어가고 얼음이 깨져 동결이 바로 풀린다'
  },
  // 화살 — 커서에서 앞으로 3칸 길이·1칸 폭의 일자 사거리. 화살이 날아가다 처음 닿는 타워 하나를 맞힌다.
  // Space로 최대 2초 차징: 21 → 39. 차징과 관계없이 사거리 끝까지 1.2초 (board.js CAST_STYLES.arrow)
  arrow: {
    cast: 'arrow',
    id: 'arrow',
    name: '화살',
    icon: '🏹',
    grade: 'common',
    energyCost: 3,
    type: 'attack',
    targeting: 'single',
    effect: { damage: 21 },
    desc: '일자 3칸 · 처음 닿는 타워 {e.damage} 피해 · Space로 차면 최대 {st.charge.damage.at(-1)} · 내 진영에서 쏘면 왼쪽으로 날아가 길에 선 상대 유닛(그림리퍼)만 맞힌다'
  },

  // ── 진화 (일반 등급 카드 5회 사용 후 변환) ────────────
  dual_sword: {
    cast: 'dualsword',
    id: 'dual_sword',
    name: '듀얼 검',
    icon: '⚔️',
    grade: 'common',
    energyCost: 1,
    type: 'attack',
    targeting: 'single',
    // 돌진(연출 0.5초)이 꽂히는 순간 14, 그 뒤 / 베기 0.3초 뒤 8, \ 베기 다시 0.3초 뒤 8 (2026-10-01 밸런스: 44 → 30)
    effect: {
      damage: 14,
      dot: [
        { dmgPerTick: 8, ticks: 1, tickInterval: 300 },
        { dmgPerTick: 8, ticks: 1, tickInterval: 600 }
      ]
    },
    desc: '단일 돌진 {e.damage} 피해 + X 베기 {e.dot[0].dmgPerTick}+{e.dot[1].dmgPerTick} (총 {tot(e)}) · 상성: 상대 토템(숲의정령·흰꽃)이 더 가까우면 토템을 베어 없앤다 — 단일이라 토템과 타워 중 하나만',
    isEvolution: true
  },
  // 돌의 진화 — 차징 없이 한 번에 세 덩이를 던진다.
  // 타워마다 도착 시간·피해·돌가루가 다르다 (board.js CAST_STYLES.stonehell.shots가 진짜 값)
  rock_hell: {
    cast: 'stonehell',
    id: 'rock_hell',
    name: '바위 지옥',
    icon: '😈',
    grade: 'common',
    energyCost: 3,
    type: 'attack',
    targeting: 'range3',
    effect: { damage: 30, dot: { dmgPerTick: 5, ticks: 3, tickInterval: 600 } },
    desc: '상대 타워 셋에 한 덩이씩 · {st.shots.map(x => x.damage).join(\' / \')} 피해 + 돌가루 {st.shots[0].dot.ticks}회 (부서진 타워 몫은 킹에 절반) · 쇄빙: 언 타워에 {S.shatterPct}% 더 들어가고 얼음이 깨져 동결이 바로 풀린다',
    isEvolution: true
  },
  // 바람의 진화 — 내 진영 타일에 설치하면 작은 소용돌이가 점점 커지고 빨라지며
  // 일자로 전진해 타워를 친다. 멀리서 올수록 크고 빠르고 아프다.
  // 실제 값은 board.js CAST_STYLES.tornado가 계산한다 (설치한 타일에 따라 달라진다)
  tornado: {
    cast: 'tornado',
    id: 'tornado',
    name: '토네이도',
    icon: '🌪️',
    grade: 'common',
    energyCost: 3,
    type: 'attack',
    targeting: 'range2',
    effect: { damage: 20 },
    desc: '내 진영 타일에 설치 · 전진하며 타워 타격 (멀리서 올수록 강함) · 닿는 줄의 상대 토템(숲의정령·흰꽃)을 날려 버린다 ({sec(S.totemLockMs)}초간 새 토템도 날아감)',
    isEvolution: true
  },
  // 붕괴 — 지진의 진화 (예전 '파멸 조각'을 대신한다). 3칸 폭으로 맵 세로 전체가 범위라
  // 타워 셋에 다 닿을 수 있다. 0.5초 땅울림 뒤 즉시 55 피해.
  // 범위 안의 토템을 모두 무너뜨리고(회복도 멈춘다), 2초 동안은 새로 세운 토템도 곧바로 무너진다
  // (board.js CAST_STYLES.collapse)
  collapse: {
    cast: 'collapse',
    id: 'collapse',
    name: '붕괴',
    icon: '🏚️',
    grade: 'common',
    energyCost: 3,
    type: 'attack',
    targeting: 'range3',
    effect: { damage: 25 },
    desc: '3칸 폭 세로 범위 · 땅울림 {sec(st.hitMs)}초 뒤 즉시 {e.damage} 피해 · 범위 안 토템 파괴 ({sec(st.lockMs)}초간 새 토템도 무너짐) · 쇄빙: 언 타워에 {S.shatterPct}% 더 들어가고 얼음이 깨져 동결이 바로 풀린다',
    isEvolution: true
  },
  // 사랑의 화살 — 화살의 진화 (예전 '큐피드 화살'). 차징 없이 1초 만에 일자 3칸을 날아간다.
  // 내 진영에서 쏘면 내 타워 쪽(왼쪽)으로, 상대 진영에서 쏘면 상대 타워 쪽으로 날아간다.
  // 내 타워: 하트가 그려지며 80 회복 / 적 타워: 하트가 깨지며 즉시 70 피해 (board.js CAST_STYLES.lovearrow)
  love_arrow: {
    cast: 'lovearrow',
    id: 'love_arrow',
    name: '사랑의 화살',
    icon: '💘',
    grade: 'common',
    energyCost: 3,
    type: 'dual',
    targeting: 'single',
    effect: {
      dualEffect: {
        attack:  { damage: 70 },
        support: { heal: 80 }
      }
    },
    desc: '일자 3칸 · 상대 진영: 하트가 깨지며 즉시 {e.dualEffect.attack.damage} 피해 (길의 상대 유닛도) / 내 진영에서 쏘면 회복만: 하트가 그려지며 {e.dualEffect.support.heal} 회복',
    isEvolution: true
  },

  // ── 희귀 진화 ─────────────────────────────────────────
  // 파도 — 침수의 진화 (2026-10-01 리워크). 아무 열에나 놓으면(2026-10-02) 3칸 폭 파도가 상대 진영 끝까지 밀려가며
  // 그 안에 든 대상에게 0.5초마다 22. 실제 피해는 board.js castWavePlan이 정한다 (아래 effect는 AI의 값 셈용)
  wave_evo: {
    id: 'wave_evo',
    name: '파도',
    icon: '🌊',
    grade: 'rare',
    energyCost: 12,
    type: 'attack',
    targeting: 'range3',
    cast: 'wave',
    effect: { dot: { dmgPerTick: 22, ticks: 3, tickInterval: 500 } },
    desc: '아무 열에나 놓으면 {st.cols}칸 폭 파도가 상대 진영 끝까지 밀려가며, 파도 안에 든 상대 대상에게 {sec(e.dot.tickInterval)}초마다 {e.dot.dmgPerTick} 피해 · 지나간 자리의 불을 끈다 · 파도가 닿는 동안 젖은 쪽의 회복(벚꽃·흰꽃·숲의정령)이 {S.soakHealPct}% 늘어난다',
    isEvolution: true
  },
  // 폭염 — 불덩이의 진화 (2026-10-02 리워크, 예전 '불꽃'). 3×7칸 범위.
  // 폭발 49 → 불타는 동안 0.5초마다 9 × 5 → 열기(더위) 6초: 그 칸의 대상은 모든 카드 피해 +15%.
  // 범위가 타워 셋을 다 덮는 일이 많아(실효 282 + 더위) 기력 7 → 20 (card-balance 기준 희귀 진화 ~14/기력)
  // 실제 시각·피해는 board.js castHeatwavePlan (아래 effect는 AI 값 셈 · 유닛 피해용)
  fire_evo: {
    id: 'fire_evo',
    name: '폭염',
    icon: '🎇',
    grade: 'rare',
    energyCost: 20,
    type: 'attack',
    targeting: 'single',
    cast: 'heatwave',
    effect: { damage: 49, dot: { dmgPerTick: 9, ticks: 5, tickInterval: 500 } },
    desc: '{st.cols}×{st.rows}칸 범위에 화염 폭발 {e.damage} 피해 → 범위 안 대상이 불타며 {sec(e.dot.tickInterval)}초마다 {e.dot.dmgPerTick} 피해 {e.dot.ticks}회 → 이어서 {sec(st.heatMs)}초 동안 열기가 올라와 그 칸의 모든 대상(타워·소환 유닛)이 더위 상태로 모든 카드 피해를 {st.heatPercent}% 더 받고 회복은 {S.heatHealCutPct}% 덜 받는다 · 힐 밴: 범위 안 상대 토템이 타 버리고, 열기 속 토템은 말라 비틀어진다 · 내가 얼린 상대 타워는 폭염 피해 없이 얼음이 다 녹아 동결이 풀리고, 녹은 물이 3×3칸에 {sec(S.icePoolMs)}초 동안 고인다 (젖음 — 감전 · 그 동안 상대 회복 +{S.soakHealPct}%) · 불길이 타는 동안 그 자리에 세운 상대 토템도 재가 된다 · 물이 닿으면 불과 열기가 꺼진다',
    isEvolution: true
  },
  // 철벽 — 벽돌의 진화. 벽돌처럼 내 타워 칸에 놓으면 강철 방벽이 타워를 둘러싼다 (2026-10-02).
  // 직선 공격(sync.js LINE_ATTACK_CARDS)은 80%, 그 밖의 범위 공격은 50% 막는다. 직선 80%가 세서 기력 10 → 12
  iron_wall: {
    id: 'iron_wall',
    name: '철벽',
    icon: '🛡️',
    grade: 'rare',
    energyCost: 12,
    type: 'defense',
    targeting: 'single',
    cast: 'ironwall',
    effect: { damageReduction: { percent: 50, linePercent: 80, duration: 8000 } },
    desc: '내 타워 칸에 놓으면 강철 방벽이 {sec(e.damageReduction.duration)}초 동안 직선 공격(화살·목검·듀얼 검·바람·토네이도·톱·파도) 피해 {e.damageReduction.linePercent}%, 그 밖의 범위 공격 피해 {e.damageReduction.percent}% 감소. 한 타워에 방어막은 하나 — 또 놓으면 {sec(e.damageReduction.duration)}초 연장',
    isEvolution: true
  },
  // 톱 — 가시의 진화 (2026-10-03 리워크). 커서 가까이의 가장 가까운 대상 하나 — 클릭하면 바로 끝까지 저절로 썬다 (차징 · 게이지 없음).
  // 0.5초마다 7. 토템이면 반토막 낸다. 실제 피해는 board.js 톱(_sawTick)이 넣는다 (아래 effect는 AI의 값 셈용)
  thorn_evo: {
    id: 'thorn_evo',
    name: '톱',
    icon: '🪚',
    grade: 'rare',
    energyCost: 6,
    type: 'attack',
    targeting: 'single',
    cast: 'saw',
    effect: { dot: { dmgPerTick: 7, ticks: 12, tickInterval: 500 } },
    desc: '커서 가까이의 대상 하나(강조됨)를 클릭하면 바로 그쪽에서 다가가 썬다 — 타워는 {sec(dotMs(e.dot))}초 동안 {sec(e.dot.tickInterval)}초마다 {e.dot.dmgPerTick} 피해 (총 {tot(e)}) · 상성: 상대 토템(숲의정령·흰꽃)은 반토막 나 쓰러진다 (회복도 멈춘다 · 톱은 거기서 끝)',
    isEvolution: true
  },
  cherry_blossom_evo: {
    cast: 'whiteblossom',
    id: 'cherry_blossom_evo',
    name: '흰꽃',
    icon: '💮',
    grade: 'rare',
    energyCost: 14,
    type: 'heal',
    targeting: 'range3',
    effect: { hot: { healPerTick: 12, ticks: 5, tickInterval: 1000 } },
    desc: '범위(3) {sec(e.hot.tickInterval)}초마다 {e.hot.healPerTick} 치유({e.hot.ticks}회, 총 {tot(e)})',
    isEvolution: true
  },

  // ── 희귀 ───────────────────────────────────────────────
  // 불덩이 (2026-10-02 리워크, 예전 '불') — 돌처럼 던지는데 떨어지는 자리는 가시처럼 2×2칸 (칸 네 개가 만나는 점).
  // 떨어지는 순간 28, 불길 속에서 0.5초마다 6 × 5. 기력 5에 58 (희귀 ~11.6/기력 — 기준 그대로라 버프 없음)
  flame: {
    id: 'flame',
    name: '불덩이',
    icon: '🔥',
    grade: 'rare',
    energyCost: 5,
    type: 'attack',
    targeting: 'single',
    cast: 'fireball',
    effect: { damage: 28, dot: { dmgPerTick: 6, ticks: 5, tickInterval: 500 } },
    desc: '{st.cols}×{st.rows}칸 범위로 불덩이를 던진다. 떨어지는 순간 {e.damage} 피해, 이어서 불길 속에서 {sec(e.dot.tickInterval)}초마다 {e.dot.dmgPerTick} 피해 {e.dot.ticks}회 (총 {tot(e)}) · 힐 밴: 범위 안 상대 토템에 불이 붙어 타 버린다 · 내가 얼린 상대 타워에 떨어지면 불덩이 피해가 {S.iceFireCutPct}%만 들어가고 얼음이 반쯤 녹아 남은 동결 피해 {S.iceHalfMeltCutPct}% 감소 · 타는 동안 그 자리에 세운 상대 토템도 재가 된다 · 물(침수·파도)이 닿으면 꺼진다'
  },
  // 침수 — 물방울 리워크 (2026-10-01). 4×10칸 범위를 물이 위에서 아래로 1초 만에 쓸고 간다.
  // 물살이 닿는 순간 30, 다 흐른 뒤 잠긴 대상은 3초 동안 0.5초마다 5. 실제 시각은 board.js castFloodPlan
  wave: {
    id: 'wave',
    name: '침수',
    icon: '💧',
    grade: 'rare',
    energyCost: 14,
    type: 'attack',
    targeting: 'range3',
    cast: 'flood',
    effect: { damage: 30, dot: { dmgPerTick: 5, ticks: 6, tickInterval: 500 } },
    desc: '아무 진영에나 놓는다. {st.cols}×{st.rows}칸 범위에 물이 위에서 아래로 쏟아져 닿는 상대 대상에 {e.damage} 피해, 이어서 잠긴 대상은 반쯤 가라앉아 {sec(dotMs(e.dot))}초 동안 {sec(e.dot.tickInterval)}초마다 {e.dot.dmgPerTick} 피해 · 닿은 불을 끈다 · 침수당하는 동안 젖은 쪽의 회복(벚꽃·흰꽃·숲의정령)이 {S.soakHealPct}% 늘어난다 — 내 진영에 쓰면 내 회복이 는다'
  },
  // 가시 (2026-10-01 리워크) — 2×2칸. 타워 밑에서 가시가 튀어나와 박힌다
  thorn: {
    id: 'thorn',
    name: '가시',
    icon: '🌵',
    grade: 'rare',
    energyCost: 7,
    type: 'attack',
    targeting: 'single',
    cast: 'thorn',
    effect: { damage: 45, dot: { dmgPerTick: 7, ticks: 4, tickInterval: 500 } },
    desc: '{st.cols}×{st.rows}칸 범위. 땅에서 가시가 튀어나와 {e.damage} 피해, 박힌 채로 {sec(e.dot.tickInterval)}초마다 {e.dot.dmgPerTick} 피해 {e.dot.ticks}회 (총 {tot(e)}) · 상성: 범위 안 상대 토템(숲의정령·흰꽃)은 산산조각 나고, 가시가 박혀 있는 동안 그 자리에 세운 토템도 부서진다'
  },
  // 벽돌 — 내 타워 칸 하나에 놓으면 타워를 얇은 벽돌 방어막이 둘러싼다 (2026-10-02). 막는 방식은 그대로 40% · 6초
  brick: {
    id: 'brick',
    name: '벽돌',
    icon: '🧱',
    grade: 'rare',
    energyCost: 8,
    type: 'defense',
    targeting: 'single',
    cast: 'brickwall',
    effect: { damageReduction: { percent: 40, duration: 6000 } },
    desc: '내 타워 칸에 놓으면 타워를 둘러싼 벽돌 방어막이 {sec(e.damageReduction.duration)}초 동안 받는 피해 {e.damageReduction.percent}% 감소. 한 타워에 방어막은 하나 — 또 놓으면 {sec(e.damageReduction.duration)}초 연장'
  },
  cherry_blossom: {
    cast: 'blossom',
    id: 'cherry_blossom',
    name: '벚꽃',
    icon: '🌸',
    grade: 'rare',
    energyCost: 9,
    type: 'heal',
    targeting: 'single',
    effect: { hot: { healPerTick: 15, ticks: 5, tickInterval: 1000 } },
    desc: '단일 {sec(dotMs(e.hot))}초간 {per(e.hot.tickInterval)} {e.hot.healPerTick} 치유 (총 {tot(e)})'
  },

  // ── 에픽 ───────────────────────────────────────────────
  lightning: {
    id: 'lightning',
    name: '번개',
    icon: '⚡',
    grade: 'epic',
    energyCost: 15,
    type: 'attack',
    targeting: 'range3',
    effect: { dot: { dmgPerTick: 12, ticks: 4, tickInterval: 1000 } },
    desc: '범위(3) {sec(dotMs(e.dot))}초간 {per(e.dot.tickInterval)} {e.dot.dmgPerTick} 피해 (총 {tot(e)}) · 감전: 물(침수·파도 · 폭염에 녹은 얼음물)에 젖은 타워는 {S.zapPct}% 더'
  },
  forest_spirit: {
    cast: 'forest',
    id: 'forest_spirit',
    name: '숲의정령',
    icon: '🌳',
    grade: 'epic',
    energyCost: 20,
    type: 'heal',
    targeting: 'range3',
    effect: { hot: { healPerTick: 15, ticks: 5, tickInterval: 1000 } },
    desc: '범위(3) {sec(dotMs(e.hot))}초간 {per(e.hot.tickInterval)} {e.hot.healPerTick} 치유 (총 {tot(e)})'
  },
  starlight_burst: {
    id: 'starlight_burst',
    name: '별빛폭발',
    icon: '💫',
    grade: 'epic',
    energyCost: 20,
    type: 'attack',
    targeting: 'range3',
    effect: { dot: { dmgPerTick: 12, ticks: 5, tickInterval: 1000 } },
    desc: '범위(3) {sec(dotMs(e.dot))}초간 {per(e.dot.tickInterval)} {e.dot.dmgPerTick} 피해 (총 {tot(e)})'
  },
  pumpkin_carriage: {
    id: 'pumpkin_carriage',
    name: '호박마차',
    icon: '🎃',
    grade: 'epic',
    energyCost: 20,
    type: 'defense',
    targeting: 'single',
    effect: { energyBurst: { perTick: 10, ticks: 5, interval: 1000 } },
    desc: '{sec(e.energyBurst.ticks * e.energyBurst.interval)}초간 {per(e.energyBurst.interval)} 에너지 {e.energyBurst.perTick} 충전 (에너지 바 주황색)'
  },

  // ── 에픽 진화 ─────────────────────────────────────────
  starlight_burst_evo: {
    id: 'starlight_burst_evo',
    name: '별똥별',
    icon: '🌠',
    grade: 'epic',
    energyCost: 20,
    type: 'attack',
    targeting: 'range3',
    effect: {
      dot: [
        { dmgPerTick: 12, ticks: 5, tickInterval: 500 },
        { dmgPerTick: 27, ticks: 1, tickInterval: 2000 }
      ]
    },
    trait: { attackAmpPct: 20 },   // 특성: 사용 중 모든 어택 카드 피해 +20% (sync.js applyCardUse · effects.js)
    desc: '범위(3) {sec(e.dot[0].tickInterval)}초마다 {e.dot[0].dmgPerTick} 피해({e.dot[0].ticks}회, 총 {e.dot[0].dmgPerTick * e.dot[0].ticks}) + {sec(e.dot[1].tickInterval)}초 후 즉발 {e.dot[1].dmgPerTick} 피해 | 특성: 사용 중 모든 어택 카드 피해 +{card.trait.attackAmpPct}%',
    isEvolution: true
  },

  // ── 신화 ───────────────────────────────────────────────
  black_hole: {
    id: 'black_hole',
    name: '블랙홀',
    icon: '🕳️',
    grade: 'mythic',
    energyCost: 25,
    type: 'attack',
    targeting: 'range3',
    effect: { dot: { dmgPerTick: 14, ticks: 5, tickInterval: 1000 } },
    desc: '범위(3) {sec(dotMs(e.dot))}초간 {per(e.dot.tickInterval)} {e.dot.dmgPerTick} 피해 (총 {tot(e)})'
  },
  nightmare: {
    id: 'nightmare',
    name: '악몽',
    icon: '😱',
    grade: 'mythic',
    energyCost: 22,
    type: 'control',
    targeting: 'range3',
    effect: { damageAmp: { percent: 35, duration: 8000 } },
    desc: '범위(3) 적 타워 받는 피해 {e.damageAmp.percent}% 증가 ({sec(e.damageAmp.duration)}초)'
  },
  // 얼음전개 (2026-10-02 리워크) — 4×4칸을 얼린다 (board.js CAST_STYLES.icefield · castIcePlan).
  // 언 타워는 10초 동안 1초마다 12 (실효 2타워 240) + 상대 덱 10초 동결 + 유닛 기절이라 기력 30 → 40
  ice_deploy: {
    id: 'ice_deploy',
    name: '얼음전개',
    icon: '❄️',
    grade: 'mythic',
    energyCost: 40,
    type: 'control',
    targeting: 'single',
    cast: 'icefield',
    effect: { freeze: { duration: 10000 }, dot: { dmgPerTick: 12, ticks: 10, tickInterval: 1000 }, deckFreeze: { duration: 10000 } },
    desc: '{st.cols}×{st.rows}칸 범위의 모든 대상을 얼린다 — 타워는 밑동부터 꼭대기까지 얼음이 차올라 {sec(e.freeze.duration)}초 동안 {sec(e.dot.tickInterval)}초마다 {e.dot.dmgPerTick} 피해, 언 타워가 있으면 상대 카드 덱 {sec(e.deckFreeze.duration)}초 동결 (어떤 카드도 못 쓴다). 바닥 얼음은 타워가 다 얼면 사라진다. 소환 유닛은 그동안 기절'
  },
  viper: {
    id: 'viper',
    name: '독사',
    icon: '🐍',
    grade: 'mythic',
    energyCost: 35,
    type: 'attack',
    targeting: 'single',
    effect: {
      damage: 120,
      dot: { dmgPerTick: 20, ticks: 5, tickInterval: 1000 },
      healReduction: { percent: 20, duration: 5000 }
    },
    desc: '단일 즉시 {e.damage} 피해 + {sec(e.dot.tickInterval)}초마다 {e.dot.dmgPerTick} 피해({e.dot.ticks}회) + 대상 힐량 {e.healReduction.percent}% 감소({sec(e.healReduction.duration)}초)'
  },
  mirror: {
    id: 'mirror',
    name: '반사',
    icon: '🪞',
    grade: 'mythic',
    energyCost: 30,
    type: 'defense',
    targeting: 'single',
    effect: { reflect: { percent: 80, duration: 6000 } },
    desc: '단일 {sec(e.reflect.duration)}초간 받은 피해 최초 1회 {e.reflect.percent}% 추가하여 적 킹에 반사'
  },

  // ── 전설 ───────────────────────────────────────────────
  dragon_breath: {
    id: 'dragon_breath',
    name: '용의숨결',
    icon: '🐉',
    grade: 'legendary',
    energyCost: 50,
    type: 'attack',
    targeting: 'single',
    effect: { dot: { dmgPerTick: 70, ticks: 5, tickInterval: 1000 } },
    desc: '단일 {sec(dotMs(e.dot))}초간 {per(e.dot.tickInterval)} {e.dot.dmgPerTick} 피해 (총 {tot(e)})'
  },
  safe_zone: {
    id: 'safe_zone',
    name: '안전지대',
    icon: '✨',
    grade: 'legendary',
    energyCost: 40,
    type: 'defense',
    targeting: 'range3',
    effect: { immunity: { duration: 5000 } },
    desc: '범위(3) {sec(e.immunity.duration)}초간 모든 피해 면역'
  },
  doom_seal: {
    id: 'doom_seal',
    name: '파멸의낙인',
    icon: '🔱',
    grade: 'legendary',
    energyCost: 40,
    type: 'control',
    targeting: 'single',
    effect: { damageAmp: { percent: 100, duration: 6000 } },
    desc: '단일 {sec(e.damageAmp.duration)}초간 적 타워 받는 피해 {e.damageAmp.percent}% 증가'
  },

  // ── 비밀 ───────────────────────────────────────────────
  apocalypse: {
    id: 'apocalypse',
    name: '아포칼립스',
    icon: '☄️',
    grade: 'secret',
    energyCost: 80,
    type: 'attack',
    targeting: 'range3',
    effect: { damage: 220 },
    desc: '상대 타워 3개 전부에 즉시 {e.damage} 피해 (총 {e.damage * 3})'
  },
  grim_reaper: {
    id: 'grim_reaper',
    name: '그림리퍼',
    icon: '💀',
    // 카드 면 전체 그림 (원본: 프로젝트 루트 Grim_Reaper1.png — 테두리 안쪽만 잘라 카드 비율로 줄인 것)
    art: 'img/cards/grim_reaper2.jpg',
    grade: 'secret',
    energyCost: 80,
    type: 'attack',
    targeting: 'single',
    // 소환 유닛 — 카드를 쓰면 두 화면에 컷씬이 뜨고(게임 시간 정지), 필드에 리퍼가 선다 (js/units.js · js/reaper3d.js)
    cast: 'reaper',
    effect: { summon: { unit: 'reaper', hp: 200, damage: 67, interval: 4000, maxSouls: 10, ghostDamage: 10 } },
    desc: '내 진영 칸에 그림리퍼(체력 {e.summon.hp}) 소환 — 같은 줄 상대 타워 앞까지 걸어가 {sec(e.summon.interval)}초마다 낫으로 {e.summon.damage} 피해, 벨 때마다 영혼 +1(최대 {e.summon.maxSouls}). 상대 리퍼와 만나면 서로 싸운다. 쓰러지면 영혼 수만큼 유령이 상대 진영에 솟아 타워에 닿으면 {e.summon.ghostDamage} 피해'
  }
};

// ── 카드 설명 채우기 (2026-10-04) ──────────────────────────────
// desc의 {식}은 카드 값으로 채운다 — 숫자를 설명에 따로 적지 않는다 (scripts/check.mjs가 다 채워지는지 본다).
//   e = 카드 effect · st = 시전 연출 설정(CAST_STYLES — caststyles.js) · S = SYNERGY · card = 카드
//   sec(ms) → 초 ('0.5' · '3') · per(ms) → '매초' | '0.5초마다' · dotMs(dot) → 전체 시간 · tot(e) → 피해(회복) 합
const _descFns = {};
const _descHelpers = {
  sec:   ms => String(Math.round(ms / 100) / 10),
  per:   ms => ms === 1000 ? '매초' : String(Math.round(ms / 100) / 10) + '초마다',
  dotMs: d => d.ticks * d.tickInterval,
  tot:   e => {
    const sum = (x, k) => (Array.isArray(x) ? x : x ? [x] : []).reduce((a, d) => a + d[k] * d.ticks, 0);
    return (e.damage || 0) + (e.heal || 0) + sum(e.dot, 'dmgPerTick') + sum(e.hot, 'healPerTick');
  },
};

/** 설명 템플릿을 채운다. 못 채운 자리는 그대로 둔다 (검사가 잡는다) */
function cardFillDesc(text, card) {
  if (!text || !card || !String(text).includes('{')) return text;
  const st = typeof CAST_STYLES !== 'undefined' && card.cast ? CAST_STYLES[card.cast] : undefined;
  return String(text).replace(/\{([^{}]+)\}/g, (m, expr) => {
    try {
      const fn = _descFns[expr] || (_descFns[expr] = new Function('e', 'st', 'S', 'card', 'sec', 'per', 'dotMs', 'tot', `return (${expr});`));
      const v = fn(card.effect || {}, st, SYNERGY, card, _descHelpers.sec, _descHelpers.per, _descHelpers.dotMs, _descHelpers.tot);
      return v == null || Number.isNaN(v) ? m : String(v);
    } catch { return m; }
  });
}

/**
 * 카드 면 그림이 있는 카드 — 그림이 이름·에너지·등급 표시까지 담고 있어서 기본 아이콘·글자를 가린다.
 * 덱·받을 카드·관전자 덱 모두 이것으로 붙인다 (DB에서 온 카드는 art가 없을 수 있어 정의에서 찾는다).
 */
function cardApplyArt(el, card) {
  const art = CARD_DEFINITIONS[card?.id]?.art || card?.art;
  if (!art) return;
  el.classList.add('card-art');
  // CSS 변수 속 url()은 스타일시트(css/) 기준으로 풀린다 — 문서 기준 절대 주소로 넘긴다
  el.style.setProperty('--card-art', `url("${new URL(art, document.baseURI).href}")`);
}

// 진화 매핑: 원본 cardId → 진화 cardId
const EVOLUTION_MAP = {
  wooden_sword:    'dual_sword',
  rock:            'rock_hell',
  wind:            'tornado',
  earthquake:      'collapse',
  arrow:           'love_arrow',
  wave:            'wave_evo',
  flame:           'fire_evo',
  brick:           'iron_wall',
  thorn:           'thorn_evo',
  cherry_blossom:  'cherry_blossom_evo',
  starlight_burst: 'starlight_burst_evo'
};

// 진화 카드 → 원본 카드 (진화로 태어난 카드인지 판별)
const EVOLUTION_ORIGIN = Object.fromEntries(Object.entries(EVOLUTION_MAP).map(([a, b]) => [b, a]));

// 등급별 카드 ID 목록 (진화 카드는 드로우 풀에서 제외)
const CARDS_BY_GRADE = {
  common:    ['wooden_sword', 'rock', 'wind', 'earthquake', 'arrow'],
  rare:      ['flame', 'wave', 'thorn', 'brick', 'cherry_blossom'],
  epic:      ['lightning', 'forest_spirit', 'starlight_burst', 'pumpkin_carriage'],
  mythic:    ['black_hole', 'nightmare', 'ice_deploy', 'viper', 'mirror'],
  legendary: ['dragon_breath', 'safe_zone', 'doom_seal'],
  secret:    ['apocalypse', 'grim_reaper']
};

/**
 * 카드 n장 뽑기 (등급 확률 적용, 중복 허용)
 * @param {number} count
 * @returns {Array<object>} 카드 정의 객체 배열
 */
function drawCards(count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    const grade  = weightedRandomGrade(GRADE_WEIGHTS);
    const pool   = CARDS_BY_GRADE[grade];
    const cardId = randomFrom(pool);
    result.push({ ...CARD_DEFINITIONS[cardId] });
  }
  return result;
}

/**
 * 타워 포지션 배열 반환 (범위 공격용)
 * @param {string} targetPos 'left'|'king'|'right'
 * @param {number} rangeCount 1|2|3
 * @returns {string[]}
 */
function getAffectedPositions(targetPos, rangeCount) {
  const ALL = ['left', 'king', 'right'];
  if (rangeCount === 1) return [targetPos];

  const idx = ALL.indexOf(targetPos);
  const positions = new Set([targetPos]);

  if (rangeCount >= 2) {
    if (idx > 0)                    positions.add(ALL[idx - 1]);
    else if (idx < ALL.length - 1)  positions.add(ALL[idx + 1]);
  }
  if (rangeCount >= 3) {
    ALL.forEach(p => positions.add(p));
  }

  return [...positions].slice(0, rangeCount);
}

/**
 * 카드 타겟 범위 수치 반환
 */
function getRangeCount(targeting) {
  if (targeting === 'single') return 1;
  if (targeting === 'range2') return 2;
  if (targeting === 'range3') return 3;
  return 1;
}
