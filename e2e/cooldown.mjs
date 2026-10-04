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
  const key = async (b, k, code, vk) => { for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code, text: type === 'keyDown' ? k : undefined, windowsVirtualKeyCode: vk }); };
  const notice = () => A.evalJs(`(() => {
    const el = document.getElementById('center-notice');
    if (!el) return JSON.stringify({ exists: false });
    const a = el.getAnimations()[0];
    return JSON.stringify({ exists: true, show: el.classList.contains('show'), text: el.textContent,
      t: a ? Math.round(a.currentTime) : null,
      stroke: getComputedStyle(el).webkitTextStrokeWidth, color: getComputedStyle(el).color,
      shadow: getComputedStyle(el).textShadow.length > 0 });
  })()`).then(JSON.parse);
  // 카드를 들고 있는지는 board.js에 직접 묻는다 — 카드마다 붙는 모양(카드 복제본 ·
  // 부채꼴 · 원 · 투척 궤적)이 달라서 DOM으로 찾으면 카드를 바꿀 때마다 깨진다
  const held = () => A.evalJs(`boardIsHoldingCard()`);

  // 듀얼 검 3장 + 목검 1장. 듀얼 검 연출은 1.4초라 그동안 '듀얼 검만' 잠긴다.
  // 확인할 게 많아 한 번의 잠금 안에 다 넣으면 빠듯하므로, 잠금을 두 번 만들어 나눠 본다.
  await A.evalJs(`for (let i = 0; i < 3; i++) addCardToDeck({ ...CARD_DEFINITIONS.dual_sword });
                  addCardToDeck({ ...CARD_DEFINITIONS.wooden_sword }); 1`);
  await waitFor(A, `!!document.querySelector('#deck-slots .deck-slot .card')`, 8000);
  await sleep(500);
  const king = await box(A, '#tower-enemy-king .tower-block');
  const deck0 = await DBQ(`rooms/${code}/gameState/p1/deck`);
  const dualSlot  = deck0.findIndex(d => d?.cardId === 'dual_sword');
  const swordSlot = deck0.findIndex(d => d?.cardId === 'wooden_sword');
  const slotBox = i => box(A, `#deck-slots .deck-slot[data-slot="${i}"] .card`);
  const lockLeft = id => A.evalJs(`Math.round(castCooldownLeft(CARD_DEFINITIONS.${id}))`);
  const useDual = async () => {
    const c = await slotBox(dualSlot);
    await click(A, c.x, c.y); await sleep(160);
    await click(A, king.x - 150, king.y);
  };

  // ── 1차 잠금: 다른 카드는 그대로 쓸 수 있다 ──────────────
  await useDual();
  await sleep(120);
  check('연출 재생 중', await A.evalJs(`!!document.querySelector('.cast-fx-dualsword')`));

  const sCard = await slotBox(swordSlot);
  await click(A, sCard.x, sCard.y);
  await sleep(120);
  const left1 = await lockLeft('dual_sword');
  check('다른 카드(목검)는 연출 중에도 잡힌다', (await held()) === true);
  check('그 순간 듀얼 검은 아직 잠겨 있었다', left1 > 300, `듀얼 검 남은 잠금 ${left1}ms`);
  await click(A, king.x - 100, king.y);
  await sleep(150);
  check('잠긴 카드가 있어도 다른 카드 연출은 재생된다', await A.evalJs(`!!document.querySelector('.cast-fx-sword')`));
  await sleep(800);   // 듀얼 검(0.5초)과 목검(0.3초) 피해가 둘 다 들어갈 때까지
  const dmg1 = await DBQ(`rooms/${code}/gameState/p2/towers/king/dmgTaken`);
  check('두 카드의 피해가 모두 적용 (듀얼 30 + 목검 12)', dmg1 === 42, `누적 피해=${dmg1}`);

  // ── 2차 잠금: 같은 카드는 막히고 알림이 뜬다 ─────────────
  await waitFor(A, `castCooldownLeft(CARD_DEFINITIONS.dual_sword) === 0`, 4000);
  await A.evalJs(`window.__nCalls = 0; const _o = window.showCenterNotice;
    window.showCenterNotice = (...a) => { window.__nCalls++; return _o(...a); }; 1`);
  await useDual();
  await sleep(120);

  const dCard = await slotBox(dualSlot);
  await click(A, dCard.x, dCard.y);
  await sleep(120);
  const n1 = await notice();
  check('같은 카드는 연출 중에 잡히지 않음', (await held()) === false);
  check('가운데 알림이 뜸', n1.exists && n1.show && n1.text === '공격이 끝난 후 재사용 가능합니다', JSON.stringify(n1));
  check('흰 글자 · 검은 테두리 · 그림자', /^6/.test(n1.stroke) && /255, 255, 255/.test(n1.color) && n1.shadow, JSON.stringify(n1));

  // 연타하면 알림이 처음부터 다시
  await sleep(240);
  const nMid = await notice();
  const dCard2 = await slotBox(dualSlot);
  await click(A, dCard2.x, dCard2.y);
  await sleep(120);
  const n2 = await notice();
  const calls = await A.evalJs(`window.__nCalls`);
  check('연타하면 알림이 처음부터 다시 재생', calls === 2 && n2.t !== null && nMid.t !== null && n2.t < nMid.t,
    `연타 전 ${nMid.t}ms → 연타 후 ${n2.t}ms · 알림 호출=${calls}`);

  // 단축키도 막힌다
  await key(A, 'q', 'KeyQ', 81);
  await sleep(120);
  const left2 = await lockLeft('dual_sword');
  check('같은 카드는 단축키(Q)도 막힘', (await held()) === false);
  check('여기까지 잠금이 유지됐다', left2 > 0, `남은 잠금 ${left2}ms`);

  // ── 잠금이 풀리면 같은 카드도 다시 쓸 수 있다 ────────────
  await waitFor(A, `castCooldownLeft(CARD_DEFINITIONS.dual_sword) === 0`, 4000);
  const dCard3 = await slotBox(dualSlot);
  await click(A, dCard3.x, dCard3.y);
  await sleep(180);
  check('연출이 끝나면 같은 카드도 다시 고를 수 있음', (await held()) === true);
  await click(A, king.x - 150, king.y);
  await sleep(1700);
  const dmg = await DBQ(`rooms/${code}/gameState/p2/towers/king/dmgTaken`);
  check('막힌 동안의 클릭은 피해로 이어지지 않음 (듀얼 30×3 + 목검 12)', dmg === 102, `누적 피해=${dmg}`);
  await sleep(600);

  // 설치형 회복(연출 5.4초)은 잠그지 않는다
  await sleep(900);
  await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.forest_spirit }); addCardToDeck({ ...CARD_DEFINITIONS.rock }); 1`);
  await sleep(600);
  const fSlot = (await DBQ(`rooms/${code}/gameState/p1/deck`)).findIndex(d => d?.cardId === 'forest_spirit');
  const fCard = await box(A, `#deck-slots .deck-slot[data-slot="${fSlot}"] .card`);
  // 토템은 타워가 선 칸에는 못 놓는다 (2026-09-28) — 킹 타워 바로 왼쪽 빈 칸에 놓는다
  const spot = await box(A, '.tile[data-col="2"][data-row="4"]');
  await click(A, fCard.x, fCard.y); await sleep(200);
  await click(A, spot.x, spot.y);
  await sleep(300);
  check('설치 연출 재생 중', await A.evalJs(`!!document.querySelector('.cast-fx-forest')`));
  const rSlot = (await DBQ(`rooms/${code}/gameState/p1/deck`)).findIndex(d => d?.cardId === 'rock');
  const rCard = await box(A, `#deck-slots .deck-slot[data-slot="${rSlot}"] .card`);
  await click(A, rCard.x, rCard.y);
  await sleep(200);
  check('회복 토템은 다른 카드를 막지 않음', (await held()) === true);
  await A.evalJs(`cancelStickyDrag(); 1`);

  console.log(fails ? '\n실패 ' + fails : '\n모두 통과');
} catch (e) { console.log('FAIL', e.message); }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
