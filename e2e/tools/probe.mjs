import { launch, waitFor, sleep } from '../lib.mjs';
const b = await launch('P', 9472);
try {
  await b.goto('/reaperlab.html');
  await waitFor(b, `typeof reaperCutscene === 'function' && document.readyState === 'complete'`);
  await b.evalJs(`cutAt(4000); 1`);
  await sleep(40);
  console.log(await b.evalJs(`(() => { const m = _rpCut.scene.children.find(o => o.material && o.material.blending === THREE.AdditiveBlending && o.geometry.type === 'ShapeGeometry');
    return JSON.stringify({ op: m.material.opacity, pos: m.position, vis: m.visible, verts: m.geometry.attributes.position.count, idx: m.geometry.index && m.geometry.index.count }); })()`));
  await b.shot('cut_probe.png');
} finally { b.proc.kill(); }
