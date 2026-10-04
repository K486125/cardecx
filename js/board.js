// ============================================================
//  board.js — 타워 렌더링, HP 바, 드래그&드롭 타깃
// ============================================================

let _boardPlayerKey   = null; // 'p1' | 'p2'
let _boardEnemyKey    = null;
let _boardCurrentCard = null; // 현재 드래그 중인 카드 정보
let _boardDeckSlot    = null; // 드래그 중인 덱 슬롯 인덱스
let _boardGameState   = null; // 최신 gameState 캐시

// 타워 ID 매핑 헬퍼
function _towerId(owner, pos) {
  return `tower-${owner}-${pos}`;  // 'tower-enemy-left', 'tower-my-king' 등
}

function boardInit(playerKey, enemyKey) {
  _boardPlayerKey = playerKey;
  _boardEnemyKey  = enemyKey;
}

/** 게임 상태 캐시 갱신 (game.js에서 호출) */
function boardUpdateState(gameState) {
  _boardGameState = gameState;
  // 소환 유닛·컷씬 멈춤 (js/units.js) — 플레이어·관전자 화면 모두 여기를 지난다
  if (typeof unitsOnState === 'function') unitsOnState(gameState);
}

// ── 타워 HP 업데이트 ────────────────────────────────────────

/**
 * @param {'my'|'enemy'} owner
 * @param {'left'|'king'|'right'} pos
 * @param {number} hp
 * @param {number} maxHp
 * @param {boolean} alive
 * @param {object} [towerData]  전체 타워 객체 (실드·부활 등 표시용)
 */
function updateTowerDisplay(owner, pos, hp, maxHp, alive, towerData = {}) {
  const towerId = _towerId(owner, pos);
  const towerEl = document.getElementById(towerId);
  if (!towerEl) return;

  // 킹이 무너진 진영의 나머지 타워는 연쇄 폭발이 전담 — 데이터상 alive여도 되살리지 않음
  if (_kingFallen[owner] && pos !== 'king') return;

  if (!alive) {
    if (towerEl.classList.contains('destroyed')) return;
    // 서 있는 걸 본 적 있는 타워만 무너지는 연출 — 들어와 보니 이미 무너져 있던 타워(재접속·관전 입장)는 조용히
    const seen = towerEl.dataset.seenAlive === '1';
    // 킹은 빛 폭발이 걷힐 즈음부터 더 천천히 무너진다 — 빛에 가려 무너지는 모습을 놓치지 않게
    _explodeTower(towerEl, seen ? 'collapse' : null, pos === 'king' ? KING_COLLAPSE : undefined);
    if (pos === 'king') _triggerKingFall(owner, towerEl, seen);
    return;
  }

  towerEl.classList.remove('destroyed');
  towerEl.dataset.seenAlive = '1';

  // 부활 예약 표시 (킹 타워에 검은 링 + 카운트)
  if (pos === 'king') {
    towerEl.classList.toggle('pending-revival', !!towerData.pendingRevival);
    const labelEl = towerEl.querySelector('.tower-label');
    if (labelEl) {
      const revCount = typeof towerData.pendingRevival === 'number' ? towerData.pendingRevival : (towerData.pendingRevival ? 1 : 0);
      labelEl.textContent = revCount > 0 ? `KING ×${revCount}` : 'King';
    }
  }

  // 방어 효과 배지 (면역 → health_and_safety). 피해 감소(벽돌 · 철벽)는 배지 대신 방벽과 기둥 가운데 게이지로 보인다
  const _now        = gameNow();
  _wallSync(towerEl, owner, pos, towerData, _now);
  _iceSync(towerEl, owner, pos, towerData, _now);
  const isImmune    = !!(towerData.immunityUntil && _now < towerData.immunityUntil);
  const hasDefense  = isImmune;
  towerEl.classList.toggle('has-defense', hasDefense);
  const badgeEl = towerEl.querySelector('.tower-defense-badge');
  if (badgeEl) {
    badgeEl.textContent = isImmune ? 'health_and_safety' : 'shield';
    badgeEl.style.color = isImmune ? '#69f0ae' : '#64b5f6';
  }

  // 악몽 배지 (damageAmp 활성 시 좌측 하단)
  const hasNightmare = !!(towerData.damageAmpUntil && _now < towerData.damageAmpUntil);
  towerEl.classList.toggle('has-nightmare', hasNightmare);

  // 파멸의 낙인 배지 (doomSeal 활성 시 우측 하단, 🔱)
  const hasDoomSeal = !!(towerData.doomSealUntil && _now < towerData.doomSealUntil);
  towerEl.classList.toggle('has-doom-seal', hasDoomSeal);

  // 반사 거울 배지 (mirrorUntil 활성 시 좌측 상단, 🪞)
  const hasMirror = !!(towerData.mirrorUntil && _now < towerData.mirrorUntil);
  towerEl.classList.toggle('has-mirror', hasMirror);

  // 힐량 감소 배지 (healReductionUntil 활성 시 우측 상단, 🐍)
  const hasHealReduction = !!(towerData.healReductionUntil && _now < towerData.healReductionUntil);
  towerEl.classList.toggle('has-heal-reduction', hasHealReduction);

  // 체력은 숫자 하나로만 — 남은 체력. 보호막이 있으면 그 수치를 대신 보여준다
  const hpText = document.getElementById(`hptext-${owner}-${pos}`);
  if (!hpText) return;

  const isShielded = (towerData.shieldHp || 0) > 0;
  hpText.textContent = String(Math.max(0, Math.round(isShielded ? towerData.shieldHp : hp)));
  hpText.classList.toggle('shielded', isShielded);
  // 체력이 15% 이하면 숫자가 깜빡인다 (보호막 중에는 제외)
  hpText.classList.toggle('critical', !isShielded && hp > 0 && hp / (maxHp || 1) <= 0.15);
}

/** Firebase towers 스냅샷 → 타워 디스플레이 일괄 업데이트 */
function applyTowersSnapshot(owner, towersData) {
  if (!towersData) return;
  ['left', 'king', 'right'].forEach(pos => {
    const t = towersData[pos];
    if (t) updateTowerDisplay(owner, pos, t.hp, t.maxHp, t.alive, t);
  });
}

// ── 스테이지 좌표 헬퍼 ──────────────────────────────────────
// #screen-game은 1600×900 고정 스테이지를 scale한 것이다. 이펙트는 스테이지
// 내부(#fx-layer)에 스테이지 좌표로 붙여야 스테이지와 같은 배율로 그려진다.

function _getGameScale() {
  return window.gameStageScale || 1;
}

// ── 16×9 타일 맵 ────────────────────────────────────────────
// 타일 한 칸 100px · 맵 1600×900. 타워는 정확히 한 칸을 차지한다.
// 타워는 (1,2) (2,4) (1,6) / 반대편은 좌우 대칭. 기본 화면에서 6칸이 보이므로
// 위·아래 타워까지 HP 바째로 다 들어온다. 타워 사이 거리는 옆 타워까지 224, 반대쪽 끝까지 400.
const TILE      = 100;
const MAP_COLS  = 16;
const MAP_ROWS  = 9;
const MAP_W     = TILE * MAP_COLS;
const MAP_H     = TILE * MAP_ROWS;

/**
 * 맵 좌표 1px이 화면에서 차지하는 px — 게임 화면 배율 × 맵 확대 배율.
 * 타일 맵의 실제 렌더 폭에서 직접 재기 때문에 둘 중 무엇이 바뀌어도 맞는다.
 */
function _mapScale() {
  const el = document.getElementById('tile-map');
  if (el) {
    const w = el.getBoundingClientRect().width;
    if (w > 0) return w / MAP_W;
  }
  return _getGameScale() * _zoom;
}

/** 화면(client) 좌표 → 스테이지 좌표 */
function _clientToStage(clientX, clientY) {
  // 기준은 타일 맵 — 맵을 움직이거나 확대하면 그만큼 같이 따라간다
  const ref = document.getElementById('tile-map') || document.getElementById('screen-game');
  if (!ref) return { x: clientX, y: clientY };
  const r = ref.getBoundingClientRect();
  const s = _mapScale();
  return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
}

// ── 맵 이동 · 확대 ──────────────────────────────────────────
// 맵이 화면보다 세로로 길어서 끌어서 봐야 한다 — 왼쪽 버튼 드래그(가운데 버튼도 된다).
// 휠은 확대/축소 — 잘 안 보이는 사람이 타일과 숫자를 키워 볼 수 있게 한다.
// 기본 배율은 '섬(돌벽까지)이 화면에 다 들어오는 크기'다 (mapFitZoom).
// 끝까지 줄이면 필드(섬) 둘레의 밤바다와 수평선 위 밤하늘까지 한눈에 보인다 (js/seasky.js).
const ZOOM_MIN  = 0.3;
const ZOOM_MAX  = 2.0;
const ZOOM_STEP = 1.1;

let _panX = 0, _panY = 0, _zoom = 1;
let _zoomInit = false;      // 처음 화면이 보일 때 한 번 기본 배율(섬 맞춤)로 맞춘다

function _panApply() {
  const el = document.getElementById('tile-map');
  // transform-origin이 0 0이라 translate는 확대 전 px 기준 — 계산이 단순해진다
  if (el) el.style.transform = `translate(${Math.round(_panX)}px, ${Math.round(_panY)}px) scale(${_zoom})`;
}

/**
 * 섬이 화면에 그려지는 범위 (타일 맵 좌표, 확대 전 px).
 * 바닥판이 원근으로 누워 있어 가까운 쪽(아래)이 더 넓고, 먼 쪽 돌벽은 위로 솟아 맵 위로 삐져나온다.
 * harbor면 앞쪽 바다로 뻗은 선착장 · 요트까지 넣는다 (towers3d.js T3D_HARBOR).
 */
const _islandBoxCache = {};
function _islandBox(harbor) {
  const key = harbor ? 'h' : 'i';
  if (_islandBoxCache[key]) return _islandBoxCache[key];
  const map = document.getElementById('tile-map');
  const cs = map ? getComputedStyle(map) : null;
  const a = (parseFloat(cs?.getPropertyValue('--field-tilt')) || 18) * Math.PI / 180;
  const d = parseFloat(cs?.getPropertyValue('--field-depth')) || 1100;
  const proj = v => { const s = d / (d - v * Math.sin(a)); return { y: v * Math.cos(a) * s, s }; };  // 맵 가운데 기준
  const UP = Math.cos(30 * Math.PI / 180);             // 3D 높이 1 → 화면 높이 (타워 카메라 고도 30°)
  const H = typeof T3D_HARBOR !== 'undefined' ? T3D_HARBOR : { wall: 26, wallTop: 116, sea: 16, reach: 150 };
  const far = proj(-(MAP_H / 2 + H.wall));
  const near = proj(MAP_H / 2 + H.wall + (harbor ? H.reach : 0));
  const halfW = (MAP_W / 2 + H.wall) * near.s;
  const box = {
    x0: MAP_W / 2 - halfW, x1: MAP_W / 2 + halfW,
    y0: MAP_H / 2 + far.y - H.wallTop * UP * far.s - 8,
    y1: MAP_H / 2 + near.y + (harbor ? H.sea + 24 : H.sea) * UP * near.s
  };
  if (map) _islandBoxCache[key] = box;
  return box;
}

/** 기본 배율 — 섬 전체(돌벽 · 앞쪽 부두까지)가 화면에 딱 들어오는 크기 */
function mapFitZoom() {
  const vp = document.getElementById('map-viewport');
  if (!vp || !(vp.offsetWidth > 0)) return 1;
  const b = _islandBox(false);
  const z = Math.min((vp.offsetWidth - 24) / (b.x1 - b.x0), (vp.offsetHeight - 16) / (b.y1 - b.y0));
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z.toFixed(4)));
}

function _panClamp() {
  const vp = document.getElementById('map-viewport');
  const vw = vp ? vp.offsetWidth  : MAP_W;   // 레이아웃 px (게임 화면 배율과 무관)
  const vh = vp ? vp.offsetHeight : MAP_H;
  // 끌 수 있는 범위는 맵 네모가 아니라 '섬 전체(돌벽 · 선착장 · 요트)'다 —
  // 크게 확대해도 끌어서 섬 끝 돌벽까지 다 볼 수 있다.
  // 기본 배율보다 더 줄이면 그만큼 여백이 생겨, 아래로 끌어 수평선 위 밤하늘을, 옆으로 끌어 바다를 본다.
  const b = _islandBox(true);
  const slack = Math.max(0, mapFitZoom() - _zoom);
  const clamp = (p, view, b0, b1, pad) => {
    const size = (b1 - b0) * _zoom;
    const c = (view - size) / 2 - b0 * _zoom;            // 섬을 가운데에 두는 이동량
    // 화면보다 크면 섬 끝이 화면 끝에 닿을 때까지, 작으면 섬이 화면 밖으로 나가지 않을 때까지 움직인다
    // (그래야 커서 자리를 붙잡고 확대하는 것이 기본 배율에서도 그대로 된다)
    const half = Math.abs(size - view) / 2 + pad;
    return Math.min(c + half, Math.max(c - half, p));
  };
  _panX = clamp(_panX, vw, b.x0, b.x1, slack * 250);   // 옆으로는 조금만 — 바다만 넓게 보이지 않게
  _panY = clamp(_panY, vh, b.y0, b.y1, slack * 700);
}

/**
 * 끝까지 줄였을 때의 구도 — 섬은 가로 가운데, 화면 아래쪽에 놓고 그 위로 수평선 · 밤하늘 · 달이 보인다.
 * 기본 배율에서 줄여 갈수록 이 구도로 차츰 옮겨 간다 (mapZoomAt).
 */
function _skyFramePan(z) {
  const vp = document.getElementById('map-viewport');
  const vw = vp ? vp.offsetWidth : MAP_W, vh = vp ? vp.offsetHeight : MAP_H;
  const b = _islandBox(true);
  return { x: vw / 2 - (b.x0 + b.x1) / 2 * z, y: vh * 0.95 - b.y1 * z };
}

/** 섬을 가운데로 — 매치 시작할 때. 처음 한 번은 기본 배율(섬 맞춤)로 맞추고, 그 뒤로는 배율을 건드리지 않는다 */
function mapCenterView() {
  const vp = document.getElementById('map-viewport');
  // 화면이 아직 숨겨져 있으면(크기 0) 계산하지 않는다 — 맵이 옆으로 밀린 채 시작한다.
  // 화면을 보인 뒤 다시 부른다 (game.js _doStartGame · _doSpectateGame)
  if (vp && !(vp.offsetWidth > 0)) return;
  if (!_zoomInit && vp) {
    _zoomInit = true;
    _zoom = mapFitZoom();               // (처음 한 번 — 아직 들고 있는 사거리 표시가 없어 다시 잴 것도 없다)
  }
  const b = _islandBox(false);
  _panX = (vp ? vp.offsetWidth  : MAP_W) / 2 - (b.x0 + b.x1) / 2 * _zoom;
  _panY = (vp ? vp.offsetHeight : MAP_H) / 2 - (b.y0 + b.y1) / 2 * _zoom;
  _panClamp();
  _panApply();
}

function mapPanBy(dx, dy) {
  _panX += dx;
  _panY += dy;
  _panClamp();
  _panApply();
}

/** 화면의 (cx, cy) 지점을 붙잡은 채 확대/축소 — 보던 자리가 그대로 커서 아래 남는다 */
function mapZoomAt(factor, cx, cy) {
  const vp = document.getElementById('map-viewport');
  if (!vp) return;
  const prev = _zoom;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(prev * factor).toFixed(4)));
  if (next === prev) return;

  const r = vp.getBoundingClientRect();
  const s = _getGameScale();
  const vx = (cx - r.left) / s, vy = (cy - r.top) / s;   // 뷰포트 안 레이아웃 px
  _panX = vx - (vx - _panX) * (next / prev);
  _panY = vy - (vy - _panY) * (next / prev);
  _zoom = next;
  // 기본 배율보다 줄일 때는 커서 자리 대신 '하늘이 보이는 구도'로 차츰 옮긴다 — 끝까지 줄이면 그 구도 그대로
  const fit = mapFitZoom();
  if (next < fit && next < prev) {
    const k = Math.min(1, (fit - next) / Math.max(1e-3, fit - ZOOM_MIN));
    const e = k * k * (3 - 2 * k);
    const f = _skyFramePan(next);
    _panX += (f.x - _panX) * e;
    _panY += (f.y - _panY) * e;
  }
  _panClamp();
  _panApply();
  // 들고 있는 사거리 표시도 같이 커진다 — 안 그러면 실제 사거리와 어긋난다
  _applyCastArcSize();
}

/** 기본 크기로 (섬이 다 보이는 크기) */
function mapZoomReset() { _zoom = mapFitZoom(); _zoomInit = true; mapCenterView(); _applyCastArcSize(); }

/** 맵을 끌고 난 직후의 click은 카드 놓기로 치지 않는다 */
let _panClickBlockUntil = 0;
function _panJustDragged() { return Date.now() < _panClickBlockUntil; }

/** 타일 한 칸 한 칸을 실제로 깐다 — 면과 테두리가 있는 칸 */
function buildTiles() {
  const grid = document.getElementById('tile-grid') || document.querySelector('.tile-grid');
  if (!grid || grid.dataset.built) return;
  grid.dataset.built = '1';

  const frag = document.createDocumentFragment();
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const t = document.createElement('div');
      // 강(가운데 두 열) · 내 진영 · 상대 진영
      const zone = (col === MAP_COLS / 2 - 1 || col === MAP_COLS / 2) ? 'tile-river'
                 : (col < MAP_COLS / 2 ? 'tile-mine' : 'tile-enemy');
      t.className = `tile ${zone}`;
      t.style.setProperty('--col', col);
      t.style.setProperty('--row', row);
      t.dataset.col = col;
      t.dataset.row = row;
      frag.appendChild(t);
    }
  }
  grid.appendChild(frag);
}

/**
 * 눕힌 바닥 위에 타워를 얹는다.
 * 바닥판(.ground)만 원근으로 눕기 때문에, 타일 (col,row)가 그려지는 자리는
 * 논리 좌표 (col*TILE, row*TILE)에서 조금 밀린다. 그 차이를 재서 타워를 같이 밀어 준다.
 * 안 그러면 타워가 자기 칸에서 몇 px 떠 보인다.
 *
 * 조준·사거리는 타워의 실제 화면 위치에서 다시 계산되므로(_towerCenterStage),
 * 이렇게 밀어도 보이는 것과 맞는 것이 어긋나지 않는다.
 */
function alignTowersToGround() {
  const map = document.getElementById('tile-map');
  if (!map) return;
  const m = map.getBoundingClientRect();
  const s = _mapScale();
  if (!(s > 0)) return;
  // 화면이 숨겨져 있으면 모든 크기가 0이다. 그때 재면 보정값이 '칸 좌표를 통째로 빼라'가 돼서
  // 타워(체력 숫자·피격 판정·연출 기준점)가 통째로 맵 원점으로 날아간다 — 관전 화면에서 실제로 격은 일
  if (!(m.width > 0) || !(m.height > 0)) return;

  document.querySelectorAll('.tower').forEach(el => {
    const col = Number(el.style.getPropertyValue('--col'));
    const row = Number(el.style.getPropertyValue('--row'));
    const tile = document.querySelector(`#tile-grid .tile[data-col="${col}"][data-row="${row}"]`);
    if (!tile) return;
    const t = tile.getBoundingClientRect();
    if (!(t.width > 0)) return;
    // 타일이 실제로 그려진 한가운데 (맵 좌표)
    const cx = (t.left + t.width  / 2 - m.left) / s;
    const cy = (t.top  + t.height / 2 - m.top)  / s;
    el.style.setProperty('--tilt-dx', (cx - (col * TILE + TILE / 2)).toFixed(1) + 'px');
    el.style.setProperty('--tilt-dy', (cy - (row * TILE + TILE / 2)).toFixed(1) + 'px');
  });
}

function initMapPan() {
  const vp = document.getElementById('map-viewport');
  if (!vp || vp.dataset.panReady) return;
  vp.dataset.panReady = '1';
  buildTiles();
  alignTowersToGround();
  // 타일이 다 생긴 뒤에 — 건물 자리를 타일 좌표에서 계산한다
  if (typeof towers3dInit === 'function') towers3dInit();

  // 이만큼 움직여야 '맵 끌기'로 본다 — 그 아래는 그냥 클릭이라 카드 놓기가 그대로 산다
  const DRAG_SLOP = 6;
  let btn = -1, moved = false, startX = 0, startY = 0, lastX = 0, lastY = 0;

  // 왼쪽 버튼 드래그 = 맵 이동. 가운데 버튼도 그대로 쓸 수 있다.
  vp.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return;
    // 투척 카드를 들고 있으면 왼쪽 버튼은 '차징'이다 — 맵 끌기는 비켜 준다
    // (그때도 가운데 버튼으로는 그대로 끌 수 있다)
    btn = e.button;
    moved = false;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    if (btn === 1) {
      // 가운데 버튼은 다른 쓰임이 없으니 바로 이동 시작
      e.preventDefault();
      moved = true;
      vp.classList.add('panning');
      try { vp.setPointerCapture(e.pointerId); } catch (_) {}
    }
    // 왼쪽 버튼은 여기서 아무것도 막지 않는다 — 카드 놓기 클릭이 살아 있어야 한다
  });

  vp.addEventListener('pointermove', e => {
    if (btn < 0) return;
    if (!moved) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_SLOP) return;
      moved = true;
      vp.classList.add('panning');
      try { vp.setPointerCapture(e.pointerId); } catch (_) {}
    }
    const s = _getGameScale();
    mapPanBy((e.clientX - lastX) / s, (e.clientY - lastY) / s);
    lastX = e.clientX; lastY = e.clientY;
  });

  const stop = e => {
    if (btn < 0) return;
    const wasMoved = moved, wasLeft = btn === 0;
    btn = -1; moved = false;
    vp.classList.remove('panning');
    try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
    // 끌고 나서 손을 뗀 것이면 이어지는 click은 카드 놓기로 치지 않는다
    if (wasMoved && wasLeft) _panClickBlockUntil = Date.now() + 250;
  };
  vp.addEventListener('pointerup', stop);
  vp.addEventListener('pointercancel', stop);
  // 가운데 버튼 기본 동작(자동 스크롤) 차단
  vp.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });

  // 휠 = 맵 확대/축소 (커서 자리 기준).
  // Ctrl+휠은 게임 화면 전체 배율이라 game.js에 넘긴다.
  vp.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    mapZoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX, e.clientY);
  }, { passive: false });

  // 키보드로도 — 휠을 쓰기 어려운 경우. +/- 는 확대·축소, 0은 기본 크기
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;          // Ctrl +/- 는 화면 전체 배율
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (!vp.offsetParent) return;                            // 게임 화면이 아닐 때는 무시
    const r  = vp.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if      (e.key === '+' || e.key === '=') { e.preventDefault(); mapZoomAt(ZOOM_STEP,     cx, cy); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); mapZoomAt(1 / ZOOM_STEP, cx, cy); }
    else if (e.key === '0')                  { e.preventDefault(); mapZoomReset(); }
  });

  window.addEventListener('resize', () => {
    _panClamp(); _panApply(); alignTowersToGround();
    if (typeof towers3dLayout === 'function') towers3dLayout();
  });
  mapCenterView();
  alignTowersToGround();
}

document.addEventListener('DOMContentLoaded', initMapPan);
if (document.readyState !== 'loading') initMapPan();

function _fxLayer() {
  return document.getElementById('fx-layer') || document.body;
}

// ── 타워 파괴 & 킹 연쇄 폭발 ────────────────────────────────
// 타워가 무너지면 필드에서 기울며 땅속으로 주저앉는다 (towers3d.js towers3dFall 'collapse').
// 킹 타워가 무너지면 게임 종료 — 사각별 빛 폭발과 함께 킹이 먼저 무너지고,
// 그 뒤 같은 진영의 남은 타워가 차례로 빛 폭발 속에 사라진다 ('light').
const _kingFallen = { my: false, enemy: false };
let _kingFallAt = 0;
const KING_COLLAPSE     = { delay: 380, dur: 2000 };   // 빛 폭발이 정점을 지나면 밑동부터 울리며 2초 동안 무너진다
const KING_FALL_CHAIN   = [{ pos: 'left', delay: 2500 }, { pos: 'right', delay: 2850 }];
const KING_FALL_FX_MS   = 3900;   // 킹 붕괴 + 남은 타워의 빛 폭발까지 — game.js가 종료 연출을 이만큼 늦춘다
window.KING_FALL_FX_MS  = KING_FALL_FX_MS;

/** 킹 붕괴 연출이 끝나려면 얼마나 남았나 (game.js — 결과 화면을 그만큼 늦춘다) */
function boardKingFallLeft() {
  return _kingFallAt ? Math.max(0, _kingFallAt + KING_FALL_FX_MS - performance.now()) : 0;
}

/**
 * @param {'collapse'|'light'|null} mode 3D 연출 (null = 연출 없이 파괴 상태만)
 * @returns {boolean} 3D 연출을 시작했으면 true
 */
function _explodeTower(towerEl, mode, opts) {
  towerEl.classList.add('destroyed', 'tower-explode');
  towerEl.classList.remove('pending-revival');
  setTimeout(() => towerEl.classList.remove('tower-explode'), 700);
  return !!mode && typeof towers3dFall === 'function' && towers3dFall(towerEl, mode, opts);
}

/** 사각별 빛 폭발 — 긴 빛줄기 넷(십자) + 짧은 빛줄기 넷(대각) + 흰 핵 + 퍼지는 고리 + 반짝이 */
function _spawnStarBurst(owner, pos, towerEl, big) {
  let pt = typeof towers3dTowerPoint === 'function' ? towers3dTowerPoint(owner, pos, big ? 1.05 : 0.55) : null;
  if (!pt) {
    const r = towerEl.getBoundingClientRect();
    pt = _clientToStage(r.left + r.width / 2, r.top + r.height / 2);
  }
  const el = document.createElement('div');
  el.className = 'fx-star-burst' + (big ? ' big' : '');
  el.style.left = pt.x + 'px';
  el.style.top  = pt.y + 'px';
  let sparks = '';
  const n = big ? 14 : 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2) * 0.2;
    const d = (big ? 170 : 105) * (0.7 + (i % 3) * 0.2);
    sparks += `<i class="fsb-spark" style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;animation-delay:${(i % 3) * 30}ms"></i>`;
  }
  el.innerHTML = '<i class="fsb-glow"></i><i class="fsb-ring"></i><i class="fsb-star"></i><i class="fsb-star fsb-star2"></i><i class="fsb-core"></i>' + sparks;
  _fxLayer().appendChild(el);
  setTimeout(() => el.remove(), big ? 1600 : 1200);
}

function _triggerKingFall(owner, kingEl, animate = true) {
  if (_kingFallen[owner]) return;
  _kingFallen[owner] = true;
  // 경기가 끝났다 — 리퍼의 낫질·걷기처럼 계속 도는 것들을 먼저 멈춘다 (연출이 끊기지 않게)
  if (typeof unitsHalt === 'function') unitsHalt();

  if (!animate) {
    // 들어와 보니 이미 끝난 판 — 연출 없이 남은 타워도 무너진 것으로
    ['left', 'right'].forEach(pos => {
      const el = document.getElementById(_towerId(owner, pos));
      if (el && !el.classList.contains('destroyed')) _explodeTower(el, null);
    });
    return;
  }
  _kingFallAt = performance.now();

  _spawnStarBurst(owner, 'king', kingEl, true);
  const map = document.querySelector('.game-map');
  if (map) {
    map.classList.remove('field-shake');
    void map.offsetWidth;               // 애니메이션 재시작
    map.classList.add('field-shake');
    setTimeout(() => map.classList.remove('field-shake'), 700);
  }

  KING_FALL_CHAIN.forEach(({ pos, delay }) => {
    setTimeout(() => {
      const el = document.getElementById(_towerId(owner, pos));
      if (!el || el.classList.contains('destroyed')) return;
      // 하얗게 달아오르다 가장 밝은 순간에 빛 폭발 — 3D가 없으면 바로 터진다
      const lit = _explodeTower(el, 'light');
      const burstAt = lit ? (typeof T3D_LIGHT_BURST_MS === 'number' ? T3D_LIGHT_BURST_MS : 330) : 0;
      setTimeout(() => _spawnStarBurst(owner, pos, el, false), burstAt);
    }, delay);
  });
}

// ── 피격 애니메이션 & 플로팅 숫자 ──────────────────────────

/**
 * 떠오르는 숫자끼리 겹치지 않게 자리를 고른다 (#fx-layer 좌표).
 * 여러 연출이 한꺼번에 때리면 (파도 틱 + 침수 + 리퍼 낫 …) 같은 자리에 숫자가 포개져 읽히지 않는다 —
 * 지금 떠 있는 숫자들의 현재 높이(떠오른 만큼)를 셈해서, 비어 있는 가장 가까운 자리에 놓는다.
 * @returns {{x:number, y:number}}
 */
const _fxNums = [];
function fxNumberSpot(x, y, w = 96, h = 50) {
  const now = performance.now();
  for (let i = _fxNums.length - 1; i >= 0; i--) if (now - _fxNums[i].at > 1400) _fxNums.splice(i, 1);
  // float-up 키프레임과 같은 높이 — 0.42초에 36px, 끝(1.4초)에 96px
  const rise = age => age < 420 ? 36 * age / 420 : 36 + 60 * Math.min(1, (age - 420) / 980);
  const busy = (cx, cy) => _fxNums.some(n => {
    const ny = n.y - rise(now - n.at);
    return Math.abs(n.x - cx) < (w + n.w) / 2 && Math.abs(ny - cy) < (h + n.h) / 2;
  });
  const cands = [[0, 0], [-w, 0], [w, 0], [0, -h], [-w, -h], [w, -h], [-w / 2, h * 0.6], [w / 2, h * 0.6],
                 [0, -2 * h], [-w, -2 * h], [w, -2 * h], [-2 * w, 0], [2 * w, 0]];
  // 맵 밖(잘려 보이는 자리)은 고르지 않는다
  const L = document.getElementById('fx-layer');
  const LW = L?.offsetWidth || Infinity, LH = L?.offsetHeight || Infinity;
  const inside = (cx, cy) => cx - w / 2 >= 0 && cx + w / 2 <= LW && cy >= 0 && cy + h <= LH;
  let pick = cands.find(([dx, dy]) => inside(x + dx, y + dy) && !busy(x + dx, y + dy))
          || cands.find(([dx, dy]) => inside(x + dx, y + dy))
          || [0, 0];
  const spot = { x: x + pick[0], y: y + pick[1] };
  _fxNums.push({ ...spot, w, h, at: now });
  return spot;
}

/**
 * @param {string} type 'damage' | 'dot' | 'heal' | 'immune' | 'thaw' | 'crit'(= 크리티컬 피해 — instantHits)
 * @param {boolean} crit 기본 피해보다 크게 들어갔다 — 글자만 황금색 (테두리는 그대로 검정)
 */
function showTowerHit(owner, pos, amount, type = 'damage', crit = false) {
  if (type === 'crit') { type = 'damage'; crit = true; }
  const towerEl = document.getElementById(_towerId(owner, pos));
  if (!towerEl) return;
  // 타워를 무너뜨린 마지막 일격은 파괴 상태가 먼저 도착해도 숫자를 보여준다 (흔들림만 생략)
  const destroyed = towerEl.classList.contains('destroyed');

  if (type !== 'immune' && type !== 'thaw' && !destroyed) {
    towerEl.classList.add('tower-hit');
    setTimeout(() => towerEl.classList.remove('tower-hit'), 350);
  }

  const rect = towerEl.getBoundingClientRect();
  const num  = document.createElement('div');
  // 내가 넣는 피해(= 상대 타워가 맞는 것)는 흰색, 내 타워가 맞는 피해는 기존 빨간색
  // 관전자는 어느 편도 아니다 — 양쪽 피해를 같은 색(빨강)으로 보여야 헷갈리지 않는다
  const spectating = typeof _isSpectator !== 'undefined' && _isSpectator;
  const dealt = !spectating && owner === 'enemy' && (type === 'damage' || type === 'dot');
  num.className = `floating-number ${type}${dealt ? ' dealt' : ''}${crit ? ' crit' : ''}`;
  if (type === 'immune') {
    num.textContent = '면역';
  } else if (type === 'thaw') {
    num.textContent = '해빙';   // 폭염이 언 타워를 녹였다 — 피해 없이 얼음만 녹는다
  } else if (type === 'heal') {
    num.textContent = `+${amount}`;
  } else {
    num.textContent = `-${amount}`;
  }
  // 타워 머리 위 가운데부터 — 이미 떠 있는 숫자(다른 연출의 피해 포함)와 겹치면 옆·위 빈자리로 (스테이지 좌표)
  // 체력 글씨 바로 위에서 시작한다 — 체력 숫자를 덮지 않게 (3D 타워면 체력 글씨가 건물 머리 위로 옮겨져 있다)
  const hpEl = towerEl.querySelector('.tower-hp');
  const hr = hpEl && hpEl.getBoundingClientRect();
  const anchor = hr && hr.width ? _clientToStage(hr.left + hr.width / 2, hr.top) : _clientToStage(rect.left + rect.width / 2, rect.top);
  const pt = fxNumberSpot(anchor.x, anchor.y - 60, Math.max(70, num.textContent.length * 30), 54);
  num.style.left = pt.x + 'px';
  num.style.top  = pt.y + 'px';
  _fxLayer().appendChild(num);
  setTimeout(() => num.remove(), 1500);
}

// ── DOT 인디케이터 ───────────────────────────────────────────

function updateDotIndicator(owner, pos, dotEntries) {
  const el = document.getElementById(`dot-${owner}-${pos}`);
  if (!el) return;
  el.innerHTML = '';
  const towerEl = document.getElementById(_towerId(owner, pos));
  if (towerEl?.classList.contains('destroyed')) return;
  dotEntries.forEach(entry => {
    if (entry.type === 'shieldDrain') return; // 보호막 감소는 HP바로 표시됨
    // 연출이 있는 카드(지진·바위 지옥·듀얼 검·토템·벚꽃…)는 연출로 보이므로 아이콘을 달지 않는다
    if (entry.cardId && typeof CARD_DEFINITIONS !== 'undefined' && CARD_DEFINITIONS[entry.cardId]?.cast) return;
    const badge = document.createElement('span');
    badge.className = `dot-badge ${entry.type === 'damage' ? 'damage-badge' : 'heal-badge'}`;
    if (entry.type === 'damage') {
      badge.innerHTML = '<span class="material-symbols-outlined">explosion</span>';
    } else {
      badge.textContent = '💚';
    }
    badge.title = `${entry.type === 'damage' ? '피해' : '치유'} ${entry.dmgPerTick}/s × ${entry.remainingTicks}`;
    el.appendChild(badge);
  });
}

// ── 카드 시전 연출 (cards.js의 cast 값) ─────────────────────
// arcDeg: 부채꼴 각도(120° = 원의 1/3) · radius: 사거리(스테이지 px).
// 타워 세로 간격이 300px이라 사거리 260px이면 한 번에 한 타워만 들어온다.
// hitMs: 피해가 들어가는 시점 (휘두르기가 마무리되는 순간) · endMs: 연출 제거
// shape: 'fan' = 부채꼴 · 'lunge' = 일자 돌진 사거리(끝에 X자 범위)
// fx: 연출 그림 파일 — fx/ 폴더의 SVG 한 장이 연출 하나를 통째로 담는다.
//     w·h = 놓을 크기(스테이지 px) · hx·hy = 그 그림 안에서 타워 중심이 되는 점
// shape: 'fan' 부채꼴 · 'lunge' 일자 돌진 · 'circle' 원형 범위
//        'none'이면 사거리 표시 없이 평소처럼 카드가 커서를 따라다닌다 (단일 회복 등)
const CAST_STYLES = {
  // 목검 — 타일 한 칸 크기의 부채꼴(반지름 100). 단일 대상이다.
  // 예전 반지름 160은 '타워 발밑에 닿으면 맞는다'로 바뀐 뒤 두 타워 사이를 겨누면 둘 다 닿았다.
  // single: 닿은 타워가 둘이어도 가장 가까운 하나만 맞는다 (크기를 줄인 것에 더한 보증)
  // fx.scale: 베기 그림(초승달 반지름 150)을 범위 크기에 맞춰 줄인다 — 허공에 베면 범위 안에서 벤다
  sword: {
    shape: 'fan',   arcDeg: 120, radius: 100, hitMs: 300, endMs: 700, single: true,
    fx: { file: 'fx/sword.svg',     w: 600,  h: 400, hx: 300, hy: 200, scale: 0.62 }
  },
  // xMark — 직선 끝의 X자 범위. X자로 베는 카드는 듀얼 검뿐이라 여기만 켜 둔다
  // 폭 100 — 위아래 타워 발밑 사이 간격(128)보다 좁아서 두 타워에 동시에 닿지 않는다 (예전 160은 닿았다)
  // totemHit (2026-10-03 상성): 범위에 닿은 상대 토템도 대상 — 단일이라 토템과 타워 중 가까운 하나만.
  //   'slash' 토템을 베어 없앤다 · 'cut' 토템의 남은 시간을 TOTEM_CUT_MS 줄인다 (그만큼도 안 남았으면 무너진다)
  dualsword: {
    shape: 'lunge', band: 100,    radius: 330, hitMs: 500, endMs: 1400, xMark: true, single: true, totemHit: 'slash',
    fx: { file: 'fx/dualsword.svg', w: 1000, h: 420, hx: 700, hy: 210 }
  },
  // 회복은 '맞는 순간'이 없다 — 바로 들어가고(hitMs 0) 꽃잎만 피어난다
  blossom: {
    shape: 'towertile',                        hitMs: 0,   endMs: 1800,
    fx: { file: 'fx/blossom.svg',   w: 400,  h: 400, hx: 200, hy: 200 }
  },
  // 타일 맵 기준 타워 간격은 이웃까지 224, 반대쪽 끝까지 400.
  // 반지름 300이면 '가운데에 맞추면 3개, 위/아래에 맞추면 2개'가 된다 — 가운데에 놓도록 유도
  forest: {
    shape: 'circle',              radius: 300, hitMs: 0,   endMs: 5400, lifeMs: 5000,   // lifeMs = 회복이 도는 시간 (5회 × 1초)
    fx: { file: 'fx/forest.svg',    w: 800,  h: 800, hx: 400, hy: 400 }
  },
  // 흰꽃 — 숲의정령과 같은 토템 형태, 흰 꽃잎이 원을 따라 흩날린다
  whiteblossom: {
    shape: 'circle',              radius: 300, hitMs: 0,   endMs: 5400, lifeMs: 5000,
    fx: { file: 'fx/whiteblossom.svg', w: 800, h: 800, hx: 400, hy: 400 }
  },
  // 돌 — 투척. 다른 연출과 달리 SVG 두 장이다:
  //   fx     = 날아가는 돌 (회전은 무한 반복이라 어떤 비행 시간에도 맞는다)
  //   impact = 착지해서 깨지는 순간
  // 궤적은 board.js가 포물선으로 그린다 — 비행 시간이 차징에 따라 달라지기 때문이다.
  stone: {
    shape: 'throw',
    // 착지 = 커서가 가리키는 타일 한 칸 (2026-09-29: 원형 2×2칸 → 타일 한 칸).
    // 그 칸에 선 타워만 맞는다. 조준 표시도 칸에 딱 맞는 네모다 (_stoneTile).
    // radius는 깨지는 그림의 크기 기준으로만 쓴다 (_stoneImpact) — 타일 반 폭
    radius: 50,
    reach:  1400,    // 던질 수 있는 최대 거리 (맞는 쪽 킹 타워 기준으로 재지 않고 던지는 쪽에서 잰다)
    // 꾹 누른 시간 → 20%마다 한 단계. 세게 던질수록 아프고 빠르다 (2026-10-03: 예전엔 셀수록 느렸다).
    // 차징 없이 툭 던지면 천천히 날아가 덜 아프다
    charge: {
      fullMs: 2000,                              // 가득 차기까지
      steps:  5,                                 // 0 / 20 / 40 / 60 / 80 / 100 %
      damage: [20, 24,   27,   31,   35,   40],
      flyMs:  [2500, 2200, 2000, 1700, 1400, 1000]
    },
    hitMs: 2500,     // 0단계 기준 — 실제로는 단계별 flyMs를 쓴다
    endMs: 3350,     // 0단계 기준 — 비행 2.5초 + 깨짐 0.85초
    fx:     { file: 'fx/stone.svg',        w: 220, h: 220, hx: 110, hy: 110 },
    // 깨짐은 두 장 — 바닥에 눕는 부분(먼지·균열·충격 고리)과 서 있는 부분(섬광·파편)
    impact: { file: 'fx/stone-impact.svg', w: 440, h: 440, hx: 220, hy: 220 },
    impactGround: { file: 'fx/stone-impact-ground.svg', w: 440, h: 440, hx: 220, hy: 220, reach: 180 }
  },
  // 바람 스매시 — 앞으로 두 타일(200px) 길이의 일자. 타워 하나만 친다
  windsmash: {
    shape: 'lunge', band: 100, radius: 200, hitMs: 200, endMs: 400, single: true, totemHit: 'cut',
    fx: { file: 'fx/windsmash.svg', w: 560, h: 400, hx: 420, hy: 200 }
  },
  // 토네이도 — 바람의 진화. 내 진영 타일에 설치하면 일자로 전진해 타워를 친다.
  // 멀리서 올수록 크고(타워 둘까지 닿고) 빠르고 아프다. 값은 아래 tornado* 함수가 계산한다.
  tornado: {
    shape: 'tile',
    travelMs: 2800,                    // 어디서 놓든 도착까지 걸리는 시간 — 멀리서 오면 그만큼 빠르다
    hitMs: 2800, endMs: 3400,
    fx: { file: 'fx/tornado.svg', w: 400, h: 340, hx: 200, hy: 300 }
  },
  // 바위 지옥 — 돌의 진화. 차징 없이 세 덩이가 한 번에 날아가 타워 셋에 각각 떨어진다.
  // 멀리(오래) 날아가는 것일수록 아프고, 착지 뒤 튀는 돌가루도 더 아프고 더 빠르게 들어간다.
  // 타워 줄은 위에서부터 left(2행) · king(4행) · right(6행)이다.
  stonehell: {
    shape: 'throw3',
    radius: 50,      // 착지 원 — 돌과 같은 타워 한 칸 크기
    reach:  1400,
    shots: [
      { pos: 'left',  flyMs: 2000, damage: 14, dot: { dmgPerTick: 2, ticks: 3, tickInterval: 600 } },
      { pos: 'king',  flyMs: 2500, damage: 18, dot: { dmgPerTick: 3, ticks: 3, tickInterval: 500 } },
      { pos: 'right', flyMs: 3000, damage: 22, dot: { dmgPerTick: 3, ticks: 3, tickInterval: 400 } }
    ],
    hitMs: 2000,     // 첫 덩이가 닿는 시각
    endMs: 3850,     // 마지막 덩이 3.0초 + 깨짐 0.85초
    fx:     { file: 'fx/stone.svg',        w: 220, h: 220, hx: 110, hy: 110 },
    impact: { file: 'fx/stone-impact.svg', w: 440, h: 440, hx: 220, hy: 220 },
    impactGround: { file: 'fx/stone-impact-ground.svg', w: 440, h: 440, hx: 220, hy: 220, reach: 180 }
  },
  // 지진 — 커서가 가리키는 칸을 가운데로 3×3칸. 범위에 든 타워는 전부 맞는다.
  // 0.7초 땅울림(hitMs) → 3초 동안 칸이 무너진다. 피해는 무너지는 동안 1초마다 (cards.js의 dot).
  // drops: 무너진 뒤 몇 ms에 한 단계씩 더 꺼지는가 — 지속 피해가 들어가는 순간에 맞췄다.
  // totemCut (2026-10-03 상성): 땅이 울리는 순간 범위 안 상대 토템의 남은 시간 -2초 (그만큼도 안 남았으면 무너진다)
  quake: {
    shape: 'area', cols: 3, rows: 3, totemCut: true,
    hitMs: 700, collapseMs: 3000, restoreMs: 360, endMs: 4060,
    drops: [{ at: 0, depth: 1 }, { at: 1000, depth: 2 }, { at: 2000, depth: 3 }]
  },
  // 붕괴 — 지진의 진화. 3칸 폭 × 10칸 높이인데 맵이 9칸이라 세로는 맵 전체다 → 타워 셋에 다 닿는다.
  // 0.5초 땅울림 → 한 번에 크게 꺼지며 즉시 피해.
  // totemBreak: 범위 안의 토템을 무너뜨린다. lockMs: 무너진 뒤에도 이만큼은 새로 세운 토템이 곧바로 무너진다.
  collapse: {
    shape: 'area', cols: 3, rows: 10,
    hitMs: 500, collapseMs: 1500, restoreMs: 420, endMs: 2420,
    drops: [{ at: 0, depth: 3.4 }],
    totemBreak: true, lockMs: 2000
  },
  // 화살 — 커서(활 자리)에서 앞으로 radius(3칸) 길이, band(1칸) 폭의 일자 사거리.
  // 날아가다 처음 닿는 타워 하나에 꽂힌다. 사거리 끝까지 늘 flyMs(1.2초)라, 가까운 타워일수록 빨리 맞는다.
  // Space 차징 — 2초에 6단계, 피해만 오르고 속도는 같다.
  arrow: {
    shape: 'shot', band: 100, radius: 300, flyMs: 1200, single: true,
    charge: { fullMs: 2000, steps: 6, damage: [21, 24, 27, 30, 33, 36, 39] },
    hitMs: 1200, endMs: 1600
  },
  // 사랑의 화살 — 화살의 진화. 차징 없이 1초에 3칸. 내 진영에서 쏘면 왼쪽(내 타워 쪽)으로 날아간다.
  // 연출 id에 '@1'이 붙으면 회복(내 타워), 없으면 공격 — 상대·관전 화면은 누구 타워인지로는 알 수 없다
  // healBurstMs: 회복은 꽂힌 뒤 타워 위 하트가 부풀어 올라 터지는 순간 들어간다 (towers3dLoveHeal이 이만큼 뒤에 터진다)
  lovearrow: {
    shape: 'shot', band: 100, radius: 300, flyMs: 1000, single: true, love: true, healBurstMs: 1100,
    hitMs: 1000, endMs: 2000
  },
  // 그림리퍼 — 칸 하나에 소환한다 (js/units.js). 연출은 두 화면 공통 컷씬 + 필드의 유닛이라 여기엔 그림이 없다
  reaper: {
    shape: 'summon', hitMs: 0, endMs: 0
  },
  // 침수 — 물방울 리워크 (2026-10-01). 4칸 폭 × 10칸 높이(맵이 9칸이라 세로 전체).
  // 맨 위 줄에서 맨 아래 줄까지 물이 1초 만에 쏟아져 흐른다 — 물살이 그 줄에 닿는 순간 30 (즉시).
  // 다 흐르면 범위가 잠기고 그 안의 타워는 반쯤 가라앉는다 — 3초 동안 0.5초마다 5.
  flood: {
    shape: 'area', cols: 4, rows: 10,
    flowMs: 1000, sinkMs: 3000, drainMs: 700,
    hitMs: 1000, endMs: 4700,
    flood: { impact: 30, dot: { dmgPerTick: 5, ticks: 6, tickInterval: 500 } },
    // 침수에 든 유닛(그림리퍼·유령)은 물이 빠질 때까지 기절 — 걷던 중이면 멈추고, 휘두르던 중이면 낫이 멈춘다
    unitStun: true,
  },
  // 파도 — 침수의 진화. 3칸 폭 × 10칸 높이(세로 전체). 2026-10-02부터 아무 열에나 놓는다 (늘 상대 진영 끝으로 밀려간다).
  // 물의 회복 버프는 상대의 회복에만 걸리므로 내 진영에서 출발해도 남용할 수 없다
  // 솟구친 뒤(riseMs) 맵 끝까지 밀려가며, 그 안에 든 대상은 0.5초마다 22. 끝에 닿으면 잦아들고 말라 사라진다.
  wave: {
    shape: 'wave', cols: 3,
    riseMs: 700, speed: 2, tickMs: 500, damage: 22, calmMs: 2600,
    hitMs: 700, endMs: 9000,     // 실제 길이는 놓은 열에 따라 — castWavePlan().endMs
    // 파도에 닿은 유닛은 둔화 — 마지막으로 닿은 뒤 slowMs 동안 걸음·낫이 slowK 배 빠르기
    slowMs: 2000, slowK: 0.5,
  },
  // 가시 (2026-10-01) — 2×2칸. 그 칸들의 땅에서 가시가 튀어나와 타워를 꿰뚫는다.
  // 튀어나오는 순간(hitMs) 45, 이어서 0.5초마다 7 × 4 (박힌 채로). 범위 안 소환 유닛도 같은 시각 같은 피해
  thorn: {
    shape: 'area', cols: 2, rows: 2,
    hitMs: 420, endMs: 2700,
    thorn: { impact: 45, dot: { dmgPerTick: 7, ticks: 4, tickInterval: 500 } },
  },
  // 톱 (가시의 진화, 2026-10-01 · 2026-10-03 리워크) — 커서에서 reach 안의 가장 가까운 대상(상대 타워 · 상대 토템) 하나.
  // 그 대상이 강조되고, 클릭하면 바로 그 대상에게 커서 쪽에서 날아들어 썰기 시작한다 (차징 · 게이지 없음).
  // 대상이 커서보다 조금 위나 아래에 있어도 커서에서 본 방향 그대로 다가가 썬다.
  // 타워: 끝까지(6초) 저절로 썬다 — 0.5초마다 7 (12번 = 84). 토템: totemCutMs 만에 잘려 넘어간다 (톱은 거기서 끝)
  saw: {
    shape: 'nearest', reach: 220, single: true,
    hitMs: 260, endMs: 6600, totemCutMs: 1100,
    saw: { holdMs: 6000, tickMs: 500, damage: 7 },
  },
  // 불덩이 (2026-10-02) — 돌처럼 던진다(사거리 reach). 떨어지는 자리는 가시처럼 2×2칸 —
  // 커서에 가장 가까운 '칸 네 개가 만나는 점'이 한가운데다. 포물선도 그 점에서 끝난다.
  // 떨어지는 순간(flyMs) 28, 그 칸들이 불타는 동안 0.5초마다 6 × 5.
  fireball: {
    shape: 'throw', area: true, cols: 2, rows: 2,
    reach: 1400, flyMs: 1100,
    hitMs: 1100, burnMs: 2700, endMs: 4100,
    burn: { impact: 28, dot: { dmgPerTick: 6, ticks: 5, tickInterval: 500 } },
  },
  // 폭염 (불덩이의 진화, 2026-10-02) — 3×7칸. 열기가 모여(hitMs) 범위 전체가 한 번 폭발 49 →
  // 그 안의 대상이 불타며(burnMs) 0.5초마다 9 × 5 → 이어서 열기(heatMs)가 올라오는 동안
  // 그 칸의 모든 대상(타워·소환 유닛)이 더위 — 모든 카드 피해 +heatPercent% (sync.js heatZones)
  heatwave: {
    shape: 'area', cols: 3, rows: 7,
    hitMs: 700, burnMs: 2600, heatMs: 6000, heatPercent: 15,
    endMs: 9800,
    blast: { impact: 49, dot: { dmgPerTick: 9, ticks: 5, tickInterval: 500 } },
  },
  // 벽돌 · 철벽 (2026-10-02) — 벚꽃처럼 내 타워 칸 하나에 놓는다. 타워를 얇은 벽이 둘러싼다 (towers3dWallShield).
  // 막는 값은 카드의 damageReduction — 벽은 그 시간(endMs) 동안 서 있다
  brickwall: { shape: 'towertile', hitMs: 0, endMs: 6000, wall: 'brick' },
  ironwall:  { shape: 'towertile', hitMs: 0, endMs: 8000, wall: 'iron' },
  // 얼음전개 (2026-10-02 리워크) — 4×4칸. 바닥에 서리가 번지고(hitMs) 그 안의 대상이 모두 얼어붙는다.
  // 타워는 아래서부터 위까지 얼음이 차오르고, 얼어 있는 동안(freezeMs) 1초마다 12. 언 타워가 있으면 상대 덱도 10초 동결.
  // 유닛은 그동안 기절하고 같은 피해. 바닥의 얼음 결정은 타워가 다 얼어붙으면(climbMs) 꺼져 사라진다
  icefield: {
    shape: 'area', cols: 4, rows: 4,
    hitMs: 900, climbMs: 900, freezeMs: 10000, endMs: 11200,
    ice: { dps: 12, ticks: 10, tickInterval: 1000, deckFreezeMs: 10000 },
  },
};

/**
 * 얼음전개 계획 — 범위 안 타워마다 얼어붙는 순간(hitMs) '동결 + 1초마다 피해 + 덱 동결'.
 * 범위 안 소환 유닛은 같은 순간부터 얼어(기절) 1초마다 같은 피해.
 */
function castIcePlan(st, R, targets) {
  const f = st.ice;
  const shots = targets.map(({ pos }) => ({ pos, flyMs: st.hitMs, effect: {
    freeze: { duration: st.freezeMs },
    dot: { dmgPerTick: f.dps, ticks: f.ticks, tickInterval: f.tickInterval },
    deckFreeze: { duration: f.deckFreezeMs },
  } }));
  const tiles = [];
  for (let c = R.c0; c <= R.c1; c++) for (let r = R.r0; r <= R.r1; r++) tiles.push([c, r, f.dps]);
  const end = st.hitMs + st.freezeMs;
  const unitStrikes = [];
  for (let k = 0; k <= f.ticks; k++) {
    const d = st.hitMs + k * f.tickInterval;
    unitStrikes.push({ tiles, delayMs: d, status: { stun: Math.max(600, end - d) } });
  }
  return { shots, unitStrikes };
}

// ── 침수 · 파도의 피해 계획 (순수 계산 — 사람·AI·시뮬레이터가 같이 쓴다) ─────────
// 칸은 모두 '쓰는 사람 시점'(내 진영 왼쪽)이다. 상대 타워는 옆 11열 · 킹 12열 (옆 타워가 킹보다 앞).

/** 침수의 물살이 그 줄에 닿는 시각 (맨 위 줄 → 맨 아래 줄을 flowMs 동안) */
function floodRowMs(st, R, row) {
  const rows = R.r1 - R.r0 + 1;
  return Math.round(st.flowMs * (row - R.r0 + 0.5) / rows);
}

/**
 * 침수 — 타워마다 '물살 30(그 줄에 닿을 때)' + '가라앉는 동안 5 × 6(다 흐른 뒤부터 0.5초마다)'.
 * 범위 안의 소환 유닛도 같은 시각에 같은 피해 (줄마다 물살 · 틱마다 범위 전체).
 * @param {Array<{pos:string,row:number}>} targets 범위 안의 상대 타워
 */
function castFloodPlan(st, R, targets) {
  const f = st.flood;
  const shots = [];
  targets.forEach(({ pos, row }) => {
    shots.push({ pos, flyMs: floodRowMs(st, R, row), damage: f.impact });
    shots.push({ pos, flyMs: st.flowMs, effect: { dot: f.dot } });
  });
  const unitStrikes = [];
  const all = [];
  // 기절은 물이 빠지기 시작할 때(flowMs + sinkMs)까지 — 어느 순간 젖었든 끝나는 시각은 같다
  const stunTo = st.flowMs + st.sinkMs;
  const stun = delayMs => st.unitStun ? { status: { stun: Math.max(600, stunTo - delayMs) } } : {};
  for (let r = R.r0; r <= R.r1; r++) {
    const row = [];
    for (let c = R.c0; c <= R.c1; c++) { row.push([c, r, f.impact]); all.push([c, r, f.dot.dmgPerTick]); }
    const d = floodRowMs(st, R, r);
    unitStrikes.push({ tiles: row, delayMs: d, ...stun(d) });
  }
  for (let k = 1; k <= f.dot.ticks; k++) {
    const d = st.flowMs + k * f.dot.tickInterval;
    unitStrikes.push({ tiles: all, delayMs: d, ...stun(d) });
  }
  return { shots, unitStrikes };
}

/**
 * 가시 — 범위 안 타워마다 '튀어나올 때 45 + 박힌 채로 0.5초마다 7 × 4'.
 * 범위 안 소환 유닛도 같은 시각에 같은 피해 (솟는 순간 범위 전체 · 틱마다 범위 전체).
 */
function castThornPlan(st, R, targets) {
  return castBurstPlan(st.thorn, st.hitMs, R, targets);
}

/**
 * 한 번 터지고(impact) 이어서 tickInterval마다(dot) — 가시 · 불덩이 · 폭염이 같은 꼴이다.
 * 범위 안 타워마다 같은 시각에 같은 피해, 범위 안 소환 유닛도 같은 시각 같은 피해.
 * @param {{impact:number, dot:{dmgPerTick,ticks,tickInterval}}} f
 * @param {number} hitMs 터지는 시각 (던지는 카드면 날아가는 시간)
 */
function castBurstPlan(f, hitMs, R, targets, burn = false) {
  const shots = targets.map(({ pos }) => ({ pos, flyMs: hitMs, effect: { damage: f.impact, dot: f.dot } }));
  const hit = [], tick = [];
  for (let c = R.c0; c <= R.c1; c++) for (let r = R.r0; r <= R.r1; r++) { hit.push([c, r, f.impact]); tick.push([c, r, f.dot.dmgPerTick]); }
  // 불 (2026-10-04) — 맞은 유닛에 불이 붙어 따라다니며 탄다 (물에 닿으면 꺼진다 — units.js _uBurnStep)
  if (burn) return { shots, unitStrikes: [{ tiles: hit, delayMs: hitMs, status: { burn: { dmg: f.dot.dmgPerTick, n: f.dot.ticks, iv: f.dot.tickInterval } } }] };
  const unitStrikes = [{ tiles: hit, delayMs: hitMs }];
  for (let k = 1; k <= f.dot.ticks; k++) unitStrikes.push({ tiles: tick, delayMs: hitMs + k * f.dot.tickInterval });
  return { shots, unitStrikes };
}

/** 불덩이 계획 — 날아가는 시간 뒤에 터진다 */
function castFireballPlan(st, R, targets) {
  return castBurstPlan(st.burn, st.flyMs, R, targets, true);
}

/** 폭염 계획 — 폭발 + 불타는 동안. 열기(더위)는 피해가 아니라 구역이라 따로 기록한다 (heatwaveZone) */
function castHeatwavePlan(st, R, targets) {
  return castBurstPlan(st.blast, st.hitMs, R, targets, true);
}

/** 폭염의 열기 구역 — 시전 시각 기준 (from, until)ms 뒤 */
function heatwaveZoneTimes(st) {
  const from = st.hitMs + st.burnMs;
  return { from, until: from + st.heatMs };
}

const WAVE_TOWER_COLS = { left: 11, king: 12, right: 11 };

/** 파도가 놓은 자리에서 맵 끝까지 가는 시간 (뒤끝 c0 → 앞끝이 맵 끝에 닿을 때까지) */
function waveTravelMs(st, c0) {
  return Math.round((MAP_COLS - st.cols - c0) / st.speed * 1000);
}

/**
 * 파도 — 솟구친 뒤 0.5초마다, 그 순간 파도 안에 든 대상에게 22.
 * 타워는 발밑(칸의 가운데 70%)이 파도와 겹치면 '안에 든' 것이다.
 * @param {number} c0 파도 뒤끝 열 (내 진영 0~5)
 * @param {(pos:string)=>boolean} alive 그 타워가 서 있는가
 */
function castWavePlan(st, c0, alive) {
  const travelMs = waveTravelMs(st, c0);
  const shots = [], unitStrikes = [], hit = {};
  for (let t = st.tickMs; t <= travelMs; t += st.tickMs) {
    const x = c0 + st.speed * t / 1000;
    const at = st.riseMs + t;
    ['left', 'king', 'right'].forEach(pos => {
      if (!alive(pos)) return;
      const tc = WAVE_TOWER_COLS[pos];
      if (x > tc + 0.85 || x + st.cols < tc + 0.15) return;
      shots.push({ pos, flyMs: at, damage: st.damage });
      hit[pos] = (hit[pos] || 0) + 1;
    });
    const tiles = [];
    for (let c = 0; c < MAP_COLS; c++) {
      if (c + 0.5 < x || c + 0.5 > x + st.cols) continue;
      for (let r = 0; r < MAP_ROWS; r++) tiles.push([c, r, st.damage]);
    }
    if (tiles.length) unitStrikes.push({ tiles, delayMs: at, ...(st.slowMs ? { status: { slow: st.slowMs, k: st.slowK } } : {}) });
  }
  return { shots, unitStrikes, hit, travelMs, endMs: st.riseMs + travelMs + st.calmMs };
}

const STONE_IMPACT_MS = 850;   // stone-impact.svg 전체 길이

// ── 토네이도 (바람의 진화) ──────────────────────────────────
// 내 진영 타일 한가운데에 설치하면 일자로 오른쪽으로 전진해 타워를 친다.
// 멀리서 올수록 오래 감기므로 더 크고 더 빠르고 더 아프다.
//
// 거리는 '타일 개수'로 센다. 내 진영 오른쪽 끝(7열)에서 옆 타워(11열)까지가 4칸으로 가장 가깝고,
// 왼쪽 끝(0열)에서 킹 타워(12열)까지 12칸으로 가장 멀다 (옆 타워가 킹보다 한 칸 앞 · 2026-10-02 타워가 두 칸 앞으로).
const TORNADO_MIN_TILES = 4;    // 가장 가까운 경우 (7열 → 옆 타워 11열)
const TORNADO_MAX_TILES = 12;   // 가장 먼 경우   (0열 → 킹 12열)

/** 타워까지의 타일 수 → 피해. 가장 가까우면 20, 한 칸 멀어질 때마다 +5, 최대 60 */
function tornadoDamage(tiles) {
  const t = Math.max(TORNADO_MIN_TILES, Math.min(TORNADO_MAX_TILES, tiles));
  // 다 자란 크기에 타워 셋까지 닿을 수 있게 되면서 합계 피해가 너무 세졌다 → 너프
  // (예전 20~60 / 한 칸당 +5 → 지금 16~40 / 한 칸당 +3)
  return Math.min(40, 16 + (t - TORNADO_MIN_TILES) * 3);
}

/**
 * 설치한 열 → 다 자랐을 때의 반지름.
 * 타워 줄 간격이 200이므로 반지름 100이면 두 줄, 200이면 세 줄까지 닿는다.
 * 몇 개를 맞히느냐는 따로 정해 두지 않는다 — 다 자란 크기에 닿으면 그게 곧 맞은 것이다.
 *   7열(강 바로 앞) 55  → 한 줄
 *   4열           121  → 두 줄
 *   0열(맨 끝)    209  → 세 줄 (가운데 줄에 딱 맞춰 놓았을 때)
 */
function tornadoRadius(col) {
  const tiles = MAP_COLS - 2 - col;          // 맨 뒤 열(14열)까지의 칸 수 — 크기 곡선은 타워 배치와 상관없이 열로만 정한다
  return Math.max(55, Math.min(210, 55 + (tiles - 7) * 22));
}

/**
 * 설치할 수 있는 타일인가 — 내 진영이고, 타워가 서 있는 칸이 아니어야 한다.
 * col·row는 늘 '쓰는 사람 시점'(내 진영 = 0~7열)이다.
 * @param {boolean} mirrored 쓰는 사람이 이 화면의 오른쪽 편인가 (AI) — 화면 칸은 좌우를 뒤집어 본다
 */
function tornadoTileOk(col, row, mirrored = false) {
  if (col < 0 || row < 0 || col >= MAP_COLS || row >= MAP_ROWS) return false;
  if (col > MAP_COLS / 2 - 1) return false;                    // 내 진영(0~7열)만
  return !_tileHasTower(mirrored ? MAP_COLS - 1 - col : col, row);
}

/** 그 칸에 타워가 있는가 (내 타워든 상대 타워든) */
function _tileHasTower(col, row) {
  return [...document.querySelectorAll('.tower')].some(el => {
    const st = el.style;
    return Number(st.getPropertyValue('--col')) === col && Number(st.getPropertyValue('--row')) === row;
  });
}

/**
 * 이 자리에 놓았을 때 맞는 타워들.
 * 토네이도는 일자로 앞으로만 가므로, 세로로 반지름 안에 든 살아 있는 상대 타워가 대상이다.
 * 타워마다 자기까지의 타일 수로 피해가 따로 정해진다.
 *
 * col은 '쓰는 사람 시점'(내 진영 0~7열, 앞 = 오른쪽)이다. 맞는 쪽이 이 화면의 왼쪽 편(targetOwner 'my')이면
 * 쓰는 사람이 상대(또는 AI)라는 뜻 — 타워 칸을 좌우로 뒤집어 그 사람 시점으로 잰다.
 * 예전엔 이 구분이 없어서, 상대가 쓴 토네이도를 받는 화면(상대·관전자)에서는 뒤집힌 칸으로 재어
 * 크기가 가장 작게 나오고 한 칸만 가다 멈췄다.
 */
function tornadoTargets(col, row, targetOwner = 'enemy') {
  const r  = tornadoRadius(col);
  const cy = row * TILE + TILE / 2;
  const out = [];
  ['left', 'king', 'right'].forEach(pos => {
    if (!_towerAlive(targetOwner, pos)) return;
    const el = document.getElementById(`tower-${targetOwner}-${pos}`);
    if (!el) return;
    const viewCol = Number(el.style.getPropertyValue('--col'));
    const tCol = targetOwner === 'my' ? MAP_COLS - 1 - viewCol : viewCol;
    const tRow = Number(el.style.getPropertyValue('--row'));
    // 다 자란 크기에 닿으면 맞는다 — 하나든 둘이든 셋이든 개수는 제한하지 않는다
    if (Math.abs((tRow * TILE + TILE / 2) - cy) > r) return;    // 세로로 못 닿는다
    const tiles = tCol - col;
    if (tiles <= 0) return;
    out.push({ pos, tiles, damage: tornadoDamage(tiles), col: tCol });
  });
  return out;
}

/** 꾹 누른 시간 → 차징 단계 (0~steps) */
function castChargeLevel(st, heldMs) {
  const c = st && st.charge;
  if (!c) return 0;
  return Math.max(0, Math.min(c.steps, Math.floor(heldMs / (c.fullMs / c.steps))));
}
/** 차징 단계 → 피해 */
function castChargeHeldMs(st, lv) {
  const c = st && st.charge;
  return c ? Math.max(0, Math.min(c.steps, lv)) * (c.fullMs / c.steps) : 0;
}
/** 차징 단계 → 피해 */
function castChargeDamage(st, lv) {
  const c = st && st.charge;
  return c ? c.damage[Math.max(0, Math.min(c.steps, lv))] : null;
}
/** 차징 단계 → 날아가는 시간(ms) */
function castChargeFlyMs(st, lv) {
  const c = st && st.charge;
  return c && c.flyMs ? c.flyMs[Math.max(0, Math.min(c.steps, lv))] : 0;   // 화살은 차징해도 속도가 같다
}
/** 차징 단계 → 연출 전체 길이 (잠금이 풀리는 시점) */
function castChargeEndMs(st, lv) {
  return st && st.charge ? castChargeFlyMs(st, lv) + STONE_IMPACT_MS : (st ? st.endMs : 0);
}
/** 연출 id에 차징 단계를 실어 보낸다 — 상대 화면도 같은 속도로 날아가야 한다.
 *  instantHits.type은 20자 제한이라 따로 필드를 만들지 않고 붙여 쓴다 (규칙 변경 불필요) */
function castFxId(castId, level) {
  return castId && level ? castId + '@' + level : castId;
}

// 연출이 처음 재생될 때 파일을 받느라 늦지 않도록 미리 받아 둔다
// (피해 시점은 JS 타이머로 잡으므로 그림이 늦게 뜨면 어긋나 보인다)
// 연출마다 그림이 한 장일 수도 두 장일 수도 있다 (투척은 '날아가는 돌'과 '깨짐'이 따로다).
// 돌가루는 CAST_STYLES에 없고 지속 피해가 들어갈 때마다 쓰이므로 따로 적어 둔다.
const _castPreloaded = [];
Object.values(CAST_STYLES)
  .flatMap(st => [st.fx, st.impact, st.impactGround])
  .concat([{ file: 'fx/stone-dust.svg' }])
  .forEach(part => {
    if (!part) return;
    const img = new Image();
    img.src = part.file;
    _castPreloaded.push(img);
  });
const CAST_NEAR_HIT = 80;   // 커서가 이만큼 가까우면 타워 위로 본다 (타워 크기 100~132)

/** 이 카드가 시전 연출을 쓰는가 */
function cardCastStyle(card) {
  return card && card.cast ? CAST_STYLES[card.cast] : null;
}

// ── 시전 잠금 ────────────────────────────────────────────────
// 공격 연출(피해가 연출 끝에 들어가는 카드)이 도는 동안 '같은 카드'는 또 쓸 수 없다.
// 같은 연출과 피해가 겹쳐서 무슨 일이 일어났는지 알 수 없게 되는 것을 막는다.
// 다른 카드는 연출이 도는 중에도 쓸 수 있다 — 목검과 듀얼 검도 서로 다른 카드다.
// 설치형 회복(hitMs 0)은 잠그지 않는다 — 5초짜리 토템까지 묶으면 답답하다.
const _castBusyUntil = Object.create(null);   // 카드 id → 이 시각까지 잠김

/** 그 카드의 연출이 끝나기까지 남은 ms (0이면 바로 쓸 수 있다) */
function castCooldownLeft(card) {
  const id = card && card.id;
  if (!id) return 0;
  return Math.max(0, (_castBusyUntil[id] || 0) - Date.now());
}

/** 이 카드가 지금 자기 연출 때문에 막혀 있는가 */
function castBlocked(card) {
  const st = cardCastStyle(card);
  return !!(st && st.hitMs > 0 && castCooldownLeft(card) > 0);
}

/** 막혔다는 것을 화면 가운데 알림으로 알린다 (연타해도 다시 뜬다) */
function castNotifyBlocked() {
  if (typeof showCenterNotice === 'function') showCenterNotice(t('castCooldown'));
}

/** 매치가 끝나거나 새로 시작하면 잠금 해제 */
function castResetCooldown() {
  for (const id in _castBusyUntil) delete _castBusyUntil[id];
}

/**
 * 시전 연출 재생 — 상대·AI가 쓴 카드도 같은 연출로 보여 준다.
 * @returns {number} 피해가 들어가야 하는 지연(ms), 연출이 없으면 0
 */
function playCastFx(castId, owner, pos, stagePoint = null) {
  // 'stone@3'처럼 차징 단계가 붙어 올 수 있다
  const at    = String(castId == null ? '' : castId).split('@');
  const baseId = at[0];
  const level  = Number(at[1]) || 0;
  const style = CAST_STYLES[baseId];
  if (!style) return 0;
  if (style.shape === 'throw')  return _playThrowFx(style, owner, pos, stagePoint, level);
  if (style.shape === 'throw3') return _playThrow3Fx(style, owner);
  if (style.shape === 'tile')   return _playTornadoFx(style, owner, stagePoint);
  if (style.shape === 'area')   return _playAreaFx(style, owner, pos, stagePoint);
  if (style.shape === 'wave')   return _playWaveFx(style, owner, stagePoint);
  if (style.shape === 'shot')   return _playShotFx(style, owner, pos, stagePoint, level, at[2] === 'o');
  if (style.shape === 'summon') return 0;   // 컷씬·유닛은 js/units.js가 DB를 보고 그린다
  if (style.saw) return _playSawFx(style, owner, pos, stagePoint, at[1] || null, at[2]);   // 'saw@톱번호@방향'
  // 듀얼 검 · 바람이 토템을 쳤다 — 베어 없애거나(듀얼 검) 남은 시간을 줄인다(바람)
  if (at[1] === 't' && style.totemHit && stagePoint) {
    const g = _stageToGround(stagePoint.x, stagePoint.y);
    const col = Math.floor(g.x / TILE), row = Math.floor(g.y / TILE);
    const dir = owner === 'enemy' ? 1 : -1;
    setTimeout(() => {
      if (!totemOnTile(col, row)) return;
      if (style.totemHit === 'slash') _breakTotemsIn({ c0: col, c1: col, r0: row, r1: row }, { how: 'slash', dir, ux: dir, uy: 0 });
      else _totemShorten(col, row, TOTEM_CUT_MS);
    }, style.hitMs);
  }
  let c = stagePoint;   // 설치형은 클릭한 자리에 그대로 놓인다
  if (!c) {
    const towerEl = document.getElementById(`tower-${owner}-${pos}`);
    if (!towerEl) return 0;
    c = _towerCenterStage(towerEl);
  }
  // 토템은 칸 단위로 놓인다 — 받는 쪽(상대·관전자)도 반올림 오차 없이 같은 칸 한가운데에.
  // 자리 없이 오면(AI) 그 타워가 선 칸에 선다 — 타워 중심(화면 좌표)을 그대로 쓰면 바닥 좌표와 몇 px 어긋난다
  let totemCell = null;
  if (style.shape === 'circle') {
    totemCell = stagePoint ? { col: Math.floor(c.x / TILE), row: Math.floor(c.y / TILE) } : _towerTile(owner, pos);
    if (totemCell) {
      c = _tileCenter(totemCell.col, totemCell.row);
      _markTotemTile(totemCell.col, totemCell.row, style.endMs);   // 서 있는 동안 이 칸에는 더 못 세운다
    }
  }
  // 벽돌 · 철벽 — 그 타워를 얇은 벽이 둘러싼다 (서 있는 동안이 곧 막는 시간).
  // 이미 같은 벽이 서 있으면(연장) 그대로 두고, 늘어난 끝 시각은 타워 데이터가 오면 _wallSync가 맞춘다
  if (style.wall) {
    const el = document.getElementById(_towerId(owner, pos));
    if (el && !(typeof towers3dWallShield === 'function' && towers3dWallShield(el, style.wall, style.endMs))) {
      el.classList.add('tower-wall-flat');                 // WebGL이 없으면 테두리로만
      setTimeout(() => el.classList.remove('tower-wall-flat'), style.endMs);
    }
    return 0;
  }
  // 벚꽃 — 타워를 감고 오르는 꿃잎을 3D로. 평면 그림 한 장을 입체 건물 위에
  // 얹어 두면 스티커처럼 떠 보인다. WebGL이 없으면 false가 오고 예전 그림으로 돌아간다
  if (style.shape === 'towertile' && typeof towers3dSpawnBlossom === 'function' &&
      towers3dSpawnBlossom(c.x, c.y, style.endMs, owner, pos)) {
    return style.hitMs;
  }

  const fx = style.fx;
  // SVG 한 장이 연출 전체(움직임 포함)를 담고 있다 — <img>로 넣으면 그 안의 애니메이션이 한 번 재생된다
  const el = document.createElement('img');
  el.className  = `cast-fx cast-fx-${baseId}`;
  el.src        = fx.file;
  el.alt        = '';
  el.dataset.castId = castId;
  // 방향이 있는 공격(부채꼴·직선)은 그림이 '왼쪽 → 오른쪽'으로 그려져 있다 — 내 화면에서 내가 쓰면 맞다.
  // 상대가 쓴 것(맞는 쪽이 내 진영 = 왼쪽)은 상대가 오른쪽에 있으니 좌우를 뒤집어 오른쪽에서 들어오게 한다.
  // 관전 화면도 같다 (p1이 왼쪽 — p2가 쓴 공격은 뒤집힌다).
  // 뒤집으면 기준점이 상자 안에서 w - hx 로 옮겨 가므로 그만큼 놓는 자리를 바꾼다.
  const flip = owner === 'my' && (style.shape === 'fan' || style.shape === 'lunge');
  // 범위 크기에 맞춰 그림을 줄일 수 있다 (fx.scale) — 기준점도 같은 비율로 옮긴다
  const sc = fx.scale || 1;
  const w = fx.w * sc, h = fx.h * sc, hx = fx.hx * sc, hy = fx.hy * sc;
  el.style.left   = (c.x - (flip ? w - hx : hx)) + 'px';
  el.style.top    = (c.y - hy) + 'px';
  if (flip) { el.style.transform = 'scaleX(-1)'; el.classList.add('cast-fx-flip'); }
  el.style.width  = w + 'px';
  el.style.height = h + 'px';
  // 토템은 칸 한가운데(바닥 좌표)에 놓이고, 범위 원·풀·꽃잎은 바닥 장식이다 —
  // 바닥판 안에 넣어야 조준할 때 본 원과 똑같이 누워 보인다.
  const ground = style.shape === 'circle' ? _castGround() : null;
  if (ground) el.classList.add('cast-fx-ground');
  if (totemCell) el.dataset.tile = totemCell.col + ',' + totemCell.row;   // 붕괴가 이 칸의 장식을 찾아 지운다
  el.dataset.born = Date.now();
  (ground || _fxLayer()).appendChild(el);

  // 설치형(토템)은 한가운데에 서는 물건을 3D로 세운다 — 바닥 장식(원·풀·꿃잎)은 SVG 그대로.
  // WebGL이 없으면 false가 오므로 평면 이모지로 대신한다.
  if (style.shape === 'circle') {
    const spawned = typeof towers3dSpawnTotem === 'function' &&
                    towers3dSpawnTotem(c.x, c.y, baseId, style.endMs);
    if (!spawned) {
      const flat = document.createElement('div');
      flat.className = 'cast-fx cast-totem-flat';
      flat.textContent = baseId === 'whiteblossom' ? '\u{1F4AE}' : '\u{1F333}';
      const sp = _groundToStage(c.x, c.y);   // 이모지는 서 있는 물건 — 화면 좌표로
      flat.style.left = sp.x + 'px';
      flat.style.top  = sp.y + 'px';
      if (totemCell) flat.dataset.tile = el.dataset.tile;
      _fxLayer().appendChild(flat);
      setTimeout(() => flat.remove(), style.endMs);
    }
    _totemGauge(c, style, totemCell, spawned);
    _totemWitherWatch();                 // 더위(폭염의 열기) 속에 세운 토템은 말라 비틀어진다
    // 붕괴가 일어나는 중인 자리 — 막 세웠어도 곧바로 무너진다 (회복도 들어가지 않는다: 보낸 쪽이 대상을 비운다).
    // 세워지는 모습이 잠깐 보여야 '세웠는데 무너졌다'로 읽힌다
    const doom = totemCell && totemBreakZoneAt(totemCell.col, totemCell.row);
    if (doom) setTimeout(() => _destroyTotem(totemCell.col, totemCell.row, doom.how, doom.dir), 260);
  }

  setTimeout(() => el.remove(), style.endMs);
  return style.hitMs;
}

/**
 * 투척 연출 — 던지는 쪽 킹 타워에서 착지점까지 포물선으로 날아간 뒤 깨진다.
 * 비행 시간이 차징 단계에 따라 1.0~2.5초로 달라져서 SVG 안에 궤적을 넣을 수 없다.
 * 그래서 가로는 등속, 세로는 '올라갈 때 감속 / 떨어질 때 가속'으로 나눠 그린다.
 * @returns {number} 피해가 들어가야 하는 지연(ms) = 비행 시간
 */
function _playThrowFx(style, owner, pos, stagePoint, level) {
  if (style.burn) return _playFireballFx(style, owner, pos, stagePoint);
  const land = stagePoint || boardTowerCenterStage(owner, pos);
  if (!land) return 0;
  const from = _throwFromStage(owner);
  const flyMs = castChargeFlyMs(style, level) || style.hitMs;
  _throwOne(style, from, land, flyMs);
  return flyMs;
}

/** 던진 쪽 킹 타워의 스테이지 좌표 — owner는 '맞는 쪽'이라 그 반대편이다 */
function _throwFromStage(owner) {
  return boardTowerCenterStage(owner === 'my' ? 'enemy' : 'my', 'king') || { x: 0, y: 0 };
}

/**
 * 바위 지옥 — 세 덩이가 한 번에 떠나 타워마다 다른 시각에 떨어진다.
 * @returns {number} 첫 덩이가 닿는 시각(ms)
 */
function _playThrow3Fx(style, owner) {
  const from = _throwFromStage(owner);
  let first = 0;
  // 부서진 타워로 갈 덩이는 가운데로 옮겨 떨어진다 — 상대 화면에서도 같은 자리여야 한다
  castThrow3Shots(style, owner).forEach(shot => {
    if (!shot) return;
    const land = boardTowerCenterStage(owner, shot.pos);
    if (!land) return;
    _throwOne(style, from, land, shot.flyMs);
    if (!first || shot.flyMs < first) first = shot.flyMs;
  });
  return first;
}

/** 돌 한 덩이가 from에서 land까지 포물선으로 날아가 깨진다 */
function _throwOne(style, from, land, flyMs) {
  const dx = land.x - from.x, dy = land.y - from.y;
  const dist = Math.hypot(dx, dy);
  const arc  = Math.min(300, 110 + dist * 0.2);   // 멀수록 높이 뜬다
  const fx   = style.fx;
  const layer = _fxLayer();

  // 가로 이동만 맡는 바깥 상자
  const fly = document.createElement('div');
  fly.className = 'stone-fly';
  fly.style.left = from.x + 'px';
  fly.style.top  = from.y + 'px';

  // 세로(포물선)만 맡는 안쪽 상자
  const wrap = document.createElement('div');
  wrap.className = 'stone-fly-wrap';

  const rock = document.createElement('img');
  rock.className = 'stone-fly-rock';
  rock.src = fx.file;
  rock.alt = '';
  rock.style.width      = fx.w + 'px';
  rock.style.height     = fx.h + 'px';
  rock.style.marginLeft = (-fx.hx) + 'px';
  rock.style.marginTop  = (-fx.hy) + 'px';

  // 바닥 그림자 — 높이 뜰수록 작고 흐려진다. 던진 느낌은 이것이 절반을 만든다
  const shadow = document.createElement('div');
  shadow.className = 'stone-fly-shadow';

  wrap.appendChild(rock);
  fly.appendChild(shadow);
  fly.appendChild(wrap);
  layer.appendChild(fly);

  const opts = { duration: flyMs, fill: 'forwards' };
  fly.animate(
    [{ transform: 'translate(0px, 0px)' }, { transform: `translate(${dx}px, ${dy}px)` }],
    { ...opts, easing: 'linear' }
  );
  wrap.animate([
    { transform: 'translateY(0px) scale(1)',             easing: 'cubic-bezier(0.18, 0.72, 0.42, 1)' },
    { transform: `translateY(${-arc}px) scale(1.22)`, offset: 0.5,
                                                         easing: 'cubic-bezier(0.55, 0, 0.78, 0.36)' },
    { transform: 'translateY(0px) scale(1)' }
  ], opts);
  shadow.animate([
    { transform: 'translate(-50%, -50%) scale(1)',    opacity: 0.42 },
    { transform: 'translate(-50%, -50%) scale(0.5)',  opacity: 0.14, offset: 0.5 },
    { transform: 'translate(-50%, -50%) scale(1)',    opacity: 0.42 }
  ], opts);

  setTimeout(() => {
    fly.remove();
    _stoneImpact(style, land);
  }, flyMs);
}

/**
 * 돌이 깨지는 순간 — 세 겹으로 나눠 그린다.
 *   ① 바닥에 눕는 것 (눌린 자국 · 먼지 고리 · 균열 · 충격 고리) — 바닥판 안. 충격 고리 끝이 판정 원과 같은 크기
 *   ② 서 있는 것 (섬광 · 빛줄기 · 튀는 파편) — #fx-layer
 *   ③ 피어오르는 흙먼지 몇 덩이 + 잠깐 남는 움푹 팬 자국
 * 예전엔 서 있는 그림 한 장(세로를 손으로 눌러 누운 척)과 판정 크기의 금빛 고리를 겹쳤다.
 * 납작한 타원과 거의 둥근 고리가 따로 놀아서, 범위를 키우자 둘의 차이가 눈에 띄었다.
 */
function _stoneImpact(style, land) {
  const layer  = _fxLayer();
  const ground = _castGround();
  const R      = style.radius || 100;
  const img = (part, cls, s, x, y, parent) => {
    const el = document.createElement('img');
    el.className = cls;
    el.src = part.file;
    el.alt = '';
    el.style.left   = (x - part.hx * s) + 'px';
    el.style.top    = (y - part.hy * s) + 'px';
    el.style.width  = (part.w * s) + 'px';
    el.style.height = (part.h * s) + 'px';
    parent.appendChild(el);
    setTimeout(() => el.remove(), STONE_IMPACT_MS);
    return el;
  };

  // ① 바닥 — 충격 고리가 판정 반지름에서 멈추도록 줄인다 (바위 지옥처럼 원이 작아도 너무 작아지지는 않게)
  const gp = style.impactGround;
  const gs = gp ? Math.max(0.34, R * 1.2 / gp.reach) : 1;   // 충격 고리가 칸 가장자리를 조금 넘는 크기
  if (gp && ground) {
    const g = _stageToGround(land.x, land.y);
    img(gp, 'cast-fx cast-fx-ground cast-fx-stone-ground', gs, g.x, g.y, ground);

    // 움푹 팬 자국 — 연출이 끝나도 잠깐 남아 '여기 떨어졌다'를 알려 준다
    const crater = document.createElement('div');
    crater.className = 'stone-crater';
    crater.style.left = g.x + 'px';
    crater.style.top  = g.y + 'px';
    crater.style.width = crater.style.height = Math.round(R * 0.9) + 'px';
    ground.appendChild(crater);
    setTimeout(() => crater.remove(), 1500);
  }

  // ② 서 있는 것 — 바닥 그림보다 크게. 파편은 범위 밖까지 조금 튀어야 자연스럽고, 섬광이 먼지에 묻히지 않는다
  const im = style.impact;
  if (im) img(im, 'cast-fx cast-fx-stone-impact', gs * 1.3, land.x, land.y, layer);

  // ② ' 타워에 맞았다 — 발밑의 깨짐은 건물에 가려 거의 안 보인다. 건물 몸통에서 따로 크게 터뜨린다
  const hit = _towerAtStage(land);
  if (hit) _stoneTowerHit(hit);

  // ③ 흙먼지 — 가운데 하나 + 범위 가장자리 쪽으로 몇 덩이. 떨어진 자리마다 조금씩 다르게
  const seed = Math.abs(Math.round(land.x * 7 + land.y * 13));
  _spawnDust(land.x, land.y - 6, R * 1.25, 0, 950);
  for (let k = 0; k < 4; k++) {
    const a = (seed % 360) * Math.PI / 180 + k * Math.PI / 2 + (k % 2) * 0.4;
    const d = R * (0.45 + ((seed >> k) % 3) * 0.12);
    _spawnDust(land.x + Math.cos(a) * d, land.y + Math.sin(a) * d * 0.8, R * 0.8, 50 + k * 40, 850);
  }
}

/** 그 자리(스테이지 좌표)에 서 있는 타워 — 돌이 떨어진 칸이 타워 칸인가 */
function _towerAtStage(p) {
  for (const owner of ['my', 'enemy']) {
    for (const pos of ['left', 'king', 'right']) {
      const el = document.getElementById(_towerId(owner, pos));
      const c = el && _towerCenterStage(el);
      if (c && Math.hypot(c.x - p.x, c.y - p.y) < 30) return { owner, pos, el };
    }
  }
  return null;
}

/**
 * 돌이 타워 몸통을 때린 순간 — 주황빛 섬광 · 충격 고리 · 사방으로 튀는 돌 조각 · 흙먼지,
 * 필드가 쿵 울리고 3D 건물은 크게 휘청이며 하얗게 달아오르고 벽에서 조각이 떨어져 나온다.
 */
function _stoneTowerHit({ owner, pos, el }) {
  // 던진 쪽에서 날아와 맞으니 반대쪽으로 휘청인다 (상대 타워는 오른쪽, 내 타워는 왼쪽)
  if (typeof towers3dImpact === 'function') towers3dImpact(el, owner === 'enemy' ? -1 : 1);
  const pt = (typeof towers3dTowerPoint === 'function' && towers3dTowerPoint(owner, pos, 0.42)) || _towerCenterStage(el);
  if (!pt) return;
  const fx = document.createElement('div');
  fx.className = 'fx-stone-hit';
  fx.style.left = pt.x + 'px';
  fx.style.top  = pt.y + 'px';
  let shards = '';
  const away = owner === 'enemy' ? 1 : -1;       // 조각은 날아온 방향으로 더 멀리 튄다
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + (i % 3) * 0.25;
    const d = 55 + (i % 4) * 22;
    const dx = Math.cos(a) * d + away * 25, dy = Math.sin(a) * d * 0.8 - 20;
    shards += `<i class="fsh-shard" style="--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--rot:${(i * 67) % 360}deg;--s:${(0.7 + (i % 3) * 0.3).toFixed(1)}"></i>`;
  }
  fx.innerHTML = '<i class="fsh-flash"></i><i class="fsh-ring"></i><i class="fsh-star"></i>' + shards;
  _fxLayer().appendChild(fx);
  setTimeout(() => fx.remove(), 900);
  for (let k = 0; k < 3; k++) _spawnDust(pt.x + (k - 1) * 26, pt.y + 10 + (k % 2) * 8, 70, 40 + k * 50, 800);
  const map = document.querySelector('.game-map');
  if (map) {
    map.classList.remove('field-bump');
    void map.offsetWidth;
    map.classList.add('field-bump');
    setTimeout(() => map.classList.remove('field-bump'), 300);
  }
}

/**
 * 피어오르는 흙먼지 한 덩이 (서 있는 연출 — #fx-layer, 스테이지 좌표).
 * 흐린 원 하나가 커지면서 떠오르고 옅어진다. 지진·붕괴·돌이 같이 쓴다.
 */
function _spawnDust(x, y, size, delay, ms, tint = null) {
  const el = document.createElement('div');
  el.className = 'fx-dust';
  el.style.left   = x + 'px';
  el.style.top    = y + 'px';
  el.style.width  = el.style.height = Math.round(size) + 'px';
  if (tint) el.style.setProperty('--dust', tint);
  _fxLayer().appendChild(el);
  const rise = size * 0.32;
  el.animate([
    { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0 },
    { transform: `translate(-50%, calc(-50% - ${rise * 0.35}px)) scale(0.8)`, opacity: 0.8, offset: 0.2 },
    { transform: `translate(-50%, calc(-50% - ${rise}px)) scale(1.25)`, opacity: 0 }
  ], { duration: ms, delay, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'both' });
  setTimeout(() => el.remove(), delay + ms + 50);
}

/**
 * 토네이도 연출 — 설치한 자리에서 작게 시작해 점점 커지고 빨라지며 일자로 전진한다.
 * 어디서 놓든 도착까지 걸리는 시간은 같으므로, 멀리서 온 토네이도가 그만큼 빠르게 보인다.
 * @returns {number} 타워에 닿는 시각(ms)
 */
function _playTornadoFx(style, owner, stagePoint) {
  if (!stagePoint) return style.hitMs;
  const layer = _fxLayer();
  const fx = style.fx;
  // 쓰는 사람 시점의 열 — 맞는 쪽이 이 화면 왼쪽이면(상대·AI가 쓴 것) 좌우를 뒤집어 잰다
  const viewCol = Math.floor(stagePoint.x / TILE);
  const col = owner === 'my' ? MAP_COLS - 1 - viewCol : viewCol;
  const r   = tornadoRadius(col);

  // 어디까지 가는가 — 맞는 타워 중 가장 가까운 열까지. 없으면 상대 진영 끝까지
  const hits = tornadoTargets(col, Math.floor(stagePoint.y / TILE), owner);
  const stopCol = hits.length ? Math.min(...hits.map(h => h.col)) : MAP_COLS - 2;
  const dx = (owner === 'enemy' ? 1 : -1) * (stopCol - col) * TILE;

  const el = document.createElement('img');
  el.className = 'cast-fx cast-fx-tornado';
  el.src = fx.file;
  el.alt = '';
  el.style.left   = (stagePoint.x - fx.hx) + 'px';
  el.style.top    = (stagePoint.y - fx.hy) + 'px';
  el.style.width  = fx.w + 'px';
  el.style.height = fx.h + 'px';
  // 다 자랐을 때 지름이 2r이 되도록 — 그림의 깔때기 폭(약 244px)을 기준으로 맞춘다
  const endScale = (r * 2) / 244;
  el.style.transformOrigin = `${fx.hx}px ${fx.hy}px`;
  layer.appendChild(el);

  el.animate([
    { transform: `translateX(0px) scale(${(endScale * 0.3).toFixed(3)})`, opacity: 0.35,
      easing: 'cubic-bezier(0.55, 0, 0.85, 0.35)' },                      // 처음엔 작고 느리게
    { transform: `translateX(${dx}px) scale(${endScale.toFixed(3)})`, opacity: 1 }
  ], { duration: style.travelMs, fill: 'forwards' });

  // 도착하고 잠깐 흩어진다
  setTimeout(() => {
    el.animate([{ opacity: 1 }, { opacity: 0, transform: `translateX(${dx}px) scale(${(endScale * 1.25).toFixed(3)})` }],
               { duration: style.endMs - style.travelMs, fill: 'forwards' });
  }, style.travelMs);
  // 토네이도를 맞은 쪽 토템은 바람에 날아간다 (2026-10-02 상성 — 붕괴와 같은 디버프).
  // 소용돌이가 닿는 줄(다 자란 폭)의 맞는 쪽 진영 토템 전부
  const row = Math.floor(stagePoint.y / TILE), reach = Math.floor(r / TILE);
  setTimeout(() => _totemDebuff({ c0: 0, c1: MAP_COLS - 1, r0: row - reach, r1: row + reach }, 'blow', owner, owner === 'enemy' ? 1 : -1),
             style.travelMs * 0.85);
  setTimeout(() => el.remove(), style.endMs);
  return style.travelMs;
}

/** 돌가루 — 바위 지옥의 지속 피해가 한 번 들어갈 때마다 타워에서 튄다 */
function playStoneDust(owner, pos) {
  const c = boardTowerCenterStage(owner, pos);
  if (!c) return;
  const el = document.createElement('img');
  el.className = 'cast-fx cast-fx-stone-dust';
  el.src = 'fx/stone-dust.svg';
  el.alt = '';
  el.style.left   = (c.x - 110) + 'px';
  el.style.top    = (c.y - 110) + 'px';
  el.style.width  = '220px';
  el.style.height = '220px';
  _fxLayer().appendChild(el);
  setTimeout(() => el.remove(), 600);
}

/** 타워 중심의 스테이지 좌표 (owner/pos로) — game.js가 설치 자리를 되돌릴 때 쓴다 */
function boardTowerCenterStage(owner, pos) {
  const el = document.getElementById(`tower-${owner}-${pos}`);
  return el ? _towerCenterStage(el) : null;
}

/** 타워 중심의 스테이지 좌표 */
function _towerCenterStage(towerEl) {
  // 칸 좌표에서 계산한다 — 화면 요소 위치를 재면 두 가지가 흔들린다:
  //   · 조준 강조(drag-over)로 타워가 3px 떠오른 순간이 기준이 돼 상대·관전 화면에서 어긋난다
  //   · 화면이 숨겨진 동안엔 크기가 0이라 통째로 맵 원점이 된다
  // 타워는 칸 한가운데에 앉혀 있으므로(alignTowersToGround) 그 칸이 화면에 그려지는 자리가 곧 타워 자리다.
  const cs = towerEl.style;
  if (cs.getPropertyValue('--col') !== '' && cs.getPropertyValue('--row') !== '') {
    const col = Number(cs.getPropertyValue('--col')), row = Number(cs.getPropertyValue('--row'));
    if (Number.isFinite(col) && Number.isFinite(row)) return _groundToStage(col * TILE + TILE / 2, row * TILE + TILE / 2);
  }
  const el = towerEl.querySelector('.tower-block') || towerEl;
  const r  = el.getBoundingClientRect();
  return _clientToStage(r.left + r.width / 2, r.top + r.height / 2);
}

// ── 클릭-부착 카드 이동 시스템 ──────────────────────────────
// 카드 클릭 → 마우스에 달라붙음(또는 사거리 부채꼴) → 대상 하이라이팅 → 클릭으로 사용

// 마지막 마우스 위치 — 단축키로 카드를 고를 때도 커서 자리에 바로 붙이기 위해
let _lastPointer = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
document.addEventListener('pointermove', e => { _lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });

/** 지금 마우스 위치 */
function boardPointer() { return _lastPointer; }

/** 카드를 들고 있는 중인지 */
function boardIsHoldingCard() { return _stickyMode; }

let _castArc              = null;   // 마우스를 따라다니는 부채꼴 사거리
let _castLands            = null;   // 투척 카드의 착지 원 — 바닥판 안에 따로 둔다
let _castStyle            = null;
let _dragClone            = null;
let _dragHighlightedTower = null;
let _dragSourceEl         = null;
let _stickyMode           = false;

function _moveStickyClone(cx, cy) {
  if (!_dragClone) return;
  const scale = _getGameScale();
  const w = parseFloat(_dragClone.style.width)  * scale;
  const h = parseFloat(_dragClone.style.height) * scale;
  _dragClone.style.left = (cx - w / 2) + 'px';
  _dragClone.style.top  = (cy - h / 2) + 'px';
}

/** deck.js의 click 핸들러에서 호출 — 카드를 커서에 부착 */
function startStickyDrag(e, card, slotIndex, sourceEl) {
  // 이미 부착 중이면 취소 후 새 카드로 교체
  if (_stickyMode) _cancelStickyDrag();

  // 취소·선택 표시로 슬롯이 다시 그려졌을 수 있다 — 지금 화면에 있는 카드 요소를 다시 찾는다.
  // (떨어져 나간 옛 요소를 복제하면 크기가 0이라 이모지·테두리만 남은 잔상이 생긴다)
  const liveEl = document.querySelector(`#deck-slots .deck-slot[data-slot="${slotIndex}"] .card`) || sourceEl;
  const baseW  = liveEl.offsetWidth;
  const baseH  = liveEl.offsetHeight;
  const clone  = liveEl.cloneNode(true);

  boardSetDraggingCard(card, slotIndex);
  _dragSourceEl = liveEl;
  _stickyMode   = true;
  liveEl.classList.add('dragging');
  document.body.style.cursor = 'crosshair';

  // 사거리 연출 카드 — 카드 대신 사거리 표시가 마우스를 따라다닌다
  // (shape이 없는 연출은 평소처럼 카드가 붙는다)
  const castStyle = cardCastStyle(card);
  _castStyle = (castStyle && castStyle.shape !== 'none') ? castStyle : null;
  if (_castStyle) {
    _castArc = document.createElement('div');
    if (_castStyle.shape === 'lunge') {
      // 일자 돌진 — 커서에서 오른쪽으로 뻗는 길 + 그 끝의 X자 범위
      _castArc.className = 'cast-lunge';
      // 끝의 X자는 X자로 베는 카드(듀얼 검)만 — 바람은 곧게 뻗는 직선만
      _castArc.innerHTML = '<span class="cast-lunge-path"></span>' +
        (_castStyle.xMark ? '<span class="cast-lunge-x"></span>' : '');
    } else if (_castStyle.shape === 'nearest') {
      // 톱 — 커서 둘레의 닿는 거리(점선 원) · 가장 가까운 대상까지 이어진 선 · 그 대상 발밑 네모
      _castArc.className = 'cast-saw-aim';
      _castArc.innerHTML = '<span class="cast-saw-reach"></span><span class="cast-saw-line"></span>' +
        '<span class="cast-saw-mark"></span><span class="cast-saw-dot"></span>';
    } else if (_castStyle.shape === 'circle') {
      // 토템 — 놓을 칸 네모(벚꽃과 같은 모양) + 그 가운데의 범위 원
      _castArc.className = 'cast-tile cast-totemtile';
      _castArc.innerHTML =
        '<div class="cast-tile-reach"></div>' +
        '<div class="cast-tile-cell"></div>';
    } else if (_castStyle.shape === 'towertile') {
      // 벚꽃 — 칸 네모 하나만 (범위 원도 길도 없다)
      _castArc.className = 'cast-tile cast-towertile';
      _castArc.innerHTML = '<div class="cast-tile-cell"></div>';
    } else if (_castStyle.shape === 'tile') {
      // 토네이도 — 놓을 칸 한 칸 + 다 자랐을 때의 범위 + 나아갈 길
      _castArc.className = 'cast-tile';
      _castArc.innerHTML =
        '<div class="cast-tile-cell"></div>' +
        '<div class="cast-tile-reach"></div>' +
        '<div class="cast-tile-path"></div>';
    } else if (_castStyle.shape === 'shot') {
      // 화살 — 활 자리에서 앞으로 뻗는 일자 길 + 끝의 화살촉 (끝에 X자는 없다)
      _castArc.className = 'cast-lunge cast-shot' + (_castStyle.love ? ' cast-shot-love' : '');
      _castArc.innerHTML = '<span class="cast-lunge-path"></span><span class="cast-shot-head"></span>';
      if (_castStyle.charge) {
        _castHud = document.createElement('div');
        _castHud.className = 'cast-throw cast-shot-hud';
        _castHud.innerHTML =
          '<div class="cast-throw-gauge"></div>' +
          '<span class="cast-throw-dmg"></span>' +
          `<span class="cast-throw-hint">${t('throwChargeHint')}</span>`;
        document.body.appendChild(_castHud);
      }
    } else if (_castStyle.shape === 'summon') {
      // 그림리퍼 — 놓을 수 있는 칸은 초록, 나머지는 전부 빨강. 가리킨 칸에서 목표 타워 앞까지 걸어갈 길
      _castArc.className = 'cast-summon';
      _castArc.innerHTML = _summonGridHtml() +
        '<div class="cast-summon-path"></div><div class="cast-summon-cell"></div>';
    } else if (_castStyle.shape === 'area') {
      // 지진·붕괴·침수 — 칸에 맞춘 네모 범위 (칸 격자가 비쳐 보인다)
      _castArc.className = 'cast-area' + (_castStyle.flood ? ' cast-area-water' : '');
    } else if (_castStyle.shape === 'wave') {
      // 파도 — 내 진영의 3칸 폭 띠 + 맵 끝까지 밀려갈 길
      _castArc.className = 'cast-wave';
      _castArc.innerHTML = '<div class="cast-wave-path"></div><div class="cast-wave-band"></div>';
    } else if (_castStyle.shape === 'throw3') {
      // 바위 지옥 — 타워 셋에 각각 꽂히는 궤적과 착지 원. 차징은 없다
      _castArc.className = 'cast-throw cast-throw3';
      _castArc.innerHTML =
        '<svg class="cast-throw-svg">' +
        _castStyle.shots.map(() => '<path class="cast-throw-path"/>').join('') +
        '</svg>';
    } else if (_castStyle.shape === 'throw' && _castStyle.area) {
      // 불덩이 — 포물선이 '칸 네 개가 만나는 점'에서 끝나고 그 점에 표식. 차징은 없다
      _castArc.className = 'cast-throw cast-throw-fire';
      _castArc.innerHTML =
        '<svg class="cast-throw-svg"><path class="cast-throw-path"/></svg>' +
        '<div class="cast-throw-dot"></div>';
    } else if (_castStyle.shape === 'throw') {
      // 투척 — 던지는 쪽에서 커서까지 이어지는 포물선 + 착지 원 + 차징 게이지
      _castArc.className = 'cast-throw';
      _castArc.innerHTML =
        '<svg class="cast-throw-svg"><path class="cast-throw-path"/></svg>' +
        '<div class="cast-throw-gauge"></div>' +
        '<span class="cast-throw-dmg"></span>' +
        `<span class="cast-throw-hint">${t('throwChargeHint')}</span>`;
    } else {
      _castArc.className = 'cast-arc';
      _castArc.style.setProperty('--arc-from', (90 - _castStyle.arcDeg / 2) + 'deg');
      _castArc.style.setProperty('--arc-deg',  _castStyle.arcDeg + 'deg');
    }
    // 놓이는 곳 — 바닥에 칠하는 표시는 바닥판 안에,
    // 공중을 나는 포물선과 숫자·게이지는 화면 고정으로.
    // 바닥판이 없는 페이지에서는 예전처럼 body로 돌아간다.
    const throwish = _castStyle.shape === 'throw' || _castStyle.shape === 'throw3';
    const ground = _castGround();
    (throwish || !ground ? document.body : ground).appendChild(_castArc);
    if (throwish && ground) {
      _castLands = document.createElement('div');
      _castLands.className = 'cast-lands';
      // 착지 표시는 타일 한 칸 네모 — 돌은 커서 칸, 바위 지옥은 덩이가 떨어질 타워 칸마다
      _castLands.innerHTML = (_castStyle.shots || [0])
        .map(() => `<div class="cast-throw-land cast-throw-tile${_castStyle.area ? ' cast-throw-fire-land' : ''}"></div>`).join('');
      ground.appendChild(_castLands);
    }
    _applyCastArcSize();
    // 선택하는 순간 커서 위치에 바로 표시
    if      (_castStyle.shape === 'towertile') _onTowerTileMove(e.clientX, e.clientY);
    else if (_castStyle.shape === 'circle') _onCircleMove(e.clientX, e.clientY);
    else if (_castStyle.shape === 'throw')  _onThrowMove(e.clientX, e.clientY);
    else if (_castStyle.shape === 'tile')   _onTileMove(e.clientX, e.clientY);
    else if (_castStyle.shape === 'throw3') _onThrow3Move(e.clientX, e.clientY);
    else if (_castStyle.shape === 'area')   _onAreaMove(e.clientX, e.clientY);
    else if (_castStyle.shape === 'wave')   _onWaveMove(e.clientX, e.clientY);
    else if (_castStyle.shape === 'shot')   _onShotMove(e.clientX, e.clientY);
    else if (_castStyle.shape === 'summon') _onSummonMove(e.clientX, e.clientY);
    else if (_castStyle.shape === 'nearest') _onSawMove(e.clientX, e.clientY);
    else                                    _moveCastArc(e.clientX, e.clientY);
    document.addEventListener('pointermove', _onStickyMove);
    document.addEventListener('keydown',     _onStickyKeyDown);
    document.addEventListener('keyup',       _onStickyKeyUp);
    setTimeout(() => { if (_stickyMode) document.addEventListener('click', _onStickyClick); }, 0);
    return;
  }

  const scale = _getGameScale();
  _dragClone = clone;
  _dragClone.classList.add('sticky-clone');
  _dragClone.style.cssText = [
    'position:fixed',
    `width:${baseW}px`,
    `height:${baseH}px`,
    `transform:scale(${scale})`,
    'transform-origin:top left',
    'pointer-events:none',
    'z-index:9999',
    'opacity:0.92',
    'transition:none',
    'margin:0'
  ].join(';');
  document.body.appendChild(_dragClone);
  _moveStickyClone(e.clientX, e.clientY);

  document.addEventListener('pointermove', _onStickyMove);
  document.addEventListener('keydown',     _onStickyKeyDown);
  // setTimeout으로 현재 클릭 이벤트가 끝난 뒤 document click 감지 시작
  setTimeout(() => {
    if (_stickyMode) document.addEventListener('click', _onStickyClick);
  }, 0);
}

/**
 * 사거리 표시 크기 — 맵 좌표 그대로 쓴다.
 * 표시가 타일 맵 안에 들어 있어서 화면 배율·맵 확대는 부모가 알아서 먹인다.
 */
function _applyCastArcSize() {
  if (!_castArc || !_castStyle) return;
  if (_castStyle.shape === 'towertile') { _onTowerTileMove(_lastPointer.x, _lastPointer.y); return; }
  if (_castStyle.shape === 'circle') { _onCircleMove(_lastPointer.x, _lastPointer.y); return; }
  if (_castStyle.shape === 'tile') { _onTileMove(_lastPointer.x, _lastPointer.y); return; }
  if (_castStyle.shape === 'area') { _onAreaMove(_lastPointer.x, _lastPointer.y); return; }
  if (_castStyle.shape === 'wave') { _onWaveMove(_lastPointer.x, _lastPointer.y); return; }
  if (_castStyle.shape === 'shot') { _onShotMove(_lastPointer.x, _lastPointer.y); return; }
  if (_castStyle.shape === 'summon') { _onSummonMove(_lastPointer.x, _lastPointer.y); return; }
  if (_castStyle.shape === 'nearest') { _onSawMove(_lastPointer.x, _lastPointer.y); return; }
  if (_castStyle.shape === 'throw' || _castStyle.shape === 'throw3') {
    // 바깥 상자는 화면 전체를 덮는다 — 커지는 것은 착지 원뿐이다
    if (_castLands) _castLands.querySelectorAll('.cast-throw-land').forEach(land => {
      land.style.width  = (TILE * (_castStyle.area ? _castStyle.cols : 1)) + 'px';
      land.style.height = (TILE * (_castStyle.area ? _castStyle.rows : 1)) + 'px';
    });
    return;
  }
  if (_castStyle.shape === 'lunge') {
    _castArc.style.width  = _castStyle.radius + 'px';
    _castArc.style.height = _castStyle.band   + 'px';
  } else {
    _castArc.style.width = _castArc.style.height = (_castStyle.radius * 2) + 'px';
  }
}

/**
 * 사거리 표시가 들어가는 것 — 바닥판(.ground) 안의 겹.
 *
 * 여기에 넣으면 브라우저가 타일과 똑같은 원근으로 그려 준다 — 바닥에 칠한
 * 무늬가 된다. 직접 눌러 흔내 내는 것보다 정확하고(먼 쪽이 좁아지는 것까지 맞는다),
 * 맵을 끌거나 확대해도 저절로 따라간다. 좌표는 맵 좌표(0..1600, 0..900)를 그대로 쓴다.
 *
 * 글자가 들어가는 표시(차징 게이지·피해 숫자)는 여기 넣으면 같이 찌그러진다 — 화면 고정으로 둠긴다.
 */
function _castGround() { return document.getElementById('cast-ground'); }

/**
 * 화면에 보이는 자리(_clientToStage 결과) → 바닥판 안에 놓을 좌표.
 *
 * 바닥판은 `perspective(d) rotateX(a)`로 눠어 있어서, 그 안에 넣은 것은 그 변환을
 * 한 번 더 먹는다. 커서가 가리키는 자리에 정확히 놓으려면 그 변환을 먼저 풀어야 한다.
 *
 *   눠힐 때:  Y = v·cos a · d/(d - v·sin a)
 *   푸는 식:  v = Y·d / (d·cos a + Y·sin a)
 *
 * 안 풀고 넣으면 아래쪽 줄에서 30px나 왼쪽으로 밀린다 — 돌 착지 원이 타워를 빗나간다.
 */
function _stageToGround(px, py) {
  const el = document.getElementById('tile-map');
  const cs = el ? getComputedStyle(el) : null;
  const a = (parseFloat(cs?.getPropertyValue('--field-tilt')) || 0) * Math.PI / 180;
  const d =  parseFloat(cs?.getPropertyValue('--field-depth')) || 1100;
  if (!a) return { x: px, y: py };
  const Y = py - MAP_H / 2;
  const v = Y * d / (d * Math.cos(a) + Y * Math.sin(a));
  const sc = d / (d - v * Math.sin(a));
  return { x: MAP_W / 2 + (px - MAP_W / 2) / sc, y: MAP_H / 2 + v };
}

/** _stageToGround의 반대 — 바닥판 안의 자리가 화면(스테이지)에서 보이는 자리 */
function _groundToStage(gx, gy) {
  const el = document.getElementById('tile-map');
  const cs = el ? getComputedStyle(el) : null;
  const a = (parseFloat(cs?.getPropertyValue('--field-tilt')) || 0) * Math.PI / 180;
  const d =  parseFloat(cs?.getPropertyValue('--field-depth')) || 1100;
  if (!a) return { x: gx, y: gy };
  const v  = gy - MAP_H / 2;
  const sc = d / (d - v * Math.sin(a));
  return { x: MAP_W / 2 + (gx - MAP_W / 2) * sc, y: MAP_H / 2 + v * Math.cos(a) * sc };
}

/** 화면(client) 좌표 → 바닥판 안에 놓을 좌표 */
function _clientToGround(cx, cy) {
  const p = _clientToStage(cx, cy);
  return _stageToGround(p.x, p.y);
}

/** 부채꼴 사거리를 커서 위치로 — 받는 것은 화면 좌표, 놓는 것은 맵 좌표 */
function _moveCastArc(cx, cy) {
  if (!_castArc) return;
  const p = _clientToGround(cx, cy);
  _castArc.style.left = p.x + 'px';
  _castArc.style.top  = p.y + 'px';
}

// ── 원형 설치 (토템) ────────────────────────────────────────
// 클릭한 자리에 그대로 설치된다. 원 안에 들어온 타워만 효과를 받으므로,
// 가운데 타워에 맞춰 놓아야 3개 모두 들어온다 (위/아래에 맞추면 2개만 들어온다).
let _castCircleHits = [];

/** 이 카드가 내 구역에 쓰는 카드인가 (회복·방어) */
function _castOwnSideCard() {
  const t = _boardCurrentCard?.type;
  return t === 'heal' || t === 'defense';
}

/**
 * 토템을 놓을 수 있는 칸인가.
 *
 * 자유로운 픽셀 배치를 그만두고 칸 단위로 맞춘다 — 어디에 놓았는지가
 * 눈으로 명확해지고, 맵 밖 검은 여백에 놓이는 일도 없어진다.
 * 조건은 세 가지: 필드 안 · 내 진영 · 타워가 서 있지 않은 칸.
 */
function totemTileOk(col, row) {
  if (col < 0 || row < 0 || col >= MAP_COLS || row >= MAP_ROWS) return false;
  const ownSide = _castOwnSideCard();
  if (ownSide ? col >= MAP_COLS / 2 : col < MAP_COLS / 2) return false;
  if (totemOnTile(col, row)) return false;           // 한 칸에 토템은 하나만
  return !_tileHasLiveTower(col, row);
}

// ── 칸마다 서 있는 토템 ──────────────────────────────────────
// 토템이 서 있는 칸에는 다른 토템을 못 세운다. 내가 세운 것이든 상대 화면에서 온 것이든
// 모두 playCastFx를 거치므로 거기서 적어 두면 된다 (칸 → 사라지는 시각).
const _totemTiles = {};

function _markTotemTile(col, row, ms) {
  _totemTiles[col + ',' + row] = Date.now() + ms;
}

/** 그 칸에 아직 토템이 서 있는가 */
function totemOnTile(col, row) {
  const until = _totemTiles[col + ',' + row];
  if (!until) return false;
  if (until > Date.now()) return true;
  delete _totemTiles[col + ',' + row];
  return false;
}

/**
 * 그 칸에 '살아 있는' 타워가 있는가.
 * 옆 타워가 무너지면 그 자리는 빈 땅이 된다 — 토템을 세울 수 있다.
 * (부활로 다시 서면 다시 막힌다. 토네이도는 예전 규칙 _tileHasTower 그대로)
 */
function _tileHasLiveTower(col, row) {
  return [...document.querySelectorAll('.tower')].some(el => {
    const st = el.style;
    if (Number(st.getPropertyValue('--col')) !== col) return false;
    if (Number(st.getPropertyValue('--row')) !== row) return false;
    if (el.classList.contains('destroyed')) return false;
    return _towerAlive(el.dataset.owner, el.dataset.pos);
  });
}

/** 원 안에 들어온 대상 타워 전부 — 기준은 커서가 아니라 '놓일 칸 한가운데'다 */
function _towersInTotemRange(p) {
  const list = [];
  document.querySelectorAll('.tower').forEach(el => {
    if (!canDropOnTower(el.dataset.owner, el.dataset.pos)) return;
    const c = _tileCenter(Number(el.style.getPropertyValue('--col')), Number(el.style.getPropertyValue('--row')));
    if (Math.hypot(c.x - p.x, c.y - p.y) <= _castStyle.radius) list.push(el);
  });
  return list;
}

/** 칸 한가운데의 맵 좌표 */
function _tileCenter(col, row) {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

function _clearCastHighlights() {
  _castCircleHits.forEach(el => el.classList.remove('drag-over', 'drag-over-heal'));
  _castCircleHits = [];
}

let _totemAim = null;   // { col, row, ok, point }

function _onCircleMove(cx, cy) {
  if (!_castArc) return;
  const { col, row } = _tileAt(cx, cy);
  const ok    = totemTileOk(col, row);
  const point = _tileCenter(col, row);
  const doomed = ok && totemBreakZoneAt(col, row);
  const hits  = ok && !doomed ? _towersInTotemRange(point) : [];
  _totemAim = { col, row, ok, point };

  // 둘 다 바닥판 안이라 논리 좌표를 그대로 쓴다 —
  // 브라우저가 타일과 똑같은 기울기로 누워 그려 준다
  const cell  = _castArc.querySelector('.cast-tile-cell');
  const reach = _castArc.querySelector('.cast-tile-reach');
  if (cell) {
    cell.style.width  = TILE + 'px';
    cell.style.height = TILE + 'px';
    cell.style.left   = point.x + 'px';
    cell.style.top    = point.y + 'px';
  }
  if (reach) {
    reach.style.width = reach.style.height = (_castStyle.radius * 2) + 'px';
    reach.style.left  = point.x + 'px';
    reach.style.top   = point.y + 'px';
  }

  const cls = _castOwnSideCard() ? 'drag-over-heal' : 'drag-over';
  _clearCastHighlights();
  hits.forEach(el => el.classList.add(cls));
  _castCircleHits = hits;
  _castArc.classList.toggle('cast-arc-ready', ok && hits.length > 0);
  _castArc.classList.toggle('cast-circle-bad', !ok || doomed);
}

// ── 투척 (돌) ───────────────────────────────────────────────
// 스페이스바를 꾹 누르면 원형 게이지가 차고, 마우스를 클릭하면 그만큼 세게 던진다.
let _throwChargeStart = 0;    // 누르기 시작한 시각 (0이면 누르고 있지 않음)
let _throwHeldMs      = 0;    // 지금까지 누적된 차징 시간 (떼었어도 남아 있다)
let _throwRaf         = 0;
let _throwPoint       = null; // 마지막 커서 위치 (화면 좌표)

// 예전엔 왼쪽 버튼 하나로 차징과 발사를 걸하니 맵 끌기를 막을 수밖에 없었다.
// 차징을 스페이스바로 오기면서 왼쪽 버튼은 '조준해서 던지기'에만 쓰이고,
// 차징 중에도 맵을 끌 수 있게 됐다.
//
// 누른 시간은 더해서 셀다 — 끊어 누른 것도 이어지므로, 반쯤 차해 놓고
// 천천히 조준하다가 다시 채울 수 있다.

/** 차징된 전체 시간 — 떼어 둔 만큼 + 지금 누르고 있는 만큼 */
function _throwHeldTotal() {
  return _throwHeldMs + (_throwChargeStart ? Date.now() - _throwChargeStart : 0);
}

/** 차징을 조금이라도 해 뇨는가 — 게이지를 보여 줄지 정하는 기준 */
function _throwCharged() { return _throwChargeStart > 0 || _throwHeldMs > 0; }

/** 던지는 쪽(내) 킹 타워의 화면 좌표 */
function _throwOriginClient() {
  const el = document.getElementById('tower-my-king');
  if (!el) return null;
  const r = (el.querySelector('.tower-block') || el).getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 지금 차징 단계 */
function _throwLevel() {
  return castChargeLevel(_castStyle, _throwHeldTotal());
}

/** 포물선 · 착지 원 · 게이지를 커서 자리에 다시 그린다 */
function _onThrowMove(cx, cy) {
  _throwPoint = { x: cx, y: cy };
  if (!_castArc) return;
  if (_castStyle?.area) { _onFireballMove(cx, cy); return; }

  const land  = _castLands && _castLands.querySelector('.cast-throw-land');
  const path  = _castArc.querySelector('.cast-throw-path');
  const from  = _throwOriginClient();

  // 착지 칸 — 바닥판 안이라 칸 한가운데 논리 좌표 그대로 (게이지는 HUD라 화면 좌표 — _drawChargeHud)
  const aim = _stoneTile(cx, cy);
  if (land)  { land.style.left = aim.center.x + 'px'; land.style.top = aim.center.y + 'px'; land.style.display = aim.onMap ? '' : 'none'; }

  // 포물선 — 던지는 쪽에서 커서까지. 가운데를 위로 끌어올린 2차 베지어
  if (path && from) {
    const mx = (from.x + cx) / 2, my = (from.y + cy) / 2;
    const lift = Math.min(300, 110 + Math.hypot(cx - from.x, cy - from.y) * 0.2) * _mapScale();
    path.setAttribute('d', `M ${from.x} ${from.y} Q ${mx} ${my - lift} ${cx} ${cy}`);
  }

  // 사거리 밖이거나 맞힐 타워가 없으면 표시로 알려 준다
  const fromStage = boardTowerCenterStage('my', 'king');
  const inReach  = aim.onMap && (!fromStage || Math.hypot(aim.stage.x - fromStage.x, aim.stage.y - fromStage.y) <= _castStyle.reach);
  // 그 칸에 선 타워만 맞는다
  const targets  = inReach ? aim.hits : [];
  _clearCastHighlights();
  targets.forEach(el => el.classList.add('drag-over'));
  _castCircleHits = targets;

  _castArc.classList.toggle('cast-arc-ready', targets.length > 0);
  _castArc.classList.toggle('cast-circle-bad', !inReach);
  // 착지 원은 바닥판 안의 다른 상자(.cast-lands)에 있다 — 거기에도 같은 상태를 달아야 색이 바뀐다
  // (예전엔 .cast-throw 아래 규칙만 있어서 준비·사거리 밖 색이 한 번도 적용되지 않았다)
  if (_castLands) {
    _castLands.classList.toggle('cast-arc-ready', targets.length > 0);
    _castLands.classList.toggle('cast-circle-bad', !inReach);
  }
  _drawChargeHud(_castArc, cx, cy);
}

/**
 * 차징 게이지 · 피해 숫자 · 조작 안내 (돌 · 화살 공통). HUD라 화면 좌표.
 * @param {HTMLElement} root 그 셋이 들어 있는 상자
 */
function _drawChargeHud(root, cx, cy) {
  if (!root || !_castStyle?.charge) return;
  const gauge = root.querySelector('.cast-throw-gauge');
  const dmgEl = root.querySelector('.cast-throw-dmg');
  if (gauge) { gauge.style.left = cx + 'px'; gauge.style.top = cy + 'px'; }
  if (dmgEl) { dmgEl.style.left = cx + 'px'; dmgEl.style.top = cy + 'px'; }

  // 게이지에 지금 단계의 피해를 띄운다 — 얼마나 더 눌러야 하는지 바로 보이게
  const lv   = _throwLevel();
  const c    = _castStyle.charge;
  const held = _throwCharged();
  if (gauge) {
    gauge.style.setProperty('--tick', (360 / c.steps).toFixed(2) + 'deg');   // 단계마다 눈금 하나
    const pct = Math.min(100, (_throwHeldTotal() / c.fullMs) * 100);
    gauge.style.setProperty('--charge', pct.toFixed(1));
    gauge.classList.toggle('charging', held);
    gauge.classList.toggle('full', lv >= c.steps);
  }
  if (dmgEl) {
    dmgEl.textContent = castChargeDamage(_castStyle, lv);
    dmgEl.classList.toggle('charging', held);
  }
  // 조작법이 바뀜으니 눈에 보이게 알려 준다 — 한 번 차기 시작하면 사라진다
  const hint = root.querySelector('.cast-throw-hint');
  if (hint) {
    // 커서를 따라다니면 조준하는 타워의 체력 숫자를 가린다 — 맵 아래 가운데에 둔다
    const vp = document.getElementById('map-viewport')?.getBoundingClientRect();
    if (vp) {
      hint.style.left = (vp.left + vp.width / 2) + 'px';
      hint.style.top  = (vp.bottom - 34) + 'px';
    }
    hint.classList.toggle('hidden', held);
  }
}

/** 차징이 바뀌었을 때 조준 표시를 다시 그린다 (돌 · 화살) */
function _chargeRedraw() {
  if (!_throwPoint) return;
  if (_castStyle?.shape === 'shot') _onShotMove(_throwPoint.x, _throwPoint.y);
  else _onThrowMove(_throwPoint.x, _throwPoint.y);
}

/**
 * 돌이 떨어질 칸 — 커서가 가리키는 타일 한 칸. 그 칸에 선(이 카드로 칠 수 있는) 타워가 맞는다.
 * @returns {{col,row,onMap,center,stage,hits}} center = 칸 한가운데(바닥 좌표), stage = 그 자리가 화면에 보이는 곳
 */
function _stoneTile(cx, cy) {
  const { col, row } = _tileAt(cx, cy);
  const onMap = col >= 0 && row >= 0 && col < MAP_COLS && row < MAP_ROWS;
  const center = _tileCenter(col, row);
  const hits = onMap ? [...document.querySelectorAll('.tower')].filter(el =>
    Number(el.style.getPropertyValue('--col')) === col && Number(el.style.getPropertyValue('--row')) === row &&
    canDropOnTower(el.dataset.owner, el.dataset.pos)) : [];
  return { col, row, onMap, center, stage: _groundToStage(center.x, center.y), hits };
}

function _throwTick() {
  if (!_throwChargeStart) return;
  _chargeRedraw();
  _throwRaf = requestAnimationFrame(_throwTick);
}

/** 스페이스바를 누름 — 차기 시작 (또는 끊어서 이어 더 차기) */
function _throwChargeKeyDown() {
  if (!_stickyMode || !_castStyle?.charge) return false;     // 차징이 있는 카드만 (돌 · 화살)
  if (_throwChargeStart) return true;                       // 이미 누르고 있다 (키 반복)
  if (_throwLevel() >= _castStyle.charge.steps) return true; // 이미 가득 찬 상태 — 더 채울 것이 없다
  _throwChargeStart = Date.now();
  cancelAnimationFrame(_throwRaf);
  _throwRaf = requestAnimationFrame(_throwTick);
  return true;
}

/** 스페이스바에서 손을 뗄 때 — 거기서 멈춰 둔다. 차오른 단계는 클릭할 때까지 그대로 남는다 */
function _throwChargeKeyUp() {
  if (!_throwChargeStart) return false;
  _throwHeldMs = Math.min(_castStyle?.charge?.fullMs ?? _throwHeldMs, _throwHeldTotal());
  _throwChargeStart = 0;
  cancelAnimationFrame(_throwRaf);
  _chargeRedraw();
  return true;
}

/** 마우스 클릭 — 지금 차 있는 단계대로 던진다 (한 번도 안 챠으면 0단계) */
function _throwFire(e) {
  if (!_stickyMode || _castStyle?.shape !== 'throw') return;
  if (_castStyle.area) { _fireballFire(e); return; }

  const lv = _throwLevel();
  _throwChargeStart = 0;
  _throwHeldMs      = 0;
  cancelAnimationFrame(_throwRaf);

  const st = _castStyle;
  const aim = _stoneTile(e.clientX, e.clientY);
  const p  = aim.stage;
  // 던지지 못하는 자리면 차징을 그대로 되돌린다 — 힘들여 모은 것을 헛되게 하지 않는다
  const revert = () => {
    _throwHeldMs = Math.min(st.charge.fullMs, castChargeHeldMs(st, lv));
    _onThrowMove(e.clientX, e.clientY);
  };
  const fromStage = boardTowerCenterStage('my', 'king');
  if (fromStage && Math.hypot(p.x - fromStage.x, p.y - fromStage.y) > st.reach) { revert(); return; }

  // 맵 위를 클릭한 것이 아니면 던지지 않는다 — 카드는 계속 들고 있는다.
  // 좌표만 보면 안 된다: 맵을 끌어 올리면 상단 HUD 자리가 맵 안 좌표로 계산된다
  if (!_castClickOnMap(e) || !aim.onMap) { revert(); return; }

  // 허공에도 던질 수 있다 — 착지 원 안에 타워가 없으면 그냥 빗나간다
  _castFireAt(e.clientX, e.clientY, aim.hits, {
    unitTiles: [[aim.col, aim.row]],   // 그 칸에 선 소환 유닛도 맞는다
    point:  aim.stage,           // 칸 한가운데 — 날아가는 돌은 화면(스테이지) 좌표로 그린다
    level:  lv,
    damage: castChargeDamage(st, lv),
    endMs:  castChargeEndMs(st, lv),
    castId: castFxId(_boardCurrentCard?.cast, lv)
  });
}

// ── 타일 설치 (토네이도) ────────────────────────────────────
// 커서가 있는 칸 한가운데에 딱 놓인다. 내 진영이어야 하고 타워가 선 칸에는 못 놓는다.
// 왼쪽(멀리)으로 갈수록 범위 원이 커져서, 어디에 놓으면 타워 둘을 맞히는지 눈으로 보인다.
let _tileAim = null;   // { col, row, ok, hits }

/** 커서가 가리키는 칸 */
function _tileAt(cx, cy) {
  // 바닥판은 기울어 있다 — 평면 좌표(_clientToStage)로 재면 먼 쪽 가장자리 밖의
  // 검은 여백이 0행으로 잡히고, 양 끝 열도 한 칸씩 밀린다. 눈에 보이는 칸을 재려면 풀어야 한다.
  const p = _clientToGround(cx, cy);
  return { col: Math.floor(p.x / TILE), row: Math.floor(p.y / TILE) };
}

function _onTileMove(cx, cy) {
  if (!_castArc) return;
  const { col, row } = _tileAt(cx, cy);
  const ok   = tornadoTileOk(col, row);
  const hits = ok ? tornadoTargets(col, row) : [];
  _tileAim = { col, row, ok, hits };

  // 바닥판 안에 그려서 칸을 재질 필요가 없다 — 논리 좌표를 그대로 쓰면
  // 브라우저가 타일과 똑같은 자리에 녹는다
  const cxPx = col * TILE + TILE / 2;
  const cyPx = row * TILE + TILE / 2;

  const cell  = _castArc.querySelector('.cast-tile-cell');
  const reach = _castArc.querySelector('.cast-tile-reach');
  const path  = _castArc.querySelector('.cast-tile-path');

  if (cell) {
    cell.style.width  = TILE + 'px';
    cell.style.height = TILE + 'px';
    cell.style.left   = cxPx + 'px';
    cell.style.top    = cyPx + 'px';
  }
  if (reach) {
    reach.style.width = reach.style.height = (tornadoRadius(col) * 2) + 'px';
    reach.style.left  = cxPx + 'px';
    reach.style.top   = cyPx + 'px';
  }
  // 나아갈 길 — 놓은 칸에서 가장 가까운 대상 타워까지
  if (path) {
    if (ok && hits.length) {
      const stopCol = Math.min(...hits.map(h => h.col));
      path.style.display = '';
      path.style.left   = cxPx + 'px';
      path.style.top    = cyPx + 'px';
      path.style.width  = ((stopCol - col) * TILE) + 'px';
      path.style.height = (tornadoRadius(col) * 2) + 'px';
    } else {
      path.style.display = 'none';
    }
  }

  _castArc.classList.toggle('cast-arc-ready', ok && hits.length > 0);
  _castArc.classList.toggle('cast-circle-bad', !ok);

  // 맞을 타워를 강조 — 둘이 닿으면 둘 다 빛난다
  _clearCastHighlights();
  const els = hits.map(h => document.getElementById(`tower-enemy-${h.pos}`)).filter(Boolean);
  els.forEach(el => el.classList.add('drag-over'));
  _castCircleHits = els;
}

/** 토네이도를 설치한다 */
function _tileFire(e) {
  if (!e.target?.closest?.('#map-viewport')) return;
  const aim = _tileAim;
  if (!aim || !aim.ok) return;                 // 못 놓는 칸 — 카드는 계속 들고 있는다
  const st   = _castStyle;
  const card = _boardCurrentCard;
  const slot = _boardDeckSlot;
  // 칸 한가운데 (스테이지 좌표)
  const point = { x: aim.col * TILE + TILE / 2, y: aim.row * TILE + TILE / 2 };
  const kingEl = document.getElementById('tower-enemy-king');
  const k = kingEl ? _towerCenterStage(kingEl) : point;
  const hits = aim.hits;
  _cancelStickyDrag();
  if (!card) return;
  onCardDropped(card, slot, 'enemy', 'king', {
    endMs:  st.endMs,
    castId: card.cast,
    point,
    dx: Math.round(point.x - k.x),
    dy: Math.round(point.y - k.y),
    unitTiles: _tornadoUnitTiles(aim.col, aim.row, hits),
    // 맞을 타워가 없으면 그냥 지나가며 아무 피해도 없다
    shots: hits.map(h => ({ pos: h.pos, flyMs: st.travelMs, damage: h.damage }))
  });
}

// ── 화살 (화살 · 사랑의 화살) ────────────────────────────────
// 커서 자리에 활이 서고, 앞으로 3칸 길이·1칸 폭의 일자 사거리로 쏜다.
// 화살은 날아가다 처음 닿는 타워 하나에 꽂힌다 — 거기까지 걸리는 시간이 곧 피해 시각이다
// (사거리 끝까지 늘 flyMs라 가까운 타워일수록 빨리 맞는다).
// 화살 표시는 바닥판 안(맵 좌표), 차징 게이지는 화면 고정(_castHud)이다.
let _shotAim = null;   // { a, dir, hit }
let _castHud = null;   // 차징 게이지 · 피해 숫자 · 조작 안내 (화면 고정 — 바닥판 안에 넣으면 글자가 찌그러진다)

const SHOT_LIFT = 26;  // 화살이 나는 높이 (화면 px) — 바닥에 붙여 날리면 미끄러지는 것처럼 보인다

/**
 * 쏘는 방향 — 상대 진영에서 쏘면 상대 쪽(오른쪽), 내 진영에서 쏘면 내 타워 쪽(왼쪽).
 * 사랑의 화살은 내 진영에서 쏘면 회복만 한다. 화살은 2026-10-02부터 내 진영에서도 왼쪽으로 쏜다 —
 * 내 타워는 맞지 않고(지나간다), 길에 선 상대 소환 유닛(그림리퍼)만 맞는다.
 */
function _shotDir(st, a) { return a.x < MAP_W / 2 ? -1 : 1; }

/**
 * 일자 사거리에서 화살이 처음 닿는 타워.
 * @param {{x,y}} a  활 자리 (바닥 좌표)
 * @param {number} dir ±1
 * @param {(el) => boolean} ok 칠 수 있는 타워인가
 * @returns {{el, owner, pos, dist}|null} dist = 활에서 그 타워 발밑 앞면까지 (이미 걸쳐 있으면 0)
 */
function castShotTarget(st, a, dir, ok) {
  let best = null;
  document.querySelectorAll('.tower').forEach(el => {
    if (!ok(el)) return;
    const f = _towerFootprint(el);
    if (Math.abs(f.y - a.y) > st.band / 2 + f.half) return;                  // 폭 밖
    const near = dir > 0 ? f.x - f.half - a.x : a.x - (f.x + f.half);         // 활에서 앞면까지
    const far  = dir > 0 ? f.x + f.half - a.x : a.x - (f.x - f.half);         // 활에서 뒷면까지
    if (far < 0 || near > st.radius) return;                                  // 활 뒤쪽이거나 사거리 밖
    const dist = Math.max(0, near);
    if (!best || dist < best.dist) best = { el, owner: el.dataset.owner, pos: el.dataset.pos, dist };
  });
  return best;
}

/** 그 거리까지 날아가는 시간 — 사거리 끝까지가 flyMs */
function castShotFlyMs(st, dist) {
  return Math.max(60, Math.round(st.flyMs * Math.min(dist, st.radius) / st.radius));
}

function _onShotMove(cx, cy) {
  _throwPoint = { x: cx, y: cy };
  if (!_castArc) return;
  const st  = _castStyle;
  const g   = _clientToGround(cx, cy);
  const a   = { x: Math.round(g.x), y: Math.round(g.y) };   // 보내는 값과 똑같이 — 반올림 차이로 맞는 타워가 갈리지 않게
  const dir = _shotDir(st, a);
  const hit = castShotTarget(st, a, dir, el => canDropOnTower(el.dataset.owner, el.dataset.pos));
  _shotAim = { a, dir, hit };

  // 왼쪽으로 쏠 때는 상자를 활 왼쪽에 두고 좌우를 뒤집는다 (길의 진한 쪽이 늘 활 쪽)
  _castArc.style.left   = (dir > 0 ? a.x : a.x - st.radius) + 'px';
  _castArc.style.top    = a.y + 'px';
  _castArc.style.width  = st.radius + 'px';
  _castArc.style.height = st.band + 'px';
  _castArc.classList.toggle('cast-shot-left', dir < 0);

  _clearCastHighlights();
  if (hit) {
    hit.el.classList.add(hit.owner === 'my' ? 'drag-over-heal' : 'drag-over');
    _castCircleHits = [hit.el];
  }
  _castArc.classList.toggle('cast-arc-ready', !!hit);
  _drawChargeHud(_castHud, cx, cy);
}

function _shotFire(e) {
  if (!_castClickOnMap(e)) return;              // 맵 밖 클릭 — 카드는 계속 들고 있는다
  _onShotMove(e.clientX, e.clientY);
  const aim = _shotAim;
  if (!aim) return;
  const st   = _castStyle;
  const card = _boardCurrentCard;
  const slot = _boardDeckSlot;
  const lv   = st.charge ? _throwLevel() : 0;
  const hit  = aim.hit;
  // 허공이면 쏜 방향의 진영으로 (사랑의 화살을 내 진영에서 쏘면 '내 쪽에 쏜 것')
  const owner = hit ? hit.owner : (aim.dir < 0 ? 'my' : 'enemy');
  const heal  = !!st.love && owner === 'my';
  const flyMs = castShotFlyMs(st, hit ? hit.dist : st.radius) + (heal && hit ? st.healBurstMs : 0);
  const point = aim.a;
  const kingEl = document.getElementById(`tower-${owner}-king`);
  const k = kingEl ? _towerCenterStage(kingEl) : point;
  _cancelStickyDrag();
  if (!card) return;
  const row = Math.floor(point.y / TILE);
  const c0 = Math.floor(point.x / TILE), c1 = Math.floor((point.x + aim.dir * (hit ? hit.dist : st.radius)) / TILE);
  const unitTiles = [];
  if (!heal) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) unitTiles.push([c, row]);
  onCardDropped(card, slot, owner, hit ? hit.pos : 'king', {
    positions: hit ? [hit.pos] : [],
    unitTiles,
    point,
    dx: Math.round(point.x - k.x),
    dy: Math.round(point.y - k.y),
    // 화살은 차징 단계, 사랑의 화살은 '회복이냐'(1)를 연출 id에 붙여 보낸다.
    // 내 진영에서 쏜 화살은 '@o'를 더 붙인다 — 받는 화면이 내 타워에 꽂지 않고 사거리 끝까지 날린다
    castId: st.charge && owner === 'my' ? `${card.cast}@${lv}@o` : castFxId(card.cast, st.charge ? lv : (heal ? 1 : 0)),
    endMs:  flyMs + 400,
    ...(st.charge ? { damage: castChargeDamage(st, lv) } : {})
  });
}

/**
 * 화살 연출 — 모든 화면이 같은 활 자리에서 같은 타워를 골라 같은 시간에 꽂는다.
 * @param {{x,y}|null} stagePoint 활 자리 (바닥 좌표). 없으면(AI) 그 타워 앞 1.8칸에서 쏜다
 * @param {number} level 화살은 차징 단계, 사랑의 화살은 1이면 회복
 * @returns {number} 꽂히는 시각(ms)
 */
function _playShotFx(style, owner, pos, stagePoint, level, own = false) {
  // 맞는 쪽이 화면 오른쪽(enemy)이면 오른쪽으로 — 상대·관전 화면에서도 저절로 맞다
  const dir = owner === 'enemy' ? 1 : -1;
  let a = stagePoint ? { x: stagePoint.x, y: stagePoint.y } : null;
  if (!a) {
    const t = _towerTile(owner, pos);
    if (!t) return style.hitMs;
    const c = _tileCenter(t.col, t.row);
    a = { x: c.x - dir * style.radius * 0.6, y: c.y };
  }
  // 자기 진영에 쏜 화살은 자기 타워에 꽂히지 않는다 (사거리 끝까지 — 길의 상대 유닛만 맞는다)
  const hit   = own && !style.love ? null
              : castShotTarget(style, a, dir, el => el.dataset.owner === owner && _towerAlive(owner, el.dataset.pos));
  const dist  = hit ? hit.dist : style.radius;
  const flyMs = castShotFlyMs(style, dist);
  const heal  = !!style.love && level === 1;
  _shotVisual(style, a, dir, dist, flyMs, hit, style.love ? 0 : level, heal);

  if (style.love && hit) {
    if (heal) {
      // 꽂히면 타워 위에 하트가 부풀어 오르고, 터지는 순간 회복이 들어간다
      const burst = style.healBurstMs || 0;
      setTimeout(() => {
        if (!(typeof towers3dLoveHeal === 'function' && towers3dLoveHeal(hit.owner, hit.pos, burst))) {
          setTimeout(() => _loveHeartFlat(hit.owner, hit.pos, true), burst);
        }
      }, flyMs);
      return flyMs + burst;
    }
    if (!(typeof towers3dLoveBreak === 'function' && towers3dLoveBreak(hit.owner, hit.pos, flyMs))) {
      setTimeout(() => _loveHeartFlat(hit.owner, hit.pos, false), flyMs);
    }
  }
  return flyMs;
}

/** 활 — 당겨진 채 나타나 시위를 놓고, 반동으로 살짝 밀렸다가 사라진다 */
function _spawnBow(S, dir, love, level) {
  const wrap = document.createElement('div');
  wrap.className = 'fx-bow' + (love ? ' fx-bow-love' : '') + (level >= 3 ? ' fx-bow-charged' : '');
  // 당긴 시위 끝(-46,0)이 화살 꼬리에 오도록 — 화살 촉이 손잡이 앞으로 37px 나온다
  wrap.style.left = (S.x - dir * 52) + 'px';
  wrap.style.top  = (S.y - SHOT_LIFT) + 'px';
  const limbDrawn = 'M -14,-60 C 10,-50 24,-24 24,0 C 24,24 10,50 -14,60';
  const limbRest  = 'M -8,-60 C 12,-48 20,-22 20,0 C 20,22 12,48 -8,60';
  const str = x => `M -14,-60 L ${x},0 L -14,60`;
  const strRest = x => `M -8,-60 L ${x},0 L -8,60`;
  const wood = love ? ['#ffd6e7', '#ff6fa8', '#b8326c'] : ['#e7b77a', '#a8692e', '#5e3715'];
  wrap.innerHTML = `
    <svg viewBox="-60 -70 120 140" width="84" height="98" style="transform: scaleX(${dir})">
      <defs><linearGradient id="bowg${love ? 'l' : 'w'}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${wood[0]}"/><stop offset="0.5" stop-color="${wood[1]}"/><stop offset="1" stop-color="${wood[2]}"/>
      </linearGradient></defs>
      <path class="bow-string" d="${str(-46)}" fill="none" stroke="${love ? '#fff0f6' : '#f4efe4'}" stroke-width="1.8" stroke-linejoin="round">
        <animate attributeName="d" begin="indefinite" dur="0.34s" fill="freeze"
          values="${str(-46)};${strRest(2)};${strRest(-15)};${strRest(-5)};${strRest(-8)}" keyTimes="0;0.25;0.5;0.75;1"/>
      </path>
      <path d="${limbDrawn}" fill="none" stroke="url(#bowg${love ? 'l' : 'w'})" stroke-width="7" stroke-linecap="round">
        <animate attributeName="d" begin="indefinite" dur="0.34s" fill="freeze" values="${limbDrawn};${limbRest}"/>
      </path>
      ${love
        ? '<path d="M 22,-2 C 22,-9 31,-9 31,-3 C 31,3 24,6 22,10 C 20,6 13,3 13,-3 C 13,-9 22,-9 22,-2 Z" fill="#ff3d86" stroke="#fff" stroke-width="1.2"/>'
        : '<rect x="18" y="-11" width="10" height="22" rx="3" fill="#d9a441" stroke="#6b4a14" stroke-width="1.2"/>'}
    </svg>`;
  _fxLayer().appendChild(wrap);
  wrap.querySelectorAll('animate').forEach(an => { try { an.beginElement(); } catch (e) {} });
  wrap.animate([
    { opacity: 0, transform: 'translate(-50%, -50%) scale(0.85)' },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.06 },
    { opacity: 1, transform: `translate(calc(-50% + ${-dir * 9}px), -50%) scale(1)`, offset: 0.16 },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.4 },
    { opacity: 0, transform: `translate(calc(-50% + ${-dir * 4}px), -50%) scale(0.96)` }
  ], { duration: 700, easing: 'ease-out', fill: 'forwards' });
  setTimeout(() => wrap.remove(), 720);
}

/** 화살 한 대 (촉이 (0,0), 꼬리가 -x) */
function _arrowSvg(love) {
  return love
    ? `<svg viewBox="-96 -14 104 28" width="104" height="28" style="left:-96px;top:-14px">
        <line x1="-82" y1="0" x2="-10" y2="0" stroke="#ffe3ee" stroke-width="3" stroke-linecap="round"/>
        <path d="M 6,0 C -1,-2 -6,-9 -11,-8 C -16,-7 -16,-1 -14,0 C -16,1 -16,7 -11,8 C -6,9 -1,2 6,0 Z" fill="#ff3d86" stroke="#fff" stroke-width="1.2"/>
        <path d="M -70,0 L -88,-9 L -82,0 L -88,9 Z M -78,0 L -94,-7 L -90,0 L -94,7 Z" fill="#ff8fbe"/>
      </svg>`
    : `<svg viewBox="-96 -14 104 28" width="104" height="28" style="left:-96px;top:-14px">
        <defs><linearGradient id="arrhead" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f7fb"/><stop offset="1" stop-color="#8d97a8"/></linearGradient></defs>
        <line x1="-84" y1="0" x2="-8" y2="0" stroke="#c89660" stroke-width="3" stroke-linecap="round"/>
        <path d="M 6,0 L -12,-6.5 L -8,0 L -12,6.5 Z" fill="url(#arrhead)" stroke="#3c4250" stroke-width="1"/>
        <path d="M -72,0 L -90,-8 L -84,0 L -90,8 Z" fill="#e2493f"/>
        <path d="M -80,0 L -95,-6 L -91,0 L -95,6 Z" fill="#f3efe6"/>
      </svg>`;
}

/**
 * 화살이 꽂힐 자리 — 맞은 타워 앞면의 한가운데 (화면 좌표).
 * 어느 방향·어느 높이에서 쐈든 꽂히는 곳은 늘 여기다. 3D 모형이 있으면 그 몸통 한가운데를 카메라로 투영하고,
 * 없으면 타워 칸 한가운데에서 조금 위.
 */
function _shotStickPoint(owner, pos) {
  const p = typeof towers3dTowerPoint === 'function' ? towers3dTowerPoint(owner, pos, 0.5) : null;
  if (p) return p;
  const c = boardTowerCenterStage(owner, pos);
  return c ? { x: c.x, y: c.y - 34 } : null;
}

/**
 * 활 · 날아가는 화살 · 바닥 그림자 · 꽂힘(또는 땅에 박힘).
 * 맞으면: 활에서 그 타워 앞면 한가운데로 곧장 날아가(그 방향으로 기울어) 촉이 벽에 박히고 부르르 떤다.
 * 허공이면: 사거리 끝까지 날아가 땅에 박힌다.
 * @param {{x,y}} a 활 자리 (바닥 좌표)
 * @param {{owner,pos}|null} hit 맞는 타워
 */
function _shotVisual(st, a, dir, dist, flyMs, hit, level, heal) {
  const layer = _fxLayer();
  const S = _groundToStage(a.x, a.y);
  const love = !!st.love;
  _spawnBow(S, dir, love, level);

  // 날아가는 길 — 활의 시위 높이에서 출발
  const P0 = { x: S.x, y: S.y - SHOT_LIFT };
  const stick = hit ? _shotStickPoint(hit.owner, hit.pos) : null;
  let E = stick;
  if (!E) { const g = _groundToStage(a.x + dir * dist, a.y); E = { x: g.x, y: g.y - SHOT_LIFT }; }
  const dx = E.x - P0.x, dy = E.y - P0.y;
  // 기울기 — 안쪽 상자는 scaleX(dir)로 좌우를 뒤집은 뒤 돌리므로 각도도 뒤집힌 x로 잰다
  const ang = Math.atan2(dy, dx * dir) * 180 / Math.PI;
  const pose = (extra = 0) => `scaleX(${dir}) rotate(${(ang + extra).toFixed(2)}deg)`;

  const arrow = document.createElement('div');
  arrow.className = 'fx-arrow' + (love ? ' fx-arrow-love' : '') + (level >= 3 ? ' fx-arrow-charged' : '');
  arrow.style.left = P0.x + 'px';
  arrow.style.top  = P0.y + 'px';
  arrow.style.setProperty('--glow', (0.25 + level * 0.12).toFixed(2));
  arrow.innerHTML = `<div class="fx-arrow-body" style="transform: ${pose()}">
    <div class="fx-arrow-trail"></div>${_arrowSvg(love)}</div>`;
  layer.appendChild(arrow);
  arrow.animate([{ transform: 'translate(0, 0)' }, { transform: `translate(${dx}px, ${dy}px)` }],
                { duration: flyMs, easing: 'linear', fill: 'forwards' });
  arrow.querySelector('.fx-arrow-trail')?.animate(
    [{ transform: 'scaleX(0.15)', opacity: 0.4 }, { transform: 'scaleX(1)', opacity: 1 }],
    { duration: Math.min(180, flyMs), easing: 'ease-out', fill: 'forwards' });

  // 바닥 그림자 — 화살이 떠서 난다는 것을 보여 준다. 맞으면 그 타워 발밑으로 모여든다
  const ground = _castGround();
  let shadow = null;
  if (ground) {
    const foot = hit ? _towerTile(hit.owner, hit.pos) : null;
    const end = foot ? { x: foot.col * TILE + TILE / 2 - dir * 30, y: foot.row * TILE + TILE / 2 }
                     : { x: a.x + dir * dist, y: a.y };
    shadow = document.createElement('div');
    shadow.className = 'fx-arrow-shadow';
    shadow.style.left = (a.x - 35) + 'px';
    shadow.style.top  = a.y + 'px';
    ground.appendChild(shadow);
    shadow.animate([{ transform: 'translate(0, -50%)' },
                    { transform: `translate(${end.x - a.x}px, calc(-50% + ${end.y - a.y}px))` }],
                   { duration: flyMs, easing: 'linear', fill: 'forwards' });
  }

  // 날아간 자리를 따라 반짝이 — 가득 찬 화살은 금빛, 사랑의 화살은 분홍 하트
  const len = Math.hypot(dx, dy);
  const sparkN = love ? Math.max(2, Math.round(len / 34)) : (level >= 3 ? Math.max(2, Math.round(len / 30)) : 0);
  for (let i = 1; i <= sparkN; i++) {
    const q = i / (sparkN + 1);
    const back = 30 / (len || 1);                     // 촉보다 조금 뒤에서 — 꼬리를 따라 흩어진다
    const sp = document.createElement('div');
    sp.className = 'fx-arrow-spark' + (love ? ' fx-arrow-spark-love' : '');
    sp.style.left = (P0.x + dx * (q - back)) + 'px';
    sp.style.top  = (P0.y + dy * (q - back) + ((i % 2) ? -6 : 5)) + 'px';
    layer.appendChild(sp);
    sp.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(0.3)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.2 },
      { opacity: 0, transform: `translate(-50%, calc(-50% - ${love ? 16 : 8}px)) scale(0.6)` }
    ], { duration: 520, delay: flyMs * q, easing: 'ease-out', fill: 'both' });
    setTimeout(() => sp.remove(), flyMs * q + 560);
  }

  setTimeout(() => {
    shadow?.remove();
    const body = arrow.querySelector('.fx-arrow-body');
    // 꼬리 빛줄기를 끈다 — 자라나는 애니메이션이 fill:forwards로 불투명도를 붙들고 있어서
    // style.opacity로는 안 꺼진다 (애니메이션 값이 인라인 스타일을 이긴다). 뒤에 건 애니메이션이 이긴다
    arrow.querySelector('.fx-arrow-trail')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    if (hit) {
      // 쿵 — 촉이 벽 속으로 조금 더 들어가며(촉은 가려진다) 꽂히고, 꼬리가 부르르 떤다
      const ux = dx / (len || 1), uy = dy / (len || 1);
      arrow.animate([{ transform: `translate(${dx}px, ${dy}px)` },
                     { transform: `translate(${dx + ux * 7}px, ${dy + uy * 7}px)` }],
                    { duration: 70, easing: 'ease-out', fill: 'forwards' });
      arrow.classList.add('fx-arrow-stuck');
      body?.animate([
        { transform: pose(0) }, { transform: pose(-6) }, { transform: pose(4.5) },
        { transform: pose(-3) }, { transform: pose(1.5) }, { transform: pose(0) }
      ], { duration: 420, easing: 'ease-out' });
      // 박힌 자리 — 움푹 팬 자국과 짧은 불똥
      const mark = document.createElement('div');
      mark.className = 'fx-arrow-mark';
      mark.style.left = E.x + 'px';
      mark.style.top  = E.y + 'px';
      layer.insertBefore(mark, arrow);
      setTimeout(() => mark.remove(), 900);
      const burst = document.createElement('div');
      burst.className = 'fx-arrow-hit' + (love ? ' fx-arrow-hit-love' : '') + (heal ? ' fx-arrow-hit-heal' : '');
      burst.style.left = E.x + 'px';
      burst.style.top  = E.y + 'px';
      layer.appendChild(burst);
      setTimeout(() => burst.remove(), 460);
    } else {
      // 허공 — 사거리 끝에서 고개를 숙여 땅에 박힌다
      arrow.animate([{ transform: `translate(${dx}px, ${dy}px)` },
                     { transform: `translate(${dx}px, ${dy + SHOT_LIFT * 0.8}px)` }],
                    { duration: 170, easing: 'ease-in', fill: 'forwards' });
      body?.animate([{ transform: pose(0) }, { transform: pose(16) }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
      _spawnDust(E.x, E.y + SHOT_LIFT - 4, 46, 150, 520);
    }
    const stay = hit ? 620 : 520;                    // 꽂힌 화살은 잠깐 박혀 있다가 사라진다
    arrow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: stay, fill: 'forwards' });
    setTimeout(() => arrow.remove(), stay + 300);
  }, flyMs);
}

/** WebGL이 없을 때의 하트 (평면) — 회복은 커지며 빛나고, 공격은 갈라져 떨어진다 */
function _loveHeartFlat(owner, pos, heal) {
  const c = boardTowerCenterStage(owner, pos);
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'fx-love-flat' + (heal ? ' heal' : ' break');
  el.textContent = heal ? '\u{1F496}' : '\u{1F494}';
  el.style.left = c.x + 'px';
  el.style.top  = (c.y - 40) + 'px';
  _fxLayer().appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

// ── 칸 범위 (지진 · 붕괴) ────────────────────────────────────
// 커서가 가리키는 칸을 가운데로 cols×rows 칸이 범위다. 칸에 딱 맞춰 놓이고,
// 맵 가장자리에 가까우면 범위가 잘리지 않고 안쪽으로 밀려 들어온다 (항상 제 크기).
// 범위 안 칸에 선 타워는 전부 맞는다. 허공(맞을 타워가 없는 자리)에도 쓸 수 있다.
let _areaAim = null;   // { col, row, rect, ok, hits }

/** 그 타워가 선 칸 */
function _towerTile(owner, pos) {
  const el = document.getElementById(`tower-${owner}-${pos}`);
  if (!el) return null;
  const col = Number(el.style.getPropertyValue('--col')), row = Number(el.style.getPropertyValue('--row'));
  return Number.isFinite(col) && Number.isFinite(row) ? { col, row } : null;
}

/** 가운데 칸 → 범위 칸 (양 끝 포함). 세로가 맵보다 크면(붕괴 10칸) 맵 세로 전체가 된다 */
function castAreaRect(st, col, row) {
  const cols = Math.min(st.cols, MAP_COLS), rows = Math.min(st.rows, MAP_ROWS);
  const c0 = Math.max(0, Math.min(MAP_COLS - cols, col - Math.floor(cols / 2)));
  const r0 = Math.max(0, Math.min(MAP_ROWS - rows, row - Math.floor(rows / 2)));
  return { c0, r0, c1: c0 + cols - 1, r1: r0 + rows - 1 };
}

function _inRect(R, col, row) {
  return col >= R.c0 && col <= R.c1 && row >= R.r0 && row <= R.r1;
}

/** 범위 칸에 선 타워 — mustTarget이면 이 카드로 칠 수 있는 타워만 (조준용) */
function _towersInRect(R, mustTarget) {
  return [...document.querySelectorAll('.tower')].filter(el => {
    const col = Number(el.style.getPropertyValue('--col')), row = Number(el.style.getPropertyValue('--row'));
    if (!_inRect(R, col, row)) return false;
    return mustTarget ? canDropOnTower(el.dataset.owner, el.dataset.pos) : _towerAlive(el.dataset.owner, el.dataset.pos);
  });
}

function _onAreaMove(cx, cy) {
  if (!_castArc) return;
  let { col, row } = _tileAt(cx, cy);
  const onMap = col >= 0 && row >= 0 && col < MAP_COLS && row < MAP_ROWS;
  // 가시(2×2) — 커서에 가장 가까운 칸 꼭짓점을 가운데로 (커서가 든 칸이 늘 범위 안이다)
  if (_castStyle.thorn || _castStyle.ice) {
    const g = _clientToGround(cx, cy);
    col = Math.round(g.x / TILE);
    row = Math.round(g.y / TILE);
  }
  const rect  = castAreaRect(_castStyle, col, row);
  const hits  = onMap ? _towersInRect(rect, true) : [];
  // 침수는 2026-10-02부터 아무 진영에나 놓는다 (내 진영의 그림리퍼를 잡거나, 내 타워에 붙은 불을 끄려고).
  // 내 타워는 물에 맞지 않는다 — 피해는 상대 타워 · 상대 유닛에만
  const blocked = false;
  _areaAim = { col, row, rect, ok: onMap && !blocked, hits };

  // 바닥판 안이라 논리 좌표를 그대로 쓴다 — 타일 격자와 한 치도 안 어긋난다
  _castArc.style.left   = (rect.c0 * TILE) + 'px';
  _castArc.style.top    = (rect.r0 * TILE) + 'px';
  _castArc.style.width  = ((rect.c1 - rect.c0 + 1) * TILE) + 'px';
  _castArc.style.height = ((rect.r1 - rect.r0 + 1) * TILE) + 'px';
  _castArc.style.display = onMap ? '' : 'none';

  _clearCastHighlights();
  hits.forEach(el => el.classList.add('drag-over'));
  _castCircleHits = hits;
  _castArc.classList.toggle('cast-arc-ready', hits.length > 0 && !blocked);
  _castArc.classList.toggle('cast-circle-bad', blocked);
}

function _areaFire(e) {
  if (!_castClickOnMap(e)) return;             // 맵 밖 클릭 — 카드는 계속 들고 있는다
  _onAreaMove(e.clientX, e.clientY);
  const aim = _areaAim;
  if (!aim || !aim.ok) return;
  const card = _boardCurrentCard;
  const slot = _boardDeckSlot;
  const R = aim.rect;
  // 범위 한가운데 (바닥 좌표). 상대 화면은 좌우가 뒤집히므로 맞는 쪽 킹 타워 기준으로 보낸다 (토템과 같은 방식).
  // 가로가 홀수면 가운데 칸 한가운데, 짝수(침수 4칸)면 가운데 두 칸 사이의 금 —
  // 칸 한가운데를 보내면 뒤집었을 때 한 칸 어긋난다 (받는 쪽 _playAreaFx가 반올림해 같은 범위를 만든다)
  const cols = R.c1 - R.c0 + 1, rows = R.r1 - R.r0 + 1;
  const mid = _tileCenter(R.c0 + Math.floor((cols - 1) / 2), R.r0 + Math.floor((rows - 1) / 2));
  // 세로도 짝수(가시 2칸)면 가운데 두 줄 사이의 금 — 받는 쪽이 반올림해 같은 줄을 얻는다
  const point = { x: cols % 2 ? mid.x : (R.c0 + cols / 2) * TILE, y: rows % 2 ? mid.y : (R.r0 + rows / 2) * TILE };
  const kingEl = document.getElementById('tower-enemy-king');
  const k = kingEl ? _towerCenterStage(kingEl) : point;
  const positions = aim.hits.filter(el => el.dataset.owner === 'enemy').map(el => el.dataset.pos);
  _cancelStickyDrag();
  if (!card) return;
  // 침수 — 물살이 줄마다 다른 시각에 닿고, 다 흐른 뒤 가라앉는 동안 틱마다
  // 가시 — 솟는 순간 45, 박힌 채로 틱마다 7
  if (CAST_STYLES[card.cast]?.flood || CAST_STYLES[card.cast]?.thorn || CAST_STYLES[card.cast]?.blast || CAST_STYLES[card.cast]?.ice) {
    const st = CAST_STYLES[card.cast];
    const targets = aim.hits.filter(el => el.dataset.owner === 'enemy')
      .map(el => ({ pos: el.dataset.pos, row: Number(el.style.getPropertyValue('--row')) }));
    const plan = st.flood ? castFloodPlan(st, R, targets)
               : st.blast ? castHeatwavePlan(st, R, targets)
               : st.ice   ? castIcePlan(st, R, targets)
               : castThornPlan(st, R, targets);
    if (st.blast) boardWriteHeatZone(st, R, _boardPlayerKey);
    onCardDropped(card, slot, 'enemy', positions[0] || 'king', {
      positions, point, endMs: st.blast ? st.hitMs + st.burnMs : st.ice ? st.hitMs + 600 : st.endMs, castId: card.cast,
      dx: Math.round(point.x - k.x), dy: Math.round(point.y - k.y),
      shots: plan.shots, unitStrikes: plan.unitStrikes,
    });
    return;
  }
  const unitTiles = [];
  for (let c = R.c0; c <= R.c1; c++) for (let r = R.r0; r <= R.r1; r++) unitTiles.push([c, r]);
  onCardDropped(card, slot, 'enemy', positions[0] || 'king', {
    positions,
    unitTiles,
    point,
    dx: Math.round(point.x - k.x),
    dy: Math.round(point.y - k.y)
  });
}

// ════════════════════════════════════════════════════════════
//  파도 — 조준 · 쓰기 · 연출
// ════════════════════════════════════════════════════════════
let _waveAim = null;   // { c0, ok, plan }

/** AI가 파도를 놓는 자리 — 상대 진영 맨 앞 3칸 (뒤끝 열) */
const WAVE_START_COL = MAP_COLS / 2;

/**
 * 파도를 놓는 자리 — 2026-10-02부터 아무 열에나 (커서가 띠 한가운데). 늘 상대 진영 끝으로 밀려간다.
 * 내 진영에서 출발하면 내 타워는 맞지 않고, 지나가며 내 진영의 상대 그림리퍼를 치고 내 타워에 붙은 불을 끈다.
 * (예전엔 내 토템에 물을 끼얹어 회복 버프를 남용할까 봐 상대 진영 맨 앞만 허용했다 — 이제 물 버프는 상대 회복에만 걸린다)
 */
function _onWaveMove(cx, cy) {
  if (!_castArc) return;
  const st = _castStyle;
  const { col, row } = _tileAt(cx, cy);
  const c0 = Math.max(0, Math.min(MAP_COLS - st.cols - 1, col - Math.floor(st.cols / 2)));
  const ok = col >= 0 && col < MAP_COLS && row >= 0 && row < MAP_ROWS;
  const plan = ok ? castWavePlan(st, c0, pos => _towerAlive('enemy', pos)) : null;
  _waveAim = { c0, ok, plan };

  const band = _castArc.querySelector('.cast-wave-band');
  const path = _castArc.querySelector('.cast-wave-path');
  const H = MAP_ROWS * TILE;
  band.style.left = (c0 * TILE) + 'px';
  band.style.width = (st.cols * TILE) + 'px';
  band.style.height = H + 'px';
  path.style.left = ((c0 + st.cols) * TILE) + 'px';
  path.style.width = ((MAP_COLS - c0 - st.cols) * TILE) + 'px';
  path.style.height = H + 'px';
  _castArc.style.display = (col >= 0 && col < MAP_COLS) ? '' : 'none';

  _clearCastHighlights();
  const els = ok ? Object.keys(plan.hit).map(p => document.getElementById(`tower-enemy-${p}`)).filter(Boolean) : [];
  els.forEach(el => el.classList.add('drag-over'));
  _castCircleHits = els;
  _castArc.classList.toggle('cast-arc-ready', ok && els.length > 0);
  _castArc.classList.toggle('cast-circle-bad', !ok);
}

function _waveFire(e) {
  if (!_castClickOnMap(e)) return;
  _onWaveMove(e.clientX, e.clientY);
  const aim = _waveAim;
  if (!aim || !aim.ok) return;                 // 맵 밖 — 카드는 계속 들고 있는다
  const st = _castStyle;
  const card = _boardCurrentCard;
  const slot = _boardDeckSlot;
  // 띠 한가운데 칸 (폭이 홀수라 칸 한가운데) — 상대 화면은 좌우를 뒤집어 같은 띠를 만든다
  const point = _tileCenter(aim.c0 + Math.floor(st.cols / 2), Math.floor(MAP_ROWS / 2));
  const kingEl = document.getElementById('tower-enemy-king');
  const k = kingEl ? _towerCenterStage(kingEl) : point;
  _cancelStickyDrag();
  if (!card) return;
  onCardDropped(card, slot, 'enemy', 'king', {
    endMs: aim.plan.endMs, castId: card.cast, point,
    dx: Math.round(point.x - k.x), dy: Math.round(point.y - k.y),
    shots: aim.plan.shots, unitStrikes: aim.plan.unitStrikes,
  });
}

/**
 * 파도 연출. owner = 맞는 쪽 — 'enemy'면 이 화면의 오른쪽으로, 'my'면 왼쪽으로 밀려온다.
 *   솟구침 (riseMs) — 바닥에서 물이 치솟으며 물보라가 터지고 필드가 울린다
 *   밀려감         — 말린 물마루가 물보라를 흩뿌리며 맵 끝까지
 *   잦아듦         — 끝에 닿아 부서지고, 고인 물이 잔잔해지다 말라 사라진다
 */
function _playWaveFx(style, owner, stagePoint) {
  const dir = owner === 'my' ? -1 : 1;
  const half = Math.floor(style.cols / 2);
  // 놓는 자리는 맞는 쪽 진영 맨 앞 (WAVE_START_COL) — 점이 없으면 그 자리
  const pc = stagePoint ? Math.floor(stagePoint.x / TILE) : (dir > 0 ? MAP_COLS / 2 + half : MAP_COLS / 2 - 1 - half);
  const c0 = dir > 0 ? pc - half : (MAP_COLS - 1 - pc) - half;          // 쓰는 사람 시점의 뒤끝 열
  const travelMs = waveTravelMs(style, c0);
  const backX = dir > 0 ? (pc - half) * TILE : (pc + half + 1) * TILE;   // 이 화면의 뒤끝 (맵 px)
  const opts = { backX, dir, width: style.cols * TILE, riseMs: style.riseMs, travelMs,
                 speedPx: style.speed * TILE, calmMs: style.calmMs };
  const in3d = typeof towers3dWave === 'function' && towers3dWave(opts);
  _waterZoneAdd({ victim: owner, kind: 'wave', start: gameNow(), ...opts });
  _waveGround(opts, !in3d);
  // 솟구치는 순간 필드가 울린다
  const map = document.querySelector('.game-map');
  if (map) {
    map.classList.remove('field-shake');
    void map.offsetWidth;
    map.classList.add('field-shake');
    setTimeout(() => map.classList.remove('field-shake'), 700);
  }
  return style.hitMs;
}

/**
 * 파도의 바닥 쪽 — 출발 자리의 물보라 고리, 지나간 자리의 젖은 자국, 끝의 고인 물(잔잔해지다 마른다).
 * 3D가 없으면(fallback) 바닥에 눕는 물 띠가 직접 밀려간다.
 */
function _waveGround(o, fallback) {
  const ground = _castGround();
  if (!ground) return;
  const H = MAP_ROWS * TILE;
  const total = o.riseMs + o.travelMs + o.calmMs;
  const mk = (cls, css) => { const el = document.createElement('div'); el.className = cls; Object.assign(el.style, css); ground.appendChild(el); return el; };
  const frontX0 = o.backX + o.dir * o.width;
  const endFront = o.dir > 0 ? MAP_COLS * TILE : 0;
  const dist = Math.abs(endFront - frontX0);

  // 솟구치는 자리 — 물보라 고리
  const burst = mk('wave-burst', { left: (o.backX + o.dir * o.width / 2) + 'px', top: (H / 2) + 'px', height: H + 'px', width: o.width + 'px' });
  setTimeout(() => burst.remove(), 1400);

  // 지나간 자리가 젖는다 — 띠 뒤끝을 따라 늘어나며 천천히 마른다
  const wet = mk('wave-wet', { top: '0px', height: H + 'px', width: '0px',
                               left: (o.dir > 0 ? o.backX : o.backX) + 'px' });
  if (o.dir < 0) wet.style.transform = 'scaleX(-1)', wet.style.transformOrigin = '0 0';
  wet.animate([{ width: '0px' }, { width: dist + 'px' }],
              { duration: o.travelMs, delay: o.riseMs, easing: 'linear', fill: 'forwards' });
  wet.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
              { duration: total + 1200, fill: 'forwards' });

  // 물마루가 드리운 그림자 — 앞쪽 바닥이 어두워져 물 벽의 높이가 읽힌다
  const shadow = mk('wave-shadow', { left: (frontX0 + (o.dir > 0 ? 0 : -140)) + 'px', top: '0px', width: '140px', height: H + 'px', opacity: 0 });
  if (o.dir < 0) shadow.style.transform = 'scaleX(-1)';
  shadow.animate([{ translate: '0px 0px' }, { translate: `${o.dir * dist}px 0px` }],
                 { duration: o.travelMs, delay: o.riseMs, easing: 'linear', fill: 'forwards' });
  shadow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }],
                 { duration: o.riseMs + o.travelMs + 500, fill: 'forwards' });

  // 끝에 고인 물 — 잔잔한 물결이 퍼지다 가장자리부터 말라 사라진다
  const poolX = o.dir > 0 ? endFront - o.width : 0;
  const pool = mk('wave-pool', { left: poolX + 'px', top: '0px', width: o.width + 'px', height: H + 'px', opacity: 0 });
  pool.animate([
    { opacity: 0, transform: 'scale(1)' },
    { opacity: 1, transform: 'scale(1.04)', offset: 0.2 },
    { opacity: 0.85, transform: 'scale(1)', offset: 0.55 },
    { opacity: 0, transform: 'scale(0.9)' },
  ], { duration: o.calmMs, delay: o.riseMs + o.travelMs - 200, easing: 'ease-out', fill: 'forwards' });

  // 3D가 없으면 바닥 띠가 밀려간다
  if (fallback) {
    const band = mk('wave-band-flat', { left: o.backX + (o.dir < 0 ? -o.width : 0) + 'px', top: '0px', width: o.width + 'px', height: H + 'px' });
    band.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${o.dir * dist}px)` }],
                 { duration: o.travelMs, delay: o.riseMs, easing: 'linear', fill: 'forwards' });
    band.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
                 { duration: o.riseMs + o.travelMs + 600, fill: 'forwards' });
    setTimeout(() => band.remove(), total);
  }
  setTimeout(() => { wet.remove(); pool.remove(); shadow.remove(); }, total + 1300);
}

// ════════════════════════════════════════════════════════════
//  침수 — 물이 맨 위 줄에서 맨 아래 줄까지 쏟아져 흐르고, 범위가 잠긴 채 타워가 반쯤 가라앉는다
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
//  물에 젖은 회복 — +50% (2026-10-01, 2026-10-02 리워크 2)
//  침수·파도의 물에 닿은 흰꽃·숲의정령 토템 · 벚꽃을 받는 타워는 회복이 늘어난다:
//  한 번 회복량 h → (h를 짝수로 올린 값) × 1.5 = ceil(h / 2) × 3   (예: 23 → 24 + 12 = 36)
//  · 누가 쓴 물이든 젖은 쪽 — 상대 진영에 쓰면 상대 회복을 키우고, 내 진영에 쓰면 내 회복을 키운다
//  · 침수: 물살이 그 줄에 닿은 순간부터 물이 빠지기 시작할 때까지 (침수당하는 동안)
//  · 파도: 파도가 그 칸을 덮고 있는 동안만 (끝에 고인 칸은 마를 때까지)
//  · 폭염에 녹은 얼음물(타워 둘레 3×3칸, sync.js ICE_POOL_MS)도 같은 물이다
//  틱을 계산하는 모든 화면(양쪽·관전자)이 각자 같은 연출을 재생하며 같은 구역을 안다 (effects.js computeDotTick).
// ════════════════════════════════════════════════════════════
const TOTEM_SOAK_HEAL = h => Math.ceil(h / 2) * 3;
const _waterZones = [];   // { victimKey(맞는 쪽 — 표시용), to, test(col, row, t) }

function _waterZoneAdd(z) {
  const now = gameNow();
  for (let i = _waterZones.length - 1; i >= 0; i--) if (_waterZones[i].to < now) _waterZones.splice(i, 1);
  const victimKey = z.victim === 'my' ? _boardPlayerKey : _boardEnemyKey;
  if (z.kind === 'flood') {
    const { R, style } = z;
    const until = z.start + style.flowMs + style.sinkMs;
    _waterZones.push({ victimKey, to: until,
      test: (c, r, t) => _inRect(R, c, r) && t >= z.start + floodRowMs(style, R, r) && t < until });
    return;
  }
  // 파도 — 진행 방향 거리 u(뒤끝 기준)로 그 칸 가운데를 덮은 시간 [tin, tout]
  const maxMoved = z.travelMs / 1000 * z.speedPx;
  const go = z.start + z.riseMs;
  const end = go + z.travelMs + z.calmMs;
  _waterZones.push({ victimKey, to: end, test: (c, r, t) => {
    const u = z.dir * ((c + 0.5) * TILE - z.backX);
    if (u < 0 || u > maxMoved + z.width) return false;
    const tin  = u <= z.width ? z.start : go + (u - z.width) / z.speedPx * 1000;
    const tout = u <= maxMoved ? go + u / z.speedPx * 1000 : end;          // 끝에 고인 칸은 마를 때까지
    return t >= tin && t < tout;
  } });
}

/**
 * 토템 회복 한 번 — 그 토템 칸이 지금 젖어 있으면 늘린다 (누가 쓴 물이든 · 녹은 얼음물).
 * @param {string} tag   토템 칸 (p1 기준 '열,행' — totemTag)
 */
function totemSoakedHeal(h, tag, owner, t) {
  const l = _totemTagLocal(tag);
  if (!l) return h;
  return _tileWet(l.col, l.row, t) ? TOTEM_SOAK_HEAL(h) : h;
}

/** 이 화면 칸이 그 시각 젖어 있는가 — 침수·파도의 물 · 폭염에 녹은 얼음물 */
function _tileWet(col, row, t) {
  return _waterZones.some(z => z.test(col, row, t)) || _icePoolAt(col, row, t);
}

/** 폭염에 녹은 얼음물 — 녹은 타워 둘레 3×3칸이 ICE_POOL_MS 동안 젖어 있다 (타워 데이터로 — 모든 화면이 같다) */
function _icePoolAt(col, row, t) {
  if (typeof towerIcePool !== 'function') return false;
  return [['my', _boardPlayerKey], ['enemy', _boardEnemyKey]].some(([side, key]) =>
    ['left', 'king', 'right'].some(pos => {
      if (!towerIcePool(_boardGameState?.[key]?.towers?.[pos], t)) return false;
      const tile = _towerTile(side, pos);
      return !!tile && Math.abs(tile.col - col) <= 1 && Math.abs(tile.row - row) <= 1;
    }));
}

/**
 * 침수 물살 — 캔버스에 그리는 상태 (혀 모양으로 들쭉날쭉한 물살 선 · 쏟아지는 물결 줄 · 앞의 거품 · 잔잔한 빛무늬).
 * 물살 선의 평균은 시간에 정비례로 내려간다 — 줄마다의 30 피해(floodRowMs)와 같은 시각에 닿는다.
 */
function _floodSim(W, H, flow) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const tongues = Array.from({ length: 5 }, (_, i) => ({ x: (i + rnd(0.2, 0.8)) * W / 5, w: rnd(22, 46), amp: rnd(10, 30) }));
  const sim = {
    last: 0,
    frontY(x, t) {
      let y = H * t / flow;
      const grow = Math.min(1, t / 220);
      for (const g of tongues) y += g.amp * grow * Math.exp(-(((x - g.x) / g.w) ** 2));
      return y + 7 * Math.sin(x / 31 + t * 0.012) + 4 * Math.sin(x / 11 - t * 0.021) - 10;
    },
    streaks: Array.from({ length: 70 }, () => ({ x: rnd(4, W - 4), y: rnd(-H, H), len: rnd(24, 80), v: rnd(1.5, 2.6), w: rnd(1.2, 3.4), a: rnd(0.18, 0.55) })),
    bubbles: Array.from({ length: 80 }, () => ({ x: rnd(0, W), off: rnd(0, 34), r: rnd(1.5, 6), sp: rnd(0.01, 0.04) })),
    blobs: Array.from({ length: 18 }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(30, 70), vx: rnd(-0.012, 0.012), vy: rnd(-0.01, 0.02), ph: rnd(0, 6) })),
  };
  return sim;
}

function _floodDraw(ctx, sim, t, flow, sink, drain) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const dt = Math.min(50, Math.max(0, t - sim.last));
  sim.last = t;
  const flowing = t < flow;
  const draining = t > flow + sink;
  const kd = draining ? Math.min(1, (t - flow - sink) / drain) : 0;
  const top = x => draining ? kd * H * 1.08 + 12 * Math.sin(x / 40 + t * 0.01) + 6 * Math.sin(x / 13 - t * 0.017) - 12 : -20;
  const bot = x => flowing ? sim.frontY(x, t) : H + 40;
  const STEP = 8;
  ctx.clearRect(0, 0, W, H);

  // ── 물 몸통 ──
  const body = new Path2D();
  body.moveTo(0, top(0));
  for (let x = STEP; x <= W; x += STEP) body.lineTo(x, top(x));
  for (let x = W; x >= 0; x -= STEP) body.lineTo(x, bot(x));
  body.closePath();
  const fade = 1 - kd * 0.6;
  const frontMid = flowing ? Math.max(1, H * t / flow) : H;
  const g = ctx.createLinearGradient(0, 0, 0, frontMid);
  g.addColorStop(0, `rgba(22, 98, 196, ${0.5 * fade})`);
  g.addColorStop(flowing ? 0.7 : 0.5, `rgba(38, 132, 222, ${0.56 * fade})`);
  g.addColorStop(1, `rgba(84, 182, 246, ${(flowing ? 0.7 : 0.5) * fade})`);
  ctx.fillStyle = g;
  ctx.fill(body);

  ctx.save();
  ctx.clip(body);
  // 깊이의 얼룩 — 밝고 어두운 덩이가 천천히 흐른다 (다 흐른 뒤엔 일렁이는 빛무늬)
  sim.blobs.forEach(b => {
    b.x += b.vx * dt; b.y += (flowing ? 0.25 : b.vy) * dt;
    if (b.y > H + b.r) b.y = -b.r;
    if (b.x < -b.r) b.x = W + b.r; else if (b.x > W + b.r) b.x = -b.r;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.003 + b.ph);
    const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    rg.addColorStop(0, `rgba(190, 236, 255, ${(flowing ? 0.1 : 0.16 + 0.12 * pulse) * fade})`);
    rg.addColorStop(1, 'rgba(190, 236, 255, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
  });
  // 쏟아지는 물결 줄 — 물살보다 빨리 흘러 앞으로 몰려간다. 다 흐른 뒤엔 느릿한 흐름만 남는다
  ctx.lineCap = 'round';
  const fv = H / flow;
  sim.streaks.forEach(s => {
    s.y += (flowing ? s.v * fv : 0.03 + s.v * 0.012) * dt;
    if (s.y - s.len > bot(s.x) || s.y - s.len > H) { s.y = top(s.x) - Math.random() * 60; s.x = 4 + Math.random() * (W - 8); }
    ctx.strokeStyle = `rgba(225, 246, 255, ${s.a * (flowing ? 1 : 0.45) * fade})`;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - s.len);
    ctx.quadraticCurveTo(s.x + Math.sin(s.y / 23) * 4, s.y - s.len / 2, s.x, s.y);
    ctx.stroke();
  });
  // 다 흐른 뒤 — 수면의 잔물결
  if (!flowing) {
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const yy = ((i * 71 + t * 0.02) % (H + 40)) - 20, xx = (i * 137) % W;
      ctx.strokeStyle = `rgba(210, 242, 255, ${0.28 * fade})`;
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const px = xx - 40 + k * 10, py = yy + Math.sin(k * 0.9 + t * 0.006 + i) * 3;
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
  }
  // 양 옆 가장자리 — 벽에 부딪혀 하얗게 이는 물
  ctx.setLineDash([18, 12]);
  ctx.lineDashOffset = -t * (flowing ? 0.9 : 0.05);
  ctx.strokeStyle = `rgba(235, 250, 255, ${0.55 * fade})`;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(2, H); ctx.moveTo(W - 2, 0); ctx.lineTo(W - 2, H); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // ── 물살 앞 — 바닥에 드리운 그늘 · 두꺼운 흰 거품 띠 · 튀는 거품 방울 ──
  const tail = flowing ? 1 : Math.max(0, 1 - (t - flow) / 260);
  if (tail > 0) {
    const edgeY = x => Math.min(H - 3, bot(x));
    const line = off => { const p = new Path2D(); for (let x = 0; x <= W; x += STEP) { const y = edgeY(x) + off; x ? p.lineTo(x, y) : p.moveTo(x, y); } return p; };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(0, 25, 70, ${0.28 * tail})`; ctx.lineWidth = 18; ctx.stroke(line(12));
    ctx.strokeStyle = `rgba(200, 238, 255, ${0.4 * tail})`; ctx.lineWidth = 26; ctx.stroke(line(-10));
    ctx.strokeStyle = `rgba(248, 253, 255, ${0.95 * tail})`; ctx.lineWidth = 8; ctx.stroke(line(0));
    sim.bubbles.forEach(b => {
      b.off += b.sp * dt;
      if (b.off > 38) { b.off = 0; b.x = Math.random() * W; }
      ctx.fillStyle = `rgba(250, 254, 255, ${(1 - b.off / 38) * 0.9 * tail})`;
      ctx.beginPath(); ctx.arc(b.x, edgeY(b.x) - b.off + 2, b.r * (1 - b.off / 76), 0, Math.PI * 2); ctx.fill();
    });
  }
  // 바닥 끝에 닿는 순간 — 하얗게 부서지는 물
  if (!flowing && t < flow + 420) {
    const k = (t - flow) / 420;
    const sg = ctx.createLinearGradient(0, H, 0, H - 120);
    sg.addColorStop(0, `rgba(245, 252, 255, ${0.8 * (1 - k)})`);
    sg.addColorStop(1, 'rgba(245, 252, 255, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, H - 120 - 40 * k, W, 120 + 40 * k);
  }
  // 빠지는 물 — 걷히는 위 가장자리에 얇은 거품
  if (draining && kd < 1) {
    ctx.strokeStyle = `rgba(230, 248, 255, ${0.6 * (1 - kd)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= W; x += STEP) { const y = top(x); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
}

function _floodFx(style, R, owner) {
  const ground = _castGround();
  const layer = _fxLayer();
  if (!ground) return;
  const x0 = R.c0 * TILE, y0 = R.r0 * TILE;
  const W = (R.c1 - R.c0 + 1) * TILE, H = (R.r1 - R.r0 + 1) * TILE;
  const flow = style.flowMs, sink = style.sinkMs, drain = style.drainMs;

  const area = document.createElement('div');
  area.className = 'flood-area';
  Object.assign(area.style, { left: x0 + 'px', top: y0 + 'px', width: W + 'px', height: H + 'px' });
  const cv = document.createElement('canvas');
  cv.className = 'flood-canvas';
  cv.width = W; cv.height = H;
  area.appendChild(cv);
  ground.appendChild(area);
  const sim = _floodSim(W, H, flow);
  const total = flow + sink + drain;
  const t0 = performance.now();
  const ctx = cv.getContext('2d');
  // 물살 앞의 물보라 — 흐르는 동안 실제 물살 선(혀 모양으로 들쭉날쭉)을 따라 튄다 (서 있는 연출이라 화면 좌표)
  let nextSpray = 0;
  const frame = now => {
    const t = now - t0;
    if (t >= total || !area.isConnected) { area.remove(); return; }
    if (ctx) _floodDraw(ctx, sim, t, flow, sink, drain);
    if (layer && t < flow && now >= nextSpray) {
      nextSpray = now + 34;
      for (let i = 0; i < 4; i++) {
        const x = Math.random() * W;
        const p = _groundToStage(x0 + x, y0 + Math.min(H, sim.frontY(x, t)));
        const d = document.createElement('i');
        d.className = 'flood-spray' + (Math.random() < 0.3 ? ' big' : '');
        d.style.left = p.x + 'px';
        d.style.top  = p.y + 'px';
        d.style.setProperty('--dx', ((Math.random() - 0.5) * 70).toFixed(0) + 'px');
        d.style.setProperty('--dy', (-40 - Math.random() * 70).toFixed(0) + 'px');
        layer.appendChild(d);
        setTimeout(() => d.remove(), 600);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setTimeout(() => area.remove(), total + 200);

  // 잠긴 타워 — 다 흐른 뒤 반쯤 가라앉고, 발밑에 물결이 퍼진다
  const towers = _towersInRect(R, false).filter(el => el.dataset.owner === owner);
  _waterZoneAdd({ victim: owner, kind: 'flood', start: gameNow(), R, style });
  setTimeout(() => {
    towers.forEach(el => {
      if (el.classList.contains('destroyed')) return;
      if (typeof towers3dSink === 'function') towers3dSink(el, sink);
      const col = Number(el.style.getPropertyValue('--col')), row = Number(el.style.getPropertyValue('--row'));
      const ring = document.createElement('div');
      ring.className = 'flood-ring';
      ring.style.left = (col * TILE + TILE / 2) + 'px';
      ring.style.top  = (row * TILE + TILE / 2) + 'px';
      ground.appendChild(ring);
      setTimeout(() => ring.remove(), sink);
    });
  }, flow);
}

// ════════════════════════════════════════════════════════════
//  가시 — 2×2칸의 땅이 갈라지고, 가시가 한꺼번에 튀어나와 타워를 꿰뚫는다
//    예고 (0 ~ hitMs)   범위 칸의 땅이 어둡게 부풀며 금이 번진다
//    튀어나옴 (hitMs)   가시 숲이 솟고 흙이 튄다 — 타워 발밑 둘레의 큰 가시는 벽으로 기울어 박힌다 (45)
//    박힌 채 (2초)      0.5초마다 7 × 4 — 그동안 가시는 그대로 서 있다가 땅속으로 꺼진다
// ════════════════════════════════════════════════════════════
function _thornFx(style, R, owner) {
  const ground = _castGround();
  const x0 = R.c0 * TILE, y0 = R.r0 * TILE;
  const W = (R.c1 - R.c0 + 1) * TILE, H = (R.r1 - R.r0 + 1) * TILE;
  const f = style.thorn;
  const holdMs = f.dot.ticks * f.dot.tickInterval + 250;
  if (ground) {
    const patch = document.createElement('div');
    patch.className = 'thorn-ground';
    Object.assign(patch.style, { left: x0 + 'px', top: y0 + 'px', width: W + 'px', height: H + 'px' });
    patch.style.setProperty('--rise', style.hitMs + 'ms');
    patch.style.setProperty('--life', (style.hitMs + holdMs + 500) + 'ms');
    patch.innerHTML = '<i class="thorn-crack"></i>';
    ground.appendChild(patch);
    setTimeout(() => patch.remove(), style.hitMs + holdMs + 600);
  }
  // 범위 칸 · 범위 안 타워 발밑
  const tiles = [];
  for (let c = R.c0; c <= R.c1; c++) for (let r = R.r0; r <= R.r1; r++) tiles.push(_tileCenter(c, r));
  const inRect = _towersInRect(R, false);
  const towers = inRect.map(el => _towerFootprint(el));
  // 상성 (2026-10-03) — 가시가 솟는 순간 맞는 쪽 토템(숲의정령 · 흰꽃)은 산산조각 나고,
  // 가시가 박혀 있는 동안 그 자리에 세운 토템도 곧바로 부서진다
  setTimeout(() => _totemDebuff(R, 'shatter', owner, 1, holdMs), style.hitMs);
  const in3d = typeof towers3dSpikes === 'function' &&
    towers3dSpikes({ tiles, towers, riseMs: style.hitMs - 30, holdMs, seed: (R.c0 * 31 + R.r0 * 17 + 7) >>> 0 });
  // 솟는 순간 — 필드가 울리고 흙먼지가 오르며, 꿰뚫린 타워가 휘청인다
  setTimeout(() => {
    const map = document.querySelector('.game-map');
    if (map) {
      map.classList.remove('field-bump');
      void map.offsetWidth;
      map.classList.add('field-bump');
      setTimeout(() => map.classList.remove('field-bump'), 500);
    }
    tiles.forEach((t, i) => {
      const p = _groundToStage(t.x, t.y);
      _spawnDust(p.x, p.y - 10, 70, i * 30, 700, 'rgba(120, 96, 70, 0.55)');
    });
    inRect.filter(el => el.dataset.owner === owner && !el.classList.contains('destroyed')).forEach(el => {
      if (typeof towers3dImpact === 'function') towers3dImpact(el, owner === 'enemy' ? 1 : -1);
    });
    if (!in3d && ground) {
      // WebGL이 없으면 칸마다 가시 그림 하나
      tiles.forEach(t => {
        const sp = document.createElement('div');
        sp.className = 'thorn-flat';
        sp.textContent = '🌵';
        Object.assign(sp.style, { left: t.x + 'px', top: t.y + 'px' });
        ground.appendChild(sp);
        setTimeout(() => sp.remove(), holdMs);
      });
    }
  }, style.hitMs);
}

/**
 * 지진·붕괴 연출.
 *   땅울림(hitMs) — 범위 칸이 잘게 떨리고 실금이 번지며, 그 안의 타워도 떤다
 *   무너짐        — 칸마다 조각나 꺼져 들어가고 흙먼지가 오른다. drops마다 한 단계씩 더 꺼진다
 *   복구          — 조각이 제자리로 올라오고 사라진다
 * 칸 조각은 진짜 타일 모양을 그대로 베낀다 — 다른 색 판을 덮으면 '타일이 깨졌다'가 아니라 '무엇이 떴다'로 보인다.
 * @returns {number} 피해가 들어가는 지연(ms)
 */
function _playAreaFx(style, owner, pos, stagePoint) {
  const even  = Math.min(style.cols, MAP_COLS) % 2 === 0;
  const evenR = Math.min(style.rows, MAP_ROWS) % 2 === 0;
  const t = stagePoint
    ? { col: even ? Math.round(stagePoint.x / TILE) : Math.floor(stagePoint.x / TILE),
        row: evenR ? Math.round(stagePoint.y / TILE) : Math.floor(stagePoint.y / TILE) }
    : _towerTile(owner, pos);
  if (!t) return style.hitMs;
  const R = castAreaRect(style, t.col, t.row);
  if (style.flood) { _floodFx(style, R, owner); return style.hitMs; }
  if (style.thorn) { _thornFx(style, R, owner); return style.hitMs; }
  if (style.blast) { _heatwaveFx(style, R, owner); return style.hitMs; }
  if (style.ice)   { _iceFieldFx(style, R, owner); return style.hitMs; }

  // 붕괴 — 이 순간부터 범위 안에 새로 서는 토템은 곧바로 무너지고,
  // 이미 서 있던 토템은 땅이 꺼지는 순간 무너진다. 맞는 쪽(owner) 진영의 토템만 — 내 붕괴가 내 토템을 부수지는 않는다
  if (style.totemBreak) {
    const Z = _totemVictimRect(R, owner);
    if (Z) {
      _totemBreakZones.push({ ...Z, until: Date.now() + style.hitMs + style.lockMs });
      setTimeout(() => _breakTotemsIn(Z), style.hitMs);
    }
  }
  // 지진 — 땅이 울리는 순간 범위 안 상대 토템의 남은 시간이 준다
  if (style.totemCut) {
    const Z = _totemVictimRect(R, owner);
    if (Z) setTimeout(() => _totemTilesIn(Z).forEach(([c, r]) => _totemShorten(c, r, TOTEM_CUT_MS)), style.hitMs);
  }
  _quakeGround(style, R);
  return style.hitMs;
}

/** 칸 하나를 금 가는 자리마다 나눈 조각들 (% 좌표). 칸마다 모양이 다르고, 같은 칸은 늘 같은 모양 */
function _quakeShards(col, row) {
  let s = (col * 73856093) ^ (row * 19349663) ^ 0x5bd1e995;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const cx = 50 + (rnd() - 0.5) * 30, cy = 50 + (rnd() - 0.5) * 30;   // 금이 모이는 점
  const e = () => 25 + rnd() * 50;                                    // 변 위의 갈라짐 자리
  const rim = [[0, 0], [e(), 0], [100, 0], [100, e()], [100, 100], [e(), 100], [0, 100], [0, e()]];
  return rim.map((p, i) => {
    const q = rim[(i + 1) % rim.length];
    return {
      poly: [[cx, cy], p, q],
      ox: (cx + p[0] + q[0]) / 3, oy: (cy + p[1] + q[1]) / 3,   // 무게중심 — 여기를 기준으로 줄어 틈이 벌어진다
      rot: (rnd() - 0.5) * 2, lag: rnd()
    };
  });
}

/** 바닥판(.ground-depth)이 먼 줄을 어둡게 누르는 만큼 — 조각은 그 위에 깔리므로 직접 눌러 준다 */
function _groundShade(row) {
  const f = (row + 0.5) / MAP_ROWS;
  if (f < 0.18) return 0.55 + (0.22 - 0.55) * (f / 0.18);
  if (f < 0.46) return 0.22 * (1 - (f - 0.18) / 0.28);
  return 0;
}

function _quakeGround(style, R) {
  const ground = _castGround();
  const cols = R.c1 - R.c0 + 1, rows = R.r1 - R.r0 + 1;
  const hitMs = style.hitMs, D = hitMs + style.collapseMs + style.restoreMs;

  // 그 안의 타워 — 땅울림 동안 떨고, 꺼질 때마다 한 번 더 떤다
  const towers = _towersInRect(R, false);
  const shake = ms => {
    towers.forEach(el => el.classList.add('tower-quake'));
    setTimeout(() => towers.forEach(el => el.classList.remove('tower-quake')), ms);
  };
  shake(hitMs + 160);
  style.drops.slice(1).forEach(d => setTimeout(() => shake(260), hitMs + d.at));

  // 맵 전체가 낮게 울린다 → 꺼지는 순간 붕괴는 크게 한 번 흔들린다
  const map = document.querySelector('.game-map');
  if (map) {
    map.classList.remove('field-rumble');
    void map.offsetWidth;
    map.classList.add('field-rumble');
    setTimeout(() => map.classList.remove('field-rumble'), hitMs);
    if (style.totemBreak) setTimeout(() => {
      map.classList.remove('field-shake');
      void map.offsetWidth;
      map.classList.add('field-shake');
      setTimeout(() => map.classList.remove('field-shake'), 700);
    }, hitMs);
  }

  // 흙먼지 — 땅울림 중엔 금 사이로 조금씩, 꺼지는 순간 칸마다 한 덩이씩
  const dustAt = (col, row, size, delay, ms) => {
    const p = _groundToStage(col * TILE + TILE / 2, row * TILE + TILE / 2);
    _spawnDust(p.x, p.y, size, delay, ms, style.totemBreak ? 'rgba(120, 104, 92, 0.6)' : null);
  };
  for (let k = 0; k < Math.min(4, cols * rows); k++) {
    const i = (k * 7 + 3) % (cols * rows);
    dustAt(R.c0 + (i % cols), R.r0 + Math.floor(i / cols), 70, Math.round(hitMs * (0.15 + k * 0.18)), 700);
  }
  style.drops.forEach(d => {
    for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) {
      const big = d.at === 0;
      dustAt(c, r, big ? 120 : 80, hitMs + d.at + ((c * 5 + r * 3) % 7) * 18, big ? 950 : 700);
    }
  });

  if (!ground) return;

  const box = document.createElement('div');
  box.className = `quake-area quake-rumble${style.totemBreak ? ' quake-collapse' : ''}`;
  box.style.left   = (R.c0 * TILE) + 'px';
  box.style.top    = (R.r0 * TILE) + 'px';
  box.style.width  = (cols * TILE) + 'px';
  box.style.height = (rows * TILE) + 'px';

  // 깊이 → 조각의 모습. 무게중심 쪽으로 줄어 틈(구덩이)이 벌어지고, 앞으로 조금 처지고, 어두워진다
  const look = (sh, depth) => {
    const k = Math.min(depth, 3.4);
    return {
      transform: `translateY(${(k * 2.6).toFixed(2)}px) rotate(${(sh.rot * k * 1.6).toFixed(2)}deg) scale(${(1 - k * 0.048).toFixed(3)})`,
      filter: `brightness(${(1 - k * 0.11).toFixed(3)})`
    };
  };
  const at = ms => Math.min(1, Math.max(0, ms / D));

  for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) {
    const tileEl = document.querySelector(`.tile[data-col="${c}"][data-row="${r}"]`);
    const cs = tileEl ? getComputedStyle(tileEl) : null;
    const shade = _groundShade(r);
    const cell = document.createElement('div');
    cell.className = 'quake-cell';
    cell.style.left = ((c - R.c0) * TILE) + 'px';
    cell.style.top  = ((r - R.r0) * TILE) + 'px';
    cell.style.setProperty('--jd', (-((c * 37 + r * 53) % 90)) + 'ms');

    const pit = document.createElement('div');
    pit.className = 'quake-pit';
    cell.appendChild(pit);
    // 구덩이 — 땅울림 동안 실금 사이로 희미하게, 꺼지면 짙게
    pit.animate([
      { opacity: 0 },
      { opacity: 0.55, offset: at(hitMs * 0.7) },
      { opacity: 1,    offset: at(hitMs + 120) },
      { opacity: 1,    offset: at(hitMs + style.collapseMs) },
      { opacity: 0 }
    ], { duration: D, fill: 'both' });

    const stagger = ((c * 3 + r * 5) % 6) * 22;   // 칸마다 조금씩 늦게 — 한 판이 통째로 꺼지면 '판'으로 보인다
    _quakeShards(c, r).forEach(sh => {
      const el = document.createElement('div');
      el.className = 'quake-shard';
      el.style.clipPath = `polygon(${sh.poly.map(p => p[0].toFixed(1) + '% ' + p[1].toFixed(1) + '%').join(',')})`;
      el.style.transformOrigin = `${sh.ox.toFixed(1)}% ${sh.oy.toFixed(1)}%`;
      if (cs) {
        // 진짜 칸의 면을 그대로 — 칸 면은 반투명이라 그 아래 바닥 색과 먼 줄의 그늘까지 깔아 준다
        el.style.backgroundImage =
          `linear-gradient(rgba(6,10,22,${shade.toFixed(3)}), rgba(6,10,22,${shade.toFixed(3)})), ${cs.backgroundImage}`;
        el.style.borderColor = cs.borderTopColor;
      }
      cell.appendChild(el);

      // 금 → 꺼짐(단계마다 한 번 더, 살짝 지나쳤다 자리 잡는다) → 복구
      const frames = [{ ...look(sh, 0), offset: 0 }, { ...look(sh, 0.18), offset: at(hitMs * 0.8) }];
      let prev = 0.18;
      style.drops.forEach(d => {
        const t0 = hitMs + d.at + stagger + sh.lag * 50;
        frames.push({ ...look(sh, prev), offset: at(t0) });
        frames.push({ ...look(sh, d.depth + 0.4), offset: at(t0 + 130), easing: 'ease-out' });
        frames.push({ ...look(sh, d.depth), offset: at(t0 + 240) });
        prev = d.depth;
      });
      frames.push({ ...look(sh, prev), offset: at(hitMs + style.collapseMs) });
      frames.push({ ...look(sh, 0), offset: 1 });
      // offset이 뒤로 가면 WAAPI가 통째로 거부한다 — 짧은 연출에서 겹칠 때를 대비해 정렬해 둔다
      let last = 0;
      frames.forEach(f => { f.offset = Math.max(last, f.offset); last = f.offset; });
      el.animate(frames, { duration: D, fill: 'both', easing: 'cubic-bezier(0.55, 0, 0.8, 0.4)' });
    });
    box.appendChild(cell);
  }
  ground.appendChild(box);
  setTimeout(() => box.classList.remove('quake-rumble'), hitMs);
  setTimeout(() => box.remove(), D + 40);
}

// ── 토템 무너뜨리기 (붕괴) ────────────────────────────────────
// 붕괴 범위 안의 토템은 무너지고 회복을 멈춘다. 무너진 뒤 lockMs 동안은 새로 세운 토템도 곧바로 무너진다.
// 모든 화면이 각자 playCastFx에서 같은 범위를 알게 되므로 모양은 각자 그린다.
// 회복(dots의 heal 줄)은 그 토템 주인 화면이 지운다 — 원래 그 틱을 넣는 쪽이다 (effects.js).
const _totemBreakZones = [];   // { c0, r0, c1, r1, until }

/**
 * 그 칸이 지금 토템이 못 버티는 범위 안인가 (붕괴 · 토네이도 · 불덩이 · 폭염이 지나간 자리).
 * @returns {{how, dir}|null} 그 자리에 세운 토템이 없어지는 꼴
 */
function totemBreakZoneAt(col, row) {
  const now = Date.now();
  for (let i = _totemBreakZones.length - 1; i >= 0; i--) {
    if (_totemBreakZones[i].until <= now) _totemBreakZones.splice(i, 1);
  }
  return _totemBreakZones.find(z => _inRect(z, col, row)) || null;
}

/**
 * 토템 회복 줄에 붙이는 '어느 칸의 토템인가' 표시.
 * 두 플레이어 화면은 좌우가 거울이라 p1 화면 기준 칸으로 적는다 (관전 화면도 p1 기준이다).
 * 같은 식을 한 번 더 걸면 되돌아온다.
 */
function totemTag(col, row) {
  const c = _boardPlayerKey === 'p2' ? MAP_COLS - 1 - col : col;
  return c + ',' + row;
}
function _totemTagLocal(tag) {
  const [c, r] = String(tag).split(',').map(Number);
  if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
  return { col: _boardPlayerKey === 'p2' ? MAP_COLS - 1 - c : c, row: r };
}

/**
 * 범위 안의 토템을 모두 없애고 그 회복을 멈춘다.
 * @param {{how?: 'crumble'|'blow'|'burn'|'saw'|'shatter', dir?: number, ux?: number, uy?: number}} o 없어지는 꼴 —
 *   붕괴는 무너지고, 토네이도는 쓰러지고, 불은 타 버리고, 톱은 반토막 내고, 가시는 산산조각 낸다
 */
function _breakTotemsIn(R, o = {}) {
  Object.keys(_totemTiles).forEach(key => {
    const [c, r] = key.split(',').map(Number);
    if (_inRect(R, c, r) && totemOnTile(c, r)) _destroyTotem(c, r, o.how, o.dir, o);
  });
  if (typeof effectsCancelTotemHeals === 'function') {
    effectsCancelTotemHeals(tag => { const l = _totemTagLocal(tag); return !!l && _inRect(R, l.col, l.row); });
  }
}

// ── 토템 상성 (2026-10-02) ──────────────────────────────────
// 토네이도를 맞으면 상대 토템이 날아가고, 불덩이 · 폭염이 닿으면 불이 붙어 타 버린다 (힐 밴).
// 디버프는 붕괴와 같다 — 그 자리의 토템을 없애고, 그 뒤 lockMs 동안 그 자리에 새로 세운 토템도 곧바로 같은 꼴로 없어진다.
// 불 · 바람은 '맞는 쪽'(victim) 진영의 토템에만 — 내 진영에 쓴 불이 내 토템을 태우지는 않는다.
const TOTEM_LOCK_MS = 2000;   // 붕괴의 lockMs와 같다

/** 범위 중 맞는 쪽(victim) 진영에 든 부분 — 토템은 자기 진영에만 서므로 그쪽 토템만 다친다 */
function _totemVictimRect(R, victim) {
  const half = victim === 'my' ? [0, MAP_COLS / 2 - 1] : [MAP_COLS / 2, MAP_COLS - 1];
  const Z = { c0: Math.max(R.c0, half[0]), c1: Math.min(R.c1, half[1]), r0: Math.max(0, R.r0), r1: Math.min(MAP_ROWS - 1, R.r1) };
  return Z.c0 > Z.c1 || Z.r0 > Z.r1 ? null : Z;
}

/** @returns {object|null} 막힌 구역 — until을 당기면 일찍 풀린다 (물에 꺼진 불) */
function _totemDebuff(R, how, victim, dir = 1, lockMs = TOTEM_LOCK_MS) {
  const Z = _totemVictimRect(R, victim);
  if (!Z) return null;
  const zone = { ...Z, until: Date.now() + lockMs, how, dir };
  _totemBreakZones.push(zone);
  _breakTotemsIn(Z, { how, dir });
  return zone;
}

// ── 토템의 남은 시간을 줄인다 (2026-10-03 상성 — 지진 · 바람) ─────────
// 남은 시간이 TOTEM_CUT_MS보다 많으면 그만큼 줄고(게이지 · 3D · 회복 틱이 같이 준다),
// 그만큼도 안 남았으면(1~2초) 곧바로 무너진다 — 회복도 멈춘다.
// 모든 화면이 같은 연출을 받아 각자 같은 계산을 한다 (회복 줄은 그 타워 주인 화면이 고친다 — effects.js)
const TOTEM_CUT_MS = 2000;
const _totemLife = {};   // '열,행' → { t0(performance.now), life, cut }

/** 범위 안에 서 있는 토템 칸들 */
function _totemTilesIn(R) {
  return Object.keys(_totemTiles).map(k => k.split(',').map(Number))
    .filter(([c, r]) => _inRect(R, c, r) && totemOnTile(c, r));
}

/** 그 토템의 남은 회복 시간 (ms) */
function totemLeftMs(col, row) {
  const L = _totemLife[col + ',' + row];
  if (!L || !totemOnTile(col, row)) return 0;
  return Math.max(0, L.life - (performance.now() - L.t0) - L.cut);
}

function _totemShorten(col, row, ms) {
  const key = col + ',' + row;
  if (!totemOnTile(col, row)) return false;
  const left = totemLeftMs(col, row);
  const p = _tileCenter(col, row);
  if (left <= ms) {
    _breakTotemsIn({ c0: col, c1: col, r0: row, r1: row }, { how: 'crumble' });
    return true;
  }
  const L = _totemLife[key];
  if (L) L.cut += ms;
  _totemTiles[key] -= ms;
  if (typeof towers3dTotemShorten === 'function') towers3dTotemShorten(p.x, p.y, ms);
  if (typeof effectsShortenTotemHeals === 'function') {
    effectsShortenTotemHeals(tag => { const l = _totemTagLocal(tag); return !!l && l.col === col && l.row === row; }, ms);
  }
  // 바닥 장식(범위 원 · 풀)도 앞당겨 걷는다
  const born = Date.now();
  setTimeout(() => {
    if (totemOnTile(col, row)) return;
    document.querySelectorAll(`.cast-fx-ground[data-tile="${key}"], .cast-totem-flat[data-tile="${key}"]`).forEach(el => {
      if (Number(el.dataset.born || 0) <= born) el.remove();
    });
  }, left - ms + 450);
  // 줄었다는 표시 — 게이지 옆에 '-2s'가 떴다 사라진다
  const top = typeof towers3dTotemTop === 'function' ? towers3dTotemTop(p.x, p.y) : null;
  const sp = top || (() => { const g = _groundToStage(p.x, p.y); return { x: g.x, y: g.y - 90 }; })();
  const tag = document.createElement('div');
  tag.className = 'totem-cut-label';
  tag.textContent = `-${Math.round(ms / 1000)}s`;
  tag.style.left = (sp.x + 34) + 'px';
  tag.style.top  = (sp.y - 34) + 'px';
  _fxLayer().appendChild(tag);
  setTimeout(() => tag.remove(), 1100);
  return true;
}

/**
 * 토템 지속 시간 게이지 (2026-10-01) — 토템 머리 위의 원형 게이지와 남은 초 (5s → 1s).
 * 그림리퍼 낫 대기 게이지와 같은 모양, 색은 초록 (숲의정령·흰꽃 둘 다). 남은 만큼 링이 줄어든다.
 * 토템이 무너지면(붕괴) 같이 사라진다.
 */
function _totemGauge(c, style, cell, in3d) {
  const life = style.lifeMs || style.endMs;
  const el = document.createElement('div');
  el.className = 'totem-cd';
  el.innerHTML = '<i class="totem-cd-track"></i><b class="totem-cd-core"><em></em></b>';
  if (cell) el.dataset.tile = cell.col + ',' + cell.row;
  _fxLayer().appendChild(el);
  const text = el.querySelector('em');
  const t0 = performance.now();
  // 남은 시간은 줄어들 수 있다 (지진 · 바람 — _totemShorten)
  const L = { t0, life, cut: 0 };
  if (cell) _totemLife[cell.col + ',' + cell.row] = L;
  let shown = '';
  const step = now => {
    const left = life - (now - t0) - L.cut;
    if (left <= 0 || !el.isConnected || (cell && !totemOnTile(cell.col, cell.row))) { el.remove(); return; }
    const top = in3d && typeof towers3dTotemTop === 'function' ? towers3dTotemTop(c.x, c.y) : null;
    const p = top || (() => { const g = _groundToStage(c.x, c.y); return { x: g.x, y: g.y - 90 }; })();
    el.style.left = p.x.toFixed(1) + 'px';
    el.style.top  = (p.y - 30).toFixed(1) + 'px';
    el.style.setProperty('--p', (left / life * 100).toFixed(1));
    const label = Math.ceil(left / 1000) + 's';
    if (label !== shown) { shown = label; text.textContent = label; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── 벽돌 · 철벽 방어막 게이지 (2026-10-02) ─────────────────
// 타워 기둥 한가운데에 원형 게이지와 남은 초. 그림리퍼 낫 대기 게이지와 같은 모양, 파란 그라데이션.
// 같은 방어막을 또 놓으면 남은 시간이 원래 지속 시간만큼 늘어난다 (sync.js) — 링은 늘어난 전체에 대한 남은 몫.
// 모든 화면이 타워 데이터(damageReductionFrom · Until)로 그리므로 상대 · 관전 화면도 같다.
const _wallGauges = {};      // 타워 id → { el, text, towerEl, owner, pos, from, until, shown }
let _wallGaugeRaf = 0;

function _wallSync(towerEl, owner, pos, t, now) {
  const kind = typeof towerWallKind === 'function' ? towerWallKind(t, now) : null;
  let g = _wallGauges[towerEl.id];
  if (!kind) {
    if (g) { g.el.remove(); towerEl.classList.remove('tower-wall-flat'); delete _wallGauges[towerEl.id]; }
    return;
  }
  // 방벽의 끝을 데이터에 맞춘다. 놓는 연출을 못 본 화면(재접속 · 관전 입장 · 신호보다 데이터가 먼저)은 여기서 세운다
  const left = t.damageReductionUntil - now;
  const in3d = typeof towers3dWallEnd === 'function' &&
    (towers3dWallEnd(towerEl, kind, performance.now() + left) || towers3dWallShield(towerEl, kind, left));
  if (!in3d) towerEl.classList.add('tower-wall-flat');                 // WebGL이 없으면 테두리로만
  if (!g) {
    const el = document.createElement('div');
    el.className = 'wall-cd';
    el.innerHTML = '<i class="wall-cd-track"></i><b class="wall-cd-core"><em></em></b>';
    _fxLayer().appendChild(el);
    g = _wallGauges[towerEl.id] = { el, text: el.querySelector('em'), towerEl, owner, pos, shown: '' };
  }
  g.from  = t.damageReductionFrom || now;
  g.until = t.damageReductionUntil;
  g.el.classList.toggle('wall-cd-iron', kind === 'iron');
  if (!_wallGaugeRaf) _wallGaugeRaf = requestAnimationFrame(_wallGaugeStep);
}

function _wallGaugeStep() {
  _wallGaugeRaf = 0;
  const now = gameNow();
  Object.keys(_wallGauges).forEach(id => {
    const g = _wallGauges[id];
    const left = g.until - now;
    if (left <= 0 || !g.el.isConnected || g.towerEl.classList.contains('destroyed')) {
      g.el.remove();
      g.towerEl.classList.remove('tower-wall-flat');
      delete _wallGauges[id];
      return;
    }
    const p = (typeof towers3dTowerPoint === 'function' && towers3dTowerPoint(g.owner, g.pos, 0.5)) || _towerCenterStage(g.towerEl);
    g.el.style.left = p.x.toFixed(1) + 'px';
    g.el.style.top  = p.y.toFixed(1) + 'px';
    g.el.style.setProperty('--p', (left / Math.max(1, g.until - g.from) * 100).toFixed(1));
    const label = Math.ceil(left / 1000) + 's';
    if (label !== g.shown) { g.shown = label; g.text.textContent = label; }
  });
  if (Object.keys(_wallGauges).length) _wallGaugeRaf = requestAnimationFrame(_wallGaugeStep);
}

/**
 * 토템 하나가 없어진다.
 *   crumble (붕괴)    — 3D 토막이 쓰러지고, 바닥 장식(범위 원·풀·꽃잎)은 흩어져 사라진다
 *   blow    (토네이도) — 뿌리째 뽑혀 빙글빙글 돌며 바람 방향으로 날아가고, 잎·꽃잎이 흩날린다
 *   burn    (불)      — 불이 붙어 활활 타며 까맣게 그을다 재로 주저앉는다
 * @param {number} dir 바람 방향 (화면 기준 +1 오른쪽 · -1 왼쪽)
 */
function _destroyTotem(col, row, how = 'crumble', dir = 1, o = {}) {
  delete _totemTiles[col + ',' + row];
  const key = col + ',' + row;
  const cls = { blow: 'totem-blown', burn: 'totem-burnt', saw: 'totem-sawn', slash: 'totem-sawn', shatter: 'totem-shattered' }[how] || 'totem-broken';
  const life = { blow: 1600, burn: 1400, saw: 1500, slash: 1500, shatter: 1100 }[how] || 520;
  document.querySelectorAll(`.cast-fx-ground[data-tile="${key}"], .cast-totem-flat[data-tile="${key}"]`).forEach(el => {
    el.style.setProperty('--blow-x', (dir * 24) + 'px');
    el.style.setProperty('--blow-r', (dir * 80) + 'deg');
    el.classList.add(cls);
    setTimeout(() => el.remove(), life);
  });
  const p = _tileCenter(col, row);
  const sp = _groundToStage(p.x, p.y);
  if (how === 'saw' || how === 'slash') {
    // 톱 · 듀얼 검 — 나무가 반토막 나 넘어가고, 풀은 잘려 나간다 (잘린 풀잎이 흩날린다)
    if (typeof towers3dSawTotem === 'function') towers3dSawTotem(p.x, p.y, o.ux ?? dir, o.uy ?? 0, how === 'slash' ? 52 : 23);
    _spawnDust(sp.x, sp.y - 10, 90, 100, 900, 'rgba(214, 186, 128, 0.5)');
  } else if (how === 'shatter') {
    // 가시 — 발밑에서 꿰뚫려 산산조각
    if (typeof towers3dShatterTotem === 'function') towers3dShatterTotem(p.x, p.y);
    _spawnDust(sp.x, sp.y - 30, 120, 0, 800, 'rgba(160, 128, 96, 0.6)');
  } else if (how === 'blow') {
    if (typeof towers3dBlowTotem === 'function') towers3dBlowTotem(p.x, p.y, dir);
    _spawnDust(sp.x + dir * 30, sp.y - 30, 100, 0, 700, 'rgba(210, 225, 215, 0.4)');
  } else if (how === 'burn') {
    if (typeof towers3dBurnTotem === 'function') towers3dBurnTotem(p.x, p.y);
    _spawnDust(sp.x, sp.y - 60, 90, 300, 1500, 'rgba(40, 32, 30, 0.55)');
    _spawnDust(sp.x + 10, sp.y - 20, 70, 900, 1200, 'rgba(70, 60, 56, 0.5)');
  } else {
    if (typeof towers3dCrumbleTotem === 'function') towers3dCrumbleTotem(p.x, p.y);
    _spawnDust(sp.x, sp.y - 20, 110, 80, 900, 'rgba(150, 132, 110, 0.65)');
    _spawnDust(sp.x + 18, sp.y + 4, 80, 200, 800, 'rgba(150, 132, 110, 0.55)');
  }
}


// ── AI의 설치 자리 (토템 · 토네이도) ─────────────────────────
// AI도 사람과 똑같은 규칙으로 놓는다. 예전엔 토템을 늘 킹 타워 칸에 세웠다 —
// 사람은 살아 있는 타워가 선 칸에 세울 수 없다.

/**
 * AI가 토템을 세울 칸 — 자기 진영 · 살아 있는 타워가 선 칸 X · 토템이 이미 선 칸 X.
 * 붕괴가 일어나는 칸은 세워도 곧바로 무너지니 고르지 않는다.
 * @param {'my'|'enemy'} owner 토템을 세울 쪽 (이 화면 기준)
 * @param {number} radius 토템 범위
 * @param {(pos:string) => number} score 그 타워가 범위에 들면 얻는 값
 * @returns {{col,row,positions:string[],value:number}|null}
 */
function boardBestTotemTile(owner, radius, score) {
  const half = MAP_COLS / 2;
  const c0 = owner === 'my' ? 0 : half, c1 = owner === 'my' ? half - 1 : MAP_COLS - 1;
  const king = _towerTile(owner, 'king');
  const kc = king ? _tileCenter(king.col, king.row) : null;
  let best = null;
  for (let col = c0; col <= c1; col++) {
    for (let row = 0; row < MAP_ROWS; row++) {
      if (totemOnTile(col, row) || _tileHasLiveTower(col, row) || totemBreakZoneAt(col, row)) continue;
      const p = _tileCenter(col, row);
      const positions = ['left', 'king', 'right'].filter(pos => {
        if (!_towerAlive(owner, pos)) return false;
        const t = _towerTile(owner, pos);
        if (!t) return false;
        const c = _tileCenter(t.col, t.row);
        return Math.hypot(c.x - p.x, c.y - p.y) <= radius;
      });
      // 값이 같으면 킹에 가까운 칸 — 늘 같은 자리를 고르고, 뒤쪽 안전한 곳에 선다
      const value = positions.reduce((a, pos) => a + score(pos), 0) - (kc ? Math.hypot(kc.x - p.x, kc.y - p.y) * 1e-4 : 0);
      if (!best || value > best.value) best = { col, row, positions, value };
    }
  }
  return best && best.positions.length ? best : null;
}

/**
 * AI가 토네이도를 놓을 칸 — 사람처럼 자기 진영의 빈 칸에 놓고, 거기서 닿는 타워만 맞는다.
 * @param {'my'|'enemy'} targetOwner 맞는 쪽 (이 화면 기준) — AI가 사람을 치면 'my'
 * @param {(pos:string, damage:number) => number} score 그 타워에 그 피해를 주면 얻는 값
 * @returns {{point, targets, value}|null} point = 놓을 칸 한가운데 (이 화면의 바닥 좌표)
 */
function boardBestTornadoTile(targetOwner, score) {
  const mirrored = targetOwner === 'my';
  let best = null;
  for (let col = 0; col < MAP_COLS / 2; col++) {
    for (let row = 0; row < MAP_ROWS; row++) {
      if (!tornadoTileOk(col, row, mirrored)) continue;
      const targets = tornadoTargets(col, row, targetOwner);
      const value = targets.reduce((a, h) => a + score(h.pos, h.damage), 0);
      if (value > 0 && (!best || value > best.value)) {
        best = { point: _tileCenter(mirrored ? MAP_COLS - 1 - col : col, row), targets, value };
      }
    }
  }
  return best;
}

// ── 타워 칸 설치 (벚꽃) ──────────────────────────
// 타일 한 칸에 딱 맞는 네모로 조준한다. 네모는 바닥판 안에 그려져서
// 타일과 똑같이 눠어 보인다 (#cast-ground). 빈 땅에는 못 놓는다 —
// 회복은 대상이 있어야 의미가 있고, 그 제약이 어디에 놓을지 정하게 만든다.
let _towerTileAim = null;   // { col, row, ok, el }

/** 그 칸에 서 있는, 이 카드를 받을 수 있는 타워 */
function _towerAtTile(col, row) {
  return [...document.querySelectorAll('.tower')].find(el => {
    const st = el.style;
    if (Number(st.getPropertyValue('--col')) !== col) return false;
    if (Number(st.getPropertyValue('--row')) !== row) return false;
    return canDropOnTower(el.dataset.owner, el.dataset.pos);
  }) || null;
}

function _onTowerTileMove(cx, cy) {
  if (!_castArc) return;
  const { col, row } = _tileAt(cx, cy);
  let el = (col >= 0 && row >= 0 && col < MAP_COLS && row < MAP_ROWS) ? _towerAtTile(col, row) : null;
  // 벽돌 · 철벽 — 다른 방어막이 서 있는 타워에는 놓지 못한다 (같은 방어막이면 연장)
  const blocked = !!el && !_wallAllowed(_boardCurrentCard, el.dataset.owner, el.dataset.pos);
  if (blocked) el = null;
  _towerTileAim = { col, row, ok: !!el, el, blocked };

  // 칸 표시 — 논리 좌표 그대로 놓으면 바닥판이 알아서 눠혀 그려 준다
  const cell = _castArc.querySelector('.cast-tile-cell');
  if (cell) {
    cell.style.width  = TILE + 'px';
    cell.style.height = TILE + 'px';
    cell.style.left   = (col * TILE + TILE / 2) + 'px';
    cell.style.top    = (row * TILE + TILE / 2) + 'px';
  }

  _clearCastHighlights();
  if (el) {
    el.classList.add(_castOwnSideCard() ? 'drag-over-heal' : 'drag-over');
    _castCircleHits = [el];
  }
  _castArc.classList.toggle('cast-arc-ready', !!el);
  _castArc.classList.toggle('cast-circle-bad', !el);
}

/** 이 카드를 그 타워에 놓을 수 있는가 — 벽돌 · 철벽은 한 타워에 하나 (sync.js towerWallAllows) */
function _wallAllowed(card, owner, pos) {
  const key = owner === 'my' ? _boardPlayerKey : _boardEnemyKey;
  const tw  = _boardGameState?.[key]?.towers?.[pos];
  return typeof towerWallAllows !== 'function' || towerWallAllows(tw, card, gameNow());
}

function _towerTileFire(e) {
  if (!e.target?.closest?.('#map-viewport')) return;
  const aim = _towerTileAim;
  if (aim?.blocked && typeof showCenterNotice === 'function') showCenterNotice(t('wallOccupied'));
  if (!aim || !aim.ok) return;                 // 타워가 없는 칸 — 카드는 계속 들고 있는다
  const card  = _boardCurrentCard;
  const slot  = _boardDeckSlot;
  const owner = aim.el.dataset.owner;
  const pos   = aim.el.dataset.pos;
  // 꽃잎은 그 타워를 감고 오른다. 타워에 붙는 연출이라 자리를 실어 보내지 않는다 — 모든 화면(상대·관전자)이
  // 각자 그 타워 위에 그린다. 실어 보내면 반올림·조준 강조 오차가 그대로 옮겨 간다
  _cancelStickyDrag();
  if (!card) return;
  onCardDropped(card, slot, owner, pos, {});
}

// ── 바위 지옥 (세 덩이 투척) ────────────────────────────────
// 겨냥할 것이 없다 — 떨어지는 자리는 상대 타워 셋으로 이미 정해져 있다.
// 그래서 차징도 없고, 맵을 한 번 누르면 바로 던진다.

/** 그 타워가 아직 서 있는가 (카드를 들고 있지 않아도 답할 수 있어야 한다) */
function _towerAlive(owner, pos) {
  const key = owner === 'my' ? _boardPlayerKey : _boardEnemyKey;
  const t = _boardGameState?.[key]?.towers?.[pos];
  return !!t && t.alive !== false;
}

/**
 * 세 덩이가 '실제로' 떨어질 자리를 정한다.
 *
 * 부서진 타워로 갈 덩이는 허공에 떨어뜨리지 않고 **가운데(킹) 타워로** 옮겨 떨어진다.
 * 대신 그 덩이만 착지 피해와 돌가루 피해가 **절반**이 된다 (가운데 타워로 가는 덩이가
 * 하나든 둘이든 똑같이 적용되고, 원래 가운데로 가던 덩이는 그대로 다 들어간다).
 * 절반이 .5로 떨어지면 반올림한다 — 5→3, 7→4.
 *
 * 자리를 못 잡는 덩이는 null로 남겨 둔다 (사거리 표시의 궤적·원과 칸을 맞추기 위해).
 */
function castThrow3Shots(style, owner = 'enemy') {
  if (!style?.shots) return [];
  const half = n => Math.round(n / 2);
  return style.shots.map(shot => {
    if (_towerAlive(owner, shot.pos)) return { ...shot };
    if (shot.pos === 'king' || !_towerAlive(owner, 'king')) return null;   // 옮겨 갈 곳이 없다
    return {
      ...shot,
      pos:        'king',
      damage:     half(shot.damage),
      dot:        { ...shot.dot, dmgPerTick: half(shot.dot.dmgPerTick) },
      redirected: true
    };
  });
}

/** 세 덩이가 떨어질 자리의 화면 좌표 — 떨어뜨릴 곳이 없는 덩이는 null */
function _throw3Targets() {
  return castThrow3Shots(_castStyle, 'enemy').map(shot => {
    if (!shot) return null;
    const el = document.getElementById(`tower-enemy-${shot.pos}`);
    if (!el) return null;
    const r = (el.querySelector('.tower-block') || el).getBoundingClientRect();
    return { shot, el, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

function _onThrow3Move() {
  if (!_castArc) return;
  const from  = _throwOriginClient();
  const paths = _castArc.querySelectorAll('.cast-throw-path');
  const lands = _castLands ? _castLands.querySelectorAll('.cast-throw-land') : [];
  const hits  = _throw3Targets();
  let any = false;
  const shown = new Set();   // 부서진 타워 몫이 킹으로 몰리면 한 칸에 둘 — 표시는 하나만

  hits.forEach((h, i) => {
    const path = paths[i], land = lands[i];
    if (!h) {
      if (path) path.setAttribute('d', '');
      if (land) land.style.display = 'none';
      return;
    }
    any = true;
    if (land) {
      const t = _towerTile('enemy', h.shot.pos);
      if (!t || shown.has(h.shot.pos)) {
        land.style.display = 'none';
      } else {
        shown.add(h.shot.pos);
        const c = _tileCenter(t.col, t.row);   // 타워가 선 칸 그대로 — 바닥판 안이라 논리 좌표
        land.style.display = '';
        land.style.left = c.x + 'px';
        land.style.top  = c.y + 'px';
      }
    }
    if (path && from) {
      const mx = (from.x + h.x) / 2, my = (from.y + h.y) / 2;
      // 오래 날아가는 덩이일수록 높이 뜬다 — 셋이 겹쳐 보이지 않는다
      const lift = (90 + h.shot.flyMs * 0.06) * _mapScale();
      path.setAttribute('d', `M ${from.x} ${from.y} Q ${mx} ${my - lift} ${h.x} ${h.y}`);
    }
  });

  _castArc.classList.toggle('cast-arc-ready', any);
  _castArc.classList.toggle('cast-circle-bad', !any);
  if (_castLands) {
    _castLands.classList.toggle('cast-arc-ready', any);
    _castLands.classList.toggle('cast-circle-bad', !any);
  }

  // 타워 강조 — 덩이가 떨어질 타워 모두
  _clearCastHighlights();
  const els = hits.filter(Boolean).map(h => h.el);
  els.forEach(el => el.classList.add('drag-over'));
  _castCircleHits = els;
}

/** 바위 지옥을 던진다 — 어느 자리를 눌러도 상대 타워 셋으로 간다 */
function _throw3Fire(e) {
  if (!e.target?.closest?.('#map-viewport')) return;
  const st   = _castStyle;
  const hits = _throw3Targets().filter(Boolean);
  if (!hits.length) return;
  const card = _boardCurrentCard;
  const slot = _boardDeckSlot;
  _cancelStickyDrag();
  if (!card) return;
  onCardDropped(card, slot, 'enemy', 'king', {
    endMs:  st.endMs,
    castId: card.cast,
    shots:  hits.map(h => ({ ...h.shot }))
  });
}

/** 사거리(부채꼴 또는 일자 돌진) 안에 들어온 대상 타워 — 가장 가까운 하나 */
/**
 * 범위 안에 들어온 대상 타워 전부 (가까운 순).
 *
 * 예전에는 하나만 골랐고, 그리고 그 하나가 없으면 카드가 아예 나가지 않았다.
 * 지금은 '범위 안에 있으면 맞는다' 이라 갯수를 제한하지 않는다 —
 * 목검(반지름 160)처럼 좀은 사거리는 어차피 하나밖에 안 들어온다.
 *
 * 범위에 드는지 보는 조건 자체는 예전 그대로다 (모양별 규칙 + 코앞 보정).
 */
function _castTargetsInRange(cx, cy) {
  if (!_castStyle) return [];
  // 부채꼴·직선 공격은 '타워라는 개체에 닿았는가'로 판정한다 (투척은 예전 방식)
  // 돌(투척)도 착지 원이 발밑에 닿으면 맞는다 — 다만 커서가 건물 위라는 이유로는 맞지 않는다 (_castTargetsTouching)
  if (_castStyle.shape === 'fan' || _castStyle.shape === 'lunge' || _castStyle.shape === 'throw') return _castTargetsTouching(cx, cy);
  const p = _clientToStage(cx, cy);
  const found = [];
  document.querySelectorAll('.tower').forEach(el => {
    if (!canDropOnTower(el.dataset.owner, el.dataset.pos)) return;
    const c    = _towerCenterStage(el);
    const dx   = c.x - p.x, dy = c.y - p.y;
    const dist = Math.hypot(dx, dy);
    // 커서를 타워에 바로 올려놀은 경우엔 모양을 따지지 않는다
    // (각도만 보면 정중앙에서 위아래로 몇 px만 어긋나도 사거리 밖으로 판정된다)
    const onTower = dist <= CAST_NEAR_HIT;
    if (!onTower) {
      if (_castStyle.shape === 'lunge') {
        // 일자 돌진 — 오른쪽으로 뻗은 길 안에 있어야 한다
        if (dx < 0 || dx > _castStyle.radius || Math.abs(dy) > _castStyle.band / 2) return;
      } else if (_castStyle.shape === 'circle' || _castStyle.shape === 'throw') {
        if (dist > _castStyle.radius) return;   // 원 안이면 방향은 따지지 않는다
      } else {
        if (dist > _castStyle.radius) return;
        if (Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) > _castStyle.arcDeg / 2) return;   // 0° = 오른쪽
      }
    } else if (dist > _castStyle.radius) return;
    found.push({ el, dist });
  });
  return found.sort((a, b) => a.dist - b.dist).map(o => o.el);
}


// ── 범위가 타워 개체에 닿는가 (목검 · 듀얼 검 · 바람) ──────────────────
// 예전엔 타워 '한가운데 점'이 범위에 들어야 맞았다. 이제는 범위가 타워의 발밑
// (3D 건물의 기단)에 조금이라도 걸치면 맞는다. 둘 다 바닥 좌표로 잰다 —
// 범위 표시도 바닥판 안에 그려지므로, 눈에 보이는 것과 판정이 같다.
// 커서가 건물 자체(입체 모형의 누르는 판) 위에 있어도 맞은 것으로 친다.

// 타워 발밑 한 변의 절반 — towers3d.js 기단(몸통 + 16)과 같다
const CAST_TOWER_HALF = { king: 39, side: 33 };

function _towerFootprint(el) {
  const c = _tileCenter(Number(el.style.getPropertyValue('--col')), Number(el.style.getPropertyValue('--row')));
  return { x: c.x, y: c.y, half: el.classList.contains('king-tower') ? CAST_TOWER_HALF.king : CAST_TOWER_HALF.side };
}

/** 범위(부채꼴 또는 직선)가 그 발밑 네모에 걸치는가 — a = 범위의 기준점(바닥 좌표) */
function castRangeTouches(st, a, f) {
  const h = f.half;
  const inBox = (x, y) => Math.abs(x - f.x) <= h && Math.abs(y - f.y) <= h;
  if (st.shape === 'lunge') {
    // 직선 = 기준점에서 오른쪽으로 radius 만큼, 폭 band — 네모끼리 겹침
    return f.x + h >= a.x && f.x - h <= a.x + st.radius &&
           f.y + h >= a.y - st.band / 2 && f.y - h <= a.y + st.band / 2;
  }
  if (st.shape === 'throw') {
    // 착지 원 — 발밑 네모에서 원 중심에 가장 가까운 점이 반지름 안이면 닿는다
    const nx = Math.max(f.x - h, Math.min(a.x, f.x + h));
    const ny = Math.max(f.y - h, Math.min(a.y, f.y + h));
    return Math.hypot(nx - a.x, ny - a.y) <= st.radius;
  }
  // 부채꼴 — 0° = 오른쪽, ±arcDeg/2
  const half = st.arcDeg / 2;
  const inFan = (x, y) => {
    const dx = x - a.x, dy = y - a.y;
    const d = Math.hypot(dx, dy);
    if (d > st.radius) return false;
    return d < 0.5 || Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) <= half;
  };
  if (inBox(a.x, a.y)) return true;                                  // 꼭짓점이 타워 위
  // 네모 안의 점이 부채꼴에 들어가는가 (가장 가까운 점 + 격자)
  const nx = Math.max(f.x - h, Math.min(a.x, f.x + h));
  const ny = Math.max(f.y - h, Math.min(a.y, f.y + h));
  if (inFan(nx, ny)) return true;
  const N = 8;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    if (inFan(f.x - h + 2 * h * i / N, f.y - h + 2 * h * j / N)) return true;
  }
  // 부채꼴의 테두리(양 변 + 호)가 네모를 스치는가 — 격자 사이로 빠지는 것을 막는다
  for (const deg of [-half, half]) {
    const r = deg * Math.PI / 180;
    for (let d = 0; d <= st.radius; d += 6) if (inBox(a.x + Math.cos(r) * d, a.y + Math.sin(r) * d)) return true;
  }
  for (let deg = -half; deg <= half; deg += 3) {
    const r = deg * Math.PI / 180;
    if (inBox(a.x + Math.cos(r) * st.radius, a.y + Math.sin(r) * st.radius)) return true;
  }
  return false;
}

/**
 * 직선 카드(듀얼 검 · 바람)의 범위에 닿은 상대 토템 중 가장 가까운 하나 — 그 토템이 닿은 타워보다 가까우면 토템을 친다.
 * @returns {{col,row,f,d}|null}
 */
function _castTotemTouching(cx, cy, st = _castStyle) {
  if (!st?.totemHit) return null;
  const a = _clientToGround(cx, cy);
  let best = null;
  Object.keys(_totemTiles).forEach(key => {
    const [c, r] = key.split(',').map(Number);
    if (c < MAP_COLS / 2 || !totemOnTile(c, r)) return;
    const p = _tileCenter(c, r);
    const f = { x: p.x, y: p.y, half: SAW_TOTEM_HALF };
    if (!castRangeTouches(st, a, f)) return;
    const d = Math.hypot(f.x - a.x, f.y - a.y);
    if (!best || d < best.d) best = { col: c, row: r, f, d };
  });
  if (!best) return null;
  const tower = _castTargetsTouching(cx, cy)[0];
  if (tower) {
    const tf = _towerFootprint(tower);
    if (Math.hypot(tf.x - a.x, tf.y - a.y) < best.d) return null;   // 타워가 더 가깝다
  }
  return best;
}

/** 조준 중인 토템 표시 — 그 칸의 바닥 장식이 금빛으로 빛난다 */
function _castTotemMark(t) {
  document.querySelectorAll('.totem-aimed').forEach(el => el.classList.remove('totem-aimed'));
  if (t) document.querySelectorAll(`.cast-fx-ground[data-tile="${t.col},${t.row}"], .cast-totem-flat[data-tile="${t.col},${t.row}"]`)
    .forEach(el => el.classList.add('totem-aimed'));
}

/** 범위에 닿은 대상 타워 전부 (가까운 순) */
function _castTargetsTouching(cx, cy) {
  const a = _clientToGround(cx, cy);
  const under = document.elementFromPoint(cx, cy)?.closest?.('.tower');
  const found = [];
  document.querySelectorAll('.tower').forEach(el => {
    if (!canDropOnTower(el.dataset.owner, el.dataset.pos)) return;
    const f = _towerFootprint(el);
    // 돌은 커서가 가리키는 바닥에 떨어진다 — 커서가 건물 지붕 위여도 떨어지는 곳은 그 뒤쪽 땅이라
    // '건물 위를 가리켰다'만으로 맞았다고 치면 폭발과 판정이 어긋난다
    const onBody = el === under && _castStyle.shape !== 'throw';
    if (!onBody && !castRangeTouches(_castStyle, a, f)) return;
    found.push({ el, dist: Math.hypot(f.x - a.x, f.y - a.y) });
  });
  const hits = found.sort((p, q) => p.dist - q.dist).map(o => o.el);
  // 단일 대상 카드(목검·듀얼 검·바람)는 둘이 닿아도 가장 가까운 하나만 — 조준 강조도 하나만 뜬다
  return _castStyle.single ? hits.slice(0, 1) : hits;
}

/**
 * 이 클릭을 '맵에 쓴 것'으로 볼 수 있는가.
 *
 * 허공에도 쓸 수 있게 되면서 필요해졌다 — 이게 없으면 덱에서 다른 카드를
 * 고르려고 누른 클릭까지 '허공 발사'로 여겨서 카드가 그냥 날아간다.
 */
function _castPointOnMap(cx, cy) {
  const p = _clientToStage(cx, cy);
  return p.x >= 0 && p.x <= MAP_W && p.y >= 0 && p.y <= MAP_H;
}

function _castClickOnMap(e) {
  return !!e.target?.closest?.('#map-viewport') && _castPointOnMap(e.clientX, e.clientY);
}

/**
 * 사거리 카드 한 발 — 맞힐 타워가 없어도 그대로 나간다.
 * 에너지와 카드는 그대로 소모된다 — 빗나간 대가다.
 * @param {HTMLElement[]} hits 범위 안에 들어온 타워들 (빈 배열이면 허공)
 * @param {object} extra 투척처럼 추가로 업을 값이 있는 카드용
 */
/**
 * 허공에 쓴 공격의 연출 기준점 (화면 좌표).
 *
 * 연출은 누른 자리(= 범위의 시작점)가 아니라 '범위 안'에서 일어나야 한다:
 *   · 부채꼴(목검) — 꼭짓점에서 반지름의 60% 앞. 줄인 베기 그림(fx.scale)이 그 둘레를 휩쓸어
 *     부채꼴 안에서 벤다.
 *   · 직선(듀얼 검·바람) — 범위 끝. 돌진·바람이 범위를 따라 들어와 끝에서 베거나 부딪힌다.
 * 범위는 바닥에 그려지므로 바닥 좌표로 옮긴 뒤 화면 좌표로 되돌린다.
 * 투척(돌)은 떨어지는 자리가 곧 누른 자리라 그대로 쓴다.
 */
function _castAirPoint(cx, cy) {
  const st = _castStyle;
  if (!st || (st.shape !== 'fan' && st.shape !== 'lunge')) return _clientToStage(cx, cy);
  const a = _clientToGround(cx, cy);
  const ahead = st.shape === 'fan' ? st.radius * 0.6 : st.radius;
  return _groundToStage(a.x + ahead, a.y);
}

function _castFireAt(cx, cy, hits, extra = null) {
  const card = _boardCurrentCard;
  const slot = _boardDeckSlot;
  // 듀얼 검 · 바람이 상대 토템을 쳤다 — 타워 · 유닛은 맞지 않는다 (castId 끝의 '@t' — 다른 화면도 그 칸의 토템을 친다)
  const totem = _castTotemTouching(cx, cy);
  if (totem && card) {
    const point = _groundToStage(totem.f.x, totem.f.y);
    const kingEl = document.getElementById('tower-enemy-king');
    const k = kingEl ? _towerCenterStage(kingEl) : point;
    _cancelStickyDrag();
    onCardDropped(card, slot, 'enemy', 'king', {
      positions: [], unitTiles: [], castId: card.cast + '@t', point,
      dx: Math.round(point.x - k.x), dy: Math.round(point.y - k.y),
    });
    return;
  }
  if (!extra?.unitTiles && (_castStyle?.shape === 'fan' || _castStyle?.shape === 'lunge')) {
    extra = { ...(extra || {}), unitTiles: _castUnitTilesTouching(_castStyle, _clientToGround(cx, cy)) };
  }
  // 양쪽 다 쓰는 dual 카드는 실제로 들어온 타워 쪽으로 붙는다.
  // 허공이면 카드 종류로 정한다 (회복·방어는 내 쪽, 나머지는 상대 쪽).
  const owner = hits[0]?.dataset.owner || (_castOwnSideCard() ? 'my' : 'enemy');
  const positions = hits.filter(el => el.dataset.owner === owner).map(el => el.dataset.pos);

  // 부채꼴·직선 공격이 타워에 닿았으면 연출은 누른 자리가 아니라 그 타워에 고정한다 —
  // 범위 끝에 스친 만큼만 맞아도 타워에 정통으로 들어간 것처럼 보여야 한다.
  // 자리(point)를 보내지 않으면 모든 화면(상대·관전자)이 각자 그 타워 위에 그린다.
  const anchored = positions.length > 0 && (_castStyle?.shape === 'fan' || _castStyle?.shape === 'lunge');
  if (anchored) {
    _cancelStickyDrag();
    if (!card) return;
    onCardDropped(card, slot, owner, positions[0], { ...(extra || {}), positions });
    return;
  }

  const point = extra?.point || _castAirPoint(cx, cy);
  // 상대 화면에서도 같은 자리에 보이도록 맞는 쪽 킹 타워 기준 좌표로 보낸다
  const kingEl = document.getElementById(`tower-${owner}-king`);
  const k = kingEl ? _towerCenterStage(kingEl) : point;
  _cancelStickyDrag();
  if (!card) return;
  onCardDropped(card, slot, owner, 'king', {
    ...(extra || {}),
    positions,
    point,
    dx: Math.round(point.x - k.x),
    dy: Math.round(point.y - k.y)
  });
}

function _onStickyMove(e) {
  if (_castStyle?.shape === 'summon') { _onSummonMove(e.clientX, e.clientY); return; }
  if (_castStyle?.shape === 'towertile') { _onTowerTileMove(e.clientX, e.clientY); return; }
  if (_castStyle?.shape === 'circle') { _onCircleMove(e.clientX, e.clientY); return; }
  if (_castStyle?.shape === 'throw')  { _onThrowMove(e.clientX, e.clientY);  return; }
  if (_castStyle?.shape === 'throw3') { _onThrow3Move(e.clientX, e.clientY); return; }
  if (_castStyle?.shape === 'tile')   { _onTileMove(e.clientX, e.clientY);   return; }
  if (_castStyle?.shape === 'area')   { _onAreaMove(e.clientX, e.clientY);   return; }
  if (_castStyle?.shape === 'wave')   { _onWaveMove(e.clientX, e.clientY);   return; }
  if (_castStyle?.shape === 'shot')   { _onShotMove(e.clientX, e.clientY);   return; }
  if (_castStyle?.shape === 'nearest') { _onSawMove(e.clientX, e.clientY); return; }

  if (_castStyle) {
    _moveCastArc(e.clientX, e.clientY);
    // 범위 안에 들어온 타워를 전부 강조한다 — 둘 이상이면 둘 다 맞는다
    // 듀얼 검 · 바람은 상대 토템이 더 가까우면 토템을 겨눈다 (단일 — 토템을 치면 타워는 맞지 않는다)
    const totem = _castTotemTouching(e.clientX, e.clientY);
    _castTotemMark(totem);
    const hits = totem ? [] : _castTargetsInRange(e.clientX, e.clientY);
    _clearCastHighlights();
    const cls = _castOwnSideCard() ? 'drag-over-heal' : 'drag-over';
    hits.forEach(el => el.classList.add(el.dataset.owner === 'my' ? 'drag-over-heal' : cls));
    _castCircleHits = hits;
    if (_castArc) _castArc.classList.toggle('cast-arc-ready', hits.length > 0 || !!totem);
    return;
  }

  _moveStickyClone(e.clientX, e.clientY);

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const tower = under?.closest?.('.tower');

  if (_dragHighlightedTower && _dragHighlightedTower !== tower) {
    _dragHighlightedTower.classList.remove('drag-over', 'drag-over-heal');
    _dragHighlightedTower = null;
  }
  if (tower) {
    const owner = tower.dataset.owner;
    const pos   = tower.dataset.pos;
    if (canDropOnTower(owner, pos)) {
      const _ct = _boardCurrentCard?.type;
      let hlClass = 'drag-over';
      if (_ct === 'heal' || _ct === 'defense') hlClass = 'drag-over-heal';
      else if (_ct === 'dual') hlClass = (owner === 'my') ? 'drag-over-heal' : 'drag-over';
      tower.classList.add(hlClass);
      _dragHighlightedTower = tower;
    }
  }
}

function _onStickyClick(e) {
  // 맵을 끌고 난 직후의 클릭 — 카드를 놓으려던 것이 아니다. 카드는 계속 들고 있는다
  if (_panJustDragged()) return;
  // 톱 — 강조된 대상에게 바로 썰기 시작한다
  if (_castStyle?.saw) { if (_castClickOnMap(e)) _sawStart(e.clientX, e.clientY); return; }

  // 그림리퍼 — 초록 칸에만 소환된다
  if (_castStyle?.shape === 'summon') { _summonFire(e); return; }
  // 바위 지옥 — 겨냥할 것 없이 상대 타워 셋으로 바로 날아간다
  if (_castStyle?.shape === 'throw3') { _throw3Fire(e); return; }
  // 돌 — 스페이스바로 차해 둔 단계대로 던진다
  if (_castStyle?.shape === 'throw')  { _throwFire(e);  return; }
  // 토네이도 — 커서가 가리키는 칸에 설치한다
  if (_castStyle?.shape === 'tile')   { _tileFire(e);   return; }
  // 지진·붕괴 — 칸에 맞춘 범위를 그 자리에 쓴다
  if (_castStyle?.shape === 'area')   { _areaFire(e);   return; }
  // 파도 — 내 진영에서 출발해 맵 끝까지
  if (_castStyle?.shape === 'wave')   { _waveFire(e);   return; }
  // 화살 — 커서 자리에서 쏜다 (화살은 Space로 차 둔 단계대로)
  if (_castStyle?.shape === 'shot')   { _shotFire(e);   return; }
  // 벚꽃 — 타워가 선 칸에만 놓인다
  if (_castStyle?.shape === 'towertile') { _towerTileFire(e); return; }

  // 토템 설치 — 가리킨 칸 한가운데에 놓인다. 원 밖의 타워는 효과를 받지 않는다
  if (_castStyle?.shape === 'circle') {
    if (!e.target?.closest?.('#map-viewport')) return;
    const aim = _totemAim;
    if (!aim || !aim.ok) return;              // 못 놓는 칸 — 카드를 계속 들고 있다
    const point = aim.point;
    // 붕괴가 일어나는 중인 자리 — 세울 수는 있지만 곧바로 무너져 회복이 들어가지 않는다
    const doomed = totemBreakZoneAt(aim.col, aim.row);
    const hits  = doomed ? [] : _towersInTotemRange(point);
    const card  = _boardCurrentCard;
    const slot  = _boardDeckSlot;
    const owner = _castOwnSideCard() ? 'my' : 'enemy';
    // 상대 화면에서도 같은 자리에 놓이도록 내 킹 타워 기준 좌표로 보낸다
    const kingEl = document.getElementById(`tower-${owner}-king`);
    const k = kingEl ? _towerCenterStage(kingEl) : point;
    _cancelStickyDrag();
    if (card) {
      onCardDropped(card, slot, owner, 'king', {
        positions: hits.map(el => el.dataset.pos),
        totem: totemTag(aim.col, aim.row),      // 붕괴가 이 토템의 회복을 찾아 멈춘다
        point,
        dx: Math.round(point.x - k.x),
        dy: Math.round(point.y - k.y)
      });
    }
    return;
  }

  // 사거리 연출 카드 — 클릭한 자리에 그대로 나가고, 범위 안의 타워가 맞는다.
  // 타워가 하나도 안 들어와도 연출은 나가고 카드는 소모된다.
  if (_castStyle) {
    if (!_castClickOnMap(e)) return;   // 맵 밖 클릭 — 카드는 계속 들고 있는다
    _castFireAt(e.clientX, e.clientY, _castTargetsInRange(e.clientX, e.clientY));
    return;
  }

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const tower = under?.closest?.('.tower');

  if (tower && _boardCurrentCard) {
    const owner = tower.dataset.owner;
    const pos   = tower.dataset.pos;
    if (canDropOnTower(owner, pos)) {
      onCardDropped(_boardCurrentCard, _boardDeckSlot, owner, pos);
    }
  }
  _cancelStickyDrag();
}

function _onStickyKeyDown(e) {
  if (e.key === 'Escape') { _cancelStickyDrag(); return; }
  // 스페이스바 = 투척 차징. 다른 카드를 들었을 때는 생기는 일이 없다
  if (e.key === ' ' || e.code === 'Space') {
    if (_throwChargeKeyDown()) e.preventDefault();   // 화면이 스크롤로 뛰는 것을 막는다
  }
}

function _onStickyKeyUp(e) {
  if (e.key === ' ' || e.code === 'Space') {
    if (_throwChargeKeyUp()) e.preventDefault();
  }
}

/** 매치 종료 등으로 카드 사용을 막을 때 — 들고 있던 카드를 놓는다 */
function cancelStickyDrag() { if (_stickyMode) _cancelStickyDrag(); }

function _cancelStickyDrag() {
  _stickyMode = false;
  document.removeEventListener('pointermove', _onStickyMove);
  document.removeEventListener('click',       _onStickyClick);
  document.removeEventListener('keydown',     _onStickyKeyDown);
  document.removeEventListener('keyup',       _onStickyKeyUp);
  _throwChargeStart = 0;
  _throwHeldMs      = 0;
  _throwPoint       = null;
  cancelAnimationFrame(_throwRaf);
  document.body.style.cursor = '';

  if (_dragHighlightedTower) {
    _dragHighlightedTower.classList.remove('drag-over', 'drag-over-heal');
    _dragHighlightedTower = null;
  }
  _clearCastHighlights();
  if (_castArc)      { _castArc.remove(); _castArc = null; }
  if (_castLands)    { _castLands.remove(); _castLands = null; }
  if (_castHud)      { _castHud.remove(); _castHud = null; }
  _shotAim = null;
  _summonAim = null;
  _castStyle = null;
  _totemAim     = null;
  _towerTileAim = null;
  _areaAim      = null;
  if (_dragClone)    { _dragClone.remove(); _dragClone = null; }
  if (_dragSourceEl) { _dragSourceEl.classList.remove('dragging'); _dragSourceEl = null; }
  boardClearDraggingCard();
}

/** setupDragTargets — 포인터 이벤트 방식으로 대체됨 */
function setupDragTargets() {}

/** 드래그 시작 시 board에 현재 카드 등록 */
function boardSetDraggingCard(card, slotIndex) {
  _boardCurrentCard = card;
  _boardDeckSlot    = slotIndex;
  if (typeof deckSetSelectedSlot === 'function') deckSetSelectedSlot(slotIndex);
}

/** 드래그 종료 시 초기화 */
function boardClearDraggingCard() {
  _boardCurrentCard = null;
  _boardDeckSlot    = null;
  if (typeof deckSetSelectedSlot === 'function') deckSetSelectedSlot(null);
}

/**
 * 이 타워에 드롭 가능한지 검사
 *   attack / control → enemy 타워
 *   heal / defense   → my 타워
 *   revival(defense) → my 킹 타워 (죽어있어도 허용)
 */
function canDropOnTower(owner, pos) {
  if (!_boardCurrentCard) return false;
  if (!_boardGameState) return false;

  const cardType    = _boardCurrentCard.type;
  const isDual      = cardType === 'dual';
  const isOwnTarget = cardType === 'heal' || cardType === 'defense';

  if (!isDual) {
    if (isOwnTarget  && owner !== 'my')    return false;
    if (!isOwnTarget && owner !== 'enemy') return false;
  }

  const dataKey   = owner === 'my' ? _boardPlayerKey : _boardEnemyKey;
  const towerData = _boardGameState[dataKey]?.towers?.[pos];
  if (!towerData) return false;

  // 부활 카드 전용: 킹 타워에만 허용, 죽어있어도 가능
  if (_boardCurrentCard.effect?.revival) {
    return pos === 'king';
  }

  if (!towerData.alive) return false;
  return true;
}

// ── 그림리퍼 소환 칸 ─────────────────────────────────────
// 내 진영(강 앞까지)의 칸 하나. 상대 타워가 앞에 있는 줄이어야 하고,
// 그 줄의 내 타워보다 앞(상대 쪽)이어야 한다 — 타워 칸·타워 뒤쪽은 안 된다.
// 처음엔 옆 타워 줄(2·6행)만, 상대 옆 타워가 둘 다 무너지면 킹 줄(4행)도 (units.js unitSummonTarget).
// 그 밖의 칸은 전부 빨갛게 보인다.
let _summonAim = null;   // { col, row, target }

function _summonTarget(col, row) {
  if (typeof unitSummonTarget !== 'function') return null;
  return unitSummonTarget(col, row, _boardGameState?.[_boardEnemyKey]?.towers);
}

function _summonGridHtml() {
  let h = '';
  for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) {
    const ok = !!_summonTarget(c, r);
    h += `<i class="cast-summon-tile ${ok ? 'ok' : 'bad'}" style="left:${c * TILE}px;top:${r * TILE}px"></i>`;
  }
  return h;
}

function _onSummonMove(cx, cy) {
  if (!_castArc) return;
  const { col, row } = _tileAt(cx, cy);
  const target = _summonTarget(col, row);
  _summonAim = { col, row, target };
  const cell = _castArc.querySelector('.cast-summon-cell');
  const path = _castArc.querySelector('.cast-summon-path');
  const onMap = col >= 0 && col < MAP_COLS && row >= 0 && row < MAP_ROWS;
  if (cell) {
    cell.style.display = onMap ? '' : 'none';
    cell.style.left = (col * TILE) + 'px';
    cell.style.top  = (row * TILE) + 'px';
    cell.classList.toggle('bad', !target);
  }
  // 걸어갈 길 — 놓은 칸에서 목표 타워 바로 앞 칸까지
  _clearCastHighlights();
  if (path) {
    if (target) {
      const stop = typeof unitStopTile === 'function'
        ? unitStopTile(_boardPlayerKey || 'p1', target, _boardPlayerKey === 'p2' ? MAP_COLS - 1 - col : col, row) : null;
      const stopCol = stop ? (_boardPlayerKey === 'p2' ? MAP_COLS - 1 - stop[0] : stop[0]) : col;
      path.style.display = '';
      path.style.left  = (col * TILE + TILE / 2) + 'px';
      path.style.top   = (row * TILE + TILE / 2) + 'px';
      path.style.width = Math.max(0, (stopCol - col) * TILE) + 'px';
      const el = document.getElementById(`tower-enemy-${target}`);
      if (el) { el.classList.add('drag-over'); _castCircleHits = [el]; }
    } else {
      path.style.display = 'none';
    }
  }
  _castArc.classList.toggle('cast-arc-ready', !!target);
}

function _summonFire(e) {
  if (!_castClickOnMap(e)) return;            // 맵 밖 클릭 — 카드는 계속 들고 있는다
  _onSummonMove(e.clientX, e.clientY);
  const aim = _summonAim;
  if (!aim || !aim.target) return;            // 빨간 칸 — 카드는 계속 들고 있는다
  const card = _boardCurrentCard;
  const slot = _boardDeckSlot;
  _cancelStickyDrag();
  if (!card) return;
  onCardDropped(card, slot, 'enemy', aim.target, {
    positions: [],
    summon: { col: _boardPlayerKey === 'p2' ? MAP_COLS - 1 - aim.col : aim.col, row: aim.row, target: aim.target }
  });
}

// ── 공격 범위에 든 소환 유닛 ─────────────────────────────────
// 칸 단위로 넘긴다 (이 화면 기준 [열, 행, 피해?]). 유닛은 서 있는(반올림한) 칸으로 맞는다.

/** 부채꼴·직선이 닿는 칸 — 타워와 같은 판정(발밑 네모)을 칸 한가운데에 한다 */
function _castUnitTilesTouching(st, a) {
  const out = [];
  for (let r = 0; r < MAP_ROWS; r++) for (let c = 0; c < MAP_COLS; c++) {
    const f = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, half: 30 };
    if (castRangeTouches(st, a, f)) out.push([c, r]);
  }
  return out;
}

/** 토네이도가 지나가는 칸 — 놓은 칸 앞에서 멈추는 열까지, 다 자란 폭 안의 줄. 멀리 갈수록 세다 */
function _tornadoUnitTiles(col, row, hits) {
  const r = tornadoRadius(col);
  const stopCol = hits.length ? Math.min(...hits.map(h => h.col)) : MAP_COLS - 2;
  const out = [];
  for (let c = col; c <= stopCol; c++) for (let rr = 0; rr < MAP_ROWS; rr++) {
    if (Math.abs((rr - row) * TILE) > r) continue;
    out.push([c, rr, tornadoDamage(Math.max(1, c - col))]);
  }
  return out;
}

/** 유닛이 받는 피해 — 그 카드가 타워에 주는 만큼 (즉시 + 지속 합) */
function _castUnitDamage(card, opts) {
  if (typeof opts?.damage === 'number') return opts.damage;
  const eff = card?.effect?.dualEffect ? card.effect.dualEffect.attack : card?.effect;
  if (!eff) return 0;
  const dots = Array.isArray(eff.dot) ? eff.dot : eff.dot ? [eff.dot] : [];
  const dot = dots.reduce((s, d) => s + (d.dmgPerTick || 0) * (d.ticks || 0), 0);
  return (eff.damage || 0) + dot;
}

/**
 * 드롭 이벤트 처리 — deck.js의 onCardUsed 콜백으로 전달
 */
function onCardDropped(card, slotIndex, targetOwner, targetPos, opts = null) {
  if (typeof window.onCardUsed !== 'function') return;
  if (castBlocked(card)) { castNotifyBlocked(); return; }

  // 그 카드만 연출이 도는 동안 잠근다 (다른 카드는 그대로 쓸 수 있다)
  // 투척은 차징 단계에 따라 연출 길이가 달라져서 opts가 실제 길이를 들고 온다
  const st = cardCastStyle(card);
  if (st && st.hitMs > 0) _castBusyUntil[card.id] = Date.now() + (opts?.endMs || st.endMs);
  // 시전 연출이 있는 카드는 연출이 마무리되는 순간에 피해가 들어간다
  const hitMs = playCastFx(opts?.castId || card?.cast, targetOwner, targetPos, opts?.point || null);

  // 공격 범위에 든 소환 유닛 (피해가 들어가는 순간의 자리로 판정한다 — js/units.js)
  if (opts?.unitTiles?.length) {
    const dmg = _castUnitDamage(card, opts);
    const flip = _boardPlayerKey === 'p2';
    const tiles = opts.unitTiles
      .filter(([c, r]) => c >= 0 && c < MAP_COLS && r >= 0 && r < MAP_ROWS)
      .map(([c, r, d]) => [flip ? MAP_COLS - 1 - c : c, r, d ?? dmg])
      .filter(t => t[2] > 0);
    opts = { ...opts, unitStrike: tiles.length ? { tiles, delayMs: hitMs } : null };
  }

  // 침수·파도 — 유닛 피해가 시각마다 따로다 (줄마다 물살 · 틱마다 범위)
  if (opts?.unitStrikes?.length) {
    const flip = _boardPlayerKey === 'p2';
    const list = opts.unitStrikes.map(s => ({
      delayMs: s.delayMs,
      status: s.status,
      tiles: s.tiles.filter(([c, r]) => c >= 0 && c < MAP_COLS && r >= 0 && r < MAP_ROWS)
                    .map(([c, r, d]) => [flip ? MAP_COLS - 1 - c : c, r, d]),
    })).filter(s => s.tiles.length);
    opts = { ...opts, unitStrikeList: list };
  }

  // 바위 지옥처럼 대상마다 도착 시각·피해가 다른 카드는 opts.shots를 그대로 넘긴다.
  // AI나 모바일 한 번 누르기로 들어와 shots가 없을 때도 표에서 채워 준다
  if (st?.shape === 'throw3' && !opts?.shots) {
    opts = { ...(opts || {}), endMs: st.endMs, castId: card.cast,
             shots: castThrow3Shots(st, targetOwner).filter(Boolean) };
  }
  window.onCardUsed(card, slotIndex, targetOwner, targetPos, hitMs, opts);
}

/**
 * 반사 경고 표시 — towerEl 위에 ⚠️ 아이콘 3초 후 onExpire 호출
 */
const _mirrorWarningTimeouts = [];

function showMirrorWarning(towerEl, onExpire) {
  const rect = towerEl.getBoundingClientRect();
  const warn = document.createElement('div');
  warn.className = 'mirror-warning-icon';
  const pt = _clientToStage(rect.left + rect.width / 2, rect.top + rect.height / 2);
  warn.style.left = pt.x + 'px';
  warn.style.top  = pt.y + 'px';
  _fxLayer().appendChild(warn);

  const t = setTimeout(() => {
    warn.classList.add('fading');
    setTimeout(() => warn.remove(), 400);
    onExpire();
  }, 3000);
  _mirrorWarningTimeouts.push(t);
}

function clearMirrorWarnings() {
  _mirrorWarningTimeouts.forEach(clearTimeout);
  _mirrorWarningTimeouts.length = 0;
  document.querySelectorAll('.mirror-warning-icon').forEach(el => el.remove());
}

/** 전설 카드 등장 플래시 */
function showLegendaryFlash() {
  const el = document.createElement('div');
  el.className = 'legendary-flash';
  _fxLayer().appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ════════════════════════════════════════════════════════════
//  톱 (가시의 진화, 2026-10-01 · 2026-10-03 리워크)
//  커서에서 닿는 거리(reach) 안의 가장 가까운 대상 하나 — 상대 타워 · 상대 토템(숲의정령 · 흰꽃). 그 대상이 강조된다.
//  클릭하면 바로 시작한다 (차징 · 게이지 없음). 톱은 커서 쪽에서 그 대상에게 날아들어, 커서에서 본 방향 그대로 썬다
//  (대상이 커서보다 조금 위·아래에 있어도 비스듬히 다가간다).
//    · 타워 — 끝까지(6초) 저절로 썬다. 0.5초마다 7 (12번 = 84)
//    · 토템 — totemCutMs 만에 나무가 반토막 나며 풀이 잘려 나간다 (상성 — 회복도 멈춘다). 톱은 거기서 끝
//    · 대상이 없으면 커서 자리의 허공을 썬다 (그 칸의 소환 유닛만)
//  피해는 틱마다 그 순간 예약(pendingHits)으로 넣는다 — 정확히 한 번은 기존 예약과 같다.
//  끝난 순간은 pendingHits의 sawStop 줄로 알린다 (상대·관전 화면이 그 톱을 빼낸다 — sync.js)
//  다른 화면에는 castId 'saw@톱번호@방향' 으로 보낸다 — 방향은 '맞는 쪽으로 곧장'을 0으로 한 5° 단위 (instantHits type ≤ 20자)
// ════════════════════════════════════════════════════════════
const _sawFx = {};          // sawId → { id3d, el, timer }
let _sawHold = null;        // 이 화면이 지금 썰고 있는 톱
const SAW_TOTEM_HALF = 24;  // 토템 받침 한 변의 절반 (towers3d.js 받침 46)

/** 지금 톱을 들고 있다 (조준 중) */
function _sawAiming() { return _stickyMode && !!_castStyle?.saw; }

/** 바닥 점에서 네모(발밑)까지의 거리 — 안이면 0 */
function _boxDist(a, f) {
  const dx = Math.max(0, Math.abs(a.x - f.x) - f.half), dy = Math.max(0, Math.abs(a.y - f.y) - f.half);
  return Math.hypot(dx, dy);
}

/**
 * 커서(바닥 점 a)에서 닿는 가장 가까운 대상 — 상대 타워 · 상대 진영 토템.
 * @returns {{kind:'tower'|'totem', el?, col?, row?, f:{x,y,half}, d}|null}
 */
function _sawTargetAt(a, st = _castStyle) {
  let best = null;
  const take = c => { if (c.d <= st.reach && (!best || c.d < best.d)) best = c; };
  document.querySelectorAll('.tower').forEach(el => {
    if (el.dataset.owner !== 'enemy' || el.classList.contains('destroyed')) return;
    if (!_towerAlive('enemy', el.dataset.pos)) return;
    const f = _towerFootprint(el);
    take({ kind: 'tower', el, f, d: _boxDist(a, f) });
  });
  Object.keys(_totemTiles).forEach(key => {
    const [c, r] = key.split(',').map(Number);
    if (c < MAP_COLS / 2 || !totemOnTile(c, r)) return;
    const p = _tileCenter(c, r);
    const f = { x: p.x, y: p.y, half: SAW_TOTEM_HALF };
    take({ kind: 'totem', col: c, row: r, f, d: _boxDist(a, f) });
  });
  return best;
}

/** 다가가는 방향 — 커서에서 대상 쪽 (커서가 대상 위면 맞는 쪽으로 곧장) · 맞닿는 앞면 점 */
function _sawApproach(a, f, dir = 1) {
  let ux = f.x - a.x, uy = f.y - a.y;
  const L = Math.hypot(ux, uy);
  if (L < 1 || _boxDist(a, f) === 0) { ux = dir; uy = 0; } else { ux /= L; uy /= L; }
  const k = f.half / Math.max(Math.abs(ux), Math.abs(uy), 1e-6);
  return { ux, uy, face: { x: f.x - ux * k, y: f.y - uy * k } };
}

/** 방향 → 5° 단위 부호 (맞는 쪽으로 곧장 = 0, 아래쪽 +) */
function _sawDirCode(ux, uy, dir) {
  const deg = Math.atan2(uy, ux * dir) * 180 / Math.PI;
  return Math.max(-36, Math.min(36, Math.round(deg / 5)));
}

/** 조준 — 가장 가까운 대상을 강조하고, 커서에서 그 대상 앞면까지 선을 긋는다 */
let _sawAimT = null;
function _onSawMove(cx, cy) {
  if (!_castArc) return;
  const a = _clientToGround(cx, cy);
  _castArc.style.left = a.x + 'px';
  _castArc.style.top  = a.y + 'px';
  _castArc.style.setProperty('--reach', _castStyle.reach + 'px');
  const tg = _sawTargetAt(a);
  _sawAimT = tg;
  _clearCastHighlights();
  _castCircleHits = [];
  _castArc.classList.toggle('cast-arc-ready', !!tg);
  const line = _castArc.querySelector('.cast-saw-line'), mark = _castArc.querySelector('.cast-saw-mark');
  if (!tg) { line.style.width = '0px'; mark.style.display = 'none'; return; }
  const ap = _sawApproach(a, tg.f);
  const len = Math.hypot(ap.face.x - a.x, ap.face.y - a.y);
  line.style.width = len + 'px';
  line.style.transform = `rotate(${Math.atan2(ap.face.y - a.y, ap.face.x - a.x)}rad)`;
  Object.assign(mark.style, { display: 'block', left: (tg.f.x - tg.f.half - a.x) + 'px', top: (tg.f.y - tg.f.half - a.y) + 'px',
                              width: (tg.f.half * 2) + 'px', height: (tg.f.half * 2) + 'px' });
  mark.classList.toggle('cast-saw-mark-totem', tg.kind === 'totem');
  if (tg.kind === 'tower') { tg.el.classList.add('drag-over'); _castCircleHits = [tg.el]; }
}

/** 톱이 지나는 칸 — 커서에서 맞닿는 자리까지 (그 칸의 소환 유닛이 같이 썰린다) */
function _sawPathTiles(a, b) {
  const set = new Map();
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 20));
  for (let i = 0; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    if (c >= 0 && r >= 0 && c < MAP_COLS && r < MAP_ROWS) set.set(c + ',' + r, [c, r]);
  }
  return [...set.values()];
}

/** 썰기 시작 — 성공하면 true (맵 밖이거나 지금 쓸 수 없으면 false: 카드는 그대로 들고 있다) */
function _sawStart(cx, cy) {
  if (_sawHold || !_sawAiming()) return false;
  const under = document.elementFromPoint(cx, cy);
  if (!under?.closest?.('#map-viewport')) return false;
  const st = _castStyle;
  const card = _boardCurrentCard, slot = _boardDeckSlot;
  if (!card) return false;
  if (window.matchInputLocked || (typeof gamePaused === 'function' && gamePaused())) return false;
  if (castBlocked(card)) { castNotifyBlocked(); return false; }
  const owner = 'enemy';
  const a = _clientToGround(cx, cy);
  const tg = _sawTargetAt(a, st);
  const ap = tg ? _sawApproach(a, tg.f) : { ux: 1, uy: 0, face: a };
  const positions = tg?.kind === 'tower' ? [tg.el.dataset.pos] : [];
  // 지나는 칸의 소환 유닛 — 틱마다 같은 칸에 7 (p1 기준 칸으로 바꿔 둔다)
  const flip = _boardPlayerKey === 'p2';
  const unitTiles = _sawPathTiles(a, ap.face).map(([c, r]) => [flip ? MAP_COLS - 1 - c : c, r, st.saw.damage]);
  const sawId = Math.random().toString(36).slice(2, 8);
  const castId = `saw@${sawId}@${_sawDirCode(ap.ux, ap.uy, 1)}`;
  const opts = { positions, castId, shots: [], endMs: st.endMs };
  if (!positions.length) {
    // 토템이면 그 칸 한가운데, 허공이면 커서 자리 — 다른 화면은 그 칸에 토템이 있는지로 안다
    const point = _groundToStage(tg ? tg.f.x : a.x, tg ? tg.f.y : a.y);
    const kingEl = document.getElementById(`tower-${owner}-king`);
    const k = kingEl ? _towerCenterStage(kingEl) : point;
    Object.assign(opts, { point, dx: Math.round(point.x - k.x), dy: Math.round(point.y - k.y) });
  }
  const targetKey = _boardEnemyKey;
  _cancelStickyDrag();
  onCardDropped(card, slot, owner, positions[0] || 'king', opts);
  const limit = tg?.kind === 'totem' ? st.totemCutMs : st.saw.holdMs;
  _sawHold = { sawId, start: gameNow(), ticks: 0, positions, targetKey, unitTiles, st, timer: 0, limit };
  // 저절로 끝까지 — 창이 뒤로 가도(requestAnimationFrame이 멈춰도) 틱은 시각대로 따라잡는다
  _sawHold.timer = setInterval(_sawLoop, 50);
  return true;
}

/** 일정 간격 — 지난 시간만큼 틱을 넣는다 (경기 시간 기준: 컷씬 동안은 멈춘다) */
function _sawLoop() {
  const h = _sawHold;
  if (!h) return;
  const s = h.st.saw;
  if (window.matchInputLocked) { _sawRelease(); return; }
  const held = gameNow() - h.start;
  const due = Math.min(Math.floor(h.limit / s.tickMs), Math.floor(held / s.tickMs));
  while (h.ticks < due) { h.ticks++; _sawTick(h); }
  if (held >= h.limit) _sawRelease();
}

/** 7 한 번 — 타워(있으면)와 지나는 칸의 소환 유닛 */
function _sawTick(h) {
  const s = h.st.saw;
  if (h.positions.length && typeof writePendingHit === 'function') {
    writePendingHit({
      sourcePlayer: _boardPlayerKey, targetPlayer: h.targetKey, positions: h.positions,
      cardId: 'thorn_evo', cardType: 'attack', effect: { damage: s.damage }, applyAt: gameNow(),
    }).catch(err => console.warn('톱 피해 예약 실패:', err));
  }
  if (h.unitTiles.length && typeof unitsWriteStrike === 'function') unitsWriteStrike(_boardPlayerKey, h.unitTiles, 0);
}

/** 끝났다 (다 썰었다 · 경기 끝) — 톱을 빼고, 다른 화면에도 알린다 */
function _sawRelease() {
  const h = _sawHold;
  if (!h) return;
  _sawHold = null;
  clearInterval(h.timer);
  boardSawRemoteStop(h.sawId);
  if (typeof writePendingHit === 'function') {
    writePendingHit({
      sourcePlayer: _boardPlayerKey, targetPlayer: h.targetKey, sawStop: h.sawId,
      cardId: 'sawstop', cardType: 'attack', applyAt: gameNow() + 1500,
    }).catch(() => {});
  }
}

/** 그 톱을 뺀다 (내 화면 · 상대가 손을 뗀 표시를 받은 화면) */
function boardSawRemoteStop(sawId) {
  const f = _sawFx[sawId];
  if (!f || f.stopped) return;
  f.stopped = true;
  if (f.id3d && typeof towers3dSawStop === 'function') towers3dSawStop(f.id3d);
  if (f.el) { f.el.classList.add('saw-flat-out'); setTimeout(() => f.el.remove(), 320); }
}

/**
 * 톱 연출 — 모든 화면이 같은 자리에 같은 톱을 띄운다.
 * owner = 맞는 쪽. code = 다가가는 방향 (맞는 쪽으로 곧장 = 0, 5° 단위).
 * 타워면 그 타워 앞면, 점(stagePoint)이 토템 칸이면 그 토템 앞면에서 썰어 반토막 내고, 아니면 그 자리 허공을 썬다.
 */
function _playSawFx(style, owner, pos, stagePoint, sawId, code) {
  const dir = owner === 'enemy' ? 1 : -1;            // 쓰는 사람 쪽에서 맞는 쪽으로 썬다
  const rad = (Number(code) || 0) * 5 * Math.PI / 180;
  const ux = Math.cos(rad) * dir, uy = Math.sin(rad);
  let x, y, hit = false, totem = null;
  const face = f => {
    const k = f.half / Math.max(Math.abs(ux), Math.abs(uy), 1e-6);
    x = f.x - ux * k; y = f.y - uy * k;
  };
  const el = !stagePoint && pos ? document.getElementById(`tower-${owner}-${pos}`) : null;
  if (el && !el.classList.contains('destroyed')) {
    face(_towerFootprint(el)); hit = true;
  } else if (stagePoint) {
    const g = _stageToGround(stagePoint.x, stagePoint.y);
    const col = Math.floor(g.x / TILE), row = Math.floor(g.y / TILE);
    if (totemOnTile(col, row)) {
      const c = _tileCenter(col, row);
      face({ x: c.x, y: c.y, half: SAW_TOTEM_HALF });
      totem = { col, row };
    } else { x = g.x; y = g.y; }
  } else return style.hitMs;
  const ms = totem ? style.hitMs + style.totemCutMs + 150 : style.saw.holdMs + style.hitMs;
  const id3d = typeof towers3dSaw === 'function'
    ? towers3dSaw({ x, y, ux, uy, dir, ms, strokeMs: style.saw.tickMs, hit: hit || !!totem, totem: !!totem }) : 0;
  const stage = _groundToStage(x, y);
  let flat = null;
  if (!id3d) {
    // WebGL이 없으면 톱 그림이 그 자리에서 앞뒤로 움직인다
    flat = document.createElement('div');
    flat.className = 'saw-flat' + (dir < 0 ? ' saw-flat-left' : '');
    flat.textContent = '🪚';
    Object.assign(flat.style, { left: stage.x + 'px', top: (stage.y - 50) + 'px' });
    _fxLayer().appendChild(flat);
  }
  // 상성 — 톱이 토템을 갈아 버린다: 나무가 반토막 나 넘어가고 풀이 잘려 나간다 (회복도 멈춘다)
  if (totem) setTimeout(() => {
    if (totemOnTile(totem.col, totem.row)) _breakTotemsIn({ c0: totem.col, c1: totem.col, r0: totem.row, r1: totem.row }, { how: 'saw', dir, ux, uy });
  }, style.hitMs + style.totemCutMs - 120);
  const rec = { id3d, el: flat, stage, dir, stopped: false };
  if (sawId) _sawFx[sawId] = rec;
  rec.timer = setTimeout(() => {
    if (sawId) boardSawRemoteStop(sawId);
    else if (id3d && typeof towers3dSawStop === 'function') towers3dSawStop(id3d);
    if (flat) flat.remove();
    setTimeout(() => { if (sawId) delete _sawFx[sawId]; }, 2000);
  }, ms + 100);
  return style.hitMs;
}

// ════════════════════════════════════════════════════════════
//  불덩이 · 폭염 (2026-10-02)
//  불덩이 — 돌처럼 던지되 떨어지는 자리는 2×2칸 (칸 네 개가 만나는 점). 화염 덩이가 날아가 떨어지면 그 칸들이 불탄다.
//  폭염   — 3×7칸. 열기가 모여 한 번 폭발 → 범위 안 대상이 불탄다 → 열기(더위)가 올라온다.
//  불길 · 폭발 · 열기의 3D는 towers3d.js (towers3dFireField · towers3dTowerBurn · towers3dHeatHaze)
// ════════════════════════════════════════════════════════════

/** 스테이지(맵) 좌표 → 화면 좌표 */
function _stageToClient(p) {
  const map = document.getElementById('tile-map');
  if (!map) return null;
  const r = map.getBoundingClientRect();
  const s = _mapScale();
  return { x: r.left + p.x * s, y: r.top + p.y * s };
}

/**
 * 불덩이가 떨어질 자리 — 커서에 가장 가까운 칸 꼭짓점을 가운데로 한 2×2칸.
 * @returns {{R, corner, stage, onMap, hits}} corner = 칸 네 개가 만나는 점(바닥 좌표), stage = 그 점이 화면에 보이는 곳
 */
function _fireballAim(cx, cy) {
  const st = _castStyle;
  const g = _clientToGround(cx, cy);
  const onMap = g.x >= 0 && g.y >= 0 && g.x < MAP_COLS * TILE && g.y < MAP_ROWS * TILE;
  const R = castAreaRect(st, Math.round(g.x / TILE), Math.round(g.y / TILE));
  const corner = { x: (R.c0 + st.cols / 2) * TILE, y: (R.r0 + st.rows / 2) * TILE };
  return { R, corner, stage: _groundToStage(corner.x, corner.y), onMap, hits: onMap ? _towersInRect(R, true) : [] };
}

/** 불덩이 조준 — 포물선은 칸 네 개가 만나는 점에서 끝나고 그 점에 표식, 착지 표시는 2×2칸 */
function _onFireballMove(cx, cy) {
  const st = _castStyle;
  const aim = _fireballAim(cx, cy);
  const land = _castLands && _castLands.querySelector('.cast-throw-land');
  if (land) {
    land.style.left = aim.corner.x + 'px';
    land.style.top  = aim.corner.y + 'px';
    land.style.display = aim.onMap ? '' : 'none';
  }
  const path = _castArc.querySelector('.cast-throw-path');
  const dot  = _castArc.querySelector('.cast-throw-dot');
  const from = _throwOriginClient();
  const to   = _stageToClient(aim.stage) || { x: cx, y: cy };
  if (path && from) {
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const lift = Math.min(300, 110 + Math.hypot(to.x - from.x, to.y - from.y) * 0.2) * _mapScale();
    path.setAttribute('d', `M ${from.x} ${from.y} Q ${mx} ${my - lift} ${to.x} ${to.y}`);
  }
  if (dot) {
    dot.style.left = to.x + 'px';
    dot.style.top  = to.y + 'px';
    dot.style.display = aim.onMap ? '' : 'none';
  }
  const fromStage = boardTowerCenterStage('my', 'king');
  const inReach = aim.onMap && (!fromStage || Math.hypot(aim.stage.x - fromStage.x, aim.stage.y - fromStage.y) <= st.reach);
  const targets = inReach ? aim.hits : [];
  _clearCastHighlights();
  targets.forEach(el => el.classList.add('drag-over'));
  _castCircleHits = targets;
  for (const box of [_castArc, _castLands]) {
    if (!box) continue;
    box.classList.toggle('cast-arc-ready', targets.length > 0);
    box.classList.toggle('cast-circle-bad', !inReach);
  }
}

/** 불덩이 던지기 — 사거리 밖 · 맵 밖이면 카드는 그대로 들고 있는다 */
function _fireballFire(e) {
  if (!_castClickOnMap(e)) return;
  const st = _castStyle;
  const aim = _fireballAim(e.clientX, e.clientY);
  if (!aim.onMap) return;
  const fromStage = boardTowerCenterStage('my', 'king');
  if (fromStage && Math.hypot(aim.stage.x - fromStage.x, aim.stage.y - fromStage.y) > st.reach) return;
  const card = _boardCurrentCard;
  const slot = _boardDeckSlot;
  const targets = aim.hits.filter(el => el.dataset.owner === 'enemy').map(el => ({ pos: el.dataset.pos }));
  const positions = targets.map(t => t.pos);
  const plan = castFireballPlan(st, aim.R, targets);
  // 상대 화면은 좌우가 뒤집힌다 — 맞는 쪽 킹 타워 기준으로 보낸다 (칸 꼭짓점이라 뒤집어도 꼭짓점)
  const kingEl = document.getElementById('tower-enemy-king');
  const k = kingEl ? _towerCenterStage(kingEl) : aim.corner;
  _cancelStickyDrag();
  if (!card) return;
  onCardDropped(card, slot, 'enemy', positions[0] || 'king', {
    positions, point: aim.corner, castId: card.cast,
    endMs: st.flyMs + 600,                     // 같은 카드 잠금 — 떨어질 때까지만 (불길은 남아도 또 던질 수 있다)
    dx: Math.round(aim.corner.x - k.x), dy: Math.round(aim.corner.y - k.y),
    shots: plan.shots, unitStrikes: plan.unitStrikes,
  });
}

/**
 * 불덩이 연출 — 던진 쪽 킹 타워에서 화염 덩이가 포물선으로 날아가(꼬리에 불똥) 떨어지면,
 * 터지는 불꽃과 함께 2×2칸이 불탄다 (3D 불길 · 바닥 그을음 · 연기).
 * @param {{x,y}|null} point 칸 꼭짓점 (바닥 좌표). 없으면(AI 등) 그 타워 칸을 꼭짓점으로
 */
function _playFireballFx(style, owner, pos, point) {
  let corner = point;
  if (!corner) {
    const t = _towerTile(owner, pos);
    if (!t) return style.flyMs;
    corner = { x: (t.col + 1) * TILE, y: (t.row + 1) * TILE };
  }
  const R = castAreaRect(style, Math.round(corner.x / TILE), Math.round(corner.y / TILE));
  const land = _groundToStage(corner.x, corner.y);
  const from = _throwFromStage(owner);
  _fireballFly(from, land, style.flyMs);
  // 불이 붙어 있는 동안 물이 닿으면 꺼진다 (상성)
  const b = style.burn, t0 = gameNow() + style.flyMs;
  const patch = _fireAdd({ victim: owner, R, card: 'flame', from: t0, until: t0 + b.dot.ticks * b.dot.tickInterval + 300 });
  setTimeout(() => _fireLand(style, R, owner, land, patch), style.flyMs);
  return style.flyMs;
}

/** 날아가는 화염 덩이 — 가로 등속 · 세로 포물선, 지나간 자리에 불똥이 흩날린다 */
function _fireballFly(from, land, flyMs) {
  const layer = _fxLayer();
  if (!layer) return;
  const dx = land.x - from.x, dy = land.y - from.y;
  const arc = Math.min(300, 110 + Math.hypot(dx, dy) * 0.2);
  const ball = document.createElement('div');
  ball.className = 'fireball-fly';
  ball.innerHTML = '<i class="fb-glow"></i><i class="fb-flame"></i><i class="fb-core"></i>';
  layer.appendChild(ball);
  const shadow = document.createElement('div');
  shadow.className = 'stone-fly-shadow fireball-shadow';
  layer.appendChild(shadow);
  const t0 = performance.now();
  let lastEmber = 0;
  const step = now => {
    const k = Math.min(1, (now - t0) / flyMs);
    const x = from.x + dx * k, gy = from.y + dy * k;
    const y = gy - arc * 4 * k * (1 - k);
    // 진행 방향으로 꼬리가 눕는다 — 위로 솟을 땐 아래로, 떨어질 땐 위로 끌린다
    const vx = dx, vy = dy - arc * 4 * (1 - 2 * k);
    const ang = Math.atan2(vy, vx) * 180 / Math.PI;
    const sc = 0.85 + 0.35 * Math.sin(Math.PI * k);
    ball.style.transform = `translate(${x}px, ${y}px) rotate(${ang.toFixed(1)}deg) scale(${sc.toFixed(3)})`;
    shadow.style.left = x + 'px';
    shadow.style.top  = gy + 'px';
    shadow.style.opacity = (0.45 - 0.3 * Math.sin(Math.PI * k)).toFixed(3);
    if (now - lastEmber > 34) {
      lastEmber = now;
      for (let i = 0; i < 2; i++) {
        const e = document.createElement('i');
        e.className = 'fb-ember';
        const s = 4 + Math.random() * 6;
        Object.assign(e.style, { left: (x + (Math.random() - 0.5) * 16) + 'px', top: (y + (Math.random() - 0.5) * 16) + 'px', width: s + 'px', height: s + 'px' });
        e.style.setProperty('--ex', ((Math.random() - 0.5) * 40 - vx * 0.02).toFixed(1) + 'px');
        e.style.setProperty('--ey', (-14 - Math.random() * 30).toFixed(1) + 'px');
        layer.appendChild(e);
        setTimeout(() => e.remove(), 650);
      }
    }
    if (k < 1) requestAnimationFrame(step);
    else { ball.remove(); shadow.remove(); }
  };
  requestAnimationFrame(step);
}

/** 범위 칸 가운데들 (바닥 좌표) */
function _rectTiles(R) {
  const out = [];
  for (let c = R.c0; c <= R.c1; c++) for (let r = R.r0; r <= R.r1; r++) out.push({ c, r, ..._tileCenter(c, r) });
  return out;
}

/** 바닥판 위에 눕는 불 자국 (그을음 · 이글거리는 잉걸) — 칸 범위에 맞춰 */
function _fireGroundPatch(R, cls, lifeMs, extra = {}) {
  const ground = _castGround();
  if (!ground) return null;
  const el = document.createElement('div');
  el.className = cls;
  Object.assign(el.style, {
    left: (R.c0 * TILE) + 'px', top: (R.r0 * TILE) + 'px',
    width: ((R.c1 - R.c0 + 1) * TILE) + 'px', height: ((R.r1 - R.r0 + 1) * TILE) + 'px'
  });
  el.style.setProperty('--life', lifeMs + 'ms');
  Object.entries(extra).forEach(([k, v]) => el.style.setProperty(k, v));
  ground.appendChild(el);
  setTimeout(() => el.remove(), lifeMs + 50);
  return el;
}

/** 필드가 한 번 울린다 */
function _fieldBump() {
  const map = document.querySelector('.game-map');
  if (!map) return;
  map.classList.remove('field-bump');
  void map.offsetWidth;
  map.classList.add('field-bump');
  setTimeout(() => map.classList.remove('field-bump'), 500);
}

/** 불덩이가 떨어졌다 — 섬광 · 불꽃 튐 → 2×2칸이 지속 피해 동안 불탄다 */
function _fireLand(style, R, owner, land, patch = {}) {
  const b = style.burn;
  const burnMs = b.dot.ticks * b.dot.tickInterval + 300;
  const layer = _fxLayer();
  if (layer) {
    const flash = document.createElement('div');
    flash.className = 'fire-impact';
    flash.style.left = land.x + 'px';
    flash.style.top  = land.y + 'px';
    layer.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
  }
  patch.els = [_fireGroundPatch(R, 'fire-scorch', burnMs + 900)].filter(Boolean);
  _fieldBump();
  const tiles = _rectTiles(R);
  const inRect = _towersInRect(R, false);
  const in3d = typeof towers3dFireField === 'function' &&
    towers3dFireField({ tiles, ms: burnMs, burst: 1, seed: R.c0 * 29 + R.r0 * 13 + 3, tag: patch.tag });
  if (!in3d) tiles.forEach(t => patch.els.push(_fireFlat(t, burnMs)));
  inRect.filter(el => el.dataset.owner === owner && !el.classList.contains('destroyed')).forEach(el => {
    if (typeof towers3dImpact === 'function') towers3dImpact(el, owner === 'enemy' ? 1 : -1);
    if (typeof towers3dTowerBurn === 'function') towers3dTowerBurn(el, burnMs, 0.6, patch.tag);
  });
  // 상성 — 맞는 쪽 토템에 불이 붙어 타 버린다(힐 밴). 불이 타는 동안 그 자리에 세운 토템도 재가 된다
  // (언 타워의 얼음은 피해를 넣는 쪽이 녹인다 — sync.js applyCardUse)
  if (!patch.doused) patch.lock = _totemDebuff(R, 'burn', owner, 1, burnMs);
  else _fireDouseFx(patch);
  // 연기 — 불길 위로 검은 연기가 피어오른다
  tiles.forEach((t, i) => {
    const p = _groundToStage(t.x, t.y);
    _spawnDust(p.x, p.y - 30, 80, 200 + i * 120, 1600, 'rgba(40, 32, 30, 0.5)');
  });
}

/** WebGL이 없을 때 — 칸마다 불 그림 하나 */
function _fireFlat(t, ms) {
  const ground = _castGround();
  if (!ground) return;
  const f = document.createElement('div');
  f.className = 'fire-flat';
  f.textContent = '🔥';
  Object.assign(f.style, { left: t.x + 'px', top: t.y + 'px' });
  ground.appendChild(f);
  setTimeout(() => f.remove(), ms);
  return f;
}

/**
 * 폭염 연출.
 *   모임(0~hitMs) — 범위 바닥이 달아오르며 열기가 빨려 든다
 *   폭발(hitMs)   — 범위 곳곳에서 화염이 한꺼번에 터진다 (섬광 · 불기둥 · 충격 고리 · 필드 울림)
 *   불탐(burnMs)  — 범위 안 타워가 불길에 휩싸인다
 *   열기(heatMs)  — 칸에서 아지랑이와 열기가 올라온다. 그 칸의 타워에 '더위' 표
 */
function _heatwaveFx(style, R, owner) {
  const tiles = _rectTiles(R);
  const total = style.hitMs + style.burnMs + style.heatMs;
  // 폭발부터 열기가 식을 때까지 — 그 사이 물이 닿으면 불도 열기도 꺼진다 (상성)
  const t0 = gameNow() + style.hitMs;
  const patch = _fireAdd({ victim: owner, R, card: 'fire_evo', from: t0, until: t0 + style.burnMs + style.heatMs });
  patch.els = [_fireGroundPatch(R, 'heat-ground', total + 400, {
    '--charge': style.hitMs + 'ms', '--burn': style.burnMs + 'ms', '--heat': style.heatMs + 'ms'
  })].filter(Boolean);
  patch.timers.push(setTimeout(() => {
    _fieldBump();
    const layer = _fxLayer();
    // 큰 섬광 — 범위 한가운데
    const mid = _groundToStage((R.c0 + R.c1 + 1) / 2 * TILE, (R.r0 + R.r1 + 1) / 2 * TILE);
    if (layer) {
      const flash = document.createElement('div');
      flash.className = 'fire-impact fire-impact-big';
      flash.style.left = mid.x + 'px';
      flash.style.top  = mid.y + 'px';
      layer.appendChild(flash);
      setTimeout(() => flash.remove(), 900);
    }
    if (patch.doused) { _fireDouseFx(patch); return; }   // 터지는 자리를 이미 물이 덮고 있었다 — 김만 오른다
    // 상성 — 맞는 쪽 토템은 타 버리고(힐 밴), 불길이 타는 동안 그 자리에 세운 토템도 재가 된다
    // (그 뒤 열기 속 토템은 말라 비틀어진다. 언 타워는 피해 없이 다 녹는다 — sync.js applyCardUse)
    patch.lock = _totemDebuff(R, 'burn', owner, 1, style.burnMs);
    const in3d = typeof towers3dFireField === 'function' &&
      towers3dFireField({ tiles, ms: style.burnMs, burst: 2, seed: R.c0 * 31 + R.r0 * 7 + 11, tag: patch.tag });
    if (!in3d) tiles.forEach(t => patch.els.push(_fireFlat(t, style.burnMs)));
    _towersInRect(R, false).filter(el => el.dataset.owner === owner && !el.classList.contains('destroyed')).forEach(el => {
      if (typeof towers3dImpact === 'function') towers3dImpact(el, owner === 'enemy' ? 1 : -1);
      if (typeof towers3dTowerBurn === 'function') towers3dTowerBurn(el, style.burnMs, 1, patch.tag);
    });
    tiles.forEach((t, i) => {
      if (i % 2) return;
      const p = _groundToStage(t.x, t.y);
      _spawnDust(p.x, p.y - 30, 90, 300 + i * 40, 1700, 'rgba(48, 36, 32, 0.45)');
    });
  }, style.hitMs));
  // 열기 — 아지랑이 · 피어오르는 열 · 그 칸 타워에 더위 표 (그 칸의 토템은 말라 비틀어진다 — _totemWitherStep)
  patch.timers.push(setTimeout(() => {
    if (patch.doused) return;
    if (typeof towers3dHeatHaze === 'function') towers3dHeatHaze({ tiles, ms: style.heatMs, seed: R.c0 * 17 + R.r0, tag: patch.tag });
    _heatMarkTowers(R, owner, style.heatMs);
    _totemWitherWatch();
  }, style.hitMs + style.burnMs));
}

/** 더위 속 타워 — '더위' 표 (보이는 것만. 실제 피해 증폭은 sync.js heatZones) */
function _heatMarkTowers(R, owner, ms) {
  _towersInRect(R, false).filter(el => el.dataset.owner === owner).forEach(el => {
    el.classList.add('tower-heat');
    clearTimeout(el._heatTimer);
    el._heatTimer = setTimeout(() => el.classList.remove('tower-heat'), ms);
  });
}

/**
 * 폭염의 열기 구역을 기록한다 — 쓰는 사람 시점의 칸 범위(R)를 p1 기준으로 바꿔서.
 * @param {string} casterKey 쓰는 사람 ('p1' | 'p2')
 */
function boardWriteHeatZone(st, R, casterKey) {
  if (typeof writeHeatZone !== 'function') return;
  const flip = casterKey === 'p2';
  const P = flip ? { c0: MAP_COLS - 1 - R.c1, c1: MAP_COLS - 1 - R.c0, r0: R.r0, r1: R.r1 } : R;
  const tm = heatwaveZoneTimes(st);
  const now = gameNow();
  writeHeatZone(casterKey === 'p1' ? 'p2' : 'p1', P, now + tm.from, now + tm.until, st.heatPercent);
}

// ════════════════════════════════════════════════════════════
//  상성 (2026-10-02) — 물 ↔ 불 · 불 ↔ 얼음 · 물 ↔ 얼음 · 물 ↔ 번개 · 불 · 바람 ↔ 토템
//  모든 화면(양쪽 · 관전자)이 같은 연출을 재생하며 같은 구역을 안다 — 판정은 각자, 쓰기는 그 타워 주인 화면만.
// ════════════════════════════════════════════════════════════

/** 이 화면이 그 플레이어의 타워를 기록하는가 (내 타워 · AI 대전이면 AI 타워) — 관전자는 아니다 */
function _boardOwnsKey(key) {
  return typeof _effectsOwnsTower === 'function' && !!key && _effectsOwnsTower(key);
}

/** 그 플레이어의 타워가 지금(t) 젖어 있는가 — 침수·파도(누가 쓴 물이든) · 폭염에 녹은 얼음물 */
function towerSoaked(playerKey, pos, t) {
  const tile = _towerTile(playerKey === _boardPlayerKey ? 'my' : 'enemy', pos);
  if (!tile) return false;
  return _tileWet(tile.col, tile.row, t);
}

/** 벚꽃 회복 한 번 — 회복받는 타워가 젖어 있으면 늘린다 (토템과 같은 +50%) */
function towerSoakedHeal(h, playerKey, pos, t) {
  return towerSoaked(playerKey, pos, t) ? TOTEM_SOAK_HEAL(h) : h;
}

/** 범위 칸 중 하나라도 지금 물에 젖어 있는가 (누가 쓴 물이든) */
function _rectWet(R, t) {
  for (let c = R.c0; c <= R.c1; c++) for (let r = R.r0; r <= R.r1; r++) {
    if (_waterZones.some(z => z.test(c, r, t))) return true;
  }
  return false;
}

// ── 물이 불을 끈다 ────────────────────────────────────────────
// 불덩이가 타는 2×2칸 · 폭염이 터져 타고 열기가 오르는 3×7칸에 침수 · 파도의 물이 닿으면 그 불은 꺼진다:
// 불길이 사그라지며 김이 오르고, 남은 불 피해(지속)는 더 들어가지 않으며, 폭염의 열기(더위)도 식는다.
// 물이 이미 덮고 있는 자리에 떨어진 불은 붙자마자 꺼진다.
const _firePatches = [];   // { victim, R, card, from, until, tag, els, timers, doused }
const _fireDoused  = [];   // { victimKey, R, card, until } — 이 불의 지속 피해는 더 들어가지 않는다
let _fireWatch = 0;
let _fireSeq = 0;

function _fireAdd(p) {
  p.tag = 'fire' + (++_fireSeq);
  p.els = p.els || [];
  p.timers = p.timers || [];
  _firePatches.push(p);
  if (!_fireWatch) _fireWatch = setInterval(_fireWatchStep, 120);
  return p;
}

function _fireWatchStep() {
  const now = gameNow();
  for (let i = _firePatches.length - 1; i >= 0; i--) {
    const p = _firePatches[i];
    if (p.doused || now >= p.until) { _firePatches.splice(i, 1); continue; }
    if (now >= p.from && _rectWet(p.R, now)) _fireDouse(p, now);
  }
  for (let i = _fireDoused.length - 1; i >= 0; i--) if (_fireDoused[i].until < now) _fireDoused.splice(i, 1);
  if (!_firePatches.length) { clearInterval(_fireWatch); _fireWatch = 0; }
}

function _fireDouse(p, now) {
  if (p.doused) return;
  p.doused = true;
  if (p.lock) p.lock.until = 0;   // 불이 꺼졌다 — 그 자리에 다시 토템을 세울 수 있다
  const victimKey = p.victim === 'my' ? _boardPlayerKey : _boardEnemyKey;
  _fireDoused.push({ victimKey, R: p.R, card: p.card, until: p.until + 1500 });
  _fireDouseFx(p);
  // 열기도 식는다 — 더위 표를 떼고, 그 진영 주인 화면이 더위 구역을 지운다
  if (p.card === 'fire_evo') {
    _towersInRect(p.R, false).filter(el => el.dataset.owner === p.victim).forEach(el => {
      clearTimeout(el._heatTimer);
      el.classList.remove('tower-heat');
    });
    if (_boardOwnsKey(victimKey)) _removeHeatZonesOver(victimKey, p.R, now);
  }
}

/** 꺼지는 모습 — 불길이 사그라지고 흰 김이 피어오르며, 그을린 바닥은 젖은 잿빛으로 식는다 */
function _fireDouseFx(p) {
  const tiles = _rectTiles(p.R);
  const in3d = typeof towers3dFireDouse === 'function' && towers3dFireDouse(p.tag, tiles);
  p.els.forEach(el => el?.classList?.add('fire-doused'));
  const layer = _fxLayer();
  tiles.forEach((t, i) => {
    const s = _groundToStage(t.x, t.y);
    if (!in3d) _spawnDust(s.x, s.y - 30, 100, i * 50, 1200, 'rgba(235, 242, 250, 0.6)');
    if (layer && i % 2 === 0) {
      const hiss = document.createElement('div');
      hiss.className = 'fire-hiss';
      hiss.style.left = s.x + 'px';
      hiss.style.top  = (s.y - 20) + 'px';
      hiss.style.animationDelay = (i * 40) + 'ms';
      layer.appendChild(hiss);
      setTimeout(() => hiss.remove(), 1200 + i * 40);
    }
  });
}

/** 물에 꺼진 불의 지속 피해인가 — effects.js가 틱마다 묻는다 (꺼졌으면 그 줄을 끝낸다) */
function boardFireDoused(targetPlayer, pos, cardId, now) {
  if (!_fireDoused.length) return false;
  const tile = _towerTile(targetPlayer === _boardPlayerKey ? 'my' : 'enemy', pos);
  if (!tile) return false;
  return _fireDoused.some(d => d.victimKey === targetPlayer && d.card === cardId && now <= d.until && _inRect(d.R, tile.col, tile.row));
}

/** 이 화면 칸 범위와 겹치는 그 진영의 더위 구역을 지운다 (더위는 p1 기준 칸) */
function _removeHeatZonesOver(victimKey, R, now) {
  if (typeof removeHeatZone !== 'function') return;
  const P = _boardPlayerKey === 'p2' ? { c0: MAP_COLS - 1 - R.c1, c1: MAP_COLS - 1 - R.c0, r0: R.r0, r1: R.r1 } : R;
  Object.entries(_boardGameState?.heatZones || {}).forEach(([id, z]) => {
    if (!z || z.victim !== victimKey || z.until <= now) return;
    if (z.c1 < P.c0 || z.c0 > P.c1 || z.r1 < P.r0 || z.r0 > P.r1) return;
    removeHeatZone(id);
  });
}

// ── 얼음 (얼음전개) ───────────────────────────────────────────
// 타워 데이터(frozenFrom · frozenUntil · frozenMelt)로 그린다 — 모든 화면(관전 · 재접속 포함)이 같다.
const _iceShown = {};   // 타워 id → { from, melt }
const _icePoolShown = {};   // 타워 id → 그린 물웅덩이의 녹은 시각 (한 번만 그린다)

function _iceSync(towerEl, owner, pos, t, now) {
  const id = towerEl.id;
  const cur = _iceShown[id];
  const frozen = typeof towerFrozen === 'function' && towerFrozen(t, now);
  if (!frozen) {
    if (!cur) {
      // 녹은 얼음물이 고인 동안 들어왔다 (관전 · 재접속) — 얼음은 이미 없지만 남은 만큼 물웅덩이를 그린다
      if (typeof towerIcePool === 'function' && towerIcePool(t, now) && _icePoolShown[id] !== t.frozenUntil) {
        _icePoolShown[id] = t.frozenUntil;
        _icePoolFx(owner, pos, t.frozenUntil + ICE_POOL_MS - now);
      }
      return;
    }
    delete _iceShown[id];
    // 폭염에 다 녹았으면 녹아내려 물이 고이고(증발), 땅·돌 카드에 맞았으면 산산조각, 시간이 다 됐으면 깨져 흩어진다
    const how = t.frozenMelt === 2 ? 'melt' : t.frozenMelt === 3 ? 'smash' : 'shatter';
    if (typeof towers3dIceEnd === 'function') towers3dIceEnd(towerEl, how);
    towerEl.classList.remove('tower-frozen-flat');
    if (how === 'melt' && typeof towerIcePool === 'function' && towerIcePool(t, now)) {
      _icePoolShown[id] = t.frozenUntil;
      _icePoolFx(owner, pos, t.frozenUntil + ICE_POOL_MS - now);
    }
    return;
  }
  const melt = t.frozenMelt || 0;
  const left = t.frozenUntil - now;
  if (cur && cur.from === t.frozenFrom && cur.until !== t.frozenUntil) {
    // 언 타워에 얼음전개를 또 썼다 — 다시 얼지 않고 남은 시간만 늘어난다
    cur.until = t.frozenUntil;
    if (typeof towers3dIceExtend === 'function') towers3dIceExtend(towerEl, left);
  }
  if (!cur || cur.from !== t.frozenFrom) {
    _iceShown[id] = { from: t.frozenFrom, until: t.frozenUntil, melt };
    const in3d = typeof towers3dIce === 'function' &&
      towers3dIce(towerEl, { ago: Math.max(0, now - (t.frozenFrom || now)), ms: left, melt });
    if (!in3d) towerEl.classList.add('tower-frozen-flat');
    return;
  }
  if (melt !== cur.melt) {
    cur.melt = melt;
    if (typeof towers3dIceMelt === 'function') towers3dIceMelt(towerEl, melt);
  }
}

/**
 * 폭염에 녹은 얼음물 — 타워 둘레 3×3칸에 물이 고였다가 김을 뿜으며 증발한다 (ms 동안).
 * 그동안 그 칸은 젖어 있다 (_icePoolAt — 회복 +50% · 감전)
 */
function _icePoolFx(owner, pos, ms) {
  const tile = _towerTile(owner, pos);
  if (!tile || ms <= 0) return;
  const R = { c0: Math.max(0, tile.col - 1), c1: Math.min(MAP_COLS - 1, tile.col + 1),
              r0: Math.max(0, tile.row - 1), r1: Math.min(MAP_ROWS - 1, tile.row + 1) };
  _fireGroundPatch(R, 'ice-pool', ms);
  const tiles = _rectTiles(R);
  const puffs = Math.max(1, Math.floor(ms / 500));
  for (let k = 0; k < puffs; k++) {
    tiles.forEach((t, i) => {
      if ((i + k) % 3) return;
      const s = _groundToStage(t.x, t.y);
      _spawnDust(s.x, s.y - 20, 90, k * 500 + i * 40, 1300, 'rgba(235, 244, 252, 0.5)');
    });
  }
}

/**
 * 얼음전개 바닥 — 범위 가운데에서 서리가 번지고(hitMs) 얼음 결정이 솟는다. 타워가 다 얼어붙으면 녹아 사라진다.
 * 타워에 차오르는 얼음은 데이터가 오면 _iceSync가 그린다 (얼어붙는 순간 = hitMs).
 */
function _iceFieldFx(style, R, owner) {
  // 바닥은 타워가 다 얼어붙으면(얼어붙는 순간 hitMs + 차오르는 climbMs) 녹아 사라진다 — 얼음은 타워에 남는다
  const total = style.hitMs + style.climbMs;
  _fireGroundPatch(R, 'ice-ground', total + 600, { '--spread': style.hitMs + 'ms' });
  const tiles = _rectTiles(R);
  if (typeof towers3dIceField === 'function') towers3dIceField({ tiles, growMs: style.hitMs, ms: total, seed: R.c0 * 19 + R.r0 * 5 + 1 });
  // 차가운 바람 — 범위에 눈가루가 휘날린다
  const layer = _fxLayer();
  if (layer) {
    tiles.forEach((t, i) => {
      const s = _groundToStage(t.x, t.y);
      const f = document.createElement('div');
      f.className = 'ice-frost-puff';
      f.style.left = s.x + 'px';
      f.style.top  = (s.y - 10) + 'px';
      f.style.animationDelay = Math.round(i * 30 + Math.random() * 120) + 'ms';
      layer.appendChild(f);
      setTimeout(() => f.remove(), 1600);
    });
  }
  setTimeout(_fieldBump, style.hitMs);
}

// ── 더위 속 토템은 말라 비틀어진다 ────────────────────────────
// 폭염의 열기가 오르는 칸에 선 토템 — 잎 · 꽃잎이 누렇게 시들어 처지고, 회복이 25% 준다 (effects.js _healWithered).
let _witherTimer = 0;

function _totemWitherWatch() {
  if (!_witherTimer) _witherTimer = setInterval(_totemWitherStep, 300);
  _totemWitherStep();
}

function _totemWitherStep() {
  const now = gameNow();
  const keys = Object.keys(_totemTiles).filter(k => { const [c, r] = k.split(',').map(Number); return totemOnTile(c, r); });
  if (!keys.length) { clearInterval(_witherTimer); _witherTimer = 0; return; }
  keys.forEach(k => {
    const [c, r] = k.split(',').map(Number);
    const key = c < MAP_COLS / 2 ? _boardPlayerKey : _boardEnemyKey;
    const p1c = _boardPlayerKey === 'p2' ? MAP_COLS - 1 - c : c;
    const on = typeof heatPercentAt === 'function' && heatPercentAt(_boardGameState, key, p1c, r, now) > 0;
    const p = _tileCenter(c, r);
    if (typeof towers3dTotemWither === 'function') towers3dTotemWither(p.x, p.y, on);
    document.querySelectorAll(`.cast-fx-ground[data-tile="${k}"], .cast-totem-flat[data-tile="${k}"]`)
      .forEach(el => el.classList.toggle('totem-withered', on));
  });
}
