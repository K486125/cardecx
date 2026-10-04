// Plan 3 2단계 — 지진(3×3칸, 0.7초 땅울림 → 3초 무너짐 · 1초마다 11) · 붕괴(3칸 폭 세로 전체, 0.5초 → 즉시 55, 토템 파괴)
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, mouse, click,
         startMatch, pickCard, tile } from './lib.mjs';

await resetDB();
const A = await launch('A', 9351), B = await launch('B', 9352);
const all = [A, B];
try {
  const code = await startMatch(A, B);
  const hp = (who, pos) => DBQ(`rooms/${code}/gameState/${who}/towers/${pos}/hp`);
  const hps = async who => ({ left: await hp(who, 'left'), king: await hp(who, 'king'), right: await hp(who, 'right') });

  // ════ 카드 정의 ═══════════════════════════════════════════════
  const defs = await A.json(`JSON.stringify({ eq: CARD_DEFINITIONS.earthquake, co: CARD_DEFINITIONS.collapse,
    old: !!CARD_DEFINITIONS.doom_fragment, evo: EVOLUTION_MAP.earthquake, name: tCard('collapse', 'name') })`);
  check('지진: 연출 quake · 1초마다 9 × 3', defs.eq.cast === 'quake' && defs.eq.effect.dot.dmgPerTick === 9 &&
        defs.eq.effect.dot.ticks === 3 && defs.eq.effect.dot.tickInterval === 1000, JSON.stringify(defs.eq.effect));
  check('진화: 파멸 조각은 없어지고 붕괴(25)로', !defs.old && defs.evo === 'collapse' && defs.co.effect.damage === 25 && defs.name === '붕괴');

  // ════ 붕괴 — 토템 파괴 ════════════════════════════════════════
  // B가 자기 진영(B 화면 2열 4행 = A 화면 13열 4행)에 숲의정령을 세운다
  await pickCard(B, 'forest_spirit');
  const bt = await tile(B, 2, 4);
  await mouse(B, 'mouseMoved', bt.x, bt.y); await sleep(150);
  await click(B, bt.x, bt.y);
  await waitFor(B, `Object.values(_effectsGameState?.dots || {}).some(d => d.type === 'heal' && d.totem)`, 4000);
  const dots0 = Object.values(await DBQ(`rooms/${code}/gameState/dots`) || {}).filter(d => d.type === 'heal');
  check('토템 회복 줄에 p1 기준 칸 표시 (13,4)', dots0.length > 0 && dots0.every(d => d.totem === '13,4'), JSON.stringify(dots0.map(d => d.totem)));
  await waitFor(A, `totemOnTile(13, 4)`, 3000);
  const tot0 = await A.json(`JSON.stringify({ a3d: typeof _t3dTotems !== 'undefined' ? _t3dTotems.length : -1,
    deco: !!document.querySelector('.cast-fx-ground[data-tile="13,4"]') })`);
  const totB0 = await B.evalJs(`_t3dTotems.length`);
  check('토템이 양쪽 화면에 섰다', tot0.deco && tot0.a3d === 1 && totB0 === 1, JSON.stringify({ tot0, totB0 }));

  await A.evalJs(`castResetCooldown(); addCardToDeck({ ...CARD_DEFINITIONS.collapse }); 1`);
  await waitFor(A, `_deckSlots.some(s => s && s.card && s.card.id === 'collapse')`, 5000);
  await sleep(300);
  const ci = await A.evalJs(`_deckSlots.findIndex(s => s && s.card && s.card.id === 'collapse')`);
  const cb = await (await import('./lib.mjs')).box(A, `#deck-slots .deck-slot[data-slot="${ci}"] .card`);
  await click(A, cb.x, cb.y); await sleep(220);
  const t134 = await tile(A, 12, 4);
  await mouse(A, 'mouseMoved', t134.x, t134.y); await sleep(200);
  const caim = await A.json(`(() => { const a = document.querySelector('#cast-ground .cast-area');
    return JSON.stringify({ l: parseFloat(a.style.left), t: parseFloat(a.style.top), w: parseFloat(a.style.width), h: parseFloat(a.style.height),
      hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id).sort() }); })()`);
  check('붕괴 조준: 3칸 폭 × 맵 세로 전체', caim.l === 1100 && caim.t === 0 && caim.w === 300 && caim.h === 900, JSON.stringify(caim));
  check('붕괴 조준: 타워 셋 모두 강조', caim.hl.length === 3, JSON.stringify(caim.hl));
  const c0 = await hps('p2');
  // 붕괴 중에 곧바로 세워 볼 토템 카드를 B에게 미리 쥐여 둔다 (고르는 데 걸리는 시간을 줄인다)
  await B.evalJs(`castResetCooldown(); addCardToDeck({ ...CARD_DEFINITIONS.forest_spirit }); 1`);
  await sleep(300);
  await click(A, t134.x, t134.y);
  await sleep(250);
  const c1 = await hps('p2');
  check('붕괴: 땅울림(0.5초) 동안은 피해 없음', c1.left >= c0.left && c1.king >= c0.king && c1.right >= c0.right, JSON.stringify({ c0, c1 }));
  check('붕괴 연출: 27칸', await A.evalJs(`document.querySelectorAll('.quake-area .quake-cell').length`) === 27);
  await sleep(420);
  const tot1 = await A.json(`JSON.stringify({ a3d: _t3dTotems.length, crumbling: _t3dCrumbles.length, onTile: totemOnTile(13, 4),
    deco: !!document.querySelector('.cast-fx-ground[data-tile="13,4"]:not(.totem-broken)') })`);
  const totB1 = await B.json(`JSON.stringify({ a3d: _t3dTotems.length, crumbling: _t3dCrumbles.length, onTile: totemOnTile(2, 4) })`);
  check('붕괴: 토템이 무너진다 (A 화면)', tot1.a3d === 0 && tot1.crumbling === 1 && !tot1.onTile && !tot1.deco, JSON.stringify(tot1));
  check('붕괴: 토템이 무너진다 (B 화면)', totB1.a3d === 0 && totB1.crumbling === 1 && !totB1.onTile, JSON.stringify(totB1));
  await A.shot('shot_collapse.png');
  await B.shot('shot_collapse_B.png');
  const dots1 = Object.values(await DBQ(`rooms/${code}/gameState/dots`) || {}).filter(d => d.type === 'heal' && d.totem);
  check('무너진 토템의 회복 줄이 지워진다', dots1.length === 0, JSON.stringify(dots1));
  const c2 = await hps('p2');
  check('붕괴: 타워 셋 모두 즉시 25', c0.left - c2.left === 25 && c0.king - c2.king === 25 && c0.right - c2.right === 25,
        JSON.stringify({ c0, c2 }));

  // 붕괴 중(2초)에 새로 세운 토템은 곧바로 무너지고 회복도 없다
  const fi = await B.evalJs(`_deckSlots.findIndex(s => s && s.card && s.card.id === 'forest_spirit')`);
  const fb = await (await import('./lib.mjs')).box(B, `#deck-slots .deck-slot[data-slot="${fi}"] .card`);
  await click(B, fb.x, fb.y); await sleep(120);
  const bt2 = await tile(B, 3, 2);
  await mouse(B, 'mouseMoved', bt2.x, bt2.y); await sleep(120);
  const doomedAim = await B.evalJs(`document.querySelector('.cast-totemtile').classList.contains('cast-circle-bad')`);
  check('붕괴 중인 칸 — 토템 조준이 붉게 경고', doomedAim);
  await click(B, bt2.x, bt2.y);
  await sleep(450);
  const late = await B.json(`JSON.stringify({ a3d: _t3dTotems.length, onTile: totemOnTile(3, 2), held: boardIsHoldingCard() })`);
  const dots2 = Object.values(await DBQ(`rooms/${code}/gameState/dots`) || {}).filter(d => d.type === 'heal');
  check('붕괴 중에 세운 토템은 곧바로 무너진다', late.a3d === 0 && !late.onTile && !late.held, JSON.stringify(late));
  check('그 토템의 회복은 들어가지 않는다', dots2.length === 0, JSON.stringify(dots2));
  const lateA = await A.evalJs(`_t3dTotems.length`);
  check('상대 화면에서도 곧바로 무너진다', lateA === 0);

  await sleep(2600);   // 붕괴의 토템 잠금(2초)이 풀리기를 기다린다
  // ════ 지진 조준 ═══════════════════════════════════════════════
  await pickCard(A, 'earthquake');
  const t133 = await tile(A, 12, 3);
  await mouse(A, 'mouseMoved', t133.x, t133.y); await sleep(200);
  const aim = await A.json(`(() => { const a = document.querySelector('#cast-ground .cast-area');
    return JSON.stringify({ l: parseFloat(a.style.left), t: parseFloat(a.style.top), w: parseFloat(a.style.width), h: parseFloat(a.style.height),
      hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id).sort() }); })()`);
  check('지진 조준: 가리킨 칸을 가운데로 3×3칸 (바닥판 안)', aim.l === 1100 && aim.t === 200 && aim.w === 300 && aim.h === 300, JSON.stringify(aim));
  check('범위 칸에 선 타워 둘이 모두 강조', aim.hl.join(',') === 'tower-enemy-king,tower-enemy-left', JSON.stringify(aim.hl));
  // 맵 가장자리 — 잘리지 않고 안쪽으로 밀려 들어온다
  const edge = await tile(A, 15, 8);
  await mouse(A, 'mouseMoved', edge.x, edge.y); await sleep(150);
  const aimE = await A.json(`(() => { const a = document.querySelector('#cast-ground .cast-area');
    return JSON.stringify({ l: parseFloat(a.style.left), t: parseFloat(a.style.top), w: parseFloat(a.style.width) }); })()`);
  check('맵 구석에서도 범위가 제 크기로 안쪽에', aimE.l === 1300 && aimE.t === 600 && aimE.w === 300, JSON.stringify(aimE));

  // ════ 지진 시전 ═══════════════════════════════════════════════
  await mouse(A, 'mouseMoved', t133.x, t133.y); await sleep(150);
  const e0 = await hps('p2');
  await click(A, t133.x, t133.y);
  await sleep(150);
  const fxA = await A.json(`JSON.stringify({ cells: document.querySelectorAll('#cast-ground .quake-area .quake-cell').length,
    shards: document.querySelectorAll('#cast-ground .quake-area .quake-shard').length,
    rumble: !!document.querySelector('.quake-area.quake-rumble'),
    quake: [...document.querySelectorAll('.tower.tower-quake')].map(e => e.id).sort(),
    map: document.querySelector('.game-map').classList.contains('field-rumble') })`);
  check('지진 연출: 범위 9칸이 조각으로 덮인다', fxA.cells === 9 && fxA.shards === 72, JSON.stringify(fxA));
  check('땅울림: 칸이 떨고, 범위 안 타워가 떨고, 맵이 낮게 운다', fxA.rumble && fxA.map &&
        fxA.quake.join(',') === 'tower-enemy-king,tower-enemy-left', JSON.stringify(fxA));
  await waitFor(B, `!!document.querySelector('#cast-ground .quake-area')`, 3000);
  const fxB = await B.json(`(() => { const a = document.querySelector('#cast-ground .quake-area');
    return JSON.stringify({ l: parseFloat(a.style.left), t: parseFloat(a.style.top), cells: a.querySelectorAll('.quake-cell').length,
      quake: [...document.querySelectorAll('.tower.tower-quake')].map(e => e.id).sort() }); })()`);
  check('상대 화면: 좌우 반전된 같은 칸 (2~4열, 2~4행)', fxB.l === 200 && fxB.t === 200 && fxB.cells === 9, JSON.stringify(fxB));
  check('상대 화면: 자기 타워(왼쪽 위·킹)가 떤다', fxB.quake.join(',') === 'tower-my-king,tower-my-left', JSON.stringify(fxB));
  await A.shot('shot_quake_rumble.png');

  // 땅울림 동안은 아직 피해가 없다
  await sleep(300);
  const e1 = await hps('p2');
  check('땅울림(0.7초) 동안은 피해 없음', e1.left === e0.left && e1.king === e0.king, JSON.stringify({ e0, e1 }));
  await sleep(700);
  await A.shot('shot_quake_fallen.png');
  const fallen = await A.json(`JSON.stringify({ rumble: !!document.querySelector('.quake-area.quake-rumble'),
    pit: +getComputedStyle(document.querySelector('.quake-pit')).opacity })`);
  check('무너짐: 땅울림이 멎고 틈 아래 구덩이가 드러난다', !fallen.rumble && fallen.pit > 0.8, JSON.stringify(fallen));
  // 지속 피해 3번 — 0.7초 뒤 걸려 1.7 / 2.7 / 3.7초
  await sleep(3300);
  const e2 = await hps('p2');
  check('3초 동안 1초마다 9 — 두 타워 모두 27', e0.left - e2.left === 27 && e0.king - e2.king === 27 && e2.right === e0.right,
        JSON.stringify({ e0, e2 }));
  await sleep(500);
  check('연출이 끝나면 조각이 치워진다', await A.evalJs(`!document.querySelector('.quake-area')`));

  // 허공 — 맞을 타워가 없어도 쓸 수 있다
  await pickCard(A, 'earthquake');
  const t104 = await tile(A, 10, 4);
  await mouse(A, 'mouseMoved', t104.x, t104.y); await sleep(150);
  const airHl = await A.evalJs(`document.querySelectorAll('.tower.drag-over').length`);
  const a0 = await hps('p2');
  await click(A, t104.x, t104.y);
  await sleep(200);
  const air = await A.evalJs(`!!document.querySelector('.quake-area') && !boardIsHoldingCard()`);
  check('허공 지진: 강조 없음, 연출은 나간다', airHl === 0 && air);
  await sleep(1900);
  const a1 = await hps('p2');
  check('허공 지진은 피해 없음', JSON.stringify(a0) === JSON.stringify(a1), JSON.stringify({ a0, a1 }));

  // 2초가 지나면 다시 세울 수 있다
  await pickCard(B, 'forest_spirit');
  await mouse(B, 'mouseMoved', bt2.x, bt2.y); await sleep(120);
  await click(B, bt2.x, bt2.y);
  await sleep(600);
  const again = await B.json(`JSON.stringify({ a3d: _t3dTotems.length, onTile: totemOnTile(3, 2) })`);
  const dots3 = Object.values(await DBQ(`rooms/${code}/gameState/dots`) || {}).filter(d => d.type === 'heal');
  check('붕괴가 끝나면 토템이 다시 서고 회복이 들어간다', again.a3d === 1 && again.onTile && dots3.length > 0,
        JSON.stringify({ again, n: dots3.length }));

  for (const b of all) if (b.exceptions.length) { check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | ')); }
} catch (e) {
  console.log('ERROR', e.message); addFail();
} finally {
  for (const b of all) b.proc.kill();
}
console.log(failCount() ? `\n${failCount()}개 실패` : '\n전부 통과');
process.exit(failCount() ? 1 : 0);
