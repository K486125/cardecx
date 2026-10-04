// Plan 3 3단계 — 화살(일자 3칸 · Space 차징 21~39 · 끝까지 1.2초) · 사랑의 화살(1초 · 적 100 피해 / 내 타워 100 회복, 하트)
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, mouse, click,
         startMatch, pickCard, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9381), B = await launch('B', 9382);
const all = [A, B];
const space = (b, type) => b.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
try {
  const code = await startMatch(A, B);
  const hp = (who, pos) => DBQ(`rooms/${code}/gameState/${who}/towers/${pos}/hp`);

  // ════ 카드 정의 ═══════════════════════════════════════════════
  const defs = await A.json(`JSON.stringify({ ar: CARD_DEFINITIONS.arrow, la: CARD_DEFINITIONS.love_arrow,
    old: !!CARD_DEFINITIONS.cupid_arrow, evo: EVOLUTION_MAP.arrow, name: tCard('love_arrow', 'name'),
    st: CAST_STYLES.arrow })`);
  check('화살: 연출 arrow · 3칸 · 끝까지 1.2초 · 21~39', defs.ar.cast === 'arrow' && defs.st.radius === 300 && defs.st.flyMs === 1200 &&
        defs.st.charge.damage[0] === 21 && defs.st.charge.damage.at(-1) === 39 && defs.st.charge.fullMs === 2000);
  check('진화: 큐피드 화살 → 사랑의 화살', !defs.old && defs.evo === 'love_arrow' && defs.name === '사랑의 화살' &&
        defs.la.effect.dualEffect.attack.damage === 70 && defs.la.effect.dualEffect.support.heal === 80);

  // ════ 화살 조준 ═══════════════════════════════════════════════
  await pickCard(A, 'arrow');
  const p1 = await groundToClient(A, 1000, 450);   // 킹 12열 — 앞으로 3칸이 닿는 자리
  await mouse(A, 'mouseMoved', p1.x, p1.y); await sleep(200);
  const aim = await A.json(`(() => { const a = document.querySelector('#cast-ground .cast-shot');
    return JSON.stringify({ l: parseFloat(a.style.left), w: parseFloat(a.style.width), h: parseFloat(a.style.height),
      head: !!a.querySelector('.cast-shot-head'), x: !!a.querySelector('.cast-lunge-x'),
      hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id), hud: !!document.querySelector('.cast-shot-hud .cast-throw-gauge') }); })()`);
  check('화살 조준: 커서에서 앞으로 3칸 × 1칸, 끝은 화살촉 (X자 없음)', Math.abs(aim.l - 1000) <= 1 && aim.w === 300 && aim.h === 100 && aim.head && !aim.x, JSON.stringify(aim));
  check('처음 닿는 타워(킹) 하나만 강조 + 차징 게이지', aim.hl.join(',') === 'tower-enemy-king' && aim.hud, JSON.stringify(aim));

  // ════ Space 차징 → 39 ═════════════════════════════════════════
  await space(A, 'rawKeyDown');
  for (let i = 0; i < 12; i++) { await sleep(190); await A.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, autoRepeat: true }); }
  await space(A, 'keyUp');
  await sleep(100);
  const g = await A.json(`JSON.stringify({ dmg: document.querySelector('.cast-shot-hud .cast-throw-dmg').textContent,
    full: document.querySelector('.cast-shot-hud .cast-throw-gauge').classList.contains('full'),
    tick: document.querySelector('.cast-shot-hud .cast-throw-gauge').style.getPropertyValue('--tick') })`);
  check('Space 2초 차징 → 게이지 가득, 39, 눈금 6칸', g.dmg === '39' && g.full && g.tick === '60.00deg', JSON.stringify(g));

  const k0 = await hp('p2', 'king');
  const t0 = Date.now();
  await click(A, p1.x, p1.y);
  await sleep(80);
  const fx = await A.json(`JSON.stringify({ bow: !!document.querySelector('.fx-bow'), arrow: !!document.querySelector('.fx-arrow.fx-arrow-charged'),
    shadow: !!document.querySelector('#cast-ground .fx-arrow-shadow'), held: boardIsHoldingCard(), hud: !!document.querySelector('.cast-shot-hud') })`);
  check('쏘면 활 · 빛나는 화살 · 바닥 그림자, 조준·게이지는 사라진다', fx.bow && fx.arrow && fx.shadow && !fx.held && !fx.hud, JSON.stringify(fx));
  await waitFor(B, `!!document.querySelector('.fx-arrow')`, 3000);
  const bdir = await B.evalJs(`document.querySelector('.fx-arrow .fx-arrow-body').style.transform`);
  check('상대 화면: 화살이 오른쪽→왼쪽으로 날아온다', bdir.includes('scaleX(-1)'), bdir);
  await sleep(Math.max(0, 450 - (Date.now() - t0)));
  const k1 = await hp('p2', 'king');
  check('날아가는 중엔 아직 피해 없음', k1 === k0, `${k0} → ${k1}`);
  // 킹 발밑 앞면(1311)까지 211 → 1.2초 × 211/300 ≈ 0.84초
  await waitFor(A, `true`, 100);
  let k2 = k1, tHit = 0;
  while (Date.now() - t0 < 2500) { k2 = await hp('p2', 'king'); if (k2 !== k0) { tHit = Date.now() - t0; break; } await sleep(40); }
  check('가득 찬 화살 = 39 피해', k0 - k2 === 39, `${k0} → ${k2}`);
  check('꽂히는 시각 ≈ 0.84초 (사거리 끝까지 1.2초 비율)', tHit > 700 && tHit < 1250, `${tHit}ms`);
  // 어느 높이에서 쐈든 화살은 타워 앞면 한가운데(3D 모형 몸통 가운데)에 꽂힌다 — 촉은 벽 속에 묻힌다
  const st1 = await A.json(`(() => { const m = document.querySelector('.fx-arrow-mark'), a = document.querySelector('.fx-arrow.fx-arrow-stuck');
    const want = towers3dTowerPoint('enemy', 'king', 0.5);
    if (!m || !a || !want) return JSON.stringify({ m: !!m, a: !!a });
    const mr = m.getBoundingClientRect(), ar = a.getBoundingClientRect();
    return JSON.stringify({ dx: +(parseFloat(m.style.left) - want.x).toFixed(1), dy: +(parseFloat(m.style.top) - want.y).toFixed(1),
      tip: Math.round(Math.hypot(ar.left - (mr.left + mr.width / 2), ar.top - (mr.top + mr.height / 2))),
      clip: getComputedStyle(a.querySelector('svg')).clipPath !== 'none' }); })()`);
  check('화살이 타워 한가운데에 꽂힌다 (촉은 벽 속)', st1.dx === 0 && st1.dy === 0 && st1.tip <= 12 && st1.clip, JSON.stringify(st1));
  const bst = await B.json(`(() => { const m = document.querySelector('.fx-arrow-mark'); const w = towers3dTowerPoint('my', 'king', 0.5);
    return m && w ? JSON.stringify({ dx: +(parseFloat(m.style.left) - w.x).toFixed(1), dy: +(parseFloat(m.style.top) - w.y).toFixed(1) }) : 'null'; })()`);
  check('상대 화면에서도 그 타워 한가운데에 꽂힌다', bst && bst.dx === 0 && bst.dy === 0, JSON.stringify(bst));
  await A.shot('shot_arrow_hit.png');

  // ════ 허공 · 차징 없음 ════════════════════════════════════════
  await sleep(1400);
  await pickCard(A, 'arrow');
  const pa = await groundToClient(A, 820, 450);
  await mouse(A, 'mouseMoved', pa.x, pa.y); await sleep(150);
  const all0 = JSON.stringify([await hp('p2', 'left'), await hp('p2', 'king'), await hp('p2', 'right')]);
  await click(A, pa.x, pa.y);
  await sleep(1500);
  const all1 = JSON.stringify([await hp('p2', 'left'), await hp('p2', 'king'), await hp('p2', 'right')]);
  check('허공 화살: 피해 없음', all0 === all1, `${all0} → ${all1}`);

  await sleep(500);
  await pickCard(A, 'arrow');
  const pl = await groundToClient(A, 950, 250);
  await mouse(A, 'mouseMoved', pl.x, pl.y); await sleep(150);
  const l0 = await hp('p2', 'left');
  await click(A, pl.x, pl.y);
  await sleep(1500);
  const l1 = await hp('p2', 'left');
  check('차징 없는 화살 = 21 (위쪽 타워)', l0 - l1 === 21, `${l0} → ${l1}`);

  // ════ 사랑의 화살 — 적 타워 ═══════════════════════════════════
  await sleep(600);
  await pickCard(A, 'love_arrow');
  const pr = await groundToClient(A, 950, 650);
  await mouse(A, 'mouseMoved', pr.x, pr.y); await sleep(150);
  const lovAim = await A.json(`JSON.stringify({ love: !!document.querySelector('.cast-shot.cast-shot-love'), hud: !!document.querySelector('.cast-shot-hud'),
    hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id) })`);
  check('사랑의 화살: 분홍 조준, 차징 없음, 아래 타워 강조', lovAim.love && !lovAim.hud && lovAim.hl.join(',') === 'tower-enemy-right', JSON.stringify(lovAim));
  const r0 = await hp('p2', 'right');
  const t1 = Date.now();
  await click(A, pr.x, pr.y);
  await sleep(300);
  const heartA = await A.evalJs(`_t3dLove.length`);
  const heartB = await B.evalJs(`_t3dLove.length`);
  check('날아가는 동안 적 타워 앞에 하트가 나타난다 (양쪽 화면)', heartA === 1 && heartB === 1, `${heartA}/${heartB}`);
  await sleep(400);
  await A.shot('shot_love_break_before.png');
  let r1 = r0, tl = 0;
  while (Date.now() - t1 < 2500) { r1 = await hp('p2', 'right'); if (r1 !== r0) { tl = Date.now() - t1; break; } await sleep(40); }
  await A.shot('shot_love_break.png');
  check('사랑의 화살 → 적 타워 즉시 70 피해', r0 - r1 === 70, `${r0} → ${r1}`);
  // 발밑 앞면(1417)까지 267 → 1초 × 267/300 ≈ 0.89초
  check('꽂히는 시각 ≈ 0.89초', tl > 750 && tl < 1350, `${tl}ms`);

  // ════ 사랑의 화살 — 내 타워 회복 ══════════════════════════════
  await sleep(1200);
  await DBW(`rooms/${code}/gameState/p1/towers/king/hp`, 'PUT', 1200);
  await waitFor(A, `_boardGameState?.p1?.towers?.king?.hp === 1200`, 4000);
  await A.evalJs(`castResetCooldown(); 1`);
  await pickCard(A, 'love_arrow');
  const ph = await groundToClient(A, 600, 450);   // 내 킹 3열
  await mouse(A, 'mouseMoved', ph.x, ph.y); await sleep(150);
  const healAim = await A.json(`(() => { const a = document.querySelector('#cast-ground .cast-shot');
    return JSON.stringify({ left: a.classList.contains('cast-shot-left'), l: parseFloat(a.style.left),
      hl: [...document.querySelectorAll('.tower.drag-over-heal')].map(e => e.id) }); })()`);
  check('내 진영에서 쏘면 왼쪽(내 타워 쪽)으로 · 내 킹이 초록 강조', healAim.left && Math.abs(healAim.l - 300) <= 1 && healAim.hl.join(',') === 'tower-my-king', JSON.stringify(healAim));
  const th = Date.now();
  await click(A, ph.x, ph.y);
  await sleep(1050);   // 꽂힘 ≈0.7초 → 하트가 부풀어 오르는 중 (터지는 건 +1.1초)
  const midHp = await hp('p1', 'king');
  const heal3d = await A.json(`JSON.stringify({ n: _t3dLove.length, glow: (_t3dTowers.find(t => t.el.id === 'tower-my-king').glowUntil || 0) > performance.now() })`);
  await A.shot('shot_love_heal.png');
  check('하트가 터지기 전엔 아직 회복 없음', midHp === 1200, String(midHp));
  await sleep(950)   /* 꽂힘 ≈0.7초 + 부풀기·터지기 1.1초 */;
  const heal3d2 = await A.json(`JSON.stringify({ n: _t3dLove.length, glow: (_t3dTowers.find(t => t.el.id === 'tower-my-king').glowUntil || 0) > performance.now() })`);
  check('하트가 터지면 건물이 분홍으로 빛난다', heal3d.n === 1 && heal3d2.glow, JSON.stringify({ heal3d, heal3d2 }));
  await waitFor(B, `_t3dLove.length === 1`, 2000).then(() => check('상대 화면에도 회복 하트', true)).catch(() => check('상대 화면에도 회복 하트', false));
  await sleep(300);
  const kh = await hp('p1', 'king');
  check('내 킹 80 회복', kh === 1280, `1200 → ${kh}`);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) {
  console.log('ERROR', e.message); addFail();
} finally {
  for (const b of all) b.proc.kill();
}
console.log(failCount() ? `\n${failCount()}개 실패` : '\n전부 통과');
process.exit(failCount() ? 1 : 0);
