// ============================================================
//  auth.js — 익명 로그인 (플레이어 고유 ID)
//  firebase-config.js 다음에 로드. 모든 DB 접근은 authReady 이후에 해야 한다 —
//  보안 규칙이 auth.uid로 소유권을 검사하므로 로그인 전 요청은 거부된다.
//
//  같은 브라우저에서는 새로고침·재방문해도 같은 uid가 유지된다
//  (Firebase가 로컬 저장소에 세션을 보관). 사이트 데이터 삭제·시크릿 창·
//  다른 기기에서는 새 uid가 발급된다.
// ============================================================

const auth = firebase.auth();

const AUTH_TIMEOUT_MS = 15000;   // 로그인 응답을 기다리는 최대 시간 — 넘으면 실패로 처리해 화면이 멈추지 않게

/** 로그인이 끝나면 uid로 resolve 되는 Promise */
const authReady = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('로그인 응답 없음')), AUTH_TIMEOUT_MS);
  const done  = uid => { clearTimeout(timer); resolve(uid); };
  const unsubscribe = auth.onAuthStateChanged(user => {
    unsubscribe();
    if (user) {
      done(user.uid);          // 저장된 세션 복원
      return;
    }
    auth.signInAnonymously()
      .then(cred => done(cred.user.uid))
      .catch(err => {
        console.error('익명 로그인 실패 — Firebase 콘솔에서 익명 로그인이 켜져 있는지 확인하세요.', err);
        clearTimeout(timer);
        reject(err);
      });
  });
});

/** 현재 로그인된 uid (로그인 전이면 null) */
function currentUid() {
  return auth.currentUser ? auth.currentUser.uid : null;
}
