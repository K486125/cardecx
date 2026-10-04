// 관전자 — 그림리퍼 컷씬(시간 정지) · 필드 유닛이 보인다
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, startMatch } from './lib.mjs';

await resetDB();
const A = await launch('A', 9501), B = await launch('B', 9502), C = await launch('C', 9503);
const all = [A, B, C];
try {
  const code = await startMatch(A, B);
  await C.goto('/index.html');
  await waitFor(C, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await C.evalJs(`document.getElementById('input-nickname').value='Carol'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(C, `!!document.querySelector('.room-item[data-code="${code}"] .btn-spectate')`, 10000);
  await C.evalJs(`document.querySelector('.room-item[data-code="${code}"] .btn-spectate').click(); 1`);
  await waitFor(C, `location.pathname.endsWith('game.html') && !document.getElementById('screen-game').classList.contains('hidden')`, 20000);
  await sleep(1500);

  // B(p2)가 소환 — 관전자는 p1 시점이라 오른쪽에서 왼쪽으로 걸어온다
  await B.evalJs(`unitsSummon('p2', 9, 6, 'right'); 1`);
  await waitFor(C, `!!document.querySelector('.reaper-cut')`, 3000)
    .then(() => check('관전자 화면에도 컷씬', true)).catch(() => check('관전자 화면에도 컷씬', false));
  check('관전자 화면도 게임 시간 정지', await C.evalJs(`gamePaused()`) === true);
  const name = await C.evalJs(`document.querySelector('.reaper-cut-title .rct-by')?.textContent`);
  check('컷씬에 소환한 사람 이름', name === 'Bobby', String(name));
  await waitFor(C, `!document.querySelector('.reaper-cut')`, 11000);
  await waitFor(C, `document.querySelectorAll('.unit-hud').length === 1`, 3000)
    .then(() => check('관전자 화면에 리퍼·머리 위 막대', true)).catch(() => check('관전자 화면에 리퍼·머리 위 막대', false));
  const x1 = await C.evalJs(`parseFloat(document.querySelector('.unit-hud').style.left)`);
  await sleep(2000);
  const x2 = await C.evalJs(`parseFloat(document.querySelector('.unit-hud').style.left)`);
  check('관전자(p1 시점) — p2 리퍼는 왼쪽으로 걷는다', x2 < x1 - 40, `${x1} → ${x2}`);
  check('관전자는 유닛을 움직이지 않는다 (쓰기 없음)', await C.evalJs(`_uDrives('p1') || _uDrives('p2')`) === false);
  await C.shot('shot_reaper_spec.png');

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
