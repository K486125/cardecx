// 2026-10-04 — 보안 규칙: 콘솔에서 DB를 직접 고치는 치트가 막히고, 정상 경기는 그대로 끝난다
import { launch, waitFor, sleep, DBQ, DBW, resetDB, check, failCount, addFail, startMatch } from './lib.mjs';

await resetDB();
const A = await launch('A', 9701), B = await launch('B', 9702);
const all = [A, B];
try {
  const code = await startMatch(A, B);
  const G = `rooms/${code}/gameState`;
  // 브라우저 콘솔에서 하듯 앱의 db로 직접 쓴다 — 'ok' 또는 'denied'
  const W = (b, js) => b.evalJs(`(${js}).then(() => 'ok', e => 'denied')`);
  const ref = p => `db.ref('rooms/${code}/${p}')`;
  const denied = async (name, b, js) => check(name, await W(b, js) === 'denied');
  const allowed = async (name, b, js) => check(name, await W(b, js) === 'ok');

  // ── 타워 체력 ──
  await denied('상대 킹 체력을 0으로 — 막힘', A, `${ref('gameState/p2/towers/king')}.update({ hp: 0, alive: false })`);
  await denied('상대 킹을 쓰러뜨림(alive=false)만 — 막힘 (체력이 남아 있다)', A, `${ref('gameState/p2/towers/king/alive')}.set(false)`);
  await denied('한 번에 1000 넘게 깎기 — 막힘', A, `${ref('gameState/p2/towers/king/hp')}.set(400)`);
  await allowed('카드 한 방만큼(100) 깎기 — 된다', A, `${ref('gameState/p2/towers/king/hp')}.set(1400)`);
  await denied('최대 체력 늘리기 — 막힘', A, `${ref('gameState/p1/towers/king/maxHp')}.set(9999)`);
  await denied('최대 체력보다 높게 — 막힘', A, `${ref('gameState/p1/towers/king/hp')}.set(1600)`);
  await DBW(`${G}/p1/towers/king`, 'PATCH', { hp: 1000 });
  await denied('내 타워 한 번에 200 넘게 회복 — 막힘', A, `${ref('gameState/p1/towers/king/hp')}.set(1500)`);
  await allowed('내 타워 200까지 회복 — 된다', A, `${ref('gameState/p1/towers/king/hp')}.set(1150)`);
  await denied('상대가 내 타워를 회복시킴 — 막힘', B, `${ref('gameState/p1/towers/king/hp')}.set(1160)`);
  await denied('내 킹 타워를 지움 (공격이 안 들어가는 무적) — 막힘', A, `${ref('gameState/p1/towers/king')}.remove()`);
  await denied('내 타워 묶음을 통째로 지움 — 막힘', A, `${ref('gameState/p1/towers')}.remove()`);
  await DBW(`${G}/p2/towers/left`, 'PATCH', { hp: 0, alive: false });
  await denied('무너진 타워 되살리기 — 막힘', B, `${ref('gameState/p2/towers/left')}.update({ hp: 300, alive: true })`);

  // ── 효과 ──
  await denied('면역을 영원히 — 막힘', A, `${ref('gameState/p1/towers/king/immunityUntil')}.set(Date.now() + 3600000)`);
  await allowed('면역 5초 — 된다', A, `${ref('gameState/p1/towers/king/immunityUntil')}.set(Date.now() + 5000)`);
  await denied('피해 감소 100% (무적) — 막힘', A, `${ref('gameState/p1/towers/king/damageReductionPercent')}.set(100)`);
  await denied('상대 받는 피해 +500% — 막힘', A, `${ref('gameState/p2/towers/king/damageAmpPercent')}.set(500)`);
  await denied('보호막 9999 — 막힘', A, `${ref('gameState/p1/towers/king/shieldHp')}.set(9999)`);
  await denied('상대 덱을 1시간 동결 — 막힘', A, `${ref('gameState/p2/deckFreezeUntil')}.set(Date.now() + 3600000)`);
  await denied('지속 피해 9999짜리 줄 — 막힘', A, `${ref('gameState/dots/cheat1')}.set({ targetPlayer: 'p2', sourcePlayer: 'p1', targetTower: 'king', type: 'damage', remainingTicks: 5, dmgPerTick: 9999, tickInterval: 1000 })`);
  await denied('예약 피해 9999 — 막힘', A, `${ref('gameState/pendingHits/cheat2')}.set({ sourcePlayer: 'p1', targetPlayer: 'p2', applyAt: Date.now(), cardId: 'apocalypse', effect: { damage: 9999 } })`);
  await denied('상대 덱을 바꿈 — 막힘', A, `${ref('gameState/p2/deck/0')}.set({ cardId: 'wooden_sword', grade: 'common', count: 1 })`);

  // ── 승패 ──
  await denied('경기 중에 내가 이겼다고 기록 — 막힘', A, `${ref('gameState/winner')}.set('p1')`);
  await denied('승자 없이 방을 끝난 상태로 — 막힘', A, `${ref('status')}.set('finished')`);
  check('거절된 승자 쓰기 뒤에도 경기는 계속된다', await DBQ(`rooms/${code}/status`) === 'playing');
  await denied('경기 중에 경기 동결(endedAt) — 막힘', A, `${ref('gameState/endedAt')}.set(Date.now())`);
  await denied('시작 시각을 앞당겨 시간 종료를 만듦 — 막힘', A, `${ref('gameStartTime')}.set(Date.now() - 400000)`);
  await denied('기준 시각(matchTimerStartedAt) 지우기 — 막힘', A, `${ref('gameState/matchTimerStartedAt')}.remove()`);

  // 시간이 다 된 경기 — 체력이 앞선 쪽만 승자로 기록된다
  const gst = await DBQ(`rooms/${code}/gameStartTime`);
  await DBW(`rooms/${code}/gameStartTime`, 'PUT', gst - 400000);
  await allowed('시간이 다 되면 경기 동결 — 된다', B, `${ref('gameState/endedAt')}.set(Date.now())`);
  await denied('시간 종료 — 체력이 뒤진 쪽(p2)은 승자로 못 적는다', B, `${ref('gameState/winner')}.set('p2')`);
  await allowed('시간 종료 — 체력이 앞선 쪽(p1)은 된다', B, `${ref('gameState/winner')}.set('p1')`);
  await denied('정해진 승자를 지움 — 막힘', B, `${ref('gameState/winner')}.remove()`);
  await allowed('승자가 정해지면 방을 끝난 상태로 — 된다', B, `${ref('status')}.set('finished')`);

  for (const b of all) if (b.exceptions.length) check(`[${b.name}] 예외 없음`, false, b.exceptions.join(' | '));
} catch (e) { console.log('ERROR', e.message); addFail(); }
finally { all.forEach(b => b.proc.kill()); }
console.log(failCount() ? '\n실패 ' + failCount() : '\n모두 통과');
process.exit(failCount() ? 1 : 0);
