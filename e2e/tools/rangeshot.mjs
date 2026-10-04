// 사거리 표시가 눕힌 바닥과 어울리는지 눈으로 보려고 찍는다.
// mapzoom.html(타일 맵 + board.js) 위에서 표시만 직접 만들어 올린다 — 에뮬레이터 불필요.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), 'cdx-rng-'));
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9415', `--user-data-dir=${dir}`,
  '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:9415/json')).json(); break; } catch { await sleep(200); } }
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

// board.js의 표시 만들기를 그대로 흉내 낸다 (카드를 들 수 없는 페이지라서)
await ev(`window.__show = (styleId, mapX, mapY) => {
  _castStyle = CAST_STYLES[styleId];
  const a = document.createElement('div');
  if (_castStyle.shape === 'lunge') {
    a.className = 'cast-lunge';
    a.innerHTML = '<span class="cast-lunge-path"></span><span class="cast-lunge-x"></span>';
  } else if (_castStyle.shape === 'circle') {
    a.className = 'cast-circle';
  } else {
    a.className = 'cast-arc';
    a.style.setProperty('--arc-from', (90 - _castStyle.arcDeg / 2) + 'deg');
    a.style.setProperty('--arc-deg',  _castStyle.arcDeg + 'deg');
  }
  _castArc = a;
  _castGround().appendChild(a);
  _applyCastArcSize();
  const m = document.getElementById('tile-map').getBoundingClientRect();
  const s = _mapScale();
  _moveCastArc(m.left + mapX * s, m.top + mapY * s);
  a.style.animation = 'none';   // 숨쉬기 애니메이션은 사진마다 밝기가 달라져서 끈다
  a.classList.add('cast-arc-ready');
  _castArc = null;              // 다음 호출이 지우지 못하게 떼어 둔다
  return 1;
};
window.__clear = () => { _castGround().innerHTML = ''; return 1; }; 1`);

const shoot = async name => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(name, Buffer.from(s.result.data, 'base64'));
};

// 위(2행) · 가운데(4행) · 아래(6행) 세 줄 — 줄마다 어떻게 눕는지 비교
await ev(`__clear(); [[350,250],[350,450],[350,650]].forEach(([x,y]) => __show('forest', x, y)); 1`);
await shoot('range_circles.png');

await ev(`__clear(); [[300,250],[300,450],[300,650]].forEach(([x,y]) => __show('dualsword', x, y)); 1`);
await shoot('range_lunge.png');

await ev(`__clear(); [[300,250],[300,450],[300,650]].forEach(([x,y]) => __show('sword', x, y)); 1`);
await shoot('range_fan.png');

proc.kill();
console.log('range_circles.png / range_lunge.png / range_fan.png 저장');
process.exit(0);
