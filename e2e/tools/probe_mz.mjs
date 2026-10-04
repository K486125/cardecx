import { launch, waitFor, sleep } from '../lib.mjs';
const b = await launch('P', 9481, { fitZoom: true, quiet: false });
try {
  await b.goto('/mapzoom.html');
  await sleep(3000);
  console.log('ready', await b.evalJs('window.__ready'), await b.evalJs('typeof _castArc'), await b.evalJs('JSON.stringify([_zoom,_panX,_panY])'));
  console.log('EXC', b.exceptions);
} finally { b.proc.kill(); }
