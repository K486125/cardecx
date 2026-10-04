// 2026-09-29 문제 5건: 온라인 수 유령 · 돌 폭발 범위 (3×3 → 이후 2×2) · 공격 연출 방향 · 단축키(뗄 때 한 번) + 토템 한 칸 하나 · 단축키 표시
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, mouse, click,
         startMatch, pickCard, tile, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9341), B = await launch('B', 9342), C = await launch('C', 9343);
const all = [A, B, C];
try {
  const code = await startMatch(A, B);
  const hp = (who, pos) => DBQ(`rooms/${code}/gameState/${who}/towers/${pos}/hp`);

  // ════ ② 돌 — 착지 = 커서가 가리키는 타일 한 칸 (2×2 원형 → 타일 한 칸, 2026-09-29) ═══════════
  check('돌: 깨짐 그림 기준 반지름은 타일 반 폭', await A.evalJs('CAST_STYLES.stone.radius') === 50);
  await pickCard(A, 'rock');
  // 두 타워 사이(칸 12,3) — 그 칸엔 타워가 없으니 아무것도 강조되지 않는다
  const mid = await tile(A, 12, 3);
  await mouse(A, 'mouseMoved', mid.x, mid.y); await sleep(200);
  const aimMid = await A.json(`(() => { const l = document.querySelector('.cast-lands .cast-throw-land');
    return JSON.stringify({ tile: l.classList.contains('cast-throw-tile'), w: parseFloat(l.style.width), x: parseFloat(l.style.left), y: parseFloat(l.style.top),
      hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id) }); })()`);
  check('착지 표시는 커서 칸에 딱 맞는 타일 네모', aimMid.tile && aimMid.w === 100 && aimMid.x === 1250 && aimMid.y === 350, JSON.stringify(aimMid));
  check('타워가 없는 칸 — 강조 없음 (옆 타워에 닿아도 안 맞는다)', aimMid.hl.length === 0, JSON.stringify(aimMid.hl));
  // 킹이 선 칸(12,4)
  const kt = await tile(A, 12, 4);
  await mouse(A, 'mouseMoved', kt.x, kt.y); await sleep(200);
  const aimK = await A.json(`JSON.stringify({ hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id),
    ready: document.querySelector('.cast-lands').classList.contains('cast-arc-ready') })`);
  check('타워가 선 칸 — 그 타워 하나만 강조 · 표시가 준비 색', aimK.hl.join(',') === 'tower-enemy-king' && aimK.ready, JSON.stringify(aimK));
  const l0 = await hp('p2', 'left'), k0 = await hp('p2', 'king');
  await click(A, kt.x, kt.y);
  await waitFor(A, `!!document.querySelector('#cast-ground .cast-fx-stone-ground')`, 3000);
  const gq = b => b.json(`(() => { const r = document.querySelector('#cast-ground .cast-fx-stone-ground'); if (!r) return 'null';
    const w = parseFloat(r.style.width);
    return JSON.stringify({ reach: +(w / 440 * 180).toFixed(1), cx: +(parseFloat(r.style.left) + w / 2).toFixed(1), cy: +(parseFloat(r.style.top) + w / 2).toFixed(1),
      crater: !!document.querySelector('#cast-ground .stone-crater'), dust: document.querySelectorAll('.fx-dust').length }); })()`);
  const blast = await gq(A);
  check('착지: 칸 한가운데에 깨지고, 충격 고리는 칸 가장자리를 조금 넘는 크기', blast.reach > 50 && blast.reach < 70 &&
        Math.abs(blast.cx - 1250) <= 1 && Math.abs(blast.cy - 450) <= 1 && blast.crater && blast.dust >= 3, JSON.stringify(blast));
  const bB = await gq(B);
  check('상대 화면에도 같은 칸(좌우 반전)에 깨짐', bB && Math.abs(bB.cx - 350) <= 1 && Math.abs(bB.cy - 450) <= 1, JSON.stringify(bB));
  await A.shot('shot_fix_blast.png');
  await sleep(700);
  const l1 = await hp('p2', 'left'), k1 = await hp('p2', 'king');
  check('그 칸의 타워(킹)만 피해', k1 < k0 && l1 === l0, `left ${l0}→${l1}, king ${k0}→${k1}`);

  // ════ ③ 공격 연출 방향 ═══════════════════════════════════════
  await sleep(600);
  const aimW = await groundToClient(A, 1250 - 39 - 150, 450);
  await pickCard(A, 'wind');
  await mouse(A, 'mouseMoved', aimW.x, aimW.y); await sleep(150);
  await click(A, aimW.x, aimW.y);
  await sleep(120);
  const hot = (b, tid) => b.json(`(() => { const i = document.querySelector('.cast-fx-windsmash'); const k = document.querySelector('#${tid} .tower-block');
    if (!i || !k) return 'null';
    const st = CAST_STYLES.windsmash.fx, flip = i.style.transform.includes('scaleX(-1)');
    const r = i.getBoundingClientRect(), t = k.getBoundingClientRect();
    const hx = flip ? st.w - st.hx : st.hx;
    return JSON.stringify({ flip, dx: Math.round(r.left + r.width * hx / st.w - (t.left + t.width / 2)) }); })()`);
  const wa = await hot(A, 'tower-enemy-king'), wb = await hot(B, 'tower-my-king');
  check('내가 쓴 바람: 내 화면에선 그대로 (왼쪽→오른쪽)', wa && wa.flip === false && Math.abs(wa.dx) <= 6, JSON.stringify(wa));
  check('상대 화면: 뒤집혀서 오른쪽→왼쪽으로 들어온다', wb && wb.flip === true, JSON.stringify(wb));
  check('상대 화면: 뒤집혀도 맞는 점은 그 타워 위', wb && Math.abs(wb.dx) <= 6, JSON.stringify(wb));
  await B.shot('shot_fix_wind_flip.png');

  // ════ ④ 단축키 — 꾹 누르고 있는 동안 깜빡이지 않고, 뗄 때 한 번 ═══════
  await sleep(600);
  await A.evalJs(`castResetCooldown(); addCardToDeck({ ...CARD_DEFINITIONS.wooden_sword }); 1`);
  await waitFor(A, `_deckSlots[0] && _deckSlots[0].card`, 5000);
  await sleep(300);
  const keyEv = (type, auto = false) => A.send('Input.dispatchKeyEvent', { type, key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81, autoRepeat: auto });
  await keyEv('rawKeyDown');
  const seen = [];
  for (let i = 0; i < 12; i++) { await keyEv('rawKeyDown', true); await sleep(35); seen.push(await A.evalJs(`boardIsHoldingCard()`)); }
  check('Q를 꾹 누르고 있는 동안 켜졌다 꺼졌다 하지 않는다', seen.every(v => v === seen[0]), JSON.stringify(seen));
  check('누르고 있는 동안에는 아직 집지 않는다', seen[0] === false);
  await keyEv('keyUp');
  await sleep(150);
  check('Q를 떼면 범위 표시가 뜬다', (await A.evalJs(`boardIsHoldingCard() && !!document.querySelector('#cast-ground .cast-arc')`)) === true);
  await keyEv('rawKeyDown'); for (let i = 0; i < 6; i++) { await keyEv('rawKeyDown', true); await sleep(35); }
  check('다시 꾹 눌러도 그동안은 그대로 들고 있다', (await A.evalJs(`boardIsHoldingCard()`)) === true);
  await keyEv('keyUp');
  await sleep(150);
  check('다시 떼면 취소된다', (await A.evalJs(`boardIsHoldingCard()`)) === false);

  // ════ ④-2 토템 — 한 칸에 하나만 ═════════════════════════════
  await pickCard(A, 'forest_spirit');
  const t14 = await tile(A, 2, 4);
  await mouse(A, 'mouseMoved', t14.x, t14.y); await sleep(150);
  await click(A, t14.x, t14.y);
  await sleep(400);
  check('첫 토템 설치', (await A.evalJs(`_t3dTotems.length`)) >= 1 && (await A.evalJs(`boardIsHoldingCard()`)) === false);
  await pickCard(A, 'forest_spirit');
  await mouse(A, 'mouseMoved', t14.x, t14.y); await sleep(150);
  check('토템이 선 칸: 설치 불가 표시', (await A.evalJs(`!!document.querySelector('.cast-totemtile.cast-circle-bad')`)) === true);
  const deck0 = JSON.stringify(await DBQ(`rooms/${code}/gameState/p1/deck`));
  await click(A, t14.x, t14.y);
  await sleep(400);
  check('같은 칸 클릭은 무시 (카드 유지)', (await A.evalJs(`boardIsHoldingCard()`)) === true && JSON.stringify(await DBQ(`rooms/${code}/gameState/p1/deck`)) === deck0);
  const t13 = await tile(A, 2, 3);
  await mouse(A, 'mouseMoved', t13.x, t13.y); await sleep(150);
  check('옆 칸에는 설치 가능', (await A.evalJs(`!!document.querySelector('.cast-totemtile') && !document.querySelector('.cast-totemtile.cast-circle-bad')`)) === true);
  await A.evalJs(`cancelStickyDrag(); 1`);
  // 토템이 사라지면(5.4초) 다시 설치할 수 있다
  await sleep(5400);
  await pickCard(A, 'forest_spirit');
  await mouse(A, 'mouseMoved', t14.x, t14.y); await sleep(150);
  check('토템이 사라지면 그 칸에 다시 설치 가능', (await A.evalJs(`!document.querySelector('.cast-totemtile.cast-circle-bad')`)) === true);
  await A.evalJs(`cancelStickyDrag(); 1`);

  // ════ ⑤ 단축키 표시 ═════════════════════════════════════════
  const kc = await A.json(`(() => { const s = document.querySelector('#deck-slots .deck-slot[data-key="Q"]'); const cs = getComputedStyle(s, '::before');
    const r = s.getBoundingClientRect();
    return JSON.stringify({ content: cs.content, size: cs.fontSize, color: cs.color, top: cs.top, slotTop: Math.round(r.top), vh: innerHeight }); })()`);
  check('단축키 배지: Q가 16px 흰 글씨로', kc.content === '"Q"' && kc.size === '16px' && /255, 255, 255/.test(kc.color), JSON.stringify(kc));
  check('배지가 화면 안에 있다 (슬롯 위쪽에 걸침)', kc.top === '-15px' && kc.slotTop - 15 > 0 && kc.slotTop < kc.vh, JSON.stringify(kc));
  await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.arrow }); 1`);
  await sleep(300);
  const q2 = await A.evalJs(`document.querySelectorAll('#deck-slots .deck-slot')[1]`);
  await A.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await A.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await sleep(200);
  const sel = await A.json(`(() => { const s = document.querySelectorAll('#deck-slots .deck-slot')[1]; return JSON.stringify({ selected: s.classList.contains('slot-selected'), bg: getComputedStyle(s, '::before').backgroundImage.slice(0, 40) }); })()`);
  check('들고 있는 슬롯의 배지는 금색으로 바뀐다', sel.selected && /255, 227, 138/.test(sel.bg), JSON.stringify(sel));
  await A.shot('shot_fix_keycaps.png');
  await A.evalJs(`cancelStickyDrag(); 1`);

  // ════ ① 온라인 수 — 유령은 세지 않는다 ═══════════════════════
  await C.goto('/index.html');
  await waitFor(C, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await C.evalJs(`document.getElementById('input-nickname').value='Carol'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(C, `!document.getElementById('screen-room').classList.contains('hidden')`);
  const count = () => C.evalJs(`Number(document.getElementById('online-player-count')?.textContent)`);
  await waitFor(C, `Number(document.getElementById('online-player-count')?.textContent) === 3`, 8000);
  check('로비·게임 중인 사람 모두 셈 (3명)', true);

  // 옛날 방식의 유령: online:true 인데 생존 신호가 없거나 오래됨
  const now = Date.now();
  await DBW('players/GhostOld', 'PUT', { uid: 'ghost-uid-1', online: true });
  await DBW('players/GhostStale', 'PUT', { uid: 'ghost-uid-2', online: true, lastSeen: now - 5 * 60 * 1000 });
  await sleep(1500);
  check('생존 신호 없는/오래된 기록은 세지 않는다', (await count()) === 3, String(await count()));

  // 게임 화면도 생존 신호를 계속 보낸다
  const s0 = (await DBQ('players/Alice'))?.lastSeen;
  await sleep(16500);
  const s1 = (await DBQ('players/Alice'))?.lastSeen;
  check('게임 중인 사람도 15초마다 생존 신호', typeof s0 === 'number' && s1 > s0, `${s0} → ${s1}`);

  // 진짜 유령 만들기: 페이지 이동 직전처럼 onDisconnect를 취소한 채 브라우저가 죽는다
  await B.evalJs(`db.ref('players/Bobby').onDisconnect().cancel().then(() => 1)`);
  B.proc.kill();
  await sleep(2000);
  const bob = await DBQ('players/Bobby');
  check('브라우저가 죽어도 기록은 online:true로 남는다 (유령 재현)', bob && bob.online === true, JSON.stringify(bob));
  // 1분이 지난 것처럼 — 생존 신호가 끊긴 지 오래됨
  await DBW('players/Bobby/lastSeen', 'PUT', Date.now() - 70000);
  await waitFor(C, `Number(document.getElementById('online-player-count')?.textContent) === 2`, 8000);
  check('생존 신호가 끊긴 유령은 온라인 수에서 빠진다 (3 → 2)', true);

  // 유령이 닉네임을 영영 잠그지 않는다 — 다른 사람이 되찾을 수 있다. 살아 있는 사람 것은 여전히 막힌다
  const D = await launch('D', 9344);
  all.push(D);
  await D.goto('/index.html');
  await waitFor(D, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await D.evalJs(`document.getElementById('input-nickname').value='Alice'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(D, `(document.getElementById('nickname-error')?.textContent || '').length > 0`, 8000);
  const errText = await D.evalJs(`document.getElementById('nickname-error').textContent`);
  check('게임 중인 사람(Alice)의 닉네임은 여전히 못 쓴다', /사용|중/.test(errText) && (await D.evalJs(`document.getElementById('screen-room').classList.contains('hidden')`)) === true, errText);
  await D.evalJs(`document.getElementById('input-nickname').value='Bobby'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(D, `!document.getElementById('screen-room').classList.contains('hidden')`, 10000);
  const bob2 = await DBQ('players/Bobby');
  const dUid = await D.evalJs(`currentUid()`);
  check('유령이 된 닉네임(Bobby)은 다른 사람이 쓸 수 있다', bob2?.uid === dUid, JSON.stringify(bob2));

  check('화면 스크립트 오류 없음', [A, C, D].every(b => b.exceptions.length === 0), JSON.stringify([A, C, D].flatMap(b => b.exceptions)).slice(0, 300));
  console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
} catch (e) { console.log('FAIL', e.message); addFail(); }
finally { all.forEach(b => { try { b.proc.kill(); } catch {} }); process.exit(failCount() ? 1 : 0); }
