// 2026-10-01 — 토템 지속 시간 게이지 · 가시(2×2, 45 + 7×4) · 톱 (2026-10-03: 가장 가까운 대상 · 클릭 즉시) · 가시·톱 토템 상성
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9631), B = await launch('B', 9632);
const all = [A, B];
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
const space = (b, type) => b.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const hp = (who, pos) => DBQ(`${G}/${who}/towers/${pos}/hp`);

  // ── 토템 지속 시간 게이지 ──
  await DBW_hp();
  async function DBW_hp() {}
  await pickCard(A, 'forest_spirit');
  const tt = await tile(A, 2, 4);
  await mouse(A, 'mouseMoved', tt.x, tt.y); await sleep(150);
  await click(A, tt.x, tt.y);
  await sleep(500);
  const g = b => b.json(`JSON.stringify((() => { const e = document.querySelector('.totem-cd'); if (!e) return null;
    return { t: e.textContent, p: +e.style.getPropertyValue('--p'), y: parseFloat(e.style.top) }; })())`);
  const g1 = await g(A), g1b = await g(B);
  await sleep(1200);
  const g2 = await g(A);
  check('숲의정령 — 토템 위 원형 게이지 5s → 4s, 링이 줄어든다', g1?.t === '5s' && g2?.t === '4s' && g2.p < g1.p, JSON.stringify([g1, g2]));
  check('상대 화면에도 같은 게이지', g1b?.t === '5s' || g1b?.t === '4s', JSON.stringify(g1b));
  const green = await A.evalJs(`getComputedStyle(document.querySelector('.totem-cd-track')).backgroundImage.includes('79, 220, 124')`);
  check('게이지는 초록', green === true);
  await shot(A, 'ts_totem.png');
  await sleep(4000);
  check('끝나면 게이지가 사라진다', await A.evalJs(`!document.querySelector('.totem-cd')`) === true);

  // ── 가시 ──
  await A.evalJs(`castResetCooldown(); 1`);
  await pickCard(A, 'thorn');
  const kp = await groundToClient(A, 1260, 460);          // 킹(12,4) 칸 오른쪽 아래 — 가장 가까운 꼭짓점 (13,5)
  await mouse(A, 'mouseMoved', kp.x, kp.y); await sleep(200);
  const aim = await A.json(`JSON.stringify({ l: parseInt(_castArc.style.left), t: parseInt(_castArc.style.top), w: parseInt(_castArc.style.width), h: parseInt(_castArc.style.height),
    hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id) })`);
  check('가시 조준 — 2×2칸 (12~13열 · 4~5행), 킹 강조', aim.l === 1200 && aim.t === 400 && aim.w === 200 && aim.h === 200 && aim.hl.join() === 'tower-enemy-king', JSON.stringify(aim));
  const k0 = await hp('p2', 'king');
  await click(A, kp.x, kp.y);
  const t0 = Date.now();
  await sleep(700);
  const k1 = await hp('p2', 'king');
  const sp = b => b.json(`JSON.stringify({ n: _t3dSpikes.length, vis: _t3dSpikes[0] ? _t3dSpikes[0].spikes.filter(s => s.m.visible).length : 0 })`);
  const spA = await sp(A), spB = await sp(B);
  check('가시가 튀어나오는 순간 45', k0 - k1 === 45, `${k0} → ${k1}`);
  check('두 화면 모두 3D 가시가 솟는다', spA.n === 1 && spA.vis > 20 && spB.n === 1 && spB.vis > 20, JSON.stringify([spA, spB]));
  const area = await B.json(`JSON.stringify((() => { const e = document.querySelector('.thorn-ground'); return e && [parseInt(e.style.left), parseInt(e.style.top)]; })())`);
  check('맞는 쪽 화면 — 같은 범위가 좌우 뒤집혀 (2~3열)', area && area[0] === 200 && area[1] === 400, JSON.stringify(area));
  await shot(A, 'ts_thorn.png');
  await shot(B, 'ts_thorn_B.png');
  await sleep(Math.max(0, 3000 - (Date.now() - t0)));
  const k2 = await hp('p2', 'king');
  check('박힌 채로 0.5초마다 7 × 4 (총 73)', k0 - k2 === 73, `${k0} → ${k2}`);
  await sleep(800);
  check('가시가 땅속으로 꺼져 사라진다', await A.evalJs(`_t3dSpikes.length`) === 0);

  // ── 톱 (2026-10-03) — 가장 가까운 대상 강조 · 클릭하면 바로 · 커서 쪽에서 비스듬히 · 끝까지 저절로 (6초, 12번 = 84) ──
  await A.evalJs(`castResetCooldown(); 1`);
  await pickCard(A, 'thorn_evo');
  const far = await groundToClient(A, 300, 450);           // 내 진영 깊숙이 — 닿는 대상이 없다
  await mouse(A, 'mouseMoved', far.x, far.y); await sleep(200);
  check('닿는 대상이 없으면 강조 · 선이 없다', await A.evalJs(`!_castArc.classList.contains('cast-arc-ready') && !document.querySelector('.tower.drag-over')`) === true);
  const sp0 = await groundToClient(A, 950, 300);           // 윗줄 옆 타워(11,2)가 가장 가깝다 — 커서보다 조금 위
  await mouse(A, 'mouseMoved', sp0.x, sp0.y); await sleep(200);
  const aimS = await A.json(`JSON.stringify({ hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id), ready: _castArc.classList.contains('cast-arc-ready'),
    line: parseFloat(_castArc.querySelector('.cast-saw-line').style.width), mark: _castArc.querySelector('.cast-saw-mark').style.display,
    hud: !!document.querySelector('.cast-shot-hud, .saw-hud, .saw-press') })`);
  check('톱 조준 — 가장 가까운 옆 타워 하나 강조 · 커서에서 선 · 발밑 네모 · 게이지/안내 없음',
        aimS.hl.join() === 'tower-enemy-left' && aimS.ready && aimS.line > 100 && aimS.mark === 'block' && !aimS.hud, JSON.stringify(aimS));
  await shot(A, 'ts_saw_aim.png');
  const l0 = await hp('p2', 'left');
  await click(A, sp0.x, sp0.y);
  const s0 = Date.now();
  await sleep(500);
  const sawA = await A.json(`JSON.stringify({ n: _t3dSaws.length, ux: _t3dSaws[0]?.o.ux, uy: _t3dSaws[0]?.o.uy, held: boardIsHoldingCard(), hud: !!document.querySelector('.saw-hud') })`);
  const sawB = await B.json(`JSON.stringify({ n: _t3dSaws.length, ux: _t3dSaws[0]?.o.ux, uy: _t3dSaws[0]?.o.uy })`);
  check('클릭하자마자 톱이 나와 썬다 (두 화면) · 카드가 쓰였다 · 게이지 없음', sawA.n === 1 && sawB.n === 1 && !sawA.held && !sawA.hud, JSON.stringify([sawA, sawB]));
  check('커서 쪽(조금 아래)에서 비스듬히 위로 다가간다 — 상대 화면은 좌우 거울',
        sawA.ux > 0.9 && sawA.uy < -0.15 && sawA.uy > -0.4 && Math.abs(sawB.ux + sawA.ux) < 0.01 && Math.abs(sawB.uy - sawA.uy) < 0.01, JSON.stringify([sawA, sawB]));
  await shot(A, 'ts_saw_A.png');
  await shot(B, 'ts_saw_B.png');
  await sleep(Math.max(0, 3000 - (Date.now() - s0)));
  const lMid = await hp('p2', 'left');
  check('계속 썬다', l0 - lMid >= 35, `${l0} → ${lMid}`);
  check('맵이 끌려가지 않았다', await A.evalJs(`!document.getElementById('map-viewport').classList.contains('panning')`) === true);
  await sleep(Math.max(0, 6000 + 900 - (Date.now() - s0)));
  const l1 = await hp('p2', 'left');
  check('끝까지 저절로 — 0.5초마다 7 × 12 = 84', l0 - l1 === 84, `${l0} → ${l1}`);
  await sleep(1300);
  check('다 썰면 톱이 빠진다 (상대 화면도)', await A.evalJs(`_t3dSaws.length === 0 && !!!_sawHold`) === true && await B.evalJs(`_t3dSaws.length`) === 0);
  await sleep(1200);
  check('끝난 뒤로는 더 들어가지 않는다', (await hp('p2', 'left')) === l1);

  // ── 톱 상성 — 상대 토템을 겨누면 반토막 내 쓰러뜨린다 (회복 멈춤 · 톱은 거기서 끝) ──
  const totemDots = async () => Object.values(await DBQ(`rooms/${code}/gameState/dots`) || {}).filter(d => d.totem).length;
  await pickCard(B, 'forest_spirit');
  const bt = await tile(B, 2, 4);                           // A 화면 13열 · 4행
  await mouse(B, 'mouseMoved', bt.x, bt.y); await sleep(150);
  await click(B, bt.x, bt.y);
  await sleep(1000);
  check('B 토템 섰다', await A.evalJs(`totemOnTile(13, 4)`) === true && await totemDots() > 0);
  await A.evalJs(`castResetCooldown(); 1`);
  await pickCard(A, 'thorn_evo');
  const tp = await groundToClient(A, 1360, 560);            // 토템이 킹 · 옆 타워보다 가깝다
  await mouse(A, 'mouseMoved', tp.x, tp.y); await sleep(200);
  const aimT = await A.json(`JSON.stringify({ totem: _castArc.querySelector('.cast-saw-mark').classList.contains('cast-saw-mark-totem'),
    hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id) })`);
  check('토템이 가장 가까우면 토템을 겨눈다 (타워 강조 없음)', aimT.totem && aimT.hl.length === 0, JSON.stringify(aimT));
  const dmgT0 = ['left', 'king', 'right'].map(async p => (await DBQ(`rooms/${code}/gameState/p2/towers/${p}/dmgTaken`)) || 0);
  const kingT0 = (await Promise.all(dmgT0)).join();
  await click(A, tp.x, tp.y);
  await sleep(700);
  check('토템 앞에서 썬다 (두 화면)', await A.evalJs(`_t3dSaws.length === 1 && _t3dSaws[0].o.totem`) === true && await B.evalJs(`_t3dSaws.length === 1 && _t3dSaws[0].o.totem`) === true);
  await shot(A, 'ts_saw_totem.png');
  await sleep(900);
  check('반토막 나 쓰러졌다 (두 화면)', await A.evalJs(`!totemOnTile(13, 4)`) === true && await B.evalJs(`!totemOnTile(2, 4)`) === true);
  check('토템 회복이 멈췄다', await totemDots() === 0);
  await shot(A, 'ts_saw_totem_cut.png');
  await sleep(600);
  check('톱은 거기서 끝 (두 화면)', await A.evalJs(`_t3dSaws.length === 0 && !_sawHold`) === true && await B.evalJs(`_t3dSaws.length`) === 0);
  const kingT1 = (await Promise.all(['left', 'king', 'right'].map(async p => (await DBQ(`rooms/${code}/gameState/p2/towers/${p}/dmgTaken`)) || 0))).join();
  check('토템을 썬 톱은 타워를 치지 않는다 (받은 피해 그대로)', kingT1 === kingT0, `${kingT0} → ${kingT1}`);
  await sleep(1500);

  // ── 가시 상성 — 범위 안 상대 토템이 산산조각 · 박혀 있는 동안 그 자리 토템도 ──
  await pickCard(B, 'cherry_blossom_evo');
  const bt2 = await tile(B, 2, 3);                          // A 화면 13열 · 3행
  await mouse(B, 'mouseMoved', bt2.x, bt2.y); await sleep(150);
  await click(B, bt2.x, bt2.y);
  await sleep(1000);
  check('B 흰꽃 토템 섰다', await A.evalJs(`totemOnTile(13, 3)`) === true);
  await A.evalJs(`castResetCooldown(); 1`);
  await pickCard(A, 'thorn');
  const tc = await groundToClient(A, 1400, 400);             // 13~14열 · 3~4행
  await mouse(A, 'mouseMoved', tc.x, tc.y); await sleep(150);
  await click(A, tc.x, tc.y);
  await sleep(450);
  const shards = await A.evalJs(`_t3dTotemGone.length`);
  await sleep(300);
  check('가시에 토템이 산산조각 (두 화면)', shards >= 1 && await A.evalJs(`!totemOnTile(13, 3)`) === true && await B.evalJs(`!totemOnTile(2, 3)`) === true, `gone=${shards}`);
  check('가시가 박혀 있는 동안 그 자리는 토템이 부서진다', await B.evalJs(`(totemBreakZoneAt(2, 3) || {}).how`) === 'shatter');
  await shot(A, 'ts_thorn_totem.png');

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
