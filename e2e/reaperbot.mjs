// AI의 그림리퍼 — 사람과 같은 칸 규칙 · 같은 컷씬 · 컷씬 중엔 AI도 멈춘다
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail } from './lib.mjs';

await resetDB();
const A = await launch('A', 9491);
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
  const code = await A.evalJs(`new URLSearchParams(location.search).get('room')`);
  const G = `rooms/${code}/gameState`;
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-game').classList.contains('hidden') && window.matchInputLocked === false && !!_bot`, 30000);
  await sleep(800);
  await A.evalJs(`botChooseAction = () => null; _bot.energy = 100; 1`);
  const bk = await A.evalJs(`_bot.key`);

  // 가치 — 놓을 수 있는 줄이면 쓸 만한 카드로 본다
  const val = await A.evalJs(`_botAttackValue({ ...CARD_DEFINITIONS.grim_reaper }, _botView(), 'left')`);
  check('AI가 그림리퍼를 쓸 만한 카드로 본다 (옆 타워 줄)', val > 0, String(val));
  const valK = await A.evalJs(`_botAttackValue({ ...CARD_DEFINITIONS.grim_reaper }, _botView(), 'king')`);
  check('옆 타워가 서 있는 동안 킹 줄에는 안 놓는다', valK === 0, String(valK));

  // 소환 — AI 시점에서 윗줄 옆 타워(2열) 바로 앞 칸 (p1 기준 15-3 = 12열, 2행)
  await A.evalJs(`_bot.deck[0] = { card: { ...CARD_DEFINITIONS.grim_reaper }, count: 1 }; _bot.energy = 100; 1`);
  await A.evalJs(`_botUseCard({ slot: 0, ownSide: false, pos: 'left', card: { ...CARD_DEFINITIONS.grim_reaper } }, _botView()); 1`);
  await waitFor(A, `!!document.querySelector('.reaper-cut')`, 3000)
    .then(() => check('AI 소환에도 컷씬', true)).catch(() => check('AI 소환에도 컷씬', false));
  check('컷씬 중엔 AI도 멈춘다', await A.evalJs(`!_botActive()`) === true);
  check('AI 에너지 80 소모', await A.evalJs(`_bot.energy`) === 20, String(await A.evalJs(`_bot.energy`)));
  const us = Object.values(await DBQ(`${G}/units`) || {});
  const u = us[0];
  const expC = bk === 'p1' ? 5 : 10;
  check('AI 리퍼 — 사람과 같은 칸 규칙 (옆 타워 줄 · 내 옆 타워 바로 앞)', us.length === 1 && u.owner === bk && u.leg.c === expC && u.leg.r === 2 && u.leg.target === 'left',
        JSON.stringify(u?.leg));
  await waitFor(A, `!document.querySelector('.reaper-cut')`, 11000);
  check('컷씬 뒤 AI 다시 움직임', await A.evalJs(`_botActive()`) === true);
  // 내 화면에서는 오른쪽에서 왼쪽으로 걸어온다
  await waitFor(A, `document.querySelectorAll('.unit-hud').length === 1`, 3000);
  const x1 = await A.evalJs(`parseFloat(document.querySelector('.unit-hud').style.left)`);
  await sleep(2400);
  const x2 = await A.evalJs(`parseFloat(document.querySelector('.unit-hud').style.left)`);
  check('AI 리퍼가 내 옆 타워 쪽으로 걸어온다', x2 < x1 - 60, `${x1} → ${x2}`);
  await A.shot('shot_reaperbot.png');

  // 앞에 선 타워가 무너진 줄에는 놓지 않는다
  const me = await A.evalJs(`_bot.enemyKey`);
  await DBW(`${G}/${me}/towers/left`, 'PATCH', { hp: 0, alive: false });
  await sleep(600);
  check('상대 타워가 무너진 줄에는 소환하지 않는다', await A.evalJs(`botSummonPlace('left', window.getGameState()['${me}'].towers) === null`) === true);
  check('살아 있는 줄에는 된다', await A.evalJs(`JSON.stringify(botSummonPlace('right', window.getGameState()['${me}'].towers))`) === '{"col":5,"row":6}');

  // 사람의 리퍼가 AI 붕괴 범위(내 아랫줄 옆 타워 둘레)에 들면 사람과 똑같이 맞는다
  const myC = me === 'p1' ? 3 : 12;
  await A.evalJs(`unitsSummon('${me}', ${myC}, 6, 'right'); 1`);
  await waitFor(A, `!!document.querySelector('.reaper-cut')`, 3000);
  await waitFor(A, `!document.querySelector('.reaper-cut')`, 11000);
  const mine = Object.entries(await DBQ(`${G}/units`) || {}).find(([, x]) => x.owner === me);
  await A.evalJs(`_bot.deck[1] = { card: { ...CARD_DEFINITIONS.collapse }, count: 1 }; _bot.energy = 100; _bot.busy = {};
    _botUseCard({ slot: 1, ownSide: false, pos: 'right', card: { ...CARD_DEFINITIONS.collapse } }, _botView()); 1`);
  await sleep(2600);
  const hpMine = await DBQ(`${G}/units/${mine[0]}/hp`);
  check('AI 붕괴 범위에 든 내 리퍼 — 25 피해 (200 → 175)', hpMine === 175, String(hpMine));
  const hpBot = await DBQ(`${G}/units/${Object.entries(await DBQ(`${G}/units`) || {}).find(([, x]) => x.owner === bk)[0]}/hp`);
  check('AI 자기 리퍼는 안 맞는다', hpBot === 200, String(hpBot));

  if (A.exceptions.length) check('예외 없음', false, A.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
