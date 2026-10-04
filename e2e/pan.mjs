// node --experimental-websocket drive.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5055';
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(6);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(name, port, reuse) {
  let proc = reuse?.proc, page;
  if (!reuse) {
    const dir = mkdtempSync(join(tmpdir(), 'cdx-' + name + '-'));
    proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
      '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
    let targets;
    for (let i = 0; i < 50; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); }
    }
    page = targets.find(t => t.type === 'page');
  } else {
    page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const reqUrls = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      console.log(`${ts()} [${name}] console.${m.params.type}: ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      console.log(`${ts()} [${name}] EXCEPTION: ` + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Network.loadingFailed' && m.params.type === 'Script') {
      console.log(`${ts()} [${name}] SCRIPT LOAD FAIL: ${m.params.errorText} ${reqUrls.get(m.params.requestId) || ''}`);
    } else if (m.method === 'Network.requestWillBeSent') {
      reqUrls.set(m.params.requestId, m.params.request.url.replace(BASE, ''));
    } else if (m.method === 'Page.javascriptDialogOpening') {
      console.log(`${ts()} [${name}] DIALOG: ${m.params.message}`);
      ws.send(JSON.stringify({ id: 999999, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    } else if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) {
      console.log(`${ts()} [${name}] NAV → ${m.params.frame.url.replace(BASE, '')}`);
    }
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.addScriptToEvaluateOnNewDocument', { source: "document.addEventListener('DOMContentLoaded', () => { if (typeof mapFitZoom === 'function') window.mapFitZoom = () => 1; });" }); await send('Network.enable');
  const evalJs = async (expr, ms = 20000) => {
    const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => null)]);
    return r ? r.result?.result?.value : 'TIMEOUT';
  };
  return { name, proc, send, evalJs, goto: url => send('Page.navigate', { url: BASE + url }) };
}

async function waitFor(b, expr, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await b.evalJs(expr).catch(() => false);
    if (v === 'TIMEOUT') throw new Error(`[${b.name}] 페이지가 응답하지 않습니다: ${expr}`);
    if (v) return true;
    await sleep(150);
  }
  console.log('DUMP', await b.evalJs(`[...document.querySelectorAll('[id*=error]')].map(e => e.id + ':' + e.textContent).join(' / ') + ' | btn=' + document.getElementById('btn-confirm-nickname')?.disabled + ' | uid=' + (typeof currentUid === 'function' ? currentUid() : 'x') + ' | boot=' + window.__bootFailed`, 3000));
  throw new Error(`[${b.name}] timeout: ${expr}`);
}

const DBQ = p => fetch(`http://127.0.0.1:9000/${p}.json?ns=demo-cardecx-default-rtdb`, { headers: { Authorization: 'Bearer owner' } }).then(r => r.json());
await fetch('http://127.0.0.1:9000/.json?ns=demo-cardecx-default-rtdb', { method: 'PUT', body: 'null', headers: { Authorization: 'Bearer owner' } });
const A = await launch('A', 9311), B = await launch('B', 9312);
let fails = 0; const check = (name, ok, info = '') => { console.log(`${ts()} ${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
const box = (b, sel) => b.evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }); })()`).then(v => v && JSON.parse(v));
const mouse = async (b, type, x, y) => b.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1, buttons: 0 });
const click = async (b, x, y) => { await mouse(b, 'mouseMoved', x, y); await mouse(b, 'mousePressed', x, y); await mouse(b, 'mouseReleased', x, y); };
try {
  for (const [b, nick] of [[A, 'Alice'], [B, 'Bobby']]) {
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
  await waitFor(B, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`, 15000);
  await waitFor(A, `!document.getElementById('btn-ready').disabled`);
  await sleep(600);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`); await sleep(300);
  await B.evalJs(`document.getElementById('btn-ready').click(); 1`);
  for (const b of [A, B]) await waitFor(b, `!document.getElementById('screen-game').classList.contains('hidden')`, 20000);
  await waitFor(A, `window.matchInputLocked === false`, 20000);
  await sleep(1200);
  const panAt = async () => JSON.parse(await A.evalJs(`(() => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.getElementById('tile-map')).transform);
    return JSON.stringify({ x: Math.round(m.e), y: Math.round(m.f) });
  })()`));
  const panY = async () => (await panAt()).y;
  const panX = async () => (await panAt()).x;
  const wheel = (dy, shift = false) => A.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 300, deltaX: 0, deltaY: dy, modifiers: shift ? 8 : 0 });

  // 타일 맵 크기·기본 위치
  const geo = JSON.parse(await A.evalJs(`(() => {
    const tm = document.getElementById('tile-map'), vp = document.getElementById('map-viewport');
    return JSON.stringify({ mw: tm.offsetWidth, mh: tm.offsetHeight, vw: vp.offsetWidth, vh: vp.offsetHeight,
      tile: getComputedStyle(tm).getPropertyValue('--tile').trim(),
      grid: !!document.querySelector('.tile-grid'), fxInMap: !!document.querySelector('#tile-map > #fx-layer') });
  })()`));
  check('16×9 타일 맵 (한 칸 100px)', geo.mw === 1600 && geo.mh === 900 && geo.tile === '100px' && geo.grid, JSON.stringify(geo));
  check('이펙트 레이어가 맵 안에 있음 (맵과 함께 움직임)', geo.fxInMap === true);

  // 칸마다 면과 테두리가 있는 타일이 깔려 있다
  const tiles = JSON.parse(await A.evalJs(`(() => {
    const all = document.querySelectorAll('#tile-grid .tile');
    const one = all[0] && getComputedStyle(all[0]);
    const t = (c, r) => document.querySelector('#tile-grid .tile[data-col="' + c + '"][data-row="' + r + '"]');
    const zone = (c, r) => { const e = t(c, r); return e ? e.className.replace('tile ', '') : null; };
    const box = (c, r) => { const e = t(c, r); const b = e.getBoundingClientRect(); const s = window.gameStageScale || 1;
      return { w: Math.round(b.width / s), h: Math.round(b.height / s) }; };
    return JSON.stringify({ count: all.length,
      border: one ? one.borderTopWidth + ' ' + one.borderTopStyle : null,
      hasFace: one ? one.backgroundImage !== 'none' : false,
      size: box(0, 0), near: box(0, 8), mine: zone(2, 4), enemy: zone(13, 4), river: zone(7, 4), river2: zone(8, 4),
      clickThrough: getComputedStyle(document.getElementById('tile-grid')).pointerEvents });
  })()`));
  check('타일 144칸이 깔림 (16×9)', tiles.count === 144, JSON.stringify(tiles));
  check('칸마다 면과 테두리가 있음', tiles.hasFace && tiles.border === '1px solid', JSON.stringify(tiles));
  // 바닥판만 원근으로 눕어 있다 — 먼 줄(0행)이 가까운 줄(8행)보다 좁고 낮아야 한다
  check('바닥이 눕어 있다 (먼 줄이 더 좁다)',
    tiles.size.w < tiles.near.w - 5 && tiles.size.h < tiles.near.h - 5,
    `먼 줄 ${tiles.size.w}x${tiles.size.h}, 가까운 줄 ${tiles.near.w}x${tiles.near.h}`);
  check('진영별 타일 색 (내 쪽 / 상대 쪽 / 강)',
    tiles.mine === 'tile-mine' && tiles.enemy === 'tile-enemy' && tiles.river === 'tile-river' && tiles.river2 === 'tile-river', JSON.stringify(tiles));
  check('타일이 클릭을 가로채지 않음', tiles.clickThrough === 'none', JSON.stringify(tiles));
  // 섬(돌벽까지)을 화면 가운데에 둔다 — 이 테스트는 배율 1로 시작한다 (lib 훅)
  const isl = JSON.parse(await A.evalJs(`JSON.stringify({ i: _islandBox(false), h: _islandBox(true) })`));
  check('기본은 섬이 세로 가운데', Math.abs((await panY()) - Math.round(geo.vh / 2 - (isl.i.y0 + isl.i.y1) / 2)) <= 1, `panY=${await panY()}`);

  // 타워가 타일에 딱 맞는다
  const towers = JSON.parse(await A.evalJs(`(() => {
    const s = window.gameStageScale || 1;
    const m = document.getElementById('tile-map').getBoundingClientRect();
    const at = p => { const r = document.querySelector('#tower-' + p + ' .tower-block').getBoundingClientRect();
      return { w: Math.round(r.width / s), h: Math.round(r.height / s),
               x: Math.round((r.left - m.left) / s), y: Math.round((r.top - m.top) / s) }; };
    return JSON.stringify({ ml: at('my-left'), mk: at('my-king'), mr: at('my-right'), ek: at('enemy-king') });
  })()`));
  check('타워 크기가 타일 한 칸 (킹 포함)',
    [towers.ml, towers.mk, towers.mr, towers.ek].every(t => t.w === 100 && t.h === 100), JSON.stringify(towers));
  // 타워는 눕지 않지만 눕힌 타일 한가운데에 얹혀 있어야 한다 (board.js alignTowersToGround)
  const onTile = JSON.parse(await A.evalJs(`(() => {
    const d = p => {
      const el = document.getElementById('tower-' + p);
      const col = Number(el.style.getPropertyValue('--col')), row = Number(el.style.getPropertyValue('--row'));
      const t = document.querySelector('#tile-grid .tile[data-col="' + col + '"][data-row="' + row + '"]').getBoundingClientRect();
      const b = (el.querySelector('.tower-block') || el).getBoundingClientRect();
      return Math.round(Math.hypot((b.left + b.width/2) - (t.left + t.width/2),
                                   (b.top + b.height/2) - (t.top + t.height/2)));
    };
    return JSON.stringify({ ml: d('my-left'), mk: d('my-king'), mr: d('my-right'), ek: d('enemy-king') });
  })()`));
  check('타워가 자기 타일 한가운데에 얹혀 있음',
    Object.values(onTile).every(v => v <= 2), JSON.stringify(onTile));
  check('배치: 옆 타워 (4,2)·(4,6) / 킹 (3,4) — 옆 타워가 킹보다 앞',
    (await A.evalJs(`JSON.stringify(['my-left','my-king','my-right'].map(p => { const e = document.getElementById('tower-' + p);
      return e.style.getPropertyValue('--col').trim() + ',' + e.style.getPropertyValue('--row').trim(); }))`))
      === JSON.stringify(['4,2', '3,4', '4,6']),
    await A.evalJs(`JSON.stringify(['my-left','my-king','my-right'].map(p => { const e = document.getElementById('tower-' + p);
      return e.style.getPropertyValue('--col').trim() + ',' + e.style.getPropertyValue('--row').trim(); }))`));

  // 왼쪽 버튼 드래그 — 위로 끌면 맵이 올라간다
  const drag = async (dx, dy) => {
    await A.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 300, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 5; i++) {
      await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700 + dx * i / 5, y: 300 + dy * i / 5, button: 'left', buttons: 1 });
      await sleep(16);
    }
    await A.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700 + dx, y: 300 + dy, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
  };

  const y0 = await panY();
  await drag(0, -100);
  const y1 = await panY();
  check('왼쪽 드래그로 맵이 움직임', y1 < y0, `${y0} → ${y1}`);

  // 끝까지 끌어도 맵 밖으로 나가지 않는다
  for (let i = 0; i < 6; i++) await drag(0, -300);
  check('아래쪽 한계(선착장 끝)에서 멈춤', Math.abs((await panY()) - Math.round(geo.vh - isl.h.y1)) <= 1, `panY=${await panY()} (한계 ${Math.round(geo.vh - isl.h.y1)})`);
  for (let i = 0; i < 10; i++) await drag(0, 300);
  check('위쪽 한계(먼 돌벽 위)에서 멈춤', Math.abs((await panY()) - Math.round(-isl.h.y0)) <= 1, `panY=${await panY()} (한계 ${Math.round(-isl.h.y0)})`);
  check('세로로만 끌면 가로는 그대로 (섬 가운데)', Math.abs(await panX()) <= 1, `panX=${await panX()}`);

  // 휠은 이제 확대/축소다 (자세한 검사는 mapzoom.mjs)
  const z0 = await A.evalJs('_zoom');
  await wheel(-120); await sleep(80);
  check('휠은 맵을 확대한다 (스크롤이 아니다)', (await A.evalJs('_zoom')) > z0, `zoom ${z0} → ${await A.evalJs('_zoom')}`);
  await A.evalJs('mapZoomReset()');

  // 가운데(휠) 버튼 드래그
  const mid = async (type, x, y) => A.send('Input.dispatchMouseEvent', { type, x, y, button: 'middle', buttons: 4, clickCount: 1 });
  await mid('mousePressed', 700, 300);
  await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 200, button: 'middle', buttons: 4 });
  await sleep(150);
  await mid('mouseReleased', 700, 200);
  const y2 = await panY();
  check('휠 버튼 드래그로 맵이 움직임', y2 < 0, `panY=${y2}`);

  // 맵을 움직인 뒤에도 조준·이펙트가 타워에 맞는다
  await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.wooden_sword }); 1`);
  await waitFor(A, `!!document.querySelector('#deck-slots .deck-slot .card')`, 8000);
  await sleep(400);
  const c = await box(A, '#deck-slots .deck-slot .card');
  const eKing = await box(A, '#tower-enemy-king .tower-block');
  const hp0 = await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`);
  await click(A, c.x, c.y); await sleep(200);
  await click(A, eKing.x - 100, eKing.y);
  await sleep(200);
  // 4단계(2026-09-29) — 범위가 타워에 닿으면 연출은 누른 자리가 아니라 그 타워에 고정된다.
  // 타워 100px 왼쪽을 눌렀어도 베기는 타워 위에 떨어져야 한다
  const fx = JSON.parse(await A.evalJs(`(() => {
    const i = document.querySelector('.cast-fx-sword');
    const k = document.querySelector('#tower-enemy-king .tower-block');
    if (!i || !k) return 'null';
    const f = i.getBoundingClientRect(), t = k.getBoundingClientRect();
    return JSON.stringify({ dx: Math.round(f.left + f.width / 2 - (t.left + t.width / 2)),
                            dy: Math.round(f.top + f.height / 2 - (t.top + t.height / 2)) });
  })()`));
  check('맵을 움직인 뒤에도 연출이 맞은 타워 위에 놓임', fx && Math.abs(fx.dx) <= 6 && Math.abs(fx.dy) <= 6, JSON.stringify(fx));
  await sleep(900);
  const hp1 = await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`);
  check('맵을 움직인 뒤에도 피해가 정상 적용', hp1 === hp0 - 12, `${hp0} → ${hp1}`);

  console.log(fails ? '\n실패 ' + fails : '\n모두 통과');
} catch (e) { console.log('FAIL', e.message); }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
