// ============================================================
//  room.js — 대기실 상태 관리, 게임 시작
// ============================================================

let roomListeners = [];
let _p2JoinDelay  = false; // p2 접속 후 딜레이 중복 방지

function initWaitingRoom(roomCode, playerRole) {
  // ── DOM 업데이트 먼저 (Firebase 오류와 무관하게 표시) ──
  document.getElementById('display-room-code').textContent = roomCode;

  // 방장 전용 UI / 접속자 전용 UI
  if (playerRole === 'p1') {
    document.getElementById('btn-start-game').classList.remove('hidden');
    document.getElementById('msg-waiting-p2').classList.add('hidden');
  } else {
    document.getElementById('btn-start-game').classList.add('hidden');
    document.getElementById('msg-waiting-p2').classList.remove('hidden');
  }

  // ── Firebase 참조 (DB가 없으면 오류 표시) ──
  if (typeof db === 'undefined') {
    document.getElementById('name-p1').textContent = '⚠ Firebase 연결 실패';
    console.error('Firebase db가 초기화되지 않았습니다. Realtime Database를 활성화했는지 확인하세요.');
    return;
  }

  const roomRef = db.ref(`rooms/${roomCode}`);

  // onDisconnect 등록 (lobby.js에서 취소됐으므로 여기서 재등록)
  if (playerRole === 'p1') {
    roomRef.onDisconnect().remove();
  } else {
    db.ref(`rooms/${roomCode}/players/p2`).onDisconnect().set(null);
    db.ref(`rooms/${roomCode}/playerCount`).onDisconnect().set(1);
  }
  // 플레이어 온라인 레코드도 재등록 — 탭 닫으면 오프라인 처리
  const _waitNick = sessionStorage.getItem('nickname');
  if (_waitNick) db.ref(`players/${_waitNick}`).onDisconnect().remove();

  // 방 코드 복사
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText(roomCode).then(() => {
      document.getElementById('btn-copy-code').textContent = '✅';
      setTimeout(() => { document.getElementById('btn-copy-code').textContent = '📋'; }, 1500);
    });
  });

  // 실시간 방 상태 감청
  const unsub = roomRef.on('value', snap => {
    if (!snap.exists()) {
      // 방이 삭제됨 (방장 나감)
      alert(t('hostLeft'));
      cleanupRoomListeners();
      location.href = 'index.html';
      return;
    }

    const room = snap.val();

    // 인원수 업데이트
    document.getElementById('display-player-count').textContent = room.playerCount;
    document.getElementById('name-p1').textContent = room.players?.p1?.name || '—';
    document.getElementById('name-p2').textContent = room.players?.p2?.name || t('waitingSlot');

    const p2Filled = room.playerCount >= 2;
    document.getElementById('slot-p2').classList.toggle('filled', p2Filled);

    // Start 버튼 활성화 (방장만)
    if (playerRole === 'p1') {
      const btn = document.getElementById('btn-start-game');
      if (p2Filled) {
        if (!_p2JoinDelay) {
          _p2JoinDelay = true;
          btn.disabled = true;
          btn.textContent = t('connectingPlayers');
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = t('startGameReady');
          }, 1500);
        }
      } else {
        _p2JoinDelay = false;
        btn.disabled = true;
        btn.textContent = t('startGame');
      }
    }

    // 상대방이 게임을 시작했을 때 (p2 감지)
    if (room.status === 'playing') {
      cleanupRoomListeners();
      startGame(roomCode, playerRole, room);
    }
  });

  roomListeners.push(() => roomRef.off('value', unsub));

  // 방 나가기
  document.getElementById('btn-leave-room').addEventListener('click', () => leaveRoom(roomCode, playerRole));

  // Start 버튼 (방장만)
  document.getElementById('btn-start-game').addEventListener('click', () => {
    beginGame(roomCode, playerRole);
  });
}

async function beginGame(roomCode, playerRole) {
  if (playerRole !== 'p1') return;

  const btn = document.getElementById('btn-start-game');
  btn.disabled = true;
  btn.textContent = t('startingGame');

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
    phase: 'cardSelect',
    turnNumber: 0,
    p1: initialPlayer(),
    p2: initialPlayer()
    // winner, winReason, dots, startedAt 키를 포함하지 않음 → Firebase에서 자동 삭제
  };

  await db.ref(`rooms/${roomCode}`).update({
    status: 'playing',
    gameStartTime: serverTimestamp(),
    gameState: freshGameState
  });
  // status 변경으로 양쪽 클라이언트의 room listener가 startGame() 호출
}

function leaveRoom(roomCode, playerRole) {
  cleanupRoomListeners();

  const nickname = window.localNickname || sessionStorage.getItem('nickname');

  if (playerRole === 'p1') {
    // 방장: 방 삭제
    db.ref(`rooms/${roomCode}`).remove();
  } else {
    // 접속자: 본인 슬롯만 제거
    db.ref(`rooms/${roomCode}`).update({
      playerCount: 1,
      'players/p2': null
    });
  }

  if (nickname) db.ref(`players/${nickname}`).remove();
  sessionStorage.setItem('_nav', '1');
  location.href = 'index.html';
}

function cleanupRoomListeners() {
  roomListeners.forEach(fn => fn());
  roomListeners = [];
}
