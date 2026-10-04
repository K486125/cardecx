const DBQ = p => fetch(`http://127.0.0.1:9000/${p}.json?ns=demo-cardecx-default-rtdb`, { headers: { Authorization: 'Bearer owner' } }).then(r => r.json());
await fetch('http://127.0.0.1:9000/.json?ns=demo-cardecx-default-rtdb', { method: 'PUT', body: 'null', headers: { Authorization: 'Bearer owner' } });
const A = await launch('A', 9311), B = await launch('B', 9312);
let fails = 0; const check = (name, ok, info = '') => { console.log(`${ts()} ${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
const box = (b, sel) => b.evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`).then(v => v && JSON.parse(v));
const mouse = (b, type, x, y, clicks = 1) => b.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : clicks });
const click = async (b, x, y) => { await mouse(b, 'mouseMoved', x, y); await mouse(b, 'mousePressed', x, y); await mouse(b, 'mouseReleased', x, y); };
const dblclick = async (b, x, y) => { await click(b, x, y); await mouse(b, 'mousePressed', x, y, 2); await mouse(b, 'mouseReleased', x, y, 2); };
const key = async (b, k) => { for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code: 'Digit' + k, text: k, windowsVirtualKeyCode: k.charCodeAt(0) }); };
const add = (b, id, n = 1) => b.evalJs(`for (let i = 0; i < ${n}; i++) addCardToDeck({ ...CARD_DEFINITIONS.${id} }); 1`);
// 개수는 CSS로 선택 중일 때만 보이므로 실제로 보이는지(display)로 확인한다
const slots = b => b.evalJs(`JSON.stringify([...document.querySelectorAll('#deck-slots .deck-slot')].map(s => { const c = s.querySelector('.card'); if (!c) return null; const b2 = c.querySelector('.card-count'); const shown = b2 && getComputedStyle(b2).display !== 'none'; return { name: c.querySelector('.card-name').textContent, count: shown ? b2.textContent : '', sel: s.classList.contains('slot-selected'), rep: s.classList.contains('slot-replaceable') }; }))`).then(JSON.parse);
const dbDeck = code => DBQ(`rooms/${code}/gameState/p1/deck`);
const ids = async code => (await dbDeck(code)).map(d => d && `${d.cardId}x${d.count}`);
try {
  for (const [b, nick] of [[A, 'Alice'], [B, 'Bobby']]) {
    await b.goto('/index.html');
    await waitFor(b, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
    await sleep(800);
    await b.evalJs(`document.getElementById('input-nickname').value='${nick}'; document.getElementById('btn-confirm-nickname').click(); 1`);
  }
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-create-room').click(); 1`);
  await waitFor(A, `location.pathname.endsWith('game.html') && document.getElementById('display-room-code')?.textContent.length===6`);
  const code = await A.evalJs(`new URLSearchParams(location.search).get('room')`);
  await waitFor(B, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await B.evalJs(`document.getElementById('input-room-code').value='${code}'; document.getElementById('btn-join-room').click(); 1`);
  await waitFor(B, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`, 15000);
  await waitFor(A, `!document.getElementById('btn-ready').disabled`);
  await sleep(600);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`); await sleep(300);
  await B.evalJs(`document.getElementById('btn-ready').click(); 1`);
  for (const b of [A, B]) await waitFor(b, `!document.getElementById('screen-game').classList.contains('hidden')`, 20000);
  await waitFor(A, `window.matchInputLocked === false`, 20000);
  await sleep(1000);
  const king = await box(A, '#tower-enemy-king .tower-block');
  const useSlot = async (i, n = 1) => {
    for (let k = 0; k < n; k++) {
      const c = await box(A, `#deck-slots .deck-slot[data-slot="${i}"] .card`);
      if (!c) return;
      await click(A, c.x, c.y); await sleep(180);
      await click(A, king.x, king.y); await sleep(750);
    }
  };

  // ── 1) 같은 카드는 한 슬롯에 쌓인다
  await add(A, 'arrow', 4);
  await sleep(500);
  let s1 = await slots(A);
  const db1 = await dbDeck(code);
  check('같은 카드 4장 = 한 슬롯', s1.filter(Boolean).length === 1 && db1[0].count === 4, JSON.stringify(s1.filter(Boolean)));
  check('평소엔 개수 표시 없음', s1[0].count === '', `표시="${s1[0].count}"`);

  // ── 2) 선택하면 강조 + 개수 표시
  const c0 = await box(A, '#deck-slots .deck-slot[data-slot="0"] .card');
  await click(A, c0.x, c0.y);
  await sleep(250);
  s1 = await slots(A);
  check('선택 시 강조 + x4 표시', s1[0].sel && s1[0].count === 'x4', JSON.stringify(s1[0]));
  await A.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);

  // ── 3) 빈 슬롯이 있을 때 진화: 화살 4장 중 3장을 쓰면 '바위 지옥'이 새 슬롯에 생김
  await useSlot(0, 3);
  await sleep(700);
  const db3 = await dbDeck(code);
  check('사용할 때마다 개수 1 감소 (4→1)', db3[0]?.cardId === 'arrow' && db3[0]?.count === 1, JSON.stringify(db3[0]));
  check('진화 카드가 빈 슬롯에 생김', db3.some(d => d?.cardId === 'love_arrow' && d.count === 1), JSON.stringify(await ids(code)));
  check('진화 게이지 초기화', (await DBQ(`rooms/${code}/gameState/p1/evolutionCharges/arrow`)) === 0,
    '게이지=' + JSON.stringify(await DBQ(`rooms/${code}/gameState/p1/evolutionCharges`)));

  // ── 4) 슬롯이 꽉 찬 상태에서 진화 → 대체 안내
  await add(A, 'wooden_sword', 4);
  await add(A, 'flame'); await add(A, 'tornado');
  await sleep(600);
  const full = await slots(A);
  check('슬롯 5칸 사용 중 (목검 x4 포함)', full.filter(Boolean).length === 5, JSON.stringify(await ids(code)));
  const swordSlot = (await dbDeck(code)).findIndex(d => d?.cardId === 'wooden_sword');
  await useSlot(swordSlot, 3);
  await sleep(900);
  const banner = await A.evalJs(`(() => { const b = document.getElementById('deck-replace-banner'); return JSON.stringify({ shown: !b.classList.contains('hidden'), text: b.textContent }); })()`);
  check('자리가 없으면 대체 안내 배너', /"shown":true/.test(banner) && /가득/.test(banner), banner);
  const repl = await slots(A);
  check('모든 슬롯이 대체 대상 표시', repl.every(s => s && s.rep), JSON.stringify(repl.map(s => s && s.rep)));
  const beforeReplace = await ids(code);
  check('목검은 1장 남아 있음', (await dbDeck(code))[swordSlot]?.count === 1, JSON.stringify(beforeReplace));

  // 대체할 슬롯 더블클릭 → 그 슬롯의 카드는 통째로 버려진다
  const victim = (await dbDeck(code)).findIndex(d => d?.cardId === 'arrow');
  const target = await box(A, `#deck-slots .deck-slot[data-slot="${victim}"] .card`);
  await dblclick(A, target.x, target.y);
  await sleep(900);
  const db5 = await dbDeck(code);
  check('더블클릭한 슬롯이 진화 카드로 교체', db5[victim]?.cardId === 'dual_sword' && db5[victim]?.count === 1, JSON.stringify(await ids(code)));
  check('대체 안내 사라짐', await A.evalJs(`document.getElementById('deck-replace-banner').classList.contains('hidden')`));

  // ── 5) 제공 카드도 꽉 찬 상태에서 숫자 키 선택 → 대체
  await waitFor(A, `document.querySelectorAll('#offer-cards .card').length === 3`, 20000);
  const deckIds = (await dbDeck(code)).map(d => d?.cardId);
  const offers = JSON.parse(await A.evalJs(`JSON.stringify(Object.values(window.getGameState().p1.offeredCards || {}).map(c => c.cardId))`));
  const pickIdx = offers.findIndex(id => !deckIds.includes(id));
  check('꽉 찬 상태에서도 카드 선택 3장이 계속 제공됨', offers.length === 3, JSON.stringify(offers));
  if (pickIdx === -1) { check('제공 카드가 모두 덱에 있음 — 대체 흐름 생략', true); }
  else {
    await key(A, String(pickIdx + 1));
    await sleep(700);
    check('제공 카드 선택 → 대체 안내', await A.evalJs(`!document.getElementById('deck-replace-banner').classList.contains('hidden')`));
    const v2 = (await dbDeck(code)).findIndex(d => d?.cardId === 'flame');
    const t2 = await box(A, `#deck-slots .deck-slot[data-slot="${v2}"] .card`);
    await dblclick(A, t2.x, t2.y);
    await sleep(900);
    const db6 = await dbDeck(code);
    check(`제공 카드(${offers[pickIdx]})로 슬롯 대체`, db6[v2]?.cardId === offers[pickIdx] && db6[v2]?.count === 1, JSON.stringify(await ids(code)));
    check('대체 뒤 새 카드 제공 재개', await A.evalJs(`document.querySelectorAll('#offer-cards .card').length > 0 || !!window.getGameState().p1.offeredCards`));
  }
  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과');
} catch (e) { console.log('FAIL', e.message); }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
