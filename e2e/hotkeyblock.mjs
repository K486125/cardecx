// 그림리퍼 컷씬 중 · 얼음전개로 덱이 언 동안 — 덱 단축키(Q~T)·클릭으로 카드를 집지 못한다
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, startMatch } from './lib.mjs';

await resetDB();
const A = await launch('A', 9661), B = await launch('B', 9662);
const all = [A, B];
const keyQ = async b => {
  await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 });
};
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.wooden_sword }); 1`);
  await waitFor(A, `_deckSlots[0] && _deckSlots[0].card`, 5000);
  await sleep(300);
  // 평소엔 Q로 집힌다
  await keyQ(A); await sleep(200);
  check('평소 — Q로 카드를 집는다', await A.evalJs(`boardIsHoldingCard()`) === true);
  await A.evalJs(`cancelStickyDrag(); 1`);

  // 그림리퍼 컷씬 (B가 소환)
  await B.evalJs(`unitsSummon('p2', 12, 2, 'left'); 1`);
  await waitFor(A, `gamePaused()`, 4000);
  await sleep(300);
  await keyQ(A); await sleep(250);
  check('컷씬 중 — Q를 눌러도 집히지 않는다 (범위 표시도 없다)', await A.evalJs(`!boardIsHoldingCard() && !document.querySelector('#cast-ground .cast-arc, #cast-ground .cast-lunge')`) === true);
  await A.evalJs(`document.querySelector('#deck-slots .deck-slot .card').click(); 1`);
  await sleep(250);
  check('컷씬 중 — 카드를 눌러도 집히지 않는다', await A.evalJs(`!boardIsHoldingCard()`) === true);
  const deck0 = JSON.stringify(await DBQ(`${G}/p1/deck`));
  await waitFor(A, `!gamePaused()`, 12000);
  await sleep(400);
  check('컷씬 동안 카드가 쓰이지 않았다', JSON.stringify(await DBQ(`${G}/p1/deck`)) === deck0);
  await keyQ(A); await sleep(200);
  check('컷씬이 끝나면 다시 Q로 집힌다', await A.evalJs(`boardIsHoldingCard()`) === true);

  // 얼음전개 — 내 덱이 언다 (집고 있던 카드도 내려놓는다)
  await A.evalJs(`db.ref('${G}/p1/deckFreezeUntil').set(gameNow() + 3000).then(() => 1)`);
  await sleep(600);
  check('얼기 시작하면 들고 있던 카드를 내려놓는다', await A.evalJs(`!boardIsHoldingCard()`) === true);
  await keyQ(A); await sleep(250);
  check('언 동안 — Q를 눌러도 집히지 않는다', await A.evalJs(`!boardIsHoldingCard()`) === true);
  await A.evalJs(`document.querySelector('#deck-slots .deck-slot .card').click(); 1`);
  await sleep(250);
  check('언 동안 — 카드를 눌러도 집히지 않는다 (덱이 떨린다)', await A.evalJs(`!boardIsHoldingCard()`) === true);
  await sleep(2800);
  await keyQ(A); await sleep(200);
  check('녹으면 다시 Q로 집힌다', await A.evalJs(`boardIsHoldingCard()`) === true);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
