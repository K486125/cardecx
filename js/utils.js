// ============================================================
//  utils.js — 공통 유틸리티
// ============================================================

const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * 6자 대문자+숫자 고유 방 코드 생성 (Firebase 중복 확인 포함)
 * @returns {Promise<string>}
 */
async function generateRoomCode() {
  while (true) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    const snap = await db.ref(`rooms/${code}`).once('value');
    if (!snap.exists()) return code;
  }
}

/**
 * 확률 가중치 기반 랜덤 등급 선택
 * @param {{ common:number, rare:number, epic:number, mythic:number, legendary:number }} weights
 * @returns {string} 등급 키
 */
function weightedRandomGrade(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let r = Math.random() * total;
  for (const [key, val] of entries) {
    r -= val;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

/**
 * 배열에서 무작위 요소 반환
 */
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 값 클램프
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * UUID-like 고유 ID 생성 (DOT용)
 */
function uniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Firebase ServerValue.TIMESTAMP 단축
 */
function serverTimestamp() {
  return firebase.database.ServerValue.TIMESTAMP;
}

/**
 * 서버 시계 보정값 (ms) — Firebase .info/serverTimeOffset 기반
 * 클라이언트 시계가 서버보다 앞서면 양수, 늦으면 음수
 */
let _serverTimeOffset = 0;

/** Firebase에서 서버 시계 차이를 받아와 _serverTimeOffset 갱신 */
function initServerTime() {
  firebase.database().ref('.info/serverTimeOffset').on('value', snap => {
    _serverTimeOffset = snap.val() || 0;
  });
}

/**
 * 서버 기준 현재 시간(ms) — Date.now() 대신 이 함수를 사용하면
 * 두 클라이언트 간 시계 차이로 인한 타임스탬프 오차를 제거할 수 있음
 */
function serverNow() {
  return Date.now() + _serverTimeOffset;
}

/* ── 게임 시간 (컷씬 동안 멈춘다) ────────────────────────────
   그림리퍼 컷씬이 도는 동안은 경기 시간이 흐르지 않는다 — 타이머·에너지·지속 효과·예약 피해·
   효과 만료가 모두 멈췄다가 컷씬이 끝나면 이어진다.
   멈춤은 gameState/pauses/{id} = { at: 서버 시각, dur: ms } 로 두 화면이 같이 받는다.
   게임 시간 = 서버 시각 − (그때까지 멈춰 있던 시간의 합, 겹친 구간은 한 번만).
   경기 중에 '언제까지'를 재는 값(효과 만료·예약 적용 시각·오버타임 시작)은 전부 게임 시간으로 쓴다. */
let _gamePauses = [];   // [[시작, 끝]] 서버 시각, 시작순, 겹침 합침

function gamePauseSet(pauses) {
  const list = Object.values(pauses || {})
    .filter(p => p && typeof p.at === 'number' && typeof p.dur === 'number' && p.dur > 0)
    .map(p => [p.at, p.at + p.dur])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  list.forEach(([a, b]) => {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  });
  _gamePauses = merged;
}

/** 서버 시각 t → 그 순간의 게임 시간 */
function gameTimeOf(t) {
  let paused = 0;
  for (const [a, b] of _gamePauses) {
    if (t <= a) break;
    paused += Math.min(t, b) - a;
  }
  return t - paused;
}

function gameNow() { return gameTimeOf(serverNow()); }

/** 지금 멈춰 있는가 (컷씬 중) */
function gamePaused() { return gamePauseLeft() > 0; }

/** 멈춤이 끝나기까지 남은 ms (멈춰 있지 않으면 0) */
function gamePauseLeft() {
  const t = serverNow();
  for (const [a, b] of _gamePauses) if (t >= a && t < b) return b - t;
  return 0;
}

/**
 * ms 안에 끝나지 않으면 실패로 — 연결이 끊긴 동안 Firebase 쓰기·읽기는 실패하지 않고
 * 연결될 때까지 기다리므로, 버튼·로딩이 끝없이 멈춰 있지 않도록 감싼다.
 */
const NETWORK_TIMEOUT_MS = 10000;
function withTimeout(promise, ms = NETWORK_TIMEOUT_MS) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('응답 없음'), { timeout: true })), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/**
 * game.html 정상 입장 표시 — game.html은 이 표시가 자기 주소와 같을 때만 방에 들어간다.
 * 새로고침·뒤로가기·주소 직접 입력으로 들어오면 표시가 없으므로 방을 정리하고 닉네임 화면으로 간다.
 */
function markGameEntry(url) {
  sessionStorage.setItem('_enter', new URL(url, location.href).href);
}
