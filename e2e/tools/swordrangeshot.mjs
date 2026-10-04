// node --experimental-websocket drive.mjs
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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

  // 숲의정령: 사거리(원형) + 설치 연출 촬영
  const eKing = await box(A, '#tower-enemy-king .tower-block');
  await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.wooden_sword }); 1`);
  await waitFor(A, `!!document.querySelector('#deck-slots .deck-slot .card')`, 8000);
  await sleep(400);
  const cb = await box(A, '#deck-slots .deck-slot .card');
  await click(A, cb.x, cb.y);
  await sleep(200);
  await mouse(A, 'mouseMoved', eKing.x - 110, eKing.y);
  await sleep(350);
  const r0 = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_swordrange_range.png', Buffer.from(r0.result.data, 'base64'));
  await A.evalJs(`cancelStickyDrag(); 1`);
  await sleep(200);

  for (const [name, at] of [['a_300', 300], ['b_900', 900], ['c_2400', 2400]]) {
    await A.evalJs(`document.querySelectorAll('.cast-fx').forEach(e => e.remove()); 1`);
    await sleep(140);
    await A.evalJs(`playCastFx('sword', 'my', 'king'); 1`);
    await sleep(at);
    const r = await A.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, eKing.x - 420), y: Math.max(0, eKing.y - 400), width: 840, height: 800, scale: 1 } });
    writeFileSync(`shot_swordrange_${name}.png`, Buffer.from(r.result.data, 'base64'));
  }
  console.log('촬영 완료');
} catch (e) { console.log('FAIL', e.message); }
finally { A.proc.kill(); B.proc.kill(); process.exit(0); }
