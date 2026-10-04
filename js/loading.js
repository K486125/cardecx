// ============================================================
//  loading.js — 공용 로딩 화면 (index.html · game.html)
//
//  · 페이지가 열리면 폰트·화면 맞춤·데이터가 준비될 때까지 로딩 화면이 덮고,
//    준비되면 실제 화면이 살짝 페이드인한다 (덜 그려진 화면이 틀어져 보이지 않도록).
//  · 페이지를 옮길 때는 이 페이지에서 60%까지 채우고, 다음 페이지가 같은 문구로
//    60%부터 이어서 100%까지 채운다 — 전환이 끊기지 않고 하나로 이어진다.
// ============================================================

const LOADER_MIN_MS      = 700;    // 로딩 화면 최소 진행 시간
const LOADER_WORK_MS     = 5000;   // 네트워크 작업을 기다리는 최대 시간 — 응답이 없어도 넘어간다
const LOADER_HANDOFF_PCT = 60;     // 페이지 이동 시 다음 페이지가 이어받는 지점

let _loaderTimer = null;

// ── 로딩 화면 480×480 고정 캔버스 맞춤 — 확대/축소해도 글자·게이지가 깨지지 않도록 통째로 scale ──
(function initLoadingStageFit() {
  const STAGE = 480, MARGIN = 0.92, MAX = 1.6;
  function applyFit() {
    const stage = document.querySelector('.loading-stage');
    if (!stage) return;
    const scale = +Math.min(Math.min(window.innerWidth, window.innerHeight) / STAGE * MARGIN, MAX).toFixed(3);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  window.addEventListener('resize', applyFit);
  applyFit();
})();

/** 로딩 게이지 진행률 (0~100) — 원형 링 채움 + 가운데 퍼센트 */
function setLoadingProgress(progress) {
  const ring = document.getElementById('loading-ring');
  const pct  = document.getElementById('loading-pct');
  if (ring) ring.style.setProperty('--p', progress);
  if (pct)  pct.textContent = progress + '%';
}

/** 게이지 아래 안내 문구 — 빈 문자열이면 숨김 */
function setLoadingMessage(message) {
  const el = document.getElementById('loading-message');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function _switchScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.add('hidden');
    s.classList.remove('active');
  });
  const el = document.getElementById(id);
  if (!el) return null;
  el.classList.remove('hidden');
  el.classList.add('active');
  return el;
}

/** 로딩 화면 → 목표 화면 (살짝 페이드인) */
function revealScreen(id) {
  const el = _switchScreen(id);
  if (!el) return;
  el.classList.remove('screen-enter');
  void el.offsetWidth;   // 애니메이션 재시작
  el.classList.add('screen-enter');
  setTimeout(() => el.classList.remove('screen-enter'), 400);
}

/** 진행 중인 로딩을 멈춘다 (다른 로딩이 화면을 넘겨받을 때) */
function cancelLoader() {
  if (_loaderTimer) { clearTimeout(_loaderTimer); _loaderTimer = null; }
}

/**
 * 로딩 화면을 띄우고 from% → to% 진행한 뒤 onDone.
 * work(Promise)가 끝나기 전엔 90%(또는 to)에서 기다린다 — 최대 LOADER_WORK_MS.
 * requestAnimationFrame은 백그라운드 탭에서 멈추므로 setTimeout으로 진행한다.
 */
function runLoader({ message = '', work = null, minMs = LOADER_MIN_MS, from = 0, to = 100, onDone } = {}) {
  cancelLoader();
  _switchScreen('screen-loading');
  setLoadingMessage(message);

  const start = Date.now();
  let workDone = !work;
  if (work) Promise.resolve(work).catch(err => console.error('로딩 작업 실패:', err)).finally(() => { workDone = true; });

  const tick = () => {
    const elapsed = Date.now() - start;
    if (!workDone && elapsed >= LOADER_WORK_MS) {
      console.warn('로딩 작업 응답 없음 — 그대로 진행');
      workDone = true;
    }
    const cap      = workDone ? to : Math.min(to, 90);
    const progress = Math.min(cap, Math.round(from + (to - from) * Math.min(1, elapsed / minMs)));
    setLoadingProgress(progress);
    if (workDone && progress >= to) {
      _loaderTimer = null;
      if (onDone) onDone();
      return;
    }
    _loaderTimer = setTimeout(tick, 30);
  };
  tick();
}

/**
 * 페이지 이동 — pagehide 정리 로직이 의도된 이동임을 알도록 플래그를 남기고,
 * game.html로 갈 때는 정상 입장 표시를 남긴다.
 * replace: 방문 기록을 남기지 않는다 (게임 안의 전환은 뒤로가기로 돌아오지 않도록)
 */
function goTo(url, { replace = true } = {}) {
  sessionStorage.setItem('_nav', '1');
  if (url.includes('game.html')) markGameEntry(url);
  if (replace) location.replace(url);
  else         location.assign(url);
}

/** 로딩 화면을 이어받으며 페이지 이동 — 여기서 60%까지, 다음 페이지가 이어서 100%까지 */
function navigateWithLoader(message, work, url, { replace = true } = {}) {
  runLoader({
    message, work, minMs: 500, to: LOADER_HANDOFF_PCT,
    onDone: () => {
      sessionStorage.setItem('_loader', JSON.stringify({ message, from: LOADER_HANDOFF_PCT }));
      goTo(url, { replace });
    },
  });
}

/**
 * 페이지 첫 화면 — 앞 페이지의 로딩을 이어받아(없으면 0%부터) 폰트와 ready가 준비되면 onDone.
 * @param {Promise|null} ready  화면을 그리는 데 필요한 작업 (방 정보 수신 등)
 */
function bootLoader(ready, onDone, message = '') {
  let handoff = null;
  try { handoff = JSON.parse(sessionStorage.getItem('_loader')); } catch (e) {}
  sessionStorage.removeItem('_loader');

  const fonts = document.fonts ? document.fonts.ready : null;
  runLoader({
    message: handoff?.message || message,
    from:    handoff?.from || 0,
    work:    Promise.all([ready, fonts]),
    minMs:   600,
    onDone,
  });
}
