// 유령 모델 확인용 (reaperlab.html)
import { launch, waitFor, sleep } from '../lib.mjs';
const b = await launch('L', 9541);
try {
  for (const [name, yaw, walk] of [['front', 0, 0], ['side', 1.1, 1], ['three', 0.5, 1]]) {
    await b.goto('/reaperlab.html');
    await waitFor(b, `typeof ghostBuild === 'function' && document.readyState === 'complete'`);
    await b.evalJs(`fieldModel(${yaw}, 'ghost', ${walk}); 1`);
    await sleep(80);
    const s = await b.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 520, height: 520, scale: 1 } });
    (await import('fs')).writeFileSync(`ghost_${name}.png`, Buffer.from(s.result.data, 'base64'));
  }
  if (b.exceptions.length) console.log('EXC', b.exceptions);
} finally { b.proc.kill(); }
console.log('done');
