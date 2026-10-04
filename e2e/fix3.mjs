// 2026-10-04 — ① AI의 토템 상성 ② 유닛에 붙는 불(화상) · 물로 끄기 ③ 늦게 들어온 화면의 녹은 얼음물
import { writeFileSync } from 'node:fs';
import { launch, sleep, waitFor, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile, groundToClient } from './lib.mjs';

await resetDB();
const A = await launch('A', 9681), B = await launch('B', 9682);
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
const fill = b => b.evalJs(`_currentEnergy = 100; _renderEnergy(100); 1`);
const use = async (b, id, pt) => { await fill(b); await b.evalJs(`castResetCooldown(); 1`); await pickCard(b, id); await mouse(b, 'mouseMoved', pt.x, pt.y); await sleep(200); await click(b, pt.x, pt.y); };
let all = [A, B];
try {
  // ════ ② 유닛 화상 — 두 사람 대전 ════
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const spawn = (id, c, r) => A.evalJs(`(() => { const now = gameNow();
    return db.ref('${G}/units/${id}').set({ owner: 'p2', kind: 'reaper', hp: 400, maxHp: 400, speed: 6000, born: now - 1000,
      leg: { c: ${c}, r: ${r}, t: now, target: 'left', n: 0, souls: 0 } }).then(() => 1); })()`);
  const U = id => DBQ(`${G}/units/${id}`);

  // 폭염 — 맞은 유닛에 불이 붙고, 0.5초마다 9 × 5가 따라다니며 들어간다
  await spawn('u1', 9, 1);
  await waitFor(A, `!!_uGs?.units?.u1`, 5000);
  await use(A, 'fire_evo', await tile(A, 9, 4));                    // 8~10열 · 1~7행
  await sleep(1100);
  const u1a = await U('u1');
  check('폭염에 맞은 유닛에 불이 붙었다 (화상)', u1a.burnFrom > 0 && u1a.burnN === 5 && u1a.burnDmg === 9 && u1a.burnOut == null, JSON.stringify(u1a));
  check('두 화면 모두 화상 표시', await A.evalJs(`!!document.querySelector('.unit-hud.unit-burning')`) === true && await B.evalJs(`!!document.querySelector('.unit-hud.unit-burning')`) === true);
  await shot(A, 'fix3_burn.png');
  await sleep(2800);
  const u1b = await U('u1');
  const burnHits = Object.keys(u1b.applied || {}).filter(k => k.startsWith('burn')).length;
  check('불이 다 타며 0.5초마다 들어갔다 (5번)', burnHits === 5, JSON.stringify(u1b.applied));
  check('폭발 49 + 화상 9 × 5 이상 깎였다', 400 - u1b.hp >= 49 + 45, `400 → ${u1b.hp}`);
  await sleep(1000);

  // 불덩이 — 불이 붙은 뒤 물(침수)에 닿으면 꺼진다
  await spawn('u2', 9, 6);
  await waitFor(A, `!!_uGs?.units?.u2`, 5000);
  await use(A, 'flame', await groundToClient(A, 1000, 700));         // 9~10열 · 6~7행
  await sleep(1300);
  const u2a = await U('u2');
  check('불덩이에 맞은 유닛도 불이 붙는다', u2a.burnFrom > 0 && u2a.burnDmg === 6, JSON.stringify(u2a));
  await use(B, 'wave', await tile(B, 6, 4));                         // B 화면 5~8열 → A 화면 7~10열 · 0~9행
  await sleep(1800);
  const u2b = await U('u2');
  check('물에 닿자 불이 꺼졌다 (burnOut)', u2b.burnOut > 0, JSON.stringify(u2b));
  const ticksB = Object.keys(u2b.applied || {}).filter(k => k.startsWith('burn')).length;
  await sleep(2000);
  const u2c = await U('u2');
  const ticksC = Object.keys(u2c.applied || {}).filter(k => k.startsWith('burn')).length;
  check('꺼진 뒤로는 화상이 더 들어가지 않는다 (5번 미만)', ticksC === ticksB && ticksC < 5, `${ticksB} → ${ticksC}`);
  check('화상 표시가 사라졌다', await A.evalJs(`!document.querySelector('.unit-hud.unit-burning')`) === true);

  // ════ ③ 녹은 얼음물 — 늦게 들어온 화면도 웅덩이를 본다 ════
  const pool = await A.json(`JSON.stringify((() => {
    const el = document.getElementById('tower-enemy-right');
    const now = gameNow();
    document.querySelectorAll('.ice-pool').forEach(e => e.remove());
    _iceSync(el, 'enemy', 'right', { frozenMelt: 2, frozenFrom: now - 5000, frozenUntil: now - 800 }, now);
    const n1 = document.querySelectorAll('.ice-pool').length;
    _iceSync(el, 'enemy', 'right', { frozenMelt: 2, frozenFrom: now - 5000, frozenUntil: now - 800 }, now + 100);
    const n2 = document.querySelectorAll('.ice-pool').length;
    _iceSync(document.getElementById('tower-enemy-left'), 'enemy', 'left', { frozenMelt: 2, frozenFrom: now - 9000, frozenUntil: now - 4000 }, now);
    const n3 = document.querySelectorAll('.ice-pool').length;
    return { n1, n2, n3 };
  })())`);
  check('녹은 지 0.8초 — 처음 보는 화면에도 물웅덩이 (한 번만)', pool.n1 === 1 && pool.n2 === 1, JSON.stringify(pool));
  check('다 마른 뒤(4초)면 그리지 않는다', pool.n3 === 1, JSON.stringify(pool));

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
  all.forEach(b => b.proc.kill());

  // ════ ① AI 토템 상성 — AI 대전 ════
  await resetDB();
  const H = await launch('H', 9683, { fitZoom: true });
  all = [H];
  await H.goto('/index.html');
  await waitFor(H, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await H.evalJs(`document.getElementById('input-nickname').value='Hana#Dev'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(H, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await sleep(500);
  await H.evalJs(`document.getElementById('btn-vs-ai').click(); 1`);
  await waitFor(H, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`, 20000);
  await sleep(500);
  await H.evalJs(`document.getElementById('btn-ready').click(); 1`);
  await waitFor(H, `!document.getElementById('screen-game').classList.contains('hidden') && window.matchInputLocked === false && !!_bot`, 30000);
  await sleep(800);
  await H.evalJs(`window._bca = botChooseAction; botChooseAction = () => null; 1`);   // 저절로 쓰지 않게 — 시험에서 직접 부른다
  const plant = async (col, row) => {
    await use(H, 'forest_spirit', await tile(H, col, row));
    await sleep(900);
    return await H.evalJs(`totemOnTile(${col}, ${row})`);
  };
  const giveBot = id => H.evalJs(`_bot.deck = [{ card: { ...CARD_DEFINITIONS.${id} }, count: 1 }, null, null, null, null]; _bot.energy = 100; _bot.busy = {}; 1`);
  const botAct = () => H.json(`JSON.stringify((() => { const v = _botView(); const a = _bca(v); if (a) _botUseCard(a, v);
    return a ? { card: a.card.id, totem: a.totem ? a.totem.col + ',' + a.totem.row : null, pos: a.pos } : null; })())`);
  const myDmg = async () => H.evalJs(`['left','king','right'].map(p => getGameState()[_boardPlayerKey].towers[p].dmgTaken || 0).join()`);

  check('내 토템 섰다 (5열 4행)', await plant(5, 4) === true);
  await giveBot('dual_sword');
  const d0 = await myDmg();
  const a1 = await botAct();
  check('AI 듀얼 검이 토템을 노린다', a1?.totem === '5,4', JSON.stringify(a1));
  await sleep(1100);
  check('AI가 토템을 베어 없앴다 · 회복 멈춤', await H.evalJs(`!totemOnTile(5, 4) && !Object.values(getGameState().dots || {}).some(d => d.totem)`) === true);
  check('토템을 벤 AI 듀얼 검은 타워를 치지 않는다', (await myDmg()) === d0);
  await sleep(1500);

  check('내 토템 다시 섰다', await plant(5, 4) === true);
  await giveBot('wind');
  const a2 = await botAct();
  await sleep(500);
  check('AI 바람이 토템을 쳐 남은 시간 -2초', a2?.totem === '5,4' && await H.evalJs(`_totemLife['5,4'].cut`) === 2000, JSON.stringify(a2));
  await sleep(4000);

  check('내 토템 다시 섰다 (톱)', await plant(5, 4) === true);
  await giveBot('thorn_evo');
  const a3 = await botAct();
  await sleep(1700);
  check('AI 톱이 토템을 반토막 냈다', a3?.totem === '5,4' && await H.evalJs(`!totemOnTile(5, 4)`) === true, JSON.stringify(a3));
  await sleep(1500);

  // 범위 카드 — 범위에 든 토템만큼 값이 오른다 (지진: 킹 칸 3×3에 든 토템)
  check('내 토템 섰다 (2열 4행 — 킹 옆)', await plant(2, 4) === true);
  const bonus = await H.json(`JSON.stringify((() => { const v = _botView(); const ts = botEnemyTotems(v);
    return { n: ts.length, quake: _botAreaTotemBonus(CARD_DEFINITIONS.earthquake, 'king', ts), far: _botAreaTotemBonus(CARD_DEFINITIONS.earthquake, 'right', ts),
             thorn: _botAreaTotemBonus(CARD_DEFINITIONS.thorn, 'king', ts) }; })())`);
  check('지진 · 가시가 토템을 덮으면 값이 오른다 (멀면 0)', bonus.n === 1 && bonus.quake > 0 && bonus.far === 0, JSON.stringify(bonus));

  // AI 톱 — 위 타워는 가운데 줄 쪽(아래)에서 비스듬히
  await sleep(4500);
  await giveBot('thorn_evo');
  await H.evalJs(`_botUseCard({ slot: 0, ownSide: false, pos: 'left', card: { ...CARD_DEFINITIONS.thorn_evo } }, _botView()); 1`);
  await sleep(500);
  const sawDir = await H.json(`JSON.stringify(_t3dSaws.map(s => ({ ux: +s.o.ux.toFixed(2), uy: +s.o.uy.toFixed(2) })))`);
  check('AI 톱 — 위 타워는 아래쪽에서 비스듬히 위로', sawDir.length === 1 && sawDir[0].uy < -0.1, JSON.stringify(sawDir));

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
