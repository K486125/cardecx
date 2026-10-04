import { launch, waitFor, sleep } from '../lib.mjs';
const b = await launch('P', 9474, { quiet: false });
try {
  await b.goto('/reaperlab.html');
  await waitFor(b, `typeof reaperBuild === 'function' && document.readyState === 'complete'`);
  console.log(await b.evalJs(`(() => { try { fieldModel(0, null, null); return 'ok'; } catch (e) { return 'ERR ' + e.stack; } })()`));
  await sleep(300);
} finally { b.proc.kill(); }
