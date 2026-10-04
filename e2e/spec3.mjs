// 관전자가 새 카드(화살 · 사랑의 화살 · 지진 · 붕괴)를 같은 자리·같은 방향으로 보는가
import { launch, waitFor, sleep, DBW, resetDB, check, failCount, addFail, mouse, click,
         startMatch, pickCard, tile, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9421), B = await launch('B', 9422), C = await launch('C', 9423);
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

  // p2(B)가 쏜 화살 — 관전 화면(p1이 왼쪽)에서는 오른쪽 → 왼쪽
  await pickCard(B, 'arrow');
  const pb = await groundToClient(B, 900, 450);
  await mouse(B, 'mouseMoved', pb.x, pb.y); await sleep(150);
  await click(B, pb.x, pb.y);
  await waitFor(C, `!!document.querySelector('.fx-arrow')`, 3000);
  const ca = await C.json(`(() => { const a = document.querySelector('.fx-arrow'); return JSON.stringify({ dir: a.querySelector('.fx-arrow-body').style.transform, x: parseFloat(a.style.left) }); })()`);
  check('관전: p2의 화살은 오른쪽→왼쪽', ca.dir.includes('scaleX(-1)'), JSON.stringify(ca));
  await sleep(1500);

  // p1(A)의 지진 — 관전 화면은 p1과 같은 방향
  await pickCard(A, 'earthquake');
  const t = await tile(A, 12, 3);
  await mouse(A, 'mouseMoved', t.x, t.y); await sleep(150);
  await click(A, t.x, t.y);
  await waitFor(C, `!!document.querySelector('#cast-ground .quake-area')`, 3000);
  const cq = await C.json(`(() => { const a = document.querySelector('#cast-ground .quake-area'); return JSON.stringify({ l: parseFloat(a.style.left), t: parseFloat(a.style.top),
    quake: [...document.querySelectorAll('.tower.tower-quake')].map(e => e.id).sort() }); })()`);
  check('관전: p1의 지진이 같은 칸(11~13열, 2~4행)', cq.l === 1100 && cq.t === 200, JSON.stringify(cq));
  check('관전: 범위 안 p2 타워가 떤다', cq.quake.join(',') === 'tower-enemy-king,tower-enemy-left', JSON.stringify(cq));
  await sleep(4300);

  // p2(B)의 붕괴 — B 화면 12열 → 관전 화면 2~4열, 세로 전체
  await pickCard(B, 'collapse');
  const tb = await tile(B, 12, 4);
  await mouse(B, 'mouseMoved', tb.x, tb.y); await sleep(150);
  await click(B, tb.x, tb.y);
  await waitFor(C, `!!document.querySelector('#cast-ground .quake-area.quake-collapse')`, 3000);
  const cc = await C.json(`(() => { const a = document.querySelector('#cast-ground .quake-collapse'); return JSON.stringify({ l: parseFloat(a.style.left), h: parseFloat(a.style.height) }); })()`);
  check('관전: p2의 붕괴가 거울 자리(2~4열, 세로 전체)', cc.l === 200 && cc.h === 900, JSON.stringify(cc));
  await sleep(2600);

  // p2(B)의 사랑의 화살 — 자기 킹 회복. 관전 화면에서 p2는 오른쪽이라 하트가 오른쪽 킹에
  await DBW(`rooms/${code}/gameState/p2/towers/king/hp`, 'PUT', 1200);
  await sleep(400);
  await pickCard(B, 'love_arrow');
  const ph = await groundToClient(B, 680, 450);
  await mouse(B, 'mouseMoved', ph.x, ph.y); await sleep(150);
  await click(B, ph.x, ph.y);
  await waitFor(C, `_t3dLove.length === 1`, 3000).then(() => check('관전: 사랑의 화살 회복 하트가 보인다', true))
    .catch(() => check('관전: 사랑의 화살 회복 하트가 보인다', false));
  const cdir = await C.evalJs(`document.querySelector('.fx-arrow .fx-arrow-body')?.style.transform || ''`);
  check('관전: p2가 자기 쪽으로 쏜 화살은 왼쪽→오른쪽', cdir.includes('scaleX(1)'), cdir);
  await sleep(1800);
  { const kh = await C.evalJs(`_boardGameState?.p2?.towers?.king?.hp`); check('관전: 킹 회복이 들어갔다', kh > 1200, String(kh)); }

  check('세 화면 모두 스크립트 오류 없음', all.every(b => b.exceptions.length === 0),
        JSON.stringify(all.flatMap(b => b.exceptions.map(e => b.name + ': ' + e))).slice(0, 400));
} catch (e) { console.log('FAIL', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
