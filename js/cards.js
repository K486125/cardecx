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
 *   deckFreeze       → { duration(ms) }  덱 사용 금지
 *   percentDrain     → { damagePercent, healPercent }  현재 HP % 피해 + 킹 힐
 *   energyBurst      → { perTick, ticks, interval(ms) }  에너지 폭발 충전
 *   healReduction    → { percent, duration(ms) }  힐량 감소 디버프
 *   reflect          → { percent, duration(ms) }  피해 반사 방어막
 */
const CARD_DEFINITIONS = {

  // ── 일반 ───────────────────────────────────────────────
  wooden_sword: {
    id: 'wooden_sword',
    name: '목검',
    icon: '🗡️',
    grade: 'common',
    energyCost: 1,
    type: 'attack',
    targeting: 'single',
    effect: { damage: 10 },
    desc: '단일 대상 10 피해'
  },
  rock: {
    id: 'rock',
    name: '돌',
    icon: '🪨',
    grade: 'common',
    energyCost: 2,
    type: 'attack',
    targeting: 'single',
    effect: { damage: 25 },
    desc: '단일 대상 25 피해'
  },
  wind: {
    id: 'wind',
    name: '바람',
    icon: '🌬️',
    grade: 'common',
    energyCost: 2,
    type: 'attack',
    targeting: 'range2',
    effect: { dot: { dmgPerTick: 6, ticks: 3, tickInterval: 1000 } },
    desc: '범위(2) 3초간 매초 6 피해 (총 18)'
  },
  earthquake: {
    id: 'earthquake',
    name: '지진',
    icon: '💥',
    grade: 'common',
    energyCost: 3,
    type: 'attack',
    targeting: 'range2',
    effect: { dot: { dmgPerTick: 6, ticks: 4, tickInterval: 1000 } },
    desc: '범위(2) 4초간 매초 6 피해 (총 24)'
  },
  arrow: {
    id: 'arrow',
    name: '화살',
    icon: '🏹',
    grade: 'common',
    energyCost: 3,
    type: 'attack',
    targeting: 'single',
    effect: { dot: { dmgPerTick: 7, ticks: 5, tickInterval: 1000 } },
    desc: '단일 5초간 매초 7 피해 (총 35)'
  },

  // ── 진화 (일반 등급 카드 5회 사용 후 변환) ────────────
  dual_sword: {
    id: 'dual_sword',
    name: '듀얼 검',
    icon: '⚔️',
    grade: 'common',
    energyCost: 1,
    type: 'attack',
    targeting: 'single',
    effect: {
      dot: [
        { dmgPerTick: 15, ticks: 2, tickInterval: 500 },
        { dmgPerTick: 10, ticks: 3, tickInterval: 1000 }
      ]
    },
    desc: '단일 0.5초마다 15 피해(2회) + 1초마다 10 피해(3회) (총 60)',
    isEvolution: true
  },
  rock_hell: {
    id: 'rock_hell',
    name: '바위 지옥',
    icon: '<span class="evo-compound-icon">🪨<span class="devil-chip">😈</span></span>',
    grade: 'common',
    energyCost: 2,
    type: 'attack',
    targeting: 'range2',
    effect: { dot: { dmgPerTick: 11, ticks: 5, tickInterval: 1000 } },
    desc: '범위(2) 1초마다 11 피해(5회, 총 55)',
    isEvolution: true
  },
  strong_wind: {
    id: 'strong_wind',
    name: '강풍 주의',
    icon: '🍃',
    grade: 'common',
    energyCost: 2,
    type: 'attack',
    targeting: 'range3',
    effect: { dot: { dmgPerTick: 7, ticks: 7, tickInterval: 1000 } },
    desc: '범위(3) 1초마다 7 피해(7회, 총 49)',
    isEvolution: true
  },
  doom_fragment: {
    id: 'doom_fragment',
    name: '파멸 조각',
    icon: '🧩',
    grade: 'common',
    energyCost: 3,
    type: 'attack',
    targeting: 'range3',
    effect: { damage: 67 },
    desc: '범위(3) 즉시 67 피해',
    isEvolution: true
  },
  cupid_arrow: {
    id: 'cupid_arrow',
    name: '큐피트 화살',
    icon: '💘',
    grade: 'common',
    energyCost: 3,
    type: 'dual',
    targeting: 'single',
    effect: {
      dualEffect: {
        attack:  { dot: { dmgPerTick: 12, ticks: 5, tickInterval: 1000 } },
        support: { heal: 100 }
      }
    },
    desc: '적 타워: 1초마다 12 피해(5회, 총 60) / 내 타워: 즉시 100 치유',
    isEvolution: true
  },

  // ── 희귀 ───────────────────────────────────────────────
  flame: {
    id: 'flame',
    name: '불꽃',
    icon: '🔥',
    grade: 'rare',
    energyCost: 5,
    type: 'attack',
    targeting: 'range2',
    effect: { damage: 30, dot: { dmgPerTick: 5, ticks: 3, tickInterval: 1000 } },
    desc: '범위(2) 즉시 -30 피해 + 3초간 매초 5 피해'
  },
  wave: {
    id: 'wave',
    name: '파도',
    icon: '🌊',
    grade: 'rare',
    energyCost: 7,
    type: 'attack',
    targeting: 'range3',
    effect: { damage: 50 },
    desc: '범위(3) 50 피해'
  },
  thorn: {
    id: 'thorn',
    name: '가시',
    icon: '🌵',
    grade: 'rare',
    energyCost: 10,
    type: 'attack',
    targeting: 'single',
    effect: { dot: { dmgPerTick: 11, ticks: 6, tickInterval: 1000 } },
    desc: '단일 6초간 매초 11 피해 (총 66)'
  },
  iron_wall: {
    id: 'iron_wall',
    name: '철벽',
    icon: '🛡️',
    grade: 'rare',
    energyCost: 11,
    type: 'defense',
    targeting: 'single',
    effect: { damageReduction: { percent: 30, duration: 5000 } },
    desc: '단일 5초간 받는 피해 30% 감소'
  },
  cherry_blossom: {
    id: 'cherry_blossom',
    name: '벚꽃',
    icon: '🌸',
    grade: 'rare',
    energyCost: 12,
    type: 'heal',
    targeting: 'single',
    effect: { hot: { healPerTick: 11, ticks: 5, tickInterval: 1000 } },
    desc: '단일 5초간 매초 11 치유 (총 55)'
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
    effect: { dot: { dmgPerTick: 14, ticks: 4, tickInterval: 1000 } },
    desc: '범위(3) 4초간 매초 14 피해 (총 56)'
  },
  tornado: {
    id: 'tornado',
    name: '토네이도',
    icon: '🌪️',
    grade: 'epic',
    energyCost: 15,
    type: 'attack',
    targeting: 'single',
    effect: { dot: { dmgPerTick: 15, ticks: 5, tickInterval: 1000 } },
    desc: '단일 5초간 매초 15 피해 (총 75)'
  },
  forest_spirit: {
    id: 'forest_spirit',
    name: '숲의정령',
    icon: '🌳',
    grade: 'epic',
    energyCost: 20,
    type: 'heal',
    targeting: 'range3',
    effect: { hot: { healPerTick: 24, ticks: 5, tickInterval: 1000 } },
    desc: '범위(3) 5초간 매초 24 치유 (총 120)'
  },
  shadow_shield: {
    id: 'shadow_shield',
    name: '그림자실드',
    icon: '🌑',
    grade: 'epic',
    energyCost: 20,
    type: 'defense',
    targeting: 'single',
    effect: { shield: 75, shieldDecay: { rate: 5, interval: 1000 } },
    desc: '단일 보호막 75 부여 (초당 5씩 자동 감소, 중첩 불가)'
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
    desc: '범위(3) 5초간 매초 12 피해 (총 60)'
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
    desc: '5초간 매초 에너지 10 충전 (에너지 바 주황색)'
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
    effect: { dot: { dmgPerTick: 30, ticks: 5, tickInterval: 1000 } },
    desc: '범위(3) 5초간 매초 30 피해 (총 150)'
  },
  nightmare: {
    id: 'nightmare',
    name: '악몽',
    icon: '😱',
    grade: 'mythic',
    energyCost: 25,
    type: 'control',
    targeting: 'range3',
    effect: { damageAmp: { percent: 30, duration: 10000 } },
    desc: '범위(3) 적 타워 받는 피해 30% 증가 (10초)'
  },
  ice_deploy: {
    id: 'ice_deploy',
    name: '얼음전개',
    icon: '❄️',
    grade: 'mythic',
    energyCost: 30,
    type: 'control',
    targeting: 'single',
    effect: { deckFreeze: { duration: 7000 } },
    desc: '상대방 카드 덱 7초간 사용 금지'
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
      damage: 100,
      dot: { dmgPerTick: 20, ticks: 5, tickInterval: 1000 },
      healReduction: { percent: 20, duration: 5000 }
    },
    desc: '단일 즉시 100 피해 + 1초마다 20 피해(5회) + 대상 힐량 20% 감소(5초)'
  },
  mirror: {
    id: 'mirror',
    name: '반사',
    icon: '🪞',
    grade: 'mythic',
    energyCost: 35,
    type: 'defense',
    targeting: 'single',
    effect: { reflect: { percent: 70, duration: 5000 } },
    desc: '단일 5초간 받은 피해 최초 1회 70% 추가하여 적 킹에 반사'
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
    effect: { dot: { dmgPerTick: 55, ticks: 5, tickInterval: 1000 } },
    desc: '단일 5초간 매초 55 피해 (총 275)'
  },
  safe_zone: {
    id: 'safe_zone',
    name: '안전지대',
    icon: '✨',
    grade: 'legendary',
    energyCost: 50,
    type: 'defense',
    targeting: 'range3',
    effect: { immunity: { duration: 5000 } },
    desc: '범위(3) 5초간 모든 피해 면역'
  },
  celestial_wings: {
    id: 'celestial_wings',
    name: '천상의날개',
    icon: '🪶',
    grade: 'legendary',
    energyCost: 50,
    type: 'defense',
    targeting: 'range3',
    effect: { shield: 200, shieldDecay: { rate: 5, interval: 1000 } },
    desc: '범위(3) 보호막 200 부여 (초당 5씩 자동 감소, 중첩 불가)'
  },
  doom_seal: {
    id: 'doom_seal',
    name: '파멸의낙인',
    icon: '🔱',
    grade: 'legendary',
    energyCost: 50,
    type: 'control',
    targeting: 'single',
    effect: { damageAmp: { percent: 100, duration: 5000 } },
    desc: '단일 5초간 적 타워 받는 피해 100% 증가'
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
    effect: { damage: 200 },
    desc: '상대 타워 3개 전부에 즉시 200 피해 (총 600)'
  },
  grim_reaper: {
    id: 'grim_reaper',
    name: '그림리퍼',
    icon: '💀',
    grade: 'secret',
    energyCost: 80,
    type: 'attack',
    targeting: 'single',
    effect: { percentDrain: { damagePercent: 50, healPercent: 50 } },
    desc: '단일 적 타워 현재 체력의 50% 즉각 피해, 피해량의 50% 내 킹 타워 회복'
  }
};

// 진화 매핑: 원본 cardId → 진화 cardId
const EVOLUTION_MAP = {
  wooden_sword: 'dual_sword',
  rock:         'rock_hell',
  wind:         'strong_wind',
  earthquake:   'doom_fragment',
  arrow:        'cupid_arrow'
};

// 등급별 카드 ID 목록 (진화 카드는 드로우 풀에서 제외)
const CARDS_BY_GRADE = {
  common:    ['wooden_sword', 'rock', 'wind', 'earthquake', 'arrow'],
  rare:      ['flame', 'wave', 'thorn', 'iron_wall', 'cherry_blossom'],
  epic:      ['lightning', 'tornado', 'forest_spirit', 'shadow_shield', 'starlight_burst', 'pumpkin_carriage'],
  mythic:    ['black_hole', 'nightmare', 'ice_deploy', 'viper', 'mirror'],
  legendary: ['dragon_breath', 'safe_zone', 'celestial_wings', 'doom_seal'],
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
