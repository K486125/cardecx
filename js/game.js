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

// 정상 경로로 들어왔는지 — 입장 표시는 한 번만 쓰고 지운다 (새로고침하면 사라짐)
const _entryToken  = sessionStorage.getItem('_enter');
sessionStorage.removeItem('_enter');
const _validEntry  = _entryToken === location.href;


// ── 화면 전환 ────────────────────────────────────────────────
function showGameScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.add('hidden');
    s.classList.remove('active');
  });
  document.getElementById(id).classList.remove('hidden');
  document.getElementById(id).classList.add('active');
}

// ── 매치 타이머 ─────────────────────────────────────────────
const MATCH_DURATION    = 4 * 60 * 1000; // 4분
const OVERTIME_DURATION =      60 * 1000; // 오버타임 1분
let _matchTimerInterval = null;
let _timerEnded         = false;
let _lastCountdownNum   = -1;
let _matchTimerOrigin   = null; // _initMatchTimer에 전달한 기준 시각
let _matchTimerSynced   = false; // P1 기준 시각으로 1회 동기화 완료 여부
let _prevTowerJson      = { my: null, enemy: null }; // DOM diff용 타워 JSON 캐시
let _countdownCancelId  = null; // _showCountdownNumber 의 pending cleanup timeout ID
window.overtimeActive = false; // 오버타임 진입 여부 (energy.js에서 참조)

function _stopMatchTimer() {
  if (_matchTimerInterval) { clearInterval(_matchTimerInterval); _matchTimerInterval = null; }
}


// 게임 시작 연출 길이 — 양쪽 모두 서버의 gameStartTime + PRE_START_MS를 경기 시작 시각으로 쓴다.
// (각자 로딩이 끝난 시각을 기준으로 하면 늦게 들어온 쪽이 상대 타이머를 되돌린다)
const LOADING_MS   = 2000;
const READY_GO_MS  = 2320;   // _showReadyGoAnimation 총 길이 (950 + 320 + 700 + 350)
const PRE_START_MS = LOADING_MS + READY_GO_MS;

function _initMatchTimer(gameStartTime) {
  if (!gameStartTime) return;
  const timerEl      = document.getElementById('match-timer-display');
  const wrapEl       = document.getElementById('match-timer-wrap');
  const timerIconEl  = document.querySelector('#match-timer-wrap .timer-icon-inline');
  const countdownEl  = document.getElementById('countdown-display');
  if (!timerEl) return;

  const effectiveStart = gameStartTime;

  _matchTimerInterval = setInterval(() => {
    const elapsed   = gameNow() - effectiveStart;
    const remaining = Math.min(MATCH_DURATION, MATCH_DURATION - elapsed);   // 시작 전(연출 생략)엔 4:00 유지

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
        if (wrapEl) { wrapEl.classList.remove('warning'); wrapEl.classList.add('overtime'); }
        timerEl.textContent = '';
        energyEnterOvertimeMode();
        _showOvertimeAnimation(() => {
          // 먼저 끝나는 클라이언트가 기준 시각을 Firebase에 기록 (transaction으로 중복 방지)
          writeOvertimeStart(gameNow()).then(result => {
            if (result?.committed) {
              window.overtimeTimerOrigin = result.snapshot.val();
            }
            // 미commit이면 listenGameState에서 수신해 설정됨
          });
          if (timerEl) timerEl.textContent = '1:00';
        });
      } else if (window.overtimeTimerOrigin) {
        // ── 오버타임 카운트다운 ──
        const otElapsed   = gameNow() - window.overtimeTimerOrigin;
        const otRemaining = Math.max(0, OVERTIME_DURATION - otElapsed);

        const otMins = Math.floor(otRemaining / 60000);
        const otSecs = Math.floor((otRemaining % 60000) / 1000);

        if (otMins === 0 && otSecs <= 15) {
          // 타이머 숨기고 센터 오버레이 카운트다운 (타이머 seconds값과 동일한 숫자)
          if (timerEl.style.display !== 'none') {
            timerEl.style.display = 'none';
            if (timerIconEl) timerIconEl.style.display = 'none';
          }
          const num = otSecs;
          if (num !== _lastCountdownNum) {
            _lastCountdownNum = num;
            _showCountdownNumber(num);
          }
        } else {
          timerEl.style.display = '';
          if (timerIconEl) timerIconEl.style.display = '';
          timerEl.textContent = `${otMins}:${String(otSecs).padStart(2, '0')}`;
        }

        if (otElapsed >= OVERTIME_DURATION && !_timerEnded) {
          _timerEnded = true;
          _stopMatchTimer();
          _requestTimeoutEnd();
        }
      }
    }
  }, 500);
}

// ── 매치 종료 ────────────────────────────────────────────────
// 승자는 DB(gameState/winner)에 트랜잭션으로 한 번만 기록되고, 결과 화면은 두 플레이어·관전자 모두
// DB에 기록된 승자로만 띄운다. 각자 계산한 승자를 바로 보여주면 서로 다른 결과(둘 다 패배 등)가 나온다.
const TIMEOUT_SETTLE_MS = 1000;   // 시간 종료 후 진행 중이던 쓰기가 반영될 때까지 대기
const WINNER_RETRY_MS   = 3000;   // 승자 기록 후 결과가 오지 않으면 재시도
let _matchDecided     = false;    // DB 승자를 받아 결과 처리를 시작했는지
let _timeoutRequested = false;

/** 킹 붕괴 연출이 남은 시간 (연출이 시작된 때부터 잰다 — 승자 확정을 기다린 만큼은 덜 기다린다) */
function _kingFallHoldMs() {
  return typeof boardKingFallLeft === 'function' ? boardKingFallLeft() : (window.KING_FALL_FX_MS || 0);
}

/** 새 행동(카드 사용·DOT 틱·에너지)을 멈춘다 — 리스너는 남겨 DB 승자를 받는다 */
function _lockMatchInput() {
  window.matchInputLocked = true;
  if (typeof unitsHalt === 'function') unitsHalt();   // 리퍼 낫질·걷기·컷씬을 멈춘다 (종료 연출 중 렉 방지)
  botStop();
  deckLockInput();
  castResetCooldown();
  _gameReady = false;
  _freezeCleanup();
  turnsCleanup();
  effectsCleanup();
  pendingHitsCleanup();
  energyCleanup();
}

/** 시간 종료 — 때가 된 DOT 틱까지 처리하고 멈춘 뒤, 진행 중이던 쓰기가 반영되면 경기를 확정한다 */
function _requestTimeoutEnd() {
  if (_matchDecided || _timeoutRequested) return;
  _timeoutRequested = true;
  if (!_isSpectator) effectsFlushDue();
  _lockMatchInput();
  setTimeout(requestMatchEnd, TIMEOUT_SETTLE_MS);
}

/**
 * 경기 확정 — 킹 파괴·시간 종료 모두 이 순서로 끝난다.
 *   1) endedAt 기록(동결) → 이후 타워 쓰기는 규칙이 거부
 *   2) 서버의 동결된 상태를 읽어 승자 판정 → 누가 계산해도 같은 결과
 *   3) 승자 트랜잭션 — 결과가 올 때까지 재시도
 * 결과 화면의 부순 타워·피해량·회복량도 같은 동결 상태로 계산하므로 승자와 어긋나지 않는다.
 */
let _endRequested = false;
function requestMatchEnd() {
  if (_matchDecided || _endRequested) return;
  _endRequested = true;
  _lockMatchInput();

  const attempt = () => {
    if (_matchDecided) return;
    const retry = () => setTimeout(() => { if (!_matchDecided) attempt(); }, WINNER_RETRY_MS);
    freezeMatch()
      .catch(err => console.warn('경기 동결 실패 — 그대로 판정:', err))
      .then(() => readFinalGameState())
      .then(gs => {
        if (!gs || _matchDecided) return;
        if (gs.winner) { _onMatchDecided(gs.winner); return; }
        const { winner, reason } = _decideFinalWinner(gs);
        return writeWinner(winner, reason);
      })
      .then(retry, err => { console.error('경기 확정 실패:', err); retry(); });
  };
  attempt();
}

/**
 * 기권승 — 경기 중 상대가 나갔거나 유예(5초) 안에 돌아오지 않았다 (presence.js).
 * 킹 파괴·시간 종료와 같은 길로 확정한다: 동결 → 서버 상태 확인 → 승자 트랜잭션(재시도).
 * 그 사이 킹이 먼저 무너져 승자가 이미 있으면 그 결과를 따른다.
 * 끊긴 쪽이 쏘아 둔 예약 피해는 동결 전 유예 동안 맞는 쪽(나)이 이미 넣었다 (sync.js pendingHits).
 */
function declareForfeitWin() {
  if (_isSpectator || !_localKey || _matchDecided || _endRequested) return;
  _endRequested = true;
  _lockMatchInput();
  const attempt = () => {
    if (_matchDecided) return;
    const retry = () => setTimeout(() => { if (!_matchDecided) attempt(); }, WINNER_RETRY_MS);
    freezeMatch()
      .catch(err => console.warn('경기 동결 실패 — 그대로 판정:', err))
      .then(() => readFinalGameState())
      .then(gs => {
        if (_matchDecided) return;
        if (gs?.winner) { _onMatchDecided(gs.winner); return; }
        return writeWinner(_localKey, 'disconnect');
      })
      .then(retry, err => { console.error('기권승 확정 실패:', err); retry(); });
  };
  attempt();
}

/** 동결된 상태로 승자 판정 — 킹이 무너졌으면 킹 파괴(둘 다면 무승부), 아니면 시간 종료 판정 */
function _decideFinalWinner(gs) {
  const dead1 = gs?.p1?.towers?.king?.alive === false;
  const dead2 = gs?.p2?.towers?.king?.alive === false;
  if (dead1 || dead2) return { winner: dead1 && dead2 ? 'draw' : (dead1 ? 'p2' : 'p1'), reason: 'king_destroyed' };
  return { winner: _decideTimeoutWinner(gs), reason: 'timeout' };
}

/** 결과 계산용 최종 상태 — 서버 값을 우선, 응답이 없으면 마지막으로 받은 상태 */
function _readResultState(fallback) {
  const timeout = new Promise(r => setTimeout(() => r(fallback), 4000));
  // writeWinner는 승자를 먼저 확정하고 이유(winReason)를 따로 쓴다 — 승자만 먼저 읽히면
  // 기권승이 '시간 종료'로 보인다. 이유가 올 때까지 잠깐(최대 약 1.4초) 다시 읽는다
  const read = (left) => readFinalGameState().then(gs => {
    if (gs && gs.winner && !gs.winReason && left > 0) {
      return new Promise(r => setTimeout(r, 350)).then(() => read(left - 1));
    }
    return gs || fallback;
  }, () => fallback);
  return Promise.race([read(4), timeout]);
}

/** 결과 이유 — winReason은 winner 뒤에 따로 기록되므로 아직 없으면 타워 상태로 판단 */
function _resultReason(gs) {
  return gs?.winReason || (_endedByKing(gs) ? 'king_destroyed' : 'timeout');
}

/** 시간 종료 판정 — 총 HP, 동점이면 킹 HP (p1/p2 기준이라 누가 계산해도 같다) */
function _decideTimeoutWinner(gs) {
  const sumHp = key => ['left', 'king', 'right'].reduce((acc, pos) => {
    const t = gs[key]?.towers?.[pos];
    return acc + (t?.alive !== false ? (t?.hp || 0) : 0);
  }, 0);
  const kingHp = key => {
    const t = gs[key]?.towers?.king;
    return t?.alive !== false ? (t?.hp || 0) : 0;
  };

  const hp1 = sumHp('p1'), hp2 = sumHp('p2');
  if (hp1 !== hp2) return hp1 > hp2 ? 'p1' : 'p2';
  // 총 HP 동점 → 킹 타워 HP 비교
  const k1 = kingHp('p1'), k2 = kingHp('p2');
  if (k1 !== k2) return k1 > k2 ? 'p1' : 'p2';
  return 'draw';
}

/** DB에 승자가 기록됨 — 모든 종료 경로(킹 파괴·시간 종료·재진입)가 여기로 모인다 */
function _onMatchDecided(winner) {
  if (_matchDecided || !winner) return;
  _matchDecided = true;
  _lockMatchInput();
  _stopMatchTimer();
  _cancelDisconnectHandler();
  _cleanupEmojiPanel();
  clearMirrorWarnings();
  syncCleanup();
  ensureRoomFinished();   // 승자 기록 후 status 갱신이 실패했어도 방이 'playing'에 남지 않도록

  // 결과는 서버의 최종 상태로 — 상대 타워의 예상 표시(아직 확정 안 된 DOT 등)가 아니라 실제 값.
  // 보드도 최종 상태로 맞춰 결과 화면과 어긋나 보이지 않게 한다.
  _readResultState(_latestGameState).then(gs => {
    if (gs) {
      _latestGameState = gs;
      applyTowersSnapshot('my',    gs[_localKey]?.towers);
      applyTowersSnapshot('enemy', gs[_enemyKey]?.towers);
      _updateCrownCounts(gs);
    }
    const reason = _resultReason(gs);
    // 킹 파괴 종료는 붕괴·빛 폭발이 블러 오버레이에 가려지지 않도록 연출이 끝날 때까지 대기
    const holdMs = _endedByKing(gs) ? _kingFallHoldMs() : 0;
    setTimeout(() => {
      _showMatchEndAnimation(() => {
        winShowResult(winner, reason, _localKey, _buildResultStats(winner, gs));
      });
    }, holdMs);
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
/** 자리 → 이름 (컷씬에 소환한 사람을 띄운다) */
function matchPlayerName(key) { return key === 'p1' ? _p1Name : key === 'p2' ? _p2Name : ''; }
let _spectatorDotIntervals = {};

/**
 * 킹 파괴로 끝난 판인지 — 타워 상태로 판정한다.
 * writeWinner는 winner를 먼저 커밋하고 winReason은 별도 update로 나중에 쓰므로,
 * winner 수신 시점엔 winReason이 아직 없을 수 있다. 킹 사망은 winner보다 먼저 도착한다.
 */
function _endedByKing(gs) {
  return gs?.p1?.towers?.king?.alive === false || gs?.p2?.towers?.king?.alive === false;
}

/** 파괴된 타워 수 — 킹이 무너지면 연쇄 폭발로 3개 모두 파괴로 센다 */
function _countDestroyedTowers(towers) {
  towers = towers || {};
  if (towers.king?.alive === false) return 3;
  return ['left', 'king', 'right'].filter(p => towers[p]?.alive === false).length;
}

function _buildResultStats(winner, gs) {
  if (!gs) return null;
  const isDraw  = winner === 'draw';
  const side1   = isDraw ? 'p1' : winner;
  const side2   = isDraw ? 'p2' : (winner === 'p1' ? 'p2' : 'p1');
  const opp = key => (key === 'p1' ? 'p2' : 'p1');
  const countDestroyed = key => _countDestroyedTowers(gs[opp(key)]?.towers);
  // 피해·회복은 타워에 HP와 함께 원자적으로 누적된 값 (sync.js _towerDamage/_towerHeal)
  const towerSum = (key, field) => ['left', 'king', 'right']
    .reduce((acc, pos) => acc + (gs[key]?.towers?.[pos]?.[field] || 0), 0);
  const dealt  = key => towerSum(opp(key), 'dmgTaken');
  const healed = key => towerSum(key, 'healTaken');
  return {
    isDraw,
    winnerName:    (side1 === 'p1' ? _p1Name : _p2Name) + (side1 === _localKey ? ' (나)' : ''),
    loserName:     (side2 === 'p1' ? _p1Name : _p2Name) + (side2 === _localKey ? ' (나)' : ''),
    winnerTowers:  countDestroyed(side1),
    loserTowers:   countDestroyed(side2),
    winnerMaxDmg:  dealt(side1),
    loserMaxDmg:   dealt(side2),
    winnerMaxHeal: healed(side1),
    loserMaxHeal:  healed(side2),
  };
}

// ── 탭/창 종료 시 온라인 레코드 즉시 제거 (Firebase onDisconnect 보조) ──────
window.addEventListener('pagehide', () => {
  if (sessionStorage.getItem('_nav')) {
    sessionStorage.removeItem('_nav');
  } else {
    const nick = sessionStorage.getItem('nickname');
    if (nick && !_isSpectator) {
      try { db.ref(`players/${nick}`).remove(); } catch (e) {}
    }
  }
  // 떠나는 페이지의 연결을 확실히 끊는다 — 브라우저가 페이지를 캐시(bfcache)에 보관하면
  // 연결이 살아 있어 onDisconnect(퇴장 처리)가 실행되지 않는다.
  // 의도한 이동은 미리 onDisconnect를 취소해 두었으므로 끊어도 방에는 영향이 없다.
  try { db.goOffline(); } catch (e) {}
});

// 캐시에서 되살아난 페이지(뒤로가기 등)는 연결이 끊긴 상태 — 새로 불러오면 입장 표시가 없으므로
// 아래 _exitToNickname이 방을 정리하고 닉네임 화면으로 보낸다
window.addEventListener('pageshow', e => {
  if (e.persisted) location.reload();
});

/**
 * 새로고침·뒤로가기·주소 직접 입력으로 들어옴 — 이전 방에 다시 앉지 않는다.
 * 남아 있는 내 자리(또는 관전 기록)를 정리하고 닉네임 화면으로 (방문 기록도 남기지 않음).
 */
function _exitToNickname() {
  const work = authReady
    .then(() => (_isSpectator ? writeSpectatorLeave() : leaveRoomAsMe(_roomCode)))
    .catch(err => console.error('이전 방 정리 실패:', err));
  navigateWithLoader(t('toLobby'), work, 'index.html');
}

// ── 진입점 ───────────────────────────────────────────────────
(function init() {
  window.__gameBooted = true;   // game.html 감시 타이머에 '정상 시작' 알림
  if (!_roomCode || (!_isSpectator && !_playerRole)) {
    location.replace('index.html');
    return;
  }

  syncInit(_roomCode);

  if (!_validEntry) { _exitToNickname(); return; }

  // 결과 화면 버튼 — 플레이어는 대기실로, 관전자는 로비로
  document.getElementById('btn-return-lobby').addEventListener('click', () => {
    if (_isSpectator) {
      _spectatorCleanup();
      navigateWithLoader(t('toLobby'), null, 'index.html');
    } else {
      _returnToWaitingRoom();
    }
  });

  // 익명 로그인이 끝난 뒤에만 DB 접근 — 규칙이 auth.uid로 소유권을 검사한다.
  // 그동안 로딩 화면이 덮고 있다가, 화면이 다 준비되면 대기실(또는 관전 화면)을 보여준다.
  const loginFailed = () => {
    alert('로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    location.replace('index.html');
  };
  if (_isSpectator) {
    const room = authReady.then(_loadSpectatorRoom, () => { loginFailed(); return null; });
    bootLoader(room, () => room.then(data => { if (data) _doSpectateGame(data); }), t('enteringSpectate'));
  } else {
    const ready = authReady.then(() => {
      initWaitingRoom(_roomCode, _playerRole);
      return waitingRoomReady();
    }, loginFailed);
    // 첫 스냅샷에서 이미 게임 중이면 startGame이 로딩을 넘겨받는다
    bootLoader(ready, () => revealScreen('screen-waiting'), t('enteringRoom'));
  }
})();

// ── 로딩 화면 2초 애니메이션 ─────────────────────────────────
// startAt(서버 시각)을 주면 그 시각부터 LOADING_MS 뒤에 끝난다 — 늦게 들어온 쪽은 그만큼 짧게.
// requestAnimationFrame은 백그라운드 탭에서 멈추므로 setTimeout으로 진행한다.
function _runLoadingScreen(callback, startAt) {
  if (!document.getElementById('loading-ring')) { callback(); return; }
  cancelLoader();            // 페이지 첫 로딩이 진행 중이었다면 여기서 넘겨받는다
  setLoadingMessage('');

  const localBegin = Date.now();

  function tick() {
    // 서버 기준으로 늦게 들어왔으면 그만큼 짧게, 기기 시계가 틀려도 로컬 기준 LOADING_MS를 넘지 않는다
    const elapsed  = Math.max(Date.now() - localBegin, startAt ? serverNow() - startAt : 0);
    const progress = Math.max(0, Math.min(100, Math.round((elapsed / LOADING_MS) * 100)));
    setLoadingProgress(progress);
    if (progress < 100) {
      setTimeout(tick, 30);
    } else {
      callback();
    }
  }
  tick();
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
  _nextFrame(() => {
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

// ── 오버타임 15초 카운트다운 숫자 오버레이 ──
function _showCountdownNumber(num) {
  // 이전 cleanup timeout 취소
  if (_countdownCancelId !== null) { clearTimeout(_countdownCancelId); _countdownCancelId = null; }

  const overlay = document.getElementById('ready-go-overlay');
  const readyEl = document.getElementById('ready-text');
  const goEl    = document.getElementById('go-text');
  if (!overlay || !goEl) return;

  readyEl.style.display = 'none';
  goEl.textContent = String(num);
  goEl.className   = 'go-text countdown-mode';
  overlay.style.opacity = '';
  overlay.classList.add('no-blur');
  overlay.classList.remove('hidden');

  _nextFrame(() => {
    goEl.classList.add('pop');
    _countdownCancelId = setTimeout(() => {
      _countdownCancelId = null;
      overlay.classList.add('hidden');
      overlay.classList.remove('no-blur');
      readyEl.style.display = '';
      goEl.textContent = 'Cardecx!';
      goEl.className   = 'go-text';
    }, 900);
  });
}

// 카운트다운 오버레이 중단 및 상태 초기화 (Match Over 애니메이션 전 호출)
function _cancelCountdownOverlay() {
  if (_countdownCancelId !== null) { clearTimeout(_countdownCancelId); _countdownCancelId = null; }
  const overlay = document.getElementById('ready-go-overlay');
  const readyEl = document.getElementById('ready-text');
  const goEl    = document.getElementById('go-text');
  if (overlay) { overlay.classList.add('hidden'); overlay.classList.remove('no-blur'); overlay.style.opacity = ''; }
  if (readyEl) { readyEl.style.display = ''; }
  if (goEl)    { goEl.style.display = ''; goEl.textContent = 'Cardecx!'; goEl.className = 'go-text'; }
}

/**
 * 다음 프레임 — 먼저 오는 쪽(화면 프레임 또는 타이머)으로 한 번만 진행한다.
 * 백그라운드 탭이나 전체화면(F11) 전환 중에는 requestAnimationFrame이 한동안 오지 않아
 * 연출이 멈춘 자리에서 게임이 시작되지 않는다 (F11을 연타하면 게임이 멎던 원인).
 */
function _nextFrame(fn) {
  let done = false;
  const run = () => { if (done) return; done = true; fn(); };
  setTimeout(run, 120);
  if (!document.hidden) requestAnimationFrame(run);
}

// ── 매치종료 애니메이션 ──
function _showMatchEndAnimation(onComplete) {
  _cancelCountdownOverlay(); // 카운트다운 pending cleanup이 Match Over를 덮어쓰는 것 방지
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

  _nextFrame(() => {
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
  // 방장이 기록한 서버 시각이 기준 (로컬 반영 직후라면 추정치일 수 있어 숫자만 신뢰)
  const anchor = typeof roomData.gameStartTime === 'number' ? roomData.gameStartTime : serverNow();
  _runLoadingScreen(() => _doStartGame(roomCode, playerRole, roomData, anchor + PRE_START_MS), anchor);
}

function _doStartGame(roomCode, playerRole, roomData, matchStart) {
  showGameScreen('screen-game');
  castResetCooldown();
  if (typeof initMapPan === 'function') initMapPan();
  if (typeof mapCenterView === 'function') mapCenterView();
  if (typeof alignTowersToGround === 'function') alignTowersToGround();

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
  unitsInit(_syncRoomCode, _localKey);   // 소환 유닛 (그림리퍼) — 내 유닛을 움직이고 상대 유닛의 낫을 뒤늦게 확인한다
  setupDragTargets();
  energyInit(_localKey, 100);
  deckInit(_localKey, _enemyKey);
  turnsInit(_localKey);
  winInit(_localKey, _enemyKey);
  effectsInit(_localKey, _enemyKey);
  _initEmojiPanel();

  // 초기 게임 상태 보드에 렌더링 (애니메이션 뒤에 배경으로 보임)
  const gs = roomData.gameState;
  if (gs) _applyFullGameState(gs);
  if (_matchDecided) return;
  _gameReady = false; // 애니메이션 끝나기 전까지 게임 로직 차단

  // READY / GO 애니메이션 → 종료 후 타이머·리스너 시작
  // 이미 경기 시작 시각이 지났거나(늦게 들어옴·새로고침) 백그라운드 탭이면 연출을 건너뛴다
  const playIntro = !document.hidden && matchStart - serverNow() > READY_GO_MS / 2;
  const begin = fn => playIntro ? _showReadyGoAnimation(fn) : fn();
  begin(() => {
    if (_matchDecided) return;
    window.matchInputLocked = false;
    _timerEnded         = false;
    _matchTimerSynced   = false;
    _prevTowerJson      = { my: null, enemy: null };
    window.overtimeActive      = false;
    window.overtimeTimerOrigin = null;
    // 기준 시각은 양쪽이 같은 값(gameStartTime + PRE_START_MS)으로 계산 — P1은 관전자용으로 기록
    _matchTimerOrigin = matchStart;
    if (_playerRole === 'p1') writeMatchTimerStart(_matchTimerOrigin);
    _initMatchTimer(_matchTimerOrigin);
    _listenSpectatorCount();
    _gameReady = true;
    _attachListeners();
    turnsStartOffering(); // 독립 카드 제공 시작
    // AI 대전 — AI(p2) 몫은 방장 브라우저가 돌린다 (bot.js)
    const botSeat = roomData.players?.p2;
    if (botSeat?.bot && _playerRole === 'p1') botStart('p2', 'p1', botSeat.botLevel);
  });
}

/**
 * 설치형 연출이 놓인 자리 — 보낸 쪽은 자기 킹 타워 기준(dx, dy)으로 보낸다.
 * 화면 오른쪽(enemy)에 그려지는 진영은 좌우가 뒤집혀 있으므로 x를 뒤집어서 되돌린다.
 * (관전 화면에서 p1은 왼쪽 그대로라 뒤집지 않는다)
 * @returns {{x:number,y:number}|null} 좌표가 없으면 null (타워 중심에 그려진다)
 */
function _castFxPoint(owner, hit) {
  if (typeof hit?.fxDX !== 'number' || typeof hit?.fxDY !== 'number') return null;
  if (typeof boardTowerCenterStage !== 'function') return null;
  const k = boardTowerCenterStage(owner, 'king');
  if (!k) return null;
  // fxDX·fxDY는 '시전자 화면에서, 맞는 쪽 킹 타워로부터' 잰 값이다.
  // 내 화면이 시전자 화면의 좌우 거울이면 가로를 뒤집어야 같은 자리에 놓인다.
  // (맞는 쪽이 어디냐가 아니라 '시전자와 시점이 같은가'가 기준이다 —
  //  상대 진영에 쓰는 카드는 맞는 쪽이 'my'로 뒤집혀 들어오기 때문에 owner로 따지면 틀린다.
  //  관전자는 p1 시점으로 본다.)
  const anchor   = _localKey || 'p1';
  const mirrored = hit.sourcePlayer !== anchor;
  const dx = mirrored ? -hit.fxDX : hit.fxDX;
  return { x: k.x + dx, y: k.y + hit.fxDY };
}

function _renderEnemyEnergy(val) {
  const bar = document.getElementById('enemy-energy-bar');
  const num = document.getElementById('enemy-energy-value');
  if (bar) bar.style.width = ((val / 100) * 100) + '%';
  if (num) num.textContent = val;
}

function _updateCrownCounts(gs, meKey = _localKey, enemyKey = _enemyKey) {
  const countDead = key => _countDestroyedTowers(gs[key]?.towers);
  const myEl    = document.getElementById('my-crown-count');
  const enemyEl = document.getElementById('enemy-crown-count');
  if (myEl)    myEl.textContent    = countDead(enemyKey);
  if (enemyEl) enemyEl.textContent = countDead(meKey);
}

function _applyFullGameState(gs) {
  _latestGameState = gs;
  boardUpdateState(gs);
  deckUpdateState(gs);
  effectsUpdateState(gs);

  // 타워 렌더링
  applyTowersSnapshot('my',    gs[_localKey]?.towers);
  applyTowersSnapshot('enemy', gs[_enemyKey]?.towers);

  // 덱 복구
  deckApplySnapshot(gs[_localKey]?.deck);

  // 진화 카운터 복구 (재접속 시)
  if (gs[_localKey]?.evolutionCharges !== undefined) {
    deckApplyEvolutionCharges(gs[_localKey].evolutionCharges);
  }

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

  // 이미 종료된 게임
  if (gs.winner) { _onMatchDecided(gs.winner); return; }

  _gameReady = true;
}

function _attachListeners() {
  // 게임 상태 전체 감청
  listenGameState(gs => {
    if (!gs) return;
    _latestGameState = gs;
    boardUpdateState(gs);
    deckUpdateState(gs);
    effectsUpdateState(gs);

    // Bug 1: P1의 권위적 타이머 기준 시각으로 1회 동기화
    if (gs.matchTimerStartedAt && !_matchTimerSynced && !window.overtimeActive) {
      _matchTimerSynced = true;
      const diff = Math.abs(gs.matchTimerStartedAt - (_matchTimerOrigin || 0));
      if (diff > 200) {
        _matchTimerOrigin = gs.matchTimerStartedAt;
        _stopMatchTimer();
        _initMatchTimer(_matchTimerOrigin);
      }
    }

    // Bug 2: 오버타임 기준 시각 동기화 (Firebase에서 수신)
    if (gs.overtimeStartedAt && !window.overtimeTimerOrigin) {
      window.overtimeTimerOrigin = gs.overtimeStartedAt;
    }

    // Bug 6: 타워 상태가 변경된 경우에만 DOM 업데이트
    const rawMyTowers    = gs[_localKey]?.towers;
    const rawEnemyTowers = gs[_enemyKey]?.towers;
    const myJson    = JSON.stringify(rawMyTowers);
    const enemyJson = JSON.stringify(rawEnemyTowers);
    if (myJson !== _prevTowerJson.my) {
      _prevTowerJson.my = myJson;
      applyTowersSnapshot('my', rawMyTowers);
    }
    if (enemyJson !== _prevTowerJson.enemy) {
      _prevTowerJson.enemy = enemyJson;
      applyTowersSnapshot('enemy', rawEnemyTowers);
    }

    if (gs[_localKey]?.energy !== undefined) {
      syncEnergyFromRemote(gs[_localKey].energy);
    }

    // 에너지 버스트 상태 감지 (호박마차 카드 사용 시)
    const burstUntil = gs[_localKey]?.energyBurstUntil;
    if (burstUntil && typeof energyCheckBurst === 'function') {
      energyCheckBurst(burstUntil, gs[_localKey]?.energyBurstPerTick || 10);
    }

    // 진화 카운터는 실시간으로 덮어쓰지 않는다 — 방금 올린 값보다 늦게 도착한 스냅샷이
    // 게이지를 되돌려 진화가 취소될 수 있다. 복원은 입장 시(_applyFullGameState)에만.

    _refreshDotIndicators(gs.dots);
    _updateFreezeUI(gs);

    // 적 에너지 / 크라운 카운트 업데이트
    if (gs[_enemyKey]?.energy !== undefined) _renderEnemyEnergy(gs[_enemyKey].energy);
    _updateCrownCounts(gs);

    // 킹 타워 파괴 승리 조건 감지
    if (_gameReady) winCheckTowers(gs);

  });

  // 내 제공 카드 감청
  listenOfferedCards(_localKey, cards => renderOfferedCards(cards));

  // dots 감청 (effects.js 인터벌 관리 + UI 뱃지 갱신)
  // 예약 피해 감청 — 시전자가 끊겨도 맞는 쪽이 대신 넣는다 (sync.js pendingHits)
  pendingHitsInit(_localKey);
  listenPendingHits(rows => pendingHitsApply(rows, () => _latestGameState));

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

  // 승자 감청 — 결과 화면은 오직 여기(DB 승자)에서만 띄운다.
  // 방은 지우지 않는다 — 결과 화면 뒤 두 플레이어 모두 같은 방 대기실로 돌아간다
  listenWinner(winner => { if (winner) _onMatchDecided(winner); });

  // 즉시 피해 플로팅 숫자 표시 — 리스너 등록 시각 이전 항목은 무시 (재접속 재생 방지)
  const _hitListenerTs = serverNow();
  listenInstantHits((snap, hit) => {
    if (!hit) return;
    if (hit.ts && hit.ts < _hitListenerTs - 1500) return;
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
    if (hit.type === 'energyDrain') {
      // 에너지는 각자 자기 것이라 맞은 쪽이 직접 깎아야 실제로 줄어든다
      if (hit.targetPlayer === _localKey && typeof energyDrain === 'function') energyDrain(hit.amount || 0);
      if (hit.sourcePlayer === _localKey) setTimeout(() => snap.ref.remove(), 1500);
      return;
    }
    if (hit.type?.startsWith('cast_')) {
      // 상대가 쓴 카드의 시전 연출 (내 것은 클릭하는 순간 이미 재생했다)
      if (hit.sourcePlayer !== _localKey) playCastFx(hit.type.slice(5), owner, hit.targetTower, _castFxPoint(owner, hit), snap.key);
      else setTimeout(() => snap.ref.remove(), 1200);
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
  // 방·자리의 연결 끊김 처리는 presence.js가 전담 (끊기면 connected=false → 상대가 유예 후 정리).
  // 여기서는 게임 탭이 닫히면 접속자 목록에서 닉네임만 정리한다.
  const _nick = sessionStorage.getItem('nickname');
  if (_nick) db.ref(`players/${_nick}`).onDisconnect().remove();
}

function _cancelDisconnectHandler() {
  // 결과 화면에서 탭 닫아도 오프라인 처리되도록 player onDisconnect는 .remove()로 유지
  const _nick = sessionStorage.getItem('nickname');
  if (_nick) db.ref(`players/${_nick}`).onDisconnect().remove();
}

/**
 * 진행 중인 게임을 즉시 멈춘다 — 상대 퇴장으로 대기실 복귀·로비 이동 직전에 호출.
 * 타이머·리스너가 남아 있으면 전환 중에 종료 연출이나 DB 쓰기가 끼어든다.
 */
// ── 매치 종료 → 대기실 복귀 ─────────────────────────────────
// 결과 화면을 잠시 보여준 뒤 두 플레이어 모두 같은 방 대기실로 돌아간다.
// 방 상태(finished → waiting) 초기화는 대기실에 먼저 들어온 쪽이 한다 (room.js).
const RESULT_RETURN_SEC = 8;
let _resultReturnTimer = null;
let _returningToRoom   = false;

/** win.js의 winShowResult에서 호출 — 버튼에 남은 초를 표시하며 자동 복귀 */
function _startResultReturnCountdown() {
  if (_isSpectator || _resultReturnTimer) return;
  const btn = document.getElementById('btn-return-lobby');
  let left = RESULT_RETURN_SEC;
  const render = () => { if (btn) btn.textContent = `${t('returnWaitingRoom')} (${left})`; };
  render();
  _resultReturnTimer = setInterval(() => {
    left--;
    if (left > 0) { render(); return; }
    _returnToWaitingRoom();
  }, 1000);
}

function _returnToWaitingRoom() {
  if (_returningToRoom) return;
  _returningToRoom = true;
  if (_resultReturnTimer) { clearInterval(_resultReturnTimer); _resultReturnTimer = null; }
  haltGame();
  navigateWithLoader(t('toWaitingRoom'), presencePrepareNavigation(),
    `game.html?room=${_roomCode}&player=${_playerRole}`);
}

function haltGame() {
  _gameReady = false;
  botStop();
  if (_resultReturnTimer) { clearInterval(_resultReturnTimer); _resultReturnTimer = null; }
  _stopMatchTimer();
  _cancelCountdownOverlay();
  _freezeCleanup();
  _cleanupEmojiPanel();
  clearMirrorWarnings();
  turnsCleanup();
  syncCleanup();
  effectsCleanup();
  pendingHitsCleanup();
  energyCleanup();
}

// ── 이모티콘 패널 ─────────────────────────────────────────────

let _emojiCooldown = false;
let _emojiOutsideClickListener = null;

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

  _emojiOutsideClickListener = e => {
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.add('hidden');
    }
  };
  document.addEventListener('click', _emojiOutsideClickListener);
}

function _cleanupEmojiPanel() {
  if (_emojiOutsideClickListener) {
    document.removeEventListener('click', _emojiOutsideClickListener);
    _emojiOutsideClickListener = null;
  }
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

// ── 화면 자동 핏 + 줌 (Ctrl +/-, Ctrl+휠) ───────────────────
// 1600×900(16:9) 고정 스테이지를 뷰포트에 맞춰 scale 한다. 계산된 배율은
// window.gameStageScale로 공개 — board.js가 이펙트 좌표 변환에 사용한다.
(function initZoom() {
  const GAME_W = 1600, GAME_H = 900;
  const FIT_MARGIN = 0.98;             // 화면을 거의 채우되 가장자리 약간 여백
  const STEP = 0.1, MIN = 0.5, MAX = 1.0; // 1.0 초과 시 스테이지가 화면 밖으로 잘림
  let manualZoom = 1.0;

  function applyZoom() {
    const el = document.getElementById('screen-game');
    if (!el) return;
    const fitScale = Math.min(window.innerWidth / GAME_W, window.innerHeight / GAME_H) * FIT_MARGIN;
    const scale = +(fitScale * manualZoom).toFixed(4);
    window.gameStageScale = scale;
    el.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  // 뷰포트 크기 변화 시 자동 재계산 — 전체화면(F11) 전환은 크기 변화가 몰아서 오므로
  // 마지막 한 번만 계산하고, 전환이 끝난 뒤 한 번 더 맞춘다
  let fitTimer = null;
  const applyZoomSoon = () => {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => { fitTimer = null; applyZoom(); }, 60);
  };
  window.addEventListener('resize', applyZoomSoon);
  document.addEventListener('fullscreenchange', () => { applyZoom(); applyZoomSoon(); });
  applyZoom();

  document.addEventListener('keydown', e => {
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

function _freezeCleanup() {
  if (_freezeCountdownTimer) { clearInterval(_freezeCountdownTimer); _freezeCountdownTimer = null; }
  ['my', 'enemy'].forEach(side => {
    if (_freezeClearTimers[side]) { clearTimeout(_freezeClearTimers[side]); _freezeClearTimers[side] = null; }
  });
}

function _updateFreezeUI(gs, meKey = _localKey, enemyKey = _enemyKey) {
  const now = gameNow();
  _applyFreezeForPlayer('my',    gs?.[meKey]?.deckFreezeUntil, now);
  _applyFreezeForPlayer('enemy', gs?.[enemyKey]?.deckFreezeUntil, now);
}

function _applyFreezeForPlayer(side, freezeUntil, now) {
  const isFrozen  = freezeUntil && now < freezeUntil;
  const iconId    = side === 'my' ? 'my-freeze-icon' : 'enemy-freeze-icon';
  const slotsEl   = document.getElementById('deck-slots');
  const overlayEl = document.getElementById('deck-freeze-overlay');

  const iconEl = document.getElementById(iconId);
  if (iconEl) iconEl.classList.toggle('hidden', !isFrozen);

  if (side === 'my') {
    // 얼기 시작했는데 카드를 들고 있었다 — 내려놓는다 (언 동안엔 어떤 카드도 쓸 수 없다)
    if (isFrozen && typeof boardIsHoldingCard === 'function' && boardIsHoldingCard()) cancelStickyDrag();
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
        if (gameNow() >= freezeUntil) {
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
  const secs = Math.max(0, Math.ceil((freezeUntil - gameNow()) / 1000));
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

/** 관전할 방 정보 — 진행 중인 방이 아니면 로비로 (null 반환) */
async function _loadSpectatorRoom() {
  _spectatorNickname = sessionStorage.getItem('nickname');
  try {
    const snap = await withTimeout(db.ref(`rooms/${_roomCode}`).once('value'));
    const roomData = snap.val();
    if (!roomData || roomData.status !== 'playing') {
      location.replace('index.html');
      return null;
    }
    writeSpectatorJoin();   // uid로 등록
    return roomData;
  } catch (e) {
    console.error('관전 초기화 오류:', e);
    location.replace('index.html');
    return null;
  }
}

function _doSpectateGame(roomData) {
  showGameScreen('screen-game');
  // 플레이어 시작(_doStartGame)과 같은 준비 — 화면이 보인 뒤에 맵을 가운데로 두고 타워를 칸에 앉힌다.
  // 이게 빠지면 타워 DOM(체력 숫자·연출 기준점)이 페이지를 처음 그릴 때의 숨은 상태 값으로 남는다
  if (typeof initMapPan === 'function') initMapPan();
  if (typeof mapCenterView === 'function') mapCenterView();
  if (typeof alignTowersToGround === 'function') alignTowersToGround();
  if (typeof towers3dLayout === 'function') towers3dLayout();

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
  unitsInit(_syncRoomCode, null);        // 관전자 — 보기만 한다

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
    _refreshDotIndicatorsForSpectator(gs.dots);
    _renderSpectatorDeckRow('p1', gs['p1']?.deck);
    _renderSpectatorDeckRow('p2', gs['p2']?.deck);
    _renderSpectatorHud(gs);

    // 이미 종료된 게임 처리
    if (gs.winner) {
      _showSpectatorEnd(gs.winner, gs.winReason);
      return;
    }
  }

  _attachSpectatorListeners();
  _listenSpectatorCount();
  _initSpectatorTimer();
}

/** 관전 HUD — 좌측(파랑)=P1, 우측(빨강)=P2 시점으로 에너지·크라운·동결 표시 */
function _renderSpectatorHud(gs) {
  const p1Energy = gs?.p1?.energy;
  if (p1Energy !== undefined) {
    const bar = document.getElementById('energy-bar');
    const num = document.getElementById('energy-value');
    if (bar) bar.style.width = Math.max(0, Math.min(100, p1Energy)) + '%';
    if (num) num.textContent = p1Energy;
  }
  if (gs?.p2?.energy !== undefined) _renderEnemyEnergy(gs.p2.energy);
  _updateCrownCounts(gs, 'p1', 'p2');
  _updateFreezeUI(gs, 'p1', 'p2');
}

/**
 * 관전 전용 타이머 — 표시만 한다. 플레이어용 _initMatchTimer는 오버타임 진입 시
 * DB 기록·에너지 모드 전환·타임아웃 판정을 하므로 관전자가 쓰면 안 된다.
 */
function _initSpectatorTimer() {
  const timerEl = document.getElementById('match-timer-display');
  const wrapEl  = document.getElementById('match-timer-wrap');
  if (!timerEl) return;
  const fmt = ms => {
    const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  _stopMatchTimer();
  _matchTimerInterval = setInterval(() => {
    const gs = _latestSpectatorGs;
    const start = gs?.matchTimerStartedAt;
    if (!start) return;
    const remaining = MATCH_DURATION - (gameNow() - start);
    if (remaining > 0) {
      timerEl.textContent = fmt(remaining);
      if (wrapEl) wrapEl.classList.toggle('warning', remaining <= 10000);
      return;
    }
    if (wrapEl) { wrapEl.classList.remove('warning'); wrapEl.classList.add('overtime'); }
    const otStart = gs.overtimeStartedAt;
    timerEl.textContent = otStart ? fmt(Math.max(0, OVERTIME_DURATION - (gameNow() - otStart))) : fmt(OVERTIME_DURATION);
  }, 500);
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
    cardApplyArt(el, card);
    el.innerHTML = `
      <div class="card-icon">${card.icon}</div>
      <div class="card-name">${tCard(card.id, 'name')}</div>
      <div class="card-footer">
        <span class="card-energy-cost">${card.energyCost}</span>
        <span class="card-grade-dot"></span>
      </div>
    `;
    // 개수 배지는 내용을 채운 뒤에 붙인다 (먼저 붙이면 innerHTML이 지워 버린다)
    if (item.count > 1) {
      const badge = document.createElement('span');
      badge.className = 'card-count card-count-always';
      badge.textContent = 'x' + item.count;
      el.appendChild(badge);
    }
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
    applyTowersSnapshot('my',    gs['p1']?.towers);
    applyTowersSnapshot('enemy', gs['p2']?.towers);
    _refreshDotIndicatorsForSpectator(gs.dots);
    _renderSpectatorHud(gs);
  });

  // 플레이어가 나가 방이 대기 상태로 돌아가거나 사라지면 관전 종료
  listenRoomStatus(status => {
    if (status === 'playing' || status === 'finished') return;
    _endSpectatingToLobby();
  });

  // 즉시 피해 플로팅 숫자 — 관전 시작 이전 항목은 무시 (참여 시 재생 방지)
  const _specHitTs = serverNow();
  listenInstantHits((snap, hit) => {
    if (!hit) return;
    if (hit.ts && hit.ts < _specHitTs - 1500) return;
    // 관전자의 인터넷이 잠깐 끊겼다 돌아오면 그동안 쌓인 신호가 한꺼번에 들어온다.
    // 이미 지나간 연출을 몰아서 틀면 지금 무슨 일이 일어나는지 알 수 없다 — 체력은 상태 감청이 따로 맞춰 준다
    if (hit.ts && hit.ts < serverNow() - SPEC_HIT_STALE_MS) return;
    const owner = hit.targetPlayer === 'p1' ? 'my' : 'enemy';
    if (hit.type === 'mirrorWarn') {
      // 반사 경고 — 플레이어 화면과 같은 아이콘 (숫자 아님)
      const towerEl = document.getElementById(`tower-${owner}-${hit.targetTower}`);
      if (towerEl && typeof showMirrorWarning === 'function') showMirrorWarning(towerEl, () => {});
      return;
    }
    if (hit.type === 'energyDrain') return;   // 에너지는 각 플레이어 것 — 관전 화면에서는 할 일이 없다
    if (hit.type?.startsWith('cast_')) { playCastFx(hit.type.slice(5), owner, hit.targetTower, _castFxPoint(owner, hit), snap.key); return; }
    showTowerHit(owner, hit.targetTower, hit.amount, hit.type);
  });

  // 이모티콘 말풍선
  listenEmoji('p1', data => { if (data?.emoji) _showBubble('my-king', data.emoji); });
  listenEmoji('p2', data => { if (data?.emoji) _showBubble('enemy-king', data.emoji); });

  // DOT/HOT 틱 플로팅 숫자 (관전자 전용)
  listenDots(dots => _startSpectatorDotVisuals(dots));

  // 양쪽 덱 실시간 감청
  listenDeck('p1', deck => _renderSpectatorDeckRow('p1', deck));
  listenDeck('p2', deck => _renderSpectatorDeckRow('p2', deck));

  // 승자 감청 — 플레이어와 같은 DB 승자로 결과 표시
  let _spectateDecided = false;
  listenWinner(winner => {
    if (!winner || _spectateDecided) return;
    _spectateDecided = true;
    _readResultState(_latestSpectatorGs).then(gs => {
      if (gs) {
        _latestSpectatorGs = gs;
        applyTowersSnapshot('my',    gs.p1?.towers);
        applyTowersSnapshot('enemy', gs.p2?.towers);
        _updateCrownCounts(gs, 'p1', 'p2');
      }
      const holdMs = _endedByKing(gs) ? _kingFallHoldMs() : 0;
      setTimeout(() => _showSpectatorEnd(winner, _resultReason(gs)), holdMs);
    });
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
  _stopMatchTimer();
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
  // 기권승이면 누가 끊겼는지 알려 준다
  const loser = winner === 'p1' ? _p2Name : _p1Name;
  if (typeof winSetReason === 'function') {
    winSetReason(reason === 'disconnect' && winner !== 'draw' ? t('forfeitSpecReason').replace('{name}', loser) : '');
  }

  const stats = _buildResultStats(winner, _latestSpectatorGs);
  if (stats) _populateResultStats(stats);

  document.getElementById('screen-game')?.classList.add('hidden');
  document.getElementById('screen-game')?.classList.remove('active');
  const rs = document.getElementById('screen-result');
  if (rs) { rs.classList.remove('hidden'); rs.classList.add('active'); }
}

function _spectatorCleanup() {
  writeSpectatorLeave();
  syncCleanup();
  _stopMatchTimer();
  _cleanupSpectatorDots();
}

let _spectateEnding = false;

/** 관전 중인 게임이 사라짐(플레이어 퇴장) → 알림 후 로비로 */
function _endSpectatingToLobby() {
  if (_spectateEnding) return;
  _spectateEnding = true;
  _spectatorCleanup();
  showNotice(t('spectateEnded'), 'warn');
  navigateWithLoader(t('toLobby'), null, 'index.html');
}

// 관전자가 받은 신호(연출·피해 숫자)가 이보다 오래됐으면 보여 주지 않는다
const SPEC_HIT_STALE_MS = 3000;

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
    // 보호막 자연 감소는 HP 바로만 표현 — 플레이어 화면과 동일하게 숫자를 띄우지 않는다
    if (dot.type !== 'damage' && dot.type !== 'heal') return;
    const owner = dot.targetPlayer === 'p1' ? 'my' : 'enemy';
    // 플레이어 화면(effects.js)과 같은 계산·같은 틱 수 — 면역·반사·증감 효과까지 동일하게 표시
    const entry = { firedCount: 0, totalTicks: dot.remainingTicks, begin: gameNow() };
    const stop  = () => { clearInterval(_spectatorDotIntervals[dotId]); delete _spectatorDotIntervals[dotId]; };
    _spectatorDotIntervals[dotId] = setInterval(() => {
      const gs    = _latestSpectatorGs;
      const tower = gs?.[dot.targetPlayer]?.towers?.[dot.targetTower];
      if (!gs?.dots?.[dotId] || !tower || tower.alive === false) { stop(); return; }
      const due = dotTicksDue(entry, dot.tickInterval);
      while (entry.firedCount < due) {
        entry.firedCount++;
        // 물에 꺼진 불 · 다 녹은 얼음 — 플레이어 화면처럼 그 줄은 끝난다
        if ((dot.cardId === 'flame' || dot.cardId === 'fire_evo') && typeof boardFireDoused === 'function' &&
            boardFireDoused(dot.targetPlayer, dot.targetTower, dot.cardId, gameNow())) { stop(); return; }
        const tick = computeDotTick(dot, tower, gs, entry.firedCount, gameNow());
        if (tick.kind === 'thawed') { stop(); return; }
        if (tick.kind === 'immune')      showTowerHit(owner, dot.targetTower, 0, 'immune');
        else if (tick.kind === 'damage') showTowerHit(owner, dot.targetTower, tick.amount, 'dot', tick.amount > dot.dmgPerTick);
        else if (tick.kind === 'heal')   showTowerHit(owner, dot.targetTower, tick.amount, 'heal');
        // mirror: 피해 없이 반사 — 경고 아이콘은 instantHits(mirrorWarn)로 표시된다
      }
      if (entry.firedCount >= entry.totalTicks) stop();
    }, dot.tickInterval);
  });
}

function _cleanupSpectatorDots() {
  Object.values(_spectatorDotIntervals).forEach(clearInterval);
  _spectatorDotIntervals = {};
}
