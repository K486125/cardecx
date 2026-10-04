// 2026-10-04 — 상성 상태 DB 기록 (gameState/fields): 중간에 들어온 관전자가 토템 · 물 · 불을 되살린다
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9691), B = await launch('B', 9692), C = await launch('C', 9693);
const all = [A, B, C];
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
const fill = b => b.evalJs(`_currentEnergy = 100; _renderEnergy(100); 1`);
const use = async (b, id, pt) => { await fill(b); await b.evalJs(`castResetCooldown(); 1`); await pickCard(b, id); await mouse(b, 'mouseMoved', pt.x, pt.y); await sleep(200); await click(b, pt.x, pt.y); };
// 관전자가 들어오는 데 몇 초 걸린다 — 그동안 끝나지 않게 시간을 늘린다 (기록에는 늘린 값이 적힌다)
const longer = b => b.evalJs(`CAST_STYLES.forest.endMs = 25000; CAST_STYLES.forest.lifeMs = 24000;
  CAST_STYLES.flood.sinkMs = 20000; CAST_STYLES.heatwave.heatMs = 20000; 1`);
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  await longer(A); await longer(B);

  // 관전자는 로비에서 방 목록이 보일 때까지 미리 와 있는다
  await C.goto('/index.html');
  await waitFor(C, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await C.evalJs(`document.getElementById('input-nickname').value='Carol'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(C, `!!document.querySelector('.room-item[data-code="${code}"] .btn-spectate')`, 15000);

  // ── 관전자가 오기 전에 깔린 것들 ──
  await use(A, 'forest_spirit', await tile(A, 5, 4));                // A 토템 (A 진영 5열 4행)
  await sleep(900);
  await use(A, 'wave', await tile(A, 13, 4));                        // 침수 — B 진영 (B 화면이 적는다)
  await sleep(1600);
  await use(A, 'flame', await groundToClient(A, 1300, 300));         // 물 위에 떨어진 불덩이 — 붙자마자 꺼진다
  await sleep(1200);
  await use(A, 'fire_evo', await tile(A, 9, 4));                      // 폭염 — 8~10열 · 1~7행 (물 밖) 계속 탄다
  await sleep(1800);

  const fields = await DBQ(`${G}/fields`) || {};
  const kinds = Object.values(fields).map(f => f.k + (f.doused ? '(꺼짐)' : '') + ':' + f.v).sort();
  check('DB에 상성 기록 — 토템(A) · 침수(B) · 불 둘(B, 하나는 꺼짐)',
    kinds.join(' ') === 'fire(꺼짐):p2 fire:p2 flood:p2 totem:p1', kinds.join(' '));
  const hits = await DBQ(`${G}/instantHits`) || {};
  check('기록의 키 = 시전 신호의 키', Object.keys(fields).every(k => !hits[k] || hits[k].type.startsWith('cast_')), Object.keys(fields).join());

  // ── 관전 입장 ──
  await C.evalJs(`document.querySelector('.room-item[data-code="${code}"] .btn-spectate').click(); 1`);
  await waitFor(C, `location.pathname.endsWith('game.html') && document.getElementById('screen-game')?.classList.contains('spectator-mode') && !document.getElementById('screen-game').classList.contains('hidden')`, 20000);
  await waitFor(C, `typeof _castSeen !== 'undefined' && _castSeen.size >= 4`, 8000);
  await sleep(600);
  const s = await C.json(`JSON.stringify({
    totem: totemOnTile(5, 4), t3d: _t3dTotems.length, left: totemLeftMs(5, 4), gauge: document.querySelectorAll('.totem-cd').length,
    wet: _tileWet(13, 4, gameNow()), dry: _tileWet(5, 4, gameNow()),
    fire: _firePatches.filter(p => p.card === 'fire_evo' && !p.doused).length,
    flame: _firePatches.filter(p => p.card === 'flame').length,
    pool: document.querySelectorAll('.ice-pool').length })`);
  check('관전자 — A 토템이 서 있다 (3D 하나 · 게이지)', s.totem && s.t3d === 1 && s.gauge === 1 && s.left > 10000, JSON.stringify(s));
  check('관전자 — 침수 칸이 젖어 있다 (토템 칸은 마른 땅)', s.wet && !s.dry, JSON.stringify(s));
  check('관전자 — 폭염 불은 타는 중 · 꺼진 불덩이는 되살리지 않는다', s.fire === 1 && s.flame === 0, JSON.stringify(s));
  check('관전자 — 고인 물이 보인다', s.pool >= 1, JSON.stringify(s));
  const lA = await A.evalJs(`totemLeftMs(5, 4)`);
  // 관전 화면은 서버 시계 보정값을 받기 직전에 되살릴 수 있다 — 1초 안쪽이면 같다고 본다
  check('남은 토템 시간이 A 화면과 같다 (±1.2초)', Math.abs(lA - s.left) < 1200, `${Math.round(lA)} vs ${Math.round(s.left)}`);
  await shot(C, 'fields_spec.png');

  // ── 되살린 토템도 그 뒤 상성을 그대로 받는다 — B 토네이도에 날아간다 ──
  await use(B, 'tornado', await tile(B, 5, 4));                      // B 진영 5열 → 4행 줄
  await sleep(3200);
  check('되살린 토템이 토네이도에 날아갔다 (관전 화면)', await C.evalJs(`!totemOnTile(5, 4)`) === true);
  const f1 = Object.values(await DBQ(`${G}/fields`) || {}).find(f => f.k === 'totem' && f.r0 === 4);
  check('A가 기록에 "없어짐"을 적었다', !!f1?.gone && f1.how === 'blow', JSON.stringify(f1));
  await sleep(1000);

  // ── 관전 중에 세운 토템 — 연출과 기록이 겹쳐 두 번 서지 않는다 ──
  await use(A, 'forest_spirit', await tile(A, 5, 2));
  await sleep(2500);
  check('A 토템 다시 섰다', await A.evalJs(`totemOnTile(5, 2)`) === true);
  check('관전 중 세운 토템은 하나만 (연출 1 + 기록 1 → 하나)', await C.evalJs(`_t3dTotems.length`) === 1 && await C.evalJs(`totemOnTile(5, 2)`) === true);

  // ── 놓친 변화에 맞춘다 — A 화면에서만 토템이 없어지면 B · 관전자도 곧 따른다 ──
  await A.evalJs(`_breakTotemsIn({ c0: 5, c1: 5, r0: 2, r1: 2 }, { how: 'burn' }); 1`);
  await sleep(300);
  check('곧바로는 아직 서 있다 (같은 연출을 기다린다)', await C.evalJs(`totemOnTile(5, 2)`) === true);
  await sleep(1500);
  check('잠시 뒤 관전자 · B 화면도 없어졌다', await C.evalJs(`!totemOnTile(5, 2)`) === true && await B.evalJs(`!totemOnTile(10, 2)`) === true);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
