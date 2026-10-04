// node --experimental-websocket drive.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

  const CARD = process.env.CARD || 'forest_spirit';
  const FXID = process.env.FXID || 'forest';

  // 내 타워 셋을 모두 깎아 둔다 (회복 여부를 보려면 피해가 있어야 한다)
  const eKing = await box(B, '#tower-enemy-king .tower-block');
  const eLeft = await box(B, '#tower-enemy-left .tower-block');
  const eRight = await box(B, '#tower-enemy-right .tower-block');
  // 돌은 투척 카드다 — 던지고 나서 날아가는 1초와 카드별 잠금(1.85초)을 기다려야
  // 다음 돌을 집을 수 있다. 꾹 누르지 않으므로 0단계(20 피해)로 날아간다.
  for (const t of [eKing, eLeft, eRight]) {
    await B.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.rock }); 1`);
    await sleep(400);
    const c = await box(B, '#deck-slots .deck-slot .card');
    if (!c) break;
    await click(B, c.x, c.y); await sleep(220);
    await click(B, t.x, t.y);
    await waitFor(B, `castCooldownLeft(CARD_DEFINITIONS.rock) === 0`, 5000);
    await sleep(250);
  }
  const hurt = await DBQ(`rooms/${code}/gameState/p1/towers`);
  check('내 타워 3개 모두 피해를 입음',
    ['left', 'king', 'right'].every(p => hurt[p].hp < hurt[p].maxHp),
    JSON.stringify(['left', 'king', 'right'].map(p => `${p}:${hurt[p].hp}`)));

  // 타일 한 칸의 화면 중심 (바닥판이 기울어 있으므로 칸 요소 자체를 잰다)
  const tile = (b, col, row) => box(b, `.tile[data-col="${col}"][data-row="${row}"]`);
  const towerTile = await A.evalJs(`JSON.stringify(['left','king','right'].map(p => {
    const e = document.getElementById('tower-my-' + p);
    return [p, +e.style.getPropertyValue('--col'), +e.style.getPropertyValue('--row')]; }))`).then(JSON.parse);
  console.log('내 타워 칸:', JSON.stringify(towerTile));
  const kingT = towerTile.find(t => t[0] === 'king');
  const leftT = towerTile.find(t => t[0] === 'left');

  const heals = async () => {
    const dots = await DBQ(`rooms/${code}/gameState/dots`);
    return Object.values(dots || {}).filter(d => d.type === 'heal' && d.targetPlayer === 'p1')
      .map(d => d.targetTower).sort();
  };
  const clearDots = () => fetch(`http://127.0.0.1:9000/rooms/${code}/gameState/dots.json?ns=demo-cardecx-default-rtdb`,
    { method: 'PUT', body: 'null', headers: { Authorization: 'Bearer owner' } });

  const pick = async () => {
    // 앞서 설치한 토템(5.4초)이 남아 있으면 헷갈리므로 지운다
    await A.evalJs(`document.querySelectorAll('.cast-fx').forEach(e => e.remove()); 1`);
    await B.evalJs(`document.querySelectorAll('.cast-fx').forEach(e => e.remove()); 1`);
    await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.${CARD} }); 1`);
    await waitFor(A, `!!document.querySelector('#deck-slots .deck-slot .card')`, 8000);
    await sleep(350);
    const c = await box(A, '#deck-slots .deck-slot .card');
    await click(A, c.x, c.y);
    await sleep(200);
  };
  const aimAt = async (x, y) => { await mouse(A, 'mouseMoved', x, y); await sleep(200); };
  const aimState = () => A.evalJs(`(() => {
    const a = document.querySelector('.cast-totemtile');
    const cell = a && a.querySelector('.cast-tile-cell');
    return JSON.stringify({
      has: !!a,
      ready: !!a && a.classList.contains('cast-arc-ready'),
      bad:   !!a && a.classList.contains('cast-circle-bad'),
      hl: [...document.querySelectorAll('.tower.drag-over-heal')].map(e => e.dataset.pos).sort(),
      cell: cell ? [parseFloat(cell.style.left), parseFloat(cell.style.top), parseFloat(cell.style.width)] : null,
      reach: !!(a && a.querySelector('.cast-tile-reach')),
      inGround: !!(a && a.closest('#cast-ground'))
    }); })()`).then(JSON.parse);
  const deckNow = async () => JSON.stringify(await DBQ(`rooms/${code}/gameState/p1/deck`));

  // ── 0) 표시 모양 — 칸 네모 + 범위 원, 둘 다 바닥판 안
  await clearDots();
  await pick();
  const tK = await tile(A, kingT[1] - 1, kingT[2]);      // 킹 타워 바로 왼쪽 칸
  await aimAt(tK.x, tK.y);
  const s0 = await aimState();
  check('범위 표시가 칸 네모 + 원형 범위', s0.has && s0.reach && s0.cell && s0.cell[2] === 100, JSON.stringify(s0));
  check('표시가 바닥판(기울기) 안에 그려짐', s0.inGround === true);
  check('칸 네모가 칸 한가운데에 스냅',
    s0.cell && s0.cell[0] === (kingT[1] - 1) * 100 + 50 && s0.cell[1] === kingT[2] * 100 + 50, JSON.stringify(s0.cell));

  // 칸 안 어디를 가리켜도 같은 칸 — 모서리 쪽으로 옮겨도 네모가 안 움직인다
  await aimAt(tK.x + tK.w * 0.3, tK.y - tK.h * 0.3);
  const s0b = await aimState();
  check('칸 안에서 커서를 움직여도 같은 칸', JSON.stringify(s0b.cell) === JSON.stringify(s0.cell), JSON.stringify(s0b.cell));

  // ── 1) 킹 왼쪽 칸 — 세 타워 모두 범위 안
  await aimAt(tK.x, tK.y);
  const s1 = await aimState();
  check('킹 옆 칸이면 타워 3개가 모두 강조', s1.ready && s1.hl.join(',') === 'king,left,right', JSON.stringify(s1));
  await click(A, tK.x, tK.y);
  await sleep(700);
  check('설치 → 3개 모두 회복', (await heals()).join(',') === 'king,left,right', JSON.stringify(await heals()));

  // 3D 토템이 칸 한가운데에 선다
  const tot = JSON.parse(await A.evalJs(`(() => {
    const t = _t3dTotems[_t3dTotems.length - 1];
    if (!t) return JSON.stringify({ none: true });
    const box = new THREE.Box3().setFromObject(t.group);
    return JSON.stringify({ count: _t3dTotems.length, parts: t.group.children.length,
      height: +(box.max.y - box.min.y).toFixed(1), footY: +box.min.y.toFixed(1) }); })()`));
  check('토템이 3D로 세워졌다', tot.count >= 1 && tot.parts >= 6, JSON.stringify(tot));
  check('발이 바닥에 붙어 있다 (밑면 y≈0)', Math.abs(tot.footY) < 6, JSON.stringify(tot));
  const shotT = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_totem3d.png', Buffer.from(shotT.result.data, 'base64'));

  // ── 2) 위 타워 바로 뒤(왼쪽) 칸 — 위 + 가운데(킹)만 (옆 타워가 킹보다 앞이라 뒤쪽 칸이 둘 다에 닿는다)
  await clearDots();
  await pick();
  const tL = await tile(A, leftT[1] - 1, leftT[2]);
  await aimAt(tL.x, tL.y);
  const s2 = await aimState();
  check('위쪽 칸이면 2개만 강조', s2.hl.join(',') === 'king,left', JSON.stringify(s2));
  await click(A, tL.x, tL.y);
  await sleep(700);
  check('위쪽 칸 설치 → 위·가운데만 회복', (await heals()).join(',') === 'king,left', JSON.stringify(await heals()));

  // ── 3) 타워가 선 칸은 설치 불가
  await clearDots();
  await pick();
  const tTower = await tile(A, kingT[1], kingT[2]);
  await aimAt(tTower.x, tTower.y);
  const s3 = await aimState();
  check('타워 칸은 설치 불가 표시', s3.bad === true && s3.ready === false, JSON.stringify(s3));
  let before = await deckNow();
  await click(A, tTower.x, tTower.y);
  await sleep(500);
  check('타워 칸 클릭은 무시 (카드 유지)', (await aimState()).has && (await deckNow()) === before);

  // ── 4) 타워에서 먼 빈 칸 — 설치되지만 아무도 회복되지 않는다. 연출은 칸 한가운데
  const tE = await tile(A, 7, kingT[2]);
  await aimAt(tE.x + tE.w * 0.3, tE.y + tE.h * 0.25);   // 칸 가장자리 쪽을 눌러도
  const s4 = await aimState();
  check('먼 빈 칸 — 설치 가능, 강조 없음', !s4.bad && !s4.ready && s4.hl.length === 0, JSON.stringify(s4));
  await click(A, tE.x + tE.w * 0.3, tE.y + tE.h * 0.25);
  await sleep(700);
  check('빈 칸에도 설치됨 (카드 소모)', !!(await A.evalJs(`!!document.querySelector('.cast-fx-${FXID}')`)));
  check('빈 칸 설치 → 회복 없음', (await heals()).length === 0, JSON.stringify(await heals()));
  // 장식은 기울어진 바닥 안에 있어서 화면 외곽 상자의 중심은 실제 중심보다 아래로 잡힌다 — 바닥 좌표로 직접 잰다
  const fxAt = b => b.evalJs(`(() => { const i = document.querySelector('.cast-fx-${FXID}'); if (!i) return 'null';
    return JSON.stringify({ x: parseFloat(i.style.left) + CAST_STYLES.${FXID}.fx.hx, y: parseFloat(i.style.top) + CAST_STYLES.${FXID}.fx.hy,
      ground: !!i.closest('#cast-ground') }); })()`).then(JSON.parse);
  const fxPt = await fxAt(A);
  check('장식이 바닥판 안에 놓임', fxPt && fxPt.ground === true, JSON.stringify(fxPt));
  check('연출이 누른 자리가 아니라 칸 한가운데(750,' + (kingT[2] * 100 + 50) + ')에 놓임',
    fxPt && fxPt.x === 750 && fxPt.y === kingT[2] * 100 + 50, JSON.stringify(fxPt));
  const remote = await fxAt(B);
  check('상대 화면에도 같은 칸(좌우 반전, 8열)에',
    remote && remote.x === 850 && remote.y === kingT[2] * 100 + 50, JSON.stringify(remote));

  // ── 5) 상대 진영은 설치 불가
  await clearDots();
  await pick();
  const tX = await tile(A, 10, kingT[2]);
  await aimAt(tX.x, tX.y);
  check('상대 진영은 설치 불가 표시', (await aimState()).bad === true);
  before = await deckNow();
  await click(A, tX.x, tX.y);
  await sleep(500);
  check('상대 진영 클릭은 무시 (카드 유지)', (await aimState()).has && (await deckNow()) === before);

  // ── 6) 게임 필드 밖 검은 여백은 설치 불가 — 맵을 끝까지 줄여 여백을 만든다
  await A.evalJs(`for (let i = 0; i < 12; i++) mapZoomAt(1 / ZOOM_STEP, innerWidth / 2, innerHeight / 2); 1`);
  await sleep(300);
  const edge = await A.evalJs(`(() => {
    const vp = document.getElementById('map-viewport').getBoundingClientRect();
    const t = document.querySelector('.tile[data-col="0"][data-row="0"]').getBoundingClientRect();
    return JSON.stringify({ vpTop: vp.top, tileTop: t.top, x: t.left + t.width / 2 }); })()`).then(JSON.parse);
  const outY = (edge.vpTop + edge.tileTop) / 2;
  check('축소하면 맵 위에 여백이 생긴다', edge.tileTop - edge.vpTop > 20, JSON.stringify(edge));
  await aimAt(edge.x, outY);
  const s6 = await aimState();
  check('필드 밖(검은 여백)은 설치 불가 표시', s6.bad === true, JSON.stringify(s6));
  before = await deckNow();
  await click(A, edge.x, outY);
  await sleep(500);
  check('필드 밖 클릭은 무시 (카드 유지)', (await aimState()).has && (await deckNow()) === before);
  const shotO = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_totem_out.png', Buffer.from(shotO.result.data, 'base64'));

  // 조준 모습 한 장 (정상 칸)
  const tG = await tile(A, kingT[1] + 1, kingT[2] - 1);
  await aimAt(tG.x, tG.y);
  await sleep(200);
  const shotA = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_totem_aim.png', Buffer.from(shotA.result.data, 'base64'));
  await A.evalJs(`cancelStickyDrag(); 1`);

  console.log(fails ? '\n실패 ' + fails : '\n모두 통과');
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
