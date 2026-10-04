// 필드 둘레 돌벽 · 바다 · 밤하늘 — 눈으로 보는 스크린샷 (+ 파도가 벽에 부딪히는 모습)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, resetDB, check, failCount, addFail } from './lib.mjs';

await resetDB();
const A = await launch('A', 9651, { fitZoom: true });
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
  await sleep(1200);
  await A.evalJs(`botChooseAction = () => null; 1`);
  await shot('env_default.png');
  await A.evalJs(`for (let i = 0; i < 20; i++) mapZoomAt(1 / ZOOM_STEP, innerWidth / 2, innerHeight / 2); 1`);
  await sleep(500);
  await shot('env_min.png');
  await A.evalJs(`mapPanBy(-9999, 0); 1`);
  await sleep(300);
  await shot('env_min_left.png');
  await A.evalJs(`mapZoomReset(); 1`);
  console.log('fit zoom', await A.evalJs(`_zoom`));
  await A.evalJs(`mapZoomAt(2 / _zoom, innerWidth / 2, innerHeight / 2); mapPanBy(99999, -99999); 1`);
  await sleep(500);
  await shot('env_z2_bl.png');
  await A.evalJs(`mapPanBy(-99999, 99999); 1`);
  await sleep(500);
  await shot('env_z2_tr.png');
  await A.evalJs(`mapZoomReset(); mapPanBy(0, -9999); 1`);
  await sleep(500);
  await shot('env_default_harbor.png');
  await A.evalJs(`mapZoomReset(); 1`);
  await A.evalJs(`_zoom = 0.6; mapCenterView(); _applyCastArcSize(); 1`);
  await sleep(600);
  await shot('env_zoom06.png');
  await A.evalJs(`mapPanBy(0, 400); 1`);
  await sleep(400);
  await shot('env_zoom06_sky.png');
  await A.evalJs(`_zoom = ZOOM_MIN; mapCenterView(); _applyCastArcSize(); 1`);
  await sleep(600);
  await shot('env_zoomout.png');
  await A.evalJs(`mapPanBy(0, 400); 1`);
  await sleep(400);
  await shot('env_zoomout_top.png');
  await A.evalJs(`mapPanBy(-400, -800); 1`);
  await sleep(400);
  await shot('env_zoomout_bottom.png');
  if (process.argv.includes('wave') || true) {
    await A.evalJs(`mapCenterView(); 1`);
    await A.evalJs(`_bot.deck[0] = { card: { ...CARD_DEFINITIONS.wave_evo }, count: 3 }; _bot.energy = 100;
      _botUseCard({ slot: 0, ownSide: false, pos: 'king', card: { ...CARD_DEFINITIONS.wave_evo } }, _botView()); 1`);
    const plan = await A.json(`JSON.stringify(castWavePlan(CAST_STYLES.wave, WAVE_START_COL, () => true))`);
    const t0 = Date.now();
    for (const ms of [plan.travelMs + 700 - 300, plan.travelMs + 700 + 200, plan.travelMs + 700 + 700, plan.travelMs + 700 + 1400]) {
      await sleep(Math.max(0, ms - (Date.now() - t0)));
      await shot(`env_wave_${ms}.png`);
    }
  }
  check('찍었다', true);
  if (A.exceptions.length) check('예외 없음', false, A.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
