// ============================================================
//  win.js — 승리 조건 감지 및 결과 화면 표시
//  승리 조건: 상대 킹 타워 파괴
// ============================================================

let _winLocalKey  = null;
let _winEnemyKey  = null;
let _winChecked   = false;

function winInit(localKey, enemyKey) {
  _winLocalKey = localKey;
  _winEnemyKey = enemyKey;
  _winChecked  = false;
}

/**
 * 게임 상태 변경 시마다 호출 — 킹 타워 파괴 즉시 감지
 */
function winCheckTowers(gameState) {
  if (_winChecked) return;
  if (!gameState) return;

  const myKing    = gameState[_winLocalKey]?.towers?.king;
  const enemyKing = gameState[_winEnemyKey]?.towers?.king;

  // 킹 타워 파괴 → 경기 확정 (동결된 최종 상태로 승자 판정 — game.js requestMatchEnd)
  if (enemyKing?.alive === false || myKing?.alive === false) {
    _winChecked = true;
    requestMatchEnd();
  }
}

/**
 * winner Firebase 값 수신 → 결과 화면 표시
 * @param {object|null} stats  _buildResultStats() 반환값
 */
function winShowResult(winner, reason, localKey, stats) {
  const isDraw = (winner === 'draw');
  const isWin  = !isDraw && (winner === localKey);

  const icon  = document.getElementById('result-icon');
  const title = document.getElementById('result-title');

  if (isDraw) {
    if (icon)  icon.textContent  = '🤝';
    if (title) { title.textContent = t('drawTitle'); title.className = 'result-title draw'; }
  } else if (isWin) {
    if (icon)  icon.textContent  = '🏆';
    if (title) { title.textContent = t('winTitle'); title.className = 'result-title win'; }
  } else {
    if (icon)  icon.textContent  = '💀';
    if (title) { title.textContent = t('losTitle'); title.className = 'result-title lose'; }
  }

  if (stats) _populateResultStats(stats);
  winSetReason(reason === 'disconnect' && !isDraw ? t(isWin ? 'forfeitWinReason' : 'forfeitLoseReason') : '');

  document.getElementById('screen-game').classList.add('hidden');
  document.getElementById('screen-game').classList.remove('active');
  const resultScreen = document.getElementById('screen-result');
  resultScreen.classList.remove('hidden');
  resultScreen.classList.add('active');

  // 플레이어는 잠시 뒤 대기실로 자동 복귀 (game.js)
  if (typeof _startResultReturnCountdown === 'function') _startResultReturnCountdown();
}

/** 결과 제목 아래 한 줄 (기권승·기권패 이유). 빈 글이면 숨긴다 */
function winSetReason(text) {
  let el = document.getElementById('result-reason');
  const title = document.getElementById('result-title');
  if (!el && title) {
    el = document.createElement('div');
    el.id = 'result-reason';
    el.className = 'result-reason';
    title.insertAdjacentElement('afterend', el);
  }
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

function _populateResultStats(stats) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? 0; };
  const labelClass = stats.isDraw ? 'result-col-label draw-label' : null;
  const winLabel  = document.getElementById('result-winner-name');
  const loseLabel = document.getElementById('result-loser-name');
  if (winLabel)  { winLabel.textContent  = stats.winnerName; if (labelClass) winLabel.className  = labelClass; }
  if (loseLabel) { loseLabel.textContent = stats.loserName;  if (labelClass) loseLabel.className = labelClass; }
  set('result-winner-towers', stats.winnerTowers);
  set('result-loser-towers',  stats.loserTowers);
  set('result-winner-dmg',    stats.winnerMaxDmg);
  set('result-loser-dmg',     stats.loserMaxDmg);
  set('result-winner-heal',   stats.winnerMaxHeal);
  set('result-loser-heal',    stats.loserMaxHeal);
}
