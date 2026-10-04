// 유령 필드 연출 — 피해 숫자 · 쓰러짐 → 유령 6 → 타워에 닿아 사라짐 (눈으로 보기용)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, resetDB, startMatch } from '../lib.mjs';
await resetDB();
const A = await launch('A', 9551), B = await launch('B', 9552);
const shot = async (file, clip) => { const s = await A.send('Page.captureScreenshot', { format: 'png', clip }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  await A.evalJs(`(() => { const now = gameNow();
    return db.ref('${G}/units/rg1').set({ owner: 'p1', kind: 'reaper', hp: 300, maxHp: 300, speed: 1500, born: now - 9000,
      leg: { c: 10, r: 4, t: now - 9000, target: 'king', n: 0, souls: 6 } }).then(() => 1); })()`);
  await waitFor(A, `document.querySelectorAll('.unit-hud').length === 1`, 4000);
  await sleep(500);
  const clip = { x: 880, y: 70, width: 620, height: 520, scale: 1 };
  await B.evalJs(`unitsStrike('p2', '12,4,45', gameNow(), 'hit1').then(() => 1)`);
  await sleep(250);
  await shot('ghost_dmg.png', clip);
  await sleep(900);
  await B.evalJs(`unitsStrike('p2', '12,4,999', gameNow(), 'kill1').then(() => 1)`);
  const t0 = Date.now();
  for (const ms of [200, 1100, 1500, 1900, 2400, 3000]) {
    await sleep(Math.max(0, ms - (Date.now() - t0)));
    await shot(`ghost_field_${ms}.png`, clip);
  }
  if (A.exceptions.length) console.log('EXC', A.exceptions);
} finally { A.proc.kill(); B.proc.kill(); }
console.log('done');
