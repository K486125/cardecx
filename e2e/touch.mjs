// 4단계 — 목검·듀얼 검·바람: 범위가 타워 개체(발밑)에 닿기만 하면 맞고, 연출은 그 타워에 고정.
//         직선 끝 X자는 듀얼 검만. 토템은 무너진 옆 타워 칸에 설치 가능.
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, mouse, click,
         startMatch, pickCard, tile, groundToClient, fxOffset } from './lib.mjs';

await resetDB();
const A = await launch('A', 9321), B = await launch('B', 9322);
try {
  const code = await startMatch(A, B);
  const hp = pos => DBQ(`rooms/${code}/gameState/p2/towers/${pos}/hp`);
  const colRow = (b, id) => b.json(`JSON.stringify([+document.getElementById('${id}').style.getPropertyValue('--col'), +document.getElementById('${id}').style.getPropertyValue('--row')])`);

  // ── 1) 판정 식 (바닥 좌표) ────────────────────────────────
  const u = await A.json(`JSON.stringify((() => {
    const sw = CAST_STYLES.sword, ws = CAST_STYLES.windsmash, du = CAST_STYLES.dualsword;
    const K = { x: 1350, y: 450, half: 39 };
    return {
      swordGraze:   castRangeTouches(sw, { x: 1216, y: 450 }, K),     // 발밑까지 95 (반지름 100) · 한가운데까지 134
      swordMiss:    castRangeTouches(sw, { x: 1206, y: 450 }, K),     // 발밑까지 105
      swordBehind:  castRangeTouches(sw, { x: 1450, y: 450 }, K),     // 타워 오른편 — 부채꼴은 오른쪽으로만
      swordDiag:    castRangeTouches(sw, { x: 1260, y: 370 }, K),     // 비스듬히 — 모서리가 걸친다
      windGraze:    castRangeTouches(ws, { x: 1115, y: 450 }, K),     // 끝 1315 ≥ 발밑 1311
      windMiss:     castRangeTouches(ws, { x: 1105, y: 450 }, K),
      windSide:     castRangeTouches(ws, { x: 1250, y: 538 }, K),     // 가장자리 488 ≤ 489
      windSideMiss: castRangeTouches(ws, { x: 1250, y: 541 }, K),
      duGraze:      castRangeTouches(du, { x: 1350 - 39 - 330 + 1, y: 450 }, K)
    }; })())`);
  check('목검: 한가운데는 사거리 밖이어도 발밑에 닿으면 맞는다', u.swordGraze === true, JSON.stringify(u));
  check('목검: 발밑까지 못 미치면 안 맞는다', u.swordMiss === false);
  check('목검: 부채꼴 뒤쪽은 안 맞는다', u.swordBehind === false);
  check('목검: 비스듬히 모서리만 걸쳐도 맞는다', u.swordDiag === true);
  check('바람: 직선 끝이 발밑을 스치면 맞는다', u.windGraze === true && u.windMiss === false);
  check('바람: 직선 폭 가장자리가 걸쳐도 맞는다', u.windSide === true && u.windSideMiss === false);
  check('듀얼 검: 돌진 끝이 발밑에 닿으면 맞는다', u.duGraze === true);

  // ── 2) 직선 표시 — 끝 X자는 듀얼 검만 ────────────────────
  const [ekc, ekr] = await colRow(A, 'tower-enemy-king');
  const mid = await tile(A, 9, ekr);
  await pickCard(A, 'wind');
  await mouse(A, 'mouseMoved', mid.x, mid.y); await sleep(150);
  const wx = await A.json(`JSON.stringify({ lunge: !!document.querySelector('.cast-lunge'), x: !!document.querySelector('.cast-lunge .cast-lunge-x') })`);
  check('바람: 직선만 (끝에 X자 없음)', wx.lunge && wx.x === false, JSON.stringify(wx));
  await A.evalJs(`cancelStickyDrag(); 1`);
  await pickCard(A, 'dual_sword');
  await mouse(A, 'mouseMoved', mid.x, mid.y); await sleep(150);
  const dx = await A.json(`JSON.stringify({ lunge: !!document.querySelector('.cast-lunge'), x: !!document.querySelector('.cast-lunge .cast-lunge-x') })`);
  check('듀얼 검: 끝에 X자 범위가 있다', dx.lunge && dx.x === true, JSON.stringify(dx));
  await A.evalJs(`cancelStickyDrag(); 1`);

  // ── 3) 목검 — 끝이 킹 발밑만 스치게 ───────────────────────
  const kx = ekc * 100 + 50, ky = ekr * 100 + 50;
  const aim = await groundToClient(A, kx - 39 - 90, ky);       // 발밑까지 90 · 한가운데까지 129 (반지름 100)
  check('겨눌 화면 점을 찾았다', aim.err < 1.5, JSON.stringify(aim));
  await pickCard(A, 'wooden_sword');
  await mouse(A, 'mouseMoved', aim.x, aim.y); await sleep(200);
  const hl = await A.json(`JSON.stringify({ hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id), ready: !!document.querySelector('.cast-arc.cast-arc-ready') })`);
  check('스치기만 해도 준비 표시 + 타워 강조', hl.ready && hl.hl.includes('tower-enemy-king'), JSON.stringify(hl));
  const h0 = await hp('king');
  await click(A, aim.x, aim.y);
  await sleep(200);
  const fa = await fxOffset(A, 'cast-fx-sword', 'tower-enemy-king', 'sword');
  check('내 화면: 베기 연출이 타워 위에 고정', fa && Math.abs(fa.dx) <= 6 && Math.abs(fa.dy) <= 6, JSON.stringify(fa));
  const fb = await fxOffset(B, 'cast-fx-sword', 'tower-my-king', 'sword');
  check('상대 화면: 같은 타워 위에 고정', fb && Math.abs(fb.dx) <= 6 && Math.abs(fb.dy) <= 6, JSON.stringify(fb));
  await A.shot('shot_touch_sword.png');
  await sleep(900);
  const h1 = await hp('king');
  check('스치기만 해도 피해가 들어간다', h1 < h0, `${h0} → ${h1}`);

  // ── 4) 바람 — 길 끝이 발밑 앞 4px까지만 ─────────────────
  await sleep(300);
  const aimW = await groundToClient(A, kx - 39 - 196, ky);
  await pickCard(A, 'wind');
  await mouse(A, 'mouseMoved', aimW.x, aimW.y); await sleep(200);
  const w0 = await hp('king');
  await click(A, aimW.x, aimW.y);
  await sleep(120);
  const fw = await fxOffset(A, 'cast-fx-windsmash', 'tower-enemy-king', 'windsmash');
  check('바람: 연출의 맞는 점이 타워 위', fw && Math.abs(fw.dx) <= 6 && Math.abs(fw.dy) <= 6, JSON.stringify(fw));
  await sleep(700);
  check('바람: 스쳐도 피해가 들어간다', (await hp('king')) < w0);

  // ── 5) 듀얼 검 ────────────────────────────────────────────
  await sleep(300);
  const aimD = await groundToClient(A, kx - 39 - 325, ky);
  await pickCard(A, 'dual_sword');
  await mouse(A, 'mouseMoved', aimD.x, aimD.y); await sleep(200);
  const d0 = await hp('king');
  await click(A, aimD.x, aimD.y);
  await sleep(150);
  const fd = await fxOffset(A, 'cast-fx-dualsword', 'tower-enemy-king', 'dualsword');
  check('듀얼 검: X 베기 자리가 타워 위', fd && Math.abs(fd.dx) <= 6 && Math.abs(fd.dy) <= 6, JSON.stringify(fd));
  await sleep(1500);
  check('듀얼 검: 스쳐도 피해가 들어간다', (await hp('king')) < d0);

  // ── 6) 허공 — 연출은 누른 자리가 아니라 범위 안에서 ───────────
  // 목검: 부채꼴 꼭짓점(누른 자리)에서 반지름의 60% 앞이 베기의 중심, 그림은 범위 크기로 줄어든다
  await sleep(400);
  const air = await tile(A, 9, 3);
  await pickCard(A, 'wooden_sword');
  const before = JSON.stringify(await DBQ(`rooms/${code}/gameState/p2/towers`));
  await mouse(A, 'mouseMoved', air.x, air.y); await sleep(150);
  const want = await A.json(`(() => { const a = _clientToGround(${air.x}, ${air.y}); const r = CAST_STYLES.sword.radius;
    const p = _groundToStage(a.x + r * 0.6, a.y); return JSON.stringify({ x: p.x, y: p.y, ax: a.x, ay: a.y }); })()`);
  await click(A, air.x, air.y);
  await sleep(200);
  const fAir = await A.json(`(() => { const i = document.querySelector('.cast-fx-sword'); if (!i) return 'null';
    const st = CAST_STYLES.sword.fx, sc = st.scale || 1;
    return JSON.stringify({ hx: parseFloat(i.style.left) + st.hx * sc, hy: parseFloat(i.style.top) + st.hy * sc, w: parseFloat(i.style.width) }); })()`);
  check('허공 목검: 베기가 범위 안(꼭짓점에서 60 앞)에서 일어난다', fAir && Math.abs(fAir.hx - want.x) <= 1.5 && Math.abs(fAir.hy - want.y) <= 1.5,
        JSON.stringify(fAir) + ' / 기대 ' + JSON.stringify(want));
  check('허공 목검: 베기 그림이 범위 크기로 줄어든다 (600 × 0.62)', fAir && Math.abs(fAir.w - 372) < 1, JSON.stringify(fAir));
  // 상대 화면 — 좌우가 뒤집힌 같은 자리, 그림도 뒤집혀 오른쪽에서 벤다
  const fAirB = await B.json(`(() => { const i = document.querySelector('.cast-fx-sword'); if (!i) return 'null';
    const st = CAST_STYLES.sword.fx, sc = st.scale || 1, flip = i.style.transform.includes('scaleX(-1)');
    const p = _stageToGround(parseFloat(i.style.left) + (flip ? (st.w - st.hx) : st.hx) * sc, parseFloat(i.style.top) + st.hy * sc);
    return JSON.stringify({ flip, gx: +p.x.toFixed(1), gy: +p.y.toFixed(1) }); })()`);
  check('상대 화면: 같은 자리(좌우 반전)에서 뒤집혀 벤다',
    fAirB && fAirB.flip && Math.abs(fAirB.gx - (1600 - (want.ax + 60))) <= 3 && Math.abs(fAirB.gy - want.ay) <= 3,
    JSON.stringify(fAirB) + ' / 기대 ' + (1600 - (want.ax + 60)).toFixed(1));
  await A.shot('shot_air_sword.png');
  await sleep(700);
  check('허공: 피해 없음', JSON.stringify(await DBQ(`rooms/${code}/gameState/p2/towers`)) === before);

  // 듀얼 검: 직선 끝에서 X자로 벤다
  await sleep(900);
  await pickCard(A, 'dual_sword');
  await mouse(A, 'mouseMoved', air.x, air.y); await sleep(150);
  const wantD = await A.json(`(() => { const a = _clientToGround(${air.x}, ${air.y}); const p = _groundToStage(a.x + CAST_STYLES.dualsword.radius, a.y);
    return JSON.stringify({ x: p.x, y: p.y }); })()`);
  await click(A, air.x, air.y);
  await sleep(200);
  const fD = await A.json(`(() => { const i = document.querySelector('.cast-fx-dualsword'); if (!i) return 'null'; const st = CAST_STYLES.dualsword.fx, sc = st.scale || 1;
    return JSON.stringify({ hx: parseFloat(i.style.left) + st.hx * sc, hy: parseFloat(i.style.top) + st.hy * sc }); })()`);
  check('허공 듀얼 검: X 베기가 직선 범위 끝에서', fD && Math.abs(fD.hx - wantD.x) <= 1.5 && Math.abs(fD.hy - wantD.y) <= 1.5,
        JSON.stringify(fD) + ' / 기대 ' + JSON.stringify(wantD));
  await sleep(1500);

  // ── 6-2) 단일 대상 — 목검·듀얼 검은 두 타워에 동시에 닿지 않는다 ──
  const single = await A.json(`JSON.stringify((() => {
    const sw = CAST_STYLES.sword, du = CAST_STYLES.dualsword;
    const L = { x: 1450, y: 250, half: 33 }, K = { x: 1350, y: 450, half: 39 };
    // 목검: 이 자리에선 부채꼴이 두 발밑에 모두 걸친다 → 그래도 하나만 맞아야 한다
    const both = [castRangeTouches(sw, { x: 1340, y: 345 }, L), castRangeTouches(sw, { x: 1340, y: 345 }, K)];
    // 듀얼 검: 폭 100이면 어떤 높이에서도 위·가운데 타워에 동시에 닿지 않는다
    let duBoth = 0;
    for (let y = 200; y <= 500; y++) for (const x of [1000, 1100, 1200])
      if (castRangeTouches(du, { x, y }, L) && castRangeTouches(du, { x, y }, K)) duBoth++;
    return { both, duBoth, band: du.band, r: sw.radius, single: [sw.single, du.single, CAST_STYLES.windsmash.single] }; })())`);
  check('목검 범위 = 타일 한 칸(반지름 100), 듀얼 검 폭 100', single.r === 100 && single.band === 100, JSON.stringify(single));
  check('듀얼 검: 두 타워에 동시에 닿는 자리가 없다', single.duBoth === 0, JSON.stringify(single));
  check('목검: 두 발밑에 걸치는 자리는 있다 (실제 플레이로 하나만 맞는지 본다)', single.both[0] && single.both[1], JSON.stringify(single.both));

  const aimTwo = await groundToClient(A, 1140, 345);
  await pickCard(A, 'wooden_sword');
  await mouse(A, 'mouseMoved', aimTwo.x, aimTwo.y); await sleep(200);
  const hl2 = await A.json(`JSON.stringify([...document.querySelectorAll('.tower.drag-over')].map(e => e.id))`);
  check('두 타워에 걸쳐도 강조는 하나', hl2.length === 1, JSON.stringify(hl2));
  const t0 = await DBQ(`rooms/${code}/gameState/p2/towers`);
  await click(A, aimTwo.x, aimTwo.y);
  await sleep(150);
  const fOn = await fxOffset(A, 'cast-fx-sword', hl2[0] || 'tower-enemy-king', 'sword');   // 연출은 0.7초 — 바로 잰다
  await A.shot('shot_single_sword.png');
  await sleep(850);
  const t1 = await DBQ(`rooms/${code}/gameState/p2/towers`);
  const hitCount = ['left', 'king', 'right'].filter(p => t1[p].hp < t0[p].hp).length;
  check('두 타워에 걸쳐도 피해는 하나에만', hitCount === 1, JSON.stringify(['left', 'king', 'right'].map(p => `${p}:${t0[p].hp}→${t1[p].hp}`)));
  check('그때 베기는 맞은 타워 한가운데에', fOn && Math.abs(fOn.dx) <= 6 && Math.abs(fOn.dy) <= 6, JSON.stringify(fOn));
  await sleep(500);

  // ── 7) 토템 — 무너진 옆 타워 칸은 설치 가능 ──────────────
  await sleep(400);
  const [lc, lr] = await colRow(A, 'tower-my-left');
  await pickCard(A, 'forest_spirit');
  let t = await tile(A, lc, lr);
  await mouse(A, 'mouseMoved', t.x, t.y); await sleep(150);
  check('살아 있는 옆 타워 칸: 설치 불가', (await A.evalJs(`!!document.querySelector('.cast-totemtile.cast-circle-bad')`)) === true);
  await A.evalJs(`cancelStickyDrag(); 1`);

  await DBW(`rooms/${code}/gameState/p1/towers/left`, 'PATCH', { hp: 0, alive: false });
  await waitFor(A, `document.getElementById('tower-my-left').classList.contains('destroyed')`, 8000);
  await sleep(1500);
  await pickCard(A, 'forest_spirit');
  t = await tile(A, lc, lr);
  await mouse(A, 'mouseMoved', t.x, t.y); await sleep(150);
  const s7 = await A.json(`JSON.stringify({ has: !!document.querySelector('.cast-totemtile'), bad: !!document.querySelector('.cast-totemtile.cast-circle-bad'), cell: [parseFloat(document.querySelector('.cast-totemtile .cast-tile-cell')?.style.left), parseFloat(document.querySelector('.cast-totemtile .cast-tile-cell')?.style.top)] })`);
  check('무너진 옆 타워 칸: 설치 가능', s7.has && s7.bad === false && s7.cell[0] === lc * 100 + 50, JSON.stringify(s7));
  await click(A, t.x, t.y);
  await sleep(400);
  check('그 칸에 실제로 설치된다', (await A.evalJs(`_t3dTotems.length >= 1 && !boardIsHoldingCard()`)) === true);
  await A.shot('shot_touch_totem.png');

  await pickCard(A, 'forest_spirit');
  const [kc, kr] = await colRow(A, 'tower-my-king');
  const kt = await tile(A, kc, kr);
  await mouse(A, 'mouseMoved', kt.x, kt.y); await sleep(150);
  check('살아 있는 킹 타워 칸은 여전히 불가', (await A.evalJs(`!!document.querySelector('.cast-totemtile.cast-circle-bad')`)) === true);
  await A.evalJs(`cancelStickyDrag(); 1`);

  check('두 화면 모두 스크립트 오류 없음', A.exceptions.length === 0 && B.exceptions.length === 0,
        JSON.stringify([...A.exceptions, ...B.exceptions]).slice(0, 300));
  console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
} catch (e) { console.log('FAIL', e.message); addFail(); }
finally { A.proc.kill(); B.proc.kill(); process.exit(failCount() ? 1 : 0); }
