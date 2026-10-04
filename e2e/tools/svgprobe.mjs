import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'cdx-svg-'));
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9399', `--user-data-dir=${dir}`,
  '--no-first-run', '--window-size=700,500', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9399/json')).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
const file = process.env.SVG || 'sword.svg';
const at = +(process.env.AT || 200);
// SVG를 <img>로 띄워 게임과 같은 조건으로 본다 (흰 배경 대신 어두운 배경)
await send('Page.navigate', { url: 'http://127.0.0.1:5055/probe.html?f=' + file });
await sleep(at + 400);
const r = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(process.env.OUT || 'shot_probe.png', Buffer.from(r.result.data, 'base64'));
console.log('saved');
proc.kill(); process.exit(0);
