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
