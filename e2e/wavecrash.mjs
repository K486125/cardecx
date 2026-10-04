// 파도가 맵 끝에 부딪히는 순간을 시각을 멈춰 가며 찍는다 (3D 파도는 performance.now만 본다)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, resetDB, check, failCount, addFail } from './lib.mjs';

await resetDB();
const A = await launch('A', 9611);
const all = [A];
const shot = async file => { const s = await A.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
try {
  await A.goto('/index.html');
  await waitFor(A, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await A.evalJs(`document.getElementById('input-nickname').value='Alice#Dev'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-vs-ai').click(); 1`);
  await waitFor(A, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`, 20000);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-game').classList.contains('hidden') && window.matchInputLocked === false && !!_bot`, 30000);
  await sleep(800);
  await A.evalJs(`botChooseAction = () => null; _bot.energy = 100; 1`);
  const zoom = process.argv[2] || '1';
  await A.evalJs(`_zoom = ${zoom}; mapCenterView(); _applyCastArcSize(); 1`);
  await A.evalJs(`_bot.deck[0] = { card: { ...CARD_DEFINITIONS.wave_evo }, count: 3 }; _bot.energy = 100;
    _botUseCard({ slot: 0, ownSide: false, pos: 'king', card: { ...CARD_DEFINITIONS.wave_evo } }, _botView()); 1`);
  await sleep(200);
  // 시계를 멈춘다
  const w = await A.json(`JSON.stringify((() => { const w = _t3dWaves[0]; window.__realNow = performance.now.bind(performance);
    window.__fakeT = performance.now(); performance.now = () => window.__fakeT; return { born: w.born, rise: w.o.riseMs, travel: w.o.travelMs, calm: w.o.calmMs }; })())`);
  const at = async (ms, file) => {
    await A.evalJs(`window.__fakeT = ${w.born + ms}; 1`);
    await sleep(160);
    await shot(file);
  };
  const end = w.rise + w.travel;
  await at(500, 'wc_rise500.png');
  await at(end - 900, 'wc_m900.png');
  for (const d of [0, 150, 300, 450, 650, 900, 1200, 1600, 2100]) await at(end + d, `wc_p${d}.png`);
  check('찍었다', true);
  await A.evalJs(`performance.now = window.__realNow; 1`);
  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
