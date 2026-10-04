// 2026-09-29 — AI가 사람과 같은 규칙을 지키는가 (토템 칸 · 토네이도 칸 · 바위 지옥 덩이별 피해 · 연출 잠금)
//              + 연출이 있는 카드는 지속 효과 아이콘이 없다 + 상대가 쓴 토네이도가 받는 화면에서 제대로 간다
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, mouse, click, pickCard, tile } from './lib.mjs';

await resetDB();
const A = await launch('A', 9431);
const all = [A];
try {
  // ── AI 대전 시작 ───────────────────────────────────────────
  await A.goto('/index.html');
  await waitFor(A, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await A.evalJs(`document.getElementById('input-nickname').value='Alice#Dev'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-vs-ai').click(); 1`);
  await waitFor(A, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`, 20000);
  const code = await A.evalJs(`new URLSearchParams(location.search).get('room')`);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-game').classList.contains('hidden') && window.matchInputLocked === false && !!_bot`, 30000);
  await sleep(800);
  // AI가 제멋대로 카드를 쓰지 않게 멈추고, 쓸 카드를 직접 쥐여 준다
  await A.evalJs(`botChooseAction = () => null; _bot.energy = 100; 1`);
  const give = (slot, id) => A.evalJs(`_bot.deck[${slot}] = { card: { ...CARD_DEFINITIONS.${id} }, count: 3 }; _bot.energy = 100; 1`);
  const use  = (slot, id, ownSide, pos = 'king') => A.evalJs(`_botUseCard({ slot: ${slot}, ownSide: ${ownSide}, pos: '${pos}', card: { ...CARD_DEFINITIONS.${id} } }, _botView()); 1`);
  const hp = (who, pos) => DBQ(`rooms/${code}/gameState/${who}/towers/${pos}/hp`);

  // ════ AI 토템 — 타워 칸이 아닌 자기 진영 빈 칸 ════════════════
  await DBW(`rooms/${code}/gameState/p2/towers/king`, 'PATCH', { hp: 1300 });
  await sleep(400);
  await give(0, 'forest_spirit');
  await use(0, 'forest_spirit', true);
  await sleep(500);
  const t1 = await A.json(`JSON.stringify(Object.keys(_totemTiles))`);
  const towerTiles = ['12,4', '11,2', '11,6', '3,4', '4,2', '4,6'];
  check('AI 토템이 섰다 (한 칸)', t1.length === 1, JSON.stringify(t1));
  const [c1, r1] = (t1[0] || '0,0').split(',').map(Number);
  check('AI 토템은 타워가 선 칸이 아니다', !towerTiles.includes(t1[0]), t1[0]);
  check('AI 토템은 자기 진영(오른쪽 8~15열)', c1 >= 8 && c1 <= 15, t1[0]);
  const dots = Object.values(await DBQ(`rooms/${code}/gameState/dots`) || {}).filter(d => d.type === 'heal' && d.targetPlayer === 'p2');
  check('회복 줄에 칸 표시 (p1 기준 칸) · 카드 id', dots.length > 0 && dots.every(d => d.totem === t1[0] && d.cardId === 'forest_spirit'), JSON.stringify(dots.map(d => [d.totem, d.cardId, d.targetTower])));
  check('AI 토템 3D 모형', await A.evalJs(`_t3dTotems.length`) === 1);
  // 두 번째 토템 — 같은 칸에는 못 선다
  await sleep(300);
  await use(0, 'forest_spirit', true);
  await sleep(400);
  const t2 = await A.json(`JSON.stringify(Object.keys(_totemTiles))`);
  check('두 번째 AI 토템은 다른 빈 칸에', t2.length === 2 && t2.every(k => !towerTiles.includes(k)), JSON.stringify(t2));
  // 토템에는 지속 효과 아이콘이 붙지 않는다 (연출로 보인다)
  await sleep(1200);
  check('토템 회복 — 타워에 지속 효과 아이콘 없음', await A.evalJs(`document.querySelectorAll('#dot-enemy-king .dot-badge, #dot-enemy-left .dot-badge, #dot-enemy-right .dot-badge').length`) === 0);

  // ════ AI 토네이도 — 자기 진영 빈 칸에 놓고, 받는 화면에서 제대로 전진 ══════
  await sleep(4500);   // 토템이 끝나기를 기다린다
  const p1a = { left: await hp('p1', 'left'), king: await hp('p1', 'king'), right: await hp('p1', 'right') };
  await give(1, 'tornado');
  const plan = await A.json(`JSON.stringify((() => { const towers = window.getGameState().p1.towers;
    const b = boardBestTornadoTile('my', (pos, dmg) => Math.min(dmg, towers[pos].hp)); return b && { point: b.point, targets: b.targets }; })())`);
  check('AI 토네이도 자리 — 자기 진영 빈 칸', plan && plan.point.x >= 800 && !towerTiles.includes(Math.floor(plan.point.x / 100) + ',' + Math.floor(plan.point.y / 100)), JSON.stringify(plan));
  await use(1, 'tornado', false);
  await sleep(300);
  const tor = await A.json(`(() => { const e = document.querySelector('.cast-fx-tornado'); const a = e && e.getAnimations()[0];
    const kf = a ? a.effect.getKeyframes() : []; return JSON.stringify({ exists: !!e, end: kf.at(-1)?.transform || '' }); })()`);
  const m = /translateX\((-?[\d.]+)px\)/.exec(tor.end);
  const dxT = m ? Number(m[1]) : 0;
  // 가장 가까운 대상 타워 칸까지 왼쪽으로 — 예전엔 받는 화면에서 한 칸(−100)만 가고 멈췄다
  const stopView = Math.max(...plan.targets.map(h => 15 - h.col));
  const wantDx = (stopView - Math.floor(plan.point.x / 100)) * 100;
  check('받는 화면: 토네이도가 대상 타워까지 왼쪽으로 전진', tor.exists && dxT === wantDx && dxT <= -500, JSON.stringify({ tor, wantDx }));
  await sleep(3000);
  const p1b = { left: await hp('p1', 'left'), king: await hp('p1', 'king'), right: await hp('p1', 'right') };
  const got = Object.fromEntries(['left', 'king', 'right'].map(p => [p, p1a[p] - p1b[p]]));
  const want = Object.fromEntries(['left', 'king', 'right'].map(p => [p, plan.targets.find(h => h.pos === p)?.damage || 0]));
  check('AI 토네이도 피해 = 놓은 칸에서의 거리 규칙대로', JSON.stringify(got) === JSON.stringify(want), JSON.stringify({ got, want }));

  // ════ AI 바위 지옥 — 덩이마다 자기 피해 · 연출 잠금 ════════════
  await sleep(600);
  const h0 = { left: await hp('p1', 'left'), king: await hp('p1', 'king'), right: await hp('p1', 'right') };
  await give(2, 'rock_hell');
  await use(2, 'rock_hell', false);
  const e1 = await A.evalJs(`_bot.energy`);
  await use(2, 'rock_hell', false);   // 연출이 도는 중 — 사람처럼 막힌다
  const e2 = await A.evalJs(`_bot.energy`);
  const rhCost = await A.evalJs(`CARD_DEFINITIONS.rock_hell.energyCost`);
  check('연출이 도는 동안 같은 카드는 다시 못 쓴다 (에너지 그대로)', e1 === e2 && e1 === 100 - rhCost, `${e1} → ${e2} (비용 ${rhCost})`);
  await sleep(5200);
  const h1 = { left: await hp('p1', 'left'), king: await hp('p1', 'king'), right: await hp('p1', 'right') };
  const dh = Object.fromEntries(['left', 'king', 'right'].map(p => [p, h0[p] - h1[p]]));
  check('AI 바위 지옥 = 덩이마다 14+6 / 18+9 / 22+9', dh.left === 20 && dh.king === 27 && dh.right === 31, JSON.stringify(dh));

  // ════ 지속 효과 아이콘 — 연출 카드는 없음, 연출 없는 카드는 그대로 ═══════
  await pickCard(A, 'earthquake');
  const q = await tile(A, 12, 3);
  await mouse(A, 'mouseMoved', q.x, q.y); await sleep(150);
  await click(A, q.x, q.y);
  await sleep(1400);
  const eqDots = Object.values(await DBQ(`rooms/${code}/gameState/dots`) || {}).filter(d => d.cardId === 'earthquake').length;
  const eqBadge = await A.evalJs(`document.querySelectorAll('#dot-enemy-king .dot-badge, #dot-enemy-left .dot-badge').length`);
  check('지진(연출 카드)의 지속 피해 — 아이콘 없음', eqDots > 0 && eqBadge === 0, `dots ${eqDots}, badges ${eqBadge}`);
  await sleep(3000);
  await pickCard(A, 'flame');
  const kr = await A.json(`(() => { const r = document.querySelector('#tower-enemy-right .tower-block').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`);
  await mouse(A, 'mouseMoved', kr.x, kr.y); await sleep(150);
  await click(A, kr.x, kr.y);
  await sleep(700);
  const flBadge = await A.evalJs(`document.querySelectorAll('#dot-enemy-right .dot-badge').length`);
  check('불덩이(2026-10-02부터 연출 카드)의 지속 피해 — 아이콘 없음', flBadge === 0, `badges ${flBadge}`);

  check('스크립트 오류 없음', A.exceptions.length === 0, A.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { A.proc.kill(); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
