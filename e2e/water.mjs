// 침수(물방울 리워크) · 파도(침수의 진화)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile } from './lib.mjs';

await resetDB();
const A = await launch('A', 9581), B = await launch('B', 9582);
const all = [A, B];
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const hp = pos => DBQ(`${G}/p2/towers/${pos}/hp`);
  const hps = async () => ({ left: await hp('left'), king: await hp('king'), right: await hp('right') });
  check('이름 — 물방울 → 침수', await A.evalJs(`tCard('wave', 'name')`) === '침수');

  // ════ 침수 ════
  await pickCard(A, 'wave');
  const t13 = await tile(A, 11, 4);
  await mouse(A, 'mouseMoved', t13.x, t13.y); await sleep(200);
  const aim = await A.json(`JSON.stringify({ w: parseInt(_castArc.style.width), h: parseInt(_castArc.style.height), l: parseInt(_castArc.style.left),
    water: _castArc.classList.contains('cast-area-water'), hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.dataset.pos).sort() })`);
  check('조준 — 4×9칸(세로 전체) 물빛 범위, 타워 셋 강조', aim.w === 400 && aim.h === 900 && aim.l === 900 && aim.water && aim.hl.length === 3, JSON.stringify(aim));
  const h0 = await hps();
  await click(A, t13.x, t13.y);
  const t0 = Date.now();
  await sleep(420);
  const early = await hps();
  await shot(A, 'water_flood_A_500.png');
  check('물살은 위에서 아래로 — 0.4초엔 윗줄(왼쪽)만 30', early.left === h0.left - 30 && early.right === h0.right, JSON.stringify(early));
  await sleep(Math.max(0, 700 - (Date.now() - t0)));
  await shot(A, 'water_flood_A_700.png');
  await sleep(Math.max(0, 1150 - (Date.now() - t0)));
  const h1 = await hps();
  check('물살 — 닿은 타워 셋 모두 30 (즉시)', h1.left === h0.left - 30 && h1.king === h0.king - 30 && h1.right === h0.right - 30, JSON.stringify(h1));
  await sleep(Math.max(0, 1700 - (Date.now() - t0)));
  const sinkA = await A.json(`JSON.stringify(_t3dTowers.filter(t => t.el.dataset.owner === 'enemy').map(t => [t.el.dataset.pos, !!t.sink, +(t.group.position.y).toFixed(1)]))`);
  const sinkB = await B.json(`JSON.stringify(_t3dTowers.filter(t => t.el.dataset.owner === 'my').map(t => [t.el.dataset.pos, !!t.sink, +(t.group.position.y).toFixed(1)]))`);
  check('잠긴 타워가 반쯤 가라앉는다 (쓴 쪽 화면)', sinkA.every(x => x[1] && x[2] < -20), JSON.stringify(sinkA));
  check('맞는 쪽 화면에서도 가라앉는다', sinkB.every(x => x[1] && x[2] < -20), JSON.stringify(sinkB));
  const areaB = await B.json(`JSON.stringify((() => { const e = document.querySelector('.flood-area'); return e && [parseInt(e.style.left), parseInt(e.style.width)]; })())`);
  check('맞는 쪽 화면 — 같은 범위가 좌우 뒤집혀 (3~6열)', areaB && areaB[0] === 300 && areaB[1] === 400, JSON.stringify(areaB));
  await shot(A, 'water_flood_A_1700.png');
  await shot(B, 'water_flood_B_1700.png');
  await sleep(Math.max(0, 4500 - (Date.now() - t0)));
  const h2 = await hps();
  check('가라앉는 3초 — 0.5초마다 5 × 6 (총 30 더)', h2.left === h0.left - 60 && h2.king === h0.king - 60 && h2.right === h0.right - 60, JSON.stringify(h2));
  await sleep(600);
  const up = await A.json(`JSON.stringify(_t3dTowers.filter(t => t.el.dataset.owner === 'enemy').map(t => [!!t.sink, +(t.group.position.y).toFixed(1)]))`);
  check('3초 뒤 다시 떠오른다', up.every(x => !x[0] && x[1] > -1), JSON.stringify(up));

  // ════ 파도 ════
  await pickCard(A, 'wave_evo');
  // 2026-10-02 — 내 진영에도 놓는다 (커서가 띠 한가운데)
  const t10 = await tile(A, 5, 4);
  await mouse(A, 'mouseMoved', t10.x, t10.y); await sleep(150);
  check('내 진영에도 놓인다 (4~6열 띠)', await A.evalJs(`_waveAim.ok && _waveAim.c0 === 4 && !_castArc.classList.contains('cast-circle-bad')`) === true);
  const t5 = await tile(A, 9, 4);
  await mouse(A, 'mouseMoved', t5.x, t5.y); await sleep(200);
  const plan = await A.json(`JSON.stringify((() => { const a = _waveAim; return { c0: a.c0, hit: a.plan.hit, travel: a.plan.travelMs, end: a.plan.endMs,
    band: [parseInt(_castArc.querySelector('.cast-wave-band').style.left), parseInt(_castArc.querySelector('.cast-wave-band').style.width)] }; })())`);
  check('조준 — 상대 진영 맨 앞 3칸 띠 (8~10열)', plan.c0 === 8 && plan.band[0] === 800 && plan.band[1] === 300, JSON.stringify(plan));
  const w0 = await hps();
  await click(A, t5.x, t5.y);
  const s0 = Date.now();
  await sleep(1300);
  await shot(A, 'water_wave_A_1300.png');
  const wv = await B.json(`JSON.stringify(_t3dWaves.map(w => ({ dir: w.o.dir, front: Math.round(w.front) })))`);
  check('맞는 쪽 화면 — 3D 파도가 왼쪽(내 타워 쪽)으로 밀려온다', wv.length === 1 && wv[0].dir === -1, JSON.stringify(wv));
  await sleep(1200);
  const wv2 = await B.json(`JSON.stringify(_t3dWaves.map(w => Math.round(w.front)))`);
  check('파도가 실제로 밀려간다', wv2[0] < wv[0].front - 150, `${wv[0].front} → ${wv2[0]}`);
  await shot(A, 'water_wave_A_2500.png');
  await shot(B, 'water_wave_B_2500.png');
  await sleep(Math.max(0, plan.travel + 700 - 400 - (Date.now() - s0)));
  await shot(A, 'water_wave_A_crash.png');
  for (const ms of [150, 450, 900, 1500]) {
    await sleep(Math.max(0, plan.travel + 700 + ms - (Date.now() - s0)));
    await shot(A, `water_wave_A_crash${ms}.png`);
  }
  await sleep(Math.max(0, plan.travel + 700 + 1900 - (Date.now() - s0)));
  const w1 = await hps();
  const exp = p => 22 * (plan.hit[p] || 0);
  check('파도 안에 든 동안 0.5초마다 22 (정확히 계획대로)', ['left', 'king', 'right'].every(p => w0[p] - w1[p] === exp(p)),
        `${JSON.stringify(w0)} → ${JSON.stringify(w1)} · 예상 ${JSON.stringify(plan.hit)}`);
  check('맵 끝에 닿은 파도도 모두 맞혔다 (타워마다 1번 이상)', ['left', 'king', 'right'].every(p => (plan.hit[p] || 0) >= 1), JSON.stringify(plan.hit));
  await sleep(Math.max(0, plan.end + 600 - (Date.now() - s0)));
  check('잦아들고 마르면 파도가 사라진다', await A.evalJs(`_t3dWaves.length`) === 0 && await B.evalJs(`_t3dWaves.length`) === 0);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
