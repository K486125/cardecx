// ============================================================
//  netstate.js — 인터넷 연결 상태 안내
//
//  Firebase의 `.info/connected`를 지켜본다. 이 값은 '인터넷이 되나'가 아니라
//  '실시간 DB와 이어져 있나'라서, 게임이 실제로 돌아가는 조건과 정확히 같다.
//
//  · 잠깐 끊김(NET_WARN_MS)  → 위쪽에 작은 띠. 보통 몇 초 안에 알아서 붙는다.
//  · 오래 끊김(NET_LOST_MS)  → 전체 화면 안내. 여기서 멈춰 있으면 사용자가
//                              뭘 해야 할지 알 수 있어야 한다 (연결 확인 / 다시 시도).
//
//  화면을 갈아엎는 대신 덮개로 띄운다 — 다른 페이지로 보내면 방 코드와
//  진행 중이던 판을 잃는다. 연결이 돌아오면 덮개만 걷고 그대로 이어서 한다.
// ============================================================

const NET_WARN_MS = 3000;
const NET_LOST_MS = 15000;

let _netStarted = false;
let _netOffSince = 0;        // 끊긴 시각 (0이면 붙어 있음)
let _netTick     = null;
let _netStopped  = false;    // 의도한 페이지 이동 — 이때의 끊김은 알리지 않는다

function netStateInit() {
  if (_netStarted || typeof db === 'undefined') return;
  _netStarted = true;

  db.ref('.info/connected').on('value', snap => {
    if (_netStopped) return;
    if (snap.val() === true) {
      _netOffSince = 0;
      _netRender();
    } else if (!_netOffSince) {
      _netOffSince = Date.now();
    }
  });

  // 끊긴 시간을 세야 하므로 값 변화만으로는 부족하다
  _netTick = setInterval(() => { if (!_netStopped) _netRender(); }, 500);

  // 페이지를 떠나면서 끊기는 것은 정상이다 (lobby.js가 goOffline을 부른다)
  window.addEventListener('pagehide', () => {
    _netStopped = true;
    clearInterval(_netTick);
    _netBox()?.remove();
  });
}

function _netBox() { return document.getElementById('net-state'); }

/** 관전 화면인가 — 관전자는 '끊긴 동안의 경기'를 이어 하는 게 아니라 따라잡는다 */
function _netSpectating() {
  try { return new URLSearchParams(location.search).get('spectate') === 'true'; } catch { return false; }
}

/** 지금 상태를 화면에 반영 — 붙어 있으면 아무것도 안 띄운다 */
function _netRender() {
  const off = _netOffSince ? Date.now() - _netOffSince : 0;
  const level = !off ? 'ok' : (off >= NET_LOST_MS ? 'lost' : (off >= NET_WARN_MS ? 'warn' : 'ok'));

  let box = _netBox();
  if (level === 'ok') {
    if (box) {
      // 끊겼다가 돌아온 경우에만 '복구됨'을 잠깐 보여 준다
      if (box.dataset.level === 'lost' || box.dataset.level === 'warn') {
        box.dataset.level = 'back';
        box.className = 'net-state net-state-back';
        box.innerHTML = `<div class="net-state-bar">${t('netBack')}</div>`;
        setTimeout(() => { if (_netBox()?.dataset.level === 'back') _netBox().remove(); }, 2000);
      }
    }
    return;
  }

  if (!box) {
    box = document.createElement('div');
    box.id = 'net-state';
    document.body.appendChild(box);
  }
  const showSec = () => {
    const sec = box.querySelector('.net-state-sec');
    if (sec) sec.textContent = Math.floor(off / 1000) + '초';
  };
  if (box.dataset.level === level) { showSec(); return; }
  box.dataset.level = level;

  if (level === 'warn') {
    box.className = 'net-state net-state-warn';
    box.innerHTML = `<div class="net-state-bar">${t('netReconnecting')} <span class="net-state-sec"></span></div>`;
    showSec();
    return;
  }

  // 오래 끊김 — 전체 화면 안내
  box.className = 'net-state net-state-lost';
  box.innerHTML =
    `<div class="net-state-panel">` +
      `<div class="net-state-icon">📡</div>` +
      `<h2>${t('netLostTitle')}</h2>` +
      `<p>${t('netLostBody')}</p>` +
      `<p class="net-state-note">${t(_netSpectating() ? 'netLostNoteSpec' : 'netLostNote')} <span class="net-state-sec"></span></p>` +
      `<button type="button" id="net-state-retry">${t('netRetry')}</button>` +
    `</div>`;
  // 새로고침은 답이 아니다 — 게임 화면은 새로고침하면 판을 떠난다(game.js _exitToNickname).
  // 연결만 끊었다 다시 잇는다. 돌아오면 .info/connected가 알려 주고 안내가 걷힌다.
  box.querySelector('#net-state-retry').addEventListener('click', e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = t('netRetrying');
    try { db.goOffline(); } catch (_) {}
    setTimeout(() => {
      try { db.goOnline(); } catch (_) {}
      setTimeout(() => { if (btn.isConnected) { btn.disabled = false; btn.textContent = t('netRetry'); } }, 4000);
    }, 300);
  });
  showSec();
}

document.addEventListener('DOMContentLoaded', netStateInit);
