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

const A = await launch('A', 9391), B = await launch('B', 9392);
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
  // 맵 좌표(스테이지) → 화면 좌표. 조준·사거리는 전부 이 좌표계로 돈다
  const stagePt = async (x, y) => JSON.parse(await A.evalJs(`(() => {
    const m = document.getElementById('tile-map').getBoundingClientRect();
    const s = m.width / MAP_W;
    return JSON.stringify({ x: Math.round(m.left + ${x} * s), y: Math.round(m.top + ${y} * s) }); })()`));
  const hp = async p => Number(await A.evalJs(`document.getElementById('hptext-enemy-${p}').textContent`));
  const allHp = async () => ({ left: await hp('left'), king: await hp('king'), right: await hp('right') });
  // 에너지는 안 본다 — '#Dev' 닉네임은 에너지 무제한이라(js/dev.js) 항상 100이다
  const give = async id => { await A.evalJs(`castResetCooldown(); devGiveCard('${id}'); 1`); await sleep(600); };

  // 타워가 하나도 없는 빈 땅 (상대 진영 9열 4행 — 킹까지 400, 어떤 사거리에도 안 닿는다)
  const VOID = await stagePt(950, 450);

  // ── 목검을 허공에 휘두른다 ────────────────────────────────
  await give('wooden_sword');
  ok('목검을 덱에 받아 집었다', (await pick('wooden_sword')) >= 0);
  const h0 = await allHp();
  await mouse(A, 'mouseMoved', VOID.x, VOID.y, 'none', 0);
  await sleep(200);
  ok('허공에서는 강조되는 타워가 없다',
     (await A.evalJs(`document.querySelectorAll('.tower.drag-over, .tower.drag-over-heal').length`)) === 0);
  ok('사거리 표시가 "빗나감"으로 보인다',
     (await A.evalJs(`!document.querySelector('.cast-arc').classList.contains('cast-arc-ready')`)) === true);

  await click(A, VOID.x, VOID.y);
  await sleep(250);
  ok('허공에도 연출이 나간다', (await A.evalJs(`!!document.querySelector('.cast-fx')`)) === true);
  ok('카드가 소모된다', (await slotOf('wooden_sword')) === -1);
  ok('들고 있던 카드가 놓인다', (await A.evalJs(`boardIsHoldingCard()`)) === false);
  // 빗나간 공격도 상대 화면에 보여야 한다 — 안 보이면 상대는 뭐가 지나갔는지 모른다
  ok('상대 화면에도 빗나간 연출이 보인다',
     (await B.evalJs(`!!document.querySelector('.cast-fx')`)) === true);
  await sleep(1200);
  const h1 = await allHp();
  ok('빗나갔으므로 어떤 타워도 피해가 없다',
     h1.left === h0.left && h1.king === h0.king && h1.right === h0.right,
     JSON.stringify(h0) + ' -> ' + JSON.stringify(h1));

  // ── 맵 밖 클릭은 카드를 날리지 않는다 ──────────────────────
  await give('wooden_sword');
  ok('목검을 다시 집었다', (await pick('wooden_sword')) >= 0);
  const eBar = JSON.parse(await A.evalJs(`(() => { const r = document.querySelector('.energy-row').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }); })()`));
  await click(A, eBar.x, eBar.y);
  await sleep(250);
  ok('맵 밖(에너지 바)을 눌러도 카드는 그대로 들고 있다',
     (await A.evalJs(`boardIsHoldingCard()`)) === true);
  ok('맵 밖 클릭으로는 카드가 소모되지 않는다', (await slotOf('wooden_sword')) >= 0);

  // ── 범위 안에 타워가 둘이어도 목검은 하나만 (2026-09-29 단일 대상) ────
  // 범위를 일부러 두 타워가 들어오게 키워도 가장 가까운 하나만 맞아야 한다
  await A.evalJs(`cancelStickyDrag(); window.__swordR = CAST_STYLES.sword.radius; CAST_STYLES.sword.radius = 280; 1`);
  await A.evalJs(`castResetCooldown(); 1`);
  ok('목검을 세 번째로 집었다', (await pick('wooden_sword')) >= 0);
  // 위 타워(14,2)와 킹(13,4)이 모두 부채꼴 안에 들어오는 자리
  const TWO = await stagePt(1250, 350);
  await mouse(A, 'mouseMoved', TWO.x, TWO.y, 'none', 0);
  await sleep(200);
  const hl = JSON.parse(await A.evalJs(`JSON.stringify([...document.querySelectorAll('.tower.drag-over')].map(e => e.dataset.pos).sort())`));
  ok('범위가 두 타워를 덮어도 강조는 하나', hl.length === 1, JSON.stringify(hl));

  const h2 = await allHp();
  await click(A, TWO.x, TWO.y);
  await sleep(1400);
  const h3 = await allHp();
  ok('피해는 그 하나에만 (온전한 피해)',
     (h2.left - h3.left) + (h2.king - h3.king) === 10 && (h2.left === h3.left || h2.king === h3.king),
     JSON.stringify(h2) + ' -> ' + JSON.stringify(h3));
  ok('범위 밖 타워는 그대로', h3.right === h2.right, h2.right + ' -> ' + h3.right);
  await A.evalJs(`CAST_STYLES.sword.radius = window.__swordR; 1`);

  // ── 돌을 허공에 던진다 ────────────────────────────────────
  await give('rock');
  ok('돌을 덱에 받아 집었다', (await pick('rock')) >= 0);
  const h4 = await allHp();
  await mouse(A, 'mouseMoved', VOID.x, VOID.y, 'none', 0);
  await mouse(A, 'mousePressed', VOID.x, VOID.y);
  await sleep(120);
  await mouse(A, 'mouseReleased', VOID.x, VOID.y);
  await sleep(300);
  ok('허공에도 던져진다 (카드 소모)', (await slotOf('rock')) === -1);
  ok('상대 화면에도 빗나간 투척이 보인다',
     (await B.evalJs(`!!document.querySelector('.cast-fx, .stone-fly')`)) === true);
  await sleep(1800);
  const h5 = await allHp();
  ok('빈 땅에 떨어진 돌은 아무도 안 맞힌다',
     h5.left === h4.left && h5.king === h4.king && h5.right === h4.right,
     JSON.stringify(h4) + ' -> ' + JSON.stringify(h5));

  // ── 빗나간 바람 스매시는 에너지도 못 깎는다 ────────────────
  await give('wind');
  ok('바람을 덱에 받아 집었다', (await pick('wind')) >= 0);
  const eB = Number(await B.evalJs(`getCurrentEnergy()`));
  await B.evalJs(`window.__minE = getCurrentEnergy();
    window.__eWatch = setInterval(() => { window.__minE = Math.min(window.__minE, getCurrentEnergy()); }, 25); 1`);
  await click(A, VOID.x, VOID.y);
  await sleep(1800);
  const eMin = Number(await B.evalJs(`clearInterval(window.__eWatch); window.__minE`));
  ok('빗나가면 상대 에너지를 깎지 않는다', eMin === eB, eB + ' -> ' + eMin);

  console.log('');
  console.log(fails === 0 ? '모두 통과' : fails + '개 실패');
} catch (e) { console.log('FAIL', e.message); fails++; }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
