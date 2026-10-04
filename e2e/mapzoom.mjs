// node --experimental-websocket mapzoom.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5055';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'cdx-mz-'));
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9331', `--user-data-dir=${dir}`,
  '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:9331/json')).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') console.log('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

const mouse = (type, x, y, button = 'left', buttons = 1) =>
  send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const wheel = (x, y, dy) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, button: 'none', buttons: 0 });

let fails = 0;
const ok = (name, cond, info = '') => { console.log((cond ? '  OK   ' : '  실패 ') + name + (info ? '  ' + info : '')); if (!cond) fails++; };

try {
  await send('Page.navigate', { url: BASE + '/mapzoom.html' });
  for (let i = 0; i < 60 && !(await ev('window.__ready === 1')); i++) await sleep(150);
  ok('페이지 준비', await ev('window.__ready === 1'));

  const vp = JSON.parse(await ev(`(() => { const r = document.getElementById('map-viewport').getBoundingClientRect();
    return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height }); })()`));
  const cx = Math.round(vp.x + vp.w / 2), cy = Math.round(vp.y + vp.h / 2);

  console.log('\n[1] 기본 상태 — 섬(돌벽까지)이 화면에 다 들어오는 배율');
  const FIT = await ev('mapFitZoom()');
  ok('기본 배율 = 섬 맞춤', Math.abs(await ev('_zoom') - FIT) < 1e-6 && FIT < 1, 'zoom=' + await ev('_zoom') + ' fit=' + FIT);
  const fitIn = JSON.parse(await ev(`(() => { const b = _islandBox(false), v = document.getElementById('map-viewport');
    return JSON.stringify({ l: _panX + b.x0 * _zoom, r: _panX + b.x1 * _zoom, t: _panY + b.y0 * _zoom, b: _panY + b.y1 * _zoom, w: v.offsetWidth, h: v.offsetHeight }); })()`));
  ok('섬 전체가 화면 안', fitIn.l >= -1 && fitIn.t >= -1 && fitIn.r <= fitIn.w + 1 && fitIn.b <= fitIn.h + 1, JSON.stringify(fitIn));

  console.log('\n[2] 왼쪽 버튼 드래그로 맵 이동');
  const y0 = await ev('_panY');
  await mouse('mousePressed', cx, cy);
  for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', cx, cy - i * 20); await sleep(16); }
  await mouse('mouseReleased', cx, cy - 120);
  const y1 = await ev('_panY');
  ok('왼쪽 드래그로 세로 이동', Math.abs(y1 - y0) > 50, `panY ${Math.round(y0)} → ${Math.round(y1)}`);
  ok('드래그 직후 클릭은 카드 놓기로 안 침', await ev('_panJustDragged()') === true);
  await sleep(300);
  ok('0.3초 뒤에는 다시 클릭 가능', await ev('_panJustDragged()') === false);

  console.log('\n[3] 살짝 눌렀다 뗀 것은 드래그가 아님 — 카드 놓기 클릭이 살아 있다');
  await mouse('mousePressed', cx, cy);
  await mouse('mouseMoved', cx + 3, cy + 2);
  await mouse('mouseReleased', cx + 3, cy + 2);
  ok('3px 이동은 클릭으로 취급', await ev('_panJustDragged()') === false);

  console.log('\n[4] 휠로 확대/축소');
  const z0 = await ev('_zoom');
  await wheel(cx, cy, -120); await sleep(50);
  const zIn = await ev('_zoom');
  ok('휠 위 → 확대', zIn > z0, `${z0} → ${zIn}`);
  await wheel(cx, cy, 120); await sleep(50);
  ok('휠 아래 → 원래대로', Math.abs(await ev('_zoom') - z0) < 1e-6, 'zoom=' + await ev('_zoom'));

  for (let i = 0; i < 20; i++) await wheel(cx, cy, -120);
  await sleep(80);
  ok('최대 배율에서 멈춤', await ev('_zoom') === 2, 'zoom=' + await ev('_zoom'));
  for (let i = 0; i < 40; i++) await wheel(cx, cy, 120);
  await sleep(80);
  ok('최소 배율에서 멈춤', await ev('_zoom') === 0.3, 'zoom=' + await ev('_zoom'));

  console.log('\n[5] 축소하면 맵이 화면 가운데에 온다 (빈틈 한쪽 쏠림 없음)');
  const g = JSON.parse(await ev(`(() => { const m = document.getElementById('tile-map').getBoundingClientRect();
      const v = document.getElementById('map-viewport').getBoundingClientRect();
      return JSON.stringify({ left: m.left - v.left, right: v.right - m.right }); })()`));
  ok('좌우 여백이 같다', Math.abs(g.left - g.right) < 2, `left=${Math.round(g.left)} right=${Math.round(g.right)}`);

  console.log('\n[5-1] 기본보다 더 줄이면 끌어서 하늘·바다를 볼 여백이 생긴다');
  await ev('mapZoomReset()');
  await ev('mapPanBy(9999, 0)');
  const rx = await ev(`_panX + _islandBox(true).x1 * _zoom - document.getElementById('map-viewport').offsetWidth`);
  ok('기본 배율 — 옆으로 끌어도 섬은 화면 안에 머문다', Math.abs(rx) < 1.5, 'r=' + rx);
  await ev('mapZoomReset()');
  await ev(`mapZoomAt(${FIT * 0.6} / _zoom, ${cx}, ${cy})`);
  const c0 = await ev('_panY'); await ev('mapPanBy(0, 9999)');
  const down = (await ev('_panY')) - c0;
  ok('줄이면 아래로 끌어 하늘을 본다', down > 60, 'down=' + Math.round(down));
  await ev('mapZoomReset()');
  /*
  // 기본 배율에서는 위로 더 끌어도 0에서 멈춘다 — 축소했을 때만 여백이 붙는다
  await ev('mapZoomReset(); mapPanBy(0, 9999)');
  const padAt1 = await ev('_panY');
  await ev(`mapZoomReset(); mapZoomAt(0.75, ${cx}, ${cy}); mapPanBy(0, 9999)`);
  const padAtMin = await ev('_panY');
  ok('기본 배율(1)에서는 여백 없음', Math.abs(padAt1) < 0.5, 'panY=' + padAt1);
  ok('축소하면 위쪽 여백이 생긴다', padAtMin > 40 && padAtMin < 120, 'panY=' + Math.round(padAtMin));
  await ev('mapPanBy(0, -99999)');
  const vpH = await ev('document.getElementById(\"map-viewport\").offsetHeight');
  const botGap = (await ev('_panY + 900 * _zoom')) - vpH;
  ok('아래쪽에도 같은 여백', Math.abs(botGap + padAtMin) < 1.5, '아래 ' + Math.round(-botGap) + 'px');
  */

  console.log('\n[6] 확대해도 좌표 변환이 어긋나지 않는다 (타워 중심 맵 좌표 고정)');
  await ev('mapZoomReset()');
  const base = await ev(`JSON.stringify(['my-left','my-king','my-right','enemy-king'].map(p => _towerCenterStage(document.getElementById('tower-' + p))))`);
  let allSame = true, detail = '';
  for (const z of [0.5, 1.3, 2.0]) {
    await ev(`mapZoomReset(); mapZoomAt(${z}, ${cx}, ${cy})`);
    const now = await ev(`JSON.stringify(['my-left','my-king','my-right','enemy-king'].map(p => _towerCenterStage(document.getElementById('tower-' + p))))`);
    const a = JSON.parse(base), b = JSON.parse(now);
    const diff = Math.max(...a.map((p, i) => Math.max(Math.abs(p.x - b[i].x), Math.abs(p.y - b[i].y))));
    if (diff > 1.5) { allSame = false; detail += ` z=${z} diff=${diff.toFixed(2)}`; }
  }
  ok('모든 배율에서 타워 맵 좌표가 같다', allSame, detail);

  console.log('\n[7] 커서 자리를 붙잡고 확대한다');
  await ev('mapZoomReset()');
  const px = cx + 200, py = cy - 80;
  const before = JSON.parse(await ev(`JSON.stringify(_clientToStage(${px}, ${py}))`));
  await ev(`mapZoomAt(1.1, ${px}, ${py})`);
  const after = JSON.parse(await ev(`JSON.stringify(_clientToStage(${px}, ${py}))`));
  ok('커서 아래 지점이 그대로', Math.hypot(before.x - after.x, before.y - after.y) < 2,
     `(${before.x.toFixed(0)},${before.y.toFixed(0)}) → (${after.x.toFixed(0)},${after.y.toFixed(0)})`);

  console.log('\n[8] 크게 확대해도 끌어서 섬 끝(돌벽 · 선착장)까지 다 본다');
  await ev(`mapZoomReset(); mapZoomAt(2 / _zoom, ${cx}, ${cy}); mapPanBy(99999, 99999)`);
  const tl = JSON.parse(await ev(`JSON.stringify({ l: _panX + _islandBox(true).x0 * _zoom, t: _panY + _islandBox(true).y0 * _zoom })`));
  ok('왼쪽/위 끝 — 섬 가장자리가 화면 끝에 닿는다', Math.abs(tl.l) < 1.5 && Math.abs(tl.t) < 1.5, JSON.stringify(tl));
  await ev(`mapPanBy(-99999, -99999)`);
  const br = JSON.parse(await ev(`(() => { const v = document.getElementById('map-viewport'), b = _islandBox(true);
      return JSON.stringify({ r: _panX + b.x1 * _zoom - v.offsetWidth, b: _panY + b.y1 * _zoom - v.offsetHeight }); })()`));
  ok('오른쪽/아래 끝 — 섬 가장자리가 화면 끝에 닿는다', Math.abs(br.r) < 1.5 && Math.abs(br.b) < 1.5, JSON.stringify(br));

  console.log('\n[9] Ctrl+휠은 맵 배율을 건드리지 않는다 (화면 전체 배율용)');
  await ev('mapZoomReset()');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -120, button: 'none', buttons: 0, modifiers: 2 });
  await sleep(60);
  ok('Ctrl+휠에 맵 배율 그대로', await ev('_zoom') === FIT, 'zoom=' + await ev('_zoom'));

  console.log('\n[10] 키보드 +/-/0');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '=', code: 'Equal', text: '=', windowsVirtualKeyCode: 187 });
  await sleep(60);
  ok('= 로 확대', await ev('_zoom') > FIT, 'zoom=' + await ev('_zoom'));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '0', code: 'Digit0', text: '0', windowsVirtualKeyCode: 48 });
  await sleep(60);
  ok('0 으로 기본 크기', await ev('_zoom') === FIT, 'zoom=' + await ev('_zoom'));

  console.log('');
  console.log('[11] 사거리 표시가 맵 배율을 따라간다');
  await ev(`mapZoomReset()`);
  // 목검(부채꼴 — 반지름은 CAST_STYLES.sword.radius, 지금 100)을 들고 있는 상태를 흉내낸다
  await ev(`_castStyle = CAST_STYLES.sword;
    _castArc = document.createElement('div'); _castArc.className = 'cast-arc';
    _castGround().appendChild(_castArc); _applyCastArcSize(); _moveCastArc(0, 0); 1`);
  // 표시는 맵 좌표(지름 = 반지름 × 2)로 고정 — 화면에서 커지는 것은 부모(타일 맵)가 한다
  const wStyle = await ev(`parseFloat(_castArc.style.width)`);
  const wWant  = await ev(`CAST_STYLES.sword.radius * 2`);
  const w1 = await ev(`_castArc.getBoundingClientRect().width`);
  await ev(`mapZoomAt(2, ${cx}, ${cy})`);
  const w2 = await ev(`_castArc.getBoundingClientRect().width`);
  ok('사거리 크기는 맵 좌표(반지름 × 2) 고정', Math.abs(wStyle - wWant) < 1, 'w=' + wStyle + ' / ' + wWant);
  ok('배율 2 → 화면에서 두 배로 보인다',
     Math.abs(w2 / w1 - 2) < 0.02, Math.round(w1) + 'px → ' + Math.round(w2) + 'px');
  await ev(`_castArc.remove(); _castArc = null; _castStyle = null; mapZoomReset(); 1`);

  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_mapzoom_1x.png', Buffer.from(r.result.data, 'base64'));
  await ev(`mapZoomAt(2, ${cx}, ${cy})`);
  const r2 = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_mapzoom_2x.png', Buffer.from(r2.result.data, 'base64'));

  console.log(fails === 0 ? '\n모두 통과' : `\n${fails}개 실패`);
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { proc.kill(); process.exit(fails ? 1 : 0); }
