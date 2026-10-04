// ============================================================
//  transition.js — 상단 알림 배너 · 게임 안 페이지 이동 (game.html 전용)
//  로딩 화면은 loading.js
// ============================================================

// ── 상단 알림 배너 ───────────────────────────────────────────
let _noticeHideTimer = null;

/**
 * 화면 상단 중앙 알림. ms 생략 시 계속 표시(다음 호출로 갱신/숨김).
 * @param {string} text
 * @param {'info'|'warn'} [tone]
 * @param {number} [ms]
 */
function showNotice(text, tone = 'info', ms) {
  let el = document.getElementById('game-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'game-notice';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.className   = `game-notice ${tone} visible`;
  clearTimeout(_noticeHideTimer);
  if (ms) _noticeHideTimer = setTimeout(hideNotice, ms);
}

function hideNotice() {
  const el = document.getElementById('game-notice');
  if (el) el.classList.remove('visible');
}

// ── 화면 가운데 알림 ─────────────────────────────────────────
// 흰 글자 + 검은 테두리 + 그림자. 톡 튀어나온 뒤 떠오르며 사라진다.
// 여러 번 부르면 처음부터 다시 재생된다 (연타해도 자연스럽게 다시 뜬다).
let _centerNoticeTimer = null;

function showCenterNotice(text, ms = 1200) {
  let el = document.getElementById('center-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'center-notice';
    el.className = 'center-notice';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  // 이미 재생 중이어도 처음부터 다시 — 클래스를 뗐다 붙이는 방법은 같은 프레임에서 안 먹는 경우가 있다
  el.getAnimations().forEach(a => { a.cancel(); a.play(); });
  clearTimeout(_centerNoticeTimer);
  _centerNoticeTimer = setTimeout(() => el.classList.remove('show'), ms);
}
