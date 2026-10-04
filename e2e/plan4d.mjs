// 2026-10-03 계획 4 — 7단계: 크리티컬(기본보다 크게 들어간 피해) 황금색 숫자 · 8단계: 섬 가장자리
import { writeFileSync } from 'node:fs';
import { launch, sleep, waitFor, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9681), B = await launch('B', 9682);
const all = [A, B];
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
const fill = b => b.evalJs(`_currentEnergy = 100; _renderEnergy(100); 1`);
const use = async (b, id, pt) => { await fill(b); await b.evalJs(`castResetCooldown(); 1`); await pickCard(b, id); await mouse(b, 'mouseMoved', pt.x, pt.y); await sleep(200); await click(b, pt.x, pt.y); };
// 떠오른 피해 숫자 기록 — 새로 붙는 .floating-number를 모두 모은다
const watch = b => b.evalJs(`(() => { window._nums = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
  if (n.classList?.contains('floating-number')) window._nums.push({ t: n.textContent, c: n.className, color: getComputedStyle(n).color, stroke: getComputedStyle(n).webkitTextStrokeColor });
}))).observe(document.getElementById('fx-layer') || document.body, { childList: true, subtree: true }); return 1; })()`);
const nums = b => b.json(`JSON.stringify(window._nums.splice(0))`);
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  await watch(A); await watch(B);

  // ── 판정 규칙 ──
  const rule = await A.json(`JSON.stringify([isCritHit('rock', 20, 20), isCritHit('rock', 40, 40), isCritHit('arrow', 27, 27),
    isCritHit('tornado', 37, 37), isCritHit('tornado', 40, 40), isCritHit('rock_hell', 22, 22), isCritHit('wind', 24, 29), isCritHit('wind', 24, 19)])`);
  check('규칙 — 차징 돌 · 화살 · 토네이도 최고(40) · 증폭은 크리티컬, 기본 · 바위 지옥 몫 · 막힌 피해는 아니다',
        JSON.stringify(rule) === JSON.stringify([false, true, true, false, true, false, true, false]), JSON.stringify(rule));

  // ── 바람 — 기본 24는 흰 숫자 ──
  const lt = await tile(A, 11, 2);
  await use(A, 'wind', await groundToClient(A, 1000, 250));
  await sleep(1200);
  const n1 = (await nums(A)).filter(n => /damage/.test(n.c));
  check('바람 24 — 크리티컬 아님 (흰 숫자)', n1.some(n => n.t === '-24' && !/crit/.test(n.c) && n.color === 'rgb(255, 255, 255)'), JSON.stringify(n1));
  await nums(B);

  // ── 악몽처럼 받는 피해 증폭이 걸린 타워 — 바람 피해가 커져 황금색 ──
  await A.evalJs(`db.ref('${G}/p2/towers/left').update({ damageAmpUntil: gameNow() + 8000, damageAmpPercent: 25 }).then(() => 1)`);
  await sleep(600);
  await use(A, 'wind', await groundToClient(A, 1000, 250));
  await sleep(1200);
  const n2 = (await nums(A)).filter(n => /damage/.test(n.c)), n2b = (await nums(B)).filter(n => /damage/.test(n.c));
  const crit = n2.find(n => n.t === '-30');
  check('증폭으로 30 — 황금색 크리티컬 (내 화면)', !!crit && /crit/.test(crit.c) && crit.color === 'rgb(255, 210, 58)', JSON.stringify(n2));
  check('테두리는 그대로 검정', !!crit && /rgba?\(0, 0, 0/.test(crit.stroke), crit?.stroke);
  check('맞는 쪽 화면도 황금색', n2b.some(n => n.t === '-30' && /crit/.test(n.c) && n.color === 'rgb(255, 210, 58)'), JSON.stringify(n2b));
  await shot(A, 'p4d_crit.png');

  // ── 지속 피해도 증폭되면 황금색 (지진 9 → 11) ──
  await use(A, 'earthquake', await tile(A, 11, 2));
  await sleep(2600);
  const n3 = (await nums(A)).filter(n => /\bdot\b/.test(n.c));
  check('증폭된 지진 틱 11 — 황금색', n3.some(n => n.t === '-11' && /crit/.test(n.c) && n.color === 'rgb(255, 210, 58)'), JSON.stringify(n3));
  await sleep(1500);
  await nums(A); await nums(B);

  // ── 증폭이 없는 타워의 지진 틱 9 — 보통 색 ──
  await use(A, 'earthquake', await tile(A, 11, 6));
  await sleep(2600);
  const n4 = (await nums(A)).filter(n => /\bdot\b/.test(n.c));
  check('보통 지진 틱 9 — 크리티컬 아님', n4.some(n => n.t === '-9' && !/crit/.test(n.c)) && !n4.some(n => /crit/.test(n.c)), JSON.stringify(n4));

  // ── 8단계: 섬 가장자리 ──
  const isl = await A.json(`JSON.stringify((() => { const b = t3dIslandBoxes(); const g = _t3dScene.getObjectByName('walls');
    return { n: b.length, maxH: Math.max(...b.map(x => x.h1)), inField: b.some(x => x.x1 > 0 && x.x0 < T3D_MAP_W && x.y1 > 0 && x.y0 < T3D_MAP_H),
             grass: b.filter(x => x.h1 >= 96 && x.h1 <= 104 && x.h1 - x.h0 === 9).length, kids: g ? g.children.length : 0 }; })())`);
  check('섬 가장자리 — 잔디 블록이 위 · 왼쪽 · 오른쪽을 둘러싼다 (높이 96~104, 장식까지 116 이하)', isl.grass > 100 && isl.maxH <= 116 && isl.maxH > 104, JSON.stringify(isl));
  check('블록이 타일 맵 안으로 들어오지 않는다', !isl.inField, JSON.stringify(isl));
  check('돌벽 함수는 없다', await A.evalJs(`typeof _t3dWallSide === 'undefined'`) === true);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
