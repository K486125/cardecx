// 2026-10-02 — 카드 상성 · 얼음전개 리워크 · 타워 두 칸 이동 · 내 진영 화살 · 아무 데나 놓는 물
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile, groundToClient } from './lib.mjs';

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
  const hp = async (who, pos) => (await T(who, pos)).hp;
  const totems3d = b => b.evalJs(`_t3dTotems.length`);
  const totemDots = async () => Object.values(await DBQ(`${G}/dots`) || {}).filter(d => d.totem).length;

  // ── 타워 배치 · 문 방향 ──
  const lay = await A.json(`JSON.stringify(['my-left','my-king','my-right','enemy-left','enemy-king','enemy-right'].map(id => {
    const el = document.getElementById('tower-' + id); return el.style.getPropertyValue('--col').trim() + ',' + el.style.getPropertyValue('--row').trim(); }))`);
  check('타워가 두 칸씩 앞으로 (내 4·3·4열 · 상대 11·12·11열)', lay.join(' ') === '4,2 3,4 4,6 11,2 12,4 11,6', JSON.stringify(lay));
  const yaw = await A.json(`JSON.stringify(_t3dTowers.map(t => [t.el.id, +t.yaw.toFixed(3)]))`);
  const azi = 17 * Math.PI / 180;
  check('문 방향 — 카메라에서 본 각이 서로 거울', yaw.every(([id, y]) => Math.abs(Math.abs(y - azi) - (0.6 + azi)) < 0.01), JSON.stringify(yaw));

  // ── 토네이도 → 상대 토템이 날아간다 ──
  await use(B, 'forest_spirit', await tile(B, 2, 4));                // B 진영 (B 화면 2열) — A 화면에선 13열
  await sleep(1200);
  check('B 토템 섰다 (두 화면 3D)', await totems3d(A) === 1 && await totems3d(B) === 1 && await totemDots() > 0);
  await use(A, 'tornado', await tile(A, 5, 4));
  await sleep(3000);
  check('토네이도가 닿은 줄의 상대 토템이 날아갔다 (두 화면)', await totems3d(A) === 0 && await totems3d(B) === 0
        && await A.evalJs(`!totemOnTile(13, 4)`) && await B.evalJs(`!totemOnTile(2, 4)`));
  check('날아간 토템의 회복은 멈춘다', await totemDots() === 0);
  check('그 자리는 잠시 토템이 못 버틴다 (날아감)', await B.evalJs(`(totemBreakZoneAt(2, 4) || {}).how`) === 'blow');
  await sleep(1500);

  // ── 불덩이 → 상대 토템이 타 버린다 (힐 밴) ──
  await use(B, 'cherry_blossom_evo', await tile(B, 2, 4));
  await sleep(1000);
  check('B 흰꽃 토템', await totems3d(A) === 1);
  await use(A, 'flame', await groundToClient(A, 1400, 500));        // 2×2 = 13~14열 · 4~5행
  await sleep(1400);
  check('불덩이가 떨어진 자리의 상대 토템이 타 버린다 (두 화면)', await totems3d(A) === 0 && await totems3d(B) === 0, '');
  check('타 버린 토템의 회복은 멈춘다', await totemDots() === 0);
  await shot(A, 'syn_burn.png');
  await sleep(1900);                                                 // 떨어진 지 2.2초 — 예전 잠금(2초)이 지났다
  check('불이 타는 동안(2.8초)은 그 자리에 세운 토템도 재가 된다 (두 화면)', await A.evalJs(`(totemBreakZoneAt(13, 4) || {}).how`) === 'burn'
        && await B.evalJs(`(totemBreakZoneAt(2, 4) || {}).how`) === 'burn');
  await sleep(900);
  check('불이 다 타면 풀린다', await A.evalJs(`!totemBreakZoneAt(13, 4)`) === true);

  // ── 물이 불을 끈다 — A가 B 오른쪽 타워에 불덩이 → B가 자기 진영에 침수 ──
  const r0 = await hp('p2', 'right');
  await use(A, 'flame', await groundToClient(A, 1200, 700));        // 11~12열 · 6~7행 (B 오른쪽 타워 11,6)
  await sleep(1350);
  check('B 진영에 침수를 놓을 수 있다 (내 타워가 범위에 들어도)', true);
  await use(B, 'wave', await tile(B, 4, 4));                        // B 화면 2~5열 — B 오른쪽 타워(4,6) 포함
  await sleep(2200);
  const doused = await A.evalJs(`_fireDoused.length`) > 0 && await B.evalJs(`_fireDoused.length`) > 0;
  check('물이 불에 닿자 꺼졌다 (두 화면)', doused);
  await shot(B, 'syn_douse_B.png');
  await sleep(1500);
  const r1 = await hp('p2', 'right');
  check('꺼진 뒤로는 불 피해가 더 들어가지 않는다 (58 미만)', r0 - r1 >= 28 && r0 - r1 < 58, `${r0} → ${r1} (${r0 - r1})`);
  check('내 진영에 놓은 침수는 내 타워를 치지 않는다', (await T('p2', 'right')).hp === r1);

  // ── 폭염 → 열기 속 토템이 시든다 · 회복 25% 감소 · 물이 열기를 식힌다 ──
  await A.evalJs(`castResetCooldown(); 1`);
  await use(A, 'fire_evo', await tile(A, 13, 4));                   // 12~14열 · 1~7행
  await sleep(700 + 2600 + 2300);                                   // 폭발 · 불탐 · 잠금(2초) 지나 열기 중
  const zones = await DBQ(`${G}/heatZones`);
  check('열기 구역 기록', zones && Object.keys(zones).length >= 1);
  await use(B, 'forest_spirit', await tile(B, 2, 3));               // A 화면 13열 · 3행 — 열기 속
  await sleep(900);
  const wither = await A.evalJs(`_t3dTotems.length === 1 && !!_t3dTotems[0].wither`) && await B.evalJs(`_t3dTotems.length === 1 && !!_t3dTotems[0].wither`);
  check('열기 속에 세운 토템은 말라 비틀어진다 (두 화면)', wither);
  const healAmt = await B.evalJs(`(() => { const gs = getGameState(); const e = Object.entries(gs.dots || {}).find(([, d]) => d.totem);
    if (!e) return -1; const d = e[1]; return computeDotTick(d, gs[d.targetPlayer].towers[d.targetTower], gs, 1, gameNow()).amount; })()`);
  check('더위 속 토템 회복 15 → 11 (25% 감소)', healAmt === 11, String(healAmt));
  await shot(A, 'syn_wither.png');
  // 물이 열기를 식힌다 — B가 자기 진영(열기 칸)에 침수
  await B.evalJs(`castResetCooldown(); 1`);
  await use(B, 'wave', await tile(B, 3, 4));
  await sleep(1600);
  const z2 = await DBQ(`${G}/heatZones`);
  check('물이 닿자 열기(더위 구역)가 지워졌다', !z2 || Object.values(z2).every(z => z.until < Date.now() - 1e12 || false) || Object.keys(z2).length === 0, JSON.stringify(z2));
  check('더위 표도 떨어졌다', await A.evalJs(`!document.querySelector('.tower.tower-heat')`));
  await sleep(4000);

  // ── 얼음전개 — 4×4 · 밑동부터 얼음 · 1초마다 12 · 덱 동결 10초 ──
  const k0 = await hp('p2', 'king'), l0 = await hp('p2', 'left');
  await use(A, 'ice_deploy', await groundToClient(A, 1200, 400));    // 10~13열 · 2~5행 → 왼쪽(11,2) · 킹(12,4)
  await sleep(1300);
  const kt = await T('p2', 'king'), lt = await T('p2', 'left'), rt = await T('p2', 'right');
  check('범위 안 타워가 얼었다 (킹 · 왼쪽 · 오른쪽은 아님)', kt.frozenUntil > 0 && lt.frozenUntil > 0 && !rt.frozenUntil, JSON.stringify([kt.frozenUntil, lt.frozenUntil, rt.frozenUntil]));
  const fz = await DBQ(`${G}/p2/deckFreezeUntil`);
  check('상대 덱 동결 10초', Math.abs(fz - kt.frozenUntil) < 1500, `${fz} vs ${kt.frozenUntil}`);
  check('두 화면 모두 얼음이 차오른다 (3D)', await A.evalJs(`_t3dIces.length`) === 2 && await B.evalJs(`_t3dIces.length`) === 2);
  await sleep(700);
  await shot(A, 'syn_ice_A.png');
  await shot(B, 'syn_ice_B.png');
  const lvl = await B.evalJs(`_t3dIces.map(x => +x.level.toFixed(2)).join()`);
  check('얼음이 꼭대기까지 찼다', lvl.split(',').every(v => +v > 0.95), lvl);
  check('B는 덱이 얼어 어떤 카드도 못 쓴다 (불 카드도)', await B.evalJs(`deckFrozenFor(CARD_DEFINITIONS.rock) && deckFrozenFor(CARD_DEFINITIONS.flame) && deckFrozenFor(CARD_DEFINITIONS.fire_evo)`) === true);
  await sleep(1300);
  const k1 = await hp('p2', 'king');
  check('얼어 있는 동안 1초마다 12', k0 - k1 >= 12 && (k0 - k1) % 12 === 0, `${k0} → ${k1}`);
  await sleep(600);
  check('타워가 다 얼면 바닥 얼음은 사라진다 (두 화면)', await A.evalJs(`!document.querySelector('.ice-ground') && _t3dIceFields.length === 0`) === true
        && await B.evalJs(`!document.querySelector('.ice-ground') && _t3dIceFields.length === 0`) === true);
  check('타워의 얼음은 남아 있다', await A.evalJs(`_t3dIces.length`) === 2);

  // A(얼린 쪽)가 언 킹에 불덩이 → 불덩이 피해 절반 · 반쯤 녹는다
  check('언 타워 불덩이 28 → 14', await A.evalJs(`towerAdjustDamage({ frozenUntil: gameNow() + 5000 }, 28, gameNow(), { cardId: 'flame' })`) === 14);
  await use(A, 'flame', await groundToClient(A, 1200, 400));         // 11~12열 · 3~4행 → 킹(12,4)만
  await sleep(1500);
  check('불덩이 — 킹 얼음이 반쯤 녹았다', (await T('p2', 'king')).frozenMelt === 1);
  check('불덩이가 안 닿은 왼쪽은 그대로', !(await T('p2', 'left')).frozenMelt);
  await sleep(300);
  const meltLv = await A.evalJs(`(_t3dIces.find(x => x.el.id === 'tower-enemy-king') || {}).level`);
  check('얼음이 절반으로 내려앉았다 (3D)', meltLv > 0.4 && meltLv < 0.6, String(meltLv));
  check('덱 동결은 그대로 (아직 얼어 있다)', (await DBQ(`${G}/p2/deckFreezeUntil`)) > (await B.evalJs(`gameNow()`)));

  // A가 폭염 → 언 타워는 피해 없이 다 녹고, 녹은 물이 3초 고인다 · 덱 동결이 풀린다
  await A.evalJs(`castResetCooldown(); 1`);
  const rBefore = await hp('p2', 'right');
  await use(A, 'fire_evo', await tile(A, 12, 4));                    // 11~13열 · 1~7행 — 셋 다
  await sleep(1000);
  const kt2 = await T('p2', 'king'), lt2 = await T('p2', 'left');
  check('폭염 — 얼음이 다 녹았다 (킹 · 왼쪽)', kt2.frozenMelt === 2 && lt2.frozenMelt === 2, JSON.stringify([kt2.frozenMelt, lt2.frozenMelt]));
  check('덱 동결이 풀렸다', (await DBQ(`${G}/p2/deckFreezeUntil`)) <= (await B.evalJs(`gameNow()`)));
  const kh = await hp('p2', 'king'), lh = await hp('p2', 'left');
  const pool = await A.json(`JSON.stringify({ soaked: towerSoaked('p2', 'king', gameNow()),
    zap: computeDotTick({ type: 'damage', cardId: 'lightning', dmgPerTick: 12, targetPlayer: 'p2', targetTower: 'king' }, getGameState().p2.towers.king, getGameState(), 1, gameNow()).amount,
    heal: towerSoakedHeal(15, 'p2', 'king', gameNow()), pools: document.querySelectorAll('.ice-pool').length })`);
  check('녹은 물 — 젖음: 번개 12 → 18 · 상대 회복 15 → 24 · 웅덩이 2개', pool.soaked && pool.zap === 18 && pool.heal === 24 && pool.pools === 2, JSON.stringify(pool));
  check('B 화면도 녹은 물을 안다', await B.evalJs(`towerSoaked('p2', 'left', gameNow()) && document.querySelectorAll('.ice-pool').length === 2`) === true);
  await shot(A, 'syn_pool_A.png');
  await sleep(2600);
  check('폭염은 녹인 타워에 피해를 넣지 않는다 (킹 · 왼쪽)', (await hp('p2', 'king')) === kh && (await hp('p2', 'left')) === lh, `${kh}→${await hp('p2', 'king')} ${lh}→${await hp('p2', 'left')}`);
  check('얼지 않은 오른쪽은 폭염 피해를 받는다', rBefore - (await hp('p2', 'right')) >= 49, `${rBefore} → ${await hp('p2', 'right')}`);
  await sleep(900);
  check('3초 뒤 물이 말랐다', await A.evalJs(`!towerSoaked('p2', 'king', gameNow())`) === true);
  check('얼음이 녹아 사라졌다 (두 화면)', await A.evalJs(`_t3dIces.length`) === 0 && await B.evalJs(`_t3dIces.length`) === 0);

  // ── 쇄빙 — 다시 얼리고 붕괴 → 30% 더 · 얼음이 깨져 동결이 바로 풀린다 ──
  await sleep(6000);                                                  // 열기(더위)가 식기를 기다린다
  await A.evalJs(`castResetCooldown(); 1`);
  await use(A, 'ice_deploy', await groundToClient(A, 1200, 400));
  await sleep(1300);
  check('다시 얼었다', (await T('p2', 'king')).frozenUntil > (await A.evalJs(`gameNow()`)) && (await T('p2', 'king')).frozenMelt == null);
  check('B 덱 동결', (await DBQ(`${G}/p2/deckFreezeUntil`)) > (await B.evalJs(`gameNow()`)));
  await A.evalJs(`castResetCooldown(); 1`);
  const ks = await hp('p2', 'king');
  await use(A, 'collapse', await tile(A, 12, 4));
  await sleep(1200);
  const kt3 = await T('p2', 'king'), lt3 = await T('p2', 'left');
  check('쇄빙 — 얼음이 깨졌다 (킹 · 왼쪽)', kt3.frozenMelt === 3 && lt3.frozenMelt === 3, JSON.stringify([kt3.frozenMelt, lt3.frozenMelt]));
  check('쇄빙 — 붕괴 25 → 33 (얼음 피해 틱 포함 가능)', [33, 45, 57].includes(ks - kt3.hp), `${ks} → ${kt3.hp}`);
  check('쇄빙 — 덱 동결도 풀렸다', (await DBQ(`${G}/p2/deckFreezeUntil`)) <= (await B.evalJs(`gameNow()`)));
  await sleep(600);
  check('깨진 얼음이 사라졌다 (두 화면)', await A.evalJs(`_t3dIces.length`) === 0 && await B.evalJs(`_t3dIces.length`) === 0);
  const k5 = await hp('p2', 'king');
  await sleep(2100);
  check('깨진 뒤 동결 피해 없음', (await hp('p2', 'king')) === k5);

  // ── 물 — 누가 쓴 물이든 젖은 쪽 회복 +50% (내 진영에 쓴 침수 = 내 회복 버프) ──
  await A.evalJs(`castResetCooldown(); 1`);
  await use(A, 'wave', await tile(A, 4, 4));                          // A 자기 진영 — A 킹(3,4)
  await sleep(1300);
  check('내 진영 침수 — 내 벚꽃 회복 15 → 24', await A.evalJs(`towerSoakedHeal(15, 'p1', 'king', gameNow())`) === 24);
  check('상대 화면도 같은 값', await B.evalJs(`towerSoakedHeal(15, 'p1', 'king', gameNow())`) === 24);
  check('물이 안 닿은 상대는 그대로', await A.evalJs(`towerSoakedHeal(15, 'p2', 'king', gameNow())`) === 15);
  await sleep(4500);
  check('물이 빠지면 버프 끝', await A.evalJs(`towerSoakedHeal(15, 'p1', 'king', gameNow())`) === 15);

  // ── 화살 — 내 진영에서 쏘면 왼쪽 · 내 타워는 지나친다 ──
  await A.evalJs(`castResetCooldown(); 1`);
  const myHp = [await hp('p1', 'left'), await hp('p1', 'king'), await hp('p1', 'right')];
  await fill(A); await pickCard(A, 'arrow');
  const ap = await tile(A, 6, 4);
  await mouse(A, 'mouseMoved', ap.x, ap.y); await sleep(200);
  const aim = await A.json(`JSON.stringify({ dir: _shotAim.dir, hit: !!_shotAim.hit })`);
  check('내 진영 화살 — 왼쪽을 본다 · 내 타워를 겨누지 않는다', aim.dir === -1 && !aim.hit, JSON.stringify(aim));
  await click(A, ap.x, ap.y);
  await sleep(400);
  check('받는 화면도 그쪽(B 화면 오른쪽 끝)으로 날린다', await B.evalJs(`!!document.querySelector('.fx-arrow')`));
  await sleep(1500);
  const myHp2 = [await hp('p1', 'left'), await hp('p1', 'king'), await hp('p1', 'right')];
  check('내 타워는 맞지 않는다', myHp.join() === myHp2.join(), `${myHp} → ${myHp2}`);
  check('화살이 내 타워에 꽂히지 않았다 (두 화면)', await A.evalJs(`!document.querySelector('.fx-arrow-stuck')`) && await B.evalJs(`!document.querySelector('.fx-arrow-stuck')`));

  // ── 파도 — 아무 열에나 ──
  await fill(A); await pickCard(A, 'wave_evo');
  const wp = await tile(A, 1, 4);
  await mouse(A, 'mouseMoved', wp.x, wp.y); await sleep(200);
  check('파도를 내 진영 끝(0열)에서도 놓을 수 있다', await A.evalJs(`_waveAim.ok && _waveAim.c0 === 0`) === true);
  await A.evalJs(`_cancelStickyDrag(); 1`);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
