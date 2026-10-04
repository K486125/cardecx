import { launch, waitFor, sleep, resetDB, startMatch, box } from '../lib.mjs';
await resetDB();
const A = await launch('A', 9521), B = await launch('B', 9522);
try {
  await startMatch(A, B);
  await sleep(500);
  const k = await box(A, '#tower-my-king .tower-block');
  const s1 = await A.send('Page.captureScreenshot', { format: 'png', clip: { x: k.x - 150, y: k.y - 260, width: 380, height: 360, scale: 1.6 } });
  (await import('fs')).writeFileSync('door_my.png', Buffer.from(s1.result.data, 'base64'));
  const e = await box(A, '#tower-enemy-king .tower-block');
  const s2 = await A.send('Page.captureScreenshot', { format: 'png', clip: { x: e.x - 230, y: e.y - 260, width: 380, height: 360, scale: 1.6 } });
  (await import('fs')).writeFileSync('door_enemy.png', Buffer.from(s2.result.data, 'base64'));
  await A.shot('door_full.png');
} finally { A.proc.kill(); B.proc.kill(); }
console.log('done');
