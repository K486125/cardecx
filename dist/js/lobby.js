// ============================================================
//  lobby.js — 닉네임 등록, 방 생성/접속
// ============================================================

let localNickname = null;

// ── 화면 전환 헬퍼 ──────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.add('hidden');
    s.classList.remove('active');
  });
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.classList.add('active');
}

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

// ── 카드 도감 모달 ───────────────────────────────────────────
(function initCodexModal() {
  const modal    = document.getElementById('codex-modal');
  const overlay  = document.getElementById('codex-overlay');
  const closeBtn = document.getElementById('btn-codex-close');
  const openBtn  = document.getElementById('btn-codex');
  if (!modal) return;

  openBtn.addEventListener('click', () => openCodex());
  const close = () => closeCodex();
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
})();

// ── 업데이트 로그 모달 ──────────────────────────────────────
(function initCampaignModal() {
  const modal    = document.getElementById('campaign-modal');
  const overlay  = document.getElementById('campaign-overlay');
  const closeBtn = document.getElementById('btn-campaign-close');
  const openBtn  = document.getElementById('btn-campaign');
  if (!modal) return;

  openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
  const close = () => modal.classList.add('hidden');
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
})();

// ── 게임 팁 모달 ─────────────────────────────────────────────
(function initTipsModal() {
  const modal    = document.getElementById('tips-modal');
  const overlay  = document.getElementById('tips-overlay');
  const closeBtn = document.getElementById('btn-tips-close');
  const openBtn  = document.getElementById('btn-tips');
  if (!modal) return;

  openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
  const close = () => modal.classList.add('hidden');
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
})();

// ── 설정 모달 ────────────────────────────────────────────────
(function initSettingsModal() {
  const modal   = document.getElementById('settings-modal');
  const overlay = document.getElementById('settings-overlay');
  const select  = document.getElementById('lang-select');
  const closeBtn = document.getElementById('btn-settings-close');
  const openBtn  = document.getElementById('btn-settings');
  if (!modal) return;

  select.value = getLang();

  openBtn.addEventListener('click', () => {
    select.value = getLang();
    modal.classList.remove('hidden');
  });

  const closeModal = () => modal.classList.add('hidden');
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', closeModal);

  select.addEventListener('change', () => {
    setLang(select.value);
    applyI18n();
  });

  // 채팅 토글
  const chatToggle = document.getElementById('btn-chat-toggle');
  if (chatToggle) {
    const updateChatToggle = () => {
      const disabled = localStorage.getItem('cardecx_chat_disabled') === '1';
      chatToggle.dataset.state = disabled ? 'off' : 'on';
      chatToggle.querySelector('.toggle-state-icon').textContent = disabled ? 'speaker_notes_off' : 'chat';
      chatToggle.querySelector('.toggle-state-text').textContent = disabled ? 'OFF' : 'ON';
    };
    updateChatToggle();
    chatToggle.addEventListener('click', () => {
      const now = localStorage.getItem('cardecx_chat_disabled') === '1';
      localStorage.setItem('cardecx_chat_disabled', now ? '0' : '1');
      updateChatToggle();
    });
    openBtn.addEventListener('click', updateChatToggle);
  }
})();

// ── 닉네임 확인 ────────────────────────────────────────────
document.getElementById('btn-confirm-nickname').addEventListener('click', confirmNickname);
document.getElementById('input-nickname').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmNickname();
});

async function confirmNickname() {
  const raw = document.getElementById('input-nickname').value.trim();
  clearError('nickname-error');

  if (raw.length < 2 || raw.length > 12) {
    showError('nickname-error', t('nickLengthError'));
    return;
  }

  const btn = document.getElementById('btn-confirm-nickname');
  btn.disabled = true;
  btn.textContent = t('confirmingBtn');

  try {
    const snap = await db.ref(`players/${raw}`).once('value');
    if (snap.exists() && snap.val().online) {
      showError('nickname-error', t('nickTakenError'));
      return;
    }

    localNickname = raw;

    const playerRef = db.ref(`players/${raw}`);
    await playerRef.set({ online: true, roomCode: null, lastSeen: serverTimestamp() });
    playerRef.onDisconnect().remove();

    document.getElementById('display-nickname').textContent = raw;
    showScreen('screen-room');
    startRoomListListener();
    startOnlineCountListener();
  } catch (err) {
    showError('nickname-error', t('nickGeneralError'));
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = t('confirmBtn');
  }
}

// ── 온라인 플레이어 수 실시간 리스너 ────────────────────────
let _onlineCountRef = null;

function startOnlineCountListener() {
  if (_onlineCountRef) return;
  _onlineCountRef = db.ref('players');
  _onlineCountRef.on('value', snap => {
    const players = snap.val() || {};
    const count = Object.values(players).filter(p => p && p.online).length;
    const el = document.getElementById('online-player-count');
    if (el) el.textContent = count;
  });
}

function stopOnlineCountListener() {
  if (!_onlineCountRef) return;
  _onlineCountRef.off('value');
  _onlineCountRef = null;
}

// ── 방 목록 실시간 리스너 ───────────────────────────────────
let _roomListRef = null;

function startRoomListListener() {
  if (_roomListRef) return;
  _roomListRef = db.ref('rooms');
  _roomListRef.on('value', snap => {
    const rooms = snap.val() || {};
    // 참가 가능(1인 대기) + 관전 대기(2인 대기) + 관전 가능(게임 중) — 내 방 제외
    const visible = Object.entries(rooms).filter(([, r]) => {
      if (r.creatorName === localNickname) return false;
      if (r.status === 'finished') return false;                        // 종료된 방 제외
      if (r.playerCount === 1 && r.status === 'waiting') return true;   // 참가
      if (r.playerCount >= 2 && r.status === 'waiting') return true;    // 대기중
      if (r.status === 'playing') return true;                          // 관전
      return false;
    });
    renderRoomList(visible);
  });
}

function stopRoomListListener() {
  if (!_roomListRef) return;
  _roomListRef.off('value');
  _roomListRef = null;
}

function renderRoomList(rooms) {
  const el = document.getElementById('room-list');
  if (!el) return;

  if (rooms.length === 0) {
    el.innerHTML = `<p class="room-list-empty">${t('noRooms')}</p>`;
    return;
  }

  el.innerHTML = rooms.map(([code, room]) => {
    const isJoinable  = room.playerCount === 1 && room.status === 'waiting';
    const isWaiting   = room.playerCount >= 2 && room.status === 'waiting';
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
  const snap = await db.ref(`rooms/${code}`).once('value');
  if (!snap.exists() || snap.val().status !== 'playing') {
    showError('room-error', t('roomInProgress'));
    return;
  }
  const nick = localNickname;
  const specRef = db.ref(`rooms/${code}/spectators/${nick}`);
  await specRef.set(true);
  specRef.onDisconnect().remove();

  stopRoomListListener();
  sessionStorage.setItem('nickname', nick);
  sessionStorage.setItem('_nav', '1');
  location.href = `game.html?room=${code}&spectate=true`;
}

// ── 방 만들기 ───────────────────────────────────────────────
document.getElementById('btn-create-room').addEventListener('click', createRoom);

async function createRoom() {
  const btn = document.getElementById('btn-create-room');
  btn.disabled = true;
  btn.textContent = t('creatingRoom');
  clearError('room-error');

  try {
    const code = await generateRoomCode();

    await db.ref(`rooms/${code}`).set({
      createdAt: serverTimestamp(),
      creatorName: localNickname,
      status: 'waiting',
      playerCount: 1,
      players: {
        p1: { name: localNickname, ready: false },
        p2: null
      }
    });

    await db.ref(`players/${localNickname}/roomCode`).set(code);

    // 페이지 이동 전 onDisconnect 취소 — 이동 중 연결 끊김으로 플레이어 노드 삭제 방지
    await db.ref(`players/${localNickname}`).onDisconnect().cancel();

    sessionStorage.setItem('nickname', localNickname);
    sessionStorage.setItem('_nav', '1');
    location.href = `game.html?room=${code}&player=p1`;
  } catch (err) {
    showError('room-error', t('createRoomError'));
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = t('createRoom');
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

  if (code.length !== 6) {
    showError('room-error', t('roomCodeLengthError'));
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
    btn.textContent = t('joinRoom');
  }
}

async function joinRoomByCode(code) {
  clearError('room-error');

  const snap = await db.ref(`rooms/${code}`).once('value');

  if (!snap.exists()) {
    showError('room-error', t('roomNotFound'));
    return;
  }

  const room = snap.val();

  if (room.status !== 'waiting') {
    showError('room-error', t('roomInProgress'));
    return;
  }
  if (room.playerCount >= 2) {
    showError('room-error', t('roomFull'));
    return;
  }

  await db.ref(`rooms/${code}`).update({
    playerCount: 2,
    'players/p2': { name: localNickname, ready: false }
  });

  await db.ref(`players/${localNickname}/roomCode`).set(code);

  // 페이지 이동 전 onDisconnect 취소 — 이동 중 연결 끊김으로 플레이어 노드 삭제 방지
  await db.ref(`players/${localNickname}`).onDisconnect().cancel();

  stopRoomListListener();
  sessionStorage.setItem('nickname', localNickname);
  sessionStorage.setItem('_nav', '1');
  location.href = `game.html?room=${code}&player=p2`;
}

// ── 탭/창 종료 시 온라인 레코드 즉시 제거 (Firebase onDisconnect 보조) ──────
// _nav 플래그: 의도적 페이지 이동일 때만 설정 → pagehide에서 cleanup 건너뜀
window.addEventListener('pagehide', () => {
  if (sessionStorage.getItem('_nav')) { sessionStorage.removeItem('_nav'); return; }
  const nick = sessionStorage.getItem('nickname');
  if (!nick) return;
  try { db.ref(`players/${nick}`).remove(); } catch (e) {}
});
