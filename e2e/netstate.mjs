// 5단계 — 연결이 끊겼을 때의 안내. 실제로 DB 연결을 끊어 보고 화면을 확인한다.
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

const A = await launch('A', 9403);
const level = () => A.evalJs(`document.getElementById('net-state')?.dataset.level || 'none'`);

try {
  await A.goto('/index.html');
  await waitFor(A, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
  await sleep(1200);

  ok('연결이 멀쩡하면 아무것도 안 띄운다', (await level()) === 'none', String(await level()));
  ok('감시가 돌고 있다', (await A.evalJs(`typeof netStateInit === 'function' && _netStarted === true`)) === true);

  // ── 연결을 끊는다 ─────────────────────────────────────────
  await A.evalJs(`db.goOffline(); 1`);
  console.log(`${ts()} DB 연결을 끊었다`);

  await sleep(1500);
  ok('끊긴 직후에는 아직 조용하다 (1.5초)', (await level()) === 'none', String(await level()));

  await waitFor(A, `document.getElementById('net-state')?.dataset.level === 'warn'`, 6000);
  ok('3초쯤 지나면 재연결 안내 띠가 뜬다', (await level()) === 'warn');
  const barText = await A.evalJs(`document.querySelector('.net-state-bar')?.textContent.trim()`);
  ok('띠에 재연결 문구가 있다', /연결/.test(String(barText)), String(barText));
  ok('띠는 조작을 막지 않는다',
     (await A.evalJs(`getComputedStyle(document.getElementById('net-state')).pointerEvents`)) === 'none');

  // ── 오래 끊기면 전체 화면 안내 ────────────────────────────
  console.log(`${ts()} 15초 경과를 기다리는 중`);
  await waitFor(A, `document.getElementById('net-state')?.dataset.level === 'lost'`, 20000);
  const lost = JSON.parse(await A.evalJs(`(() => {
    const b = document.getElementById('net-state');
    return JSON.stringify({
      title: b.querySelector('h2')?.textContent,
      retry: !!b.querySelector('#net-state-retry'),
      blocks: getComputedStyle(b).pointerEvents === 'auto',
      covers: b.getBoundingClientRect().width >= innerWidth - 2
    }); })()`));
  ok('오래 끊기면 전체 화면 안내로 바뀐다', /인터넷 연결/.test(String(lost.title)), JSON.stringify(lost));
  ok('다시 시도 버튼이 있다', lost.retry === true);
  ok('화면을 덮고 조작을 받는다', lost.blocks && lost.covers, JSON.stringify(lost));

  const shot = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_netlost.png', Buffer.from(shot.result.data, 'base64'));

  // ── 다시 이으면 안내가 걷힌다 ─────────────────────────────
  await A.evalJs(`db.goOnline(); 1`);
  console.log(`${ts()} DB 연결을 다시 이었다`);
  await waitFor(A, `document.getElementById('net-state')?.dataset.level === 'back'`, 12000);
  ok('연결이 돌아오면 복구 안내로 바뀐다', (await level()) === 'back');
  await waitFor(A, `!document.getElementById('net-state')`, 8000);
  ok('잠시 뒤 안내가 완전히 사라진다', (await level()) === 'none');

  console.log('');
  console.log(fails === 0 ? '모두 통과' : fails + '개 실패');
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); process.exit(fails ? 1 : 0); }
