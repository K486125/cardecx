// 2026-10-03 계획 4 — 1단계(얼음 연장 · 파도 특성 삭제 · 내 붕괴는 내 토템을 안 부숨) · 2단계(토템이 쓰러진다)
import { writeFileSync } from 'node:fs';
import { launch, sleep, waitFor, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9681), B = await launch('B', 9682);
const all = [A, B];
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
const fill = b => b.evalJs(`_currentEnergy = 100; _renderEnergy(100); 1`);
const use = async (b, id, pt) => { await fill(b); await pickCard(b, id); await mouse(b, 'mouseMoved', pt.x, pt.y); await sleep(160); await click(b, pt.x, pt.y); };
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const T = (who, pos) => DBQ(`${G}/${who}/towers/${pos}`);

  // ── 1단계: 얼음전개 — 이미 언 타워에 또 쓰면 시간만 는다 ──
  await use(A, 'ice_deploy', await groundToClient(A, 1200, 400));    // 킹 · 왼쪽
  await sleep(2400);
  const k1 = await T('p2', 'king');
  const lv1 = await A.evalJs(`(_t3dIces.find(x => x.el.id === 'tower-enemy-king') || {}).level`);
  check('처음 얼음 — 꼭대기까지 찼다', k1.frozenUntil > 0 && lv1 > 0.95, JSON.stringify({ k1, lv1 }));
  await A.evalJs(`castResetCooldown(); 1`);
  await use(A, 'ice_deploy', await groundToClient(A, 1200, 400));
  await sleep(1300);
  const k2 = await T('p2', 'king');
  check('다시 써도 얼기 시작한 시각은 그대로 (다시 차오르지 않는다)', k2.frozenFrom === k1.frozenFrom, `${k1.frozenFrom} / ${k2.frozenFrom}`);
  check('남은 시간에 10초가 더해졌다', k2.frozenUntil === k1.frozenUntil + 10000, `${k1.frozenUntil} → ${k2.frozenUntil}`);
  const lv2 = await A.json(`JSON.stringify(_t3dIces.map(x => [x.el.id, +x.level.toFixed(2), x.mode]))`);
  check('3D 얼음도 다시 자라지 않고 꽉 찬 채 (두 개)', lv2.length === 2 && lv2.every(([, l, m]) => l > 0.95 && m === 'grow'), JSON.stringify(lv2));
  const endLeft = await B.evalJs(`Math.round(((_t3dIces.find(x => x.el.id === 'tower-my-king') || {}).end - performance.now()) / 1000)`);
  check('B 화면의 3D 얼음도 늘어난 시간만큼 남았다 (≈ 17초)', endLeft >= 15 && endLeft <= 19, String(endLeft));
  const fz = await DBQ(`${G}/p2/deckFreezeUntil`);
  check('덱 동결도 늘어난 얼음까지', fz >= k2.frozenUntil, `${fz} vs ${k2.frozenUntil}`);
  await shot(A, 'p4_ice_extend.png');

  // ── 1단계: 파도 특성 삭제 ──
  await A.evalJs(`castResetCooldown(); 1`);
  await use(A, 'wave_evo', await tile(A, 9, 4));
  await sleep(1500);
  const mine = await DBQ(`${G}/p1`);
  check('파도를 써도 불 피해 면역이 걸리지 않는다', !mine.waveEvoActiveUntil && ['left', 'king', 'right'].every(p => !mine.towers[p].fireImmunityUntil));
  check('파도 설명에 특성 문구가 없다', await A.evalJs(`!/특성/.test(CARD_DEFINITIONS.wave_evo.desc) && !/특성/.test(t('card_wave_evo_desc'))`) === true);

  // ── 1단계: 내 붕괴는 내 토템을 부수지 않는다 ──
  await use(A, 'forest_spirit', await tile(A, 7, 4));
  await sleep(1200);
  check('A 토템 섰다', await A.evalJs(`totemOnTile(7, 4)`) === true);
  await A.evalJs(`castResetCooldown(); 1`);
  await use(A, 'collapse', await tile(A, 7, 4));
  await sleep(1500);
  const casted = await A.evalJs(`_t3dTotems.length`);
  check('내 붕괴가 지나가도 내 토템은 그대로 (두 화면)', await A.evalJs(`totemOnTile(7, 4)`) === true && await B.evalJs(`totemOnTile(8, 4)`) === true, `3d=${casted}`);
  check('내 진영 칸은 토템 잠금이 걸리지 않는다', await A.evalJs(`!totemBreakZoneAt(7, 4)`) === true);
  await sleep(4500);

  // ── 2단계: 토네이도 — 상대 토템이 쓰러진다 (날아가지 않는다) ──
  await waitFor(B, `!deckFrozenFor(null)`, 30000);                   // 늘어난 얼음 동안 B는 카드를 못 쓴다
  await use(B, 'forest_spirit', await tile(B, 2, 4));                 // A 화면 13열
  await sleep(1200);
  await A.evalJs(`castResetCooldown(); 1`);
  await use(A, 'tornado', await tile(A, 5, 4));
  const samp = [];
  for (let i = 0; i < 22; i++) {
    await sleep(150);
    const s = await A.json(`JSON.stringify((() => { const x = _t3dTotemGone[0]; if (!x) return null;
      const g = x.group; const up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
      return { y: +g.position.y.toFixed(1), tilt: +Math.acos(Math.max(-1, Math.min(1, up.y))).toFixed(2), op: +(x.mats[0]?.opacity ?? 1).toFixed(2) }; })())`);
    if (s) samp.push(s);
    if (samp.length === 6) await shot(A, 'p4_topple_mid.png');
  }
  check('토템이 쓰러지는 연출이 돌았다', samp.length >= 4, JSON.stringify(samp));
  check('밑동은 땅에 붙어 있다 (날아오르지 않는다)', samp.every(s => s.y === 0), JSON.stringify(samp.map(s => s.y)));
  const maxTilt = Math.max(...samp.map(s => s.tilt));
  check('옆으로 거의 누울 만큼 넘어간다 (80° 이상)', maxTilt > 1.4 && maxTilt < 1.65, String(maxTilt));
  check('처음엔 조금만 기운다 (휘청임)', samp[0].tilt < 0.4, String(samp[0].tilt));
  check('토템과 회복이 사라졌다 (두 화면)', await A.evalJs(`!totemOnTile(13, 4)`) && await B.evalJs(`!totemOnTile(2, 4)`));

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
