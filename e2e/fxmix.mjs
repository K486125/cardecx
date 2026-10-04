// 이펙트 겹침 — 여러 카드를 한꺼번에 써도 서로 가리지 않는가 (눈으로 보는 스크린샷 + 숫자 겹침 검사)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, resetDB, check, failCount, addFail } from './lib.mjs';

await resetDB();
const A = await launch('A', 9601);
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
  // 맵 전체가 보이게 축소
  await A.evalJs(`mapZoomReset(); 1`);
  await sleep(300);
  const use = (slot, id, pos = 'king') => A.evalJs(`_bot.deck[${slot}] = { card: { ...CARD_DEFINITIONS.${id} }, count: 3 }; _bot.energy = 100;
    _botUseCard({ slot: ${slot}, ownSide: false, pos: '${pos}', card: { ...CARD_DEFINITIONS.${id} } }, _botView()); 1`);

  // ── 파도 — 옆면(맵 아래 끝 단면)과 끝에 부딪히는 모습 ──
  await use(0, 'wave_evo');
  await sleep(1400); await shot('mix_wave_1400.png');
  await sleep(1400); await shot('mix_wave_2800.png');
  const plan = await A.json(`JSON.stringify(castWavePlan(CAST_STYLES.wave, 5, () => true))`);
  await sleep(plan.travelMs + 700 + 250 - 2800); await shot('mix_wave_crash250.png');
  await sleep(500); await shot('mix_wave_crash750.png');
  await sleep(700); await shot('mix_wave_crash1450.png');
  await sleep(3500);

  // ── 침수 + 지진 + 돌 — 한꺼번에 ──
  await use(1, 'earthquake', 'king');
  await sleep(150);
  await use(2, 'wave', 'king');
  await sleep(150);
  await use(3, 'rock', 'left');
  await sleep(500); await shot('mix_flood_quake_650.png');
  // 떠 있는 숫자끼리 겹치는지
  const overlap = await A.json(`JSON.stringify((() => {
    const els = [...document.querySelectorAll('.floating-number, .unit-dmg')].map(e => e.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > a.width * 0.35 && oy > a.height * 0.35) n++;
    }
    return { count: els.length, overlap: n };
  })())`);
  check('떠 있는 피해 숫자끼리 크게 겹치지 않는다', overlap.overlap === 0, JSON.stringify(overlap));
  await sleep(700); await shot('mix_flood_quake_1350.png');
  await sleep(1200); await shot('mix_flood_quake_2550.png');

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
