// AI가 침수 · 파도를 사람과 같은 규칙으로 쓰는가 (줄마다 물살 · 가라앉는 지속 피해 · 파도 틱 · 같은 연출)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail } from './lib.mjs';

await resetDB();
const A = await launch('A', 9591);
const all = [A];
try {
  await A.goto('/index.html');
  await waitFor(A, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await A.evalJs(`document.getElementById('input-nickname').value='Alice#Dev'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-vs-ai').click(); 1`);
  await waitFor(A, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`, 20000);
  const code = await A.evalJs(`new URLSearchParams(location.search).get('room')`);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-game').classList.contains('hidden') && window.matchInputLocked === false && !!_bot`, 30000);
  await sleep(800);
  await A.evalJs(`botChooseAction = () => null; _bot.energy = 100; 1`);
  const give = (slot, id) => A.evalJs(`_bot.deck[${slot}] = { card: { ...CARD_DEFINITIONS.${id} }, count: 3 }; _bot.energy = 100; 1`);
  const use  = (slot, id, pos = 'king') => A.evalJs(`_botUseCard({ slot: ${slot}, ownSide: false, pos: '${pos}', card: { ...CARD_DEFINITIONS.${id} } }, _botView()); 1`);
  const me = pos => DBQ(`rooms/${code}/gameState/p1/towers/${pos}/hp`);
  const all3 = async () => ({ left: await me('left'), king: await me('king'), right: await me('right') });

  // ── AI 침수 — 내 킹을 겨눈다 (4칸 폭 · 세로 전체 → 타워 셋) ──
  await give(0, 'wave');
  const h0 = await all3();
  await use(0, 'wave');
  await sleep(400);
  const area = await A.json(`JSON.stringify((() => { const e = document.querySelector('.flood-area'); return e && [parseInt(e.style.left), parseInt(e.style.width)]; })())`);
  check('AI 침수 — 이 화면 왼쪽(내 진영)에 4칸 범위', area && area[1] === 400 && area[0] <= 300, JSON.stringify(area));
  await sleep(800);                                   // 1.2초 — 물살은 다 닿았고 가라앉는 첫 틱(1.5초) 전
  const h1 = await all3();
  check('AI 침수 — 물살 30씩', h0.left - h1.left === 30 && h0.king - h1.king === 30 && h0.right - h1.right === 30, JSON.stringify(h1));
  const sunk = await A.json(`JSON.stringify(_t3dTowers.filter(t => t.el.dataset.owner === 'my').map(t => !!t.sink))`);
  check('AI 침수 — 내 타워가 가라앉는다', sunk.every(Boolean), JSON.stringify(sunk));
  await sleep(3700);
  const h2 = await all3();
  check('AI 침수 — 가라앉는 동안 5 × 6 더 (총 60)', h0.left - h2.left === 60 && h0.king - h2.king === 60 && h0.right - h2.right === 60, JSON.stringify(h2));

  // ── AI 파도 — 자기 진영에서 내 쪽(왼쪽)으로 ──
  await give(1, 'wave_evo');
  const plan = await A.json(`JSON.stringify(castWavePlan(CAST_STYLES.wave, WAVE_START_COL, () => true))`);
  const w0 = await all3();
  await use(1, 'wave_evo');
  await sleep(1500);
  const wv = await A.json(`JSON.stringify(_t3dWaves.map(w => ({ dir: w.o.dir, back: w.o.backX })))`);
  check('AI 파도 — 내 진영 맨 앞(5~7열 띠, 뒤끝 = 800)에서 왼쪽으로 밀려온다', wv.length === 1 && wv[0].dir === -1 && wv[0].back === 800, JSON.stringify(wv));
  const s = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('botwater_wave.png', Buffer.from(s.result.data, 'base64'));
  await sleep(plan.travelMs + 700 + 1700 - 1500);
  const w1 = await all3();
  check('AI 파도 — 사람과 같은 계획만큼 (0.5초마다 22)', ['left', 'king', 'right'].every(p => w0[p] - w1[p] === 22 * (plan.hit[p] || 0)),
        `${JSON.stringify(w0)} → ${JSON.stringify(w1)} · ${JSON.stringify(plan.hit)}`);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
