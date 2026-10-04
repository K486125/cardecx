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

const A = await launch('A', 9361), B = await launch('B', 9362);
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


  // ── 표가 요구대로인지 ─────────────────────────────────────
  const shots = JSON.parse(await A.evalJs(`JSON.stringify(CAST_STYLES.stonehell.shots)`));
  ok('세 덩이가 위(left)·중간(king)·아래(right)', shots.map(s => s.pos).join(',') === 'left,king,right',
     shots.map(s => s.pos).join(','));
  ok('도착 2.0 / 2.5 / 3.0초', shots.map(s => s.flyMs).join(',') === '2000,2500,3000', shots.map(s => s.flyMs).join(','));
  ok('피해 14 / 18 / 22 (2026-10-01 밸런스)', shots.map(s => s.damage).join(',') === '14,18,22', shots.map(s => s.damage).join(','));
  ok('돌가루 2×3 / 3×3 / 3×3',
     shots.map(s => s.dot.dmgPerTick).join(',') === '2,3,3' && shots.every(s => s.dot.ticks === 3),
     JSON.stringify(shots.map(s => s.dot.dmgPerTick + 'x' + s.dot.ticks)));
  ok('돌가루 간격 0.6 / 0.5 / 0.4초',
     shots.map(s => s.dot.tickInterval).join(',') === '600,500,400', shots.map(s => s.dot.tickInterval).join(','));
  ok('멀리 갈수록 아프고 돌가루도 빨라진다',
     shots[0].flyMs < shots[2].flyMs && shots[0].damage < shots[2].damage &&
     shots[0].dot.dmgPerTick < shots[2].dot.dmgPerTick && shots[0].dot.tickInterval > shots[2].dot.tickInterval);

  // ── 착지 원 크기 ────────────────────────────────────────
  // 2026-09-29 — 돌은 3×3칸 → 2×2칸 → 타일 한 칸(커서 칸)이 됐다. radius는 깨짐 그림 크기 기준(타일 반 폭).
  // 바위 지옥은 타워마다 정해진 자리에 떨어지므로 여전히 한 칸이다.
  const r = await A.evalJs(`CAST_STYLES.stone.radius`);
  const tile = await A.evalJs(`TILE`);
  ok('돌 착지 = 타일 한 칸', r * 2 === tile, `지름 ${r * 2}px, 타일 ${tile}px`);
  const rh = await A.evalJs(`CAST_STYLES.stonehell.radius`);
  ok('바위 지옥 착지 원은 타워 한 칸', rh * 2 === tile, `지름 ${rh * 2}px`);

  // ── 조준 표시: 궤적 3개 + 착지 원 3개 ──────────────────
  const slotOf = async (b, id) => b.evalJs(`_deckSlots.findIndex(s => s && s.card && s.card.id === '${id}')`);
  const pickCard = async (b, id) => {
    const i = await slotOf(b, id);
    if (i < 0) return -1;
    const p = JSON.parse(await b.evalJs(`(() => { const e = document.querySelectorAll('#deck-slots .deck-slot')[${i}].querySelector('.card');
      const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2 }); })()`));
    await click(b, Math.round(p.x), Math.round(p.y));
    await sleep(250);
    return i;
  };

  await A.evalJs(`devGiveCard('rock_hell'); 1`); await sleep(700);
  const slot = await pickCard(A, 'rock_hell');
  ok('바위 지옥을 덱에 받아 집었다', slot >= 0, 'slot=' + slot);

  const mapC = JSON.parse(await A.evalJs(`(() => { const r = document.getElementById('map-viewport').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }); })()`));
  await mouse(A, 'mouseMoved', mapC.x, mapC.y, 'none', 0);
  await sleep(200);
  const aimRaw = await A.evalJs(`(() => {
    const a = document.querySelector('.cast-throw3');
    if (!a) return JSON.stringify({ exists: false });
    const paths = [...a.querySelectorAll('.cast-throw-path')].filter(p => p.getAttribute('d'));
    const lands = [...document.querySelectorAll('.cast-lands .cast-throw-land')].filter(l => l.style.display !== 'none');
    const onTower = lands.map((l, i) => {
      const pos = ['left','king','right'][i];
      const t = document.querySelector('#tower-enemy-' + pos + ' .tower-block').getBoundingClientRect();
      // style.left/top은 맵 좌표(바닥판 안) — 화면에 그려진 자리로 비교한다
      const lr = l.getBoundingClientRect();
      return Math.round(Math.hypot((lr.left + lr.width/2) - (t.left + t.width/2),
                                   (lr.top  + lr.height/2) - (t.top  + t.height/2)));
    });
    return JSON.stringify({ exists: true, paths: paths.length, lands: lands.length,
      ready: a.classList.contains('cast-arc-ready'),
      gauge: !!a.querySelector('.cast-throw-gauge'),
      onTower, hl: document.querySelectorAll('.tower.drag-over').length });
  })()`);
  if (typeof aimRaw === 'string' && aimRaw.startsWith('EXC')) console.log('   EVAL', aimRaw);
  const aim = JSON.parse(aimRaw);
  ok('궤적 3개 · 착지 원 3개', aim.exists && aim.paths === 3 && aim.lands === 3, JSON.stringify(aim));
  ok('원 3개가 상대 타워 3개에 정확히 올라간다', aim.onTower && aim.onTower.every(d => d <= 3), JSON.stringify(aim.onTower));
  ok('타워 3개 모두 강조', aim.hl === 3, 'hl=' + aim.hl);
  ok('차징 게이지가 아예 없다 (즉발)', aim.gauge === false, 'gauge=' + aim.gauge);

  // ── 던진다 ──────────────────────────────────────────────
  const hp = async p => Number(await A.evalJs(`document.getElementById('hptext-enemy-${p}').textContent`));
  const before = { left: await hp('left'), king: await hp('king'), right: await hp('right') };
  const t0f = Date.now();
  await click(A, mapC.x, mapC.y);
  await sleep(400);
  ok('세 덩이가 동시에 날아간다', (await A.evalJs(`document.querySelectorAll('.stone-fly').length`)) === 3,
     '개수=' + await A.evalJs(`document.querySelectorAll('.stone-fly').length`));

  // 첫 덩이(위) 2초
  await waitFor(A, `Number(document.getElementById('hptext-enemy-left').textContent) < ${before.left}`, 4000);
  const dLeft = Date.now() - t0f;
  ok('위 타워는 2초에 도착', dLeft >= 1850 && dLeft <= 2600, dLeft + 'ms');
  ok('아래 타워는 아직 안 맞았다', (await hp('right')) === before.right);

  await waitFor(A, `Number(document.getElementById('hptext-enemy-right').textContent) < ${before.right}`, 4000);
  const dRight = Date.now() - t0f;
  ok('아래 타워는 3초에 도착 (제일 느리다)', dRight >= 2850 && dRight <= 3700, dRight + 'ms');
  ok('위가 아래보다 먼저 도착', dLeft < dRight - 700, `${dLeft}ms → ${dRight}ms`);

  // 돌가루까지 다 들어간 뒤 (마지막 덩이 3.0s + 0.4s*3)
  await sleep(2600);
  const dmg = JSON.parse(await A.evalJs(`(() => { const t = window.getGameState().p2.towers;
    return JSON.stringify({ left: t.left.dmgTaken, king: t.king.dmgTaken, right: t.right.dmgTaken }); })()`));
  ok('위 타워 14 + 돌가루 2×3 = 20',   dmg.left  === 20, 'left='  + dmg.left);
  ok('중간 타워 18 + 돌가루 3×3 = 27', dmg.king  === 27, 'king='  + dmg.king);
  ok('아래 타워 22 + 돌가루 3×3 = 31', dmg.right === 31, 'right=' + dmg.right);

  // ── 카드 한 장 · 에너지 한 번만 ────────────────────────
  const deckAfter = await A.evalJs(`_deckSlots.filter(s => s && s.card.id === 'rock_hell').length`);
  ok('카드는 한 장만 소모', deckAfter === 0, '남은 바위지옥 슬롯=' + deckAfter);

  const shot = await A.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shot_stonehell.png', Buffer.from(shot.result.data, 'base64'));

  console.log('');
  console.log(fails === 0 ? '모두 통과' : `${fails}개 실패`);
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
