// 2026-10-03 계획 4 — 5단계: 듀얼 검 · 바람 · 지진의 토템 상성
import { writeFileSync } from 'node:fs';
import { launch, sleep, waitFor, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9681), B = await launch('B', 9682);
const all = [A, B];
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
const fill = b => b.evalJs(`_currentEnergy = 100; _renderEnergy(100); 1`);
const aim = async (b, id, pt) => { await fill(b); await b.evalJs(`castResetCooldown(); 1`); await pickCard(b, id); await mouse(b, 'mouseMoved', pt.x, pt.y); await sleep(200); };
const use = async (b, id, pt) => { await aim(b, id, pt); await click(b, pt.x, pt.y); };
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const totemDots = async () => Object.values(await DBQ(`${G}/dots`) || {}).filter(d => d.totem);
  const dmgTaken = async () => (await Promise.all(['left', 'king', 'right'].map(async p => (await DBQ(`${G}/p2/towers/${p}/dmgTaken`)) || 0))).join();
  const plant = async (col, row) => {                       // B 화면 칸 → A 화면은 15 - col
    await use(B, 'forest_spirit', await tile(B, col, row));
    await sleep(900);
    return await A.evalJs(`totemOnTile(${15 - col}, ${row})`);
  };

  // ── 듀얼 검 — 타워가 더 가까우면 타워, 토템이 더 가까우면 토템을 벤다 ──
  check('B 토템 섰다 (A 화면 13열)', await plant(2, 4) === true);
  await aim(A, 'dual_sword', await groundToClient(A, 1100, 450));
  const a1 = await A.json(`JSON.stringify({ hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id), totem: !!document.querySelector('.totem-aimed') })`);
  check('킹이 더 가까우면 킹을 겨눈다 (토템 표시 없음)', a1.hl.join() === 'tower-enemy-king' && !a1.totem, JSON.stringify(a1));
  const p2 = await groundToClient(A, 1305, 450);           // 킹 발밑을 지나 — 직선이 토템에만 닿는다
  await mouse(A, 'mouseMoved', p2.x, p2.y); await sleep(200);
  const a2 = await A.json(`JSON.stringify({ hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id), totem: !!document.querySelector('.totem-aimed'), ready: _castArc.classList.contains('cast-arc-ready') })`);
  check('토템이 더 가까우면 토템이 금빛으로 강조된다 (타워 강조 없음)', a2.hl.length === 0 && a2.totem && a2.ready, JSON.stringify(a2));
  await shot(A, 'p4c_dual_aim.png');
  const d0 = await dmgTaken();
  await click(A, p2.x, p2.y);
  await sleep(800);
  check('듀얼 검이 토템을 베어 없앴다 (두 화면)', await A.evalJs(`!totemOnTile(13, 4)`) === true && await B.evalJs(`!totemOnTile(2, 4)`) === true);
  check('벤 토템의 회복이 멈췄다', (await totemDots()).length === 0);
  await shot(A, 'p4c_dual_cut.png');
  await sleep(1000);
  check('토템을 벤 듀얼 검은 타워를 치지 않는다', (await dmgTaken()) === d0, `${d0} → ${await dmgTaken()}`);
  await sleep(1500);

  // ── 바람 — 토템의 남은 시간 -2초 · 2초 이하면 무너진다 ──
  check('B 토템 다시 섰다', await plant(2, 4) === true);
  const ticks0 = (await totemDots()).reduce((s, d) => s + d.remainingTicks, 0);
  const left0 = await A.evalJs(`totemLeftMs(13, 4)`);
  const e0 = await DBQ(`${G}/p2/energy`);
  const w0 = await dmgTaken();
  await use(A, 'wind', await groundToClient(A, 1305, 450));
  await sleep(500);
  const left1 = await A.evalJs(`totemLeftMs(13, 4)`), left1B = await B.evalJs(`totemLeftMs(2, 4)`);
  const cutA = await A.evalJs(`_totemLife['13,4'].cut`), cutB = await B.evalJs(`_totemLife['2,4'].cut`);
  check('바람 — 남은 시간이 2초 줄었다 (두 화면)', cutA === 2000 && cutB === 2000 && left0 - left1 > 2000 && Math.abs(left1 - left1B) < 400, JSON.stringify({ left0, left1, left1B, cutA, cutB }));
  check('토템이 서 있다 · -2s 표시', await A.evalJs(`totemOnTile(13, 4)`) === true, '');
  await sleep(400);
  const lost = await A.json(`JSON.stringify(Object.values(_activeIntervals).filter(e => e.dot.totem && e.id !== null).map(e => e.dot.remainingTicks - e.totalTicks))`);
  check('토템 회복 줄마다 틱 2번이 빠졌다', lost.length >= 1 && lost.every(n => n === 2), JSON.stringify(lost));
  check('토템을 친 바람은 타워를 치지 않는다', (await dmgTaken()) === w0);
  check('상대 에너지도 깎지 않는다', (await DBQ(`${G}/p2/energy`)) >= e0 - 0, `${e0} → ${await DBQ(`${G}/p2/energy`)}`);
  await shot(A, 'p4c_wind_cut.png');
  await waitFor(A, `totemLeftMs(13, 4) < 1900`, 5000);
  await use(A, 'wind', await groundToClient(A, 1305, 450));
  await sleep(500);
  check('2초 이하에서 바람 — 토템이 무너졌다 (두 화면)', await A.evalJs(`!totemOnTile(13, 4)`) === true && await B.evalJs(`!totemOnTile(2, 4)`) === true);
  check('회복도 멈췄다', (await totemDots()).length === 0);
  await sleep(1500);

  // ── 지진 — 범위 안 토템 -2초 (공격도 그대로) · 2초 이하면 무너진다 ──
  check('B 토템 섰다 (13열 3행)', await plant(2, 3) === true);
  const q0 = await A.evalJs(`totemLeftMs(13, 3)`);
  const k0 = (await DBQ(`${G}/p2/towers/king/dmgTaken`)) || 0;
  await use(A, 'earthquake', await tile(A, 13, 3));          // 12~14열 · 2~4행 — 킹(12,4) · 토템
  await sleep(1100);
  const q1 = await A.evalJs(`totemLeftMs(13, 3)`), q1B = await B.evalJs(`totemLeftMs(2, 3)`);
  const qa = await A.evalJs(`_totemLife['13,3'].cut`), qb = await B.evalJs(`_totemLife['2,3'].cut`);
  check('지진 — 범위 안 토템 남은 시간 -2초 (두 화면)', qa === 2000 && qb === 2000 && q0 - q1 > 2000 && Math.abs(q1 - q1B) < 400, JSON.stringify({ q0, q1, q1B, qa, qb }));
  await sleep(3600);
  const k1 = (await DBQ(`${G}/p2/towers/king/dmgTaken`)) || 0;
  check('지진 공격은 그대로 들어간다 (킹이 받은 피해 27)', k1 - k0 === 27, `${k0} → ${k1}`);
  check('B 토템 섰다 (13열 3행, 다시)', await A.evalJs(`!totemOnTile(13, 3)`) ? await plant(2, 3) === true : true);
  await waitFor(A, `totemOnTile(13, 3) && totemLeftMs(13, 3) < 1900`, 6000);
  await use(A, 'earthquake', await tile(A, 13, 3));
  await sleep(1100);
  check('2초 이하에서 지진 — 토템이 무너졌다 (두 화면)', await A.evalJs(`!totemOnTile(13, 3)`) === true && await B.evalJs(`!totemOnTile(2, 3)`) === true);
  check('회복도 멈췄다', (await totemDots()).length === 0);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
