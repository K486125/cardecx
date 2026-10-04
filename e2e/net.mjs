// 네트워크 ① 예약 피해는 정확히 한 번 (적용 도중 사라져도, 둘이 겹쳐도) · ② 경기 중 끊기면 기권승
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, mouse, click,
         startMatch, pickCard, tile } from './lib.mjs';

await resetDB();
const A = await launch('A', 9451), B = await launch('B', 9452), C = await launch('C', 9453);
const all = [A, B, C];
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const hp = (who, pos) => DBQ(`${G}/${who}/towers/${pos}/hp`);
  const dotsOf = async tag => Object.values(await DBQ(`${G}/dots`) || {}).filter(d => d.cardId === tag).length;
  // 시험용 예약 — 즉시 피해 + 지속 효과 한 줄 (지속 효과는 '타워 밖 효과' 쪽이다)
  const row = (tag, dmg) => ({ sourcePlayer: 'p1', targetPlayer: 'p2', positions: ['king'], cardId: tag, cardType: 'attack',
    effect: { damage: dmg, dot: { dmgPerTick: 1, ticks: 1, tickInterval: 60000 } }, applyAt: Date.now() - 100 });
  // A(시전자)는 예약을 스스로 처리하지 못하게 — '넣다가 사라진 시전자'를 흉내 낸다
  await A.evalJs(`pendingHitsCleanup(); pendingHitsInit(null); 1`);

  // ════ ① 시전자가 전부 넣고 예약을 지우기 전에 사라짐 → 맞는 쪽이 다시 불러도 두 번 안 들어간다 ═══
  let k0 = await hp('p2', 'king');
  await A.evalJs(`(() => { const r = ${JSON.stringify(row('net_a', 11))};
    db.ref('${G}/pendingHits/hitA').set(r).then(() => applyCardUse(r.sourcePlayer, null, null, r.targetPlayer, r.positions,
      { id: r.cardId, type: r.cardType, effect: r.effect }, window.getGameState().p2.towers, window.getGameState(), null, 'hitA'));
    return 1; })()`);
  await sleep(3500);   // 맞는 쪽(B)은 1.5초 유예 뒤 같은 예약을 다시 부른다
  let k1 = await hp('p2', 'king');
  check('다 넣고 사라진 시전자 — 맞는 쪽이 다시 불러도 피해는 한 번 (11)', k0 - k1 === 11, `${k0} → ${k1}`);
  check('지속 효과 줄도 한 번', (await dotsOf('net_a')) === 1, String(await dotsOf('net_a')));
  check('예약은 지워진다', (await DBQ(`${G}/pendingHits/hitA`)) === null);

  // ════ ① 타워만 들어가고 나머지(지속 효과)는 못 쓴 채 사라짐 → 나머지만 들어간다 ═══
  k0 = await hp('p2', 'king');
  await DBW(`${G}/p2/towers/king`, 'PATCH', { hp: k0 - 12, applied: { hitB: Date.now() } });   // 타워 쪽만 들어간 상태
  await DBW(`${G}/pendingHits/hitB`, 'PUT', row('net_b', 12));
  await sleep(3500);
  k1 = await hp('p2', 'king');
  check('타워만 들어간 예약 — 타워 피해는 다시 안 들어간다 (12 한 번)', k0 - k1 === 12, `${k0} → ${k1}`);
  check('못 들어갔던 지속 효과는 들어간다', (await dotsOf('net_b')) === 1, String(await dotsOf('net_b')));

  // ════ ① 지속 효과만 들어가고 타워는 못 바꾼 채 사라짐 → 타워만 들어간다 ═══
  k0 = await hp('p2', 'king');
  await DBW(`${G}/appliedHits/hitC`, 'PUT', Date.now());
  await DBW(`${G}/dots/netc1`, 'PUT', { targetPlayer: 'p2', targetTower: 'king', type: 'damage', dmgPerTick: 1, tickInterval: 60000, remainingTicks: 1, sourcePlayer: 'p1', cardId: 'net_c' });
  await DBW(`${G}/pendingHits/hitC`, 'PUT', row('net_c', 13));
  await sleep(3500);
  k1 = await hp('p2', 'king');
  check('지속 효과만 들어간 예약 — 타워 피해는 들어간다 (13)', k0 - k1 === 13, `${k0} → ${k1}`);
  check('지속 효과 줄은 늘지 않는다 (1줄 그대로)', (await dotsOf('net_c')) === 1, String(await dotsOf('net_c')));

  // ════ ① 두 쪽이 같은 순간에 여러 번 불러도 한 번 ═══════════════
  k0 = await hp('p2', 'king');
  await DBW(`${G}/pendingHits/hitD`, 'PUT', row('net_d', 14));
  await B.evalJs(`(() => { const r = ${JSON.stringify(row('net_d', 14))};
    for (let i = 0; i < 3; i++) _runPendingHit('hitD', r, window.getGameState()); return 1; })()`);
  await A.evalJs(`(() => { const r = ${JSON.stringify(row('net_d', 14))};
    for (let i = 0; i < 3; i++) _runPendingHit('hitD', r, window.getGameState()); return 1; })()`);
  await sleep(3000);
  k1 = await hp('p2', 'king');
  check('양쪽이 세 번씩 동시에 불러도 피해 한 번 (14)', k0 - k1 === 14, `${k0} → ${k1}`);
  check('지속 효과도 한 번', (await dotsOf('net_d')) === 1, String(await dotsOf('net_d')));
  await A.evalJs(`pendingHitsCleanup(); pendingHitsInit('p1'); 1`);

  // ════ ② 관전자 입장 ═══════════════════════════════════════════
  await C.goto('/index.html');
  await waitFor(C, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await C.evalJs(`document.getElementById('input-nickname').value='Carol'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(C, `!!document.querySelector('.room-item[data-code="${code}"] .btn-spectate')`, 10000);
  await C.evalJs(`document.querySelector('.room-item[data-code="${code}"] .btn-spectate').click(); 1`);
  await waitFor(C, `location.pathname.endsWith('game.html') && !document.getElementById('screen-game').classList.contains('hidden')`, 20000);
  await sleep(1200);

  // ════ ② B가 돌을 던지고 곧바로 끊긴다 → 돌은 A가 대신 넣고, 5초 뒤 A 기권승 ═══════
  await pickCard(B, 'rock');
  const bk = await tile(B, 12, 4);                 // B 화면에서 상대(A) 킹 칸
  await mouse(B, 'mouseMoved', bk.x, bk.y); await sleep(150);
  const a0 = await hp('p1', 'king');
  await click(B, bk.x, bk.y);
  await waitFor(B, `false`, 350).catch(() => {});   // 예약이 서버에 닿을 시간
  await B.evalJs(`db.goOffline(); 1`);
  const t0 = Date.now();
  await waitFor(A, `document.querySelector('.notice, .center-notice, #notice')?.textContent?.includes('끊') || true`, 2000).catch(() => {});
  await waitFor(A, `!!window.getGameState()?.winner || !document.getElementById('screen-result').classList.contains('hidden')`, 15000);
  const tWin = Date.now() - t0;
  const a1 = await hp('p1', 'king');
  check('끊긴 쪽이 던진 돌은 맞는 쪽이 대신 넣는다 (20)', a0 - a1 === 20, `${a0} → ${a1}`);
  const win = await DBQ(`${G}/winner`), why = await DBQ(`${G}/winReason`);
  check('유예(5초) 뒤 남은 쪽 기권승 — DB 승자 p1 · 이유 disconnect', win === 'p1' && why === 'disconnect' && tWin > 4000, `${win} / ${why} / ${tWin}ms`);
  check('경기 기록이 지워지지 않았다 (예전엔 방을 되돌려 승자 없이 무효)', (await DBQ(`${G}/p1/towers/king/hp`)) !== null);
  await waitFor(A, `!document.getElementById('screen-result').classList.contains('hidden')`, 10000);
  const ar = await A.json(`JSON.stringify({ title: document.getElementById('result-title').textContent, reason: document.getElementById('result-reason')?.textContent })`);
  check('A 결과 화면: 승리 + "기권승"', /승리|WIN|Victory/i.test(ar.title) && /기권승/.test(ar.reason || ''), JSON.stringify(ar));
  await waitFor(C, `!document.getElementById('screen-result').classList.contains('hidden')`, 10000);
  const cr = await C.evalJs(`document.getElementById('result-reason')?.textContent || ''`);
  check('관전자 결과 화면: "Bobby 연결 끊김 — 기권"', /Bobby/.test(cr) && /기권/.test(cr), cr);

  // B가 다시 연결되면 자기 패배를 본다
  await B.evalJs(`db.goOnline(); 1`);
  await waitFor(B, `!document.getElementById('screen-result').classList.contains('hidden')`, 15000)
    .then(() => {}).catch(() => {});
  const br = await B.json(`JSON.stringify({ shown: !document.getElementById('screen-result').classList.contains('hidden'), reason: document.getElementById('result-reason')?.textContent || '' })`);
  check('돌아온 B는 기권패 결과를 본다', br.shown && /기권패/.test(br.reason), JSON.stringify(br));
  await A.shot('shot_forfeit_A.png');

  // ════ ② 경기 중 상대 자리가 사라짐(나감) → 곧바로 기권승, 결과 뒤엔 혼자 대기실 ═══════
  const D = await launch('D', 9454), E = await launch('E', 9455);
  all.push(D, E);
  const code2 = await startMatch(D, E, 'Dave#Dev', 'Erin#Dev');
  const G2 = `rooms/${code2}/gameState`;
  await DBW(`rooms/${code2}/players/p2`, 'DELETE');
  await waitFor(D, `!document.getElementById('screen-result').classList.contains('hidden')`, 12000);
  check('나간 상대 — 곧바로 기권승 (disconnect)', (await DBQ(`${G2}/winner`)) === 'p1' && (await DBQ(`${G2}/winReason`)) === 'disconnect');
  // 결과 화면은 8초 뒤 대기실로 돌아간다
  await sleep(12000);
  const room2 = await DBQ(`rooms/${code2}`);
  check('결과 뒤 대기실 — 방은 대기 상태, 상대 자리는 비어 새 상대를 받을 수 있다',
        room2?.status === 'waiting' && !room2?.players?.p2 && !!room2?.players?.p1,
        JSON.stringify({ status: room2?.status, p1: room2?.players?.p1?.name, p2: !!room2?.players?.p2 }));

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
