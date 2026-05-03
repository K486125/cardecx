// ============================================================
//  game.js — 최상위 컨트롤러
//  URL: game.html?room=CODE&player=p1|p2
// ============================================================

// ── URL 파라미터 파싱 ────────────────────────────────────────
const _params      = new URLSearchParams(location.search);
const _roomCode    = _params.get('room');
const _playerRole  = _params.get('player');   // 'p1' | 'p2'
const _localKey    = _playerRole;             // 'p1' | 'p2' | null(관전)
const _enemyKey    = _playerRole === 'p1' ? 'p2' : 'p1';
const _isSpectator = _params.get('spectate') === 'true';

// 전역 방 코드 (effects.js에서 사용)
window.gameRoomCode = _roomCode;
window.localNickname = sessionStorage.getItem('nickname');

// ── 화면 전환 ────────────────────────────────────────────────
function showGameScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.add('hidden');
    s.classList.remove('active');
  });
  document.getElementById(id).classList.remove('hidden');
  document.getElementById(id).classList.add('active');
}

// ── HUD 턴 표시 (턴제 제거로 사용 안 함) ────────────────────
function updateHudTurnDisplay(isMyTurn) {}

// ── 매치 타이머 ─────────────────────────────────────────────
const MATCH_DURATION    = 4 * 60 * 1000; // 4분
const OVERTIME_DURATION =      60 * 1000; // 오버타임 1분
let _matchTimerInterval = null;
let _timerEnded         = false;
let _lastCountdownNum   = -1;
let _countdownActive    = false;
window.overtimeActive = false; // 오버타임 진입 여부 (energy.js에서 참조)

function _stopMatchTimer() {
  if (_matchTimerInterval) { clearInterval(_matchTimerInterval); _matchTimerInterval = null; }
}

let _clientGameJoinTime = null; // 이 클라이언트가 게임에 진입한 시각

function _initMatchTimer(gameStartTime) {
  if (!gameStartTime) return;
  const timerEl      = document.getElementById('match-timer-display');
  const wrapEl       = document.getElementById('match-timer-wrap');
  const timerIconEl  = document.querySelector('#match-timer-wrap .timer-icon-inline');
  const countdownEl  = document.getElementById('countdown-display');
  if (!timerEl) return;

  const effectiveStart = gameStartTime;

  _matchTimerInterval = setInterval(() => {
    const elapsed   = serverNow() - effectiveStart;
    const remaining = MATCH_DURATION - elapsed;

    if (remaining > 0) {
      // ── 노말 타임 ──
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
      if (remaining <= 10000 && wrapEl) wrapEl.classList.add('warning');
    } else {
      if (!window.overtimeActive) {
        // ── 오버타임 첫 진입 ──
        window.overtimeActive = true;
        _lastCountdownNum = -1;
        _countdownActive  = false;
        if (wrapEl) { wrapEl.classList.remove('warning'); wrapEl.classList.add('overtime'); }
        timerEl.textContent = '';
        energyEnterOvertimeMode();
        _showOvertimeAnimation(() => {
          window.overtimeTimerOrigin = serverNow();
        });
      } else if (window.overtimeTimerOrigin) {
        // ── 오버타임 카운트다운 ──
        const otElapsed   = serverNow() - window.overtimeTimerOrigin;
        const otRemaining = Math.max(0, OVERTIME_DURATION - otElapsed);

        if (otRemaining <= 16000) {
          // 타이머 아이콘·텍스트 숨기고 인플레이스 카운트다운 표시
          if (!_countdownActive) {
            _countdownActive = true;
            if (timerIconEl) timerIconEl.style.display = 'none';
            timerEl.style.display = 'none';
            if (countdownEl) countdownEl.style.display = 'inline-block';
            if (wrapEl) wrapEl.classList.add('counting-down');
          }
          const num = Math.max(0, Math.ceil(otRemaining / 1000) - 1);
          if (num !== _lastCountdownNum && countdownEl) {
            _lastCountdownNum = num;
            countdownEl.classList.remove('pop');
            void countdownEl.offsetWidth;
            countdownEl.textContent = String(num);
            countdownEl.classList.add('pop');
          }
        } else {
          const otMins = Math.floor(otRemaining / 60000);
          const otSecs = Math.floor((otRemaining % 60000) / 1000);
          timerEl.textContent = `${otMins}:${String(otSecs).padStart(2, '0')}`;
        }

        if (otElapsed >= OVERTIME_DURATION && !_timerEnded) {
          _timerEnded = true;
          _stopMatchTimer();
          _endByTimer();
        }
      }
    }
  }, 500);
}

function _endByTimer() {
  if (!_latestGameState || !_gameReady) return;
  // 클라이언트가 게임에 진입한 후 최소 10초는 지나야 타이머 종료 처리
  // (재접속 시 오래된 gameStartTime으로 인한 즉시 종료 방지)
  if (_clientGameJoinTime && Date.now() - _clientGameJoinTime < 10000) return;
  _gameReady = false;
  const gs = _latestGameState;

  const sumHp = key => ['left', 'king', 'right'].reduce((acc, pos) => {
    const t = gs[key]?.towers?.[pos];
    return acc + (t?.alive !== false ? (t?.hp || 0) : 0);
  }, 0);
  const kingHp = key => {
    const t = gs[key]?.towers?.king;
    return t?.alive !== false ? (t?.hp || 0) : 0;
  };

  const myHp    = sumHp(_localKey);
  const enemyHp = sumHp(_enemyKey);
  let winner;
  if (myHp !== enemyHp) {
    winner = myHp > enemyHp ? _localKey : _enemyKey;
  } else {
    // 총 HP 동점 → 킹 타워 HP 비교
    const myKing    = kingHp(_localKey);
    const enemyKing = kingHp(_enemyKey);
    if (myKing !== enemyKing) winner = myKing > enemyKing ? _localKey : _enemyKey;
    else                       winner = 'draw';
  }

  _cancelDisconnectHandler();
  turnsCleanup(); syncCleanup(); effectsCleanup(); energyCleanup();
  writeWinner(winner, 'timeout');
  _showMatchEndAnimation(() => {
    winShowResult(winner, 'timeout', _localKey, _buildResultStats(winner, gs));
  });
}

// ── 게임 상태 캐시 ───────────────────────────────────────────
let _latestGameState = null;
window.getGameState = () => _latestGameState;
let _gameReady = false;
let _spectatorNickname = null;
let _latestSpectatorGs = null;
let _p1Name = 'P1';
let _p2Name = 'P2';
let _spectatorDotIntervals = {};

function _buildResultStats(winner, gs) {
  if (!gs) return null;
  const isDraw  = winner === 'draw';
  const side1   = isDraw ? 'p1' : winner;
  const side2   = isDraw ? 'p2' : (winner === 'p1' ? 'p2' : 'p1');
  const countDestroyed = key => {
    const opKey = key === 'p1' ? 'p2' : 'p1';
    const towers = gs[opKey]?.towers || {};
    return ['left', 'king', 'right'].filter(p => towers[p]?.alive === false).length;
  };
  return {
    isDraw,
    winnerName:    side1 === 'p1' ? _p1Name : _p2Name,
    loserName:     side2 === 'p1' ? _p1Name : _p2Name,
    winnerTowers:  countDestroyed(side1),
    loserTowers:   countDestroyed(side2),
    winnerMaxDmg:  gs[side1]?.stats?.totalDmg  || 0,
    loserMaxDmg:   gs[side2]?.stats?.totalDmg  || 0,
    winnerMaxHeal: gs[side1]?.stats?.totalHeal || 0,
    loserMaxHeal:  gs[side2]?.stats?.totalHeal || 0,
  };
}

// ── 탭/창 종료 시 온라인 레코드 즉시 제거 (Firebase onDisconnect 보조) ──────
window.addEventListener('pagehide', () => {
  if (sessionStorage.getItem('_nav')) { sessionStorage.removeItem('_nav'); return; }
  const nick = sessionStorage.getItem('nickname');
  if (!nick || _isSpectator) return;
  try { db.ref(`players/${nick}`).remove(); } catch (e) {}
});

// ── 진입점 ───────────────────────────────────────────────────
(function init() {
  if (!_roomCode) {
    alert(t('invalidAccess'));
    location.href = 'index.html';
    return;
  }

  syncInit(_roomCode);

  // 로비로 돌아가기
  document.getElementById('btn-return-lobby').addEventListener('click', () => {
    if (_isSpectator) {
      _spectatorCleanup();
    } else {
      _stopMatchTimer();
      _cancelDisconnectHandler();
      turnsCleanup();
      syncCleanup();
      effectsCleanup();
      energyCleanup();
      const nick = sessionStorage.getItem('nickname');
      if (nick) db.ref(`players/${nick}`).remove();
    }
    sessionStorage.setItem('_nav', '1');
    location.href = 'index.html';
  });

  if (_isSpectator) {
    _initSpectatorMode();
    return;
  }

  if (!_playerRole) {
    alert(t('invalidAccess'));
    location.href = 'index.html';
    return;
  }

  // 대기실 초기화
  initWaitingRoom(_roomCode, _playerRole);
})();

// ── 로딩 화면 2초 애니메이션 ─────────────────────────────────
function _runLoadingScreen(callback) {
  const bar = document.getElementById('loading-bar');
  const pct = document.getElementById('loading-pct');
  if (!bar || !pct) { callback(); return; }

  const DURATION = 2000;
  const startTime = Date.now();

  function tick() {
    const elapsed  = Date.now() - startTime;
    const progress = Math.min(100, Math.round((elapsed / DURATION) * 100));
    bar.style.width  = progress + '%';
    pct.textContent  = progress + '%';
    if (progress < 100) {
      requestAnimationFrame(tick);
    } else {
      callback();
    }
  }
  requestAnimationFrame(tick);
}

// ── READY / GO 애니메이션 ────────────────────────────────────
function _showReadyGoAnimation(callback) {
  const overlay = document.getElementById('ready-go-overlay');
  const readyEl = document.getElementById('ready-text');
  const goEl    = document.getElementById('go-text');
  if (!overlay || !readyEl || !goEl) { callback(); return; }

  // 초기 상태 리셋
  readyEl.textContent = 'Ready!';
  readyEl.className   = 'ready-text';
  goEl.textContent    = 'Cardecx!';
  goEl.className      = 'go-text';
  overlay.style.opacity = '';
  overlay.classList.remove('hidden');

  // Phase 1: READY 슬라이드 인
  requestAnimationFrame(() => {
    readyEl.classList.add('slide-in');

    setTimeout(() => {
      // Phase 2: READY 슬라이드 아웃
      readyEl.classList.remove('slide-in');
      readyEl.classList.add('slide-out');

      setTimeout(() => {
        readyEl.style.display = 'none';

        // Phase 3: GO 팝
        goEl.classList.add('pop');

        setTimeout(() => {
          // 오버레이 페이드 아웃
          overlay.style.transition = 'opacity 0.35s ease';
          overlay.style.opacity = '0';
          setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.style.transition = '';
            overlay.style.opacity   = '';
            readyEl.style.display   = '';
            readyEl.textContent     = 'Ready!';
            goEl.textContent        = 'Cardecx!';
            callback();
          }, 350);
        }, 700); // GO 팝 유지 시간
      }, 320); // READY 슬라이드 아웃 시간
    }, 950); // READY 표시 시간 (슬라이드인 450ms + 정지 500ms)
  });
}

// ── 오버타임 애니메이션 (GO!와 동일 스타일, 흰색, 블러 없음) ──
function _showOvertimeAnimation(onDone) {
  const msgEl     = document.getElementById('overtime-message');
  const timerIcon = document.querySelector('#match-timer-wrap .timer-icon-inline');
  if (!msgEl) { if (onDone) onDone(); return; }

  if (timerIcon) timerIcon.style.display = 'none';

  msgEl.textContent = 'Over Time!';
  msgEl.className   = 'overtime-message';
  void msgEl.offsetWidth;
  msgEl.classList.add('show');

  setTimeout(() => {
    msgEl.style.transition = 'opacity 0.5s ease';
    msgEl.style.opacity    = '0';
    setTimeout(() => {
      msgEl.style.transition = '';
      msgEl.style.opacity    = '';
      msgEl.className        = 'overtime-message';
      msgEl.textContent      = '';
      if (timerIcon) timerIcon.style.display = '';
      if (onDone) onDone();
    }, 500);
  }, 2000);
}

// ── 매치종료 애니메이션 ──
function _showMatchEndAnimation(onComplete) {
  _stopMatchTimer();
  const timerWrap = document.getElementById('match-timer-wrap');
  if (timerWrap) timerWrap.style.display = 'none';

  const overlay = document.getElementById('ready-go-overlay');
  const readyEl = document.getElementById('ready-text');
  const goEl    = document.getElementById('go-text');
  if (!overlay || !readyEl || !goEl) { onComplete(); return; }

  readyEl.textContent = 'Match Over!';
  readyEl.className   = 'ready-text match-end-mode';
  goEl.style.display  = 'none';
  overlay.style.opacity = '';
  overlay.classList.remove('hidden', 'no-blur');

  requestAnimationFrame(() => {
    readyEl.classList.add('slide-in');

    setTimeout(() => {
      readyEl.classList.remove('slide-in');
      readyEl.classList.add('slide-out');

      setTimeout(() => {
        overlay.style.transition = 'opacity 0.4s ease';
        overlay.style.opacity    = '0';
        setTimeout(() => {
          overlay.classList.add('hidden');
          overlay.style.transition = '';
          overlay.style.opacity    = '';
          readyEl.style.display    = '';
          readyEl.textContent      = 'Ready!';
          readyEl.className        = 'ready-text';
          goEl.textContent         = 'Cardecx!';
          goEl.className           = 'go-text';
          goEl.style.display       = '';
          if (timerWrap) timerWrap.style.display = '';
          onComplete();
        }, 400);
      }, 320);
    }, 950);
  });
}

// ── room.js에서 gameState 초기화 완료 시 호출 ────────────────
function startGame(roomCode, playerRole, roomData) {
  // 로딩 시작 즉시 onDisconnect 등록 (대기실 핸들러 교체)
  _setupDisconnectHandler();
  showGameScreen('screen-loading');
  _runLoadingScreen(() => _doStartGame(roomCode, playerRole, roomData));
}

function _doStartGame(roomCode, playerRole, roomData) {
  showGameScreen('screen-game');

  // HUD 플레이어 이름 표시
  _p1Name = roomData.players?.p1?.name || 'P1';
  _p2Name = roomData.players?.p2?.name || 'P2';
  const p1Name = _p1Name, p2Name = _p2Name;
  const myName    = playerRole === 'p1' ? p1Name : p2Name;
  const enemyName = playerRole === 'p1' ? p2Name : p1Name;

  const cardMyName    = document.getElementById('card-panel-my-name');
  const cardEnemyName = document.getElementById('card-panel-enemy-name');
  if (cardMyName)    cardMyName.textContent    = myName;
  if (cardEnemyName) cardEnemyName.textContent = enemyName;

  // 모듈 초기화
  _gameReady = false;
  boardInit(_localKey, _enemyKey);
  setupDragTargets();
  energyInit(_localKey, 100);
  deckInit(_localKey, _enemyKey);
  turnsInit(_localKey);
  winInit(_localKey, _enemyKey);
  effectsInit(_localKey, _enemyKey);

  // 스탯 추적 초기화
  statsInit(_localKey);

  // 내 칭호 표시 + Firebase에 기록
  const myClanEl = document.getElementById('my-clan-text');
  const myTitle  = localStorage.getItem('cardecx_title') || '타이틀 없음';
  if (myClanEl) myClanEl.textContent = myTitle;
  writePlayerTitle(_localKey, myTitle);

  // 초기 게임 상태 보드에 렌더링 (애니메이션 뒤에 배경으로 보임)
  const gs = roomData.gameState;
  if (gs) _applyFullGameState(gs);
  _gameReady = false; // 애니메이션 끝나기 전까지 게임 로직 차단

  // READY / GO 애니메이션 → 종료 후 타이머·리스너 시작
  _showReadyGoAnimation(() => {
    _timerEnded = false;
    _clientGameJoinTime = Date.now();
    window.overtimeActive = false;
    // GO! 애니메이션이 끝난 바로 이 시점을 타이머 기준점으로 사용
    _initMatchTimer(serverNow());
    _listenSpectatorCount();
    _gameReady = true;
    _attachListeners();
    turnsStartOffering(); // 독립 카드 제공 시작
  });
}

function _renderEnemyEnergy(val) {
  const bar = document.getElementById('enemy-energy-bar');
  const num = document.getElementById('enemy-energy-value');
  if (bar) bar.style.width = ((val / 100) * 100) + '%';
  if (num) num.textContent = val;
}

function _updateCrownCounts(gs) {
  const countDead = key => {
    const towers = gs[key]?.towers || {};
    return ['left', 'king', 'right'].filter(p => towers[p]?.alive === false).length;
  };
  const myEl    = document.getElementById('my-crown-count');
  const enemyEl = document.getElementById('enemy-crown-count');
  if (myEl)    myEl.textContent    = countDead(_enemyKey);
  if (enemyEl) enemyEl.textContent = countDead(_localKey);
}

function _applyFullGameState(gs) {
  _latestGameState = gs;
  boardUpdateState(gs);
  deckUpdateState(gs);
  effectsUpdateState(gs);

  // 타워 렌더링
  applyTowersSnapshot('my',    effectsClampTowers(_localKey, gs[_localKey]?.towers));
  applyTowersSnapshot('enemy', effectsClampTowers(_enemyKey, gs[_enemyKey]?.towers));

  // 덱 복구
  deckApplySnapshot(gs[_localKey]?.deck);

  // 에너지 복구
  if (gs[_localKey]?.energy !== undefined) {
    syncEnergyFromRemote(gs[_localKey].energy);
  }

  // DOT 인디케이터 업데이트
  _refreshDotIndicators(gs.dots);

  // 동결 UI 업데이트
  _updateFreezeUI(gs);

  // 적 에너지 / 크라운 카운트 업데이트
  if (gs[_enemyKey]?.energy !== undefined) _renderEnemyEnergy(gs[_enemyKey].energy);
  _updateCrownCounts(gs);

  // 에너지 버스트 상태 확인 (호박마차 카드 사용 후 재접속 복구)
  const burstUntil = gs[_localKey]?.energyBurstUntil;
  if (burstUntil && typeof energyCheckBurst === 'function') {
    energyCheckBurst(burstUntil, gs[_localKey]?.energyBurstPerTick || 10);
  }

  // 이미 종료된 게임 복구
  if (gs.winner) {
    _stopMatchTimer();
    _cancelDisconnectHandler();
    winShowResult(gs.winner, gs.winReason, _localKey, _buildResultStats(gs.winner, gs));
    turnsCleanup();
    syncCleanup();
    effectsCleanup();
    energyCleanup();
    // 연결 끊김 등으로 방이 아직 남아 있는 경우 백업 삭제
    setTimeout(() => db.ref(`rooms/${_roomCode}`).remove(), 20000);
    return;
  }

  _gameReady = true;
}

function _attachListeners() {
  // 상대방 칭호 실시간 감청
  listenPlayerTitle(_enemyKey, title => {
    const enemyClanEl = document.getElementById('enemy-clan-text');
    if (enemyClanEl) enemyClanEl.textContent = title || '타이틀 없음';
  });

  // 게임 상태 전체 감청
  listenGameState(gs => {
    if (!gs) return;
    _latestGameState = gs;
    boardUpdateState(gs);
    deckUpdateState(gs);
    effectsUpdateState(gs);

    applyTowersSnapshot('my',    effectsClampTowers(_localKey, gs[_localKey]?.towers));
    applyTowersSnapshot('enemy', effectsClampTowers(_enemyKey, gs[_enemyKey]?.towers));

    if (gs[_localKey]?.energy !== undefined) {
      syncEnergyFromRemote(gs[_localKey].energy);
    }

    // 에너지 버스트 상태 감지 (호박마차 카드 사용 시)
    const burstUntil = gs[_localKey]?.energyBurstUntil;
    if (burstUntil && typeof energyCheckBurst === 'function') {
      energyCheckBurst(burstUntil, gs[_localKey]?.energyBurstPerTick || 10);
    }

    _refreshDotIndicators(gs.dots);
    _updateFreezeUI(gs);

    // 적 에너지 / 크라운 카운트 업데이트
    if (gs[_enemyKey]?.energy !== undefined) _renderEnemyEnergy(gs[_enemyKey].energy);
    _updateCrownCounts(gs);

    // 킹 타워 파괴 승리 조건 감지
    if (_gameReady) winCheckTowers(gs);

    // 상대방 disconnect flag 감지 → HP 비교로 승자 결정
    if (_gameReady && gs[`${_enemyKey}Disconnected`] && !gs.winner) {
      _handleDisconnectWin(gs);
    }
  });

  // 내 제공 카드 감청
  listenOfferedCards(_localKey, cards => {
    const myTurn = isMyTurn();
    renderOfferedCards(cards, myTurn);
  });

  // dots 감청 (effects.js 인터벌 관리 + UI 뱃지 갱신)
  listenDots(dots => {
    effectsApplyDots(dots);
    _refreshDotIndicators(dots);
  });

  // 이모티콘 감청
  listenEmoji(_localKey, data => {
    if (data?.emoji) _showBubble('my-king', data.emoji);
  });
  listenEmoji(_enemyKey, data => {
    if (data?.emoji) _showBubble('enemy-king', data.emoji);
  });

  // 채팅 감청
  listenChat(_localKey, data => {
    if (data?.text) _showBubble('my-king', data.text);
  });
  listenChat(_enemyKey, data => {
    if (data?.text) _showBubble('enemy-king', data.text);
  });

  // 승자 감청
  let _skipFirstWinner = true;
  listenWinner(winner => {
    if (_skipFirstWinner) {
      _skipFirstWinner = false;
      return;
    }
    if (!winner) return;
    if (!_gameReady) return;
    _gameReady = false;
    const gs     = _latestGameState;
    const reason = gs?.winReason;
    _stopMatchTimer();
    _cancelDisconnectHandler();
    turnsCleanup();
    syncCleanup();
    effectsCleanup();
    energyCleanup();
    setTimeout(() => db.ref(`rooms/${_roomCode}`).remove(), 20000);

    if (reason === 'disconnect') {
      winShowResult(winner, reason, _localKey, _buildResultStats(winner, gs));
    } else {
      _showMatchEndAnimation(() => {
        winShowResult(winner, reason, _localKey, _buildResultStats(winner, gs));
      });
    }
  });

  // 즉시 피해 플로팅 숫자 표시
  listenInstantHits((snap, hit) => {
    if (!hit) return;
    const owner = hit.targetPlayer === _localKey ? 'my' : 'enemy';
    if (hit.type === 'mirrorWarn') {
      const towerEl = document.getElementById(`tower-${owner}-${hit.targetTower}`);
      if (towerEl && typeof showMirrorWarning === 'function') {
        showMirrorWarning(towerEl, () => {});
      }
      if (hit.sourcePlayer === _localKey) {
        setTimeout(() => snap.ref.remove(), 3500);
      }
      return;
    }
    showTowerHit(owner, hit.targetTower, hit.amount, hit.type);
    // 소스 플레이어가 300ms 후 삭제
    if (hit.sourcePlayer === _localKey) {
      setTimeout(() => snap.ref.remove(), 300);
    }
  });
}

// ── 연결 끊김 처리 ───────────────────────────────────────────

function _setupDisconnectHandler() {
  // 대기실에서 등록된 onDisconnect 취소
  if (_playerRole === 'p1') {
    db.ref(`rooms/${_roomCode}`).onDisconnect().cancel();
  } else {
    db.ref(`rooms/${_roomCode}/players/p2`).onDisconnect().cancel();
    db.ref(`rooms/${_roomCode}/playerCount`).onDisconnect().cancel();
  }
  // 연결 끊기면 disconnect flag + 방 즉시 로비에서 숨기기 (승자는 남은 클라이언트가 HP 비교 후 결정)
  db.ref(`rooms/${_roomCode}/gameState/${_localKey}Disconnected`).onDisconnect().set(true);
  db.ref(`rooms/${_roomCode}/status`).onDisconnect().set('finished');
  // 게임 탭이 닫히면 플레이어 노드도 정리 (중복 닉네임 방지)
  const _nick = sessionStorage.getItem('nickname');
  if (_nick) db.ref(`players/${_nick}`).onDisconnect().remove();
}

function _cancelDisconnectHandler() {
  db.ref(`rooms/${_roomCode}/gameState/${_localKey}Disconnected`).onDisconnect().cancel();
  db.ref(`rooms/${_roomCode}/status`).onDisconnect().cancel();
  // 결과 화면에서 탭 닫아도 오프라인 처리되도록 player onDisconnect는 .remove()로 유지
  const _nick = sessionStorage.getItem('nickname');
  if (_nick) db.ref(`players/${_nick}`).onDisconnect().remove();
}

function _handleDisconnectWin(gs) {
  if (!_gameReady) return;
  _gameReady = false; // 중복 실행 방지
  const myKingHp    = gs[_localKey]?.towers?.king?.hp ?? 0;
  const enemyKingHp = gs[_enemyKey]?.towers?.king?.hp ?? 0;
  let winner;
  if      (myKingHp > enemyKingHp) winner = _localKey;
  else if (enemyKingHp > myKingHp) winner = _enemyKey;
  else                              winner = 'draw';

  _stopMatchTimer();
  _cancelDisconnectHandler();
  winShowResult(winner, 'disconnect', _localKey, _buildResultStats(winner, gs));
  turnsCleanup();
  syncCleanup();
  effectsCleanup();
  energyCleanup();
  setTimeout(() => db.ref(`rooms/${_roomCode}`).remove(), 20000);

  writeWinner(winner, 'disconnect'); // 관전자·상대방 클라이언트를 위해 기록
}

// ── 이모티콘 패널 ─────────────────────────────────────────────

let _emojiCooldown = false;

function _initEmojiPanel() {
  const btn   = document.getElementById('btn-emoji');
  const panel = document.getElementById('emoji-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    if (_emojiCooldown) return;
    panel.classList.toggle('hidden');
  });

  panel.querySelectorAll('.emoji-btn').forEach(emojiBtn => {
    emojiBtn.addEventListener('click', () => {
      const emoji = emojiBtn.dataset.emoji;
      panel.classList.add('hidden');
      _sendEmoji(emoji);
    });
  });

  // 패널 외부 클릭 시 닫기
  document.addEventListener('click', e => {
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.add('hidden');
    }
  });
}

function _sendEmoji(emoji) {
  if (_emojiCooldown) return;
  _emojiCooldown = true;
  const btn = document.getElementById('btn-emoji');
  if (btn) btn.classList.add('on-cooldown');
  writeEmoji(_localKey, emoji);
  setTimeout(() => {
    clearEmoji(_localKey);
    _emojiCooldown = false;
    if (btn) btn.classList.remove('on-cooldown');
  }, 5000);
}

// ── 말풍선 스태킹 ─────────────────────────────────────────────
const _bubbleTimers = {};

function _showBubble(towerKey, content) {
  const lower = document.getElementById(`bubble-${towerKey}`);
  const upper = document.getElementById(`bubble-${towerKey}-upper`);
  if (!lower) return;

  // 현재 lower가 보이는 상태면 upper로 밀어올리기
  if (lower.classList.contains('visible') && upper) {
    clearTimeout(_bubbleTimers[towerKey + '_upper']);
    upper.textContent = lower.textContent;
    upper.classList.add('visible');
  }

  // lower에 새 내용 표시
  lower.textContent = content;
  lower.classList.add('visible');

  // 기존 lower 타이머 초기화
  clearTimeout(_bubbleTimers[towerKey]);

  // 5초 후: lower 숨기고 upper를 lower로 내려옴
  _bubbleTimers[towerKey] = setTimeout(() => {
    lower.classList.remove('visible');
    if (upper && upper.classList.contains('visible')) {
      clearTimeout(_bubbleTimers[towerKey + '_upper']);
      setTimeout(() => {
        lower.textContent = upper.textContent;
        upper.classList.remove('visible');
        upper.textContent = '';
        lower.classList.add('visible');
        _bubbleTimers[towerKey] = setTimeout(() => {
          lower.classList.remove('visible');
        }, 5000);
      }, 280);
    }
  }, 5000);
}

// ── 채팅 입력 ─────────────────────────────────────────────────
let _chatCooldown = false;

function _initChatInput() {
  const input  = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-chat-send');
  if (!input || !sendBtn) return;

  sendBtn.addEventListener('click', () => _sendChat(input));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') _sendChat(input);
  });
}

function _sendChat(input) {
  if (_chatCooldown) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  _chatCooldown = true;
  writeChat(_localKey, text);

  setTimeout(() => {
    clearChat(_localKey);
    _chatCooldown = false;
  }, 5500);
}

// ── 화면 자동 핏 + 줌 (Ctrl +/-, Ctrl+휠) ───────────────────
(function initZoom() {
  const GAME_W = 480, GAME_H = 854;
  const STEP = 0.1, MIN = 0.5, MAX = 2.0;
  let manualZoom = 1.0;

  function applyZoom() {
    const el = document.getElementById('screen-game');
    if (!el) return;
    const fitScale = Math.min(window.innerWidth / GAME_W, window.innerHeight / GAME_H);
    const scale = +(fitScale * manualZoom).toFixed(3);
    el.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  // 뷰포트 크기 변화 시 자동 재계산
  window.addEventListener('resize', applyZoom);
  applyZoom();

  document.addEventListener('keydown', e => {
    // '.' 키: 채팅/이모티콘 UI 토글 (입력 필드에 포커스 중일 때는 무시)
    if (e.key === '.' && !e.ctrlKey && !e.altKey) {
      const tag = document.activeElement?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        const overlay = document.querySelector('.chat-center-overlay');
        if (overlay) overlay.classList.toggle('chat-hidden');
      }
    }

    if (!e.ctrlKey) return;
    if (e.key === '+' || e.key === '=' || e.key === 'Add') {
      e.preventDefault();
      manualZoom = Math.min(MAX, +(manualZoom + STEP).toFixed(2));
      applyZoom();
    } else if (e.key === '-' || e.key === 'Subtract') {
      e.preventDefault();
      manualZoom = Math.max(MIN, +(manualZoom - STEP).toFixed(2));
      applyZoom();
    } else if (e.key === '0') {
      e.preventDefault();
      manualZoom = 1.0;
      applyZoom();
    }
  });

  document.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    manualZoom = Math.min(MAX, Math.max(MIN, +(manualZoom + (e.deltaY < 0 ? STEP : -STEP)).toFixed(2)));
    applyZoom();
  }, { passive: false });
})();

// ── 동결 UI 업데이트 ──────────────────────────────────────────

let _freezeClearTimers    = { my: null, enemy: null };
let _freezeCountdownTimer = null;

function _updateFreezeUI(gs) {
  const now = serverNow();
  _applyFreezeForPlayer('my',    gs?.[_localKey]?.deckFreezeUntil, now);
  _applyFreezeForPlayer('enemy', gs?.[_enemyKey]?.deckFreezeUntil, now);
}

function _applyFreezeForPlayer(side, freezeUntil, now) {
  const isFrozen  = freezeUntil && now < freezeUntil;
  const iconId    = side === 'my' ? 'my-freeze-icon' : 'enemy-freeze-icon';
  const slotsEl   = document.getElementById('deck-slots');
  const overlayEl = document.getElementById('deck-freeze-overlay');

  const iconEl = document.getElementById(iconId);
  if (iconEl) iconEl.classList.toggle('hidden', !isFrozen);

  if (side === 'my') {
    if (slotsEl)   slotsEl.classList.toggle('deck-blurred', !!isFrozen);
    if (overlayEl) overlayEl.classList.toggle('hidden', !isFrozen);

    // 카운트다운 인터벌 (내 덱이 얼었을 때만)
    if (_freezeCountdownTimer) {
      clearInterval(_freezeCountdownTimer);
      _freezeCountdownTimer = null;
    }
    if (isFrozen) {
      _updateFreezeCountdown(freezeUntil);
      _freezeCountdownTimer = setInterval(() => {
        if (serverNow() >= freezeUntil) {
          clearInterval(_freezeCountdownTimer);
          _freezeCountdownTimer = null;
        } else {
          _updateFreezeCountdown(freezeUntil);
        }
      }, 200);
    }
  }

  if (_freezeClearTimers[side]) {
    clearTimeout(_freezeClearTimers[side]);
    _freezeClearTimers[side] = null;
  }
  if (isFrozen) {
    _freezeClearTimers[side] = setTimeout(() => {
      if (iconEl) iconEl.classList.add('hidden');
      if (side === 'my') {
        if (slotsEl)   slotsEl.classList.remove('deck-blurred');
        if (overlayEl) overlayEl.classList.add('hidden');
      }
    }, freezeUntil - now + 50);
  }
}

function _updateFreezeCountdown(freezeUntil) {
  const el   = document.getElementById('freeze-countdown-text');
  if (!el) return;
  const secs = Math.max(0, Math.ceil((freezeUntil - serverNow()) / 1000));
  el.textContent = secs + 's';
}

// ── DOT 인디케이터 ────────────────────────────────────────────

function _refreshDotIndicators(dots) {
  const towerDots = {
    my:    { left: [], king: [], right: [] },
    enemy: { left: [], king: [], right: [] }
  };

  Object.entries(dots || {}).forEach(([dotId, dot]) => {
    // 로컬에서 이미 마지막 틱이 발사된 dot은 Firebase 삭제 전이라도 뱃지 표시 안 함
    if (typeof isLocalDotFinished === 'function' && isLocalDotFinished(dotId)) return;
    const owner = dot.targetPlayer === _localKey ? 'my' : 'enemy';
    if (towerDots[owner][dot.targetTower]) {
      towerDots[owner][dot.targetTower].push(dot);
    }
  });

  ['left', 'king', 'right'].forEach(pos => {
    updateDotIndicator('my',    pos, towerDots.my[pos]);
    updateDotIndicator('enemy', pos, towerDots.enemy[pos]);
  });
}

// ════════════════════════════════════════════════════════════
//  관전 모드
// ════════════════════════════════════════════════════════════

async function _initSpectatorMode() {
  _spectatorNickname = sessionStorage.getItem('nickname');
  showGameScreen('screen-loading');

  try {
    const snap = await db.ref(`rooms/${_roomCode}`).once('value');
    const roomData = snap.val();

    if (!roomData || roomData.status !== 'playing') {
      location.href = 'index.html';
      return;
    }

    if (_spectatorNickname) {
      writeSpectatorJoin(_spectatorNickname);
    }

    _runLoadingScreen(() => _doSpectateGame(roomData));
  } catch (e) {
    console.error('관전 초기화 오류:', e);
    location.href = 'index.html';
  }
}

function _doSpectateGame(roomData) {
  showGameScreen('screen-game');

  _p1Name = roomData.players?.p1?.name || 'P1';
  _p2Name = roomData.players?.p2?.name || 'P2';
  const p1Name = _p1Name, p2Name = _p2Name;

  // P1 = 내 영역(하단), P2 = 적 영역(상단)
  const cardMyName    = document.getElementById('card-panel-my-name');
  const cardEnemyName = document.getElementById('card-panel-enemy-name');
  if (cardMyName)    cardMyName.textContent    = p1Name;
  if (cardEnemyName) cardEnemyName.textContent = p2Name;

  // 보드 초기화 (P1 시점)
  boardInit('p1', 'p2');

  // 관전 모드 UI 적용
  document.getElementById('screen-game').classList.add('spectator-mode');

  // 관전자 덱 2행 UI 초기화
  _initSpectatorDeckUI(p1Name, p2Name);

  // 초기 게임 상태 적용
  const gs = roomData.gameState;
  if (gs) {
    _latestSpectatorGs = gs;
    boardUpdateState(gs);
    applyTowersSnapshot('my',    gs['p1']?.towers);
    applyTowersSnapshot('enemy', gs['p2']?.towers);
    const initIsP1Turn = ((gs.turnNumber || 0) % 2 === 0);
    updateHudTurnDisplay(initIsP1Turn);
    _refreshDotIndicatorsForSpectator(gs.dots);
    _renderSpectatorDeckRow('p1', gs['p1']?.deck);
    _renderSpectatorDeckRow('p2', gs['p2']?.deck);

    // 이미 종료된 게임 처리
    if (gs.winner) {
      _showSpectatorEnd(gs.winner, gs.winReason);
      return;
    }
  }

  _attachSpectatorListeners();
  _listenSpectatorCount();
}

function _initSpectatorDeckUI(p1Name, p2Name) {
  const wrapper = document.querySelector('.deck-area-wrapper');
  if (!wrapper) return;
  const label1 = p1Name.length > 6 ? p1Name.slice(0, 5) + '…' : p1Name;
  const label2 = p2Name.length > 6 ? p2Name.slice(0, 5) + '…' : p2Name;
  const slots = i => [0,1,2,3,4].map(n => `<div class="deck-slot" data-slot="${n}"></div>`).join('');
  wrapper.innerHTML = `
    <div class="spec-deck-section">
      <div class="spec-deck-row">
        <span class="spec-deck-label" title="${p1Name}">${label1}</span>
        <div class="spec-deck-slots" id="spec-deck-p1">${slots()}</div>
      </div>
      <div class="spec-deck-row">
        <span class="spec-deck-label" title="${p2Name}">${label2}</span>
        <div class="spec-deck-slots" id="spec-deck-p2">${slots()}</div>
      </div>
    </div>
  `;
}

function _renderSpectatorDeckRow(playerKey, deckData) {
  const id = playerKey === 'p1' ? 'spec-deck-p1' : 'spec-deck-p2';
  const container = document.getElementById(id);
  if (!container) return;
  container.querySelectorAll('.deck-slot').forEach((slotEl, i) => {
    slotEl.innerHTML = '';
    const item = deckData?.[i];
    if (!item) return;
    const card = CARD_DEFINITIONS[item.cardId];
    if (!card) return;
    const el = document.createElement('div');
    el.className = `card grade-${card.grade}`;
    el.innerHTML = `
      <div class="card-icon">${card.icon}</div>
      <div class="card-name">${tCard(card.id, 'name')}</div>
      <div class="card-footer">
        <span class="card-energy-cost">⚡${card.energyCost}</span>
        <span class="card-grade-dot"></span>
      </div>
    `;
    slotEl.appendChild(el);
  });
}

function _refreshDotIndicatorsForSpectator(dots) {
  const td = { my: { left: [], king: [], right: [] }, enemy: { left: [], king: [], right: [] } };
  Object.values(dots || {}).forEach(dot => {
    const owner = dot.targetPlayer === 'p1' ? 'my' : 'enemy';
    if (td[owner]?.[dot.targetTower]) td[owner][dot.targetTower].push(dot);
  });
  ['left', 'king', 'right'].forEach(pos => {
    updateDotIndicator('my',    pos, td.my[pos]);
    updateDotIndicator('enemy', pos, td.enemy[pos]);
  });
}

function _attachSpectatorListeners() {
  // 전체 게임 상태 감청
  listenGameState(gs => {
    if (!gs) return;
    _latestSpectatorGs = gs;
    boardUpdateState(gs);
    applyTowersSnapshot('my',    effectsClampTowers('p1', gs['p1']?.towers));
    applyTowersSnapshot('enemy', effectsClampTowers('p2', gs['p2']?.towers));
    const isP1Turn = ((gs.turnNumber || 0) % 2 === 0);
    updateHudTurnDisplay(isP1Turn);
    _refreshDotIndicatorsForSpectator(gs.dots);
  });

  // 즉시 피해 플로팅 숫자
  listenInstantHits((snap, hit) => {
    if (!hit) return;
    const owner = hit.targetPlayer === 'p1' ? 'my' : 'enemy';
    showTowerHit(owner, hit.targetTower, hit.amount, hit.type);
  });

  // 이모티콘/채팅 말풍선
  listenEmoji('p1', data => { if (data?.emoji) _showBubble('my-king', data.emoji); });
  listenEmoji('p2', data => { if (data?.emoji) _showBubble('enemy-king', data.emoji); });
  listenChat('p1',  data => { if (data?.text)  _showBubble('my-king', data.text); });
  listenChat('p2',  data => { if (data?.text)  _showBubble('enemy-king', data.text); });

  // DOT/HOT 틱 플로팅 숫자 (관전자 전용)
  listenDots(dots => _startSpectatorDotVisuals(dots));

  // 양쪽 덱 실시간 감청
  listenDeck('p1', deck => _renderSpectatorDeckRow('p1', deck));
  listenDeck('p2', deck => _renderSpectatorDeckRow('p2', deck));

  // 승자 감청
  let _skipFirst = true;
  listenWinner(winner => {
    if (_skipFirst) { _skipFirst = false; return; }
    if (!winner) return;
    const gs = _latestSpectatorGs;
    _showSpectatorEnd(winner, gs?.winReason);
  });
}

function _listenSpectatorCount() {
  listenSpectators(spectators => {
    const count = spectators ? Object.keys(spectators).length : 0;
    _updateSpectatorCountDisplay(count);
  });
}

function _updateSpectatorCountDisplay(count) {
  const el    = document.getElementById('spectator-count');
  const numEl = document.getElementById('spectator-count-num');
  if (!el || !numEl) return;
  numEl.textContent = count;
  // 관전자 모드이면 항상 표시, 일반 플레이어는 1명 이상일 때만
  if (_isSpectator || count > 0) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function _showSpectatorEnd(winner, reason) {
  syncCleanup();
  _cleanupSpectatorDots();

  const icon  = document.getElementById('result-icon');
  const title = document.getElementById('result-title');
  if (icon) icon.textContent = '👁';
  if (title) {
    if (winner === 'draw') {
      title.textContent = t('drawTitle');
      title.className   = 'result-title draw';
    } else {
      title.textContent = (winner === 'p1' ? _p1Name : _p2Name) + ' 승리!';
      title.className   = 'result-title win';
    }
  }

  const stats = _buildResultStats(winner, _latestSpectatorGs);
  if (stats) _populateResultStats(stats);

  document.getElementById('screen-game')?.classList.add('hidden');
  document.getElementById('screen-game')?.classList.remove('active');
  const rs = document.getElementById('screen-result');
  if (rs) { rs.classList.remove('hidden'); rs.classList.add('active'); }
}

function _spectatorCleanup() {
  if (_spectatorNickname) writeSpectatorLeave(_spectatorNickname);
  syncCleanup();
  _cleanupSpectatorDots();
}

// ── 관전자 DOT/HOT 틱 플로팅 숫자 ───────────────────────────

function _startSpectatorDotVisuals(dotsData) {
  const current = new Set(Object.keys(dotsData || {}));
  Object.keys(_spectatorDotIntervals).forEach(id => {
    if (!current.has(id)) {
      clearInterval(_spectatorDotIntervals[id]);
      delete _spectatorDotIntervals[id];
    }
  });
  Object.entries(dotsData || {}).forEach(([dotId, dot]) => {
    if (_spectatorDotIntervals[dotId]) return;
    const owner = dot.targetPlayer === 'p1' ? 'my' : 'enemy';
    const type  = dot.type === 'damage' ? 'dot' : 'heal';
    _spectatorDotIntervals[dotId] = setInterval(() => {
      if (!_latestSpectatorGs?.dots?.[dotId]) {
        clearInterval(_spectatorDotIntervals[dotId]);
        delete _spectatorDotIntervals[dotId];
        return;
      }
      showTowerHit(owner, dot.targetTower, dot.dmgPerTick, type);
    }, dot.tickInterval);
  });
}

function _cleanupSpectatorDots() {
  Object.values(_spectatorDotIntervals).forEach(clearInterval);
  _spectatorDotIntervals = {};
}
