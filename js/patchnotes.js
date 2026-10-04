// ============================================================
//  patchnotes.js — 밸런스 패치 노트 · 카드 확률 안내 (닉네임 화면의 버튼 → 창)
//  카드 아이콘·이름은 cards.js의 CARD_DEFINITIONS에서 가져온다.
//  새 패치는 PATCH_NOTES 맨 앞에 넣는다 (가장 최근 것이 위).
//
//  줄 하나: { id: 카드 id, kind: 'up'|'down'|'adjust'|'rework', changes: [[이름, 전, 후], …] | note: '설명' }
// ============================================================

const PATCH_NOTES = [
  {
    title: '패치 10 — 화상 · AI 토템 상성',
    date: '2026.10.04',
    groups: [
      {
        name: '불 · 물',
        rows: [
          { id: 'fire_evo', kind: 'rework', note: '폭염을 맞은 소환 유닛에 불이 붙는다(화상) — 걸어서 불 밖으로 나가도 0.5초마다 9 × 5가 따라다니며 탄다. 물(침수 · 파도 · 녹은 얼음물)에 닿으면 김을 내며 꺼진다' },
          { id: 'flame',    kind: 'rework', note: '불덩이도 같다 — 떨어지는 순간의 28은 피할 수 없지만, 붙은 불(0.5초마다 6 × 5)은 물로 끌 수 있다' },
          { id: 'wave',     kind: 'adjust', note: '침수 · 파도는 불과 더위(열기)를 함께 끈다 — 유닛에 붙은 불도' },
        ],
      },
      {
        name: 'AI',
        rows: [
          { id: 'dual_sword', kind: 'adjust', note: 'AI도 토템 상성을 쓴다 — 듀얼 검 · 톱으로 토템을 없애고, 바람으로 남은 시간을 줄이며, 지진 · 가시 · 불 · 붕괴는 범위에 든 토템까지 셈한다' },
          { id: 'thorn_evo',  kind: 'adjust', note: 'AI의 톱도 필드 가운데 쪽에서 비스듬히 다가가 썬다' },
        ],
      },
    ],
  },
  {
    title: '패치 9 — 크리티컬 숫자 · 섬 가장자리',
    date: '2026.10.03',
    groups: [
      {
        name: '화면',
        rows: [
          { id: 'rock',    kind: 'adjust', note: '크리티컬 — 기본보다 크게 들어간 피해는 숫자가 황금색이다 (테두리는 그대로). 돌 · 화살 차징, 토네이도 최고 피해(40), 악몽 · 파멸의 낙인 · 더위 · 쇄빙 같은 증폭으로 더 들어간 피해와 지속 피해 틱 모두' },
          { id: 'tornado', kind: 'adjust', note: '필드를 둘러싼 돌벽이 잔디 블록 섬 가장자리로 바뀌었다 (높이는 그대로) — 덤불 · 꽃 · 돌 · 풀포기, 바다 쪽 낮은 턱' },
        ],
      },
    ],
  },
  {
    title: '패치 8 — 토템 상성 · 돌 차징',
    date: '2026.10.03',
    groups: [
      {
        name: '토템 상성 (숲의정령 · 흰꽃)',
        rows: [
          { id: 'dual_sword', kind: 'rework', note: '범위에 닿은 상대 토템이 타워보다 가까우면 토템을 베어 없앤다 (회복 멈춤). 단일 대상이라 토템을 베면 타워는 맞지 않는다' },
          { id: 'earthquake', kind: 'rework', note: '땅울림 순간 범위 안 상대 토템의 남은 시간 -2초 — 2초 이하로 남았으면 바로 무너지고 회복도 멈춘다. 공격은 그대로' },
          { id: 'wind',       kind: 'rework', note: '상대 토템이 더 가까우면 토템을 쳐 남은 시간 -2초 (2초 이하면 무너진다). 단일 대상이라 토템을 치면 타워 피해 · 에너지 깎기는 없다' },
        ],
      },
      {
        name: '돌',
        rows: [
          { id: 'rock', kind: 'rework', note: '차징할수록 빠르게 날아간다 — 풀차징 1초, 차징 없이 2.5초 (예전엔 반대). 피해는 그대로 차징할수록 크다 (20 → 40)' },
        ],
      },
    ],
  },
  {
    title: '패치 7 — 톱 개편 · 가시 · 톱 상성',
    date: '2026.10.03',
    groups: [
      {
        name: '톱',
        rows: [
          { id: 'thorn_evo', kind: 'rework', note: '차징 · 게이지 없음 — 클릭하면 바로 썬다. 커서 가까이(2칸 남짓)의 가장 가까운 대상 하나가 강조되고, 조금 위·아래에 있어도 커서 쪽에서 비스듬히 다가가 썬다. 피해 · 틱은 그대로 (0.5초마다 7, 6초)' },
          { id: 'thorn_evo', kind: 'rework', note: '상성 — 상대 토템(숲의정령 · 흰꽃)을 겨누면 1초 남짓 만에 나무가 반토막 나 쓰러지고 풀이 잘려 나간다 (회복 멈춤). 단일 대상이라 토템을 썰면 톱은 거기서 끝' },
        ],
      },
      {
        name: '가시',
        rows: [
          { id: 'thorn', kind: 'rework', note: '상성 — 범위 안 상대 토템이 산산조각 난다. 가시가 박혀 있는 동안(약 2.3초) 그 자리에 세운 토템도 곧바로 부서진다' },
        ],
      },
    ],
  },
  {
    title: '패치 6 — 얼음 연장 · 토템 쓰러짐',
    date: '2026.10.03',
    groups: [
      {
        name: '조정',
        rows: [
          { id: 'ice_deploy', kind: 'adjust', note: '이미 언 타워에 또 쓰면 다시 얼지 않고 남은 동결 시간에 10초가 더해진다 (차오른 얼음 · 반쯤 녹은 정도는 그대로, 덱 동결도 함께 늘어난다)' },
          { id: 'wave_evo',   kind: 'adjust', note: '특성(사용 중 내 타워 불 피해 면역) 삭제 — 파도가 지나간 자리의 불을 직접 끄므로' },
          { id: 'collapse',   kind: 'adjust', note: '내 붕괴는 내 토템을 부수지 않는다 — 맞는 쪽 진영의 토템만' },
          { id: 'tornado',    kind: 'adjust', note: '바람을 맞은 토템은 날아가지 않고 휘청이다 쓰러진다' },
        ],
      },
    ],
  },
  {
    title: '패치 5 — 얼음 · 물 · 불 상성 다듬기',
    date: '2026.10.02',
    groups: [
      {
        name: '얼음전개',
        rows: [
          { id: 'ice_deploy', kind: 'rework', note: '언 동안 상대는 덱의 어떤 카드도 쓸 수 없다 (불 카드 예외 삭제) — 얼음을 녹이는 건 얼린 쪽의 불뿐' },
          { id: 'ice_deploy', kind: 'adjust', note: '결빙(젖은 타워 18) 삭제 — 늘 1초마다 12. 바닥 얼음은 타워가 다 얼어붙으면 사라진다' },
          { id: 'flame',      kind: 'rework', note: '내가 얼린 상대 타워에 떨어지면 불덩이 피해 50% · 얼음이 반쯤 녹아 남은 동결 피해도 50%' },
          { id: 'fire_evo',   kind: 'rework', note: '내가 얼린 상대 타워는 폭염 피해 없이 얼음이 다 녹는다. 녹은 물이 3×3칸에 3초 고여 젖는다 (번개 감전 · 그 동안 상대 회복 +50%)' },
          { id: 'earthquake', kind: 'rework', note: '쇄빙 — 언 타워에 30% 더 들어가고 얼음이 깨져 동결이 바로 풀린다 (붕괴 · 돌 · 바위 지옥도). 언 타워가 다 풀리면 덱 동결도 풀린다' },
        ],
      },
      {
        name: '물 · 불',
        rows: [
          { id: 'wave',     kind: 'rework', note: '내 진영에 써도 젖은 내 회복(벚꽃 · 흰꽃 · 숲의정령)이 50% 는다 — 침수당하는 동안만' },
          { id: 'wave_evo', kind: 'rework', note: '파도가 닿는 동안 젖은 쪽 회복 +50% (지나간 뒤 3초 더 젖어 있던 것 삭제)' },
          { id: 'flame',    kind: 'rework', note: '불이 타는 동안(2.8초) 그 자리에 세운 상대 토템은 재가 된다 — 물에 꺼지면 바로 풀린다' },
          { id: 'fire_evo', kind: 'rework', note: '불길이 타는 동안(2.6초) 그 자리에 세운 상대 토템은 재가 된다 — 이어지는 열기 속 토템은 말라 비틀어진다' },
        ],
      },
    ],
  },
  {
    title: '패치 4 — 카드 상성 · 얼음전개 · 타워 배치',
    date: '2026.10.02',
    groups: [
      {
        name: '토템 상성 (힐 밴)',
        rows: [
          { id: 'tornado',  kind: 'rework', note: '토네이도가 닿는 줄의 상대 토템(숲의정령·흰꽃)이 바람에 날아간다. 2초 동안은 그 자리에 새로 세운 토템도 날아간다 (붕괴와 같은 디버프)' },
          { id: 'flame',    kind: 'rework', note: '힐 밴 — 범위 안 상대 토템에 불이 붙어 타 버린다 (2초간 새 토템도). 내 진영에 던지면 내 토템은 타지 않는다' },
          { id: 'fire_evo', kind: 'rework', note: '힐 밴 — 범위 안 상대 토템이 타 버리고, 열기(더위) 속에서는 회복 25% 감소 · 토템은 말라 비틀어진다' },
        ],
      },
      {
        name: '물 상성',
        rows: [
          { id: 'wave',     kind: 'rework', note: '아무 진영에나 놓는다 (내 진영의 그림리퍼를 잡거나 내 타워의 불을 끈다). 내 타워 · 내 회복에는 아무 영향이 없다' },
          { id: 'wave_evo', kind: 'rework', note: '아무 열에나 놓는다 — 늘 상대 진영 끝까지 밀려간다' },
          { id: 'wave',     kind: 'rework', note: '물이 불덩이 · 폭염이 타는 자리에 닿으면 불이 꺼진다 — 남은 불 피해와 열기(더위)가 사라진다' },
          { id: 'cherry_blossom', kind: 'adjust', note: '상대의 침수 · 파도에 젖은 타워에 쓰면 회복 +50% (토템과 같다)' },
          { id: 'lightning', kind: 'up',    note: '감전 — 물에 젖은 타워에 50% 더' },
        ],
      },
      {
        name: '얼음전개 리워크',
        rows: [
          { id: 'ice_deploy', kind: 'rework', note: '4×4칸을 얼린다. 타워는 밑동부터 얼음이 차올라 10초 동안 1초마다 12 (젖은 타워는 결빙으로 18), 언 타워가 있으면 상대 덱 10초 동결 (불 카드만 쓸 수 있다). 소환 유닛은 기절' },
          { id: 'ice_deploy', kind: 'adjust', changes: [['비용', 30, 40], ['덱 동결', '7초', '10초']] },
          { id: 'flame',      kind: 'rework', note: '언 타워 근처에 떨어지면 얼음이 반쯤 녹아 남은 동결 피해 50% 감소' },
          { id: 'fire_evo',   kind: 'rework', note: '언 타워 근처에 터지면 얼음이 다 녹아 동결이 바로 풀리고 동결 피해도 사라진다 (덱 동결도 풀린다)' },
          { id: 'earthquake', kind: 'up',     note: '쇄빙 — 언 타워에 30% 더 (붕괴 · 돌 · 바위 지옥도)' },
        ],
      },
      {
        name: '화살 · 필드',
        rows: [
          { id: 'arrow',      kind: 'rework', note: '내 진영에서 쏘면 왼쪽으로 날아간다 — 내 타워는 지나치고 길의 상대 유닛만 맞힌다' },
          { id: 'love_arrow', kind: 'rework', note: '내 진영에서 쏘면 회복만 한다 (유닛은 맞지 않는다) — 그림리퍼는 상대 진영에서 쏴야 맞는다' },
          { id: 'grim_reaper', kind: 'adjust', note: '모든 타워가 두 칸씩 앞으로 (내 타워는 오른쪽, 상대 타워는 왼쪽). 내 타워 문도 상대 타워처럼 비스듬히 보인다' },
        ],
      },
    ],
  },
  {
    title: '패치 3 — 불덩이 · 폭염 · 벽돌 · 철벽',
    date: '2026.10.02',
    groups: [
      {
        name: '불 카드 리워크',
        rows: [
          { id: 'flame',    kind: 'rework', note: '이름 불 → 불덩이. 돌처럼 던지고 2×2칸에 떨어진다. 떨어지는 순간 28 + 불길 속 0.5초마다 6 × 5 (총 58)' },
          { id: 'flame',    kind: 'up',     changes: [['총 피해', 37, 58]] },
          { id: 'fire_evo', kind: 'rework', note: '진화 불꽃 → 폭염. 3×7칸 화염 폭발 49 → 불타며 0.5초마다 9 × 5 → 열기 6초 동안 그 칸의 대상이 더위(모든 카드 피해 +15%)' },
          { id: 'fire_evo', kind: 'adjust', changes: [['비용', 7, 20]] },
        ],
      },
      {
        name: '방어',
        rows: [
          { id: 'brick',     kind: 'rework', note: '내 타워 칸에 놓으면 타워를 얇은 벽돌 방어막이 둘러싼다 (피해 40% 감소 · 6초 그대로)' },
          { id: 'iron_wall', kind: 'rework', note: '벽돌처럼 놓는 강철 방벽. 직선 공격(화살·목검·듀얼 검·바람·토네이도·톱·파도)은 80%, 그 밖의 범위 공격은 50% 감소' },
          { id: 'iron_wall', kind: 'adjust', changes: [['비용', 10, 12], ['직선 공격 감소', '50%', '80%']] },
          { id: 'brick',     kind: 'rework', note: '한 타워에 방어막은 하나 — 벽돌을 또 놓으면 남은 시간에 6초 연장. 다른 타워에는 철벽을 따로 놓을 수 있다. 남은 시간은 타워 기둥 가운데 게이지로 (방패 아이콘 없앰)' },
          { id: 'iron_wall', kind: 'rework', note: '벽돌과 같은 규칙 — 한 타워에 하나, 또 놓으면 8초 연장, 기둥 가운데 게이지' },
        ],
      },
    ],
  },
  {
    title: '밸런스 패치 2 — 회복 · 방어 · 버프',
    date: '2026.10.01',
    groups: [
      {
        name: '회복',
        rows: [
          { id: 'cherry_blossom',     kind: 'up',     changes: [['비용', 12, 9], ['매초 회복', 11, 15]] },
          { id: 'cherry_blossom_evo', kind: 'down',   changes: [['비용', 12, 14], ['매초 회복', 25, 12]] },
          { id: 'forest_spirit',      kind: 'down',   changes: [['매초 회복', 24, 15]] },
        ],
      },
      {
        name: '방어 · 면역',
        rows: [
          { id: 'brick',     kind: 'up',     changes: [['비용', 11, 8], ['피해 감소', '30% · 5초', '40% · 6초']] },
          { id: 'iron_wall', kind: 'adjust', changes: [['비용', 11, 10], ['피해 감소', '60% · 10초', '50% · 8초']] },
          { id: 'mirror',    kind: 'up',     changes: [['비용', 35, 30], ['반사', '70% · 5초', '80% · 6초']] },
          { id: 'safe_zone', kind: 'up',     changes: [['비용', 50, 40]] },
        ],
      },
      {
        name: '딜 버퍼 · 비밀',
        rows: [
          { id: 'nightmare',  kind: 'adjust', changes: [['비용', 25, 22], ['받는 피해 증가', '30% · 10초', '35% · 8초']] },
          { id: 'doom_seal',  kind: 'up',     changes: [['비용', 50, 40], ['지속', '5초', '6초']] },
          { id: 'apocalypse', kind: 'up',     changes: [['타워마다 피해', 200, 220]] },
        ],
      },
    ],
  },
  {
    title: '밸런스 패치 1 — 공격 카드 대미지',
    date: '2026.10.01',
    groups: [
      {
        name: '일반 · 일반 진화',
        rows: [
          { id: 'wooden_sword', kind: 'up',   changes: [['피해', 10, 12]] },
          { id: 'wind',         kind: 'down', changes: [['피해', 28, 24]] },
          { id: 'earthquake',   kind: 'down', changes: [['매초 피해', 11, 9]] },
          { id: 'dual_sword',   kind: 'down', changes: [['총 피해', 44, 30]] },
          { id: 'rock_hell',    kind: 'down', changes: [['비용', 2, 3], ['피해', '30/40/50', '14/18/22'], ['돌가루', '5/6/7', '2/3/3']] },
          { id: 'tornado',      kind: 'down', changes: [['비용', 2, 3]] },
          { id: 'collapse',     kind: 'down', changes: [['피해', 55, 25]] },
          { id: 'love_arrow',   kind: 'down', changes: [['피해', 100, 70], ['회복', 100, 80]] },
        ],
      },
      {
        name: '희귀 · 희귀 진화',
        rows: [
          { id: 'flame',     kind: 'down', changes: [['즉시 피해', 30, 22]] },
          { id: 'fire_evo',  kind: 'down', changes: [['비용', 5, 7]] },
          { id: 'wave',      kind: 'down', changes: [['비용', 7, 14]] },
          { id: 'wave_evo',  kind: 'down', changes: [['비용', 7, 12]] },
          { id: 'thorn',     kind: 'up',   changes: [['비용', 10, 7]] },
          { id: 'thorn_evo', kind: 'up',   changes: [['비용', 10, 6]] },
        ],
      },
      {
        name: '에픽 · 신화 · 전설',
        rows: [
          { id: 'lightning',           kind: 'down', changes: [['매초 피해', 14, 12]] },
          { id: 'starlight_burst_evo', kind: 'down', changes: [['0.5초 피해', 22, 12], ['마무리 피해', 77, 27]] },
          { id: 'black_hole',          kind: 'down', changes: [['매초 피해', 30, 14]] },
          { id: 'viper',               kind: 'up',   changes: [['즉시 피해', 100, 120]] },
          { id: 'dragon_breath',       kind: 'up',   changes: [['매초 피해', 55, 70]] },
        ],
      },
    ],
  },
  {
    title: '카드 리워크',
    date: '2026.10.01',
    groups: [
      {
        name: '새 방식',
        rows: [
          { id: 'thorn',       kind: 'rework', note: '2×2칸 범위 — 땅에서 가시가 튀어나와 45, 박힌 채 0.5초마다 7 × 4' },
          { id: 'thorn_evo',   kind: 'rework', note: '일자 범위 — 좌클릭 0.5초 꾹 누르면 시작, 6초 동안 저절로 톱질 (게이지 100% → 0%) · 0.5초마다 7' },
          { id: 'wave',        kind: 'rework', note: '물방울 → 침수. 물살 30 + 가라앉는 동안 5 × 6 · 그림리퍼 기절 · 젖은 상대 토템 회복 +50%' },
          { id: 'wave_evo',    kind: 'rework', note: '상대 진영 맨 앞에서 출발해 맵 끝까지 · 0.5초마다 22 · 그림리퍼 둔화' },
          { id: 'grim_reaper', kind: 'rework', note: '처음엔 옆 타워 줄에만 소환 (옆 타워가 모두 무너지면 킹 줄도)' },
        ],
      },
    ],
  },
];

const PATCH_KIND = {
  up:     { label: '상향', icon: '▲' },
  down:   { label: '하향', icon: '▼' },
  adjust: { label: '조정', icon: '◆' },
  rework: { label: '변경', icon: '↻' },
};

function _pnEsc(v) {
  return String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function _pnRow(row) {
  const card = (typeof CARD_DEFINITIONS !== 'undefined' && CARD_DEFINITIONS[row.id]) || {};
  const name = typeof tCard === 'function' ? (tCard(row.id, 'name') || card.name || row.id) : (card.name || row.id);
  const kind = PATCH_KIND[row.kind] || PATCH_KIND.adjust;
  const body = row.note
    ? `<span class="pn-note">${_pnEsc(row.note)}</span>`
    : row.changes.map(([k, a, b]) =>
        `<span class="pn-chg"><em>${_pnEsc(k)}</em> <s>${_pnEsc(a)}</s><i>→</i><b>${_pnEsc(b)}</b></span>`).join('');
  return `<li class="pn-row pn-${row.kind} grade-${card.grade || 'common'}">
    <span class="pn-icon">${card.icon || '🃏'}</span>
    <span class="pn-main"><span class="pn-name">${_pnEsc(name)}</span><span class="pn-body">${body}</span></span>
    <span class="pn-badge"><i>${kind.icon}</i>${kind.label}</span>
  </li>`;
}

/** 창 머리 — 표 · 제목 · 닫기 */
function _pnHeadHtml(tag, title) {
  return `
    <div class="pn-head">
      <span class="pn-tag">${_pnEsc(tag)}</span>
      <span class="pn-title" id="pn-title">${_pnEsc(title)}</span>
      <button class="pn-close" type="button" aria-label="닫기">✕</button>
    </div>`;
}

/** 패치 노트 창의 속 — 머리 + 스크롤되는 본문 */
function _pnHtml() {
  return _pnHeadHtml('PATCH NOTES', '밸런스 패치 노트') + `
    <div class="pn-scroll">
      ${PATCH_NOTES.map(p => `
        <section class="pn-patch">
          <div class="pn-patch-head"><span class="pn-patch-title">${_pnEsc(p.title)}</span><span class="pn-date">${_pnEsc(p.date)}</span></div>
          ${p.groups.map(g => `
            <div class="pn-group">
              <div class="pn-group-name">${_pnEsc(g.name)}</div>
              <ul class="pn-list">${g.rows.map(_pnRow).join('')}</ul>
            </div>`).join('')}
        </section>`).join('')}
    </div>`;
}

/**
 * 안내 창을 띄운다 (패치 노트 · 카드 확률 공용) — 바깥(어두운 막)을 누르거나 ✕ · Esc로 닫는다.
 * 한 번에 하나만 뜬다.
 */
function _pnOpenModal(html, extraClass = '') {
  if (document.getElementById('pn-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'pn-modal';
  modal.className = 'pn-modal';
  modal.innerHTML = `<div class="pn-dialog patch-notes ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="pn-title">${html}</div>`;
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    modal.classList.add('pn-closing');
    setTimeout(() => modal.remove(), 160);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('.pn-close')) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(modal);
  modal.querySelector('.pn-close').focus();
}

function openPatchNotes() { _pnOpenModal(_pnHtml()); }

// ════════════════════════════════════════════════════════════
//  카드 확률 안내 — 게임이 실제로 뽑는 값(cards.js GRADE_WEIGHTS · CARDS_BY_GRADE)에서 바로 계산한다.
//  카드를 한 장 받을 때마다: 등급을 가중치로 고르고 → 그 등급 카드 중 하나를 같은 확률로 고른다 (중복 가능).
//  진화 카드는 뽑기에 나오지 않는다 — 같은 카드를 3번 쓰면 생긴다.
// ════════════════════════════════════════════════════════════
function _crPct(p) {
  if (p >= 10) return +p.toFixed(1) + '%';
  if (p >= 1)  return +p.toFixed(2) + '%';
  return +p.toPrecision(2) + '%';
}

function _crName(id) {
  const c = CARD_DEFINITIONS[id] || {};
  return typeof tCard === 'function' ? (tCard(id, 'name') || c.name || id) : (c.name || id);
}

function _crHtml() {
  const W = typeof GRADE_WEIGHTS !== 'undefined' ? GRADE_WEIGHTS : {};
  const total = Object.values(W).reduce((a, b) => a + b, 0) || 1;
  const label = g => (typeof GRADE_LABEL !== 'undefined' && GRADE_LABEL[g]) || g;
  const grades = Object.keys(W).filter(g => (CARDS_BY_GRADE[g] || []).length);
  const maxP = Math.max(...grades.map(g => W[g] / total * 100));
  const sections = grades.map(g => {
    const pool = CARDS_BY_GRADE[g];
    const gp = W[g] / total * 100;
    const each = gp / pool.length;
    const rows = pool.map(id => {
      const c = CARD_DEFINITIONS[id] || {};
      const evo = EVOLUTION_MAP[id];
      return `<li class="cr-row">
        <span class="pn-icon">${c.icon || '🃏'}</span>
        <span class="cr-main">
          <span class="pn-name">${_pnEsc(_crName(id))}</span>
          <span class="cr-sub">에너지 ${c.energyCost ?? '-'}${evo ? ` · 진화 → ${_pnEsc(_crName(evo))}` : ''}</span>
        </span>
        <span class="cr-pct">${_crPct(each)}</span>
      </li>`;
    }).join('');
    return `<section class="cr-grade cr-${g}">
      <div class="cr-grade-head">
        <span class="cr-star"></span>
        <span class="cr-grade-name">${_pnEsc(label(g))}</span>
        <span class="cr-grade-count">${pool.length}종</span>
        <span class="cr-grade-pct">${_crPct(gp)}</span>
      </div>
      <div class="cr-bar"><i style="width:${Math.max(1.5, gp / maxP * 100).toFixed(1)}%"></i></div>
      <ul class="pn-list">${rows}</ul>
    </section>`;
  }).join('');
  const evoRows = Object.entries(EVOLUTION_MAP).map(([from, to]) => {
    const c = CARD_DEFINITIONS[to] || {};
    return `<li class="cr-evo"><span class="pn-icon">${c.icon || '🃏'}</span>
      <span class="cr-main"><span class="pn-name">${_pnEsc(_crName(to))}</span>
      <span class="cr-sub">${_pnEsc(_crName(from))} 3번 사용</span></span></li>`;
  }).join('');
  return _pnHeadHtml('CARD RATES', '카드 확률 안내') + `
    <div class="pn-scroll">
      <p class="cr-intro">카드를 한 장 받을 때마다 <b>등급</b>이 아래 확률로 정해지고, 그 등급 안의 카드 중 하나가 <b>같은 확률</b>로 나옵니다. 같은 카드가 여러 번 나올 수 있습니다.</p>
      ${sections}
      <section class="cr-grade cr-evolve">
        <div class="cr-grade-head"><span class="cr-star"></span><span class="cr-grade-name">진화 카드</span><span class="cr-grade-pct">뽑기 없음</span></div>
        <p class="cr-intro">진화 카드는 뽑기에 나오지 않습니다. 같은 카드를 3번 쓰면 덱에 생깁니다.</p>
        <ul class="cr-evo-list">${evoRows}</ul>
      </section>
    </div>`;
}

function openCardRates() { _pnOpenModal(_crHtml(), 'card-rates'); }

function initPatchNotes() {
  [['btn-patch-notes', openPatchNotes], ['btn-card-rates', openCardRates]].forEach(([id, fn]) => {
    const btn = document.getElementById(id);
    if (btn && !btn.dataset.ready) {
      btn.dataset.ready = '1';
      btn.addEventListener('click', fn);
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPatchNotes);
else initPatchNotes();
