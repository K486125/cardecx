// node --experimental-websocket stone.mjs
// 돌(rock) 투척 — 차징 단계별 피해와 비행 시간, 궤적·게이지 표시, 상대 화면 동기화
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5055';
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(6);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(name, port) {
  const dir = mkdtempSync(join(tmpdir(), 'cdx-' + name + '-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') console.log(`${ts()} [${name}] EXCEPTION: ` + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.addScriptToEvaluateOnNewDocument', { source: "document.addEventListener('DOMContentLoaded', () => { if (typeof mapFitZoom === 'function') window.mapFitZoom = () => 1; });" });
  const evalJs = async (expr, ms = 20000) => {
    const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => null)]);
    if (r?.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r ? r.result?.result?.value : 'TIMEOUT';
  };
  return { name, proc, send, evalJs, goto: url => send('Page.navigate', { url: BASE + url }) };
}

async function waitFor(b, expr, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await b.evalJs(expr).catch(() => false);
    if (v === 'TIMEOUT') throw new Error(`[${b.name}] 페이지가 응답하지 않습니다: ${expr}`);
    if (v) return true;
    await sleep(150);
  }
  throw new Error(`[${b.name}] timeout: ${expr}`);
}

let fails = 0;
const ok = (n, c, i = '') => { console.log(`${ts()} ` + (c ? 'PASS ' : '실패 ') + n + (i ? '  ' + i : '')); if (!c) fails++; };

const A = await launch('A', 9381), B = await launch('B', 9382);
const mouse = (b, type, x, y, button = 'left', buttons = 1) =>
  b.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const click = async (b, x, y) => { await mouse(b, 'mouseMoved', x, y, 'none', 0); await mouse(b, 'mousePressed', x, y); await mouse(b, 'mouseReleased', x, y); };

try {
  for (const [b, nick] of [[A, 'Alice#Dev'], [B, 'Bobby#Dev']]) {
    await b.goto('/index.html');
    await waitFor(b, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
    await sleep(800);
    await b.evalJs(`document.getElementById('input-nickname').value='${nick}'; document.getElementById('btn-confirm-nickname').click(); 1`);
  }
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-create-room').click(); 1`);
  await waitFor(A, `location.pathname.endsWith('game.html') && document.getElementById('display-room-code')?.textContent.length===6`);
  const code = await A.evalJs(`new URLSearchParams(location.search).get('room')`);
  await waitFor(B, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await B.evalJs(`document.getElementById('input-room-code').value='${code}'; document.getElementById('btn-join-room').click(); 1`);
  await waitFor(B, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`);
  await waitFor(A, `!document.getElementById('btn-ready').disabled`);
  await sleep(600);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`); await sleep(300);
  await B.evalJs(`document.getElementById('btn-ready').click(); 1`);
  for (const b of [A, B]) await waitFor(b, `!document.getElementById('screen-game').classList.contains('hidden')`, 25000);
  await waitFor(A, `window.matchInputLocked === false`, 25000);
  await sleep(900);



  // ── 카드 구성 ─────────────────────────────────────────────
  const cards = JSON.parse(await A.evalJs(`JSON.stringify({
    hasTornadoEpic: CARDS_BY_GRADE.epic.includes('tornado'),
    hasStrongWind:  !!CARD_DEFINITIONS.strong_wind,
    windEvo:        EVOLUTION_MAP.wind,
    wind:           CARD_DEFINITIONS.wind,
    tornado:        CARD_DEFINITIONS.tornado
  })`));
  ok('에픽에서 토네이도 제거', !cards.hasTornadoEpic);
  const pool = JSON.parse(await A.evalJs(`JSON.stringify({
    total: Object.keys(CARD_DEFINITIONS).length,
    missingInPool: Object.values(CARDS_BY_GRADE).flat().filter(id => !CARD_DEFINITIONS[id]),
    missingEvo: Object.entries(EVOLUTION_MAP).flatMap(([a,b]) => [CARD_DEFINITIONS[a]?null:a, CARD_DEFINITIONS[b]?null:b]).filter(Boolean)
  })`));
  ok('모든 등급 풀의 카드가 정의돼 있다', pool.missingInPool.length === 0, JSON.stringify(pool.missingInPool));
  ok('모든 진화 원본·결과가 정의돼 있다', pool.missingEvo.length === 0, JSON.stringify(pool.missingEvo));
  ok('카드가 통째로 사라지지 않았다', pool.total >= 35, '카드 수=' + pool.total);
  ok('강풍 주의 카드 제거', !cards.hasStrongWind);
  ok('토네이도가 바람의 진화 카드', cards.windEvo === 'tornado' && cards.tornado.isEvolution === true, cards.windEvo);
  ok('바람: 단일 24 피해 + 에너지 -5',
     cards.wind.targeting === 'single' && cards.wind.effect.damage === 24 && cards.wind.effect.energyDrain === 5,
     JSON.stringify(cards.wind.effect) + ' ' + cards.wind.targeting);

  const ws = JSON.parse(await A.evalJs(`JSON.stringify(CAST_STYLES.windsmash)`));
  ok('바람 사거리: 일자 두 타일(200px)', ws.shape === 'lunge' && ws.radius === 200, `${ws.shape} ${ws.radius}`);
  ok('바람 이펙트 0.4초', ws.endMs === 400, ws.endMs + 'ms');

  // ── 토네이도 표 ───────────────────────────────────────────
  const tbl = JSON.parse(await A.evalJs(`JSON.stringify({
    rad:  [0,1,2,3,4,5,6,7].map(c => tornadoRadius(c)),
    side: [0,1,2,3,4,5,6,7].map(c => tornadoDamage(11 - c)),
    king: [0,1,2,3,4,5,6,7].map(c => tornadoDamage(12 - c))
  })`));
  ok('오른쪽 끝(7열)이 최소 피해', tbl.side[7] === 16 && tbl.king[7] === 19, `킹 ${tbl.king[7]}, 옆 ${tbl.side[7]}`);
  ok('왼쪽 끝(0열)이 최대 피해 (킹 40)', tbl.king[0] === 40 && tbl.side[0] === 37, `킹 ${tbl.king[0]}, 옆 ${tbl.side[0]}`);
  ok('멀수록 피해가 커진다', tbl.side.every((d, i, a) => i === 0 || d <= a[i - 1]), JSON.stringify(tbl.side));
  // 타워 줄 간격이 200 — 반지름 100이면 두 줄, 200이면 세 줄에 닿는다
  ok('가까운 쪽은 한 줄만 (반지름 100 미만)', tbl.rad[5] < 100 && tbl.rad[7] < 100, `5열=${tbl.rad[5]}, 7열=${tbl.rad[7]}`);
  ok('중간은 두 줄 (반지름 100 이상)', tbl.rad[4] >= 100 && tbl.rad[1] >= 100, `4열=${tbl.rad[4]}, 1열=${tbl.rad[1]}`);
  ok('맨 끝(0열)은 세 줄까지 (반지름 200 이상)', tbl.rad[0] >= 200, `0열=${tbl.rad[0]}`);
  ok('멀수록 커진다', tbl.rad.every((r, i, a) => i === 0 || r <= a[i - 1]), JSON.stringify(tbl.rad));

  // 닿는 개수는 제한하지 않는다 — 다 자란 크기에 닿으면 하나든 둘이든 셋이든 맞는다
  const counts = JSON.parse(await A.evalJs(`JSON.stringify({
    one:   tornadoTargets(6, 2).map(h => h.pos),
    two:   tornadoTargets(3, 3).map(h => h.pos),
    three: tornadoTargets(0, 4).map(h => h.pos)
  })`));
  ok('가까운 칸 = 타워 하나', counts.one.length === 1, JSON.stringify(counts.one));
  ok('중간 칸 = 타워 둘',     counts.two.length === 2, JSON.stringify(counts.two));
  ok('맨 끝 가운데 줄 = 타워 셋', counts.three.length === 3, JSON.stringify(counts.three));

  // ── 설치 가능한 칸 ────────────────────────────────────────
  const place = JSON.parse(await A.evalJs(`JSON.stringify({
    myGround:  tornadoTileOk(3, 3),
    myTower:   tornadoTileOk(4, 2),
    myKing:    tornadoTileOk(3, 4),
    enemySide: tornadoTileOk(10, 3),
    enemyTower:tornadoTileOk(14, 2),
    river:     tornadoTileOk(7, 3)
  })`));
  ok('내 진영 빈 칸에는 설치 가능', place.myGround === true);
  ok('내 타워 칸에는 설치 불가', place.myTower === false && place.myKing === false);
  ok('상대 진영에는 설치 불가', place.enemySide === false && place.enemyTower === false);

  // ── 조준 표시 ─────────────────────────────────────────────
  const slotOf = async id => A.evalJs(`_deckSlots.findIndex(s => s && s.card && s.card.id === '${id}')`);
  const pick = async id => {
    const i = await slotOf(id);
    if (i < 0) return -1;
    const p = JSON.parse(await A.evalJs(`(() => { const e = document.querySelectorAll('#deck-slots .deck-slot')[${i}].querySelector('.card');
      const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
    await click(A, Math.round(p.x), Math.round(p.y));
    await sleep(250);
    return i;
  };
  // 타일(col,row) 한가운데의 화면 좌표
  const tilePt = async (col, row) => JSON.parse(await A.evalJs(`(() => {
    const m = document.getElementById('tile-map').getBoundingClientRect();
    const s = m.width / MAP_W;
    return JSON.stringify({ x: Math.round(m.left + (${col} * TILE + TILE/2) * s),
                            y: Math.round(m.top  + (${row} * TILE + TILE/2) * s) }); })()`));

  await A.evalJs(`devGiveCard('tornado'); 1`); await sleep(700);
  ok('토네이도를 덱에 받아 집었다', (await pick('tornado')) >= 0);

  // 3열 3행 — 위 타워와 킹 사이. 반지름 103이라 둘 다 닿는다
  let pt = await tilePt(3, 3);
  await mouse(A, 'mouseMoved', pt.x, pt.y, 'none', 0);
  await sleep(200);
  const aim = JSON.parse(await A.evalJs(`JSON.stringify({
    ok: _tileAim.ok, col: _tileAim.col, row: _tileAim.row,
    hits: _tileAim.hits.map(h => h.pos + ':' + h.damage),
    hl: document.querySelectorAll('.tower.drag-over').length,
    ready: document.querySelector('.cast-tile').classList.contains('cast-arc-ready'),
    cell: Math.round(document.querySelector('.cast-tile-cell').getBoundingClientRect().width),
    tile: Math.round(document.querySelector('#tile-grid .tile[data-col="3"][data-row="3"]').getBoundingClientRect().width)
  })`));
  ok('커서가 가리키는 칸에 맞춰 붙는다', aim.col === 3 && aim.row === 3, `(${aim.col},${aim.row})`);
  // 화면 배율이 걸려 있으므로 100px이 아니라 '실제 타일 한 칸'과 같아야 한다
  ok('칸 표시가 타일 한 칸 크기', aim.cell === aim.tile, `표시 ${aim.cell}px, 타일 ${aim.tile}px`);
  ok('3열 3행이면 타워 둘이 닿는다', aim.hits.length === 2 && aim.hl === 2, JSON.stringify(aim.hits));
  ok('타워마다 자기 거리로 피해가 다르다',
     aim.hits.includes('left:28') && aim.hits.includes('king:31'), JSON.stringify(aim.hits));

  // 6열 3행 — 반지름 67이라 하나도 안 닿는다 (타워는 2·4·6행)
  pt = await tilePt(6, 3);
  await mouse(A, 'mouseMoved', pt.x, pt.y, 'none', 0);
  await sleep(200);
  const aim2 = JSON.parse(await A.evalJs(`JSON.stringify({ hits: _tileAim.hits.length, ready: document.querySelector('.cast-tile').classList.contains('cast-arc-ready') })`));
  ok('가까이·타워 줄 사이면 아무것도 안 닿는다', aim2.hits === 0 && aim2.ready === false, JSON.stringify(aim2));

  // 6열 2행 — 위 타워 줄. 하나만 닿는다
  pt = await tilePt(6, 2);
  await mouse(A, 'mouseMoved', pt.x, pt.y, 'none', 0);
  await sleep(200);
  const aim3 = JSON.parse(await A.evalJs(`JSON.stringify(_tileAim.hits.map(h => h.pos + ':' + h.damage))`));
  ok('가까운 칸은 타워 하나만 (최소 피해)', aim3.length === 1 && aim3[0] === 'left:19', JSON.stringify(aim3));

  // 타워 칸 위에서는 못 놓는다
  pt = await tilePt(4, 2);
  await mouse(A, 'mouseMoved', pt.x, pt.y, 'none', 0);
  await sleep(200);
  ok('타워 칸 위에서는 설치 불가 표시',
     (await A.evalJs(`document.querySelector('.cast-tile').classList.contains('cast-circle-bad')`)) === true);

  // ── 설치해서 실제로 맞는지 ────────────────────────────────
  const hp = async p => Number(await A.evalJs(`document.getElementById('hptext-enemy-${p}').textContent`));
  const before = { left: await hp('left'), king: await hp('king') };
  pt = await tilePt(3, 3);
  await mouse(A, 'mouseMoved', pt.x, pt.y, 'none', 0);
  await sleep(150);
  const t0f = Date.now();
  await click(A, pt.x, pt.y);
  await sleep(500);
  ok('토네이도가 설치돼 전진한다', (await A.evalJs(`!!document.querySelector('.cast-fx-tornado')`)));
  ok('아직 피해 없음 (가는 중)', (await hp('left')) === before.left);

  await waitFor(A, `Number(document.getElementById('hptext-enemy-left').textContent) < ${before.left}`, 6000);
  const dt = Date.now() - t0f;
  ok('2.8초쯤 걸려 도착', dt >= 2550 && dt <= 3500, dt + 'ms');
  await sleep(400);
  const aLeft = await hp('left'), aKing = await hp('king');
  ok('위 타워 28 피해', before.left - aLeft === 28, before.left + ' -> ' + aLeft);
  ok('킹 타워 31 피해', before.king - aKing === 31, before.king + ' -> ' + aKing);

  // ── 맨 끝 가운데 줄에 놓으면 타워 셋이 모두 맞는다 ───────
  await A.evalJs(`castResetCooldown(); devGiveCard('tornado'); 1`);
  await sleep(700);
  await pick('tornado');
  const b3 = { left: await hp('left'), king: await hp('king'), right: await hp('right') };
  const pt3 = await tilePt(0, 4);
  await mouse(A, 'mouseMoved', pt3.x, pt3.y, 'none', 0);
  await sleep(200);
  ok('맨 끝 가운데 줄에서 타워 셋이 강조된다',
     (await A.evalJs(`document.querySelectorAll('.tower.drag-over').length`)) === 3);
  await click(A, pt3.x, pt3.y);
  await waitFor(A, `Number(document.getElementById('hptext-enemy-king').textContent) < ${b3.king}`, 6000);
  await sleep(600);
  const a3 = { left: await hp('left'), king: await hp('king'), right: await hp('right') };
  ok('위 타워 37 피해',   b3.left  - a3.left  === 37, b3.left  + ' -> ' + a3.left);
  ok('킹 타워 40 피해',   b3.king  - a3.king  === 40, b3.king  + ' -> ' + a3.king);
  ok('아래 타워 37 피해', b3.right - a3.right === 37, b3.right + ' -> ' + a3.right);

  // ── 바람 스매시: 28 피해 + 상대 에너지 -5 ────────────────
  await A.evalJs(`castResetCooldown(); devGiveCard('wind'); 1`);
  await sleep(700);
  const eBefore = Number(await B.evalJs(`getCurrentEnergy()`));
  // 에너지는 3초마다 +5 회복된다 — 읽는 순간에 이미 돌아와 있을 수 있어 최저값을 지켜본다
  await B.evalJs(`window.__minE = getCurrentEnergy();
    window.__eWatch = setInterval(() => { window.__minE = Math.min(window.__minE, getCurrentEnergy()); }, 25); 1`);
  const wBefore = await hp('right');
  await pick('wind');
  const tw = JSON.parse(await A.evalJs(`(() => { const r = document.querySelector('#tower-enemy-right .tower-block').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }); })()`));
  // 일자 사거리는 커서 오른쪽으로 뻗는다 — 타워 왼쪽에서 겨눈다
  await mouse(A, 'mouseMoved', tw.x - 120, tw.y, 'none', 0);
  await sleep(200);
  ok('일자 사거리 표시가 뜬다', await A.evalJs(`!!document.querySelector('.cast-lunge')`));
  // 아는 칸의 한가운데를 가리키면 그 칸의 논리 좌표에 놓여야 한다.
  // 바닥판은 기울어져 있어서 화면 좌표를 그대로 넣으면 원근이 두 번 먹어 밀린다.
  // tilePt는 '논리 좌표'로 점을 잡는다 — 여기서는 화면에 '그려진' 칸 한가운데를 써야 한다
  const drawn = JSON.parse(await A.evalJs(`(() => {
    const t = document.querySelector('#tile-grid .tile[data-col=\\"5\\"][data-row=\\"6\\"]').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(t.left + t.width / 2), y: Math.round(t.top + t.height / 2) });
  })()`));
  await mouse(A, 'mouseMoved', drawn.x, drawn.y, 'none', 0);
  await sleep(150);
  const anchor = JSON.parse(await A.evalJs(`(() => {
    const el = document.querySelector('.cast-lunge');
    return JSON.stringify({ x: Math.round(parseFloat(el.style.left)), y: Math.round(parseFloat(el.style.top)) });
  })()`));
  ok('그려진 칸 (5,6) 한가운데를 가리키면 맵 좌표 (550,650)에 놓인다',
     Math.abs(anchor.x - 550) <= 3 && Math.abs(anchor.y - 650) <= 3, JSON.stringify(anchor));
  await mouse(A, 'mouseMoved', tw.x - 120, tw.y, 'none', 0);
  await sleep(150);


  // 바닥판(#cast-ground) 안에 들어 있어야 타일과 똑같은 원근을 먹는다.
  // 숫자로 누르는 것이 아니라 진짜 같은 판 위에 있는지를 본다 —
  // 기준은 같은 줄의 타일 한 칸이다 (사거리 200 = 두 칸, 폭 100 = 한 칸).
  const tilt = JSON.parse(await A.evalJs(`(() => {
    const el = document.querySelector('.cast-lunge');
    const r = el.getBoundingClientRect();
    const q = (c, r) => document.querySelector('#tile-grid .tile[data-col=\\"' + c + '\\"][data-row=\\"' + r + '\\"]').getBoundingClientRect();
    const t = q(3, 6);
    // 타일 rect는 1px 테두리를 물고 있다 — 칸 간격(왼쪽 모서리 거리)이 깔끔한 한 칸이다
    const stepX = q(4, 6).left - q(3, 6).left;
    const stepY = q(3, 7).top  - q(3, 6).top;
    return JSON.stringify({
      inGround: el.parentElement === document.getElementById('cast-ground'),
      styleW: parseFloat(el.style.width), styleH: parseFloat(el.style.height),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      tileW: +stepX.toFixed(1), tileH: +stepY.toFixed(1), rawH: +t.height.toFixed(1),
      flatH: +(_castStyle.band * _mapScale()).toFixed(1),
      flatW: +(_castStyle.radius * _mapScale()).toFixed(1)
    });
  })()`));
  ok('사거리 표시가 바닥판 안에 있다', tilt.inGround, JSON.stringify(tilt));
  ok('크기는 맵 좌표 그대로 (200x100)',
     tilt.styleW === 200 && tilt.styleH === 100, tilt.styleW + 'x' + tilt.styleH);
  ok('같은 줄 타일과 똑같은 원근 — 높이 = 칸 하나',
     Math.abs(tilt.h - tilt.tileH) < 2.5, tilt.h + ' vs 칸 ' + tilt.tileH);
  // 가까운 줄(6행)은 원근으로 벌어진다 — 평면으로 그렸을 때보다 넓어야 한다
  ok('가까운 줄이라 평면보다 넓게 벌어졌다',
     tilt.w > tilt.flatW * 1.05, tilt.w + ' vs 평면 ' + tilt.flatW + 'px');
  ok('눌히지 않은 날것(평면)과는 다르다', Math.abs(tilt.h - tilt.flatH) > 3,
     '바닥 ' + tilt.h + ' vs 평면 ' + tilt.flatH);
  await click(A, tw.x - 120, tw.y);
  await waitFor(A, `Number(document.getElementById('hptext-enemy-right').textContent) < ${wBefore}`, 4000);
  await sleep(700);
  const wAfter = await hp('right');

  ok('바람 스매시 24 피해', wBefore - wAfter === 24, wBefore + ' -> ' + wAfter);
  await sleep(1200);
  const eMin = Number(await B.evalJs(`clearInterval(window.__eWatch); window.__minE`));
  ok('상대 에너지 -5 (맞은 쪽이 실제로 쓸 수 있는 에너지가 줄어든다)',
     eBefore - eMin === 5, eBefore + ' -> ' + eMin);

  const shot = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_wind.png', Buffer.from(shot.result.data, 'base64'));

  console.log('');
  console.log(fails === 0 ? '모두 통과' : fails + '개 실패');
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
