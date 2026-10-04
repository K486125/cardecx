// ============================================================
//  caststyles.js — 카드 시전 연출 설정 (모양 · 범위 · 시각 · 그림)
//  카드의 피해 · 회복 · 지속 시간은 cards.js가 원본이다 — 여기서는 그 값을 가리키기만 한다 (_C).
//  cards.js 다음, board.js 앞에 읽는다. 로비(index.html)도 카드 설명을 채우려고 읽는다.
// ============================================================

const _C = CARD_DEFINITIONS;
/** 그 카드 지속 효과(dot · hot)가 도는 전체 시간 (ms) */
const _dotMs = id => _C[id].effect.dot.ticks * _C[id].effect.dot.tickInterval;
const _hotMs = id => _C[id].effect.hot.ticks * _C[id].effect.hot.tickInterval;

// ── 카드 시전 연출 (cards.js의 cast 값) ─────────────────────
// arcDeg: 부채꼴 각도(120° = 원의 1/3) · radius: 사거리(스테이지 px).
// 타워 세로 간격이 300px이라 사거리 260px이면 한 번에 한 타워만 들어온다.
// hitMs: 피해가 들어가는 시점 (휘두르기가 마무리되는 순간) · endMs: 연출 제거
// shape: 'fan' = 부채꼴 · 'lunge' = 일자 돌진 사거리(끝에 X자 범위)
// fx: 연출 그림 파일 — fx/ 폴더의 SVG 한 장이 연출 하나를 통째로 담는다.
//     w·h = 놓을 크기(스테이지 px) · hx·hy = 그 그림 안에서 타워 중심이 되는 점
// shape: 'fan' 부채꼴 · 'lunge' 일자 돌진 · 'circle' 원형 범위
//        'none'이면 사거리 표시 없이 평소처럼 카드가 커서를 따라다닌다 (단일 회복 등)
const CAST_STYLES = {
  // 목검 — 타일 한 칸 크기의 부채꼴(반지름 100). 단일 대상이다.
  // 예전 반지름 160은 '타워 발밑에 닿으면 맞는다'로 바뀐 뒤 두 타워 사이를 겨누면 둘 다 닿았다.
  // single: 닿은 타워가 둘이어도 가장 가까운 하나만 맞는다 (크기를 줄인 것에 더한 보증)
  // fx.scale: 베기 그림(초승달 반지름 150)을 범위 크기에 맞춰 줄인다 — 허공에 베면 범위 안에서 벤다
  sword: {
    shape: 'fan',   arcDeg: 120, radius: 100, hitMs: 300, endMs: 700, single: true,
    fx: { file: 'fx/sword.svg',     w: 600,  h: 400, hx: 300, hy: 200, scale: 0.62 }
  },
  // xMark — 직선 끝의 X자 범위. X자로 베는 카드는 듀얼 검뿐이라 여기만 켜 둔다
  // 폭 100 — 위아래 타워 발밑 사이 간격(128)보다 좁아서 두 타워에 동시에 닿지 않는다 (예전 160은 닿았다)
  // totemHit (2026-10-03 상성): 범위에 닿은 상대 토템도 대상 — 단일이라 토템과 타워 중 가까운 하나만.
  //   'slash' 토템을 베어 없앤다 · 'cut' 토템의 남은 시간을 TOTEM_CUT_MS 줄인다 (그만큼도 안 남았으면 무너진다)
  dualsword: {
    shape: 'lunge', band: 100,    radius: 330, hitMs: 500, endMs: 1400, xMark: true, single: true, totemHit: 'slash',
    fx: { file: 'fx/dualsword.svg', w: 1000, h: 420, hx: 700, hy: 210 }
  },
  // 회복은 '맞는 순간'이 없다 — 바로 들어가고(hitMs 0) 꽃잎만 피어난다
  blossom: {
    shape: 'towertile',                        hitMs: 0,   endMs: 1800,
    fx: { file: 'fx/blossom.svg',   w: 400,  h: 400, hx: 200, hy: 200 }
  },
  // 타일 맵 기준 타워 간격은 이웃까지 224, 반대쪽 끝까지 400.
  // 반지름 300이면 '가운데에 맞추면 3개, 위/아래에 맞추면 2개'가 된다 — 가운데에 놓도록 유도
  forest: {
    shape: 'circle',              radius: 300, hitMs: 0,   endMs: _hotMs('forest_spirit') + 400, lifeMs: _hotMs('forest_spirit'),   // lifeMs = 회복이 도는 시간 (카드의 hot)
    fx: { file: 'fx/forest.svg',    w: 800,  h: 800, hx: 400, hy: 400 }
  },
  // 흰꽃 — 숲의정령과 같은 토템 형태, 흰 꽃잎이 원을 따라 흩날린다
  whiteblossom: {
    shape: 'circle',              radius: 300, hitMs: 0,   endMs: _hotMs('cherry_blossom_evo') + 400, lifeMs: _hotMs('cherry_blossom_evo'),
    fx: { file: 'fx/whiteblossom.svg', w: 800, h: 800, hx: 400, hy: 400 }
  },
  // 돌 — 투척. 다른 연출과 달리 SVG 두 장이다:
  //   fx     = 날아가는 돌 (회전은 무한 반복이라 어떤 비행 시간에도 맞는다)
  //   impact = 착지해서 깨지는 순간
  // 궤적은 board.js가 포물선으로 그린다 — 비행 시간이 차징에 따라 달라지기 때문이다.
  stone: {
    shape: 'throw',
    // 착지 = 커서가 가리키는 타일 한 칸 (2026-09-29: 원형 2×2칸 → 타일 한 칸).
    // 그 칸에 선 타워만 맞는다. 조준 표시도 칸에 딱 맞는 네모다 (_stoneTile).
    // radius는 깨지는 그림의 크기 기준으로만 쓴다 (_stoneImpact) — 타일 반 폭
    radius: 50,
    reach:  1400,    // 던질 수 있는 최대 거리 (맞는 쪽 킹 타워 기준으로 재지 않고 던지는 쪽에서 잰다)
    // 꾹 누른 시간 → 20%마다 한 단계. 세게 던질수록 아프고 빠르다 (2026-10-03: 예전엔 셀수록 느렸다).
    // 차징 없이 툭 던지면 천천히 날아가 덜 아프다
    charge: {
      fullMs: 2000,                              // 가득 차기까지
      steps:  5,                                 // 0 / 20 / 40 / 60 / 80 / 100 %
      damage: [_C.rock.effect.damage, 24, 27, 31, 35, 40],   // 0단계 = 카드 피해
      flyMs:  [2500, 2200, 2000, 1700, 1400, 1000]
    },
    hitMs: 2500,     // 0단계 기준 — 실제로는 단계별 flyMs를 쓴다
    endMs: 3350,     // 0단계 기준 — 비행 2.5초 + 깨짐 0.85초
    fx:     { file: 'fx/stone.svg',        w: 220, h: 220, hx: 110, hy: 110 },
    // 깨짐은 두 장 — 바닥에 눕는 부분(먼지·균열·충격 고리)과 서 있는 부분(섬광·파편)
    impact: { file: 'fx/stone-impact.svg', w: 440, h: 440, hx: 220, hy: 220 },
    impactGround: { file: 'fx/stone-impact-ground.svg', w: 440, h: 440, hx: 220, hy: 220, reach: 180 }
  },
  // 바람 스매시 — 앞으로 두 타일(200px) 길이의 일자. 타워 하나만 친다
  windsmash: {
    shape: 'lunge', band: 100, radius: 200, hitMs: 200, endMs: 400, single: true, totemHit: 'cut',
    fx: { file: 'fx/windsmash.svg', w: 560, h: 400, hx: 420, hy: 200 }
  },
  // 토네이도 — 바람의 진화. 내 진영 타일에 설치하면 일자로 전진해 타워를 친다.
  // 멀리서 올수록 크고(타워 둘까지 닿고) 빠르고 아프다. 값은 아래 tornado* 함수가 계산한다.
  tornado: {
    shape: 'tile',
    travelMs: 2800,                    // 어디서 놓든 도착까지 걸리는 시간 — 멀리서 오면 그만큼 빠르다
    hitMs: 2800, endMs: 3400,
    fx: { file: 'fx/tornado.svg', w: 400, h: 340, hx: 200, hy: 300 }
  },
  // 바위 지옥 — 돌의 진화. 차징 없이 세 덩이가 한 번에 날아가 타워 셋에 각각 떨어진다.
  // 멀리(오래) 날아가는 것일수록 아프고, 착지 뒤 튀는 돌가루도 더 아프고 더 빠르게 들어간다.
  // 타워 줄은 위에서부터 left(2행) · king(4행) · right(6행)이다.
  stonehell: {
    shape: 'throw3',
    radius: 50,      // 착지 원 — 돌과 같은 타워 한 칸 크기
    reach:  1400,
    shots: [
      { pos: 'left',  flyMs: 2000, damage: 14, dot: { dmgPerTick: 2, ticks: 3, tickInterval: 600 } },
      { pos: 'king',  flyMs: 2500, damage: 18, dot: { dmgPerTick: 3, ticks: 3, tickInterval: 500 } },
      { pos: 'right', flyMs: 3000, damage: 22, dot: { dmgPerTick: 3, ticks: 3, tickInterval: 400 } }
    ],
    hitMs: 2000,     // 첫 덩이가 닿는 시각
    endMs: 3850,     // 마지막 덩이 3.0초 + 깨짐 0.85초
    fx:     { file: 'fx/stone.svg',        w: 220, h: 220, hx: 110, hy: 110 },
    impact: { file: 'fx/stone-impact.svg', w: 440, h: 440, hx: 220, hy: 220 },
    impactGround: { file: 'fx/stone-impact-ground.svg', w: 440, h: 440, hx: 220, hy: 220, reach: 180 }
  },
  // 지진 — 커서가 가리키는 칸을 가운데로 3×3칸. 범위에 든 타워는 전부 맞는다.
  // 0.7초 땅울림(hitMs) → 3초 동안 칸이 무너진다. 피해는 무너지는 동안 1초마다 (cards.js의 dot).
  // drops: 무너진 뒤 몇 ms에 한 단계씩 더 꺼지는가 — 지속 피해가 들어가는 순간에 맞췄다.
  // totemCut (2026-10-03 상성): 땅이 울리는 순간 범위 안 상대 토템의 남은 시간 -2초 (그만큼도 안 남았으면 무너진다)
  quake: {
    shape: 'area', cols: 3, rows: 3, totemCut: true,
    hitMs: 700, collapseMs: 3000, restoreMs: 360, endMs: 4060,
    drops: [{ at: 0, depth: 1 }, { at: 1000, depth: 2 }, { at: 2000, depth: 3 }]
  },
  // 붕괴 — 지진의 진화. 3칸 폭 × 10칸 높이인데 맵이 9칸이라 세로는 맵 전체다 → 타워 셋에 다 닿는다.
  // 0.5초 땅울림 → 한 번에 크게 꺼지며 즉시 피해.
  // totemBreak: 범위 안의 토템을 무너뜨린다. lockMs: 무너진 뒤에도 이만큼은 새로 세운 토템이 곧바로 무너진다.
  collapse: {
    shape: 'area', cols: 3, rows: 10,
    hitMs: 500, collapseMs: 1500, restoreMs: 420, endMs: 2420,
    drops: [{ at: 0, depth: 3.4 }],
    totemBreak: true, lockMs: SYNERGY.totemLockMs
  },
  // 화살 — 커서(활 자리)에서 앞으로 radius(3칸) 길이, band(1칸) 폭의 일자 사거리.
  // 날아가다 처음 닿는 타워 하나에 꽂힌다. 사거리 끝까지 늘 flyMs(1.2초)라, 가까운 타워일수록 빨리 맞는다.
  // Space 차징 — 2초에 6단계, 피해만 오르고 속도는 같다.
  arrow: {
    shape: 'shot', band: 100, radius: 300, flyMs: 1200, single: true,
    charge: { fullMs: 2000, steps: 6, damage: [_C.arrow.effect.damage, 24, 27, 30, 33, 36, 39] },   // 0단계 = 카드 피해
    hitMs: 1200, endMs: 1600
  },
  // 사랑의 화살 — 화살의 진화. 차징 없이 1초에 3칸. 내 진영에서 쏘면 왼쪽(내 타워 쪽)으로 날아간다.
  // 연출 id에 '@1'이 붙으면 회복(내 타워), 없으면 공격 — 상대·관전 화면은 누구 타워인지로는 알 수 없다
  // healBurstMs: 회복은 꽂힌 뒤 타워 위 하트가 부풀어 올라 터지는 순간 들어간다 (towers3dLoveHeal이 이만큼 뒤에 터진다)
  lovearrow: {
    shape: 'shot', band: 100, radius: 300, flyMs: 1000, single: true, love: true, healBurstMs: 1100,
    hitMs: 1000, endMs: 2000
  },
  // 그림리퍼 — 칸 하나에 소환한다 (js/units.js). 연출은 두 화면 공통 컷씬 + 필드의 유닛이라 여기엔 그림이 없다
  reaper: {
    shape: 'summon', hitMs: 0, endMs: 0
  },
  // 침수 — 물방울 리워크 (2026-10-01). 4칸 폭 × 10칸 높이(맵이 9칸이라 세로 전체).
  // 맨 위 줄에서 맨 아래 줄까지 물이 1초 만에 쏟아져 흐른다 — 물살이 그 줄에 닿는 순간 30 (즉시).
  // 다 흐르면 범위가 잠기고 그 안의 타워는 반쯤 가라앉는다 — 3초 동안 0.5초마다 5.
  flood: {
    shape: 'area', cols: 4, rows: 10,
    flowMs: 1000, sinkMs: 3000, drainMs: 700,
    hitMs: 1000, endMs: 4700,
    flood: { impact: _C.wave.effect.damage, dot: _C.wave.effect.dot },
    // 침수에 든 유닛(그림리퍼·유령)은 물이 빠질 때까지 기절 — 걷던 중이면 멈추고, 휘두르던 중이면 낫이 멈춘다
    unitStun: true,
  },
  // 파도 — 침수의 진화. 3칸 폭 × 10칸 높이(세로 전체). 2026-10-02부터 아무 열에나 놓는다 (늘 상대 진영 끝으로 밀려간다).
  // 물의 회복 버프는 상대의 회복에만 걸리므로 내 진영에서 출발해도 남용할 수 없다
  // 솟구친 뒤(riseMs) 맵 끝까지 밀려가며, 그 안에 든 대상은 0.5초마다 22. 끝에 닿으면 잦아들고 말라 사라진다.
  wave: {
    shape: 'wave', cols: 3,
    riseMs: 700, speed: 2, tickMs: _C.wave_evo.effect.dot.tickInterval, damage: _C.wave_evo.effect.dot.dmgPerTick, calmMs: 2600,
    hitMs: 700, endMs: 9000,     // 실제 길이는 놓은 열에 따라 — castWavePlan().endMs
    // 파도에 닿은 유닛은 둔화 — 마지막으로 닿은 뒤 slowMs 동안 걸음·낫이 slowK 배 빠르기
    slowMs: 2000, slowK: 0.5,
  },
  // 가시 (2026-10-01) — 2×2칸. 그 칸들의 땅에서 가시가 튀어나와 타워를 꿰뚫는다.
  // 튀어나오는 순간(hitMs) 45, 이어서 0.5초마다 7 × 4 (박힌 채로). 범위 안 소환 유닛도 같은 시각 같은 피해
  thorn: {
    shape: 'area', cols: 2, rows: 2,
    hitMs: 420, endMs: 2700,
    thorn: { impact: _C.thorn.effect.damage, dot: _C.thorn.effect.dot },
  },
  // 톱 (가시의 진화, 2026-10-01 · 2026-10-03 리워크) — 커서에서 reach 안의 가장 가까운 대상(상대 타워 · 상대 토템) 하나.
  // 그 대상이 강조되고, 클릭하면 바로 그 대상에게 커서 쪽에서 날아들어 썰기 시작한다 (차징 · 게이지 없음).
  // 대상이 커서보다 조금 위나 아래에 있어도 커서에서 본 방향 그대로 다가가 썬다.
  // 타워: 끝까지(6초) 저절로 썬다 — 0.5초마다 7 (12번 = 84). 토템: totemCutMs 만에 잘려 넘어간다 (톱은 거기서 끝)
  saw: {
    shape: 'nearest', reach: 220, single: true,
    hitMs: 260, endMs: 6600, totemCutMs: 1100,
    saw: { holdMs: _dotMs('thorn_evo'), tickMs: _C.thorn_evo.effect.dot.tickInterval, damage: _C.thorn_evo.effect.dot.dmgPerTick },
  },
  // 불덩이 (2026-10-02) — 돌처럼 던진다(사거리 reach). 떨어지는 자리는 가시처럼 2×2칸 —
  // 커서에 가장 가까운 '칸 네 개가 만나는 점'이 한가운데다. 포물선도 그 점에서 끝난다.
  // 떨어지는 순간(flyMs) 28, 그 칸들이 불타는 동안 0.5초마다 6 × 5.
  fireball: {
    shape: 'throw', area: true, cols: 2, rows: 2,
    reach: 1400, flyMs: 1100,
    hitMs: 1100, burnMs: 2700, endMs: 4100,
    burn: { impact: _C.flame.effect.damage, dot: _C.flame.effect.dot },
  },
  // 폭염 (불덩이의 진화, 2026-10-02) — 3×7칸. 열기가 모여(hitMs) 범위 전체가 한 번 폭발 49 →
  // 그 안의 대상이 불타며(burnMs) 0.5초마다 9 × 5 → 이어서 열기(heatMs)가 올라오는 동안
  // 그 칸의 모든 대상(타워·소환 유닛)이 더위 — 모든 카드 피해 +heatPercent% (sync.js heatZones)
  heatwave: {
    shape: 'area', cols: 3, rows: 7,
    hitMs: 700, burnMs: 2600, heatMs: 6000, heatPercent: 15,
    endMs: 9800,
    blast: { impact: _C.fire_evo.effect.damage, dot: _C.fire_evo.effect.dot },
  },
  // 벽돌 · 철벽 (2026-10-02) — 벚꽃처럼 내 타워 칸 하나에 놓는다. 타워를 얇은 벽이 둘러싼다 (towers3dWallShield).
  // 막는 값은 카드의 damageReduction — 벽은 그 시간(endMs) 동안 서 있다
  brickwall: { shape: 'towertile', hitMs: 0, endMs: _C.brick.effect.damageReduction.duration,     wall: 'brick' },
  ironwall:  { shape: 'towertile', hitMs: 0, endMs: _C.iron_wall.effect.damageReduction.duration, wall: 'iron' },
  // 얼음전개 (2026-10-02 리워크) — 4×4칸. 바닥에 서리가 번지고(hitMs) 그 안의 대상이 모두 얼어붙는다.
  // 타워는 아래서부터 위까지 얼음이 차오르고, 얼어 있는 동안(freezeMs) 1초마다 12. 언 타워가 있으면 상대 덱도 10초 동결.
  // 유닛은 그동안 기절하고 같은 피해. 바닥의 얼음 결정은 타워가 다 얼어붙으면(climbMs) 꺼져 사라진다
  icefield: {
    shape: 'area', cols: 4, rows: 4,
    hitMs: 900, climbMs: 900, freezeMs: _C.ice_deploy.effect.freeze.duration, endMs: _C.ice_deploy.effect.freeze.duration + 1200,
    ice: { dps: _C.ice_deploy.effect.dot.dmgPerTick, ticks: _C.ice_deploy.effect.dot.ticks, tickInterval: _C.ice_deploy.effect.dot.tickInterval,
           deckFreezeMs: _C.ice_deploy.effect.deckFreeze.duration },
  },
};
