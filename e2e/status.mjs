// 2026-10-01 — 타워 배치(옆 타워가 앞) · 리퍼 소환 줄 · 침수 기절 · 파도 둔화 · 젖은 토템 회복 +50% · 낫 대기 게이지 · 설치 제한
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile } from './lib.mjs';

await resetDB();
const A = await launch('A', 9621), B = await launch('B', 9622);
const all = [A, B];
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;

  // ── 타워 배치 ──
  const cols = b => b.json(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('.tower')].map(e => [e.id, +e.style.getPropertyValue('--col')])))`);
  const ca = await cols(A), cb = await cols(B);
  check('옆 타워가 킹보다 앞 (내 쪽: 킹 3열 · 옆 4열 / 상대: 킹 12열 · 옆 11열)',
        ca['tower-my-king'] === 3 && ca['tower-my-left'] === 4 && ca['tower-my-right'] === 4 &&
        ca['tower-enemy-king'] === 12 && ca['tower-enemy-left'] === 11 && ca['tower-enemy-right'] === 11, JSON.stringify(ca));
  check('상대 화면도 같은 배치', cb['tower-my-king'] === 3 && cb['tower-my-left'] === 4 && cb['tower-enemy-king'] === 12 && cb['tower-enemy-left'] === 11, JSON.stringify(cb));

  // ── 리퍼 소환 줄 ──
  const lanes = await A.json(`JSON.stringify([_summonTarget(5, 2), _summonTarget(5, 4), _summonTarget(5, 6)])`);
  check('처음엔 옆 타워 줄(2·6행)만 — 킹 줄은 안 된다', lanes[0] === 'left' && lanes[1] === null && lanes[2] === 'right', JSON.stringify(lanes));
  const one = await A.json(`JSON.stringify(unitSummonTarget(5, 4, { left: { alive: false }, right: { alive: true }, king: { alive: true } }))`);
  const both = await A.json(`JSON.stringify([unitSummonTarget(5, 4, { left: { alive: false }, right: { alive: false }, king: { alive: true } }),
                                             unitSummonTarget(5, 2, { left: { alive: false }, right: { alive: false }, king: { alive: true } })])`);
  check('옆 타워 하나만 무너졌으면 아직 킹 줄은 안 된다', one === null, JSON.stringify(one));
  check('옆 타워가 둘 다 무너지면 킹 줄로 놓을 수 있다 (옆 줄은 목표가 없어 안 됨)', both[0] === 'king' && both[1] === null, JSON.stringify(both));

  // ── 침수: 2026-10-02부터 내 진영(내 타워 위)에도 놓는다 ──
  await pickCard(A, 'wave');
  const t24 = await tile(A, 2, 4);
  await mouse(A, 'mouseMoved', t24.x, t24.y); await sleep(150);
  check('침수 — 내 타워가 범위에 들어도 놓을 수 있다',
        await A.evalJs(`_areaAim.ok && !_castArc.classList.contains('cast-circle-bad')`) === true);

  // ── 침수 기절 — p2 리퍼가 2행을 걸어오는 중 ──
  await A.evalJs(`(() => { const now = gameNow();
    return db.ref('${G}/units/rs').set({ owner: 'p2', kind: 'reaper', hp: 200, maxHp: 200, speed: 1500, born: now - 1000,
      leg: { c: 13, r: 2, t: now, target: 'left', n: 0, souls: 0 } }).then(() => 1); })()`);
  await waitFor(A, `!!_uGs?.units?.rs`, 5000);
  const t13 = await tile(A, 13, 4);
  await mouse(A, 'mouseMoved', t13.x, t13.y); await sleep(150);
  await click(A, t13.x, t13.y);
  const f0 = Date.now();
  await sleep(1300);
  const st = b => b.json(`JSON.stringify((() => { const u = _uGs.units.rs; const t = gameNow();
    return { s: unitStatusAt(u, t), c: +unitPosAt(u, t).c.toFixed(3), holds: u.leg.holds || '', hp: u.hp,
             hud: !!document.querySelector('.unit-hud.unit-stunned') }; })())`);
  const s1a = await st(A), s1b = await st(B);
  check('침수에 든 리퍼 — 두 화면 모두 기절', s1a.s === 'stun' && s1b.s === 'stun' && s1a.hud && s1b.hud, JSON.stringify([s1a, s1b]));
  // 젖은 토템 회복 — 맞은 쪽(p2) 토템만 ceil(h/2)×3
  const heal = b => b.json(`JSON.stringify([23, 24, 25].map(h => computeDotTick({ type: 'heal', dmgPerTick: h, totem: '12,2', targetPlayer: 'p2' },
      { hp: 100, maxHp: 300, alive: true }, _effectsGameState, 1, gameNow()).amount)
    .concat([computeDotTick({ type: 'heal', dmgPerTick: 23, totem: '12,2', targetPlayer: 'p1' }, { hp: 100, maxHp: 300, alive: true }, _effectsGameState, 1, gameNow()).amount,
             computeDotTick({ type: 'heal', dmgPerTick: 23, totem: '4,2', targetPlayer: 'p2' }, { hp: 100, maxHp: 300, alive: true }, _effectsGameState, 1, gameNow()).amount]))`);
  const ha = await heal(A), hb = await heal(B);
  check('침수에 젖은 상대 토템 — 23→36 · 24→36 · 25→39 (두 화면 같음)', JSON.stringify(ha.slice(0, 3)) === '[36,36,39]' && JSON.stringify(hb) === JSON.stringify(ha), JSON.stringify([ha, hb]));
  check('젖은 칸이면 누구 토템이든 늘어난다 (2026-10-02) · 물 밖 토템은 그대로', ha[3] === 36 && ha[4] === 23, JSON.stringify(ha));
  await sleep(1000);
  const s2 = await st(A);
  check('기절 중엔 걸음이 멈춘다', Math.abs(s2.c - s1a.c) < 0.01, `${s1a.c} → ${s2.c}`);
  await shot(A, 'status_stun.png');
  await sleep(Math.max(0, 4700 - (Date.now() - f0)));
  const s3 = await st(A);
  await sleep(900);
  const s4 = await st(A);
  check('물이 빠지면 기절이 풀리고 다시 걷는다', s3.s === null && s4.c < s3.c - 0.3, JSON.stringify([s3, s4]));
  const healAfter = await A.json(`JSON.stringify(computeDotTick({ type: 'heal', dmgPerTick: 23, totem: '12,2', targetPlayer: 'p2' }, { hp: 100, maxHp: 300, alive: true }, _effectsGameState, 1, gameNow()).amount)`);
  check('물이 빠진 뒤엔 회복 버프도 끝', healAfter === 23, String(healAfter));
  await A.evalJs(`db.ref('${G}/units/rs').remove().then(() => 1)`);
  await sleep(500);

  // ── 파도: 2026-10-02부터 아무 열에나 ──
  await pickCard(A, 'wave_evo');
  const t54 = await tile(A, 5, 4);
  await mouse(A, 'mouseMoved', t54.x, t54.y); await sleep(150);
  check('파도 — 내 진영에도 놓인다 (4~6열 띠)', await A.evalJs(`_waveAim.ok && _waveAim.c0 === 4`) === true);
  const t124 = await tile(A, 12, 4);
  await mouse(A, 'mouseMoved', t124.x, t124.y); await sleep(150);
  check('파도 — 상대 진영 안쪽(12열)도 된다 (11~13열 띠)', await A.evalJs(`_waveAim.ok && _waveAim.c0 === 11`) === true);
  // 파도에 닿을 p2 리퍼 (2행 11열에서 걸어온다)
  await A.evalJs(`(() => { const now = gameNow();
    return db.ref('${G}/units/rw').set({ owner: 'p2', kind: 'reaper', hp: 200, maxHp: 200, speed: 1500, born: now - 1000,
      leg: { c: 10, r: 2, t: now, target: 'left', n: 0, souls: 0 } }).then(() => 1); })()`);
  await waitFor(A, `!!_uGs?.units?.rw`, 5000);
  const t94 = await tile(A, 9, 4);
  await mouse(A, 'mouseMoved', t94.x, t94.y); await sleep(150);
  const aim = await A.json(`JSON.stringify({ ok: _waveAim.ok, c0: _waveAim.c0, hit: _waveAim.plan.hit })`);
  check('파도 — 상대 진영 맨 앞 3칸(8~10열)에서 출발', aim.ok && aim.c0 === 8, JSON.stringify(aim));
  check('파도 — 옆 타워 11열 · 킹 12열을 친다', (aim.hit.left || 0) >= 1 && (aim.hit.king || 0) >= 1 && (aim.hit.right || 0) >= 1, JSON.stringify(aim.hit));
  const kingHp0 = await DBQ(`${G}/p2/towers/king/hp`), leftHp0 = await DBQ(`${G}/p2/towers/left/hp`);
  const wg0 = await A.evalJs(`gameNow()`);
  await click(A, t94.x, t94.y);
  const w0 = Date.now();
  await sleep(1500);
  const sw = b => b.json(`JSON.stringify((() => { const u = _uGs.units.rw; if (!u) return null; const t = gameNow();
    return { s: unitStatusAt(u, t), c: +unitPosAt(u, t).c.toFixed(3), holds: u.leg.holds || '', hud: !!document.querySelector('.unit-hud.unit-slowed') }; })())`);
  const w1a = await sw(A), w1b = await sw(B);
  check('파도에 닿은 리퍼 — 두 화면 모두 둔화', w1a?.s === 'slow' && w1b?.s === 'slow' && w1a.hud && /,0\.5/.test(w1a.holds), JSON.stringify([w1a, w1b]));
  // 파도는 닿는 동안만 젖는다 — 출발 띠(8~10열)의 9열은 막 솟았을 때 젖고, 파도가 지나간 지금은 마른다
  const healW = await A.json(`JSON.stringify([${wg0} + 300, gameNow()].map(t => computeDotTick({ type: 'heal', dmgPerTick: 23, totem: '9,6', targetPlayer: 'p2' }, { hp: 100, maxHp: 300, alive: true }, _effectsGameState, 1, t).amount))`);
  check('파도가 닿는 동안 젖은 토템 회복 +50% (23→36) · 지나가면 그대로', healW[0] === 36 && healW[1] === 23, JSON.stringify(healW));
  await sleep(600);
  const w2 = await sw(A);
  if (w1a && w2 && w2.s === 'slow') check('둔화 중엔 절반 빠르기 (0.6초에 약 0.2칸)', Math.abs((w1a.c - w2.c) - 0.2) < 0.08, `${w1a.c} → ${w2.c}`);
  await shot(A, 'status_slow.png');
  await sleep(Math.max(0, 700 + 2500 + 600 - (Date.now() - w0)));
  const kingHp1 = await DBQ(`${G}/p2/towers/king/hp`), leftHp1 = await DBQ(`${G}/p2/towers/left/hp`);
  check('파도가 끝까지 가며 타워를 쳤다', kingHp1 < kingHp0 && leftHp1 < leftHp0, `${kingHp0}→${kingHp1} · ${leftHp0}→${leftHp1}`);
  await A.evalJs(`db.ref('${G}/units/rw').remove().then(() => 1)`);
  await sleep(3000);

  // ── 낫 대기 게이지 — 6행 p1 리퍼 (상대 옆 타워 11열 앞 10열) ──
  await A.evalJs(`(() => { const now = gameNow();
    return db.ref('${G}/units/rc').set({ owner: 'p1', kind: 'reaper', hp: 200, maxHp: 200, speed: 1500, born: now - 1000,
      leg: { c: 10, r: 6, t: now, target: 'right', n: 0, souls: 0 } }).then(() => 1); })()`);
  await waitFor(A, `!!_uGs?.units?.rc && unitSwingsBy(_uGs.units.rc, gameNow()) >= 1`, 8000);
  await sleep(300);
  const cd = b => b.json(`JSON.stringify((() => { const e = document.querySelector('.unit-cd'); if (!e || e.style.display === 'none') return null;
    return { t: e.textContent, p: +e.style.getPropertyValue('--p') }; })())`);
  const c1 = await cd(A), c1b = await cd(B);
  await sleep(1100);
  const c2 = await cd(A);
  check('첫 낫 뒤 몸 한가운데 원형 게이지 — 4s → 3s', c1?.t === '4s' && c2?.t === '3s' && c2.p > c1.p, JSON.stringify([c1, c2]));
  check('상대 화면에도 같은 게이지', c1b?.t === '4s' || c1b?.t === '3s', JSON.stringify(c1b));
  await shot(A, 'status_cd.png');
  await sleep(2600);
  const c3 = await cd(A);
  check('0이 되면 바로 베고 다시 4s부터', c3?.t === '4s' || c3?.t === '3s', JSON.stringify(c3));
  const swings = await A.evalJs(`unitSwingsBy(_uGs.units.rc, gameNow())`);
  check('그 사이 낫이 한 번 더 들어갔다', swings >= 2, String(swings));

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
