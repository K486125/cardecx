// 2026-10-02 — 벽돌 · 철벽: 한 타워에 방어막 하나 · 같은 방어막은 연장 · 기둥 가운데 파란 게이지 · 방패 아이콘 없음
import { writeFileSync } from 'node:fs';
import { launch, waitFor, sleep, DBQ, resetDB, check, failCount, addFail, mouse, click, startMatch, pickCard, tile } from './lib.mjs';

await resetDB();
const A = await launch('A', 9671), B = await launch('B', 9672);
const all = [A, B];
const shot = async (b, file) => { const s = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  const T = pos => DBQ(`${G}/p1/towers/${pos}`);
  const fill = () => A.evalJs(`_currentEnergy = 100; _renderEnergy(100); 1`);
  const place = async (id, col, row) => {
    await fill();
    await pickCard(A, id);
    const p = await tile(A, col, row);
    await mouse(A, 'mouseMoved', p.x, p.y); await sleep(150);
    const aim = await A.json(`JSON.stringify({ ok: _towerTileAim.ok, blocked: !!_towerTileAim.blocked,
      hl: [...document.querySelectorAll('.tower.drag-over-heal, .tower.drag-over')].map(e => e.id) })`);
    await click(A, p.x, p.y);
    await sleep(700);
    return aim;
  };
  const gauges = b => b.json(`JSON.stringify([...document.querySelectorAll('.wall-cd')].map(e => ({
    iron: e.classList.contains('wall-cd-iron'), p: +e.style.getPropertyValue('--p'), s: e.querySelector('em').textContent,
    x: Math.round(parseFloat(e.style.left)), y: Math.round(parseFloat(e.style.top)) })))`);

  // ── 벽돌 → 킹 ──
  await place('brick', 3, 4);
  const k1 = await T('king');
  check('벽돌 — 6초', k1.damageReductionUntil - k1.damageReductionFrom === 6000 && k1.damageReductionPercent === 40, JSON.stringify(k1));
  const g1 = await gauges(A);
  const tp = await A.json(`JSON.stringify(towers3dTowerPoint('my', 'king', 0.5))`);
  check('기둥 가운데 파란 게이지 하나', g1.length === 1 && !g1[0].iron && Math.abs(g1[0].x - tp.x) <= 2 && Math.abs(g1[0].y - tp.y) <= 2 && /^[56]s$/.test(g1[0].s),
        JSON.stringify([g1, tp]));
  const look = await A.json(`JSON.stringify((() => { const el = document.querySelector('.wall-cd-track'); const cs = getComputedStyle(el);
    return { bg: cs.backgroundImage.slice(0, 60), badge: document.getElementById('tower-my-king').classList.contains('has-defense') }; })())`);
  check('파란 그라데이션 · 방패 아이콘 없음', /conic-gradient/.test(look.bg) && !look.badge, JSON.stringify(look));
  check('상대 화면에도 게이지', (await gauges(B)).length === 1);

  // ── 벽돌을 또 → 연장 ──
  const left0 = k1.damageReductionUntil;
  await place('brick', 3, 4);
  const k2 = await T('king');
  check('벽돌 또 놓기 — 남은 시간에 6초 연장 (시작 시각 그대로)', k2.damageReductionUntil === left0 + 6000 && k2.damageReductionFrom === k1.damageReductionFrom, JSON.stringify([k1, k2]));
  await place('brick', 3, 4);
  const k3 = await T('king');
  check('세 번째도 6초 더 (전체 18초)', k3.damageReductionUntil - k3.damageReductionFrom === 18000, JSON.stringify(k3));
  const walls = await A.json(`JSON.stringify(_t3dWalls.filter(w => w.end > performance.now()).map(w => ({ id: w.el.id, kind: w.kind, left: Math.round(w.end - performance.now()) })))`);
  const dataLeft = await A.evalJs(`getGameState().p1.towers.king.damageReductionUntil - gameNow()`);
  check('3D 벽은 하나 · 늘어난 시간까지 서 있다', walls.length === 1 && Math.abs(walls[0].left - dataLeft) < 300, JSON.stringify([walls, dataLeft]));
  const g3 = await gauges(A);
  check('게이지는 늘어난 전체에 대한 남은 몫 · 초', g3.length === 1 && g3[0].p > 70 && /^1[5-7]s$/.test(g3[0].s), JSON.stringify(g3));

  // ── 철벽 → 킹은 막힘 ──
  const aimIron = await place('iron_wall', 3, 4);
  check('벽돌이 선 킹에는 철벽 조준이 안 된다', !aimIron.ok && aimIron.blocked && !aimIron.hl.includes('tower-my-king'), JSON.stringify(aimIron));
  const k4 = await T('king');
  check('철벽이 들어가지 않음 · 안내 문구', !k4.damageReductionLinePercent && k4.damageReductionUntil === k3.damageReductionUntil
        && await A.evalJs(`(document.getElementById('center-notice')?.textContent || '').includes('방어막')`), JSON.stringify(k4));
  // 들고 있는 철벽을 다른 타워(왼쪽 2,2)에 놓는다
  const p = await tile(A, 4, 2);
  await mouse(A, 'mouseMoved', p.x, p.y); await sleep(150);
  await click(A, p.x, p.y); await sleep(700);
  const l1 = await T('left');
  check('다른 타워에는 철벽 (80% / 50% · 8초)', l1.damageReductionLinePercent === 80 && l1.damageReductionUntil - l1.damageReductionFrom === 8000, JSON.stringify(l1));
  const g4 = await gauges(A);
  check('게이지 둘 — 철벽 하나', g4.length === 2 && g4.filter(g => g.iron).length === 1, JSON.stringify(g4));
  // 트랜잭션도 막는다 — 벽돌이 선 킹에 철벽을 억지로 넣어도 그대로
  await A.evalJs(`applyCardUse('p1', null, null, 'p1', ['king'], CARD_DEFINITIONS.iron_wall, getGameState().p1.towers, getGameState()); 1`);
  await sleep(600);
  const k5 = await T('king');
  check('데이터도 한 타워에 하나 (철벽 거부)', !k5.damageReductionLinePercent && k5.damageReductionUntil === k3.damageReductionUntil, JSON.stringify(k5));
  // 철벽에 벽돌도 안 된다
  const aimBrick = await place('brick', 4, 2);
  check('철벽이 선 타워에는 벽돌 조준이 안 된다', !aimBrick.ok && aimBrick.blocked, JSON.stringify(aimBrick));
  await A.evalJs(`_cancelStickyDrag && _cancelStickyDrag(); 1`);
  await shot(A, 'ws_two.png');
  await shot(B, 'ws_two_B.png');

  // ── 시간이 지나면 사라진다 ──
  await sleep(Math.max(0, k3.damageReductionUntil - (await A.evalJs(`gameNow()`))) + 900);
  check('끝나면 게이지 · 벽이 사라진다', (await gauges(A)).length === 0 && (await gauges(B)).length === 0
        && await A.evalJs(`_t3dWalls.length`) === 0);
  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
