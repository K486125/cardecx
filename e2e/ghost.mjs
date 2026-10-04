// 4단계 — 유령 방: 심장박동(seenAt)이 끊긴 자리는 목록에서도 사라지고 서버에서도 지워진다.
// 두 자리 모두 connected=true 인 채 굳어 버린 방 — 예전 규칙은 이 방의 삭제를 거부했다.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
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

const A = await launch('A', 9401);

try {
  await A.goto('/index.html');
  await waitFor(A, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(800);
  await A.evalJs(`document.getElementById('input-nickname').value='Ghosty'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await sleep(600);

  // ── 방에 앉아 있는 동안 심장박동이 찍히는가 ───────────────
  await A.evalJs(`document.getElementById('btn-create-room').click(); 1`);
  await waitFor(A, `location.pathname.endsWith('game.html') && document.getElementById('display-room-code')?.textContent.length===6`);
  const mine = await A.evalJs(`new URLSearchParams(location.search).get('room')`);
  await sleep(1500);
  const beat1 = Number(await A.evalJs(`(async () => (await db.ref('rooms/${mine}/players/p1/seenAt').get()).val())()`));
  ok('방에 앉으면 심장박동이 찍힌다', beat1 > 0, 'seenAt=' + beat1);

  // 로비로 돌아간다 — isDeadRoom·청소기는 lobby.js(index.html)에만 있다
  await A.evalJs(`leaveRoom('${mine}', 'p1'); 1`);
  await waitFor(A, `location.pathname.endsWith('index.html')`, 15000);
  await waitFor(A, `typeof isDeadRoom === 'function'`, 10000);
  // 로비 목록·청소기는 닉네임을 넣어야 돌기 시작한다 — 다시 들어간다
  await sleep(600);
  await A.evalJs(`document.getElementById('input-nickname').value='Sweeper'; document.getElementById('btn-confirm-nickname').click(); 1`);
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`, 15000);
  await waitFor(A, `!!_roomListRef`, 10000);
  await sleep(1200);

  // ── 유령 방을 하나 만든다 ─────────────────────────────────
  // 두 자리 모두 connected=true 인데 심장박동만 5분 전.
  // 방 생성 규칙이 '혼자 있는 방'만 허용해서 두 번에 나눠 만든다.
  const made = await A.evalJs(`(async () => { try {
    await db.ref('rooms/GHOST1').remove();
    const old = Date.now() - 300000;
    await db.ref('rooms/GHOST1').set({
      createdAt: Date.now() - 600000,
      creatorName: '유령',
      status: 'waiting',
      playerCount: 1,
      players: { p1: { name: '유령', uid: currentUid(), ready: false, connected: true, seenAt: old } }
    });
    await db.ref('rooms/GHOST1').update({
      'players/p2': { name: '유령둘', uid: currentUid(), ready: false, connected: true, seenAt: old },
      playerCount: 2
    });
    return 'ok';
  } catch (e) { return 'ERR: ' + e.message; } })()`);
  ok('유령 방을 만들었다', made === 'ok', String(made));

  const dead = await A.evalJs(`(async () => {
    const r = (await db.ref('rooms/GHOST1').get()).val();
    return isDeadRoom(r); })()`);
  ok('심장박동이 끊긴 방은 죽은 방 (connected=true 여도)', dead === true, String(dead));

  const live = await A.evalJs(`isDeadRoom({
    createdAt: Date.now(),
    players: { p1: { name: 'A', uid: 'u', connected: true, seenAt: Date.now() } } })`);
  ok('심장박동이 도는 방은 살아 있는 방', live === false, String(live));

  await sleep(1500);
  const shown = await A.evalJs(`(() => {
    const el = document.getElementById('room-list');
    return el ? (el.innerHTML.includes('GHOST1') || el.innerHTML.includes('유령')) : 'no-list'; })()`);
  ok('방 목록에 유령 방이 안 보인다', shown === false, String(shown));

  // ── 청소기가 서버에서도 지운다 ────────────────────────────
  console.log(`${ts()} 청소기를 기다리는 중 (최대 30초)`);
  let gone = false;
  for (let i = 0; i < 60; i++) {
    gone = (await A.evalJs(`(async () => !(await db.ref('rooms/GHOST1').get()).exists())()`)) === true;
    if (gone) break;
    await sleep(500);
  }
  if (!gone) {
    const why = await A.evalJs(`(async () => { try { await db.ref('rooms/GHOST1').remove(); return 'removed'; }
      catch (e) { return 'ERR: ' + e.message; } })()`);
    console.log(`${ts()}    → 직접 삭제해 보면: ${why}`);
  }
  ok('유령 방이 서버에서도 지워진다', gone);

  console.log('');
  console.log(fails === 0 ? '모두 통과' : fails + '개 실패');
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); process.exit(fails ? 1 : 0); }
