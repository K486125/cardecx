// 2026-10-02 — 불덩이(투척 2×2, 28 + 6×5) · 폭염(3×7, 49 + 9×5 → 더위 +15%) · 벽돌 · 철벽(직선 80% / 범위 50%)
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9641), B = await launch('B', 9642);
const all = [A, B];
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const hp = (who, pos) => DBQ(`${G}/${who}/towers/${pos}/hp`);
  const hps = async who => ({ left: await hp(who, 'left'), king: await hp(who, 'king'), right: await hp(who, 'right') });

  // ── 불덩이 ──
  await pickCard(A, 'flame');
  check('이름이 불덩이', await A.evalJs(`CARD_DEFINITIONS.flame.name`) === '불덩이');
  const fp = await groundToClient(A, 1160, 660);              // 오른쪽 타워(11,6) 칸 오른쪽 아래 → 꼭짓점 (12,7)
  await mouse(A, 'mouseMoved', fp.x, fp.y); await sleep(200);
  const aim = await A.json(`JSON.stringify((() => {
    const l = document.querySelector('.cast-lands .cast-throw-land'), d = document.querySelector('.cast-throw-dot');
    const p = document.querySelector('.cast-throw-path').getAttribute('d').trim().split(/\\s+/);
    return { l: parseInt(l.style.left), t: parseInt(l.style.top), w: parseInt(l.style.width), h: parseInt(l.style.height),
             dot: d && d.style.display !== 'none', dx: Math.round(parseFloat(d.style.left)), dy: Math.round(parseFloat(d.style.top)),
             ex: Math.round(+p[p.length - 2]), ey: Math.round(+p[p.length - 1]),
             gauge: !!document.querySelector('.cast-throw-gauge'),
             hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id) }; })())`);
  check('불덩이 조준 — 2×2 착지 칸 (꼭짓점 1200,700)', aim.l === 1200 && aim.t === 700 && aim.w === 200 && aim.h === 200, JSON.stringify(aim));
  check('포물선이 칸 네 개가 만나는 점에서 끝나고 그 점에 표식', aim.dot && Math.abs(aim.ex - aim.dx) <= 1 && Math.abs(aim.ey - aim.dy) <= 1, JSON.stringify(aim));
  check('차징 게이지는 없다 · 오른쪽 타워 강조', !aim.gauge && aim.hl.join() === 'tower-enemy-right', JSON.stringify(aim));
  const h0 = await hps('p2');
  await click(A, fp.x, fp.y);
  const t0 = Date.now();
  await sleep(450);
  check('화염 덩이가 날아간다 (두 화면)', await A.evalJs(`!!document.querySelector('.fireball-fly')`) && await B.evalJs(`!!document.querySelector('.fireball-fly')`));
  await shot(A, 'fw_fly.png');
  await sleep(Math.max(0, 1250 - (Date.now() - t0)));
  const h1 = await hps('p2');
  check('떨어지는 순간 28', h0.right - h1.right === 28, `${h0.right} → ${h1.right}`);
  const fires = b => b.evalJs(`_t3dFires.length`);
  const fa = await fires(A), fb = await fires(B);
  check('두 화면 모두 2×2칸이 불탄다 (3D 불길)', fa >= 10 && fb >= 10, `A ${fa} · B ${fb}`);
  check('맞는 쪽 화면에도 그을음 (좌우 뒤집힌 3~4열)', await B.json(`JSON.stringify((() => { const e = document.querySelector('.fire-scorch'); return e && [parseInt(e.style.left), parseInt(e.style.top)]; })())`).then(v => v && v[0] === 300 && v[1] === 600));
  await sleep(500);
  await shot(A, 'fw_burn.png');
  await sleep(Math.max(0, 4200 - (Date.now() - t0)));
  const h2 = await hps('p2');
  check('불길 속 0.5초마다 6 × 5 (총 58)', h0.right - h2.right === 58, `${h0.right} → ${h2.right}`);
  check('다른 타워는 그대로', h2.king === h0.king && h2.left === h0.left);

  // ── 폭염 ──
  await A.evalJs(`castResetCooldown(); 1`);
  await pickCard(A, 'fire_evo');
  check('진화 이름이 폭염 · 아이콘 그대로', await A.evalJs(`CARD_DEFINITIONS.fire_evo.name + CARD_DEFINITIONS.fire_evo.icon`) === '폭염🎇');
  const hc = await tile(A, 11, 4);
  await mouse(A, 'mouseMoved', hc.x, hc.y); await sleep(200);
  const ha = await A.json(`JSON.stringify({ l: parseInt(_castArc.style.left), t: parseInt(_castArc.style.top), w: parseInt(_castArc.style.width), h: parseInt(_castArc.style.height),
    hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id).sort() })`);
  check('폭염 조준 — 3×7칸 (10~12열 · 1~7행), 타워 셋 강조', ha.l === 1000 && ha.t === 100 && ha.w === 300 && ha.h === 700 && ha.hl.length === 3, JSON.stringify(ha));
  const w0 = await hps('p2');
  await click(A, hc.x, hc.y);
  const t1 = Date.now();
  await sleep(150);
  const zones = await DBQ(`${G}/heatZones`);
  const z = zones && Object.values(zones)[0];
  check('열기 구역 기록 (p2 · 10~12열 · 1~7행 · 15%)', z && z.victim === 'p2' && z.c0 === 10 && z.c1 === 12 && z.r0 === 1 && z.r1 === 7 && z.percent === 15 && z.until - z.from === 6000, JSON.stringify(z));
  await sleep(Math.max(0, 900 - (Date.now() - t1)));
  const w1 = await hps('p2');
  check('폭발 — 범위 안 타워 셋 모두 49', ['left', 'king', 'right'].every(p => w0[p] - w1[p] === 49), JSON.stringify([w0, w1]));
  await shot(A, 'fw_blast.png');
  await shot(B, 'fw_blast_B.png');
  await sleep(900);
  await shot(A, 'fw_towerburn.png');
  check('범위 안 타워가 불길에 휩싸인다', await A.evalJs(`_t3dFires.length`) > 30);
  await sleep(Math.max(0, 3700 - (Date.now() - t1)));
  const w2 = await hps('p2');
  check('불타는 동안 0.5초마다 9 × 5 (타워마다 총 94)', ['left', 'king', 'right'].every(p => w0[p] - w2[p] === 94), JSON.stringify([w0, w2]));
  await sleep(600);
  check('열기 — 아지랑이가 오르고 타워에 더위 표 (두 화면)',
    await A.evalJs(`_t3dHazes.length >= 21 && document.getElementById('tower-enemy-king').classList.contains('tower-heat')`) === true &&
    await B.evalJs(`document.getElementById('tower-my-king').classList.contains('tower-heat')`) === true);
  await shot(A, 'fw_heat.png');
  // 더위 속에서 받는 카드 피해 +15% — 40 → 46
  const k3 = await hp('p2', 'king');
  await A.evalJs(`applyCardUse('p1', null, null, 'p2', ['king'], { ...CARD_DEFINITIONS.wooden_sword, effect: { damage: 40 } }, getGameState().p2.towers, getGameState()); 1`);
  await sleep(700);
  const k4 = await hp('p2', 'king');
  check('더위 — 카드 피해 15% 더 (40 → 46)', k3 - k4 === 46, `${k3} → ${k4}`);
  await sleep(Math.max(0, 3300 + 6000 + 300 - (Date.now() - t1)));
  const k5 = await hp('p2', 'king');
  await A.evalJs(`applyCardUse('p1', null, null, 'p2', ['king'], { ...CARD_DEFINITIONS.wooden_sword, effect: { damage: 40 } }, getGameState().p2.towers, getGameState()); 1`);
  await sleep(700);
  check('열기가 사라지면 그대로 (40)', k5 - await hp('p2', 'king') === 40);

  // ── 벽돌 ──
  await pickCard(A, 'brick');
  const kt = await tile(A, 3, 4);
  await mouse(A, 'mouseMoved', kt.x, kt.y); await sleep(200);
  check('벽돌 — 내 타워 칸 한 칸 조준', await A.evalJs(`!!document.querySelector('.cast-towertile') && document.getElementById('tower-my-king').classList.contains('drag-over-heal') || document.getElementById('tower-my-king').classList.contains('drag-over')`) === true);
  await click(A, kt.x, kt.y);
  await sleep(800);
  const wall = b => b.json(`JSON.stringify(_t3dWalls.map(w => ({ id: w.el.id, kind: w.kind, sy: +(w.group.scale.y / w.s).toFixed(2) })))`);
  const wa = await wall(A), wb = await wall(B);
  check('두 화면 모두 타워를 둘러싼 벽돌 방어막이 솟는다', wa.length === 1 && wa[0].id === 'tower-my-king' && wa[0].kind === 'brick' && wa[0].sy > 0.95
        && wb.length === 1 && wb[0].id === 'tower-enemy-king', JSON.stringify([wa, wb]));
  const kingT = await DBQ(`${G}/p1/towers/king`);
  check('피해 40% 감소 · 6초', kingT.damageReductionPercent === 40 && !kingT.damageReductionLinePercent, JSON.stringify(kingT));
  await shot(A, 'fw_brick.png');

  // ── 철벽 ──
  await A.evalJs(`castResetCooldown(); 1`);
  await pickCard(A, 'iron_wall');
  const lt = await tile(A, 4, 2);
  await mouse(A, 'mouseMoved', lt.x, lt.y); await sleep(150);
  await click(A, lt.x, lt.y);
  await sleep(800);
  const leftT = await DBQ(`${G}/p1/towers/left`);
  check('철벽 — 직선 80% · 범위 50%', leftT.damageReductionPercent === 50 && leftT.damageReductionLinePercent === 80, JSON.stringify(leftT));
  check('철벽 방벽이 선다', (await wall(A)).some(w => w.id === 'tower-my-left' && w.kind === 'iron'));
  await shot(A, 'fw_iron.png');
  await shot(B, 'fw_iron_B.png');
  const l0 = await hp('p1', 'left');
  await B.evalJs(`applyCardUse('p2', null, null, 'p1', ['left'], { ...CARD_DEFINITIONS.wooden_sword, effect: { damage: 40 } }, getGameState().p1.towers, getGameState()); 1`);
  await sleep(700);
  const l1 = await hp('p1', 'left');
  check('직선 공격(목검 40)은 80% 막아 8', l0 - l1 === 8, `${l0} → ${l1}`);
  await B.evalJs(`applyCardUse('p2', null, null, 'p1', ['left'], { ...CARD_DEFINITIONS.thorn, effect: { damage: 40 } }, getGameState().p1.towers, getGameState()); 1`);
  await sleep(700);
  const l2 = await hp('p1', 'left');
  check('범위 공격(가시 40)은 50% 막아 20', l1 - l2 === 20, `${l1} → ${l2}`);
  await sleep(6500);
  check('시간이 지나면 방벽이 무너져 사라진다', (await wall(A)).length === 0);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
