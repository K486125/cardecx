// ============================================================
//  lobby.js — 닉네임 등록, 방 생성/접속
// ============================================================

let localNickname = null;

function showError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError(elId) {
  const el = document.getElementById(elId);
  el.textContent = '';
  el.classList.add('hidden');
}

// ── 초기 i18n 적용 ──────────────────────────────────────────
applyI18n();

// 첫 화면 — 폰트·화면 맞춤이 끝날 때까지 로딩 화면이 덮고 있다가 닉네임 화면으로
bootLoader(null, () => revealScreen('screen-nickname'));

// 방에서 로비로 보내진 이유 (존재하지 않는 방 등) — 한 번만 표시
(function showLobbyNotice() {
  const msg = sessionStorage.getItem('lobbyNotice');
  if (!msg) return;
  sessionStorage.removeItem('lobbyNotice');
  showError('nickname-error', msg);
})();

// ── 방 상태 판별 ────────────────────────────────────────────
/** 게임 화면에 한 번도 들어오지 못한 자리를 버려진 것으로 보는 시간 (방 생성 후) */
const NEVER_CONNECTED_MS = 60000;
// 심장박동(presence.js seenAt)이 이만큼 끊기면 그 자리는 죽은 것으로 본다.
// DB 규칙의 삭제 조건과 같은 값이어야 목록에서만 사라지고 서버엔 남는 일이 없다.
const SEEN_STALE_MS = 60000;

/** 모든 자리가 끊긴(또는 빈) 방 — 아무도 돌아오지 않는 유령 방.
 *  방을 만들거나 참가한 뒤 게임 화면을 끝내 열지 못한 자리(connected 없음)도 오래되면 포함 */
/**
 * 이 자리가 아직 살아 있는가.
 *
 * connected 플래그만 보면 유령 방이 남는다 — onDisconnect를 취소해 둔
 * 찰나(페이지 이동 직전)에 브라우저가 닫히면 connected=true가 그대로 굳는다.
 * 그래서 presence.js가 15초마다 찍는 seenAt을 같이 본다.
 */
function _seatAlive(seat, room, now) {
  if (!seat || seat.bot) return false;
  if (seat.connected === false) return false;
  if (typeof seat.seenAt === 'number') return now - seat.seenAt < SEEN_STALE_MS;
  // 아직 한 번도 찍지 않은 자리 — 갓 만든 방이면 기다려 준다
  return (room?.createdAt || 0) >= now - NEVER_CONNECTED_MS;
}

function isDeadRoom(room) {
  const now = serverNow();
  // AI 자리는 사람이 아니므로 제외 — 사람(방장)이 떠나면 AI 방은 유령 방
  return ![room?.players?.p1, room?.players?.p2].some(seat => _seatAlive(seat, room, now));
}

/** 새 참가자가 들어갈 수 있는 방 — 대기 중 · 방장 접속 중 · 빈 p2 자리 */
function isJoinableRoom(room) {
  const host = room?.players?.p1;
  return room?.status === 'waiting' && !!host && host.connected !== false && !room.players?.p2;
}

// ── 패널 자동 핏 ────────────────────────────────────────────
// 닉네임 패널·메인 패널(480×480)과 방 목록 사이드바(320×480)는 모두
// px 고정 캔버스다. 뷰포트에 맞춰 통째로 scale만 하므로 확대/축소해도
// 글자가 다시 줄바꿈되거나 레이아웃이 깨지지 않는다.
(function initPanelFit() {
  const STAGE_W = 480, STAGE_H = 480;
  const MARGIN  = 0.92;  // 화면 가장자리 여백
  const MAX     = 1.6;   // 큰 모니터에서 과도하게 커지는 것 방지

  function applyFit() {
    const fit   = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H) * MARGIN;
    const scale = +Math.min(fit, MAX).toFixed(3);

    // 중앙 정렬 패널
    document.querySelectorAll('.nickname-panel, .main-panel').forEach(el => {
      el.style.transform = `translate(-50%, -50%) scale(${scale})`;
    });
    // 좌측 앵커 사이드바 (원점이 left center 이므로 X 이동 없음)
    const side = document.getElementById('room-sidebar');
    if (side) side.style.transform = `translateY(-50%) scale(${scale})`;
  }

  window.addEventListener('resize', applyFit);
  applyFit();
})();

// ── 방 목록 사이드바 토글 ───────────────────────────────────
function openRoomSidebar() {
  const side = document.getElementById('room-sidebar');
  if (side) side.classList.remove('hidden');
}

function closeRoomSidebar() {
  const side = document.getElementById('room-sidebar');
  if (side) side.classList.add('hidden');
}

document.getElementById('btn-room-menu').addEventListener('click', openRoomSidebar);
document.getElementById('btn-sidebar-close').addEventListener('click', closeRoomSidebar);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeRoomSidebar();
});

// ── 닉네임 확인 ────────────────────────────────────────────
document.getElementById('btn-confirm-nickname').addEventListener('click', confirmNickname);
document.getElementById('input-nickname').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmNickname();
});

async function confirmNickname() {
  const typed = document.getElementById('input-nickname').value.trim();
  clearError('nickname-error');

  // 개발자 모드 — 닉네임 뒤에 '#Dev'를 붙이면 켜진다 (js/dev.js).
  // '#'은 Firebase 경로에 쓸 수 없으므로 닉네임은 '#Dev'를 뗀 이름으로 등록한다
  const parsed = devParseNickname(typed);
  const raw    = parsed.nick;
  devSetMode(parsed.dev);

  if (raw.length < 2 || raw.length > 12) {
    showError('nickname-error', t('nickLengthError'));
    return;
  }

  const btn = document.getElementById('btn-confirm-nickname');
  btn.disabled = true;
  btn.textContent = t('confirmingBtn');

  try {
    // 익명 로그인 완료 대기 — 닉네임은 이 uid 소유로 등록된다
    const uid  = await authReady;
    const snap = await withTimeout(db.ref(`players/${raw}`).once('value'));
    const rec  = snap.exists() ? snap.val() : null;
    // 다른 사람(uid)이 '지금' 쓰고 있을 때만 막는다. 생존 신호(online.js)가 1분 넘게 끊긴 기록은
    // 브라우저가 죽어 남은 유령이다 — 그대로 두면 그 닉네임은 영영 아무도 못 쓴다.
    // 규칙(database.rules.json players/$nick)도 같은 기준으로 덮어쓰기를 허락한다.
    // 경계에서 규칙과 엇갈리지 않게 5초 여유를 둔다.
    const live = rec && typeof rec.lastSeen === 'number' && serverNow() - rec.lastSeen < ONLINE_STALE_MS + 5000;
    if (rec?.uid && rec.uid !== uid && live) {
      showError('nickname-error', t('nickTakenError'));
      return;
    }

    localNickname = raw;

    const playerRef = db.ref(`players/${raw}`);
    await withTimeout(playerRef.set({ uid, online: true, lastSeen: serverTimestamp() }));
    playerRef.onDisconnect().remove();

    document.getElementById('display-nickname').textContent = raw;
    runLoader({ message: t('enteringLobby'), minMs: 600, onDone: () => revealScreen('screen-room') });
    startRoomListListener();
    startOnlineCountListener();
  } catch (err) {
    showError('nickname-error', t(err?.timeout ? 'networkTimeout' : 'nickGeneralError'));
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = t('confirmBtn');
  }
}

// ── 온라인 플레이어 수 실시간 리스너 ────────────────────────
// online: true 만 세면 브라우저가 죽은 사람도 영영 남는다(유령). 최근에 생존 신호(lastSeen)를
// 보낸 기록만 센다 — online.js. 신호가 끊긴 기록은 DB가 바뀌지 않아도 빠져야 하므로 주기적으로 다시 센다.
let _onlineCountRef   = null;
let _onlinePlayers    = {};
let _onlineCountTimer = null;

function _renderOnlineCount() {
  const now   = serverNow();
  const count = Object.values(_onlinePlayers).filter(p => onlineIsFresh(p, now)).length;
  const el = document.getElementById('online-player-count');
  if (el) el.textContent = count;
}

function startOnlineCountListener() {
  if (_onlineCountRef) return;
  _onlineCountRef = db.ref('players');
  _onlineCountRef.on('value', snap => {
    _onlinePlayers = snap.val() || {};
    _renderOnlineCount();
  });
  _onlineCountTimer = setInterval(_renderOnlineCount, 5000);
}

// ── 방 목록 실시간 리스너 ───────────────────────────────────
let _roomListRef = null;

// 모든 플레이어의 연결이 끊긴 채 이 시간 이상 남은 방은 정리한다
// (둘이 동시에 나가면 각자 '끊김'만 남기고 방은 지워지지 않을 수 있다)
const DEAD_ROOM_GRACE_MS = 10000;
let _latestRooms  = {};
let _deadSince    = {};
let _deadRoomTimer = null;

function startRoomListListener() {
  if (_roomListRef) return;
  _roomListRef = db.ref('rooms');
  _roomListRef.on('value', snap => {
    _latestRooms = snap.val() || {};
    // 참가 가능(1인 대기) + 관전 대기(2인 대기) + 관전 가능(게임 중) — 내 방·유령 방 제외
    const visible = Object.entries(_latestRooms).filter(([, r]) => {
      if (r.creatorName === localNickname) return false;
      if (isDeadRoom(r)) return false;
      if (r.players?.p2?.bot) return false;                              // AI 대전 방 제외
      if (r.status === 'finished') return false;                        // 종료된 방 제외
      if (r.status === 'waiting') return true;                          // 참가 / 대기중
      if (r.status === 'playing') return true;                          // 관전
      return false;
    });
    renderRoomList(visible);
  });
  _deadRoomTimer = setInterval(_sweepDeadRooms, 5000);
}

function stopRoomListListener() {
  if (!_roomListRef) return;
  _roomListRef.off('value');
  _roomListRef = null;
  clearInterval(_deadRoomTimer);
  _deadRoomTimer = null;
}

function _sweepDeadRooms() {
  const now = Date.now();
  Object.keys(_deadSince).forEach(code => {
    if (!_latestRooms[code] || !isDeadRoom(_latestRooms[code])) delete _deadSince[code];
  });
  Object.entries(_latestRooms).forEach(([code, room]) => {
    if (!isDeadRoom(room)) return;
    if (!_deadSince[code]) { _deadSince[code] = now; return; }
    if (now - _deadSince[code] < DEAD_ROOM_GRACE_MS) return;
    delete _deadSince[code];
    db.ref(`rooms/${code}`).remove().catch(err => console.warn('유령 방 정리 실패:', code, err));
  });
}

function renderRoomList(rooms) {
  const el = document.getElementById('room-list');
  if (!el) return;

  if (rooms.length === 0) {
    el.innerHTML = `<p class="room-list-empty">${t('noRooms')}</p>`;
    return;
  }

  el.innerHTML = rooms.map(([code, room]) => {
    const isJoinable  = isJoinableRoom(room);
    const isWaiting   = room.status === 'waiting' && !isJoinable;
    const isPlaying   = room.status === 'playing';
    const spectatorCount = room.spectators ? Object.keys(room.spectators).length : 0;
    const spectatorBadge = spectatorCount > 0 ? `<span class="room-spectator-badge">👁 ${spectatorCount}</span>` : '';

    let btnClass, btnText;
    if (isJoinable) { btnClass = 'btn-quick-join';      btnText = t('join'); }
    else if (isWaiting) { btnClass = 'btn-room-waiting'; btnText = t('roomWaiting'); }
    else if (isPlaying) { btnClass = 'btn-spectate';     btnText = t('spectate'); }

    return `
      <div class="room-item" data-code="${code}">
        <div class="room-item-info">
          <span class="room-item-code">${code}${spectatorBadge}</span>
          <span class="room-item-host">${t('host')}${room.creatorName || '?'}</span>
        </div>
        <button class="${btnClass}" data-code="${code}" data-joinable="${isJoinable}" data-waiting="${isWaiting}" data-playing="${isPlaying}">${btnText}</button>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.room-item').forEach(item => {
    const btn = item.querySelector('button');
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      if (btn.dataset.joinable === 'true') {
        btn.disabled = true;
        joinRoomByCode(code).finally(() => { btn.disabled = false; });
      } else if (btn.dataset.waiting === 'true') {
        _showRoomInlineError(item, t('spectateNotReady'));
      } else if (btn.dataset.playing === 'true') {
        btn.disabled = true;
        joinRoomAsSpectator(code).finally(() => { btn.disabled = false; });
      }
    });
  });
}

function _showRoomInlineError(roomItem, msg) {
  const existing = roomItem.querySelector('.room-spectate-error');
  if (existing) { existing.remove(); }
  const err = document.createElement('div');
  err.className = 'room-spectate-error';
  err.textContent = msg;
  roomItem.appendChild(err);
  setTimeout(() => err.remove(), 2500);
}

async function joinRoomAsSpectator(code) {
  const nick = localNickname;
  const specRef = db.ref(`rooms/${code}/spectators/${currentUid()}`);   // 관전자도 uid로 식별
  try {
    const snap = await withTimeout(db.ref(`rooms/${code}`).once('value'));
    if (!snap.exists() || snap.val().status !== 'playing') {
      showError('room-error', t('roomInProgress'));
      return;
    }
    await withTimeout(specRef.set(true));
  } catch (err) {
    console.error('관전 입장 실패:', err);
    specRef.remove().catch(() => {});   // 늦게라도 기록되면 지워지도록 뒤에 줄 세운다
    showError('room-error', t(err?.timeout ? 'networkTimeout' : 'roomInProgress'));
    return;
  }
  specRef.onDisconnect().remove();

  stopRoomListListener();
  sessionStorage.setItem('nickname', nick);
  navigateWithLoader(t('enteringSpectate'), null, `game.html?room=${code}&spectate=true`, { replace: false });
}

// ── AI와 대전 ───────────────────────────────────────────────
// 방을 만들고 p2 자리에 AI를 앉힌다 (자리 주인은 나 — AI 몫은 내 브라우저가 돌린다, bot.js).
// 방 목록에는 보이지 않는다.
document.getElementById('btn-vs-ai').addEventListener('click', createBotRoom);

async function createBotRoom() {
  const btn = document.getElementById('btn-vs-ai');
  btn.disabled = true;
  clearError('room-error');

  let code = null;
  try {
    code = await withTimeout(generateRoomCode());
    const roomRef = db.ref(`rooms/${code}`);
    await withTimeout(roomRef.set({
      createdAt: serverTimestamp(),
      creatorName: localNickname,
      status: 'waiting',
      playerCount: 1,
      players: {
        p1: { name: localNickname, uid: currentUid(), ready: false }
      }
    }));
    await withTimeout(roomRef.update({
      'players/p2': { name: t('botName'), uid: currentUid(), ready: true, connected: true, bot: true, botLevel: 'normal' },
      playerCount: 2,
    }));

    await withTimeout(db.ref(`players/${localNickname}`).update({ uid: currentUid(), online: true, roomCode: code }));
    await withTimeout(db.ref(`players/${localNickname}`).onDisconnect().cancel());

    sessionStorage.setItem('nickname', localNickname);
    navigateWithLoader(t('creatingBotRoom'), null, `game.html?room=${code}&player=p1`, { replace: false });
  } catch (err) {
    if (code) db.ref(`rooms/${code}`).remove().catch(() => {});
    showError('room-error', t(err?.timeout ? 'networkTimeout' : 'createRoomError'));
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

// ── 방 만들기 ───────────────────────────────────────────────
document.getElementById('btn-create-room').addEventListener('click', createRoom);

async function createRoom() {
  const btn = document.getElementById('btn-create-room');
  btn.disabled = true;   // + 버튼은 라벨이 없으므로 비활성만 표시
  clearError('room-error');

  let code = null;
  try {
    code = await withTimeout(generateRoomCode());

    await withTimeout(db.ref(`rooms/${code}`).set({
      createdAt: serverTimestamp(),
      creatorName: localNickname,
      status: 'waiting',
      playerCount: 1,
      players: {
        p1: { name: localNickname, uid: currentUid(), ready: false }
      }
    }));

    // 접속 기록을 통째로 다시 기록 — 연결이 잠깐 끊겨 노드가 지워졌어도 내 uid 소유로 복구된다
    await withTimeout(db.ref(`players/${localNickname}`).update({ uid: currentUid(), online: true, roomCode: code }));

    // 페이지 이동 전 onDisconnect 취소 — 이동 중 연결 끊김으로 플레이어 노드 삭제 방지
    await withTimeout(db.ref(`players/${localNickname}`).onDisconnect().cancel());

    sessionStorage.setItem('nickname', localNickname);
    navigateWithLoader(t('creatingRoom'), null, `game.html?room=${code}&player=p1`, { replace: false });
  } catch (err) {
    // 응답이 늦었을 뿐 나중에 방이 만들어질 수 있으므로 삭제를 뒤에 줄 세운다 (유령 방 방지)
    if (code) db.ref(`rooms/${code}`).remove().catch(() => {});
    showError('room-error', t(err?.timeout ? 'networkTimeout' : 'createRoomError'));
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

// ── 방 접속 ─────────────────────────────────────────────────
document.getElementById('btn-join-room').addEventListener('click', joinRoom);
document.getElementById('input-room-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});
document.getElementById('input-room-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

async function joinRoom() {
  const code = document.getElementById('input-room-code').value.trim().toUpperCase();
  clearError('room-error');

  // 조건은 "코드가 일치하는가" 하나. 방 코드 형식(대문자·숫자 6자)이 아니면 어떤 방과도
  // 일치할 수 없으므로 바로 '없음' 처리 — `.#$[]` 같은 문자는 Firebase 경로에서 예외를 던진다.
  if (!code) return;
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    showError('room-error', t('roomNotFound'));
    return;
  }

  const btn = document.getElementById('btn-join-room');
  btn.disabled = true;
  btn.textContent = t('joiningRoom');

  try {
    await joinRoomByCode(code);
  } catch {
    // joinRoomByCode 내부에서 에러 표시
  } finally {
    btn.disabled = false;
    btn.textContent = t('confirmBtn');
  }
}

async function joinRoomByCode(code) {
  clearError('room-error');

  const roomRef = db.ref(`rooms/${code}`);

  // 들어갈 수 없는 이유 — 없는(또는 모두 나간 유령) 방 / 게임 중 / 자리 없음
  const whyNot = room => {
    if (!room || isDeadRoom(room))  return 'roomNotFound';
    if (room.status !== 'waiting')  return 'roomInProgress';
    if (!isJoinableRoom(room))      return 'roomFull';
    return null;
  };

  let reason;
  try { reason = whyNot((await withTimeout(roomRef.once('value'))).val()); }
  catch (err) { console.error(err); showError('room-error', t('networkTimeout')); return; }
  if (reason) { showError('room-error', t(reason)); return; }

  // 확인과 참가 사이에 방이 지워지거나 자리가 차면 규칙이 이 쓰기를 통째로 거부한다
  try {
    await withTimeout(roomRef.update({
      playerCount: 2,
      'players/p2': { name: localNickname, uid: currentUid(), ready: false }
    }));
  } catch (err) {
    if (err?.timeout) {
      // 늦게라도 참가가 기록되면 되돌리도록 뒤에 줄 세운다 (주인 없는 자리 방지)
      roomRef.update({ 'players/p2': null, playerCount: 1 }).catch(() => {});
      showError('room-error', t('networkTimeout'));
      return;
    }
    console.warn('방 참가 거부:', err);
    const again = whyNot((await roomRef.once('value')).val());
    showError('room-error', t(again || 'roomNotFound'));
    return;
  }

  try {
    await withTimeout(db.ref(`players/${localNickname}`).update({ uid: currentUid(), online: true, roomCode: code }));
    // 페이지 이동 전 onDisconnect 취소 — 이동 중 연결 끊김으로 플레이어 노드 삭제 방지
    await withTimeout(db.ref(`players/${localNickname}`).onDisconnect().cancel());
  } catch (err) {
    // 방에는 이미 앉았으므로 그대로 입장한다 — 접속자 표시는 게임 화면에서 다시 기록된다
    console.warn('접속 기록 갱신 실패:', err);
  }

  stopRoomListListener();
  sessionStorage.setItem('nickname', localNickname);
  navigateWithLoader(t('enteringRoom'), null, `game.html?room=${code}&player=p2`, { replace: false });
}

// ── 탭/창 종료 시 온라인 레코드 즉시 제거 (Firebase onDisconnect 보조) ──────
// _nav 플래그: 의도적 페이지 이동일 때만 설정 → pagehide에서 cleanup 건너뜀
window.addEventListener('pagehide', () => {
  if (sessionStorage.getItem('_nav')) {
    sessionStorage.removeItem('_nav');
  } else {
    const nick = sessionStorage.getItem('nickname');
    if (nick) {
      try { db.ref(`players/${nick}`).remove(); } catch (e) {}
    }
  }
  // 떠나는 페이지의 연결을 확실히 끊는다 — 브라우저가 페이지를 캐시(bfcache)에 보관하면
  // 연결이 살아 있어 onDisconnect(퇴장 처리)가 실행되지 않는다.
  // 의도한 이동은 미리 onDisconnect를 취소해 두었으므로 끊어도 방에는 영향이 없다.
  try { db.goOffline(); } catch (e) {}
});

// 캐시에서 되살아난 페이지는 연결이 끊긴 상태 — 처음부터 다시 시작
window.addEventListener('pageshow', e => {
  if (e.persisted) location.replace('index.html');
});
