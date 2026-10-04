// 화살 · 사랑의 화살 연출을 시간대별로 찍는다 (눈으로 보기용)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, resetDB, DBW, mouse, click, startMatch, pickCard, groundToClient } from '../lib.mjs';
await resetDB();
const A = await launch('A', 9401), B = await launch('B', 9402);
const clip = async (file, x, y, w, h) => {
  const s = await A.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 1 } });
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
};
const space = type => A.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
try {
  const code = await startMatch(A, B);
  // 가득 찬 화살
  await pickCard(A, 'arrow');
  const p = await groundToClient(A, 1060, 410);
  await mouse(A, 'mouseMoved', p.x, p.y); await sleep(150);
  await space('rawKeyDown'); await sleep(1300);
  await A.shot('ar_aim.png');
  await sleep(900); await space('keyUp'); await sleep(80);
  let t0 = Date.now();
  await click(A, p.x, p.y);
  for (const ms of [450, 880, 960, 1150, 1400]) { await sleep(Math.max(0, ms - (Date.now() - t0))); await clip(`ar_${ms}.png`, p.x - 140, p.y - 170, 480, 280); }
  await sleep(1200);
  // 사랑의 화살 — 적
  await pickCard(A, 'love_arrow');
  const q = await groundToClient(A, 1150, 650);
  await mouse(A, 'mouseMoved', q.x, q.y); await sleep(150);
  t0 = Date.now();
  await click(A, q.x, q.y);
  for (const ms of [150, 500, 800, 950, 1150, 1400]) { await sleep(Math.max(0, ms - (Date.now() - t0))); await clip(`lb_${ms}.png`, q.x - 60, q.y - 260, 420, 340); }
  await sleep(1200);
  // 사랑의 화살 — 내 킹 회복
  await DBW(`rooms/${code}/gameState/p1/towers/king/hp`, 'PUT', 1200);
  await A.evalJs('castResetCooldown(); 1');
  await pickCard(A, 'love_arrow');
  const h = await groundToClient(A, 480, 450);
  await mouse(A, 'mouseMoved', h.x, h.y); await sleep(150);
  await A.shot('lh_aim.png');
  t0 = Date.now();
  await click(A, h.x, h.y);
  for (const ms of [760, 900, 1150, 1500, 1720, 1820, 1980, 2300]) { await sleep(Math.max(0, ms - (Date.now() - t0))); await clip(`lh_${ms}.png`, h.x - 380, h.y - 280, 480, 380); }
  console.log('exc', A.exceptions, B.exceptions);
} finally { A.proc.kill(); B.proc.kill(); }
process.exit(0);
