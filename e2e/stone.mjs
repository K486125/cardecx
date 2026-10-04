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

const A = await launch('A', 9351), B = await launch('B', 9352);
const mouse = (b, type, x, y, button = 'left', buttons = 1) =>
  b.send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const click = async (b, x, y) => { await mouse(b, 'mouseMoved', x, y, 'none', 0); await mouse(b, 'mousePressed', x, y); await mouse(b, 'mouseReleased', x, y); };
// 스페이스바 — CDP는 rawKeyDown/keyUp 으로 넣는다 (keydown/keyup 리스너가 받는다)
const spaceDown = b => b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
const spaceUp   = b => b.send('Input.dispatchKeyEvent', { type: 'keyUp',      key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
/** 스페이스로 ms 만큼 차고 손을 뗀다 */
const charge = async (b, ms) => { await spaceDown(b); await sleep(ms); await spaceUp(b); };
const gauge = b => b.evalJs(`(() => { const g = document.querySelector('.cast-throw-gauge');
  if (!g) return 'null';
  return JSON.stringify({ charging: g.classList.contains('charging'), full: g.classList.contains('full'),
    pct: Number(getComputedStyle(g).getPropertyValue('--charge')),
    dmg: document.querySelector('.cast-throw-dmg').textContent,
    hint: !document.querySelector('.cast-throw-hint').classList.contains('hidden') }); })()`).then(v => v === 'null' ? null : JSON.parse(v));

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

  // ── 표 자체가 요구대로인지 ────────────────────────────────
  const tbl = JSON.parse(await A.evalJs(`JSON.stringify(CAST_STYLES.stone.charge)`));
  ok('차징 표: 피해 20/24/27/31/35/40',
     JSON.stringify(tbl.damage) === JSON.stringify([20, 24, 27, 31, 35, 40]), JSON.stringify(tbl.damage));
  ok('차징 표: 비행 1.0/1.4/1.7/2.0/2.2/2.5초',
     JSON.stringify(tbl.flyMs) === JSON.stringify([2500, 2200, 2000, 1700, 1400, 1000]), JSON.stringify(tbl.flyMs));
  ok('가득 차기까지 2초 · 20%마다 한 단계', tbl.fullMs === 2000 && tbl.steps === 5);

  const lv = JSON.parse(await A.evalJs(`JSON.stringify([0, 399, 400, 799, 800, 1599, 2000, 5000].map(
    ms => castChargeLevel(CAST_STYLES.stone, ms)))`));
  ok('누른 시간 → 단계 (0.4초마다 한 칸, 2초에서 멈춤)',
     JSON.stringify(lv) === JSON.stringify([0, 0, 1, 1, 2, 3, 5, 5]), JSON.stringify(lv));

  // ── 조준 표시 ─────────────────────────────────────────────
  const slotOf = async (b, id) => b.evalJs(`_deckSlots.findIndex(s => s && s.card && s.card.id === '${id}')`);
  const pickCard = async (b, id) => {
    const i = await slotOf(b, id);
    if (i < 0) return -1;
    const p = JSON.parse(await b.evalJs(`(() => { const e = document.querySelectorAll('#deck-slots .deck-slot')[${i}].querySelector('.card');
      const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
    await click(b, Math.round(p.x), Math.round(p.y));
    await sleep(220);
    return i;
  };
  const towerAt = async (b, sel) => JSON.parse(await b.evalJs(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }); })()`));

  await A.evalJs(`devGiveCard('rock'); 1`); await sleep(700);
  let slot = await pickCard(A, 'rock');
  ok('돌을 덱에 받아 집었다', slot >= 0, 'slot=' + slot);

  const tgt = await towerAt(A, '#tower-enemy-left .tower-block');
  await mouse(A, 'mouseMoved', tgt.x, tgt.y, 'none', 0);
  await sleep(150);
  const aim = JSON.parse(await A.evalJs(`(() => {
    const a = document.querySelector('.cast-throw');
    const p = a && a.querySelector('.cast-throw-path');
    return JSON.stringify({
      exists: !!a, ready: !!a && a.classList.contains('cast-arc-ready'),
      hasPath: !!(p && p.getAttribute('d')),
      // 착지 원은 바닥판 안(.cast-lands)으로 옮겨서 타일과 같은 원근을 먹는다
      land: Math.round((document.querySelector('.cast-lands .cast-throw-land') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
      target: !!_castTargetsInRange(${tgt.x}, ${tgt.y})[0]
    });
  })()`));
  ok('투척 사거리 표시가 뜬다 (포물선 + 착지 원)', aim.exists && aim.hasPath && aim.land > 0, JSON.stringify(aim));
  ok('타워를 겨누면 준비 표시', aim.ready && aim.target, JSON.stringify(aim));

  const g0 = await gauge(A);
  ok('차기 전에는 조작 안내가 보인다', g0 && g0.hint === true && g0.charging === false, JSON.stringify(g0));
  const shotHint = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_stone_hint.png', Buffer.from(shotHint.result.data, 'base64'));
  await spaceDown(A); await sleep(900);
  const shotG = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_stone_gauge.png', Buffer.from(shotG.result.data, 'base64'));
  await spaceUp(A);
  await A.evalJs(`_throwHeldMs = 0; 1`);   // 0단계 검사를 이어서 하므로 되돌린다

  // ── 바로 클릭 = 0단계 (스페이스를 안 눌렀으니 0단계) ─────
  let hp0 = Number(await A.evalJs(`document.getElementById('hptext-enemy-left').textContent`));
  const t1 = Date.now();
  await click(A, tgt.x, tgt.y);
  await sleep(300);
  ok('던진 직후 돌이 날아가고 있다', await A.evalJs(`!!document.querySelector('.stone-fly')`));
  ok('아직 피해는 안 들어갔다 (날아가는 중)',
     Number(await A.evalJs(`document.getElementById('hptext-enemy-left').textContent`)) === hp0);
  await waitFor(A, `Number(document.getElementById('hptext-enemy-left').textContent) < ${hp0}`, 4000);
  const dt0 = Date.now() - t1;
  let hp1 = Number(await A.evalJs(`document.getElementById('hptext-enemy-left').textContent`));
  ok('바로 클릭 → 20 피해', hp0 - hp1 === 20, `${hp0} → ${hp1}`);
  ok('바로 클릭 → 2.5초쯤 걸려 천천히 도착', dt0 >= 2350 && dt0 <= 3100, dt0 + 'ms');
  await waitFor(A, `!!document.querySelector('.cast-fx-stone-impact')`, 1500).catch(() => {});
  await sleep(200);

  // ── 꾹 눌러 풀차징 = 5단계 ───────────────────────────────
  await waitFor(A, `castCooldownLeft(CARD_DEFINITIONS.rock) === 0`, 4000);
  await A.evalJs(`devGiveCard('rock'); 1`); await sleep(700);
  slot = await pickCard(A, 'rock');
  hp0 = Number(await A.evalJs(`document.getElementById('hptext-enemy-left').textContent`));
  await mouse(A, 'mouseMoved', tgt.x, tgt.y, 'none', 0);
  // 마우스는 그냥 올려 둔 채 스페이스바로만 찬다
  await spaceDown(A);
  await sleep(700);
  const mid = await gauge(A);
  ok('스페이스를 꾹 누르면 게이지가 찬다', mid.charging && mid.pct > 25 && mid.pct < 50, JSON.stringify(mid));
  ok('게이지에 지금 단계 피해가 보인다', mid.dmg === '24', 'dmg=' + mid.dmg);
  ok('차기 시작하면 안내가 사라진다', mid.hint === false, JSON.stringify(mid));

  // 스페이스를 놓아도 차오른 단계는 남는다 — 그 뒤 천천히 조준할 수 있다
  await spaceUp(A);
  await sleep(600);
  const kept = await gauge(A);
  ok('손을 떼도 게이지가 그대로 남는다', kept.charging && Math.abs(kept.pct - mid.pct) < 6,
     `${mid.pct} -> ${kept.pct}`);
  ok('그 사이 마우스를 움직여도 유지된다', kept.dmg === '24', 'dmg=' + kept.dmg);

  // 다시 눌러 이어서 채운다 (끊어 눌러도 합산된다)
  await spaceDown(A);
  await sleep(1500);
  const full = await gauge(A);
  ok('이어서 누르면 합산돼 가득 찬다', full.full, JSON.stringify(full));
  ok('가득 차면 40 피해로 보인다', full.dmg === '40', 'dmg=' + full.dmg);
  await spaceUp(A);

  const t2 = Date.now();
  await click(A, tgt.x, tgt.y);
  await waitFor(A, `Number(document.getElementById('hptext-enemy-left').textContent) < ${hp0}`, 4000);
  const dt2 = Date.now() - t2;
  hp1 = Number(await A.evalJs(`document.getElementById('hptext-enemy-left').textContent`));
  ok('풀차징 → 40 피해', hp0 - hp1 === 40, `${hp0} → ${hp1}`);
  ok('풀차징 → 1초쯤 걸려 빠르게 도착', dt2 >= 900 && dt2 <= 1600, dt2 + 'ms');
  ok('풀차징이 기본보다 확실히 빠르다', dt2 < dt0 - 1000, `${dt0}ms → ${dt2}ms`);

  // ── 중간 단계 (2단계 = 40%) ──────────────────────────────
  await waitFor(A, `castCooldownLeft(CARD_DEFINITIONS.rock) === 0`, 5000);
  await A.evalJs(`devGiveCard('rock'); 1`); await sleep(700);
  await pickCard(A, 'rock');
  hp0 = Number(await A.evalJs(`document.getElementById('hptext-enemy-left').textContent`));
  await mouse(A, 'mouseMoved', tgt.x, tgt.y, 'none', 0);
  await charge(A, 1000);                   // 40%대
  const t3 = Date.now();
  await click(A, tgt.x, tgt.y);
  await waitFor(A, `Number(document.getElementById('hptext-enemy-left').textContent) < ${hp0}`, 4000);
  const dt3 = Date.now() - t3;
  hp1 = Number(await A.evalJs(`document.getElementById('hptext-enemy-left').textContent`));
  ok('1초 누르면(40%) 27 피해', hp0 - hp1 === 27, `${hp0} → ${hp1}`);
  ok('40%는 2초쯤 걸려 도착', dt3 >= 1850 && dt3 <= 2550, dt3 + 'ms');

  // ── 상대 화면에도 같은 속도로 보인다 ─────────────────────
  await waitFor(A, `castCooldownLeft(CARD_DEFINITIONS.rock) === 0`, 5000);
  await A.evalJs(`devGiveCard('rock'); 1`); await sleep(700);
  await pickCard(A, 'rock');
  await mouse(A, 'mouseMoved', tgt.x, tgt.y, 'none', 0);
  await charge(A, 2300);
  await click(A, tgt.x, tgt.y);
  await sleep(500);
  ok('상대 화면에도 돌이 날아간다', await B.evalJs(`!!document.querySelector('.stone-fly')`));
  const seen = await B.evalJs(`(() => { const f = document.querySelector('.stone-fly');
    if (!f) return 0; const a = f.getAnimations()[0];
    return a ? Math.round(a.effect.getComputedTiming().duration) : 0; })()`);
  ok('상대 화면의 비행 시간도 1초 (차징이 전달됨)', seen === 1000, seen + 'ms');

  // ── 못 던지는 자리를 눌러도 모은 차징은 사라지지 않는다 ──
  await waitFor(A, `castCooldownLeft(CARD_DEFINITIONS.rock) === 0`, 6000);
  await A.evalJs(`devGiveCard('rock'); 1`); await sleep(700);
  await pickCard(A, 'rock');
  await mouse(A, 'mouseMoved', tgt.x, tgt.y, 'none', 0);
  await charge(A, 1000);
  const before = await gauge(A);
  const deckKeep = await A.evalJs(`_deckSlots.filter(x => x && x.card && x.card.id === 'rock').length`);
  // 맵 밖(상단 HUD)을 클릭 — 덱 슬롯은 덱 쪽 클릭 핸들러가 따로 반응하므로 피한다
  const hud = JSON.parse(await A.evalJs(`(() => { const r = document.getElementById('match-timer')
    ? document.getElementById('match-timer').getBoundingClientRect()
    : { left: innerWidth / 2 - 20, top: 30, width: 40, height: 20 };
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      inMap: !!document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))?.closest('#map-viewport') }); })()`));
  ok('고른 지점이 맵 밖이다', hud.inMap === false, JSON.stringify(hud));
  await click(A, hud.x, hud.y);
  await sleep(300);
  const after = await gauge(A);
  ok('맵 밖을 클릭하면 던지지 않는다', (await A.evalJs(`boardIsHoldingCard()`)) === true &&
     (await A.evalJs(`_deckSlots.filter(x => x && x.card && x.card.id === 'rock').length`)) === deckKeep);
  ok('그때 모아 둔 차징도 그대로 남는다', after && after.dmg === before.dmg && after.charging,
     `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

  // ── 차징 중에도 맵을 끌 수 있다 (왼쪽 버튼이 차징에서 풀렸다) ──
  await A.evalJs(`mapZoomReset(); 1`);
  await sleep(200);
  const pan0 = await A.evalJs(`JSON.stringify([_panX, _panY])`);
  await spaceDown(A);
  await mouse(A, 'mouseMoved', tgt.x, tgt.y, 'none', 0);
  await A.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tgt.x, y: tgt.y, button: 'left', clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 6; i++) {
    await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tgt.x, y: tgt.y + i * 12, button: 'left', buttons: 1 });
    await sleep(30);
  }
  await A.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tgt.x, y: tgt.y + 72, button: 'left', clickCount: 1, buttons: 0 });
  await spaceUp(A);
  await sleep(200);
  const pan1 = await A.evalJs(`JSON.stringify([_panX, _panY])`);
  ok('차징 중에도 맵을 끌 수 있다', pan0 !== pan1, `${pan0} -> ${pan1}`);
  ok('끌고 난 직후의 클릭으로는 던지지 않는다', (await A.evalJs(`boardIsHoldingCard()`)) === true);
  await A.evalJs(`cancelStickyDrag(); mapZoomReset(); 1`);

  const shot = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_stone_fly.png', Buffer.from(shot.result.data, 'base64'));

  console.log('');
  console.log(fails === 0 ? '모두 통과' : `${fails}개 실패`);
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
