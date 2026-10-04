// ============================================================
//  online.js — '지금 접속 중' 생존 신호
//
//  로비의 온라인 수는 players/{닉네임}.online 을 세었다. 그런데 방·게임으로 옮겨 갈 때
//  '끊기면 지우기'(onDisconnect)를 일부러 취소해 두기 때문에(페이지를 넘어가도 기록이
//  살아 있어야 한다), 그 사이에 브라우저가 죽거나 창이 강제로 닫히면 online: true가
//  영영 남는다 — 유령 접속자.
//
//  그래서 방 좌석(presence.js의 seenAt)과 같은 방식으로 간다: 페이지가 살아 있는 동안
//  ONLINE_BEAT_MS마다 lastSeen을 새로 쓰고, 세는 쪽은 ONLINE_STALE_MS 안에 신호가 온
//  기록만 센다. 누가 지워 주지 않아도 죽은 기록은 1분 뒤 저절로 빠진다.
//  (다른 사람의 기록은 규칙상 지울 수 없다 — 세지 않는 것으로 충분하다)
//
//  index.html · game.html 둘 다 싣는다. 관전 화면도 여기서 접속 중으로 잡힌다.
// ============================================================

const ONLINE_BEAT_MS  = 15000;
const ONLINE_STALE_MS = 60000;

let _onlineTimer = null;
let _onlineArmed = false;   // 이번 연결에서 '끊기면 지우기'를 걸었는가

/** 지금 이 페이지의 닉네임 — 로비는 닉네임을 확인한 뒤에만(세션에 남은 예전 이름은 쓰지 않는다) */
function _onlineNick() {
  if (/game\.html$/.test(location.pathname)) return sessionStorage.getItem('nickname');
  return (typeof localNickname !== 'undefined' && localNickname) ? localNickname : null;
}

/** 살아 있다는 신호 — 기록이 지워졌으면 다시 만든다 (연결이 잠깐 끊겨 onDisconnect가 돈 경우) */
function _onlineBeat() {
  if (typeof db === 'undefined' || typeof currentUid !== 'function') return;
  if (sessionStorage.getItem('_nav')) return;          // 페이지를 떠나는 중 — 되살리지 않는다
  const nick = _onlineNick();
  const uid  = currentUid();
  if (!nick || !uid) return;
  const ref = db.ref(`players/${nick}`);
  ref.update({ uid, online: true, lastSeen: serverTimestamp() }).catch(() => {});
  // 연결마다 한 번만 건다. 페이지를 옮기기 직전에 일부러 취소하는 흐름(lobby.js · presence.js)은
  // 그때 _nav가 서 있어 여기까지 오지 않으므로 되돌려 놓지 않는다
  if (!_onlineArmed) {
    _onlineArmed = true;
    ref.onDisconnect().remove().catch(() => { _onlineArmed = false; });
  }
}

function onlineInit() {
  if (_onlineTimer || typeof db === 'undefined') return;
  db.ref('.info/connected').on('value', snap => {
    if (snap.val() === true) _onlineBeat();
    else _onlineArmed = false;                         // 끊기면 서버 쪽 onDisconnect가 이미 돌았다
  });
  _onlineTimer = setInterval(_onlineBeat, ONLINE_BEAT_MS);
  window.addEventListener('pagehide', () => { clearInterval(_onlineTimer); _onlineTimer = null; });
}

/** 이 기록을 '지금 접속 중'으로 쳐도 되는가 — 로비의 온라인 수가 쓴다 */
function onlineIsFresh(rec, now) {
  return !!rec && rec.online === true && typeof rec.lastSeen === 'number' && now - rec.lastSeen < ONLINE_STALE_MS;
}

document.addEventListener('DOMContentLoaded', onlineInit);
