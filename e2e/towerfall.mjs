// 타워 붕괴 연출 — 옆 타워는 땅속으로 무너지고, 킹은 사각별 빛 폭발과 함께 무너진 뒤 남은 타워가 빛으로 사라진다.
// 경기가 끝나면 리퍼는 그 자리에 굳는다 (낫질·걷기·DB 쓰기 멈춤).
import { writeFileSync } from 'fs';
import { launch, waitFor, sleep, DBW, resetDB, check, failCount, addFail, startMatch } from './lib.mjs';

await resetDB();
const A = await launch('A', 9521), B = await launch('B', 9522);
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
const fallOf = (b, id) => b.json(`(() => { const t = _t3dTowers.find(x => x.el.id === '${id}'); return JSON.stringify({ fall: t.fall ? (t.fall.done ? 'done' : t.fall.mode) : null, vis: t.group.visible, y: +t.group.position.y.toFixed(1) }); })()`);
try {
  const code = await startMatch(A, B);
  const gs = `rooms/${code}/gameState`;

  // 리퍼 하나 — 상대 킹 줄로 걸어간다
  await A.evalJs(`unitsSummon('p1', 11, 4, 'king'); 1`);
  await waitFor(A, `!document.querySelector('.reaper-cut') && Object.keys(_uGs.units || {}).length === 1`, 12000);
  await sleep(1500);

  // ── 옆 타워 하나가 무너진다 ──
  await DBW(`${gs}/p2/towers/left`, 'PATCH', { hp: 0, alive: false });
  await waitFor(A, `document.getElementById('tower-enemy-left').classList.contains('destroyed')`, 5000);
  const t0 = Date.now();
  const f1 = await fallOf(A, 'tower-enemy-left');
  check('옆 타워 — 무너지는 연출 시작 (건물이 바로 사라지지 않는다)', f1.fall === 'collapse' && f1.vis, JSON.stringify(f1));
  for (const at of [250, 650, 1050]) { await sleep(Math.max(0, at - (Date.now() - t0))); await shot(A, `fall_side_${at}.png`); }
  const mid = await fallOf(A, 'tower-enemy-left');
  check('옆 타워 — 땅속으로 주저앉는다', mid.y < -20, JSON.stringify(mid));
  await sleep(Math.max(0, 1700 - (Date.now() - t0)));
  const f2 = await fallOf(A, 'tower-enemy-left');
  check('옆 타워 — 연출이 끝나면 건물이 사라진다', f2.fall === 'done' && !f2.vis, JSON.stringify(f2));
  const fB = await fallOf(B, 'tower-my-left');
  check('맞은 쪽 화면에서도 무너진다', fB.fall === 'done' && !fB.vis, JSON.stringify(fB));
  check('킹 붕괴 전 — 빛 폭발은 없다', await A.evalJs(`document.querySelectorAll('.fx-star-burst').length`) === 0);

  // ── 킹이 무너진다 ──
  await DBW(`${gs}/p2/towers/king`, 'PATCH', { hp: 0, alive: false });
  await waitFor(A, `document.getElementById('tower-enemy-king').classList.contains('destroyed')`, 5000);
  const k0 = Date.now();
  const burst = await A.evalJs(`document.querySelectorAll('.fx-star-burst.big').length`);
  check('킹 — 사각별 빛 폭발', burst === 1, String(burst));
  const kf = await fallOf(A, 'tower-enemy-king');
  check('킹 — 무너지는 연출', kf.fall === 'collapse' && kf.vis, JSON.stringify(kf));
  const halted = await A.json(`JSON.stringify({ halted: _uHalted, timer: _uTimer, huds: [...document.querySelectorAll('.unit-hud')].filter(h => h.style.display !== 'none').length })`);
  check('경기 끝 — 리퍼가 멈춘다 (낫질·DB 쓰기 없음)', halted.halted === true && halted.timer === 0 && halted.huds === 0, JSON.stringify(halted));
  check('상대 화면의 리퍼도 멈춘다', await B.evalJs(`_uHalted`) === true);
  const rightEarly = await A.evalJs(`document.getElementById('tower-enemy-right').classList.contains('destroyed')`);
  check('남은 타워는 킹이 먼저 무너진 뒤에 사라진다', rightEarly === false);

  for (const at of [150, 500, 900, 1400, 1900, 2700, 3000]) {
    await sleep(Math.max(0, at - (Date.now() - k0)));
    await shot(A, `fall_king_${at}.png`);
  }
  const rf = await fallOf(A, 'tower-enemy-right');
  check('남은 타워 — 빛으로 사라지는 연출', rf.fall === 'light' || rf.fall === 'done', JSON.stringify(rf));
  const small = await A.evalJs(`document.querySelectorAll('.fx-star-burst:not(.big)').length`);
  check('남은 타워 — 작은 빛 폭발', small >= 1, String(small));
  const early = await A.evalJs(`!document.getElementById('screen-result').classList.contains('hidden')`);
  check('붕괴 연출 중에는 결과 화면이 뜨지 않는다', early === false);
  await waitFor(A, `!document.getElementById('screen-result').classList.contains('hidden')`, 15000);
  check('연출 뒤 결과 화면', true, ((Date.now() - k0) / 1000).toFixed(1) + 's');

  for (const b of [A, B]) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { A.proc.kill(); B.proc.kill(); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
