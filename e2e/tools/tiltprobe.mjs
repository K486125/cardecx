import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'cdx-tilt-'));
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9397', `--user-data-dir=${dir}`,
  '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:9397/json')).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5055/mapzoom.html' });
for (let i = 0; i < 60; i++) { const r = await send('Runtime.evaluate', { expression: 'window.__ready === 1', returnByValue: true }); if (r.result?.result?.value) break; await sleep(200); }
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split(String.fromCharCode(10))[0]; return r.result?.result?.value; };
console.log(await ev(`getComputedStyle(document.getElementById('tile-map')).getPropertyValue('--field-depth')`));
for (const r of [0,2,4,6,8]) console.log(await ev(`(() => { const q = (c,r) => { const t = document.querySelector('#tile-grid .tile[data-col="'+c+'"][data-row="'+r+'"]').getBoundingClientRect(); return 'row '+r+': w='+t.width.toFixed(1)+' h='+t.height.toFixed(1)+' top='+t.top.toFixed(1); }; return q(0,${r}); })()`));
proc.kill(); process.exit(0);
