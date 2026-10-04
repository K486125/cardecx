// 리퍼 결투 — 같은 줄에서 마주치면 이웃한 두 칸에 멈춰 서로 벤다 · 맞베기 · 영혼 · 이긴 쪽은 다시 걷는다
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, startMatch } from './lib.mjs';

await resetDB();
const A = await launch('A', 9561), B = await launch('B', 9562);
const all = [A, B];
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  check('리퍼 체력 200', await A.evalJs(`REAPER.hp`) === 200);

  // p1 리퍼(5열) → 오른쪽, p2 리퍼(10열, 체력 120) → 왼쪽. 같은 4행
  await A.evalJs(`(() => { const now = gameNow();
    return db.ref('${G}/units').update({
      ra: { owner: 'p1', kind: 'reaper', hp: 200, maxHp: 200, speed: 1500, born: now - 1000, leg: { c: 5, r: 4, t: now, target: 'king', n: 0, souls: 0 } },
      rb: { owner: 'p2', kind: 'reaper', hp: 120, maxHp: 200, speed: 1500, born: now - 1000, leg: { c: 10, r: 4, t: now, target: 'king', n: 0, souls: 0 } },
    }).then(() => 1); })()`);
  await waitFor(A, `_uGs.units.ra && _uGs.units.ra.leg.foe === 'rb' && _uGs.units.rb.leg.foe === 'ra'`, 8000)
    .then(() => check('마주치자 결투 — 둘의 leg에 서로가 적힌다', true))
    .catch(() => check('마주치자 결투 — 둘의 leg에 서로가 적힌다', false));
  let ra = await DBQ(`${G}/units/ra`), rb = await DBQ(`${G}/units/rb`);
  check('한 칸에 겹치지 않고 이웃한 두 칸 (같은 줄)', rb.leg.c - ra.leg.c === 1 && ra.leg.r === 4 && rb.leg.r === 4,
        `p1 ${ra.leg.c} · p2 ${rb.leg.c}`);
  check('만난 자리 — 가운데쯤 (7·8열)', ra.leg.c === 7 && rb.leg.c === 8, `${ra.leg.c}/${rb.leg.c}`);
  const posA = await A.json(`JSON.stringify([unitPosAt(_uGs.units.ra, gameNow()), unitPosAt(_uGs.units.rb, gameNow())])`);
  const posB = await B.json(`JSON.stringify([unitPosAt(_uGs.units.ra, gameNow()), unitPosAt(_uGs.units.rb, gameNow())])`);
  check('두 화면 모두 그 자리에 멈춰 있다', posA[0].c === 7 && posA[1].c === 8 && posB[0].c === 7 && posB[1].c === 8, JSON.stringify([posA, posB].map(p => p.map(x => x.c))));

  // 첫 낫 (만난 뒤 0.65초) — 서로 67
  await waitFor(A, `unitSwingsBy(_uGs.units.ra, gameNow()) >= 1`, 3000);
  await sleep(700);
  await A.shot('shot_duel_A.png');
  await B.shot('shot_duel_B.png');
  ra = await DBQ(`${G}/units/ra`); rb = await DBQ(`${G}/units/rb`);
  check('첫 낫 — 서로 67씩 (200→133 · 120→53)', ra.hp === 133 && rb.hp === 53, `${ra.hp} · ${rb.hp}`);
  const soulsA1 = await B.evalJs(`unitSoulsAt(_uGs.units.ra, gameNow())`);
  check('서로 벨 때도 영혼이 쌓인다', soulsA1 === 1, String(soulsA1));
  check('타워는 맞지 않는다 (킹 그대로)', (await DBQ(`${G}/p2/towers/king/hp`)) === 1500 && (await DBQ(`${G}/p1/towers/king/hp`)) === 1500);

  // 두 번째 낫 — p2 리퍼가 쓰러진다. 같은 순간의 맞베기는 p1에게도 들어간다
  await waitFor(A, `_uGs.units.rb && _uGs.units.rb.diedAt != null`, 6000);
  await sleep(2000);    // 맞는 쪽 늦은 확인(1.5초)까지
  ra = await DBQ(`${G}/units/ra`); rb = await DBQ(`${G}/units/rb`);
  check('두 번째 낫 — p2 리퍼 쓰러짐, 같은 순간의 맞베기로 p1은 66', rb?.diedAt != null && ra.hp === 66, `${ra.hp} · ${rb?.hp}`);
  const ghosts = Object.values(await DBQ(`${G}/units`) || {}).filter(x => x.kind === 'ghost' && x.parent === 'rb');
  check('쓰러진 리퍼 — 영혼 수만큼 유령', ghosts.length === Math.min(10, rb?.soulsAtDeath || 0) && ghosts.length >= 1, `영혼 ${rb?.soulsAtDeath} · 유령 ${ghosts.length}`);

  // 이긴 쪽은 다시 걷는다 — 결투 중 쌓인 영혼을 가지고
  await waitFor(A, `_uGs.units.ra && !_uGs.units.ra.leg.foe`, 4000)
    .then(() => check('이긴 리퍼 — 결투를 풀고 다시 킹으로', true))
    .catch(() => check('이긴 리퍼 — 결투를 풀고 다시 킹으로', false));
  ra = await DBQ(`${G}/units/ra`);
  check('결투에서 쌓은 영혼 2를 가지고 간다', ra.leg.souls === 2 && ra.leg.target === 'king' && ra.leg.c === 7, JSON.stringify(ra.leg));
  const c1 = await A.evalJs(`unitPosAt(_uGs.units.ra, gameNow()).c`);
  await sleep(1600);
  const c2 = await A.evalJs(`unitPosAt(_uGs.units.ra, gameNow()).c`);
  check('다시 걸어간다 (오른쪽으로)', c2 > c1 + 0.5, `${c1} → ${c2}`);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
