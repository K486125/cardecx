// 4단계 — 관전 모드: 중간 입장 · 맵 조작 · 실시간 연출/숫자 · 관전자 인터넷 끊김 · 재입장 · 결과
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, mouse, click, key,
         startMatch, pickCard, tile, groundToClient, fxOffset } from './lib.mjs';

await resetDB();
const A = await launch('A', 9331), B = await launch('B', 9332), C = await launch('C', 9333);
const all = [A, B, C];
try {
  const code = await startMatch(A, B);

  // ── 0) 관전자 입장 (로비에서 방 목록 → 관전) ─────────────────
  await C.goto('/index.html');
  await waitFor(C, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await C.evalJs(`document.getElementById('input-nickname').value='Carol'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(C, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await waitFor(C, `!!document.querySelector('.room-item[data-code="${code}"] .btn-spectate')`, 10000);
  check('로비 방 목록에 관전 버튼이 보인다', true);
  await C.evalJs(`document.querySelector('.room-item[data-code="${code}"] .btn-spectate').click(); 1`);
  await waitFor(C, `location.pathname.endsWith('game.html') && document.getElementById('screen-game') && !document.getElementById('screen-game').classList.contains('hidden')`, 20000);
  await sleep(1500);

  const s0 = await C.json(`JSON.stringify({
    mode: document.getElementById('screen-game').classList.contains('spectator-mode'),
    p1: document.getElementById('card-panel-my-name')?.textContent, p2: document.getElementById('card-panel-enemy-name')?.textContent,
    towers3d: typeof _t3dTowers !== 'undefined' ? _t3dTowers.length : -1,
    hpKing: document.getElementById('hptext-enemy-king')?.textContent,
    timer: document.getElementById('match-timer-display')?.textContent,
    decks: document.querySelectorAll('#spec-deck-p1 .deck-slot').length + document.querySelectorAll('#spec-deck-p2 .deck-slot').length })`);
  check('관전 화면으로 들어온다', s0.mode === true, JSON.stringify(s0));
  check('양쪽 이름이 보인다', /Alice/.test(s0.p1) && /Bobby/.test(s0.p2), `${s0.p1} / ${s0.p2}`);
  check('입체 타워 6채', s0.towers3d === 6);
  check('체력이 DB와 같다', Number(s0.hpKing) === await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`), s0.hpKing);
  check('시계가 돈다', /^\d:\d\d$/.test(String(s0.timer)), s0.timer);
  check('관전용 덱 두 줄', s0.decks === 10);
  // 타워 DOM(체력 숫자·연출 기준점)이 실제로 제 칸에 있는가 — 입체 모형만 보고 판단하면 안 된다
  const where = b => b.json(`JSON.stringify(['my-king','enemy-king','my-left','enemy-right'].map(id => {
    const p = boardTowerCenterStage(id.split('-')[0], id.split('-')[1]);
    const h = document.getElementById('hptext-' + id).getBoundingClientRect();
    const vp = document.getElementById('map-viewport').getBoundingClientRect();
    return { id, x: Math.round(p.x), y: Math.round(p.y), hpVisible: h.width > 0 && h.left >= vp.left && h.right <= vp.right && h.top >= vp.top && h.bottom <= vp.bottom };
  }))`);
  const wa = await where(A), wc = await where(C);
  check('관전: 타워 기준점이 플레이어 화면과 같은 자리', wc.every((c, i) => Math.abs(c.x - wa[i].x) <= 3 && Math.abs(c.y - wa[i].y) <= 3),
        JSON.stringify(wc.map(c => [c.id, c.x, c.y])) + ' vs ' + JSON.stringify(wa.map(c => [c.x, c.y])));
  check('관전: 킹 타워 체력 숫자가 화면 안에 보인다', wc[0].hpVisible && wc[1].hpVisible, JSON.stringify(wc));
  await waitFor(A, `document.getElementById('spectator-count-num')?.textContent === '1'`, 8000);
  check('플레이어 화면에 관전자 1명', true);

  // ── 1) 관전자도 맵을 끌고 확대/축소한다 ───────────────────
  const pan0 = await C.json(`JSON.stringify({ x: _panX, y: _panY, z: _zoom })`);
  await C.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 800, y: 300, button: 'left', clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 6; i++) { await C.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 300 + i * 15, button: 'left', buttons: 1 }); await sleep(25); }
  await C.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 800, y: 390, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(150);
  const pan1 = await C.json(`JSON.stringify({ x: _panX, y: _panY, z: _zoom })`);
  check('관전자: 왼쪽 버튼으로 맵을 끈다', pan1.y !== pan0.y, `${pan0.y} → ${pan1.y}`);
  await C.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 400, deltaX: 0, deltaY: -120 });
  await sleep(150);
  const z1 = await C.evalJs(`_zoom`);
  check('관전자: 휠로 확대', z1 > pan1.z, `${pan1.z} → ${z1}`);
  await C.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 400, deltaX: 0, deltaY: 240 });
  await sleep(150);
  check('관전자: 휠로 축소', (await C.evalJs(`_zoom`)) < z1);
  await key(C, '0', 'Digit0', 48); await sleep(150);
  check('관전자: 0 키로 원래 크기', (await C.evalJs(`_zoom`)) === 1);
  // 타워를 눌러도, 카드 단축키를 눌러도 아무 일도 없다 (오류도 없다)
  const eK = await C.json(`(() => { const r = document.querySelector('#tower-enemy-king .tower-block').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`);
  await click(C, eK.x, eK.y);
  for (const [k, c, v] of [['q', 'KeyQ', 81], ['w', 'KeyW', 87], [' ', 'Space', 32]]) await key(C, k, c, v);
  await sleep(300);
  check('관전자: 타워 클릭·단축키로 아무 일도 없다', C.exceptions.length === 0 && (await C.evalJs(`typeof boardIsHoldingCard === 'function' ? boardIsHoldingCard() : false`)) === false);
  await C.evalJs(`mapZoomReset(); 1`);

  // ── 1-2) 양쪽 덱이 실시간으로 보인다 ─────────────────────
  await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.arrow }); 1`);
  await B.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.wind }); 1`);
  await waitFor(C, `!!document.querySelector('#spec-deck-p1 .card') && !!document.querySelector('#spec-deck-p2 .card')`, 6000);
  const decks = await C.json(`JSON.stringify({ p1: [...document.querySelectorAll('#spec-deck-p1 .card-name')].map(e => e.textContent), p2: [...document.querySelectorAll('#spec-deck-p2 .card-name')].map(e => e.textContent) })`);
  check('관전: 양쪽 덱에 새 카드가 실시간으로 보인다', decks.p1.length === 1 && decks.p2.length === 1, JSON.stringify(decks));

  // ── 2) A(p1)의 목검 → 관전 화면에서 p2 킹 위에 연출 + 숫자 ─
  const hpText = (b, id) => b.evalJs(`document.getElementById('${id}')?.textContent`).then(Number);
  let aim = await groundToClient(A, 1250 - 39 - 90, 450);
  await pickCard(A, 'wooden_sword');
  await mouse(A, 'mouseMoved', aim.x, aim.y); await sleep(150);
  await click(A, aim.x, aim.y);
  await waitFor(C, `!!document.querySelector('.cast-fx-sword')`, 3000);
  const cs1 = await fxOffset(C, 'cast-fx-sword', 'tower-enemy-king', 'sword');
  check('관전: A의 베기 연출이 p2 킹 위에', cs1 && Math.abs(cs1.dx) <= 6 && Math.abs(cs1.dy) <= 6, JSON.stringify(cs1));
  await waitFor(C, `[...document.querySelectorAll('.floating-number.damage')].length > 0`, 3000);
  const num1 = await C.json(`(() => { const n = [...document.querySelectorAll('.floating-number.damage')].pop(); const k = document.querySelector('#tower-enemy-king .tower-block').getBoundingClientRect();
    const r = n.getBoundingClientRect(); return JSON.stringify({ text: n.textContent, dealt: n.classList.contains('dealt'), near: Math.abs(r.left - k.left) < 160 }); })()`);
  check('관전: 피해 숫자가 그 타워에 뜬다', /^-\d+$/.test(num1.text) && num1.near, JSON.stringify(num1));
  check('관전: 피해 숫자는 어느 편이든 같은 색 (dealt 없음)', num1.dealt === false);
  await sleep(600);
  check('관전: 체력이 DB와 같다', (await hpText(C, 'hptext-enemy-king')) === await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`));
  await C.shot('shot_spec_sword.png');

  // ── 3) B(p2)의 목검 → 관전 화면에서는 p1(왼쪽) 킹 위 ─────
  await sleep(500);
  aim = await groundToClient(B, 1250 - 39 - 90, 450);    // B 화면에서도 상대 킹은 오른쪽
  await pickCard(B, 'wooden_sword');
  await mouse(B, 'mouseMoved', aim.x, aim.y); await sleep(150);
  await click(B, aim.x, aim.y);
  await waitFor(C, `!!document.querySelector('.cast-fx-sword')`, 3000);
  const cs2 = await fxOffset(C, 'cast-fx-sword', 'tower-my-king', 'sword');
  check('관전: B의 베기 연출이 p1 킹 위에 (좌우 뒤집혀도)', cs2 && Math.abs(cs2.dx) <= 6 && Math.abs(cs2.dy) <= 6, JSON.stringify(cs2));
  await sleep(900);
  check('관전: p1 킹 체력도 DB와 같다', (await hpText(C, 'hptext-my-king')) === await DBQ(`rooms/${code}/gameState/p1/towers/king/hp`));

  // ── 4) A의 벚꽃(3D) — 관전 화면에서도 입체로 그 타워를 감는다 ──
  await sleep(800);
  await pickCard(A, 'cherry_blossom');
  const myKingTile = await tile(A, 3, 4);
  await mouse(A, 'mouseMoved', myKingTile.x, myKingTile.y); await sleep(150);
  await click(A, myKingTile.x, myKingTile.y);
  await waitFor(C, `_t3dBlooms.length > 0`, 3000);
  const bl = await C.json(`(() => { const b = _t3dBlooms[0]; const t = _t3dTowers.find(x => x.el.id === 'tower-my-king');
    return JSON.stringify({ d: +Math.hypot(b.group.position.x - t.group.position.x, b.group.position.z - t.group.position.z).toFixed(1), svg: !!document.querySelector('.cast-fx-blossom') }); })()`);
  check('관전: 벚꽃이 입체로 p1 킹을 감는다', bl.d < 1 && bl.svg === false, JSON.stringify(bl));
  let healSeen = false;
  for (let i = 0; i < 20 && !healSeen; i++) { await sleep(200); healSeen = await C.evalJs(`[...document.querySelectorAll('.floating-number.heal')].some(n => /^\\+\\d+$/.test(n.textContent))`); }
  check('관전: 회복 숫자(+N)가 뜬다', healSeen === true);

  // ── 5) B의 숲의정령(토템) — 좌우가 뒤집힌 같은 칸 ───────────
  await pickCard(B, 'forest_spirit');
  const bt = await tile(B, 2, 4);            // B 화면에서 킹 뒤 칸
  await mouse(B, 'mouseMoved', bt.x, bt.y); await sleep(150);
  await click(B, bt.x, bt.y);
  await waitFor(C, `!!document.querySelector('.cast-fx-forest') && _t3dTotems.length > 0`, 3000);
  const tt = await C.json(`(() => { const i = document.querySelector('.cast-fx-forest'); const st = CAST_STYLES.forest.fx;
    return JSON.stringify({ x: parseFloat(i.style.left) + st.hx, y: parseFloat(i.style.top) + st.hy, ground: !!i.closest('#cast-ground'), totems: _t3dTotems.length }); })()`);
  check('관전: B의 토템이 뒤집힌 같은 칸(13열 4행)에', tt.x === 1350 && tt.y === 450 && tt.ground, JSON.stringify(tt));
  await C.shot('shot_spec_totem.png');

  // ── 6) A의 돌 풀차징 — 관전 화면도 같은 비행 시간 ─────────
  await sleep(300);
  await pickCard(A, 'rock');
  const rk = await A.json(`(() => { const r = document.querySelector('#tower-enemy-left .tower-block').getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`);
  await mouse(A, 'mouseMoved', rk.x, rk.y);
  await A.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(2200);
  await A.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await click(A, rk.x, rk.y);
  await waitFor(C, `!!document.querySelector('.stone-fly')`, 3000);
  const fly = await C.evalJs(`(() => { const f = document.querySelector('.stone-fly'); const a = f && f.getAnimations()[0]; return a ? Math.round(a.effect.getComputedTiming().duration) : 0; })()`);
  check('관전: 풀차징 돌이 같은 속도(1초 — 2026-10-03부터 셀수록 빠르다)로 난다', fly === 1000, fly + 'ms');
  await sleep(3000);
  check('관전: 돌 맞은 체력도 DB와 같다', (await hpText(C, 'hptext-enemy-left')) === await DBQ(`rooms/${code}/gameState/p2/towers/left/hp`));

  // ── 7) 오래된 신호는 관전 화면에서 재생하지 않는다 ───────────
  await C.evalJs(`document.querySelectorAll('.cast-fx').forEach(e => e.remove()); 1`);
  await DBW(`rooms/${code}/gameState/instantHits/zz_stale`, 'PUT',
    { targetPlayer: 'p2', targetTower: 'king', amount: 0, type: 'cast_sword', sourcePlayer: 'p1', ts: Date.now() - 10000 });
  await sleep(700);
  check('관전: 10초 지난 연출 신호는 무시', (await C.evalJs(`!!document.querySelector('.cast-fx-sword')`)) === false);
  await DBW(`rooms/${code}/gameState/instantHits/zz_stale`, 'DELETE');

  // ── 8) 관전자 인터넷이 끊긴다 ────────────────────────────
  await C.evalJs(`db.goOffline(); 1`);
  const offAt = Date.now();
  await waitFor(A, `document.getElementById('spectator-count-num')?.textContent === '0'`, 12000);
  check('끊기면 관전자 수에서 빠진다', true, `${Date.now() - offAt}ms`);
  // 끊긴 동안 경기는 계속된다
  const hpBefore = await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`);
  aim = await groundToClient(A, 1250 - 39 - 90, 450);
  await pickCard(A, 'wooden_sword');
  await mouse(A, 'mouseMoved', aim.x, aim.y); await sleep(150);
  await click(A, aim.x, aim.y);
  await sleep(1500);
  const hpAfter = await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`);
  check('끊긴 동안에도 경기는 진행된다', hpAfter < hpBefore, `${hpBefore} → ${hpAfter}`);
  await waitFor(C, `document.getElementById('net-state')?.dataset.level === 'warn'`, 6000);
  check('관전자 화면에 재연결 안내 띠', true);
  // 오래 끊긴 경우의 전체 화면 문구 — 관전자용
  await C.evalJs(`_netOffSince = Date.now() - 16000; _netRender(); 1`);
  const note = await C.evalJs(`document.querySelector('.net-state-note')?.textContent || ''`);
  check('오래 끊기면 관전자용 안내 문구', /경기 상황/.test(note), note);

  await C.evalJs(`db.goOnline(); 1`);
  await waitFor(C, `document.getElementById('net-state')?.dataset.level === 'back' || !document.getElementById('net-state')`, 15000);
  await sleep(1500);
  check('다시 이어지면 체력이 지금 값으로 맞춰진다',
    (await hpText(C, 'hptext-enemy-king')) === await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`));
  await waitFor(A, `document.getElementById('spectator-count-num')?.textContent === '1'`, 8000);
  check('다시 이어지면 관전자 수에 돌아온다', true);
  check('관전 화면 그대로 (로비로 튕기지 않음)', (await C.evalJs(`location.pathname.endsWith('game.html') && !document.getElementById('screen-game').classList.contains('hidden')`)) === true);

  // 복구 뒤에도 실시간으로 계속 보인다
  await sleep(500);
  aim = await groundToClient(A, 1250 - 39 - 90, 450);
  await pickCard(A, 'wooden_sword');
  await mouse(A, 'mouseMoved', aim.x, aim.y); await sleep(150);
  await click(A, aim.x, aim.y);
  await waitFor(C, `!!document.querySelector('.cast-fx-sword')`, 3000);
  check('복구 뒤에도 연출이 실시간으로 보인다', true);

  // ── 9) 오래 끊긴 안내의 '다시 시도' — 판을 떠나지 않고 연결만 다시 잇는다 ──
  // (새로고침하면 게임 화면은 판을 떠나도록 설계돼 있다 — game.js _exitToNickname)
  await sleep(600);
  await C.evalJs(`db.goOffline(); 1`);
  await waitFor(A, `document.getElementById('spectator-count-num')?.textContent === '0'`, 12000);
  await C.evalJs(`_netOffSince = Date.now() - 16000; _netRender(); 1`);
  check('오래 끊기면 다시 시도 버튼이 보인다', (await C.evalJs(`!!document.getElementById('net-state-retry')`)) === true);
  await C.evalJs(`document.getElementById('net-state-retry').click(); 1`);
  await waitFor(C, `document.getElementById('net-state')?.dataset.level === 'back' || !document.getElementById('net-state')`, 15000);
  check('다시 시도 → 연결이 돌아온다', true);
  check('다시 시도해도 판을 떠나지 않는다 (관전 화면 그대로)',
    (await C.evalJs(`location.pathname.endsWith('game.html') && document.getElementById('screen-game').classList.contains('spectator-mode') && !document.getElementById('screen-game').classList.contains('hidden')`)) === true);
  await waitFor(A, `document.getElementById('spectator-count-num')?.textContent === '1'`, 8000);
  check('다시 시도 뒤 관전자 수 복구', true);

  // ── 10) 새로고침 = 관전 종료 (설계) → 유령 관전자가 남지 않고, 로비에서 다시 들어올 수 있다 ──
  await sleep(600);
  await C.send('Page.reload');
  await waitFor(C, `location.pathname.endsWith('index.html') || location.pathname === '/'`, 15000);
  await waitFor(A, `document.getElementById('spectator-count-num')?.textContent === '0' || document.getElementById('spectator-count')?.classList.contains('hidden')`, 10000);
  check('새로고침하면 관전자 수에서 빠진다 (유령 관전자 없음)', true);
  const specLeft = await DBQ(`rooms/${code}/spectators`);
  check('DB에도 관전 기록이 남지 않는다', !specLeft, JSON.stringify(specLeft));
  // 로비에서 다시 관전
  await waitFor(C, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(600);
  const needNick = await C.evalJs(`!document.getElementById('screen-nickname')?.classList.contains('hidden')`);
  if (needNick) await C.evalJs(`document.getElementById('input-nickname').value='Carol'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(C, `!!document.querySelector('.room-item[data-code="${code}"] .btn-spectate')`, 12000);
  await C.evalJs(`document.querySelector('.room-item[data-code="${code}"] .btn-spectate').click(); 1`);
  await waitFor(C, `location.pathname.endsWith('game.html') && document.getElementById('screen-game')?.classList.contains('spectator-mode') && !document.getElementById('screen-game').classList.contains('hidden')`, 20000);
  await sleep(1200);
  check('로비에서 다시 관전으로 들어온다 (체력도 지금 값)', (await hpText(C, 'hptext-enemy-king')) === await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`));
  const wc2 = await C.json(`JSON.stringify(boardTowerCenterStage('enemy','king'))`);
  check('다시 들어와도 타워 기준점이 제자리', Math.abs(wc2.x - 1250) <= 3 && Math.abs(wc2.y - 450) <= 3, JSON.stringify(wc2));
  await waitFor(A, `document.getElementById('spectator-count-num')?.textContent === '1'`, 8000);
  check('다시 들어온 뒤 관전자 수 1명 (두 번 세지 않음)', true);

  // ── 11) 경기 끝 → 관전자 결과 화면 ────────────────────────
  await DBW(`rooms/${code}/gameState/p2/towers/king`, 'PATCH', { hp: 0, alive: false });
  await waitFor(C, `!!document.getElementById('screen-result') && !document.getElementById('screen-result').classList.contains('hidden')`, 15000);
  const res = await C.evalJs(`document.getElementById('result-title')?.textContent`);
  check('관전자 결과 화면에 승자', /Alice/.test(String(res)), res);
  const win = await DBQ(`rooms/${code}/gameState/winner`);
  check('DB 승자와 같다', win === 'p1', win);
  await C.shot('shot_spec_result.png');

  check('세 화면 모두 스크립트 오류 없음', all.every(b => b.exceptions.length === 0),
        JSON.stringify(all.flatMap(b => b.exceptions.map(e => b.name + ': ' + e))).slice(0, 400));
  console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
} catch (e) { console.log('FAIL', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); process.exit(failCount() ? 1 : 0); }
