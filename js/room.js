// ============================================================
//  room.js — 대기실 상태 관리, 게임 시작
// ============================================================

let roomListeners = [];

// ── 대기실 패널 자동 핏 ─────────────────────────────────────
// 480×480 고정 캔버스를 통째로 scale 하므로 확대/축소해도
// 글자가 다시 줄바꿈되거나 레이아웃이 깨지지 않는다.
(function initWaitingPanelFit() {
  const STAGE_W = 480, STAGE_H = 480;
  const MARGIN  = 0.92;
  const MAX     = 1.6;

  function applyFit() {
    const panel = document.querySelector('.waiting-panel');
    if (!panel) return;
    const fit   = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H) * MARGIN;
    const scale = +Math.min(fit, MAX).toFixed(3);
    panel.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  window.addEventListener('resize', applyFit);
  applyFit();
})();

// ── 첫 화면 준비 ─────────────────────────────────────────────
// 대기실을 처음 그린 순간 resolve — game.js의 로딩 화면이 이때 걷힌다
let _resolveWaitingReady;
const _waitingReady = new Promise(resolve => { _resolveWaitingReady = resolve; });
function waitingRoomReady() { return _waitingReady; }

// ── 준비 상태 ────────────────────────────────────────────────
let _myReady      = false;
let _gameStarting = false;   // status 쓰기 중복 방지
let _roomResetting = false;  // 매치 종료 후 대기 상태 복구 중복 방지

/** 내 준비 상태 토글 */
function _toggleReady(roomCode, playerRole) {
  _myReady = !_myReady;
  db.ref(`rooms/${roomCode}/players/${playerRole}/ready`).set(_myReady);
}

/** 준비 상태 배지 렌더링 */
function _renderReadyState(elId, joined, isReady, disconnected = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!joined || disconnected) {
    el.textContent = disconnected ? t('disconnectedState') : t('waitingJoin');
    el.className   = 'player-ready-state state-absent';
    return;
  }
  el.textContent = isReady ? t('ready') : t('notReady');
  el.className   = 'player-ready-state ' + (isReady ? 'state-ready' : 'state-waiting');
}

function initWaitingRoom(roomCode, playerRole) {
  const enemyRole = playerRole === 'p1' ? 'p2' : 'p1';

  // ── DOM 업데이트 먼저 (Firebase 오류와 무관하게 표시) ──
  document.getElementById('display-room-code').textContent = roomCode;

  // ── Firebase 참조 (DB가 없으면 오류 표시) ──
  if (typeof db === 'undefined') {
    document.getElementById('name-me').textContent = '⚠ Firebase 연결 실패';
    console.error('Firebase db가 초기화되지 않았습니다. Realtime Database를 활성화했는지 확인하세요.');
    return;
  }

  const roomRef = db.ref(`rooms/${roomCode}`);

  // 방 접속 상태 관리 시작 — 대기실과 게임 내내 유지된다 (presence.js)
  presenceStart(roomCode, playerRole, _roomPresenceHandlers(roomCode, playerRole));

  // 플레이어 온라인 레코드도 재등록 — 탭 닫으면 오프라인 처리
  const _waitNick = sessionStorage.getItem('nickname');
  if (_waitNick) db.ref(`players/${_waitNick}`).onDisconnect().remove();

  // 방 코드 복사
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const btn = document.getElementById('btn-copy-code');
    navigator.clipboard.writeText(roomCode).then(() => {
      btn.textContent = '완료';
      setTimeout(() => { btn.textContent = '복사'; }, 1500);
    });
  });

  // 실시간 방 상태 감청
  const unsub = roomRef.on('value', snap => {
    // 방 삭제·추방·방장 승계는 presence.js가 처리 — 여기선 화면만 그린다
    if (!snap.exists()) return;

    const room = snap.val();
    const me    = room.players?.[playerRole];
    const enemy = room.players?.[enemyRole];
    if (!me) return;

    // 플레이어 카드 렌더링
    document.getElementById('name-me').textContent    = me?.name || '—';
    document.getElementById('name-enemy').textContent = enemy?.name || t('waitingSlot');
    _renderBotSeat(roomCode, playerRole, room);

    const enemyJoined = !!enemy;
    const enemyActive = enemyJoined && enemy.connected !== false;   // 끊김 유예 중이면 비활성
    document.getElementById('pcard-enemy').classList.toggle('card-empty', !enemyJoined);
    document.getElementById('pcard-enemy').classList.toggle('card-disconnected', enemyJoined && !enemyActive);

    const meReady    = !!me?.ready;
    const enemyReady = !!enemy?.ready;
    _renderReadyState('ready-me',    true,        meReady);
    _renderReadyState('ready-enemy', enemyJoined, enemyReady, enemyJoined && !enemyActive);

    // 매치가 끝난 방으로 돌아옴 → 대기 상태로 되돌린다 (먼저 들어온 쪽이 기록, 나중 쪽은 이미 waiting)
    if (room.status === 'finished') {
      _resetFinishedRoom(roomRef, playerRole);
      return;
    }

    // 원격 값을 로컬 상태의 정답으로 삼는다 (재접속·취소 동기화)
    _myReady = meReady;

    // 상대가 나갔는데 내 준비만 남아 있으면 해제 — 새 상대가 들어와
    // 준비하는 순간 내 확인 없이 게임이 시작되는 것을 막는다.
    if (!enemyActive && meReady) {
      db.ref(`rooms/${roomCode}/players/${playerRole}/ready`).set(false);
    }

    // 준비 버튼: 상대가 없으면 누를 수 없음
    const readyBtn = document.getElementById('btn-ready');
    readyBtn.disabled    = !enemyActive;
    readyBtn.textContent = meReady ? t('cancelReady') : t('readyBtn');
    readyBtn.classList.toggle('is-ready', meReady);
    _resolveWaitingReady();

    // ── 양쪽 모두 준비완료 → 게임 시작 ──
    // p1이 권위적으로 status를 기록하고, 양쪽은 status 변경을 수신해 진입한다.
    if (enemyActive && meReady && enemyReady && room.status === 'waiting') {
      if (playerRole === 'p1' && !_gameStarting) {
        _gameStarting = true;
        beginGame(roomCode, playerRole);
      }
    }

    // 게임 시작됨 (양쪽 공통 진입 경로)
    if (room.status === 'playing') {
      cleanupRoomListeners();
      startGame(roomCode, playerRole, room);
    }
  });

  roomListeners.push(() => roomRef.off('value', unsub));

  // 방 나가기
  document.getElementById('btn-leave-room').addEventListener('click', () => leaveRoom(roomCode, playerRole));

  // 게임 준비 토글
  document.getElementById('btn-ready').addEventListener('click', () => _toggleReady(roomCode, playerRole));

  // AI 난이도
  document.getElementById('btn-bot-level')?.addEventListener('click', () => _cycleBotLevel(roomCode));
}

// ── AI 대전 자리 ─────────────────────────────────────────────
/** AI 자리 표시 · 자동 준비 · 난이도 버튼 (방장만 바꿀 수 있음) */
function _renderBotSeat(roomCode, playerRole, room) {
  const bot    = room.players?.p2?.bot ? room.players.p2 : null;
  const level  = BOT_LEVEL_IDS.includes(bot?.botLevel) ? bot.botLevel : 'normal';
  const avatar = document.getElementById('avatar-enemy');
  const btn    = document.getElementById('btn-bot-level');
  document.getElementById('pcard-enemy').classList.toggle('card-bot', !!bot);
  if (avatar) avatar.textContent = bot ? '🤖' : '?';
  if (btn) {
    btn.classList.toggle('hidden', !bot);
    btn.textContent = t('botLevelBtn').replace('{level}', t('botLevel_' + level));
    btn.disabled = playerRole !== 'p1' || room.status !== 'waiting';
  }
  if (!bot) return;
  document.getElementById('name-enemy').textContent = `${t('botName')} · ${t('botLevel_' + level)}`;
  // AI는 항상 준비 완료 (게임이 시작되면 방장이 준비를 풀므로 대기실로 돌아올 때마다 다시)
  if (playerRole === 'p1' && room.status === 'waiting' && !bot.ready) {
    db.ref(`rooms/${roomCode}/players/p2/ready`).set(true).catch(err => console.error('AI 준비 실패:', err));
  }
}

/** 난이도 버튼 — 쉬움 ↔ 보통 */
function _cycleBotLevel(roomCode) {
  const bot = presenceLatest()?.players?.p2;
  if (!bot?.bot) return;
  const i = BOT_LEVEL_IDS.indexOf(bot.botLevel);
  const next = BOT_LEVEL_IDS[(i + 1) % BOT_LEVEL_IDS.length];
  db.ref(`rooms/${roomCode}/players/p2/botLevel`).set(next).catch(err => console.error('난이도 변경 실패:', err));
}

/** 끝난 방을 대기 상태로 — 실패하면(일시적 연결 문제 등) 잠시 뒤 다시 시도 */
function _resetFinishedRoom(roomRef, playerRole, attempt = 0) {
  if (_roomResetting) return;
  _roomResetting = true;
  roomRef.update({ status: 'waiting', gameState: null, [`players/${playerRole}/ready`]: false })
    .then(() => { _roomResetting = false; })
    .catch(err => {
      console.error('대기실 초기화 실패:', err);
      _roomResetting = false;
      const latest = presenceLatest();
      if (attempt < 5 && latest?.status === 'finished') {
        setTimeout(() => _resetFinishedRoom(roomRef, playerRole, attempt + 1), 1500);
      }
    });
}

/** 양쪽 준비완료 시 p1만 호출 — gameState를 초기화하고 status를 playing으로 전환 */
async function beginGame(roomCode, playerRole) {
  if (playerRole !== 'p1') return;

  // 초기 게임 상태 구성
  const initialTowers = {
    left:  { hp: 300,  maxHp: 300,  alive: true },
    king:  { hp: 1500, maxHp: 1500, alive: true },
    right: { hp: 300,  maxHp: 300,  alive: true }
  };

  const initialPlayer = (energy = 100) => ({
    energy,
    lastEnergyTick: serverTimestamp(),
    deck: { 0: null, 1: null, 2: null, 3: null, 4: null },
    offeredCards: null,
    towers: JSON.parse(JSON.stringify(initialTowers))
  });

  // gameState를 통째로 교체 → 이전 게임의 winner/winReason/dots 잔재를 완전히 제거
  const freshGameState = {
    p1: initialPlayer(),
    p2: initialPlayer()
    // winner, winReason, dots, startedAt 키를 포함하지 않음 → Firebase에서 자동 삭제
  };

  await db.ref(`rooms/${roomCode}`).update({
    status: 'playing',
    gameStartTime: serverTimestamp(),
    gameState: freshGameState,
    'players/p1/ready': false,
    'players/p2/ready': false
  });
  // status 변경으로 양쪽 클라이언트의 room listener가 startGame() 호출
}

function leaveRoom(roomCode, playerRole) {
  cleanupRoomListeners();
  const work = presencePrepareNavigation()
    .then(() => leaveRoomData(roomCode, playerRole))
    .then(_removeMyPresence);
  navigateWithLoader(t('toLobby'), work, 'index.html');
}

/**
 * 방에서 내 흔적을 지운다 — 사실상 혼자(상대 없음·끊김)면 방 삭제, 아니면 내 자리만 비움
 * (방장이 나가면 남은 상대가 방장을 이어받는다).
 * 그 순간 누가 들어오거나 나가 판단이 어긋나면 규칙이 거부하므로, 최신 상태를 다시 읽어 재시도한다.
 */
async function leaveRoomData(roomCode, playerRole) {
  const roomRef   = db.ref(`rooms/${roomCode}`);
  const enemyRole = playerRole === 'p1' ? 'p2' : 'p1';
  for (let attempt = 0; attempt < 3; attempt++) {
    let room;
    try { room = (await roomRef.once('value')).val(); }
    catch (err) { console.error('방 읽기 실패:', err); return; }
    if (room?.players?.[playerRole]?.uid !== currentUid()) return;   // 이미 방·자리가 없음

    const enemy = room.players?.[enemyRole];
    const alone = !enemy || enemy.connected === false || !!enemy.bot;
    try {
      if (alone) await roomRef.remove();
      else       await roomRef.update({ [`players/${playerRole}`]: null, playerCount: 1 });
      return;
    } catch (err) {
      console.warn('방 나가기 재시도:', err);
    }
  }
}

/** 역할을 모를 때(새로고침 등) — 방에서 내 uid가 앉은 자리를 찾아 나간다 */
async function leaveRoomAsMe(roomCode) {
  const room = (await db.ref(`rooms/${roomCode}`).once('value')).val();
  const role = ['p1', 'p2'].find(r => room?.players?.[r]?.uid === currentUid());
  if (role) await leaveRoomData(roomCode, role);
}

/** 로비로 나갈 때 접속자 목록에서 내 닉네임 제거 */
function _removeMyPresence() {
  const nick = sessionStorage.getItem('nickname');
  // 이미 지워졌으면 규칙상 거부되지만 결과는 같으므로 무시
  return nick ? db.ref(`players/${nick}`).remove().catch(() => {}) : null;
}

/** presence.js 이벤트 → 알림·화면 전환 */
function _roomPresenceHandlers(roomCode, playerRole) {
  // 방을 떠나 로비로 — 내 자리가 남아 있으면 정리하고, 로비에서도 이유를 보여준다
  const toLobby = (noticeKey) => {
    if (typeof haltGame === 'function') haltGame();
    showNotice(t(noticeKey), 'warn');
    sessionStorage.setItem('lobbyNotice', t(noticeKey));
    const work = presencePrepareNavigation()
      .then(() => leaveRoomData(roomCode, playerRole))
      .then(_removeMyPresence);
    navigateWithLoader(t('toLobby'), work, 'index.html');
  };

  return {
    onEnemyDisconnecting(sec) {
      showNotice(t('enemyDisconnecting').replace('{n}', sec), 'warn');
    },
    onEnemyReconnected() {
      showNotice(t('enemyReconnected'), 'info', 2500);
    },
    onEnemyForfeit() {
      showNotice(t('enemyForfeit'), 'warn', 4000);
      if (typeof declareForfeitWin === 'function') declareForfeitWin();
    },
    onEnemyGone({ how, inGame, newRole, needsReload, ok }) {
      if (!ok) { toLobby('roomResetFailed'); return; }

      if (!needsReload) {
        // 대기실에서 상대(p2)가 나감 — 그대로 대기
        showNotice(t(how === 'left' ? 'enemyLeft' : 'enemyKicked'), 'info', 3500);
        return;
      }

      // 게임 중 복귀 또는 방장 승계 → 새 역할로 대기실을 다시 연다
      if (inGame && typeof haltGame === 'function') haltGame();
      const notice = inGame ? 'enemyLeft' : 'becameHost';
      showNotice(t(notice), inGame ? 'warn' : 'info');
      navigateWithLoader(t('toWaitingRoom'), presencePrepareNavigation(),
        `game.html?room=${roomCode}&player=${newRole}`);
    },
    onSelfRemoved() { toLobby('selfRemoved'); },
    onRoomGone()    { toLobby('roomGone'); },
    onLoadFailed()  { toLobby('roomLoadFailed'); },
  };
}

function cleanupRoomListeners() {
  roomListeners.forEach(fn => fn());
  roomListeners = [];
}
