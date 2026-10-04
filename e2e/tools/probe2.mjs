import { launch, waitFor, sleep } from '../lib.mjs';
const b = await launch('P', 9473);
try {
  await b.goto('/reaperlab.html');
  await waitFor(b, `typeof reaperCutscene === 'function' && document.readyState === 'complete'`);
  console.log(await b.evalJs(`(() => { const r = reaperBuild(3); reaperPose(r, { t: 0, swing: 0.3 }); return JSON.stringify([r.userData.armR.rotation.z, r.userData.armR.rotation.x, String(reaperPose).includes('2.4')]); })()`));
} finally { b.proc.kill(); }
