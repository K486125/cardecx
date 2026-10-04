// 돌이 타워에 맞는 순간 — 확대해서 시간대별로 찍는다 (눈으로 보기용)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, resetDB, mouse, click, startMatch, pickCard, tile, box } from '../lib.mjs';

await resetDB();
const A = await launch('A', 9531), B = await launch('B', 9532);
const tag = process.argv[2] || 'now';
try {
  await startMatch(A, B);
  const k = await box(A, '#tower-enemy-king .tower-block');
  const clip = { x: k.x - 230, y: k.y - 260, width: 460, height: 380, scale: 1.4 };
  await pickCard(A, 'rock');
  const t = await tile(A, 13, 4);
  await mouse(A, 'mouseMoved', t.x, t.y); await sleep(200);
  await click(A, t.x, t.y);
  await waitFor(A, `!!document.querySelector('.cast-fx-stone-impact')`, 4000);
  const t1 = Date.now();
  for (const ms of [30, 110, 220, 380, 600, 900]) {
    await sleep(Math.max(0, ms - (Date.now() - t1)));
    const s = await A.send('Page.captureScreenshot', { format: 'png', clip });
    writeFileSync(`stonehit_${tag}_${ms}.png`, Buffer.from(s.result.data, 'base64'));
  }
  // 직접 한 번 더 — 찍는 시각을 맞춘다
  await sleep(1500);
  await A.evalJs(`_stoneTowerHit({ owner: 'enemy', pos: 'king', el: document.getElementById('tower-enemy-king') }); 1`);
  const t2 = Date.now();
  for (const ms of [0, 90, 180, 300, 450]) {
    await sleep(Math.max(0, ms - (Date.now() - t2)));
    const s = await A.send('Page.captureScreenshot', { format: 'png', clip });
    writeFileSync(`stonehit_direct_${ms}.png`, Buffer.from(s.result.data, 'base64'));
  }
  await sleep(800);
  if (A.exceptions.length) console.log('EXC', A.exceptions);
} finally { A.proc.kill(); B.proc.kill(); }
console.log('done');
