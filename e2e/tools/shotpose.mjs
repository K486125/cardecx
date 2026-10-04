import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'cdx-pose-'));
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9398', `--user-data-dir=${dir}`,
  '--no-first-run', '--window-size=900,620', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9398/json')).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Page.enable'); await send('Runtime.enable');
const file = process.env.SVG || 'sword.svg';
for (const t of (process.env.TIMES || '100,200,300').split(',')) {
  await send('Page.navigate', { url: `http://127.0.0.1:5055/probe2.html?f=${file}&t=${t}` });
  await sleep(900);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`pose_${file.replace('.svg', '')}_${t}.png`, Buffer.from(r.result.data, 'base64'));
}
console.log('saved');
proc.kill(); process.exit(0);
