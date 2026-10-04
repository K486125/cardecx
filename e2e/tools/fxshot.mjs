// 지진 · 붕괴 · 돌 연출을 시간대별로 확대해 찍는다 (눈으로 보기용)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, resetDB, mouse, click, startMatch, pickCard, tile, groundToClient, box } from '../lib.mjs';

await resetDB();
const A = await launch('A', 9361), B = await launch('B', 9362);
const clipShot = async (file, x, y, w, h) => {
  const s = await A.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 1 } });
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
};
try {
  await startMatch(A, B);
  const which = process.argv[2] || 'all';

  if (which === 'all' || which === 'quake') {
    await pickCard(A, 'earthquake');
    const t = await tile(A, 13, 3);
    await mouse(A, 'mouseMoved', t.x, t.y); await sleep(150);
    await A.shot('fx_quake_aim.png');
    const t0 = Date.now();
    await click(A, t.x, t.y);
    for (const ms of [300, 850, 1900, 3000, 3850]) {
      await sleep(Math.max(0, ms - (Date.now() - t0)));
      await clipShot(`fx_quake_${ms}.png`, 1050, 60, 500, 420);
    }
    await sleep(900);
  }
  if (which === 'all' || which === 'stone') {
    await pickCard(A, 'rock');
    const p = await groundToClient(A, 1100, 650);
    await mouse(A, 'mouseMoved', p.x, p.y); await sleep(200);
    await A.shot('fx_stone_aim.png');
    const t0 = Date.now();
    await click(A, p.x, p.y);
    await waitFor(A, `!!document.querySelector('.cast-fx-stone-impact')`, 3000);
    const t1 = Date.now();
    for (const ms of [20, 90, 170, 300, 500, 800, 1200]) {
      await sleep(Math.max(0, ms - (Date.now() - t1)));
      await clipShot(`fx_stone_${ms}.png`, p.x - 200, p.y - 200, 400, 340);
    }
    await sleep(800);
  }
  if (which === 'all' || which === 'collapse') {
    // B가 토템을 세운 뒤 붕괴
    await pickCard(B, 'forest_spirit');
    const bt = await tile(B, 3, 4);
    await mouse(B, 'mouseMoved', bt.x, bt.y); await sleep(150);
    await click(B, bt.x, bt.y);
    await sleep(900);
    await pickCard(A, 'collapse');
    const t = await tile(A, 13, 4);
    await mouse(A, 'mouseMoved', t.x, t.y); await sleep(150);
    await A.shot('fx_collapse_aim.png');
    const t0 = Date.now();
    await click(A, t.x, t.y);
    for (const ms of [250, 560, 700, 900, 1300, 1900, 2300]) {
      await sleep(Math.max(0, ms - (Date.now() - t0)));
      await clipShot(`fx_collapse_${ms}.png`, 900, 40, 640, 580);
    }
  }
  for (const b of [A, B]) if (b.exceptions.length) console.log('EXC', b.name, b.exceptions);
} finally {
  A.proc.kill(); B.proc.kill();
}
console.log('done');
process.exit(0);
