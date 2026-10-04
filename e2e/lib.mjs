// e2e 공통 도우미 — 크롬을 띄워 CDP로 조작한다. (touch.mjs · spectate.mjs)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const BASE = 'http://127.0.0.1:5055';
const NS = 'demo-cardecx-default-rtdb';
const t0 = Date.now();
export const ts = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(6);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch(name, port, { quiet = true, fitZoom = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cdx-' + name + '-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); }
  }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map();
  const b = { name, proc, exceptions: [] };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text;
      // 테스트가 DB를 직접 지워서 생기는 권한 오류는 앱 결함이 아니다
      if (!/PERMISSION_DENIED/.test(d)) { b.exceptions.push(d); console.log(`${ts()} [${name}] EXCEPTION: ${d}`); }
    } else if (!quiet && m.method === 'Runtime.consoleAPICalled') {
      console.log(`${ts()} [${name}] console.${m.params.type}: ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Page.javascriptDialogOpening') {
      console.log(`${ts()} [${name}] DIALOG: ${m.params.message}`);
      ws.send(JSON.stringify({ id: 999999, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  // 기존 테스트는 배율 1(타일 100px)을 기준으로 조준 · 크기를 잰다 — 기본 배율(섬 맞춤) 대신 1로 시작한다.
  // 섬 맞춤 기본 배율 자체는 mapzoom.mjs · envshot.mjs(fitZoom)가 본다
  if (!fitZoom) await send('Page.addScriptToEvaluateOnNewDocument', { source:
    "document.addEventListener('DOMContentLoaded', () => { if (typeof mapFitZoom === 'function') window.mapFitZoom = () => 1; });" });
  b.send = send;
  b.evalJs = async (expr, ms = 20000) => {
    const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => null)]);
    if (r?.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n')[0];
    return r ? r.result?.result?.value : 'TIMEOUT';
  };
  b.json = async expr => { const v = await b.evalJs(expr); try { return JSON.parse(v); } catch { return v; } };
  b.goto = url => send('Page.navigate', { url: BASE + url });
  b.shot = async file => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); };
  return b;
}

export async function waitFor(b, expr, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await b.evalJs(expr).catch(() => false);
    if (v === 'TIMEOUT') throw new Error(`[${b.name}] 페이지가 응답하지 않습니다: ${expr}`);
    if (v && !(typeof v === 'string' && v.startsWith('EXC:'))) return true;
    await sleep(150);
  }
  throw new Error(`[${b.name}] timeout: ${expr}`);
}

export const DBQ = p => fetch(`http://127.0.0.1:9000/${p}.json?ns=${NS}`, { headers: { Authorization: 'Bearer owner' } }).then(r => r.json());
export const DBW = (p, method, body) => fetch(`http://127.0.0.1:9000/${p}.json?ns=${NS}`,
  { method, body: JSON.stringify(body), headers: { Authorization: 'Bearer owner' } });
export const resetDB = () => fetch(`http://127.0.0.1:9000/.json?ns=${NS}`, { method: 'PUT', body: 'null', headers: { Authorization: 'Bearer owner' } });

let fails = 0;
export const check = (name, ok, info = '') => { console.log(`${ts()} ${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
export const failCount = () => fails;
export const addFail = () => { fails++; };

export const box = (b, sel) => b.evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null;
  const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }); })()`).then(v => v && JSON.parse(v));
export const mouse = (b, type, x, y, extra = {}) => b.send('Input.dispatchMouseEvent',
  { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1, buttons: 0, ...extra });
export const click = async (b, x, y) => { await mouse(b, 'mouseMoved', x, y); await mouse(b, 'mousePressed', x, y); await mouse(b, 'mouseReleased', x, y); };
export const key = (b, keyName, code, vk) => Promise.all([]).then(async () => {
  await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
});

/** 두 사람이 방을 만들고 들어가 게임을 시작한다 → 방 코드 */
export async function startMatch(A, B, nickA = 'Alice#Dev', nickB = 'Bobby#Dev') {
  for (const [b, nick] of [[A, nickA], [B, nickB]]) {
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
  for (const b of [A, B]) await waitFor(b, `!document.getElementById('screen-game').classList.contains('hidden')`, 25000);
  await waitFor(A, `window.matchInputLocked === false`, 25000);
  await waitFor(B, `window.matchInputLocked === false`, 25000);
  await sleep(800);
  return code;
}

/** 덱에 카드를 넣고 집는다 */
export async function pickCard(b, id) {
  await b.evalJs(`castResetCooldown(); addCardToDeck({ ...CARD_DEFINITIONS.${id} }); 1`);
  await waitFor(b, `_deckSlots.some(s => s && s.card && s.card.id === '${id}')`, 8000);
  await sleep(350);
  const i = await b.evalJs(`_deckSlots.findIndex(s => s && s.card && s.card.id === '${id}')`);
  const c = await box(b, `#deck-slots .deck-slot[data-slot="${i}"] .card`);
  await click(b, c.x, c.y);
  await sleep(220);
}

export const tile = (b, col, row) => box(b, `.tile[data-col="${col}"][data-row="${row}"]`);

/** 바닥 좌표(맵 px) → 그 자리를 가리키는 화면 좌표 (_clientToGround를 거꾸로 찾는다) */
export const groundToClient = (b, gx, gy) => b.json(`(() => {
  const vp = document.getElementById('map-viewport').getBoundingClientRect();
  let best = null, bd = 1e9;
  const test = (x, y) => { const g = _clientToGround(x, y); const d = Math.hypot(g.x - ${gx}, g.y - ${gy}); if (d < bd) { bd = d; best = { x, y }; } };
  for (let y = vp.top; y < vp.bottom; y += 4) for (let x = vp.left; x < vp.right; x += 4) test(x, y);
  for (const s of [1, 0.25]) { const c = best; for (let y = c.y - 4; y <= c.y + 4; y += s) for (let x = c.x - 4; x <= c.x + 4; x += s) test(x, y); }
  return JSON.stringify({ x: best.x, y: best.y, err: +bd.toFixed(2) }); })()`);

/** 연출 이미지의 '맞는 점'과 타워 한가운데의 차이 (화면 px) */
export const fxOffset = (b, fxClass, towerId, castId) => b.json(`(() => {
  const i = document.querySelector('.${fxClass}'); const k = document.querySelector('#${towerId} .tower-block');
  if (!i || !k) return 'null';
  const st = CAST_STYLES['${castId}'].fx;
  const r = i.getBoundingClientRect(), t = k.getBoundingClientRect();
  const hxr = i.style.transform.includes('scaleX(-1)') ? (st.w - st.hx) / st.w : st.hx / st.w;   // 뒤집힌 연출
  return JSON.stringify({ dx: Math.round(r.left + r.width * hxr - (t.left + t.width / 2)),
                          dy: Math.round(r.top + r.height * st.hy / st.h - (t.top + t.height / 2)) }); })()`);
