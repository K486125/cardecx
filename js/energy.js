// ============================================================
//  energy.js — 에너지 관리 (10초마다 +5, 최대 100)
// ============================================================

const ENERGY_MAX      = 100;
const ENERGY_REGEN    = 5;
const ENERGY_INTERVAL = 3000; // 3초

let _energyPlayerKey    = null;
let _currentEnergy      = 100;
let _energyTimer        = null;
let _burstInterval      = null;
let _burstActive        = false;
let _overtimeModeActive = false;
let _lastBurstUntil     = 0;

function energyInit(playerKey, initialEnergy) {
  _energyPlayerKey    = playerKey;
  _currentEnergy      = initialEnergy ?? ENERGY_MAX;
  _overtimeModeActive = false;
  _lastBurstUntil     = 0;
  _renderEnergy(_currentEnergy);

  if (_energyTimer)   { clearInterval(_energyTimer);   _energyTimer   = null; }
  if (_burstInterval) { clearInterval(_burstInterval); _burstInterval = null; }
  _burstActive = false;

  _energyTimer = setInterval(_energyTick, ENERGY_INTERVAL);
}

function energyCleanup() {
  if (_energyTimer)   { clearInterval(_energyTimer);   _energyTimer   = null; }
  if (_burstInterval) { clearInterval(_burstInterval); _burstInterval = null; }
  _burstActive        = false;
  _overtimeModeActive = false;
  _lastBurstUntil     = 0;
  const bar = document.getElementById('energy-bar');
  if (bar) bar.classList.remove('energy-burst');
}

function _energyTick() {
  if (typeof gamePaused === 'function' && gamePaused()) return;   // 컷씬 중엔 게임 시간이 멈춘다
  const prev = _currentEnergy;
  _currentEnergy = clamp(_currentEnergy + ENERGY_REGEN, 0, ENERGY_MAX);
  if (_currentEnergy !== prev) {
    _renderEnergy(_currentEnergy);
    writeEnergy(_energyPlayerKey, _currentEnergy, true);
  }
}

function energyEnterOvertimeMode() {
  _overtimeModeActive = true;
  if (_energyTimer)   { clearInterval(_energyTimer);   _energyTimer   = null; }
  if (_burstInterval) { clearInterval(_burstInterval); _burstInterval = null; }
  _burstActive = false;
  const b = document.getElementById('energy-bar');
  if (b) b.classList.remove('energy-burst');

  _energyTimer = setInterval(() => {
    if (typeof gamePaused === 'function' && gamePaused()) return;
    const prev = _currentEnergy;
    _currentEnergy = clamp(_currentEnergy + 10, 0, ENERGY_MAX);
    if (_currentEnergy !== prev) {
      _renderEnergy(_currentEnergy);
      writeEnergy(_energyPlayerKey, _currentEnergy, true);
    }
  }, 1000);
}

/**
 * 에너지 버스트 확인 — 호박마차 카드 사용 시 Firebase 업데이트 수신 후 호출
 * 이미 활성 중이면 중복 시작 방지
 */
function energyCheckBurst(burstUntil, perTick) {
  if (_burstActive || _overtimeModeActive) return;
  if (burstUntil <= _lastBurstUntil) return;
  const now = typeof gameNow === 'function' ? gameNow() : Date.now();
  if (now >= burstUntil) return;

  _lastBurstUntil = burstUntil;
  _burstActive = true;
  const bar = document.getElementById('energy-bar');
  if (bar) bar.classList.add('energy-burst');

  _burstInterval = setInterval(() => {
    const n = typeof gameNow === 'function' ? gameNow() : Date.now();
    if (n >= burstUntil) {
      clearInterval(_burstInterval);
      _burstInterval = null;
      _burstActive   = false;
      const b = document.getElementById('energy-bar');
      if (b) b.classList.remove('energy-burst');
      return;
    }
    if (typeof gamePaused === 'function' && gamePaused()) return;
    const prev = _currentEnergy;
    _currentEnergy = clamp(_currentEnergy + (perTick || 10), 0, ENERGY_MAX);
    if (_currentEnergy !== prev) {
      _renderEnergy(_currentEnergy);
      writeEnergy(_energyPlayerKey, _currentEnergy, true);
    }
  }, 1000);
}

function _renderEnergy(val) {
  const bar = document.getElementById('energy-bar');
  const num = document.getElementById('energy-value');
  if (!bar || !num) return;
  bar.style.width = ((val / ENERGY_MAX) * 100) + '%';
  num.textContent = val;
  if (typeof updateDeckAffordability === 'function') updateDeckAffordability();
}

/**
 * 에너지 차감 (카드 사용 시 호출)
 * @returns {boolean} 차감 성공 여부
 */
function deductEnergy(cost) {
  // 개발자 모드 — 에너지 무제한 (js/dev.js)
  if (typeof devModeOn === 'function' && devModeOn()) return true;

  if (_currentEnergy < cost) {
    // 에너지 부족 흔들림
    const box = document.querySelector('.energy-row');
    if (box) {
      box.classList.add('energy-shake');
      setTimeout(() => box.classList.remove('energy-shake'), 500);
    }
    return false;
  }
  _currentEnergy = clamp(_currentEnergy - cost, 0, ENERGY_MAX);
  _renderEnergy(_currentEnergy);
  return true;
}

/**
 * 상대 카드(바람 스매시)에 에너지를 깎인다 — **맞은 쪽 브라우저에서** 부른다.
 *
 * 에너지는 각자 자기 것을 들고 있다(_currentEnergy). 그래서 상대가 내 energy를
 * DB에 직접 써 봤자 내 다음 회복 틱이 내 값으로 덮어써 버린다. 실제로 쓸 수 있는
 * 에너지를 줄이려면 이렇게 맞은 쪽이 스스로 깎아야 한다.
 */
function energyDrain(amount) {
  const before = _currentEnergy;
  _currentEnergy = clamp(_currentEnergy - amount, 0, ENERGY_MAX);
  if (_currentEnergy === before) return;
  _renderEnergy(_currentEnergy);
  writeEnergy(_energyPlayerKey, _currentEnergy);
  // 깎였다는 것을 알 수 있게 한 번 흔든다
  const box = document.querySelector('.energy-row');
  if (box) {
    box.classList.remove('energy-shake');
    void box.offsetWidth;
    box.classList.add('energy-shake');
    setTimeout(() => box.classList.remove('energy-shake'), 500);
  }
}

/** 외부에서 에너지 강제 동기화 (Firebase 수신값 반영) */
function syncEnergyFromRemote(val) {
  _currentEnergy = val;
  _renderEnergy(_currentEnergy);
}

function getCurrentEnergy() {
  return _currentEnergy;
}
