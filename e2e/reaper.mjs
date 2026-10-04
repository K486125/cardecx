// 그림리퍼 — 컷씬(게임 시간 정지) · 소환 칸 규칙 · 걷기/낫(정확히 한 번)/영혼 · 상대 카드에 맞음 · 분열 · 방향 전환
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, mouse, click,
         startMatch, pickCard, tile } from './lib.mjs';

await resetDB();
const A = await launch('A', 9461), B = await launch('B', 9462);
const all = [A, B];
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const hp = (who, pos) => DBQ(`${G}/${who}/towers/${pos}/hp`);
  const units = async () => Object.entries(await DBQ(`${G}/units`) || {});

  // ════ 소환 칸 표시 — 처음엔 옆 타워 줄만: 초록 8칸 (2행·6행 3~6열), 나머지는 빨강 (킹 줄은 옆 타워가 다 무너진 뒤) ════
  await pickCard(A, 'grim_reaper');
  const grid = await A.json(`JSON.stringify({ ok: document.querySelectorAll('.cast-summon-tile.ok').length,
    bad: document.querySelectorAll('.cast-summon-tile.bad').length,
    okTiles: [...document.querySelectorAll('.cast-summon-tile.ok')].map(e => [parseInt(e.style.left) / 100, parseInt(e.style.top) / 100].join(',')) })`);
  check('소환 가능한 칸 4 (킹 줄 없음) · 나머지 140칸 빨강', grid.ok === 4 && grid.bad === 140 && !grid.okTiles.some(t => t.endsWith(',4')), JSON.stringify(grid));
  // 안 되는 칸 — 타워 칸(4,2) · 타워 뒤(3,6) · 줄 아님(5,3) · 강(7,2) · 아직 킹 줄(5,4) → 클릭해도 카드는 손에 남는다
  for (const [c, r] of [[4, 2], [3, 6], [5, 3], [7, 2], [5, 4]]) {
    const t = await tile(A, c, r);
    await mouse(A, 'mouseMoved', t.x, t.y); await sleep(80);
    await click(A, t.x, t.y); await sleep(150);
  }
  check('빨간 칸에는 놓이지 않는다 (유닛 없음 · 카드 그대로)', (await units()).length === 0 && await A.evalJs(`boardIsHoldingCard()`));

  // ════ 소환 → 컷씬 · 게임 시간 정지 ════
  const t6 = await tile(A, 6, 2);
  await mouse(A, 'mouseMoved', t6.x, t6.y); await sleep(120);
  const pathW = await A.evalJs(`parseInt(document.querySelector('.cast-summon-path').style.width)`);
  check('걸어갈 길 — 6열에서 옆 타워(11열) 앞 10열까지 (400px)', pathW === 400, String(pathW));
  const e0 = await A.evalJs(`getCurrentEnergy()`);
  const tm0 = await A.evalJs(`document.getElementById('match-timer-display').textContent`);
  await click(A, t6.x, t6.y);
  await waitFor(A, `!!document.querySelector('.reaper-cut')`, 3000);
  await waitFor(B, `!!document.querySelector('.reaper-cut')`, 3000);
  check('두 화면 모두 컷씬', true);
  const pz = Object.values(await DBQ(`${G}/pauses`) || {});
  check('멈춤 기록 하나 (컷씬 길이)', pz.length === 1 && pz[0].dur === await A.evalJs('REAPER_CUT_MS') && pz[0].owner === 'p1', JSON.stringify(pz));
  const eMid = await A.evalJs(`getCurrentEnergy()`);
  await sleep(3200);
  const eMid2 = await A.evalJs(`getCurrentEnergy()`);
  const tmMid = await A.evalJs(`document.getElementById('match-timer-display').textContent`);
  const tmB = await B.evalJs(`document.getElementById('match-timer-display').textContent`);
  check('컷씬 동안 에너지가 차지 않는다', eMid === eMid2, `${e0} → ${eMid} → ${eMid2}`);
  check('컷씬 동안 경기 시간이 흐르지 않는다', await A.evalJs(`gamePaused()`) && await B.evalJs(`gamePaused()`), `${tm0} / ${tmMid} / B ${tmB}`);
  // 컷씬 중 B는 카드를 못 쓴다
  const bUse = await B.evalJs(`(() => { const e = getCurrentEnergy(); addCardToDeck({ ...CARD_DEFINITIONS.wooden_sword });
    const i = _deckSlots.findIndex(s => s && s.card.id === 'wooden_sword');
    window.onCardUsed(_deckSlots[i].card, i, 'enemy', 'king'); return getCurrentEnergy() === e; })()`);
  check('컷씬 중엔 카드 사용이 막힌다', bUse === true);
  await A.shot('shot_reaper_cut.png');
  await waitFor(A, `!document.querySelector('.reaper-cut')`, 9000);
  await waitFor(B, `!document.querySelector('.reaper-cut')`, 9000);
  const tmAfter = await A.evalJs(`document.getElementById('match-timer-display').textContent`);
  check('컷씬 뒤 경기 시간 다시 흐름 (멈춘 만큼 늦다)', !(await A.evalJs(`gamePaused()`)), `${tm0} → ${tmAfter}`);

  // ════ 필드 — 걸어가서 2초마다 67 · 정확히 한 번 · 영혼 ════
  let us = await units();
  check('유닛 하나 (p1, 체력 200, 목표 윗줄 옆 타워)', us.length === 1 && us[0][1].owner === 'p1' && us[0][1].hp === 200 && us[0][1].leg.target === 'left', JSON.stringify(us[0]?.[1]));
  const uid = us[0][0];
  await waitFor(A, `document.querySelectorAll('.unit-hud').length === 1`, 3000);
  await waitFor(B, `document.querySelectorAll('.unit-hud').length === 1`, 3000);
  check('두 화면에 리퍼·머리 위 막대', true);
  const posA = await A.json(`JSON.stringify(unitPosAt(_uGs.units['${uid}'], gameNow()))`);
  const posB = await B.json(`JSON.stringify(unitPosAt(_uGs.units['${uid}'], gameNow()))`);
  check('두 화면이 같은 자리로 계산 (p1 기준)', Math.abs(posA.c - posB.c) < 0.3 && posA.r === posB.r, `${posA.c.toFixed(2)} / ${posB.c.toFixed(2)}`);
  // B 화면에서는 오른쪽에서 왼쪽으로 걷는다 — 머리 위 막대의 x가 줄어든다
  const hx1 = await B.evalJs(`parseFloat(document.querySelector('.unit-hud').style.left)`);
  await sleep(1600);
  const hx2 = await B.evalJs(`parseFloat(document.querySelector('.unit-hud').style.left)`);
  check('B 화면 — 리퍼가 내 옆 타워(왼쪽)를 향해 걸어온다', hx2 < hx1 - 40, `${hx1} → ${hx2}`);
  await A.shot('shot_reaper_walk_A.png');
  await B.shot('shot_reaper_walk_B.png');

  const k0 = await hp('p2', 'left');
  // 6칸 × 1.5초 + 나타남 0.7 + 첫 낫 0.65 — 컷씬 끝에서 약 10.4초
  await waitFor(A, `(_uGs.units['${uid}'] && unitSwingsBy(_uGs.units['${uid}'], gameNow()) >= 1)`, 14000);
  await sleep(2600);   // 두 번째 낫 + 맞는 쪽의 늦은 확인(1.5초)까지
  const k1 = await hp('p2', 'left');
  const sw = await A.evalJs(`unitSwingsBy(_uGs.units['${uid}'], gameNow())`);
  check('낫 한 번에 67 — 두 화면이 불러도 정확히 한 번', k0 - k1 === 67 * sw, `${k0} → ${k1} (휘두름 ${sw})`);
  const soulTxt = await B.evalJs(`document.querySelector('.unit-souls b').textContent`);
  check('영혼 = 휘두른 횟수 (B 화면 원 안 숫자)', Number(soulTxt) === sw, `${soulTxt} / ${sw}`);
  // 다음 낫이 내리치는 순간을 찍는다 (꼬리·타워 베기 연출 확인용)
  const until = await A.evalJs(`(() => { const u = _uGs.units['${uid}']; const g = unitLeg(u); const now = gameNow();
    const k = Math.ceil((now - g.firstSwing) / REAPER.swingMs); return g.firstSwing + k * REAPER.swingMs - now; })()`);
  await sleep(Math.max(0, until - 40));
  await A.shot('shot_reaper_swing_A.png');
  await sleep(160);
  await B.shot('shot_reaper_swing_B.png');

  // ════ 상대 카드에 맞는다 — B가 붕괴(55)를 리퍼 칸에 ════
  // 리퍼는 p1 기준 (10,2) → B 화면 (5,2)
  await pickCard(B, 'collapse');
  const bt = await tile(B, 5, 2);
  await mouse(B, 'mouseMoved', bt.x, bt.y); await sleep(150);
  await click(B, bt.x, bt.y);
  await sleep(2500);
  let u = (await DBQ(`${G}/units/${uid}`));
  check('붕괴 범위의 리퍼 — 체력 200 → 175', u?.hp === 175, String(u?.hp));
  // 같은 예약을 두 화면이 다시 불러도 한 번
  const hid = Object.keys(u.applied || {})[0];
  await A.evalJs(`unitsStrike('p2', '10,2,25', gameNow(), '${hid}'); 1`);
  await sleep(800);
  u = await DBQ(`${G}/units/${uid}`);
  check('같은 피해 id를 다시 불러도 한 번 (175 그대로)', u?.hp === 175, String(u?.hp));
  // 범위 밖이면 안 맞는다 — 멀리 떨어진 칸
  await B.evalJs(`unitsStrike('p2', '3,6,55', gameNow(), 'far1'); 1`);
  await sleep(700);
  check('범위 밖 칸 — 안 맞는다', (await DBQ(`${G}/units/${uid}/hp`)) === 175);

  // ════ 영혼은 10까지만 ════
  const cap = await A.evalJs(`unitSoulsAt({ owner: 'p1', kind: 'reaper', speed: 1500, leg: { c: 9, r: 4, t: 0, target: 'king', n: 0, souls: 9 } }, 1e9)`);
  check('영혼은 최대 10', cap === 10, String(cap));
  check('낫 간격 4초', await A.evalJs(`REAPER.swingMs`) === 4000);

  // ════ 걷는 중에도 맞는다 — 칸 사이(9.5열)에 있는 리퍼가 9열 공격에 맞는다 ════
  const mv = await A.evalJs(`(() => { const now = gameNow(); const id = 'rmove1';
    return db.ref('${G}/units/' + id).set({ owner: 'p1', kind: 'reaper', hp: 300, maxHp: 300, speed: 1500, born: now - 5000,
      leg: { c: 7, r: 4, t: now - 3000, target: 'king', n: 0, souls: 0 } }).then(() => id); })()`);
  await waitFor(A, `!!_uGs.units['${mv}']`, 3000);
  const mvAt = await A.evalJs(`_uGs.units['${mv}'].leg.t + 3750`);     // 7열에서 3.75초 → 9.5열
  const mvPos = await A.json(`JSON.stringify(unitPosAt(_uGs.units['${mv}'], ${mvAt}))`);
  await B.evalJs(`unitsStrike('p2', '8,4,40', ${mvAt}, 'mvfar').then(() => unitsStrike('p2', '9,4,30', ${mvAt}, 'mvnear')).then(() => 1)`);
  await sleep(700);
  check('걷는 중(9.5열) — 걸친 칸(9열) 공격에 맞고, 먼 칸(8열)은 안 맞는다', (await DBQ(`${G}/units/${mv}/hp`)) === 270,
        `자리 ${mvPos.c} · 체력 ${await DBQ(`${G}/units/${mv}/hp`)}`);
  await B.evalJs(`unitsStrike('p2', '10,4,999;9,4,999;11,4,999', gameNow(), 'mvkill').then(() => 1)`);
  await sleep(600);

  // ════ 쓰러지면 영혼 수만큼 유령 ════
  const soulsNow = await A.evalJs(`unitSoulsAt(_uGs.units['${uid}'], gameNow())`);
  await B.evalJs(`unitsStrike('p2', '10,2,999', gameNow(), 'kill1'); 1`);
  await waitFor(A, `(() => { const u = _uGs.units['${uid}']; return u && u.diedAt != null && u.spawned; })()`, 6000);
  const tot0 = (await hp('p2', 'left')) + (await hp('p2', 'king')) + (await hp('p2', 'right'));
  u = await DBQ(`${G}/units/${uid}`);
  const kids = (await units()).filter(([id, x]) => x.parent === uid);
  check('쓰러짐 — 쌓인 영혼 수만큼 유령', kids.length === Math.min(10, u.soulsAtDeath) && u.soulsAtDeath >= soulsNow - 1 && kids.length > 0,
        `영혼 ${u.soulsAtDeath} · 유령 ${kids.length}`);
  const towerTiles = ['4,2', '3,4', '4,6', '11,2', '12,4', '11,6'];
  check('유령 — 체력 60, 타워 칸이 아닌 상대 진영 주변, 다시 갈라지지 않음', kids.every(([, k]) =>
    k.kind === 'ghost' && k.hp === 60 && !towerTiles.includes(`${k.leg.c},${k.leg.r}`) && k.leg.c >= 9 && k.split === true),
    JSON.stringify(kids.map(([, k]) => [k.kind, k.hp, k.leg.c, k.leg.r, k.leg.target])));
  await waitFor(B, `document.querySelectorAll('.unit-hud.unit-ghost').length >= 1`, 3000)
    .then(() => check('B 화면에 유령', true)).catch(() => check('B 화면에 유령', false));
  // 유령 하나는 날아가는 중에 쓰러뜨린다 — 다시 갈라지지 않고, 타워에도 닿지 않는다
  let killed = 0;
  if (kids.length > 1) {
    // 가장 멀리 날아가는 유령 — 닿기 전에 맞힐 수 있게 (타워 바로 옆에서 솟은 유령은 금방 닿는다)
    const kid = await A.evalJs(`Object.entries(_uGs.units).filter(([, x]) => x.kind === 'ghost' && x.parent === '${uid}')
      .sort((a, b) => unitLeg(b[1]).arriveAt - unitLeg(a[1]).arriveAt)[0][0]`);
    await B.evalJs(`(() => { const u = _uGs.units['${kid}']; const at = Math.max(gameNow(), u.leg.t + 50); const p = unitPosAt(u, at);
      return unitsStrike('p2', Math.round(p.c) + ',' + Math.round(p.r) + ',999', at, 'kill2').then(() => 1); })()`);
    await sleep(600);
    const kd = await DBQ(`${G}/units/${kid}`);
    killed = kd?.diedAt != null ? 1 : 0;
    const after = (await units()).filter(([, x]) => x.parent === kid);
    check('유령은 쓰러져도 다시 갈라지지 않는다', killed === 1 && after.length === 0, `${JSON.stringify(kd && { hp: kd.hp, diedAt: kd.diedAt })} · ${after.length}`);
  }
  await sleep(1200);
  await A.shot('shot_reaper_split_A.png');
  // 모두 닿을 때까지 — 닿으면 10씩 (맞는 쪽 확인 1.5초 포함)
  const lastArrive = await A.evalJs(`Math.max(...Object.values(_uGs.units).filter(x => x.kind === 'ghost' && x.diedAt == null).map(x => unitLeg(x).arriveAt), 0) - gameNow()`);
  await sleep(Math.max(0, lastArrive) + 2500);
  const tot1 = (await hp('p2', 'left')) + (await hp('p2', 'king')) + (await hp('p2', 'right'));
  const live = kids.length - killed;
  check('유령이 타워에 닿으면 하나에 10 — 정확히 한 번', tot0 - tot1 === 10 * live, `${tot0} → ${tot1} (유령 ${live})`);
  await sleep(1500);
  const left = await B.evalJs(`document.querySelectorAll('.unit-hud.unit-ghost').length`);
  check('닿은 유령은 서서히 사라진다', left === 0, String(left));

  // ════ 목표 타워가 무너지면 킹으로 ════
  // 윗줄 옆 타워를 향해 걷는 리퍼를 하나 두고, 그 타워를 무너뜨린다
  const sid = await A.evalJs(`(() => { const now = gameNow();
    return db.ref('${G}/units/rside1').set({ owner: 'p1', kind: 'reaper', hp: 300, maxHp: 300, speed: 1500, born: now - 1000,
      leg: { c: 6, r: 2, t: now, target: 'left', n: 0, souls: 0 } }).then(() => 'rside1'); })()`);
  await waitFor(A, `!!_uGs.units['${sid}']`, 3000);
  await DBW(`${G}/p2/towers/left`, 'PATCH', { hp: 0, alive: false });
  await waitFor(A, `_uGs.units['${sid}'] && _uGs.units['${sid}'].leg.target === 'king' && _uGs.units['${sid}'].leg.n === 1`, 4000)
    .then(() => check('목표가 무너지자 킹으로 방향 전환', true))
    .catch(async () => check('목표가 무너지자 킹으로 방향 전환', false, JSON.stringify((await DBQ(`${G}/units/${sid}`))?.leg)));

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
