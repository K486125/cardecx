// node --experimental-websocket drive.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5055';
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(6);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(name, port, reuse) {
  let proc = reuse?.proc, page;
  if (!reuse) {
    const dir = mkdtempSync(join(tmpdir(), 'cdx-' + name + '-'));
    proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
      '--no-first-run', '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
    let targets;
    for (let i = 0; i < 50; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); }
    }
    page = targets.find(t => t.type === 'page');
  } else {
    page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const reqUrls = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
      console.log(`${ts()} [${name}] console.${m.params.type}: ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      console.log(`${ts()} [${name}] EXCEPTION: ` + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Network.loadingFailed' && m.params.type === 'Script') {
      console.log(`${ts()} [${name}] SCRIPT LOAD FAIL: ${m.params.errorText} ${reqUrls.get(m.params.requestId) || ''}`);
    } else if (m.method === 'Network.requestWillBeSent') {
      reqUrls.set(m.params.requestId, m.params.request.url.replace(BASE, ''));
    } else if (m.method === 'Page.javascriptDialogOpening') {
      console.log(`${ts()} [${name}] DIALOG: ${m.params.message}`);
      ws.send(JSON.stringify({ id: 999999, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    } else if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) {
      console.log(`${ts()} [${name}] NAV → ${m.params.frame.url.replace(BASE, '')}`);
    }
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.addScriptToEvaluateOnNewDocument', { source: "document.addEventListener('DOMContentLoaded', () => { if (typeof mapFitZoom === 'function') window.mapFitZoom = () => 1; });" }); await send('Network.enable');
  const evalJs = async (expr, ms = 20000) => {
    const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => null)]);
    return r ? r.result?.result?.value : 'TIMEOUT';
  };
  return { name, proc, send, evalJs, goto: url => send('Page.navigate', { url: BASE + url }) };
}

async function waitFor(b, expr, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await b.evalJs(expr).catch(() => false);
    if (v === 'TIMEOUT') throw new Error(`[${b.name}] 페이지가 응답하지 않습니다: ${expr}`);
    if (v) return true;
    await sleep(150);
  }
  console.log('DUMP', await b.evalJs(`[...document.querySelectorAll('[id*=error]')].map(e => e.id + ':' + e.textContent).join(' / ') + ' | btn=' + document.getElementById('btn-confirm-nickname')?.disabled + ' | uid=' + (typeof currentUid === 'function' ? currentUid() : 'x') + ' | boot=' + window.__bootFailed`, 3000));
  throw new Error(`[${b.name}] timeout: ${expr}`);
}

const DBQ = p => fetch(`http://127.0.0.1:9000/${p}.json?ns=demo-cardecx-default-rtdb`, { headers: { Authorization: 'Bearer owner' } }).then(r => r.json());
await fetch('http://127.0.0.1:9000/.json?ns=demo-cardecx-default-rtdb', { method: 'PUT', body: 'null', headers: { Authorization: 'Bearer owner' } });
const A = await launch('A', 9311), B = await launch('B', 9312);
let fails = 0; const check = (name, ok, info = '') => { console.log(`${ts()} ${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
const box = (b, sel) => b.evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }); })()`).then(v => v && JSON.parse(v));
const mouse = async (b, type, x, y) => b.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1, buttons: 0 });
const click = async (b, x, y) => { await mouse(b, 'mouseMoved', x, y); await mouse(b, 'mousePressed', x, y); await mouse(b, 'mouseReleased', x, y); };
try {
  for (const [b, nick] of [[A, 'Alice'], [B, 'Bobby']]) {
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
  await waitFor(B, `location.pathname.endsWith('game.html') && !document.getElementById('btn-ready').disabled`, 15000);
  await waitFor(A, `!document.getElementById('btn-ready').disabled`);
  await sleep(600);
  await A.evalJs(`document.getElementById('btn-ready').click(); 1`); await sleep(300);
  await B.evalJs(`document.getElementById('btn-ready').click(); 1`);
  for (const b of [A, B]) await waitFor(b, `!document.getElementById('screen-game').classList.contains('hidden')`, 20000);
  await waitFor(A, `window.matchInputLocked === false`, 20000);
  await sleep(1200);

  // A의 덱 0번 칸에 목검을 넣는다 (뽑기는 무작위이므로 DB로 직접)
  await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.wooden_sword }); 1`);
  await waitFor(A, `!!document.querySelector('#deck-slots .deck-slot .card')`, 8000);
  await sleep(400);

  // 카드 클릭 → 부채꼴 사거리가 마우스를 따라다녀야 한다 (카드가 아니라)
  const cardBox = await box(A, '#deck-slots .deck-slot .card');
  await click(A, cardBox.x, cardBox.y);
  await sleep(250);
  const arc = await A.evalJs(`(() => { const a = document.querySelector('.cast-arc'); const c = document.querySelector('body > .card'); if (!a) return JSON.stringify({ arc: false }); const want = _clientToStage(${cardBox.x}, ${cardBox.y}); return JSON.stringify({ arc: true, top: a.parentElement === document.getElementById('cast-ground'), w: Math.round(parseFloat(a.style.width)), dx: Math.round(parseFloat(a.style.left) - want.x), dy: Math.round(parseFloat(a.style.top) - want.y), cardClone: !!c }); })()`);
  // 바닥판 안에 들어가면서 화면 네모는 사다리꼴이 됐다 —
  // '정확히 그 칸에 놓이는가'는 wind.mjs가 타일로 따로 확인한다
  check('카드 대신 부채꼴 사거리가 바닥판에 바로 붙음',
    /"arc":true/.test(arc) && /"cardClone":false/.test(arc) && /"top":true/.test(arc) &&
    JSON.parse(arc).w === 200, arc);   // 2026-09-29 — 목검은 타일 한 칸 크기(반지름 100)

  // 적 킹 왼쪽에 커서 → 킹만 사거리에 들어와야 한다
  const king = await box(A, '#tower-enemy-king .tower-block');
  const aimX = king.x - 120, aimY = king.y;
  await mouse(A, 'mouseMoved', aimX, aimY);
  await sleep(200);
  const aim = await A.evalJs(`(() => { const hl = [...document.querySelectorAll('.tower.drag-over')].map(e => e.id); return JSON.stringify({ hl, ready: !!document.querySelector('.cast-arc.cast-arc-ready'), pos: document.querySelector('.cast-arc')?.style.left }); })()`);
  check('사거리 안의 타워 한 개만 대상', /"hl":\["tower-enemy-king"\]/.test(aim) && /"ready":true/.test(aim), aim);

  // 사거리 밖(적 타워 오른쪽 = 부채꼴 반대 방향)이면 대상 없음
  await mouse(A, 'mouseMoved', king.x + 160, king.y);
  await sleep(200);
  const back = await A.evalJs(`JSON.stringify({ hl: [...document.querySelectorAll('.tower.drag-over')].map(e => e.id), ready: !!document.querySelector('.cast-arc.cast-arc-ready') })`);
  check('부채꼴 뒤쪽 타워는 대상 아님', /"hl":\[\]/.test(back) && /"ready":false/.test(back), back);

  // 다시 조준하고 클릭 → 휘두르기 연출, 피해는 연출이 끝날 때
  const hp0 = (await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`));
  await click(A, aimX, aimY);
  await sleep(120);
  const mid = await A.evalJs(`JSON.stringify({ fx: !!document.querySelector('.cast-fx'), arc: !!document.querySelector('.cast-arc'), energy: getCurrentEnergy(), slot0: !!document.querySelector('.deck-slot[data-slot="0"] .card') })`);
  // 에너지는 3초마다 회복돼 최대치(100)로 곧 돌아오므로 슬롯 비움으로 중복 사용 방지를 확인한다
  check('클릭 즉시 슬롯 비움 (중복 사용 방지)', /"slot0":false/.test(mid), mid);
  check('연출에 이모지 없음', !/🗡/.test(await A.evalJs(`document.querySelector('.cast-fx')?.textContent || ''`)));
  check('휘두르기 연출 시작 · 사거리 표시 사라짐', /"fx":true/.test(mid) && /"arc":false/.test(mid), mid);
  const hpMid = (await DBQ(`rooms/${code}/gameState/p2/towers/king/hp`));
  check('연출 도중에는 아직 피해 없음', hpMid === hp0, `${hp0} → ${hpMid}`);
  // 상대 화면에도 같은 연출
  await sleep(120);
  check('상대 화면에도 시전 연출', await B.evalJs(`!!document.querySelector('.cast-fx')`));

  await sleep(900);
  const gs = await DBQ(`rooms/${code}/gameState`);
  check('연출이 끝난 뒤 피해 12 (단일)', gs.p2.towers.king.hp === hp0 - 12 && gs.p2.towers.king.dmgTaken === 12,
    `king ${gs.p2.towers.king.hp} dmg=${gs.p2.towers.king.dmgTaken}`);
  check('옆 타워는 피해 없음', !gs.p2.towers.left.dmgTaken && !gs.p2.towers.right.dmgTaken);
  check('덱 칸 비움', !gs.p1.deck?.[0]);
  check('연출 정리됨', (await A.evalJs(`document.querySelectorAll('.cast-fx, .cast-arc').length`)) === 0);


  // 연출이 없는 카드(독사 — 불은 불덩이 투척이 됐다)는 예전처럼 카드가 마우스에 붙는다
  // — 돌·화살은 연출이 생겨서 더 이상 '연출 없는 카드'의 예가 아니다
  await A.evalJs(`addCardToDeck({ ...CARD_DEFINITIONS.viper }); 1`);
  await waitFor(A, `!!document.querySelector('#deck-slots .deck-slot .card')`, 8000);
  await sleep(400);
  const plainBox = await box(A, '#deck-slots .deck-slot .card');
  await click(A, plainBox.x, plainBox.y);
  await sleep(250);
  check('연출 없는 카드는 기존처럼 카드가 따라붙음',
    await A.evalJs(`!document.querySelector('.cast-arc, .cast-lunge, .cast-circle, .cast-throw') && !!document.querySelector('body > .card')`));
  await click(A, king.x, king.y);
  await sleep(800);    // 독사는 즉시 피해
  const gs2 = await DBQ(`rooms/${code}/gameState`);
  check('연출 없는 카드는 바로 적용된다', gs2.p2.towers.king.dmgTaken > 10, `dmg=${gs2.p2.towers.king.dmgTaken}`);
  const hits = Object.values(gs2.instantHits || {}).map(h => h.type);
  check('시전 신호 정리됨', !hits.some(t => t.startsWith('cast_')), JSON.stringify(hits));

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과');
} catch (e) { console.log('FAIL', e.message); }
finally { A.proc.kill(); B.proc.kill(); process.exit(fails ? 1 : 0); }
