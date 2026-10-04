// ============================================================
//  presence.js — 방 접속 상태 관리 (대기실 + 인게임 공통)
//
//  · 각 자리(players/p1|p2)에 connected 플래그를 둔다. 연결이 끊기면
//    onDisconnect가 connected=false만 기록한다 (방·게임은 건드리지 않음).
//  · 남은 플레이어가 LEAVE_GRACE_SEC 동안 기다린 뒤에도 끊겨 있으면
//    그 자리를 비운다(추방). 새로고침한 플레이어는 유예 시간 안에 복귀 가능.
//  · 방장(p1)이 나가면 남은 p2가 방장 자리를 이어받는다.
//  · 게임 도중이었다면 방을 대기 상태로 되돌린다 (gameState 삭제).
//  · 내가 혼자 남은 상태에서 나가면 방 자체가 삭제되도록 onDisconnect를
//    상황에 맞게 다시 등록한다 (혼자: 방 삭제 / 둘: connected=false).
// ============================================================

const LEAVE_GRACE_SEC = 5;
// 자리에 앵아 있는 동안 이 간격으로 seenAt을 찍는다.
// connected 플래그만으로는 부족하다 — onDisconnect가 등록되지 않은 찰나에
// 브라우저가 닫히면 connected=true가 영원히 남아 유령 방이 된다.
const SEEN_BEAT_MS = 15000;
const PRESENCE_LOAD_TIMEOUT_MS = 10000;   // 방 첫 정보를 기다리는 최대 시간

let _pr = null;

/**
 * @param {string} roomCode
 * @param {'p1'|'p2'} role
 * @param {object} handlers
 *   onEnemyDisconnecting(secondsLeft)  유예 카운트다운
 *   onEnemyReconnected()               유예 중 복귀
 *   onEnemyGone({ how, inGame, newRole })  상대 퇴장 처리 완료 ('left' | 'disconnect')
 *   onEnemyForfeit({ how })            경기 중 상대가 나갔거나 유예 안에 돌아오지 않음 → 기권승 처리
 *                                      (방·경기 기록은 그대로 둔다 — 결과가 난 뒤 대기실에서 자리를 정리한다)
 *   onSelfRemoved()                    내 자리가 사라짐 (추방됨)
 *   onRoomGone()                       방이 사라짐
 *   onLoadFailed()                     방 정보를 읽지 못함 (권한 거부·응답 없음)
 */
function presenceStart(roomCode, role, handlers) {
  presenceStop();
  const ref = db.ref(`rooms/${roomCode}`);
  _pr = {
    roomCode, role, ref, handlers,
    enemyRole: role === 'p1' ? 'p2' : 'p1',
    mode: null,            // 현재 등록된 onDisconnect 종류: 'alone' | 'paired'
    latest: null,          // 마지막 방 스냅샷
    hadEnemy: false,       // 상대가 한 번이라도 있었는지 (퇴장 감지용)
    graceTimer: null,
    acting: false,         // 추방·승계 처리 중에는 스냅샷 처리 보류
    stopped: false,
  };

  const onRoom = ref.on('value', snap => _presenceOnRoom(snap), err => {
    console.error('방 감청 실패:', err);
    if (!_pr || _pr.stopped) return;
    const h = _pr.handlers;
    presenceStop();
    h.onLoadFailed?.();
  });
  // 방 정보가 끝내 오지 않으면(연결 불가 등) 빈 대기실에 멈추지 않도록
  _pr.loadTimer = setTimeout(() => {
    if (!_pr || _pr.stopped || _pr.latest) return;
    const h = _pr.handlers;
    presenceStop();
    h.onLoadFailed?.();
  }, PRESENCE_LOAD_TIMEOUT_MS);
  const connRef = db.ref('.info/connected');
  const onConn = connRef.on('value', s => {
    // 재연결 시 onDisconnect는 이미 소모됐으므로 다시 등록하고 접속 표시도 복구
    if (s.val() === true && _pr && !_pr.stopped && _pr.latest) {
      _presenceMarkConnected(_pr.latest);
      _presenceSyncOnDisconnect(_pr.latest, true);
    }
  });
  _pr.off = () => { ref.off('value', onRoom); connRef.off('value', onConn); };

  // 심장박동 — 이것이 끝기면 로비의 방 목록이 그 자리를 죽은 것으로 본다
  _presenceBeat();
  _pr.beatTimer = setInterval(_presenceBeat, SEEN_BEAT_MS);
}

function presenceStop() {
  if (!_pr) return;
  _pr.stopped = true;
  if (_pr.beatTimer) clearInterval(_pr.beatTimer);
  if (_pr.graceTimer) clearInterval(_pr.graceTimer);
  if (_pr.loadTimer)  clearTimeout(_pr.loadTimer);
  if (_pr.off) _pr.off();
}

/** 마지막으로 받은 방 스냅샷 */
function presenceLatest() {
  return _pr ? _pr.latest : null;
}

/**
 * 페이지 이동 직전 호출 — 이동으로 연결이 끊길 때 onDisconnect가 방을
 * 지우거나 내 자리를 '끊김'으로 표시하지 않도록 모두 취소한다.
 */
function presencePrepareNavigation() {
  const jobs = [];
  if (_pr) jobs.push(_pr.ref.onDisconnect().cancel());
  const nick = sessionStorage.getItem('nickname');
  if (nick) jobs.push(db.ref(`players/${nick}`).onDisconnect().cancel());
  presenceStop();
  return Promise.all(jobs).catch(err => console.error('onDisconnect 취소 실패:', err));
}

// ── 내부 ─────────────────────────────────────────────────────

function _presenceOnRoom(snap) {
  const p = _pr;
  if (!p || p.stopped || p.acting) return;

  if (!snap.exists()) {
    const wasFinished = p.latest?.status === 'finished';
    presenceStop();
    // 종료된 게임의 방은 정상 정리로 삭제됨 — 결과 화면에서 쫓아내지 않는다
    if (!wasFinished) p.handlers.onRoomGone?.();
    return;
  }

  const room = snap.val();
  p.latest = room;

  const me = room.players?.[p.role];
  if (!me || me.uid !== currentUid()) {
    presenceStop();
    p.handlers.onSelfRemoved?.();
    return;
  }

  _presenceMarkConnected(room);
  _presenceSyncOnDisconnect(room, false);
  // 위의 로컬 쓰기가 이 함수를 즉시 한 번 더 호출(중첩)할 수 있다 — 그쪽이 이미 처리했으면 중단
  if (p.stopped || p.acting || p.latest !== room) return;

  // 결과 화면(finished) 동안은 추방하지 않는다 — 대기실로 돌아와 waiting이 되면 그때 정리
  if (room.status === 'finished') { _presenceClearGrace(); return; }

  const enemy = room.players?.[p.enemyRole];
  // 경기 중 — 상대가 나가거나(자리 없음) 유예 안에 돌아오지 않으면 기권승. 한 번만 알린다
  const forfeitable = room.status === 'playing' && !!p.handlers.onEnemyForfeit;
  if (!enemy && forfeitable) {
    _presenceClearGrace();
    if (!p.forfeited) { p.forfeited = true; p.handlers.onEnemyForfeit({ how: 'left' }); }
    return;
  }
  if (enemy && enemy.connected === false && forfeitable && p.forfeited) return;   // 이미 기권승을 알렸다
  if (!enemy) {
    _presenceClearGrace();
    // 상대가 나갔거나, 내가 들어온 순간 이미 방장이 나간 방(p2 혼자) — 방장 자리를 이어받는다
    if (p.hadEnemy || p.role === 'p2') {
      p.hadEnemy = false;
      _presenceHandleEnemyGone(room, 'left');
    }
    return;
  }
  p.hadEnemy = true;

  if (enemy.connected === false) {
    if (!p.graceTimer) _presenceStartGrace();
  } else if (p.graceTimer) {
    _presenceClearGrace();
    p.handlers.onEnemyReconnected?.();
  }
}

/** 내 자리에 '아직 살아 있다'를 찍는다 */
function _presenceBeat() {
  if (!_pr || _pr.stopped) return;
  db.ref(`rooms/${_pr.roomCode}/players/${_pr.role}/seenAt`).set(serverTimestamp())
    .catch(() => {});   // 끊겨 있으면 그냥 건너뛰다 — 다음 박동에 다시 찍는다
}

function _presenceMarkConnected(room) {
  const me = room.players?.[_pr.role];
  if (me && me.connected !== true) {
    db.ref(`rooms/${_pr.roomCode}/players/${_pr.role}/connected`).set(true)
      .catch(err => console.error('접속 표시 실패:', err));
  }
}

/** 항상 '내가 나가면 connected=false', 혼자(상대 없음·끊김)면 추가로 '방 삭제'.
 *  나가는 순간 누가 들어와 방 삭제가 규칙에 막혀도, 끊김 표시가 남아 새 참가자가 유예 후 정리한다.
 *  게임이 끝난 방도 두 플레이어가 대기실로 돌아가 재사용하므로 같은 규칙을 따른다 */
function _presenceSyncOnDisconnect(room, force) {
  const p = _pr;
  const enemy = room.players?.[p.enemyRole];
  // AI 상대는 사람이 아니므로 '혼자' — 내가 끊기면 방을 지운다
  const mode  = (!enemy || enemy.connected === false || enemy.bot) ? 'alone' : 'paired';
  if (mode === p.mode && !force) return;
  p.mode = mode;
  // 같은 연결 위에서 순서가 보장되므로 취소 → 재등록을 이어서 보낸다
  p.ref.onDisconnect().cancel();
  db.ref(`rooms/${p.roomCode}/players/${p.role}/connected`).onDisconnect().set(false);
  if (mode === 'alone') p.ref.onDisconnect().remove();
}

function _presenceStartGrace() {
  const p = _pr;
  let left = LEAVE_GRACE_SEC;
  p.handlers.onEnemyDisconnecting?.(left);
  p.graceTimer = setInterval(() => {
    left--;
    if (left > 0) { p.handlers.onEnemyDisconnecting?.(left); return; }
    _presenceClearGrace();
    const enemy = p.latest?.players?.[p.enemyRole];
    if (enemy && enemy.connected === false && p.latest.status !== 'finished') {
      // 경기 중이면 기권승 — 예전엔 방을 대기 상태로 되돌리고 경기 기록을 지워 승자 없이 무효가 됐다
      if (p.latest.status === 'playing' && p.handlers.onEnemyForfeit) {
        if (!p.forfeited) { p.forfeited = true; p.handlers.onEnemyForfeit({ how: 'disconnect' }); }
      } else {
        _presenceHandleEnemyGone(p.latest, 'disconnect');
      }
    }
  }, 1000);
}

function _presenceClearGrace() {
  if (_pr?.graceTimer) { clearInterval(_pr.graceTimer); _pr.graceTimer = null; }
}

/** 상대 자리 비우기 + (게임 중이면) 방을 대기 상태로 복구 + (방장이 나갔으면) 방장 승계 */
async function _presenceHandleEnemyGone(room, how) {
  const p = _pr;
  if (!p || p.acting || p.stopped) return;   // 중복 처리 방지
  p.acting = true;
  const inGame = room.status === 'playing';
  let newRole  = p.role;
  let ok       = true;

  // 게임 중 복귀·방장 승계는 페이지를 새로 로드한다 → 여기서 감시를 멈춰야
  // 내가 p2 자리를 비우는 순간 '내가 추방됨'으로 오인하지 않는다
  const needsReload = inGame || p.role === 'p2';
  if (needsReload) presenceStop();

  try {
    const reset = {
      playerCount: 1,
      [`players/${p.role}/ready`]: false,
    };
    if (room.players?.[p.enemyRole]) reset[`players/${p.enemyRole}`] = null;   // 추방
    if (inGame) { reset.status = 'waiting'; reset.gameState = null; }
    await p.ref.update(reset);

    if (p.role === 'p2') {
      // 방장이 나감 → 내가 방장(p1) 자리로 이동. 자리 uid는 바꿀 수 없으므로 새로 앉는다
      const me = room.players.p2;
      await p.ref.update({
        'players/p1': { name: me.name, uid: me.uid, ready: false, connected: true },
        'players/p2': null,
        creatorName:  me.name,
      });
      newRole = 'p1';
    }
  } catch (err) {
    ok = false;
    console.error('상대 퇴장 처리 실패:', err);
  }

  if (!needsReload) p.acting = false;
  p.handlers.onEnemyGone?.({ how, inGame, newRole, needsReload, ok });
}
