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

const A = await launch('A', 9397), B = await launch('B', 9398);
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
  // B(맞는 쪽)가 보는 자기 타워 체력 — A가 죽어도 읽을 수 있다
  const bHp = async p => Number(await B.evalJs(`document.getElementById('hptext-my-${p}').textContent`));
  const pendCount = async b => Number(await b.evalJs(`(async () => {
    const s = await db.ref('rooms/' + new URLSearchParams(location.search).get('room') + '/gameState/pendingHits').get();
    return s.exists() ? Object.keys(s.val()).length : 0; })()`));
  const mapPt = async (b, x, y) => JSON.parse(await b.evalJs(`(() => {
    const m = document.getElementById('tile-map').getBoundingClientRect();
    const s = m.width / MAP_W;
    return JSON.stringify({ x: Math.round(m.left + ${x} * s), y: Math.round(m.top + ${y} * s) }); })()`));

  // ── 1) 평소에는 딱 한 번만 들어간다 ───────────────────────
  await A.evalJs(`castResetCooldown(); devGiveCard('rock'); 1`);
  await sleep(600);
  ok('돌을 집었다', (await pick(A, 'rock')) >= 0);
  const bKing = JSON.parse(await A.evalJs(`(() => { const r = document.querySelector('#tower-enemy-king .tower-block').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }); })()`));
  const h0 = await bHp('king');
  await mouse(A, 'mouseMoved', bKing.x, bKing.y, 'none', 0);
  await mouse(A, 'mousePressed', bKing.x, bKing.y);
  await sleep(120);
  await mouse(A, 'mouseReleased', bKing.x, bKing.y);
  await sleep(300);
  ok('예약이 DB에 남는다 (연출이 끝나기 전)', (await pendCount(A)) === 1, '예약 ' + (await pendCount(A)) + '건');
  await sleep(2500);
  const h1 = await bHp('king');
  ok('돌 피해가 딱 한 번 들어간다 (20)', h0 - h1 === 20, h0 + ' -> ' + h1);
  ok('처리된 예약은 지워진다', (await pendCount(B)) === 0, '예약 ' + (await pendCount(B)) + '건');

  // ── 2) 같은 예약을 둘이 동시에 노려도 한 번만 ─────────────
  // 양쪽 모두 '지금' 처리하도록 applyAt을 과거로 넣어 경합시킨다
  const h2 = await bHp('king');
  await A.evalJs(`writePendingHit({
    sourcePlayer: 'p1', targetPlayer: 'p2', positions: ['king'],
    cardId: 'arrow', cardType: 'attack', effect: { damage: 33 },
    applyAt: serverNow() - 5000
  }); 1`);
  await sleep(3000);
  const h3 = await bHp('king');
  ok('둘이 동시에 잡아도 피해는 한 번만 (33)', h2 - h3 === 33, h2 + ' -> ' + h3);
  ok('경합 뒤에도 예약이 남지 않는다', (await pendCount(B)) === 0);

  // ── 3) 시전자가 끊겨도 맞는 쪽이 대신 넣는다 ───────────────
  // 바위 지옥은 2.0 / 2.5 / 3.0초 뒤에 도착한다 — 그 전에 A를 죽인다
  await A.evalJs(`castResetCooldown(); devGiveCard('rock_hell'); 1`);
  await sleep(700);
  ok('바위 지옥을 집었다', (await pick(A, 'rock_hell')) >= 0);
  const before = { left: await bHp('left'), king: await bHp('king'), right: await bHp('right') };
  const fire = await mapPt(A, 1100, 450);
  await click(A, fire.x, fire.y);
  await sleep(400);                       // 예약 세 건이 DB에 닿을 시간만 준다
  const pending = await pendCount(B);
  ok('덩이 세 개가 모두 예약된다', pending === 3, '예약 ' + pending + '건');

  // 시전자를 '예약을 처리할 수 없는 상태'로 만든다.
  // 브라우저를 통째로 죽이면 접속 끊김 처리가 방을 초기화해 버려(4단계 영역)
  // 인계 로직만 따로 볼 수 없다 — 여기서는 A의 예약 처리기만 꺼 둔다.
  await A.evalJs(`pendingHitsCleanup(); pendingHitsInit(null); 1`);
  console.log(`${ts()} [A] 시전자의 예약 처리기를 꺼 두었다 — 이제 B만 남았다`);

  await sleep(9000);                      // 도착 3초 + 유예 1.5초 + 돌가루
  const after = { left: await bHp('left'), king: await bHp('king'), right: await bHp('right') };
  ok('시전자가 못 넣어도 위 타워가 맞는다 (착지 14 이상)',
     before.left - after.left >= 14, before.left + ' -> ' + after.left);
  ok('시전자가 못 넣어도 킹 타워가 맞는다 (착지 18 이상)',
     before.king - after.king >= 18, before.king + ' -> ' + after.king);
  ok('시전자가 못 넣어도 아래 타워가 맞는다 (착지 22 이상)',
     before.right - after.right >= 22, before.right + ' -> ' + after.right);
  ok('대신 처리한 뒤 예약이 모두 지워진다', (await pendCount(B)) === 0, '예약 ' + (await pendCount(B)) + '건');

  console.log('');
  console.log(fails === 0 ? '모두 통과' : fails + '개 실패');
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { try { A.proc.kill(); } catch {} B.proc.kill(); process.exit(fails ? 1 : 0); }
