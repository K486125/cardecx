// 필드의 낫 베기 연출 — 킹 바로 앞에 리퍼를 세우고 내리치는 순간 전후를 확대해 찍는다
import { launch, waitFor, sleep, resetDB, startMatch, box } from '../lib.mjs';
await resetDB();
const A = await launch('A', 9481), B = await launch('B', 9482);
try {
  await startMatch(A, B);
  await A.evalJs(`unitsSummon('p1', 11, 4, 'king'); 1`);
  await waitFor(A, `!document.querySelector('.reaper-cut') && Object.keys(_uGs.units || {}).length === 1`, 12000);
  await sleep(300);
  const uid = await A.evalJs(`Object.keys(_uGs.units)[0]`);
  const clipOf = async b => {
    const k = await box(b, '#tower-enemy-king .tower-block');
    return { x: k.x - 260, y: k.y - 230, width: 460, height: 360, scale: 1.6 };
  };
  const clip = await clipOf(A);
  const shots = async (b, tag, clipBox) => {
    const until = await b.evalJs(`(() => { const u = _uGs.units['${uid}']; const g = unitLeg(u); const now = gameNow();
      const k = Math.max(0, Math.ceil((now - g.firstSwing) / REAPER.swingMs)); return g.firstSwing + k * REAPER.swingMs - now; })()`);
    await sleep(Math.max(0, until - 200));
    for (const dt of [-200, -60, 80, 200, 330, 480]) {
      const s = await b.send('Page.captureScreenshot', { format: 'png', clip: clipBox });
      (await import('fs')).writeFileSync(`slash_${tag}_${dt}.png`, Buffer.from(s.result.data, 'base64'));
      await sleep(dt === -200 ? 120 : dt === -60 ? 120 : 110);
    }
  };
  await shots(A, 'A', clip);
  const kb = await box(B, '#tower-my-king .tower-block');
  await shots(B, 'B', { x: kb.x - 200, y: kb.y - 230, width: 460, height: 360, scale: 1.6 });
  for (const b of [A, B]) if (b.exceptions.length) console.log(b.name, b.exceptions);
} finally { A.proc.kill(); B.proc.kill(); }
console.log('done');
