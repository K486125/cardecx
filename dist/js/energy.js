// ============================================================
//  energy.js — 에너지 관리 (10초마다 +5, 최대 100)
// ============================================================

const ENERGY_MAX      = 100;
const ENERGY_REGEN    = 5;
const ENERGY_INTERVAL = 3000; // 3초

let _energyPlayerKey  = null;
let _currentEnergy    = 100;
let _energyTimer      = null;
let _burstInterval    = null;
let _burstActive      = false;

function energyInit(playerKey, initialEnergy) {
  _energyPlayerKey = playerKey;
  _currentEnergy   = initialEnergy ?? ENERGY_MAX;
  _renderEnergy(_currentEnergy);

  // 기존 타이머 제거
  if (_energyTimer) clearInterval(_energyTimer);

  _energyTimer = setInterval(_energyTick, ENERGY_INTERVAL);
}

function energyCleanup() {
  if (_energyTimer)   { clearInterval(_energyTimer);   _energyTimer   = null; }
  if (_burstInterval) { clearInterval(_burstInterval); _burstInterval = null; }
  _burstActive = false;
  const bar = document.getElementById('energy-bar');
  if (bar) bar.classList.remove('energy-burst');
}

function _energyTick() {
  const prev = _currentEnergy;
  _currentEnergy = clamp(_currentEnergy + ENERGY_REGEN, 0, ENERGY_MAX);
  if (_currentEnergy !== prev) {
    _renderEnergy(_currentEnergy);
    writeEnergy(_energyPlayerKey, _currentEnergy, true);
  }
}

function energyEnterOvertimeMode() {
  if (_energyTimer) { clearInterval(_energyTimer); _energyTimer = null; }
  _energyTimer = setInterval(() => {
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
  if (_burstActive) return;
  const now = typeof serverNow === 'function' ? serverNow() : Date.now();
  if (now >= burstUntil) return;

  _burstActive = true;
  const bar = document.getElementById('energy-bar');
  if (bar) bar.classList.add('energy-burst');

  _burstInterval = setInterval(() => {
    const n = typeof serverNow === 'function' ? serverNow() : Date.now();
    if (n >= burstUntil) {
      clearInterval(_burstInterval);
      _burstInterval = null;
      _burstActive   = false;
      const b = document.getElementById('energy-bar');
      if (b) b.classList.remove('energy-burst');
      return;
    }
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

/** 외부에서 에너지 강제 동기화 (Firebase 수신값 반영) */
function syncEnergyFromRemote(val) {
  _currentEnergy = val;
  _renderEnergy(_currentEnergy);
}

function getCurrentEnergy() {
  return _currentEnergy;
}
