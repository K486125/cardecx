import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5055';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'cdx-hp-'));
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9321', `--user-data-dir=${dir}`,
  '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:9321/json')).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: BASE + '/hppreview.html' });
await sleep(3500);
console.log('ERRCHK', (await send('Runtime.evaluate', { expression: '1+1', returnByValue: true })).result?.result?.value);
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value; };
// 방 접속 없이 게임 화면만 띄워서 체력 숫자 모양만 본다
console.log('URL', await ev('location.pathname + location.search'));
console.log('IDS', await ev("[...document.querySelectorAll('[id^=screen-]')].map(e=>e.id).join(',')"));
console.log(await ev(`(() => {
  return [...document.querySelectorAll('.tower-hp')].map(e => {
    const r = e.getBoundingClientRect(); const t = e.closest('.tower').getBoundingClientRect();
    return e.id + '=' + e.textContent + ' w' + Math.round(r.width) + ' h' + Math.round(r.height) +
           ' bottomGap=' + Math.round(t.bottom - r.bottom) + ' overflowX=' + (r.width > t.width ? 'YES' : 'no');
  }).join(String.fromCharCode(10));
})()`));
const r = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('shot_hp.png', Buffer.from(r.result.data, 'base64'));
console.log('촬영 완료');
proc.kill(); process.exit(0);
