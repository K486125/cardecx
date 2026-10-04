// node --experimental-websocket hpzoom.mjs
// 이번에 바꾼 세 가지를 실제 대전에서 확인한다.
//   1) 타워 체력이 숫자 하나로만 표시된다 (바 없음, 깎이면 줄어든다)
//   2) 내가 넣은 피해는 흰색, 내가 맞은 피해는 기존 색
//   3) 왼쪽 버튼 드래그로 맵이 움직이고, 휠로 확대해도 카드 조준이 그대로 맞는다
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
const ok = (name, cond, info = '') => { console.log(`${ts()} ` + (cond ? 'PASS ' : '실패 ') + name + (info ? '  ' + info : '')); if (!cond) fails++; };

const A = await launch('A', 9341), B = await launch('B', 9342);
const mouse = (b, type, x, y, button = 'left', buttons = 1) =>
  b.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const click = async (b, x, y) => { await mouse(b, 'mouseMoved', x, y, 'none', 0); await mouse(b, 'mousePressed', x, y); await mouse(b, 'mouseReleased', x, y); };
const wheel = (b, x, y, dy) => b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, button: 'none', buttons: 0 });

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

  // ── 1. 체력 표시 ──────────────────────────────────────────
  const hp = JSON.parse(await A.evalJs(`(() => {
    const ids = ['my-left','my-king','my-right','enemy-left','enemy-king','enemy-right'];
    return JSON.stringify({
      bars:  document.querySelectorAll('.hp-bar, .hp-bar-wrap, .tower-billboard').length,
      nums:  ids.map(i => document.getElementById('hptext-' + i)?.textContent),
      style: (() => { const e = document.getElementById('hptext-my-king'); const c = getComputedStyle(e);
                      return { size: c.fontSize, weight: c.fontWeight, color: c.color, stroke: c.webkitTextStrokeWidth }; })()
    });
  })()`));
  ok('체력 바가 남아 있지 않다', hp.bars === 0, `바 요소 ${hp.bars}개`);
  ok('체력이 숫자 하나로만 표시', hp.nums.every(n => /^\d+$/.test(n)), hp.nums.join(' / '));
  ok('킹 1500 · 옆 타워 300', hp.nums[1] === '1500' && hp.nums[0] === '300');
  ok('카드 개수 표시와 같은 스타일', hp.style.weight === '900' && hp.style.color === 'rgb(255, 255, 255)' && parseFloat(hp.style.stroke) >= 3,
     JSON.stringify(hp.style));

  // ── 2. 맵 이동 · 확대 (실제 대전 중) ──────────────────────
  const vp = JSON.parse(await A.evalJs(`(() => { const r = document.getElementById('map-viewport').getBoundingClientRect();
    return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height }); })()`));
  const mcx = Math.round(vp.x + vp.w / 2), mcy = Math.round(vp.y + vp.h / 2);

  const panBefore = await A.evalJs('_panY');
  await mouse(A, 'mousePressed', mcx, mcy);
  for (let i = 1; i <= 6; i++) { await mouse(A, 'mouseMoved', mcx, mcy - i * 18); await sleep(16); }
  await mouse(A, 'mouseReleased', mcx, mcy - 108);
  ok('대전 중에도 왼쪽 드래그로 맵 이동', Math.abs(await A.evalJs('_panY') - panBefore) > 50,
     `panY ${Math.round(panBefore)} → ${Math.round(await A.evalJs('_panY'))}`);
  await A.evalJs('mapCenterView()');

  await wheel(A, mcx, mcy, -120); await sleep(60);
  ok('대전 중에도 휠로 확대', await A.evalJs('_zoom') > 1, 'zoom=' + await A.evalJs('_zoom'));

  // ── 3. 확대한 채로 카드를 써서 조준이 맞는지 ──────────────
  // 개발자 도구로 듀얼 검을 받아 확대 상태에서 적 왼쪽 타워를 친다
  await A.evalJs(`devGiveCard('dual_sword'); 1`);
  await sleep(700);
  const slot = await A.evalJs(`_deckSlots.findIndex(s => s && s.card && s.card.id === 'dual_sword')`);
  ok('듀얼 검을 덱에 받음', slot >= 0, 'slot=' + slot);

  const hpBefore = Number(await A.evalJs(`document.getElementById('hptext-enemy-left').textContent`));
  const slotBox = JSON.parse(await A.evalJs(`(() => { const e = document.querySelectorAll('#deck-slots .deck-slot')[${slot}].querySelector('.card');
    const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
  await click(A, Math.round(slotBox.x), Math.round(slotBox.y));
  await sleep(250);

  // 확대된 화면에서 적 왼쪽 타워의 화면 좌표를 다시 잰다
  const tgt = JSON.parse(await A.evalJs(`(() => { const r = document.querySelector('#tower-enemy-left .tower-block').getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
  // 돌진은 커서 오른쪽으로 뻗으므로 타워 왼쪽에서 겨눈다
  const aimX = Math.round(tgt.x - 120), aimY = Math.round(tgt.y);
  await mouse(A, 'mouseMoved', aimX, aimY, 'none', 0);
  await sleep(120);
  ok('확대 상태에서도 사거리 안에 타워가 잡힌다', await A.evalJs(`!!_castTargetsInRange(${aimX}, ${aimY})[0]`));
  await click(A, aimX, aimY);
  await sleep(2200);

  const hpAfter = Number(await A.evalJs(`document.getElementById('hptext-enemy-left').textContent`));
  ok('확대 상태에서 쓴 카드의 피해가 들어감', hpBefore - hpAfter === 30, `${hpBefore} → ${hpAfter} (${hpBefore - hpAfter})`);
  ok('체력 숫자가 실제로 줄어든다', hpAfter < hpBefore && /^\d+$/.test(String(hpAfter)), 'hp=' + hpAfter);

  // ── 4. 피해 숫자 색 ───────────────────────────────────────
  await A.evalJs('mapZoomReset()');
  const colors = JSON.parse(await A.evalJs(`(() => {
    const res = {};
    // 조금 전 실제 공격의 숫자가 아직 떠 있을 수 있다 — 지우고 시작한다
    document.querySelectorAll('.floating-number').forEach(n => n.remove());
    // 내가 적 타워에 넣는 피해
    showTowerHit('enemy', 'king', 44, 'damage');
    showTowerHit('enemy', 'right', 12, 'dot');
    // 내가 맞는 피해 · 회복
    showTowerHit('my', 'king', 44, 'damage');
    showTowerHit('my', 'right', 12, 'dot');
    showTowerHit('my', 'left', 30, 'heal');
    const ns = [...document.querySelectorAll('.floating-number')];
    res.list = ns.map(n => ({ cls: n.className, txt: n.textContent, color: getComputedStyle(n).color }));
    return JSON.stringify(res);
  })()`));
  const dealt = colors.list.filter(n => n.cls.includes('dealt'));
  const taken = colors.list.filter(n => !n.cls.includes('dealt'));
  ok('내가 넣은 피해 2개가 흰색', dealt.length === 2 && dealt.every(n => n.color === 'rgb(255, 255, 255)'),
     dealt.map(n => n.txt + ' ' + n.color).join(' / '));
  ok('내가 맞은 피해·회복은 기존 색 그대로', taken.length === 3 && taken.every(n => n.color !== 'rgb(255, 255, 255)'),
     taken.map(n => n.txt + ' ' + n.color).join(' / '));

  const shot = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_hpzoom.png', Buffer.from(shot.result.data, 'base64'));

  console.log('');
  console.log(fails === 0 ? '모두 통과' : `${fails}개 실패`);
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
