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

  // 적 킹 타워 파괴 → 내가 승리
  if (enemyKing && enemyKing.alive === false) {
    _winChecked = true;
    writeWinner(_winLocalKey, 'king_destroyed');
    return;
  }

  // 내 킹 타워 파괴 → 적이 승리
  if (myKing && myKing.alive === false) {
    _winChecked = true;
    writeWinner(_winEnemyKey, 'king_destroyed');
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

  document.getElementById('screen-game').classList.add('hidden');
  document.getElementById('screen-game').classList.remove('active');
  const resultScreen = document.getElementById('screen-result');
  resultScreen.classList.remove('hidden');
  resultScreen.classList.add('active');
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
