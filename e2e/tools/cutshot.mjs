// 그림리퍼 컷씬·모델 확인용 스크린샷 (reaperlab.html)
import { launch, waitFor, sleep } from '../lib.mjs';
const b = await launch('L', 9471);
const frames = (process.argv[2] || '800,2600,4100,5300').split(',').map(Number);
try {
  for (const ms of frames) {
    await b.goto('/reaperlab.html');
    await waitFor(b, `typeof reaperCutscene === 'function' && document.readyState === 'complete'`);
    await b.evalJs(`cutAt(${ms}); 1`);
    await sleep(60);
    await b.shot(`cut_${ms}.png`);
  }
  for (const [name, yaw, swing, walk] of [['front', 0, 'null', 'null'], ['side', 1.2, 'null', 0.3], ['swing', 0.9, 0.5, 'null']]) {
    await b.goto('/reaperlab.html');
    await waitFor(b, `typeof reaperBuild === 'function' && document.readyState === 'complete'`);
    await b.evalJs(`fieldModel(${yaw}, ${swing}, ${walk}); 1`);
    await sleep(80);
    await b.shot(`model_${name}.png`);
  }
  if (b.exceptions.length) console.log('EXC', b.exceptions);
} finally { b.proc.kill(); }
console.log('done');
