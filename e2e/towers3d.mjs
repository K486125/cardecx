// 타워 3D — 건물이 실제로 그려지는지, 발이 타일 한가운데에 딱 붙는지 본다.
// 에뮬레이터 없이 mapzoom.html(타일 맵 + board.js만) 위에서 돈다.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  OK  ' : '  실패'} ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) bad++;
};

const dir = mkdtempSync(join(tmpdir(), 'cdx-t3d-'));
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9411', `--user-data-dir=${dir}`,
  '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:9411/json')).json(); break; } catch { await sleep(200); } }
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
// 이 검사는 배율 1(타일 100px) 기준으로 잰다 — 기본 배율(섬 맞춤) 대신 1로
await ev('_zoom = 1; mapCenterView(); towers3dLayout(); 1');
await sleep(900);   // 첫 프레임이 그려질 때까지

ok('three.js가 올라왔다', (await ev('typeof THREE')) === 'object', await ev('THREE && THREE.REVISION'));
ok('3D 캔버스가 생겼다', (await ev(`!!document.getElementById('tower3d')`)) === true);
ok('body.t3d (CSS 타워는 물러난다)', (await ev(`document.body.classList.contains('t3d')`)) === true);
ok('타워 6채가 모두 씬에 있다', (await ev(`_t3dTowers.length`)) === 6);

// ── 발이 타일 한가운데에 붙는가 ────────────────────────────
// towers3d가 계산한 자리(t3dGroundProject)와 브라우저가 실제로 그린 타일의
// 한가운데가 같아야 한다. 어긋나면 건물이 칸에서 떠 보인다.
const off = JSON.parse(await ev(`(() => {
  const map = document.getElementById('tile-map').getBoundingClientRect();
  const out = {};
  _t3dTowers.forEach(t => {
    const col = Number(t.el.style.getPropertyValue('--col'));
    const row = Number(t.el.style.getPropertyValue('--row'));
    const tile = document.querySelector('#tile-grid .tile[data-col="'+col+'"][data-row="'+row+'"]').getBoundingClientRect();
    const real = { x: tile.left + tile.width/2 - map.left, y: tile.top + tile.height/2 - map.top };
    const mine = t3dGroundProject(col*100+50, row*100+50);
    out[t.el.id] = +Math.hypot(real.x - mine.x, real.y - mine.y).toFixed(2);
  });
  return JSON.stringify(out);
})()`));
// 남는 1px 미만은 타일 div들이 3D로 래스터될 때 생기는 반올림이다 (눈에 안 보인다)
ok('건물 자리 = 타일 한가운데 (오차 1.5px 이내)',
   Object.values(off).every(v => v <= 1.5), JSON.stringify(off));

// 먼 줄은 타일이 작으니 건물도 작아야 한다
const sc = JSON.parse(await ev(`JSON.stringify(_t3dTowers.map(t => [t.el.id, +t.group.userData.scale.toFixed(3)]))`));
const byId = Object.fromEntries(sc);
ok('먼 줄(2행)이 가까운 줄(6행)보다 작다',
   byId['tower-my-left'] < byId['tower-my-right'], JSON.stringify(sc));

// 체력 숫자가 건물 벽 위쪽에 얹혀 있는가 (칸 바닥이 아니라)
const hp = JSON.parse(await ev(`(() => {
  const out = {};
  _t3dTowers.forEach(t => {
    const up = parseFloat(getComputedStyle(t.el).getPropertyValue('--hp-up'));
    const roof = t.group.userData.hud * t.group.userData.scale * Math.cos(30 * Math.PI / 180);
    out[t.el.id] = { up: +up.toFixed(1), roof: +roof.toFixed(1) };
  });
  return JSON.stringify(out);
})()`));
ok('체력 숫자가 벽 위쪽에 있고 톱니는 안 가린다',
   Object.values(hp).every(v => v.up > v.roof * 0.45 && v.up + 26 < v.roof + 8),
   JSON.stringify(hp));

// 기본 화면(섬 맞춤 배율)에서 지붕이 잘리지 않아야 한다 — 2행 타워가 늘 위험하다
await ev('mapZoomReset(); 1');
const clip = JSON.parse(await ev(`(() => {
  const z = _zoom;
  const vp = document.getElementById('map-viewport').getBoundingClientRect();
  const map = document.getElementById('tile-map').getBoundingClientRect();
  const out = {};
  _t3dTowers.forEach(t => {
    const col = Number(t.el.style.getPropertyValue('--col'));
    const row = Number(t.el.style.getPropertyValue('--row'));
    const p = t3dGroundProject(col*100+50, row*100+50);
    const h = t.group.userData.height * t.group.userData.scale * Math.cos(30 * Math.PI / 180);
    out[t.el.id] = +((map.top + (p.y - h) * z) - vp.top).toFixed(1);   // 지붕 꼭대기가 화면 위에서 얼마나 아래인가
  });
  return JSON.stringify(out);
})()`));
ok('어떤 건물도 화면 위로 잘리지 않는다', Object.values(clip).every(v => v > 0), JSON.stringify(clip));

// 캔버스에 뭔가 그려졌는지 (전부 투명하면 WebGL이 죽은 것)
const painted = await ev(`(() => {
  // WebGL 캔버스는 rAF가 끝나면 버퍼가 비므로 바로 앞에서 다시 그린다
  _t3dRenderer.render(_t3dScene, _t3dCamera);
  const c = document.getElementById('tower3d');
  const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
  g.getContext('2d').drawImage(c, 0, 0);
  const d = g.getContext('2d').getImageData(0, 0, g.width, g.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4000) if (d[i] > 10) n++;
  return n;
})()`);
ok('캔버스에 건물이 실제로 그려졌다', typeof painted === 'number' && painted > 50, '불투명 표본 ' + painted);

// ── 판정이 건물 전체를 덮는가 ──────────────────────────────
// 보이는 3D 건물을 누르면 그 타워가 잡혀야 한다. 예전에는 칸(100px) 위로 솟은
// 부분이 대충 잡혀서 지붕 근처를 눌러도 빗나갔다.
const pick = JSON.parse(await ev(`(() => {
  const out = {};
  _t3dTowers.forEach(t => {
    const b = t.el.querySelector('.tower-block').getBoundingClientRect();
    const body = t.el.querySelector('.tower-body').getBoundingClientRect();
    // 이 시험 페이지는 진짜 게임보다 맵 칸이 짧아 2행 건물 꼭대기가 화면 밖일 수 있다.
    // 여기서 보려는 건 '보이는 곳을 누르면 잡히나'이므로 화면 안으로 당겨서 본다.
    const vp = document.getElementById('map-viewport').getBoundingClientRect();
    const hit = y => {
      const e = document.elementFromPoint(body.left + body.width / 2, Math.max(y, vp.top + 3));
      return e && e.closest('.tower') ? e.closest('.tower').id : (e ? (e.id || e.className || e.tagName) : 'null');
    };
    out[t.el.id] = {
      roof: hit(body.top + 6),                       // 지붕 바로 아래
      wall: hit(body.top + body.height * 0.45),      // 벽 한가운데
      foot: hit(b.top + b.height / 2 - 4),           // 발치
      w: Math.round(body.width), h: Math.round(body.height)
    };
  });
  return JSON.stringify(out);
})()`));
ok('건물 어디를 눌러도 그 타워가 잡힌다',
   Object.entries(pick).every(([id, v]) => v.roof === id && v.wall === id && v.foot === id),
   JSON.stringify(pick));

// ── 조준하면 입체물에 테두리가 둘린다 ──────────────────────
const hl = JSON.parse(await ev(`(() => {
  const t = _t3dTowers.find(x => x.el.id === 'tower-enemy-king');
  const before = t.outline.visible;
  t.el.classList.add('drag-over');
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
    r(JSON.stringify({ before, after: t.outline.visible,
      parts: t.outline.children.length,
      color: '#' + t.group.userData.outlineMat.color.getHexString(),
      css: getComputedStyle(t.el.querySelector('.tower-body')).outlineStyle }));
  })));
})()`));
ok('평소에는 테두리가 꺼져 있다', hl.before === false);
ok('조준하면 건물 상자마다 테두리가 켜진다', hl.after === true && hl.parts > 20, JSON.stringify(hl));
ok('네모난 CSS 아웃라인은 쓰지 않는다', hl.css === 'none', hl.css);

// 힐 카드면 초록
const hlh = await ev(`(() => {
  const t = _t3dTowers.find(x => x.el.id === 'tower-my-king');
  t.el.classList.add('drag-over-heal');
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() =>
    r('#' + t.group.userData.outlineMat.color.getHexString()))));
})()`);
ok('회복 카드는 초록 테두리', hlh === '#5fe06a', hlh);

// 눈으로 볼 스크린샷
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('towers3d.png', Buffer.from(shot.result.data, 'base64'));
console.log('  towers3d.png 저장');

proc.kill();
console.log(bad ? `\n${bad}개 실패` : '\n모두 통과');
process.exit(bad ? 1 : 0);
