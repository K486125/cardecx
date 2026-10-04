// AI가 불덩이 · 폭염 · 벽돌 · 철벽을 쓴다 — 사람과 같은 피해 · 연출 · 열기 구역
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail } from './lib.mjs';

await resetDB();
const A = await launch('A', 9661);
const all = [A];
try {
  await A.goto('/index.html');
  await waitFor(A, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await A.evalJs(`document.getElementById('input-nickname').value='Alice#Dev'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-vs-ai').click(); 1`);
  await waitFor(A, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`, 20000);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-game').classList.contains('hidden') && window.matchInputLocked === false && !!_bot`, 30000);
  await sleep(1200);
  await A.evalJs(`botChooseAction = () => null; 1`);
  const code = await A.evalJs(`new URLSearchParams(location.search).get('room')`);
  const G = `rooms/${code}/gameState`;
  const me = await A.evalJs(`_bot.enemyKey`);
  const hp = pos => DBQ(`${G}/${me}/towers/${pos}/hp`);
  const use = (id, slot, ownSide, pos) => A.evalJs(`_bot.deck[${slot}] = { card: { ...CARD_DEFINITIONS.${id} }, count: 3 }; _bot.energy = 100; _bot.busy = {};
    _botUseCard({ slot: ${slot}, ownSide: ${ownSide}, pos: '${pos}', card: { ...CARD_DEFINITIONS.${id} } }, _botView()); 1`);

  const r0 = await hp('right');
  await use('flame', 0, false, 'right');
  await sleep(4300);
  check('AI 불덩이 — 오른쪽 타워에 58', r0 - await hp('right') === 58);
  const k0 = await hp('king');
  await use('fire_evo', 1, false, 'king');
  await sleep(300);
  const z = Object.values(await DBQ(`${G}/heatZones`) || {})[0];
  check('AI 폭염 — 사람 쪽 열기 구역 (p1 기준 2~4열 · 1~7행)', z && z.victim === me && z.c0 === 2 && z.c1 === 4 && z.r0 === 1 && z.r1 === 7, JSON.stringify(z));
  await sleep(3500);
  check('AI 폭염 — 킹에 49 + 9×5', k0 - await hp('king') === 94);
  writeFileSync('fb_heat.png', Buffer.from((await A.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await use('brick', 2, true, 'king');
  await use('iron_wall', 3, true, 'left');
  await sleep(700);
  const w = await A.json(`JSON.stringify(_t3dWalls.map(w => w.el.id + ':' + w.kind))`);
  check('AI 벽돌 · 철벽 — AI 타워에 방벽', w.includes('tower-enemy-king:brick') && w.includes('tower-enemy-left:iron'), JSON.stringify(w));
  writeFileSync('fb_walls.png', Buffer.from((await A.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  if (A.exceptions.length) check('예외 없음', false, A.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
