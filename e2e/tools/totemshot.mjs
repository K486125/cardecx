// 토템 입체 모형을 눈으로 보려고 빈 땅에 몇 개 세워 찍는다 (에뮬레이터 불필요).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'cdx-tot-'));
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9417', `--user-data-dir=${dir}`,
  '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:9417/json')).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') console.log('  EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (mm, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: mm, params: p })); });
await send('Page.enable'); await send('Runtime.enable');
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
};

await send('Page.navigate', { url: 'http://127.0.0.1:5055/mapzoom.html' });
for (let i = 0; i < 80; i++) { if (await ev('window.__ready === 1')) break; await sleep(200); }
await sleep(700);

console.log('세운 개수:', await ev(`(() => {
  [[500, 250, 'forest'], [500, 450, 'whiteblossom'], [500, 650, 'forest'],
   [900, 350, 'whiteblossom'], [900, 550, 'forest']].forEach(([x, y, k]) =>
    towers3dSpawnTotem(x, y, k, 60000));
  return _t3dTotems.length; })()`));

await sleep(900);   // 자라나는 연출이 끝난 뒤
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('shot_totem_model.png', Buffer.from(shot.result.data, 'base64'));
proc.kill();
console.log('shot_totem_model.png 저장');
process.exit(0);
