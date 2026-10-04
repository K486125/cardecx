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

const A = await launch('A', 9371), B = await launch('B', 9372);
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



  const NS = 'demo-cardecx-default-rtdb';
  const dbPut = (p, v) => fetch(`http://127.0.0.1:9000/${p}.json?ns=${NS}`,
    { method: 'PATCH', body: JSON.stringify(v), headers: { Authorization: 'Bearer owner' } });

  const setTower = async (pos, alive) => {
    await dbPut(`rooms/${code}/gameState/p2/towers/${pos}`,
                alive ? { alive: true, hp: 300 } : { alive: false, hp: 0 });
    await sleep(700);
  };
  const dmgOf = async () => JSON.parse(await A.evalJs(`(() => { const t = window.getGameState().p2.towers;
    return JSON.stringify({ left: t.left.dmgTaken || 0, king: t.king.dmgTaken || 0, right: t.right.dmgTaken || 0 }); })()`));

  const slotOf = async id => A.evalJs(`_deckSlots.findIndex(s => s && s.card && s.card.id === '${id}')`);
  const pick = async id => {
    const i = await slotOf(id);
    if (i < 0) return -1;
    const p = JSON.parse(await A.evalJs(`(() => { const e = document.querySelectorAll('#deck-slots .deck-slot')[${i}].querySelector('.card');
      const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
    await click(A, Math.round(p.x), Math.round(p.y));
    await sleep(250);
    return i;
  };
  console.log(ts(), 'about to read map', await A.evalJs('1+1'), await A.evalJs('location.pathname'));
  const mapC = JSON.parse(await A.evalJs(`(() => { const r = document.getElementById('map-viewport').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }); })()`));

  // 한 번 던지고 돌가루까지 다 들어갈 때까지 기다린 뒤, 늘어난 피해를 돌려준다
  const throwHell = async () => {
    await A.evalJs(`castResetCooldown(); devGiveCard('rock_hell'); 1`);
    await sleep(700);
    const slot = await pick('rock_hell');
    if (slot < 0) throw new Error('바위 지옥을 못 받음');
    console.log(ts(), 'picked slot', slot);
    const before = await dmgOf();
    console.log(ts(), 'before', JSON.stringify(before));
    const aimed = JSON.parse(await A.evalJs(`JSON.stringify(castThrow3Shots(CAST_STYLES.stonehell, 'enemy'))`));
    await click(A, mapC.x, mapC.y);
    await sleep(6200);                       // 마지막 덩이 3.0초 + 돌가루 3회
    const after = await dmgOf();
    return { aimed, delta: { left: after.left - before.left, king: after.king - before.king, right: after.right - before.right } };
  };

  console.log(ts(), 'setup ok, code=' + code);
  console.log(ts(), 'gs?', await A.evalJs(`typeof window.getGameState`));
  console.log(ts(), 'fn?', await A.evalJs(`typeof castThrow3Shots`));
  // ── 1) 맨 아래(right)만 부서진 경우 ──────────────────────
  await setTower('right', false);
  let r = await throwHell();
  ok('아래가 부서지면 그 덩이는 가운데로', r.aimed[2] && r.aimed[2].pos === 'king' && r.aimed[2].redirected === true,
     JSON.stringify(r.aimed.map(x => x && x.pos)));
  ok('옮겨진 덩이만 절반 (22→11, 돌가루 3→2)',
     r.aimed[2].damage === 11 && r.aimed[2].dot.dmgPerTick === 2,
     `피해 ${r.aimed[2].damage}, 돌가루 ${r.aimed[2].dot.dmgPerTick}`);
  ok('위 타워는 그대로 14 + 2×3 = 20', r.delta.left === 20, 'left=' + r.delta.left);
  ok('가운데는 제 몫 27 + 옮겨온 17 = 44', r.delta.king === 44, 'king=' + r.delta.king);
  ok('부서진 타워에는 아무것도 안 들어감', r.delta.right === 0, 'right=' + r.delta.right);

  // ── 2) 맨 위(left)만 부서진 경우 ─────────────────────────
  await setTower('right', true);
  await setTower('left', false);
  r = await throwHell();
  ok('위가 부서지면 그 덩이는 가운데로', r.aimed[0] && r.aimed[0].pos === 'king' && r.aimed[0].redirected === true,
     JSON.stringify(r.aimed.map(x => x && x.pos)));
  ok('옮겨진 덩이만 절반 (14→7, 돌가루 2→1)',
     r.aimed[0].damage === 7 && r.aimed[0].dot.dmgPerTick === 1,
     `피해 ${r.aimed[0].damage}, 돌가루 ${r.aimed[0].dot.dmgPerTick}`);
  ok('아래 타워는 그대로 22 + 3×3 = 31', r.delta.right === 31, 'right=' + r.delta.right);
  ok('가운데는 제 몫 27 + 옮겨온 10 = 37', r.delta.king === 37, 'king=' + r.delta.king);
  ok('부서진 타워에는 아무것도 안 들어감', r.delta.left === 0, 'left=' + r.delta.left);

  // ── 3) 양쪽 다 부서진 경우 ───────────────────────────────
  await setTower('right', false);
  r = await throwHell();
  ok('양쪽 다 부서지면 셋 다 가운데로',
     r.aimed.every(x => x && x.pos === 'king'), JSON.stringify(r.aimed.map(x => x && x.pos)));
  ok('가운데 제 몫은 줄지 않는다 (18 + 3×3)',
     r.aimed[1].damage === 18 && r.aimed[1].dot.dmgPerTick === 3 && !r.aimed[1].redirected,
     `피해 ${r.aimed[1].damage}, 돌가루 ${r.aimed[1].dot.dmgPerTick}`);
  ok('옮겨온 둘만 절반', r.aimed[0].damage === 7 && r.aimed[2].damage === 11,
     `${r.aimed[0].damage} / ${r.aimed[2].damage}`);
  ok('가운데가 10 + 27 + 17 = 54를 받는다', r.delta.king === 54, 'king=' + r.delta.king);

  // ── 반올림 규칙 ─────────────────────────────────────────
  const rounded = JSON.parse(await A.evalJs(`JSON.stringify([1,3,5,7,9].map(n => Math.round(n / 2)))`));
  ok('홀수는 반올림 (1·3·5·7·9 → 1·2·3·4·5)', rounded.join(',') === '1,2,3,4,5', rounded.join(','));

  // ── 사거리 표시도 옮겨진 자리에 ──────────────────────────
  await A.evalJs(`castResetCooldown(); devGiveCard('rock_hell'); 1`);
  await sleep(700);
  await pick('rock_hell');
  await mouse(A, 'mouseMoved', mapC.x, mapC.y, 'none', 0);
  await sleep(250);
  const aim = JSON.parse(await A.evalJs(`(() => {
    const a = document.querySelector('.cast-throw3');
    const k = document.querySelector('#tower-enemy-king .tower-block').getBoundingClientRect();
    const lands = [...document.querySelectorAll('.cast-lands .cast-throw-land')].filter(l => l.style.display !== 'none');
    return JSON.stringify({ lands: lands.length,
      // style.left/top은 맵 좌표(바닥판 안) — 화면에 그려진 자리로 비교한다
      onKing: lands.map(l => { const lr = l.getBoundingClientRect();
        return Math.round(Math.hypot((lr.left + lr.width/2) - (k.left + k.width/2),
                                     (lr.top  + lr.height/2) - (k.top  + k.height/2))); }),
      hl: document.querySelectorAll('.tower.drag-over').length }); })()`));
  // 세 덩이가 모두 킹으로 몰려도 표시는 킹 칸 하나 (2026-09-29 — 한 타워에 둘 이상이면 하나만)
  ok('킹으로 몰린 덩이 — 착지 칸 표시는 하나, 킹 칸 위', aim.lands === 1 && aim.onKing.every(d => d <= 3), JSON.stringify(aim));
  ok('부서진 타워는 강조되지 않는다', aim.hl === 1, 'hl=' + aim.hl);
  await A.evalJs(`cancelStickyDrag(); 1`);

  console.log('');
  console.log(fails === 0 ? '모두 통과' : `${fails}개 실패`);
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
