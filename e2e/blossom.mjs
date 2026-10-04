// node --experimental-websocket stone.mjs
// 돌(rock) 투척 — 차징 단계별 피해와 비행 시간, 궤적·게이지 표시, 상대 화면 동기화
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
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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

const A = await launch('A', 9395), B = await launch('B', 9396);
const mouse = (b, type, x, y, button = 'left', buttons = 1) =>
  b.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const click = async (b, x, y) => { await mouse(b, 'mouseMoved', x, y, 'none', 0); await mouse(b, 'mousePressed', x, y); await mouse(b, 'mouseReleased', x, y); };

try {
  for (const [b, nick] of [[A, 'Alice#Dev'], [B, 'Bobby#Dev']]) {
    await b.goto('/index.html');
    await waitFor(b, `typeof confirmNickname === 'function' && document.readyState === 'complete'`);
    await sleep(800);
    await b.evalJs(`document.getElementById('input-nickname').value='${nick}'; document.getElementById('btn-confirm-nickname').click(); 1`);
  }
  await waitFor(A, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await sleep(500);
  await A.evalJs(`document.getElementById('btn-create-room').click(); 1`);
  await waitFor(A, `location.pathname.endsWith('game.html') && document.getElementById('display-room-code')?.textContent.length===6`);
  const code = await A.evalJs(`new URLSearchParams(location.search).get('room')`);
  await waitFor(B, `!document.getElementById('screen-room').classList.contains('hidden')`);
  await B.evalJs(`document.getElementById('input-room-code').value='${code}'; document.getElementById('btn-join-room').click(); 1`);
  await waitFor(B, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`);
  await waitFor(A, `!document.getElementById('btn-ready').disabled`);
  await sleep(600);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`); await sleep(300);
  await B.evalJs(`document.getElementById('btn-ready').click(); 1`);
  for (const b of [A, B]) await waitFor(b, `!document.getElementById('screen-game').classList.contains('hidden')`, 25000);
  await waitFor(A, `window.matchInputLocked === false`, 25000);
  await sleep(900);



  // ── 도우미 ────────────────────────────────────────────────
  const slotOf = async (b, id) => b.evalJs(`_deckSlots.findIndex(s => s && s.card && s.card.id === '${id}')`);
  const pick = async (b, id) => {
    const i = await slotOf(b, id);
    if (i < 0) return -1;
    const p = JSON.parse(await b.evalJs(`(() => { const e = document.querySelectorAll('#deck-slots .deck-slot')[${i}].querySelector('.card');
      const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
    await click(b, Math.round(p.x), Math.round(p.y));
    await sleep(250);
    return i;
  };
  // 화면에 '그려진' 칸 한가운데 — 바닥이 눕어 있어 논리 좌표와 15px쯤 다르다
  const drawnTile = async (col, row) => JSON.parse(await A.evalJs(`(() => {
    const t = document.querySelector('#tile-grid .tile[data-col="${col}"][data-row="${row}"]').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(t.left + t.width/2), y: Math.round(t.top + t.height/2),
                            w: +t.width.toFixed(1), h: +t.height.toFixed(1) }); })()`));
  const myHp = async p => Number(await A.evalJs(`document.getElementById('hptext-my-${p}').textContent`));
  const cell = async () => JSON.parse(await A.evalJs(`(() => {
    const c = document.querySelector('.cast-towertile .cast-tile-cell');
    const a = document.querySelector('.cast-towertile');
    if (!c) return 'null';
    const r = c.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      ready: a.classList.contains('cast-arc-ready'), bad: a.classList.contains('cast-circle-bad'),
      inGround: c.parentElement.parentElement === document.getElementById('cast-ground') }); })()`));

  // ── 내 타워를 먼저 깎아 둔다 (B가 화살로 친다) ─────────────
  const aKing = JSON.parse(await B.evalJs(`(() => { const r = document.querySelector('#tower-enemy-king .tower-block').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }); })()`));
  for (let i = 0; i < 3; i++) {
    await B.evalJs(`castResetCooldown(); devGiveCard('arrow'); 1`);
    await sleep(500);
    if ((await pick(B, 'arrow')) < 0) break;
    await click(B, aKing.x, aKing.y);
    await sleep(500);
  }
  await sleep(1800);   // 늦게 도착하는 화살까지 다 들어오게 둔다
  const hurt = await myHp('king');
  ok('내 킹 타워가 깎였다', hurt < 1500, 'hp=' + hurt);

  // ── 벚꽃을 집으면 칸 네모가 뜬다 ───────────────────────────
  await A.evalJs(`castResetCooldown(); devGiveCard('cherry_blossom'); 1`);
  await sleep(600);
  ok('벚꽃을 덱에 받아 집었다', (await pick(A, 'cherry_blossom')) >= 0);

  const empty = await drawnTile(4, 3);
  await mouse(A, 'mouseMoved', empty.x, empty.y, 'none', 0);
  await sleep(200);
  const c1 = await cell();
  ok('칸 한 칸짜리 네모 표시가 뜬다', c1 !== 'null' && c1.inGround, JSON.stringify(c1));
  ok('네모가 그 칸에 딱 맞는다 (기울기까지)',
     Math.abs(c1.w - empty.w) < 2.5 && Math.abs(c1.h - empty.h) < 2.5,
     `표시 ${c1.w}x${c1.h}, 타일 ${empty.w}x${empty.h}`);
  ok('네모가 그 칸 한가운데에 놓인다',
     Math.abs(c1.x - empty.x) <= 2 && Math.abs(c1.y - empty.y) <= 2,
     `표시 ${c1.x},${c1.y} / 타일 ${empty.x},${empty.y}`);
  ok('빈 칸은 설치 불가 표시', c1.ready === false && c1.bad === true);

  await click(A, empty.x, empty.y);
  await sleep(250);
  ok('빈 칸을 눌러도 카드는 그대로 들고 있다', (await A.evalJs(`boardIsHoldingCard()`)) === true);
  ok('빈 칸 클릭으로는 카드가 소모되지 않음', (await slotOf(A, 'cherry_blossom')) >= 0);

  // ── 상대 타워 칸도 불가 (회복 카드) ────────────────────────
  const foe = await drawnTile(14, 4);
  await mouse(A, 'mouseMoved', foe.x, foe.y, 'none', 0);
  await sleep(200);
  const c2 = await cell();
  ok('상대 타워 칸에는 못 놓는다', c2.ready === false && c2.bad === true, JSON.stringify(c2));
  await click(A, foe.x, foe.y);
  await sleep(250);
  ok('상대 타워 칸 클릭도 무시', (await slotOf(A, 'cherry_blossom')) >= 0);

  // ── 내 타워 칸이면 놓인다 ──────────────────────────────────
  const mine = await drawnTile(3, 4);
  await mouse(A, 'mouseMoved', mine.x, mine.y, 'none', 0);
  await sleep(200);
  const c3 = await cell();
  ok('내 타워 칸은 설치 가능 표시', c3.ready === true && c3.bad === false, JSON.stringify(c3));
  const hl = JSON.parse(await A.evalJs(`JSON.stringify([...document.querySelectorAll('.tower.drag-over-heal')].map(e => e.id))`));
  ok('그 타워가 회복 색으로 강조된다', hl.length === 1 && hl[0] === 'tower-my-king', JSON.stringify(hl));
  // 회복 카드라 칸 네모도 초록이어야 한다 (토네이도의 금색과 구분)
  const tone = await A.evalJs(`getComputedStyle(document.querySelector('.cast-towertile .cast-tile-cell')).borderColor`);
  const rgb = String(tone).match(/[0-9]+/g).map(Number);
  ok('칸 네모가 초록 계열', rgb[1] > rgb[0] + 30 && rgb[1] > rgb[2] + 20, tone);
  const shot = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_blossom.png', Buffer.from(shot.result.data, 'base64'));

  const before = await myHp('king');
  await click(A, mine.x, mine.y);
  await sleep(300);
  ok('카드가 소모된다', (await slotOf(A, 'cherry_blossom')) === -1);
  // 상대 화면을 바로 살핀다 (연출은 1.8초라 늦게 물어보면 이미 끝난다)
  let rseen = null;
  for (let i = 0; i < 20; i++) {
    rseen = await B.evalJs(`JSON.stringify({ n: (typeof _t3dBlooms !== 'undefined') ? _t3dBlooms.length : 'undef',
      img: !!document.querySelector('.cast-fx'), t3d: (typeof _t3dTowers !== 'undefined') ? _t3dTowers.length : 'undef' })`);
    if (/"n":[1-9]/.test(String(rseen)) || /"img":true/.test(String(rseen))) break;
    await sleep(100);
  }
  ok('상대 화면에서도 같은 연출이 돈다', /"n":[1-9]/.test(String(rseen)), String(rseen));

  // ── 2단계: 꽃잎이 입체로 타워를 감는다 ────────────────────
  const bloom = async () => JSON.parse(await A.evalJs(`(() => {
    const b = _t3dBlooms[0];
    if (!b) return JSON.stringify({ none: true });
    const t = _t3dTowers.find(x => x.el.id === 'tower-my-king');
    const ys = b.petals.filter(p => p.visible).map(p => p.position.y);
    const rs = b.petals.filter(p => p.visible).map(p => Math.hypot(p.position.x, p.position.z));
    return JSON.stringify({
      count:   _t3dBlooms.length,
      petals:  b.petals.length,
      rings:   b.rings.length,
      inMain:  b.group.parent === _t3dScene,       // 타워와 같은 씬 = 건물 뒤로 돌면 가려진다
      onTile:  Math.hypot(b.group.position.x - t.group.position.x,
                          b.group.position.z - t.group.position.z).toFixed(1),
      scale:   +b.group.scale.x.toFixed(3),
      towerScale: +t.group.scale.x.toFixed(3),
      towerH:  t.group.userData.height,
      visible: ys.length,
      maxY:    ys.length ? +Math.max(...ys).toFixed(1) : 0,
      minY:    ys.length ? +Math.min(...ys).toFixed(1) : 0,
      maxR:    rs.length ? +Math.max(...rs).toFixed(1) : 0,
      op:      +Math.max(...b.petals.map(p => p.material.opacity)).toFixed(2),
      ringOp:  +Math.max(...b.rings.map(r => r.material.opacity)).toFixed(2)
    }); })()`));

  await sleep(120);
  const b1 = await bloom();
  ok('꽃잎이 입체로 올라온다', b1.count === 1 && b1.petals >= 20 && b1.rings === 2, JSON.stringify(b1));
  ok('타워와 같은 씬 — 건물 뒤로 돌면 가려진다', b1.inMain === true);
  ok('그 타워가 선 칸에 붙는다', Number(b1.onTile) < 1, 'dist=' + b1.onTile);
  ok('그 줄의 원근 배율을 그대로 쓴다', b1.scale === b1.towerScale, `${b1.scale} vs 타워 ${b1.towerScale}`);
  const shotB1 = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_blossom_120.png', Buffer.from(shotB1.result.data, 'base64'));

  await sleep(400);
  const b2 = await bloom();
  ok('꽃잎이 타워 둘레를 돈다 (반지름이 몸통 근처)', b2.maxR > 20 && b2.maxR < 120, 'maxR=' + b2.maxR);
  ok('꽃잎이 타워 높이만큼 올라간다', b2.maxY > 20, `maxY=${b2.maxY} / 타워 ${b2.towerH}`);
  ok('바닥 빛 고리도 같이 퍼진다', b2.ringOp > 0.05, 'ringOp=' + b2.ringOp);
  const shotB2 = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_blossom_520.png', Buffer.from(shotB2.result.data, 'base64'));

  await sleep(250);
  const b3 = await bloom();
  // 1.8초짜리 연출이라 이 시점(약 1초)엔 아직 떠 있고 슬슬 옅어지는 중이어야 한다
  ok('중반에도 꽃잎이 떠 있다', b3.count === 1 && b3.visible > 10, JSON.stringify(b3));
  ok('처음보다 높이 올라와 있다', b3.maxY > b1.maxY * 1.5, `${b1.maxY} -> ${b3.maxY}`);
  ok('타워 꼭대기 언저리까지 오른다', b3.maxY > b3.towerH * 0.6, `${b3.maxY} / 타워 ${b3.towerH}`);
  const shotB3 = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_blossom_1020.png', Buffer.from(shotB3.result.data, 'base64'));

  ok('평면 그림(SVG)은 쓰지 않는다', (await A.evalJs(`!!document.querySelector('.cast-fx')`)) === false);

  // 끝나면 씬에서 깨끗이 빠진다
  await sleep(1200);
  ok('연출이 끝나면 씬에서 사라진다', (await A.evalJs(`_t3dBlooms.length`)) === 0);
  ok('타워는 그대로 남아 있다', (await A.evalJs(`_t3dTowers.length`)) === 6);

  // 회복은 1초마다 한 틱씩 들어온다 — 한 번 읽지 말고 최고값을 지켜본다
  let peak = before;
  for (let i = 0; i < 24; i++) { await sleep(250); peak = Math.max(peak, await myHp('king')); }
  ok('그 타워가 실제로 회복된다', peak > before, before + ' -> 최고 ' + peak);

  console.log('');
  console.log(fails === 0 ? '모두 통과' : fails + '개 실패');
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
