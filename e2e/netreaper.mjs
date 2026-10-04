// 그림리퍼 — 네트워크가 나쁠 때
//   · p1 화면이 끊긴 채 두 리퍼가 만나도 p2 화면이 결투를 연다 · 끊긴 화면도 예측한 자리에 세워 둔다
//   · 늦게 온 낫: 이미 쓰러진 리퍼 · 결투로 길이 바뀐 리퍼의 낫은 서버 확인에서 떨어진다
//   · 결투에서 이긴 걸 늦게 알아도 영혼이 더 쌓이지 않는다
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, startMatch } from './lib.mjs';

await resetDB();
const A = await launch('A', 9571), B = await launch('B', 9572);
const all = [A, B];
// Firebase 연결 자체를 끊는다 (브라우저 오프라인 흉내는 이미 열린 웹소켓을 끊지 않는다)
const offline = (b, on) => b.evalJs(on ? 'firebase.database().goOffline(); 1' : 'firebase.database().goOnline(); 1');
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const kingHp = () => DBQ(`${G}/p2/towers/king/hp`);

  // ════ 1. p1 화면이 끊긴 채 만난다 ════
  // 5열·10열에서 마주 걸어 약 3초 뒤 7·8열에서 만난다. p1 화면은 2초 뒤부터 3초 동안 끊긴다
  await A.evalJs(`(() => { const now = gameNow();
    return db.ref('${G}/units').update({
      ra: { owner: 'p1', kind: 'reaper', hp: 200, maxHp: 200, speed: 1500, born: now - 1000, leg: { c: 5, r: 4, t: now, target: 'king', n: 0, souls: 0 } },
      rb: { owner: 'p2', kind: 'reaper', hp: 200, maxHp: 200, speed: 1500, born: now - 1000, leg: { c: 10, r: 4, t: now, target: 'king', n: 0, souls: 0 } },
    }).then(() => 1); })()`);
  await waitFor(B, `!!(_uGs.units && _uGs.units.ra && _uGs.units.rb)`, 4000);
  const plan = await B.json(`JSON.stringify(unitDuelPlan(_uGs.units))`);
  check('만남 예측 — 두 화면이 같은 시각·칸 (7·8열)', plan.ra?.c === 7 && plan.rb?.c === 8 &&
        JSON.stringify(plan) === JSON.stringify(await A.json(`JSON.stringify(unitDuelPlan(_uGs.units))`)), JSON.stringify(plan));
  await sleep(1800);
  await offline(A, true);
  await sleep(1800);                                                  // 이 사이에 만난다 (p1 화면은 못 쓴다)
  const legB = await DBQ(`${G}/units/ra/leg`);
  check('p1 화면이 끊겨도 p2 화면이 결투를 열었다', legB?.foe === 'rb' && legB.c === 7 && legB.t === plan.ra.t, JSON.stringify(legB));
  const seenA = await A.json(`JSON.stringify({ foe: _uGs.units.ra.leg.foe || null,
    pos: _uPosAt('ra', _uGs.units.ra, gameNow(), unitDuelPlan(_uGs.units)) })`);
  // (끊긴 화면도 스스로 결투를 열려 한 기록이 제 화면에만 먼저 보일 수 있다 — 어느 쪽이든 같은 칸이어야 한다)
  check('끊긴 p1 화면 — 서버 기록 없이도 결투 칸(7열)에 서 있다', seenA.pos.c === 7 && seenA.pos.r === 4 && seenA.pos.arrived === true,
        JSON.stringify(seenA));
  await offline(A, false);
  await waitFor(A, `_uGs.units.ra && _uGs.units.ra.leg.foe === 'rb'`, 8000)
    .then(() => check('다시 연결되면 같은 결투 기록을 받는다', true))
    .catch(() => check('다시 연결되면 같은 결투 기록을 받는다', false));
  await sleep(1500);
  check('타워는 맞지 않았다 (결투 중)', (await kingHp()) === 1500 && (await DBQ(`${G}/p1/towers/king/hp`)) === 1500);

  // ════ 2. 늦게 온 낫 — 이미 쓰러진 리퍼 ════
  const now0 = await A.evalJs(`gameNow()`);
  await DBW(`${G}/units/rd`, 'PUT', { owner: 'p1', kind: 'reaper', hp: 0, maxHp: 200, speed: 1500, born: now0 - 20000,
    diedAt: now0 - 1000, soulsAtDeath: 0, spawned: true, leg: { c: 12, r: 4, t: now0 - 20000, target: 'king', n: 0, souls: 0 } });
  await waitFor(A, `!!_uGs.units.rd`, 4000);
  const k0 = await kingHp();
  // 낡은 화면이 '살아 있던 때'의 사본으로 쓰러진 뒤의 낫을 넣으려 한다
  await A.evalJs(`(() => { const stale = { ..._uGs.units.rd, diedAt: undefined, hp: 200 };
    _uSwing('rd', stale, 0, ${now0 - 500}, 'rd_0_late'); return 1; })()`);
  await sleep(1200);
  check('쓰러진 뒤의 낫은 서버 확인에서 떨어진다 (킹 그대로)', (await kingHp()) === k0, `${k0} → ${await kingHp()}`);
  await A.evalJs(`(() => { const stale = { ..._uGs.units.rd, diedAt: undefined, hp: 200 };
    _uSwing('rd', stale, 0, ${now0 - 5000}, 'rd_0_early'); return 1; })()`);
  await sleep(1200);
  check('쓰러지기 전의 낫은 들어간다 (-67)', (await kingHp()) === k0 - 67, `${k0} → ${await kingHp()}`);

  // ════ 3. 늦게 온 낫 — 길이 바뀐 뒤 (결투 · 방향 전환) ════
  await DBW(`${G}/units/rs`, 'PUT', { owner: 'p1', kind: 'reaper', hp: 200, maxHp: 200, speed: 1500, born: now0 - 20000,
    diedAt: now0 + 600000, spawned: true, soulsAtDeath: 0,
    leg: { c: 12, r: 4, t: now0 - 2000, target: 'king', n: 1, souls: 0 } });
  await waitFor(A, `!!_uGs.units.rs`, 4000);
  const k1 = await kingHp();
  await A.evalJs(`_uSwing('rs', { ..._uGs.units.rs, leg: { c: 12, r: 4, t: ${now0 - 20000}, target: 'king', n: 0 } }, 0, ${now0 - 1000}, 'rs_0_after'); 1`);
  await sleep(1200);
  check('길이 바뀐 뒤 시각의 옛 낫은 떨어진다', (await kingHp()) === k1, `${k1} → ${await kingHp()}`);
  await A.evalJs(`_uSwing('rs', { ..._uGs.units.rs, leg: { c: 12, r: 4, t: ${now0 - 20000}, target: 'king', n: 0 } }, 0, ${now0 - 3000}, 'rs_0_before'); 1`);
  await sleep(1200);
  check('길이 바뀌기 전 시각의 옛 낫은 들어간다 (-67)', (await kingHp()) === k1 - 67, `${k1} → ${await kingHp()}`);

  // ════ 4. 결투 베기 — 벤 쪽이 이미 쓰러졌으면 ════
  await DBW(`${G}/units/rf`, 'PUT', { owner: 'p2', kind: 'reaper', hp: 200, maxHp: 200, speed: 1500, born: now0 - 20000,
    leg: { c: 13, r: 6, t: now0 - 20000, target: 'right', n: 0, souls: 0 } });
  await waitFor(A, `!!_uGs.units.rf`, 4000);
  const nowD = await A.evalJs('gameNow()');
  await DBW(`${G}/units/rd2`, 'PUT', { owner: 'p1', kind: 'reaper', hp: 0, maxHp: 200, speed: 1500, born: nowD - 20000,
    diedAt: nowD - 800, soulsAtDeath: 0, spawned: true, leg: { c: 12, r: 6, t: nowD - 1000, target: 'right', n: 2, souls: 0, foe: 'rf' } });   // 쓰러지기 전에 벤 적 없음
  await waitFor(A, '!!_uGs.units.rd2', 4000);
  await A.evalJs(`_uHitUnit('rd2', 2, 'rf', 67, 'rd2_2_late', ${nowD - 300}); 1`);
  await sleep(1200);
  check('쓰러진 뒤의 결투 베기는 들어가지 않는다 (200 그대로)', (await DBQ(`${G}/units/rf/hp`)) === 200, String(await DBQ(`${G}/units/rf/hp`)));

  // ════ 5. 결투에서 이긴 걸 늦게 알았다 ════
  const nowS = await A.evalJs('gameNow()');
  const D = nowS - 2500;
  await DBW(`${G}/units/gone1`, 'PUT', { owner: 'p2', kind: 'reaper', hp: 0, maxHp: 200, speed: 1500, born: D - 20000, diedAt: D,
    soulsAtDeath: 0, spawned: true, leg: { c: 8, r: 2, t: D - 500, target: 'left', n: 3, souls: 0, foe: 'rw' } });   // 쓰러지기 전에 벤 적 없음
  const u = { owner: 'p1', kind: 'reaper', hp: 120, maxHp: 200, speed: 1500, born: now0 - 30000,
              leg: { c: 7, r: 2, t: D - 7000, target: 'left', n: 3, souls: 1, foe: 'gone1' } };
  await DBW(`${G}/units/rw`, 'PUT', u);
  await waitFor(A, `!!_uGs.units.rw`, 4000);
  const expSouls = await A.evalJs(`unitSoulsAt(_uGs.units.rw, ${D})`);
  const lateSouls = await A.evalJs(`unitSoulsAt(_uGs.units.rw, gameNow())`);
  await waitFor(A, '_uGs.units.rw && !_uGs.units.rw.leg.foe', 4000).catch(() => {});
  const lw = await DBQ(`${G}/units/rw/leg`);
  check('늦게 알아도 영혼은 상대가 쓰러진 순간까지만', lw && !lw.foe && lw.souls === expSouls && lw.t === D + 400,
        `영혼 ${lw?.souls} (쓰러진 순간 ${expSouls} · 지금 셈 ${lateSouls}) · t ${lw && lw.t - D}`);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
