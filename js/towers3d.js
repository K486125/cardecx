/* ════════════════════════════════════════════════════════════
   타워 3D (three.js)

   타워를 CSS 상자 대신 진짜 3D 석조 건물로 그린다.

   ── 왜 이렇게 만들었나 ─────────────────────────────────────
   바닥판(.ground)은 rotateX(18deg)로 살짝만 눕어 있다. 거의 위에서
   내려다보는 각도라서, 만약 건물을 그 바닥에 '수직으로' 세우면 카메라
   쪽으로 누워 지붕만 보인다. 그래서 여기서는 두 가지를 분리한다.

     · 발은 바닥에 — 건물이 서는 자리는 눕힌 타일의 한가운데를 그대로 쓴다.
       (groundProject가 CSS와 똑같은 식으로 계산한다 → 밑면이 타일에 딱 붙는다)
     · 몸은 화면에 서서 — 건물 자체는 낮은 각도(elevation 30°)의 3D 카메라로
       그려서 정면과 옆면·지붕이 같이 보인다. 클래시 로얄식 2.5D.

   ── 건드리지 않는 것 ───────────────────────────────────────
   DOM(.tower / .tower-block)은 그대로 둔다. 조준·사거리·드롭 판정은 전부
   그 상자를 재서 하므로 여기서 뭘 그리든 게임 판정은 한 줄도 바뀌지 않는다.
   상태(destroyed / drag-over / tower-hit ...)도 classList를 읽기만 한다.

   WebGL이 없으면 아무것도 하지 않는다 — 그러면 기존 CSS 타워가 그대로 나온다.
════════════════════════════════════════════════════════════ */

const T3D_MAP_W = 1600;   // 맵 논리 크기 (16×9 타일 × 100px)
const T3D_MAP_H = 900;
// 3D 그림판은 맵보다 사방으로 T3D_PAD만큼 넓다 — 맵 둘레의 돌벽, 맵 끝에 부딪혀 치솟는 파도가
// 맵 밖으로 나가도 잘리지 않게. 카메라는 그만큼 넓게 보지만 가운데(맵 한가운데)는 그대로라
// 맵 좌표 → 월드 계산은 바뀌지 않는다. 월드 → 맵 좌표로 되돌릴 때만 _t3dToMap을 쓴다.
// 아래(카메라 쪽)는 바다로 뻗은 선착장과 그 옆 요트까지 들어오게 더 넓다 (T3D_PAD_B).
const T3D_PAD = 240;
const T3D_PAD_B = 380;
const T3D_VIEW_W = T3D_MAP_W + T3D_PAD * 2;
const T3D_VIEW_H = T3D_MAP_H + T3D_PAD + T3D_PAD_B;
/** 카메라로 투영한 점(NDC) → 맵 좌표 */
function _t3dToMap(v) {
  return { x: (v.x * 0.5 + 0.5) * T3D_VIEW_W - T3D_PAD, y: (0.5 - v.y * 0.5) * T3D_VIEW_H - T3D_PAD };
}
const T3D_ELEV  = 30 * Math.PI / 180;   // 카메라 고도 — 클수록 지붕이 많이 보인다
const T3D_AZI   = 17 * Math.PI / 180;   // 카메라 방위 — 0이면 정면만, 키우면 옆면이 보인다

let _t3dRenderer = null, _t3dScene = null, _t3dCamera = null;
const T3D_DOOR_YAW = 0.6;   // 타워가 상대 진영 쪽으로 돌아선 각도 (문이 상대를 본다)
let _t3dTowers = [];          // { el, group, base, hitUntil, lift }
let _t3dRaf = 0, _t3dDirty = true;

/** CSS의 --field-tilt / --field-depth를 그대로 읽는다 (한쪽만 고치면 어긋나므로) */
function _t3dGroundParams() {
  const map = document.getElementById('tile-map');
  const cs = map ? getComputedStyle(map) : null;
  const tilt = parseFloat(cs?.getPropertyValue('--field-tilt')) || 18;
  const depth = parseFloat(cs?.getPropertyValue('--field-depth')) || 1100;
  return { a: tilt * Math.PI / 180, d: depth };
}

/**
 * 맵 논리 좌표 → 눕힌 바닥 위에 실제로 그려지는 자리.
 * css/game.css의 `perspective(d) rotateX(a)` (원점 50% 50%)를 그대로 푼 것.
 * s는 그 자리의 타일이 커/작아진 비율 — 건물도 같은 비율로 키워야 칸에 맞는다.
 */
function t3dGroundProject(mapX, mapY) {
  const { a, d } = _t3dGroundParams();
  const u = mapX - T3D_MAP_W / 2;
  const v = mapY - T3D_MAP_H / 2;
  const s = d / (d - v * Math.sin(a));
  return { x: T3D_MAP_W / 2 + u * s, y: T3D_MAP_H / 2 + v * Math.cos(a) * s, s };
}

/* ── 돌 텍스처 ──────────────────────────────────────────────
   파일을 따로 두지 않고 캔버스에 벽돌을 그려서 쓴다.
   NearestFilter라서 확대해도 흐려지지 않고 각진 돌로 보인다. */
function _t3dStoneTex(hex, seedRows) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const base = parseInt(hex.slice(1), 16);
  const shade = j => {
    const r = Math.max(0, Math.min(255, ((base >> 16) & 255) + j));
    const gg = Math.max(0, Math.min(255, ((base >> 8) & 255) + j));
    const b = Math.max(0, Math.min(255, (base & 255) + j));
    return `rgb(${r},${gg},${b})`;
  };
  g.fillStyle = shade(-26);           // 줄눈
  g.fillRect(0, 0, 64, 64);

  const bw = 16, bh = 8;
  let seed = seedRows || 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let row = 0; row * bh < 64; row++) {
    const off = (row % 2) ? bw / 2 : 0;
    for (let x = -bw; x < 64; x += bw) {
      g.fillStyle = shade(Math.round(rnd() * 26 - 13));
      g.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 텍스처를 가진 상자 하나. (x,z)는 가운데, y0은 밑면 높이 */
function _t3dBox(w, h, d, mat, x, y0, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y0 + h / 2, z);
  return m;
}

/** 면 크기에 맞춰 벽돌이 늘어지지 않도록 텍스처 반복을 잡아 준 재질 */
function _t3dStoneMat(tex, tint, scale) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(scale, scale);
  return new THREE.MeshLambertMaterial({ map: t, color: tint });
}

/**
 * 석조 망루 한 채.
 * 밑면이 y=0이고 (0,0)이 가운데 — placeAt이 그 점을 타일 한가운데에 놓는다.
 */
function _t3dBuildTower(opts) {
  const g = new THREE.Group();
  const stone = _t3dStoneTex(opts.stone, opts.seed);
  const wall = _t3dStoneMat(stone, 0xffffff, 3);
  const trim = _t3dStoneMat(stone, 0xdfe6ee, 1.4);
  const dark = new THREE.MeshLambertMaterial({ color: 0x14161f });

  const W = opts.width;            // 몸통 한 변
  const SH = opts.shaft;           // 몸통 높이

  // 기단 — 살짝 넓게 퍼져야 땅에 박힌 것처럼 보인다 (떠 보이는 걸 막는 핵심)
  g.add(_t3dBox(W + 16, 7, W + 16, trim, 0, 0, 0));
  g.add(_t3dBox(W + 8, 7, W + 8, wall, 0, 7, 0));

  // 몸통
  g.add(_t3dBox(W, SH, W, wall, 0, 14, 0));

  // 처마 — 위가 한 겹 튀어나와야 '성'으로 읽힌다
  const pTop = 14 + SH;
  g.add(_t3dBox(W + 14, 9, W + 14, trim, 0, pTop, 0));

  // 흉벽(가슴벽)과 그 위의 총안 — 이 톱니가 이 건물의 인상을 결정한다
  const PW = W + 14;
  const mSize = PW / 7;
  const inner = _t3dStoneMat(stone, 0x717a8a, 1.2);
  g.add(_t3dBox(PW, 2, PW, inner, 0, pTop + 9, 0));   // 안쪽 바닥(그늘)
  // 모서리를 포함해 한 칸 걸러 하나씩 세워야 톱니로 보인다 (다 채우면 그냥 벽)
  const edge = PW / 2 - mSize / 2;
  const at = i => -edge + i * (2 * edge / 6);
  const merlon = (x, z) => g.add(_t3dBox(mSize, mSize * 1.5, mSize, trim, x, pTop + 9, z));
  for (const i of [0, 2, 4, 6]) {
    merlon(at(i), -edge); merlon(at(i), edge);
    merlon(-edge, at(i)); merlon(edge, at(i));
  }

  // 문과 창 — 문은 상대 진영을 바라보는 면에 하나 (opts.door: 'right' 내 타워 · 'left' 상대 타워 ·
  // 'front' 컷씬처럼 카메라가 상대 쪽에 있을 때). 창은 네 면 모두에 — 어느 쪽에서 봐도 같은 건물이다
  const f = W / 2 + 0.6;
  const FACES = { front: [0, 1], back: [0, -1], right: [1, 0], left: [-1, 0] };
  // 면 위의 상자: lat = 면을 따라 옆으로, w·h = 면에서 본 폭·높이
  const onFace = (name, w, h, lat, y) => {
    const [nx, nz] = FACES[name];
    g.add(nx ? _t3dBox(1.2, h, w, dark, nx * f, y, lat * nx)
             : _t3dBox(w, h, 1.2, dark, lat * nz, y, nz * f));
  };
  onFace(opts.door || 'front', W * 0.3, W * 0.42, 0, 14);
  Object.keys(FACES).forEach(name => {
    for (let i = 0; i < opts.windows; i++) {
      const y = 14 + SH * (0.42 + i * 0.26);
      onFace(name, W * 0.14, W * 0.24, -W * 0.22, y);
      onFace(name, W * 0.14, W * 0.24, W * 0.22, y);
    }
  });

  // 깃발 — 내 것/적 것을 한눈에 구분하는 표식
  const flagMat = new THREE.MeshLambertMaterial({
    color: opts.team, emissive: opts.team, emissiveIntensity: 0.35, side: THREE.DoubleSide
  });
  const pole = new THREE.MeshLambertMaterial({ color: 0x6b5638 });
  // 깃대는 킹 타워에만 — 옆 타워(2행)는 화면 위로 잘려서 세울 자리가 없다
  const poleH = opts.king ? 42 : 0;
  if (poleH) {
    g.add(_t3dBox(3.5, poleH, 3.5, pole, 0, pTop + 9, 0));
    // 카메라는 거의 정면에서 본다 — 깃발을 x로 펼쳐야 면이 보인다 (z로 펴면 실처럼 보인다)
    g.add(_t3dBox(W * 0.7, poleH * 0.42, 1.6, flagMat, W * 0.35 + 2, pTop + 9 + poleH * 0.48, 0));
  }

  // 진영 색 띠 — 몸통 아래쪽에 한 줄 둘러서 멀리서도 구분된다
  const bandMat = new THREE.MeshLambertMaterial({
    color: opts.team, emissive: opts.team, emissiveIntensity: 0.3
  });
  g.add(_t3dBox(W + 1.6, 7, W + 1.6, bandMat, 0, 14 + SH * 0.06, 0));

  if (opts.king) {
    // 킹 타워 — 금빛 관을 씌워 확실히 구분한다
    const gold = new THREE.MeshLambertMaterial({
      color: 0xffcc55, emissive: 0x996600, emissiveIntensity: 0.25
    });
    g.add(_t3dBox(PW + 3, 4, PW + 3, gold, 0, pTop - 4, 0));
  }

  g.userData.width  = W;                                         // 몸통 한 변 — 연출이 두를 반지름의 기준
  g.userData.height = pTop + 9 + Math.max(mSize * 1.5, poleH);   // 톱니/깃대 끝까지
  g.userData.hud    = pTop + 9;           // 체력 숫자가 기대는 곳 = 흉벽 높이
  return g;
}

/**
 * 조준 윤곽선 — 건물을 이루는 상자마다 조금 큰 복제를 하나씩 만들어 뒤집어 씌운다.
 *
 * 안쪽 면만 그리게(BackSide) 하면 진짜 건물에 가려지고 삐져나온 가장자리만 남는다.
 * 그래서 '입체물을 따라 두른 테두리'로 보인다. 상자마다 크기가 다르므로 축마다
 * (크기+두께)/크기 로 늘려야 테두리 굵기가 일정하다 — 통째로 1.05배 키우면
 * 큰 덩어리는 두껍고 작은 톱니는 얇아진다.
 */
function _t3dBuildOutline(g) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff5a78, side: THREE.BackSide });
  const out = new THREE.Group();
  out.visible = false;
  const T = 3;                       // 테두리 두께 (맵 px)
  g.children.slice().forEach(m => {
    const p = m.geometry?.parameters;
    if (!p) return;
    // 창·문·깃발·흉벽 안쪽 바닥처럼 얇은 장식은 뺀다 —
    // 건물 속에 든 판때기라 테두리가 지붕 위로 삐져나와 지저분해진다
    if (Math.min(p.width, p.height, p.depth) < 3) return;
    const o = new THREE.Mesh(m.geometry, mat);
    o.position.copy(m.position);
    o.scale.set((p.width + T) / p.width, (p.height + T) / p.height, (p.depth + T) / p.depth);
    out.add(o);
  });
  g.add(out);          // 반복이 끝난 뒤에 붙인다 — 안 그러면 자기 자신을 복제한다
  g.userData.outlineMat = mat;
  return out;
}

/** 건물의 발을 (col,row) 타일 한가운데에 놓는다 */
function _t3dPlace(group, col, row) {
  return _t3dPlaceAt(group, col * 100 + 50, row * 100 + 50);
}

/** 맵 안 아무 자리에나 발을 놓는다 (타워는 칸 한가운데, 토템은 클릭한 자리) */
function _t3dPlaceAt(group, mapX, mapY) {
  const p = t3dGroundProject(mapX, mapY);
  const a = p.x - T3D_MAP_W / 2;          // 화면 x (가운데 기준)
  const b = T3D_MAP_H / 2 - p.y;          // 화면 y (위가 +)
  // 직교 카메라의 역변환 — y=0 평면 위에서 그 화면 자리로 가는 (X,Z)
  const k = -b / Math.sin(T3D_ELEV);
  group.position.set(
    a * Math.cos(T3D_AZI) + k * Math.sin(T3D_AZI),
    0,
    -a * Math.sin(T3D_AZI) + k * Math.cos(T3D_AZI)
  );
  group.userData.scale = p.s;             // 먼 줄은 타일이 작으니 건물도 작게
  group.scale.setScalar(p.s);
  return p;
}

/**
 * 마우스 판정 면적을 '건물 전체'로 맞춘다.
 *
 * 눈에 보이는 건 3D인데 누르는 판은 DOM(.tower-body)이다. 그 판을 건물이 화면에
 * 차지하는 네모(3D 경계 상자를 카메라로 투영한 것)에 맞춰야 보이는 대로 눌린다.
 * 조준·사거리 계산은 여전히 .tower-block(한 칸)이 하므로 여기 값이 바뀌어도
 * 게임 수치는 그대로다 — 바뀌는 건 '어디를 눌러야 잡히나'뿐이다.
 */
function _t3dSyncHitBox(t, base) {
  const g = t.group;
  // 누르는 판은 돌리기 전(정면) 모양으로 잰다 — 비스듬히 돌린 상자로 재면 판이 넓어져
  // 킹 타워 판이 옆 타워 발밑까지 덮는다 (문 방향은 보이는 모습만의 일이다)
  const yaw = g.rotation.y;
  g.rotation.y = 0;
  g.updateMatrixWorld(true);
  // 카메라의 역행렬은 render()에서야 갱신된다 — 첫 렌더 전에 투영하면 값이 엉킨다.
  // (Camera.updateMatrixWorld가 matrixWorldInverse까지 같이 맞춰 준다)
  _t3dCamera.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  g.rotation.y = yaw;
  g.updateMatrixWorld(true);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(
      (i & 1) ? box.max.x : box.min.x,
      (i & 2) ? box.max.y : box.min.y,
      (i & 4) ? box.max.z : box.min.z
    ).project(_t3dCamera);
    const { x: sx, y: sy } = _t3dToMap(v);
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  // .tower의 한가운데(= 건물의 발)를 기준으로 한 값으로 바꿔서 넘긴다
  const st = t.el.style;
  st.setProperty('--hit-l',     (minX - base.x).toFixed(1) + 'px');
  st.setProperty('--hit-w',     (maxX - minX).toFixed(1) + 'px');
  st.setProperty('--hit-h',     (maxY - minY).toFixed(1) + 'px');
  st.setProperty('--hit-below', (maxY - base.y).toFixed(1) + 'px');
}

/** 체력 숫자를 지붕 위로 올린다 (건물이 칸 위로 솟으니 아래에 두면 가린다) */
function _t3dSyncHud(t) {
  // 흉벽 높이의 0.6 — 숫자가 벽 위쪽에 얹히고 톱니(총안)는 가리지 않는다.
  // 지붕 '위'로 완전히 띄우면 2행 타워는 화면 밖으로 나간다.
  const top = t.group.userData.hud * t.group.userData.scale * Math.cos(T3D_ELEV);
  t.el.style.setProperty('--hp-up', (top * 0.6).toFixed(1) + 'px');
}

/** 필드 타워와 똑같은 건물 (컷씬용) — 같은 크기·같은 돌·같은 시드 */
function towers3dBuildLike(mine, pos, door) {
  const king = pos === 'king';
  const id = `tower-${mine ? 'my' : 'enemy'}-${pos}`;
  return _t3dBuildTower({
    king, width: king ? 62 : 50, shaft: king ? 150 : 96, windows: king ? 2 : 1,
    stone: mine ? '#93a6c4' : '#c4a093', team: mine ? 0x3f86ea : 0xe24848,
    seed: (id.length * 977) + (king ? 31 : 7) + (mine ? 3 : 0), door,
  });
}

function towers3dInit() {
  if (_t3dRenderer || typeof THREE === 'undefined') return;
  const map = document.getElementById('tile-map');
  if (!map) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch (e) {
    console.warn('[towers3d] WebGL을 못 써서 CSS 타워로 둔다', e);
    return;
  }
  if (!renderer.getContext()) return;

  _t3dRenderer = renderer;
  renderer.setPixelRatio(Math.min(3, (window.devicePixelRatio || 1) * 1.6));
  renderer.setSize(T3D_VIEW_W, T3D_VIEW_H, false);
  const cv = renderer.domElement;
  cv.id = 'tower3d';
  cv.className = 'tower3d';
  // 맵보다 사방으로 T3D_PAD 넓게 (맵 단위 — 타일 맵의 이동·확대를 그대로 먹는다)
  Object.assign(cv.style, { left: -T3D_PAD + 'px', top: -T3D_PAD + 'px', width: T3D_VIEW_W + 'px', height: T3D_VIEW_H + 'px' });
  map.appendChild(cv);

  _t3dScene = new THREE.Scene();
  // 화면 1px = 월드 1 — 직교라서 줄이 달라도 건물 크기가 제멋대로 바뀌지 않는다
  _t3dCamera = new THREE.OrthographicCamera(
    -T3D_VIEW_W / 2, T3D_VIEW_W / 2, T3D_MAP_H / 2 + T3D_PAD, -(T3D_MAP_H / 2 + T3D_PAD_B), 1, 8000);
  _t3dCamera.position.set(
    Math.sin(T3D_AZI) * Math.cos(T3D_ELEV),
    Math.sin(T3D_ELEV),
    Math.cos(T3D_AZI) * Math.cos(T3D_ELEV)
  ).multiplyScalar(3000);
  _t3dCamera.lookAt(0, 0, 0);

  // 밤 — 달(화면 오른쪽 위, 섬 너머)에서 오는 차가운 빛. 앞면이 너무 어두우면 타워를 읽기 어려워
  // 하늘빛(반구광)을 넉넉히 두고, 달빛은 오른쪽 위에서 비스듬히 · 테두리 빛은 달이 있는 뒤쪽에서
  _t3dScene.add(new THREE.HemisphereLight(0xc4d4f4, 0x23304c, 0.9));
  const sun = new THREE.DirectionalLight(0xe4ecff, 0.78);
  sun.position.set(0.55, 1.1, 0.55);
  _t3dScene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fc2ff, 0.45);
  rim.position.set(0.7, 0.45, -0.9);
  _t3dScene.add(rim);
  _t3dBuildWalls();                     // 필드를 둘러싼 섬 가장자리(잔디 블록) · 앞쪽 부두 · 선착장 · 요트
  _t3dFireLightsInit();                 // 불이 비출 주황 점광원 (처음부터 두어야 재질이 다시 컴파일되지 않는다)

  _t3dTowers = [];
  document.querySelectorAll('.tower').forEach(el => {
    const king = el.classList.contains('king-tower');
    const mine = el.classList.contains('my-tower');
    const g = _t3dBuildTower({
      king,
      // 2행 타워는 기본 화면(맵 y 144~756) 위쪽 여유가 126px뿐이다 —
      // 옆 타워는 화면 높이 113px에 맞춰 잡았다 (넘기면 지붕이 잘린다)
      width:   king ? 62 : 50,
      shaft:   king ? 150 : 96,
      windows: king ? 2 : 1,
      stone:   mine ? '#93a6c4' : '#c4a093',
      team:    mine ? 0x3f86ea : 0xe24848,
      door:    'front',
      seed:    (el.id.length * 977) + (king ? 31 : 7) + (mine ? 3 : 0)
    });
    _t3dScene.add(g);
    const t = { el, group: g, outline: _t3dBuildOutline(g), hitUntil: 0, lift: 0, stone: mine ? 0x93a6c4 : 0xc4a093 };
    // 문이 상대 진영을 바라보게 건물을 돌린다 (내 타워는 오른쪽, 상대 타워는 왼쪽으로).
    // 옆면에 문을 달면 이 카메라 각도에서는 옆면이 거의 안 보여 문이 사라진다 — 비스듬히 돌리면 둘 다 보인다
    // 카메라가 오른쪽으로 T3D_AZI만큼 돌아 있어서, 같은 각도로만 돌리면 내 타워는 거의 정면을 보고
    // 상대 타워는 옆을 본다 (2026-10-02 사용자: 내 문도 상대 문처럼 보이게). 카메라에서 본 각이 서로 거울이 되게
    // 내 타워는 카메라 방위의 두 배를 더 돈다 — 카메라 기준 +0.9 / -0.9
    t.yaw = mine ? T3D_DOOR_YAW + 2 * T3D_AZI : -T3D_DOOR_YAW;
    _t3dTowers.push(t);
  });

  towers3dLayout();
  document.body.classList.add('t3d');
  _t3dLoop();
}

/** 칸 좌표가 바뀌거나 화면이 바뀌면 다시 앉힌다 */
function towers3dLayout() {
  _t3dTowers.forEach(t => {
    t.group.rotation.y = t.yaw || 0;
    const base = _t3dPlace(t.group, Number(t.el.style.getPropertyValue('--col')),
                                    Number(t.el.style.getPropertyValue('--row')));
    _t3dSyncHitBox(t, base);
    _t3dSyncHud(t);
  });
  _t3dDirty = true;
}

function _t3dLoop() {
  _t3dRaf = requestAnimationFrame(_t3dLoop);
  const now = performance.now();
  let animating = _t3dTotemStep(now);
  if (_t3dBloomStep(now)) animating = true;
  if (_t3dCrumbleStep(now)) animating = true;
  if (_t3dChipStep(now)) animating = true;
  if (_t3dWaveStep(now)) animating = true;
  if (_t3dLoveStep(now)) animating = true;
  for (const fn of _t3dSteps) if (fn(now)) animating = true;

  _t3dTowers.forEach(t => {
    const cl = t.el.classList;
    const dead = cl.contains('destroyed');
    // 무너지는 중 · 빛으로 사라지는 중 — 파괴된 뒤에도 연출이 끝날 때까지 그린다
    if (t.fall) {
      if (!dead) _t3dFallReset(t);                       // 되살아났다 — 서 있던 모습으로
      else if (!t.fall.done) { _t3dFallStep(t, now); animating = true; return; }
    }
    const vis = !dead;
    if (t.group.visible !== vis) { t.group.visible = vis; _t3dDirty = true; }
    if (dead) return;

    // 드래그 조준 중이면 건물 전체에 테두리가 둘리고 살짝 떠오른다
    const heal = cl.contains('drag-over-heal');
    const over = heal || cl.contains('drag-over');
    // 사랑의 화살 회복 — 잠깐 분홍 테두리가 숨 쉬듯 빛난다 (조준 테두리가 있으면 그쪽이 먼저)
    const love = !over && now < (t.glowUntil || 0);
    const showLine = over || love;
    const lineCol = over ? (heal ? 0x5fe06a : 0xff5a78) : 0xff6fae;
    if (t.outline.visible !== showLine || t.lineCol !== lineCol) {
      t.outline.visible = showLine;
      t.lineCol = lineCol;
      if (showLine) t.group.userData.outlineMat.color.setHex(lineCol);
      _t3dDirty = true;
    }
    if (love) {
      const k = (t.glowUntil - now) / 900;
      t.group.userData.outlineMat.color.setHex(0xff6fae).multiplyScalar(0.55 + 0.45 * Math.abs(Math.sin(k * Math.PI * 2)));
      animating = true;
    }
    const want = over ? 7 : 0;
    if (Math.abs(t.lift - want) > 0.2) { t.lift += (want - t.lift) * 0.25; animating = true; }
    else if (t.lift !== want) { t.lift = want; _t3dDirty = true; }

    // 맞으면 한 번 흔들린다 — CSS .tower-hit이 붙는 순간을 보고 시작한다
    if (cl.contains('tower-hit') && !t.wasHit) { t.hitUntil = now + 320; }
    t.wasHit = cl.contains('tower-hit');

    let sx = 0, rz = 0;
    if (now < t.hitUntil) {
      const k = (t.hitUntil - now) / 320;
      sx = Math.sin(now / 18) * 5 * k;
      rz = Math.sin(now / 15) * 0.06 * k;
      animating = true;
    }
    // 돌에 맞았다 — 맞은 쪽 반대로 크게 휘청였다 돌아오고, 맞는 순간 돌이 하얗게 달아오른다
    let squash = 1;
    const ia = now - (t.impactAt || -1e9);
    if (ia < T3D_IMPACT_MS) {
      const k = 1 - ia / T3D_IMPACT_MS;
      const w = Math.sin(ia / T3D_IMPACT_MS * Math.PI * 2.6);
      rz += t.impactDir * w * 0.16 * k;
      sx += t.impactDir * w * 7 * k;
      squash = 1 - 0.08 * Math.max(0, 1 - ia / 140);
      _t3dFlash(t, Math.max(0, 1 - ia / 320));
      animating = true;
    } else if (t.flashOn) {
      _t3dFlash(t, 0);
      _t3dDirty = true;
    }
    // 지진·붕괴 범위 안 — 땅이 울리는 동안 건물이 잘게 떨린다 (board.js가 .tower-quake를 붙인다)
    if (cl.contains('tower-quake')) {
      rz += Math.sin(now / 21) * 0.028 + Math.sin(now / 13) * 0.012;
      sx += Math.sin(now / 17) * 2.2;
      animating = true;
    }

    const s = t.group.userData.scale;
    // 침수 — 반쯤 가라앉아 물에 떠 있듯 출렁인다 (바닥 아래는 잘라 낸다)
    let sinkY = 0;
    if (t.sink) {
      const age = now - t.sink.born;
      if (age >= t.sink.ms) _t3dSinkEnd(t);
      else {
        const k = Math.min(1, age / 380) * Math.min(1, (t.sink.ms - age) / 480);
        const e = k * k * (3 - 2 * k);
        sinkY = (-t.sink.depth * e + Math.sin(now / 280) * 2.2 * e) * s;
        t.group.rotation.x = Math.sin(now / 520) * 0.025 * e;
        animating = true;
      }
    }
    t.group.position.y = t.lift + sinkY;
    t.group.rotation.z = rz;
    t.group.rotation.y = (t.yaw || 0) + sx * 0.004;
    const sc = s * (over ? 1.06 : 1);
    t.group.scale.set(sc * (2 - squash), sc * squash, sc * (2 - squash));

    // 되살아나기를 기다리는 타워는 반투명으로
    const ghost = cl.contains('pending-revival');
    if (t.ghost !== ghost) {
      t.ghost = ghost;
      t.group.traverse(o => {
        if (!o.material) return;
        o.material.transparent = ghost;
        o.material.opacity = ghost ? 0.45 : 1;
      });
      _t3dDirty = true;
    }
  });

  if (_t3dDirty || animating) {
    if (_t3dWaves.length) _t3dRenderWater();
    else _t3dRenderer.render(_t3dScene, _t3dCamera);
    // 앞 씬 — 토템·무너지는 토막·깨지는 하트가 있을 때만 (빛 둘은 늘 들어 있다)
    if (_t3dFxScene && _t3dFxScene.children.length > 2) {
      // 깊이만 지우고 한 번 더 그린다 — 토템이 건물에 가리지 않으면서
      // 토템 자체의 앞뒤(기둥·잎)는 그대로 유지된다
      _t3dRenderer.autoClear = false;
      _t3dRenderer.clearDepth();
      _t3dRenderer.render(_t3dFxScene, _t3dCamera);
      _t3dRenderer.autoClear = true;
    }
    _t3dDirty = false;
  }
}


// ══════════════════════════════════════════════════════════
//  설치형 토템 (숲의정령 · 흰꽃)
//
//  타워와 같은 카메라·같은 바닥 투영을 쓴다 — 그래서 필드와 따로 놀지 않고
//  같은 각도로 서 있다. 범위 원과 풀·꽃잎은 그대로 SVG가 그린다 (바닥 장식).
//  여기서 만드는 것은 한가운데에 서는 '물건'뿐이다.
// ══════════════════════════════════════════════════════════
// 토템은 타워와 따로 된 씬에 둔다.
// 같은 씬에 두면 가운데(킹 타워 칸)에 설치했을 때 건물 뒤로 완전히 가려
// 내가 뭐를 놓았는지 보이지 않는다. 연출은 항상 앞에 보여야 한다
// (DOM 쪽 연출도 #fx-layer가 타워보다 위에 있다).
let _t3dFxScene = null;
let _t3dTotems = [];

/** 앞에 그릴 씬을 준비한다 (빛은 물체마다 부모가 하나라 여기에도 따로 달아 준다) */
function _t3dEnsureFxScene() {
  if (_t3dFxScene) return;
  _t3dFxScene = new THREE.Scene();
  _t3dFxScene.add(new THREE.HemisphereLight(0xcfe2ff, 0x2a3350, 0.85));
  const sun = new THREE.DirectionalLight(0xfff4e0, 0.85);
  sun.position.set(-0.5, 1.1, 0.8);
  _t3dFxScene.add(sun);
}

function _t3dTotemModel(kind) {
  const g = new THREE.Group();
  const green = kind !== 'whiteblossom';
  const wood  = new THREE.MeshLambertMaterial({ color: green ? 0x7a5a36 : 0x8a7f72 });
  const stone = new THREE.MeshLambertMaterial({ color: green ? 0x6f8a5e : 0xc9c4bb });
  const leaf  = new THREE.MeshLambertMaterial({
    color: green ? 0x4fbf6a : 0xf2f6ff,
    emissive: green ? 0x1d5c2c : 0x6a7590, emissiveIntensity: 0.3
  });
  const glow = new THREE.MeshBasicMaterial({ color: green ? 0xc9ffd6 : 0xfff3c9 });

  // 받침 — 살짝 퍼져야 땅에 박힌 것처럼 보인다
  g.add(_t3dBox(46, 7, 46, stone, 0, 0, 0));
  g.add(_t3dBox(36, 6, 36, wood,  0, 7, 0));

  // 기둥 — 세 토막을 번갈아 조금씩 틀어 쌓는다
  for (let i = 0; i < 3; i++) {
    const m = _t3dBox(26 - i * 2, 20, 26 - i * 2, i % 2 ? stone : wood, 0, 13 + i * 20, 0);
    m.rotation.y = (i % 2 ? 1 : -1) * 0.18;
    g.add(m);
  }

  // 빛나는 구슬
  const orb = new THREE.Mesh(new THREE.SphereGeometry(9, 14, 10), glow);
  orb.position.set(0, 80, 0);
  g.add(orb);

  if (green) {
    // 잎 — 위로 갈수록 좁아지는 세 겹
    [[42, 14, 86], [32, 13, 98], [20, 11, 109]].forEach(([w, h, y]) => {
      const m = _t3dBox(w, h, w, leaf, 0, y, 0);
      m.rotation.y = 0.4;
      g.add(m);
    });
  } else {
    // 꽃잎 — 구슬 둘레에 다섯 장
    for (let i = 0; i < 5; i++) {
      const p = _t3dBox(22, 6, 9, leaf, 0, 88, 0);
      p.position.set(Math.cos(i / 5 * Math.PI * 2) * 13, 90, Math.sin(i / 5 * Math.PI * 2) * 13);
      p.rotation.y = -i / 5 * Math.PI * 2;
      g.add(p);
    }
    g.add(_t3dBox(12, 8, 12, glow, 0, 92, 0));
  }
  g.userData.orb = orb;
  // 시들 때 바꿀 재질 (폭염의 열기 — towers3dTotemWither)
  g.userData.leaf = leaf;
  g.userData.glow = glow;
  g.userData.wood = wood;
  return g;
}

/** 토템의 남은 시간이 준다 (지진 · 바람 — board.js _totemShorten) — 더 일찍 줄어들어 사라지고, 잠깐 떤다 */
function towers3dTotemShorten(mapX, mapY, ms) {
  const t = _t3dTotems.find(x => Math.abs(x.mapX - mapX) < 2 && Math.abs(x.mapY - mapY) < 2);
  if (!t) return false;
  t.ms = Math.max(performance.now() - t.born + 450, t.ms - ms);
  t.shakeAt = performance.now();
  _t3dDirty = true;
  return true;
}

/**
 * 토템 하나를 세운다.
 * @param {number} mapX,mapY 맵 좌표 (설치한 자리)
 * @param {string} kind      'forest' | 'whiteblossom'
 * @param {number} ms        서 있는 시간
 * @returns {boolean} 3D로 세웠으면 true — false면 부르는 쪽이 평면 대비책을 쓴다
 */
function towers3dSpawnTotem(mapX, mapY, kind, ms) {
  if (!_t3dScene || !_t3dRenderer) return false;
  _t3dEnsureFxScene();
  const g = _t3dTotemModel(kind);
  _t3dFxScene.add(g);
  _t3dPlaceAt(g, mapX, mapY);
  _t3dTotems.push({ group: g, born: performance.now(), ms: ms || 5400, base: g.userData.scale, mapX, mapY, kind });
  _t3dDirty = true;
  return true;
}

// ── 토템이 무너진다 (붕괴) ──────────────────────────────────
// 쌓아 올린 토막들이 제각각 기울어 떨어지고, 바닥에 부딪혀 한 번 튄 뒤 흩어진다.
// 한꺼번에 줄어들며 사라지면 '꺼졌다'로 읽히고, 토막이 따로 떨어져야 '무너졌다'로 읽힌다.
let _t3dCrumbles = [];
const T3D_CRUMBLE_MS = 1100;

/**
 * 그 자리에 서 있는 토템을 무너뜨린다.
 * @param {number} mapX,mapY 세운 자리 (towers3dSpawnTotem에 넘긴 맵 좌표)
 * @returns {boolean} 무너뜨린 토템이 있었으면 true
 */
function towers3dCrumbleTotem(mapX, mapY) {
  const i = _t3dTotems.findIndex(t => Math.abs(t.mapX - mapX) < 2 && Math.abs(t.mapY - mapY) < 2);
  if (i < 0) return false;
  const t = _t3dTotems.splice(i, 1)[0];
  const g = t.group;
  // 자라나는 중이었어도 제 크기에서 무너진다
  g.scale.setScalar(t.base);
  g.position.y = 0;
  // 재질은 이 토템만의 것이다 — 같이 흐려져도 다른 토템에 번지지 않는다
  const seen = new Set();
  g.traverse(o => {
    if (!o.material || seen.has(o.material)) return;
    seen.add(o.material);
    o.material.transparent = true;
  });
  const parts = g.children.map((m, k) => {
    const h  = m.geometry?.parameters?.height || 8;
    const up = Math.max(0, m.position.y);             // 높이 있던 토막일수록 멀리 기울어 떨어진다
    const ang = k * 2.39996 + 0.7;                    // 황금각 — 토막마다 다른 방향
    const out = 18 + up * 0.55;
    return {
      m, half: h / 2,
      vx: Math.cos(ang) * out, vz: Math.sin(ang) * out,
      vy: 20 + (k % 3) * 18,
      rx: (k % 2 ? 1 : -1) * (2.2 + (k % 4) * 0.8),
      rz: (k % 3 - 1) * (1.8 + (k % 5) * 0.5),
      bounced: false
    };
  });
  _t3dCrumbles.push({ group: g, parts, born: performance.now(), last: performance.now(), mats: [...seen] });
  _t3dDirty = true;
  return true;
}

function _t3dCrumbleStep(now) {
  if (!_t3dCrumbles.length) return false;
  _t3dCrumbles = _t3dCrumbles.filter(c => {
    const age = now - c.born;
    if (age >= T3D_CRUMBLE_MS) {
      _t3dFxScene.remove(c.group);
      c.mats.forEach(m => m.dispose());
      return false;
    }
    const dt = Math.min(0.05, (now - c.last) / 1000);
    c.last = now;
    const G = 520;                                    // 무게감 — 너무 가벼우면 종이처럼 날린다
    c.parts.forEach(p => {
      p.vy -= G * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.z += p.vz * dt;
      p.m.position.y += p.vy * dt;
      p.m.rotation.x += p.rx * dt;
      p.m.rotation.z += p.rz * dt;
      // 바닥에 닿으면 한 번 튀고 그다음엔 눕는다
      if (p.m.position.y < p.half) {
        p.m.position.y = p.half;
        if (!p.bounced) { p.vy = Math.abs(p.vy) * 0.28; p.bounced = true; }
        else p.vy = 0;
        p.vx *= 0.55; p.vz *= 0.55; p.rx *= 0.5; p.rz *= 0.5;
      }
    });
    // 끝의 40% 동안 흐려진다
    const fade = Math.min(1, Math.max(0, (T3D_CRUMBLE_MS - age) / (T3D_CRUMBLE_MS * 0.4)));
    c.mats.forEach(m => { m.opacity = fade; });
    return true;
  });
  return true;
}

// ── 타워가 무너진다 / 빛으로 사라진다 ─────────────────────
//  collapse — 흔들리다 기울며 땅속으로 주저앉는다(바닥 아래는 잘라 낸다). 흉벽·처마·깃발·금관은
//             떨어져 나가 구르고, 몸통에서 돌 조각이 튀며, 발밑에서 흙먼지가 피어오른다.
//  light    — 킹이 무너진 진영의 남은 타워: 하얗게 달아오르다 빛으로 부서지며 사라진다
//             (사각별 빛 폭발은 board.js가 DOM으로 같은 순간에 터뜨린다 — T3D_LIGHT_BURST_MS).
const T3D_COLLAPSE_MS    = 1500;
const T3D_LIGHT_MS       = 760;
const T3D_LIGHT_BURST_MS = 330;    // 달아오름이 가장 밝은 순간 — 이때 빛 폭발이 터지고 건물이 흩어지기 시작한다
const _t3dGroundClip = [];         // 땅(y=0) 아래를 잘라 내는 면 — 처음 쓸 때 만든다
let _t3dDustTex = null;

function _t3dDust() {
  if (_t3dDustTex) return _t3dDustTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  _t3dDustTex = new THREE.CanvasTexture(c);
  return _t3dDustTex;
}

/**
 * 타워를 무너뜨리는 연출을 시작한다. board.js가 타워에 .destroyed를 붙인 직후 부른다.
 * @param {HTMLElement} el   .tower
 * @param {'collapse'|'light'} mode
 * @returns {boolean} 3D로 그리면 true (false면 부르는 쪽의 CSS 연출만 남는다)
 */
function towers3dFall(el, mode = 'collapse', opts = {}) {
  if (!_t3dRenderer || !_t3dScene) return false;
  const t = _t3dTowers.find(x => x.el === el);
  if (!t) return false;
  if (t.fall && !t.fall.done) return true;
  if (t.fall) _t3dFallReset(t);
  if (t.flashOn) _t3dFlash(t, 0);                        // 돌에 맞아 달아오른 채로 굳지 않게
  t.sink = null;
  t.impactAt = 0;
  _t3dRenderer.localClippingEnabled = true;
  if (!_t3dGroundClip.length) _t3dGroundClip.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));

  const g = t.group, s = g.userData.scale;
  // 서 있던 모습에서 시작한다 (조준 테두리·들림·흔들림은 걷는다)
  t.outline.visible = false;
  t.lift = 0;
  g.visible = true;
  g.position.y = 0;
  g.rotation.set(0, t.yaw || 0, 0);
  g.scale.setScalar(s);

  // 이 타워만의 재질 — 되살아날 때 돌려놓으려고 원래 값을 적어 둔다
  const mats = [];
  const seen = new Set();
  g.traverse(o => {
    if (!o.material || seen.has(o.material) || o.parent === t.outline) return;
    seen.add(o.material);
    const m = o.material;
    mats.push({ m, opacity: m.opacity, transparent: m.transparent,
                emissive: m.emissive ? m.emissive.getHex() : null, ei: m.emissiveIntensity });
    m.transparent = true;
    m.clippingPlanes = _t3dGroundClip;
    m.needsUpdate = true;
  });

  const now = performance.now() + (opts.delay || 0);    // 대기 동안은 떨리기만 한다 (_t3dFallStep의 age < 0)
  // 기우는 쪽 — 타워마다 정해져 있다 (모든 화면이 같은 쪽으로 무너진다)
  const seed = (el.id.length * 7 + (el.classList.contains('king-tower') ? 3 : 0)) % 5;
  const fall = { mode, born: now, last: now, mats, dur: opts.dur || T3D_COLLAPSE_MS, moved: [], parts: [], rubble: [], dust: [], deb: null,
                 tilt: (seed % 2 ? 1 : -1) * (0.8 + seed * 0.1) };
  t.fall = fall;

  if (mode === 'collapse') {
    const top = g.userData.hud - 12;                     // 처마·흉벽·깃발·금관 = 여기부터 위
    const W = g.userData.width;
    const deb = new THREE.Group();
    deb.position.copy(g.position);
    deb.rotation.copy(g.rotation);
    deb.scale.copy(g.scale);
    _t3dScene.add(deb);
    fall.deb = deb;
    let shaftMat = null, tallest = 0;
    g.children.slice().forEach((m, k) => {
      if (m === t.outline || !m.geometry) return;
      const p = m.geometry.parameters || {};
      if ((p.height || 0) > tallest) { tallest = p.height; shaftMat = m.material; }
      if (m.position.y < top) return;
      fall.moved.push({ m, p: m.position.clone(), r: m.rotation.clone() });
      deb.add(m);                                        // 같은 자리에 둔 채 몸통에서 떼어 낸다
      const ang = Math.atan2(m.position.z, m.position.x) + (k % 3 - 1) * 0.4;
      const out = 30 + (k % 5) * 14;
      fall.parts.push({
        m, half: Math.min(p.height || 6, p.width || 6, p.depth || 6) / 2,
        vx: Math.cos(ang) * out + fall.tilt * 55, vz: Math.sin(ang) * out,
        vy: 25 + (k % 4) * 22, rx: (k % 2 ? 1 : -1) * (2 + (k % 4)), rz: (k % 3 - 1) * 2.4,
        delay: (140 + (k % 6) * 45) * (opts.dur || T3D_COLLAPSE_MS) / T3D_COLLAPSE_MS, bounced: false,
      });
    });
    // 몸통에서 튀는 돌 조각
    const H = top;
    for (let i = 0; i < 18; i++) {
      const a = i * 2.39996;
      const sz = 5 + (i % 4) * 3;
      const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.8, sz), shaftMat);
      m.position.set(Math.cos(a) * W * 0.5, 14 + ((i * 37) % 100) / 100 * H * 0.75, Math.sin(a) * W * 0.5);
      m.visible = false;
      deb.add(m);
      fall.rubble.push(m);
      fall.parts.push({
        m, half: sz * 0.4,
        vx: Math.cos(a) * (60 + (i % 5) * 22), vz: Math.sin(a) * (60 + (i % 5) * 22),
        vy: 40 + (i % 3) * 50, rx: (i % 2 ? 1 : -1) * 5, rz: (i % 3 - 1) * 4,
        delay: (180 + i * 42) * (opts.dur || T3D_COLLAPSE_MS) / T3D_COLLAPSE_MS, bounced: false,
      });
    }
    // 흙먼지 — 발밑 둘레에서 차례로 피어오른다
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.SpriteMaterial({ map: _t3dDust(), color: 0xb9ad9c, transparent: true, opacity: 0, depthWrite: false });
      const sp = new THREE.Sprite(mat);
      const a = i / 12 * Math.PI * 2 + 0.3;
      const r = W * (0.45 + (i % 3) * 0.12) * s;
      sp.position.set(g.position.x + Math.cos(a) * r, 10 * s, g.position.z + Math.sin(a) * r);
      _t3dScene.add(sp);
      fall.dust.push({ sp, delay: 120 + (i % 6) * 110, x: Math.cos(a), z: Math.sin(a), s });
    }
  }
  _t3dDirty = true;
  return true;
}

function _t3dFallStep(t, now) {
  const f = t.fall, g = t.group, s = g.userData.scale, yaw = t.yaw || 0;
  const age = now - f.born;
  const cl = k => Math.max(0, Math.min(1, k));
  const ease = k => k * k * (3 - 2 * k);

  if (f.mode === 'light') {
    if (age >= T3D_LIGHT_MS) return _t3dFallDone(t);
    const k1 = cl(age / T3D_LIGHT_BURST_MS);                  // 달아오른다
    const k2 = ease(cl((age - T3D_LIGHT_BURST_MS) / (T3D_LIGHT_MS - T3D_LIGHT_BURST_MS)));   // 빛으로 흩어진다
    f.mats.forEach(o => {
      if (o.emissive != null) { o.m.emissive.setRGB(1, 0.97, 0.85); o.m.emissiveIntensity = k1 * 1.1; }
      o.m.opacity = o.opacity * (1 - k2);
    });
    const shake = (1 - k2) * k1;
    g.position.y = (k1 * 6 + k2 * 14) * s;
    g.rotation.set(0, yaw + Math.sin(now / 17) * 0.03 * shake, Math.sin(now / 13) * 0.02 * shake);
    g.scale.set(s * (1 + 0.06 * k1 + 0.3 * k2), s * (1 + 0.06 * k1) * (1 - 0.85 * k2), s * (1 + 0.06 * k1 + 0.3 * k2));
    return true;
  }

  if (age < 0) {
    // 무너지기 직전 — 밑동부터 울린다
    const r = 1 - cl(-age / 400);
    g.position.y = 0;
    g.rotation.set(0, yaw + Math.sin(now / 14) * 0.03 * r, Math.sin(now / 11) * 0.035 * r);
    f.last = now;
    return true;
  }
  const D = f.dur;
  if (age >= D) return _t3dFallDone(t);
  const dt = Math.min(0.05, (now - f.last) / 1000);
  f.last = now;

  // 몸통 — 잠깐 떨다가 기울며 땅속으로
  const sk = ease(cl((age - 120) / (D - 350)));
  const shake = 1 - cl(age / 500);
  g.position.y = -sk * (g.userData.hud + 6) * s;
  g.rotation.set(f.tilt * sk * 0.1, yaw + Math.sin(now / 16) * 0.035 * shake, f.tilt * sk * 0.26 + Math.sin(now / 12) * 0.03 * shake);

  // 떨어져 나간 조각 — 떨어지고 한 번 튀고 눕는다
  const G = 900;
  f.parts.forEach(p => {
    if (age < p.delay) return;
    p.m.visible = true;
    p.vy -= G * dt;
    p.m.position.x += p.vx * dt;
    p.m.position.z += p.vz * dt;
    p.m.position.y += p.vy * dt;
    p.m.rotation.x += p.rx * dt;
    p.m.rotation.z += p.rz * dt;
    if (p.m.position.y < p.half) {
      p.m.position.y = p.half;
      if (!p.bounced) { p.vy = Math.abs(p.vy) * 0.3; p.bounced = true; } else p.vy = 0;
      p.vx *= 0.5; p.vz *= 0.5; p.rx *= 0.45; p.rz *= 0.45;
    }
  });
  // 끝 무렵 조각이 흐려진다 (몸통은 이미 땅속이다)
  const fade = 1 - cl((age - D * 0.72) / (D * 0.28));
  f.mats.forEach(o => { o.m.opacity = o.opacity * fade; });

  // 흙먼지
  f.dust.forEach(d => {
    const k = cl((age - d.delay) / (D - 400));
    d.sp.material.opacity = k > 0 ? 0.7 * Math.min(1, k * 6) * Math.pow(1 - k, 1.4) : 0;
    const sc = (40 + 110 * ease(k)) * d.s;
    d.sp.scale.set(sc, sc * 0.8, 1);
    d.sp.position.x += d.x * 26 * d.s * dt;
    d.sp.position.z += d.z * 26 * d.s * dt;
    d.sp.position.y = (10 + 40 * k) * d.s;
  });
  return true;
}

// ── 침수 — 반쯤 가라앉는다 ─────────────────────────────────
/**
 * 그 타워를 ms 동안 흉벽 높이의 frac만큼 땅(물) 속으로 가라앉힌다. 바닥 아래는 잘라 낸다.
 * @returns {boolean} 3D로 그렸으면 true
 */
function towers3dSink(el, ms, frac = 0.5) {
  if (!_t3dRenderer || !_t3dScene) return false;
  const t = _t3dTowers.find(x => x.el === el);
  if (!t || t.fall || !t.group.visible) return false;
  _t3dRenderer.localClippingEnabled = true;
  if (!_t3dGroundClip.length) _t3dGroundClip.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  if (!t.sink) {
    t.group.traverse(o => {
      if (!o.material || o.parent === t.outline) return;
      o.material.clippingPlanes = _t3dGroundClip;
      o.material.needsUpdate = true;
    });
  }
  t.sink = { born: performance.now(), ms, depth: t.group.userData.hud * frac };
  _t3dDirty = true;
  return true;
}

function _t3dSinkEnd(t) {
  t.sink = null;
  t.group.rotation.x = 0;
  if (t.fall) return;                                   // 무너지는 중이면 자르기를 그대로 둔다
  t.group.traverse(o => {
    if (!o.material || o.parent === t.outline) return;
    o.material.clippingPlanes = null;
    o.material.needsUpdate = true;
  });
  _t3dDirty = true;
}

// ── 파도 — 말린 물마루가 맵을 가로질러 밀려간다 ─────────────────
// 맵 좌표(바닥) 위에 곧바로 정점을 놓는다: 바닥판이 원근으로 누워 있어서 줄마다 크기가 다르다 —
// 한 덩어리 모형을 옮기면 먼 줄과 가까운 줄이 어긋난다. 그래서 매 프레임 (맵 x, 맵 y, 높이)를 월드로 옮겨 다시 짓는다.
const T3D_WAVE_PROFILE = [
  // [앞끝에서 뒤로 (맵 px, 음수 = 앞으로 말려 나온 입술), 높이, 거품]
  [12, 0, 0.9], [4, 24, 0.55], [-5, 50, 0.45], [-13, 74, 0.6], [-20, 93, 0.95], [-15, 106, 1],
  [-3, 113, 1], [13, 111, 0.8], [34, 101, 0.5], [62, 84, 0.32], [100, 62, 0.22], [146, 42, 0.16],
  [196, 26, 0.12], [248, 13, 0.12], [300, 2, 0.2],
];
const T3D_WAVE_ROWS = 25;
const T3D_WAVE_TALL = 1.6;   // 단면 높이 배율 — 물마루가 옆 타워 지붕(약 130)을 넘는다
let _t3dWaves = [];
let _t3dWaveTex = null;

function _t3dMapWorld(mapX, mapY) {
  const p = t3dGroundProject(mapX, mapY);
  const a = p.x - T3D_MAP_W / 2;
  const b = T3D_MAP_H / 2 - p.y;
  const k = -b / Math.sin(T3D_ELEV);
  return { x: a * Math.cos(T3D_AZI) + k * Math.sin(T3D_AZI), z: -a * Math.sin(T3D_AZI) + k * Math.cos(T3D_AZI), s: p.s };
}

function _t3dWaveMat() {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,          // 뒤에 그릴 '비쳐 보이는 타워' 패스가 타워 자신의 깊이와 맞춰 보도록 (_t3dRenderWater)
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uCrash: { value: 0 }, uFlat: { value: 0 } },
    vertexShader: `
      attribute float aU; attribute float aV; attribute float aFoam; attribute float aH; attribute float aCap;
      varying float vU; varying float vV; varying float vFoam; varying float vH; varying float vCap;
      void main() { vU = aU; vV = aV; vFoam = aFoam; vH = aH; vCap = aCap;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uOpacity; uniform float uCrash; uniform float uFlat;
      varying float vU; varying float vV; varying float vFoam; varying float vH; varying float vCap;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
      void main() {
        vec3 deep = vec3(0.01, 0.12, 0.32), mid = vec3(0.04, 0.45, 0.76), light = vec3(0.45, 0.88, 1.0);
        vec3 col; float foam;
        if (vCap > 0.5) {
          // 옆면 — 물 덩어리의 단면. 아래는 깊고 어둡고, 위로 갈수록 빛이 비친다.
          // 속에서 기포가 떠오르고, 겉면(물마루·입술) 쪽 가장자리는 하얗게 부서진다
          col = mix(deep * 0.8, mid, smoothstep(0.0, 0.85, vH));
          col = mix(col, light, smoothstep(0.7, 1.1, vH) * 0.55);
          float sw = noise(vec2(vU * 26.0 + sin(vH * 9.0 + uTime * 1.7) * 0.6, vH * 14.0 - uTime * 1.2));
          col += vec3(0.35, 0.75, 1.0) * smoothstep(0.55, 0.9, sw) * 0.22;
          float bub = pow(noise(vec2(vU * 90.0, vH * 60.0 - uTime * 5.0)), 10.0);
          col += vec3(0.9, 0.98, 1.0) * bub * 1.2;
          float n = noise(vec2(vU * 34.0 + uTime * 0.7, vH * 18.0 - uTime * 2.4));
          foam = smoothstep(0.5, 0.85, vFoam * 0.6 + n * 0.5) * 0.85;
          col = mix(col, vec3(0.93, 0.99, 1.0), foam);
        } else {
          col = mix(deep, mid, smoothstep(0.0, 0.5, vH));
          col = mix(col, light, smoothstep(0.55, 1.0, vH));
          // 물마루를 넘어가는 결 — 뒤로 흘러가는 밝은 줄
          float streak = smoothstep(0.6, 0.92, noise(vec2(vV * 70.0, vU * 18.0 - uTime * 4.5)));
          col += vec3(0.55, 0.9, 1.0) * streak * 0.28;
          // 거품 — 입술과 물마루에 하얗게, 가장자리는 부서진다
          float n = noise(vec2(vV * 46.0 + uTime * 0.8, vU * 10.0 - uTime * 3.0));
          foam = smoothstep(0.42, 0.78, vFoam * 0.75 + n * 0.55);
          col = mix(col, vec3(0.94, 0.99, 1.0), foam * 0.92);
          // 말려 들어간 안쪽(앞면 아래)은 그늘
          col *= mix(0.55, 1.0, smoothstep(0.0, 0.32, vU));
          // 물마루 바로 뒤의 빛 띠 — 높이가 읽힌다
          col += vec3(0.5, 0.85, 1.0) * smoothstep(0.75, 1.0, vH) * smoothstep(0.62, 0.45, vU) * 0.35;
          // 반짝임
          col += vec3(1.0) * pow(noise(vec2(vV * 160.0, vU * 40.0 + uTime * 2.0)), 18.0) * 0.8;
        }
        // 끝에 부딪혀 부서지는 동안 — 온통 하얗게 들끓는다
        float boil = noise(vec2(vV * 38.0 + vU * 7.0, uTime * 6.0 + vU * 12.0));
        col = mix(col, vec3(0.95, 0.99, 1.0), uCrash * smoothstep(0.25, 0.75, boil) * 0.75);
        // 무너져 얇게 퍼진 물막 — 깊은 색·얼룩 거품 대신 옅고 맑은 물빛 (바닥에 고인 물로 이어진다)
        col = mix(col, vec3(0.32, 0.66, 0.92), uFlat * 0.65);
        gl_FragColor = vec4(col, uOpacity * (0.86 + 0.14 * foam) * (1.0 - uFlat * 0.45));
      }`,
  });
}

/**
 * 파도가 있을 때의 그리기 — 파도가 타워·유닛을 통째로 덮어 버리지 않게 세 번에 나눠 그린다.
 *   ① 파도 없이 (타워·유닛·잔해가 깊이를 남긴다)
 *   ② 파도·물보라만 (레이어 1) — 깊이를 쓰지 않는다
 *   ③ 타워·유닛을 한 번 더, 반투명으로 — 자기 깊이와 같은 곳(= 다른 건물에 가리지 않은 겉면)에만.
 *      물에 잠긴 건물이 물 너머로 비쳐 보이고, 원래 보이던 부분은 그대로다
 */
const T3D_WATER_LAYER = 1;
const T3D_XRAY_OPACITY = 0.5;
function _t3dRenderWater() {
  const r = _t3dRenderer, cam = _t3dCamera;
  r.render(_t3dScene, cam);
  r.autoClear = false;
  cam.layers.set(T3D_WATER_LAYER);
  r.render(_t3dScene, cam);
  cam.layers.set(0);
  const saved = [], hidden = [];
  _t3dScene.traverseVisible(o => {
    if (!o.layers.test(cam.layers)) return;
    // 반투명 장식(빛 알갱이·테두리 선)은 두 번 그리면 진해진다 — 이 패스에선 뺀다
    if (o.isSprite || o.isLine || o.isPoints) { hidden.push(o); return; }
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (!m || m.isShaderMaterial || saved.some(x => x.m === m)) return;
      saved.push({ m, transparent: m.transparent, opacity: m.opacity, depthFunc: m.depthFunc, depthWrite: m.depthWrite });
      m.transparent = true;
      m.opacity *= T3D_XRAY_OPACITY;
      m.depthFunc = THREE.EqualDepth;
      m.depthWrite = false;
    });
  });
  hidden.forEach(o => { o.visible = false; });
  r.render(_t3dScene, cam);
  hidden.forEach(o => { o.visible = true; });
  saved.forEach(x => { x.m.transparent = x.transparent; x.m.opacity = x.opacity; x.m.depthFunc = x.depthFunc; x.m.depthWrite = x.depthWrite; });
  r.autoClear = true;
}

/**
 * 파도 하나를 띄운다.
 * @param {object} o { backX: 뒤끝(맵 px), dir: ±1(밀려가는 쪽), width: 폭(맵 px), riseMs, travelMs, speedPx(초당 맵 px), calmMs }
 * @returns {boolean} 3D로 그렸으면 true
 */
function towers3dWave(o) {
  if (!_t3dRenderer || !_t3dScene) return false;
  const P = T3D_WAVE_PROFILE.length, R = T3D_WAVE_ROWS;
  // 정점: 겉면 P × R + 양 끝 옆면 2 × P (옆면은 맨 위·맨 아래 줄의 단면을 그대로 베껴 속을 채운다)
  const N = P * R + 2 * P;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const aU = new Float32Array(N), aV = new Float32Array(N), aF = new Float32Array(N), aH = new Float32Array(N), aC = new Float32Array(N);
  for (let j = 0; j < R; j++) for (let i = 0; i < P; i++) {
    const v = j * P + i;
    aU[v] = i / (P - 1); aV[v] = j / (R - 1); aF[v] = T3D_WAVE_PROFILE[i][2];
  }
  for (let e = 0; e < 2; e++) for (let i = 0; i < P; i++) {
    const v = P * R + e * P + i;
    aU[v] = i / (P - 1); aV[v] = e; aF[v] = T3D_WAVE_PROFILE[i][2]; aC[v] = 1;
  }
  geo.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
  geo.setAttribute('aV', new THREE.BufferAttribute(aV, 1));
  geo.setAttribute('aFoam', new THREE.BufferAttribute(aF, 1));
  geo.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
  geo.setAttribute('aCap', new THREE.BufferAttribute(aC, 1));
  const idx = [];
  for (let j = 0; j < R - 1; j++) for (let i = 0; i < P - 1; i++) {
    const a = j * P + i, b = a + 1, c = a + P, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // 옆면 — 단면(앞끝 → 물마루 → 뒤끝, 바닥으로 닫힌 다각형)을 삼각형으로 나눈다
  const contour = T3D_WAVE_PROFILE.map(([d, h]) => new THREE.Vector2(d, h));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (let e = 0; e < 2; e++) {
    const base = P * R + e * P;
    tris.forEach(([a, b, c]) => idx.push(base + a, base + b, base + c));
  }
  geo.setIndex(idx);
  const mat = _t3dWaveMat();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.layers.set(T3D_WATER_LAYER);
  _t3dScene.add(mesh);

  // 물보라 — 물마루에서 튀어 뒤로 흩어지는 물방울
  if (!_t3dWaveTex) _t3dWaveTex = _t3dDust();
  const spray = [];
  for (let i = 0; i < 170; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: _t3dWaveTex, color: i % 3 ? 0xe9f8ff : 0x9fdcff,
                                                         transparent: true, opacity: 0, depthWrite: false }));
    sp.userData = { life: 0 };
    sp.layers.set(T3D_WATER_LAYER);
    _t3dScene.add(sp);
    spray.push(sp);
  }
  // 끝에 부딪힐 때 치솟는 물기둥 — 맵 끝을 따라 줄지어 선다
  const plumes = [];
  for (let i = 0; i < T3D_PLUMES; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: _t3dPlume(), color: i % 4 ? 0xf2fbff : 0xbfe6ff,
                                                         transparent: true, opacity: 0, depthWrite: false }));
    sp.center.set(0.5, 0);
    sp.layers.set(T3D_WATER_LAYER);
    sp.userData = { mapY: (i + 0.2 + Math.random() * 0.6) / T3D_PLUMES * T3D_MAP_H, delay: Math.random() * 180,
                    hMax: 200 + Math.random() * 150, wMax: 80 + Math.random() * 60, back: 10 + Math.random() * 50 };   // 벽 바로 앞에서 솟는다
    sp.visible = false;
    _t3dScene.add(sp);
    plumes.push(sp);
  }
  const w = { o, mesh, geo, mat, spray, plumes, born: performance.now(), last: performance.now(), next: 0, crashed: false };
  _t3dWaves.push(w);
  // 솟구치는 순간 — 줄 전체에서 물보라가 한꺼번에 터진다
  for (let i = 0; i < 60; i++) _t3dWaveSpray(w, 0, 1.6, Math.random() * MAP_ROWS_PX());
  _t3dDirty = true;
  return true;
}

function MAP_ROWS_PX() { return T3D_MAP_H; }

/** 끝 벽을 때리고 치솟는 물기둥 — 아래가 뿌리, 위로 갈수록 흩어지는 물방울 (빌보드라 어느 각도에서도 보인다) */
let _t3dPlumeTex = null;
function _t3dPlume() {
  if (_t3dPlumeTex) return _t3dPlumeTex;
  const c = document.createElement('canvas');
  c.width = 96; c.height = 256;
  const g = c.getContext('2d');
  // 몸통 — 아래는 진하고 위로 갈수록 옅어지는 흰 물줄기
  const body = g.createLinearGradient(0, 256, 0, 0);
  body.addColorStop(0, 'rgba(255,255,255,0.95)');
  body.addColorStop(0.55, 'rgba(235,248,255,0.7)');
  body.addColorStop(1, 'rgba(220,242,255,0)');
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(30, 256);
  g.bezierCurveTo(18, 170, 8, 90, 20, 20);
  g.lineTo(76, 20);
  g.bezierCurveTo(88, 90, 78, 170, 66, 256);
  g.closePath();
  g.fill();
  // 부서지는 머리와 흩어지는 물방울
  for (let i = 0; i < 70; i++) {
    const y = Math.pow(Math.random(), 1.6) * 200, r = 2 + Math.random() * (y < 80 ? 9 : 6);
    const x = 48 + (Math.random() - 0.5) * (50 + (200 - y) * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  _t3dPlumeTex = new THREE.CanvasTexture(c);
  return _t3dPlumeTex;
}
const T3D_PLUMES = 18;
const T3D_PLUME_MS = 1300;

/** 물보라 한 방울을 물마루(맵 x = 앞끝 근처)에서 쏜다 */
function _t3dWaveSpray(w, frontX, power, mapY, opt) {
  const sp = w.spray.find(p => p.userData.life <= 0);
  if (!sp) return;
  const o = w.o;
  const fx = (frontX || w.front || 0) - o.dir * (Math.random() * 30);
  const p = _t3dMapWorld(fx, mapY);
  if (opt?.up) {
    // 끝 벽을 때리고 치솟는 물 — 곧게 위로, 내려올 땐 뒤(물이 온 쪽)로 흩어진다
    sp.userData = {
      life: 1, mapX: fx - o.dir * Math.random() * 20, mapY, h: (20 + Math.random() * 110) * T3D_WAVE_TALL,
      vx: -o.dir * (20 + Math.random() * 140), vh: (160 + Math.random() * 260) * power, vy: (Math.random() - 0.5) * 80,
      size: 34 + Math.random() * 60, s: p.s, decay: 0.55 + Math.random() * 0.5,
    };
    return;
  }
  sp.userData = {
    life: 1, mapX: fx, mapY, h: (90 + Math.random() * 30) * T3D_WAVE_TALL,
    vx: o.dir * (40 + Math.random() * 120) * (Math.random() < 0.3 ? -1 : 1),
    vh: (120 + Math.random() * 220) * power, vy: (Math.random() - 0.5) * 60,
    size: 26 + Math.random() * 46, s: p.s, decay: 0.8 + Math.random() * 0.7,
  };
  if (!frontX && w.front == null) sp.userData.mapX = o.backX + o.dir * o.width * (0.2 + Math.random() * 0.8);
}

function _t3dWaveStep(now) {
  if (!_t3dWaves.length) return false;
  _t3dWaves = _t3dWaves.filter(w => {
    const o = w.o;
    const age = now - w.born;
    const total = o.riseMs + o.travelMs + o.calmMs;
    const dt = Math.min(0.05, (now - w.last) / 1000);
    w.last = now;
    if (age >= total) {
      _t3dScene.remove(w.mesh);
      w.geo.dispose(); w.mat.dispose();
      w.spray.forEach(sp => { _t3dScene.remove(sp); sp.material.dispose(); });
      w.plumes.forEach(sp => { _t3dScene.remove(sp); sp.material.dispose(); });
      return false;
    }
    const ease = k => k * k * (3 - 2 * k);
    const clamp01 = k => Math.max(0, Math.min(1, k));
    // 높이 — 솟구치며 한 번 넘쳤다가 자리를 잡는다
    let amp = 1, opacity = 1;
    const tr = age - o.riseMs;
    if (age < o.riseMs) {
      const k = age / o.riseMs;
      amp = k < 0.7 ? 1.32 * ease(k / 0.7) : 1.32 - 0.32 * ease((k - 0.7) / 0.3);
      opacity = Math.min(1, k * 3);
    }
    // 맵 끝에 부딪힌다 — 그냥 줄어들지 않고:
    //   surge    (~0.55초) 말린 입술이 끝 벽에 눌려 펴지며 물이 벽을 타고 치솟는다
    //   collapse (~1.2초)  치솟은 물이 무너져 내리며 뒤로 쓸려 나가 얇은 물막이 된다
    //   fade               얇아진 물막이 바닥의 고인 물(DOM)로 넘어가며 사라진다
    let surge = 0, collapse = 0, crash = 0;
    if (tr > o.travelMs) {
      const kc = (tr - o.travelMs) / o.calmMs;
      // 돌벽에 부딪힌다 — 벽을 타고 솟았다가(surge) 천천히 내려앉으며(collapse) 잔잔해진 뒤에야 옅어진다
      surge = ease(clamp01(kc / 0.18));
      collapse = ease(clamp01((kc - 0.1) / 0.62));
      opacity = 1 - ease(clamp01((kc - 0.58) / 0.4));
      crash = Math.sin(Math.PI * clamp01(kc / 0.45));
    }
    const moved = Math.min(o.travelMs, Math.max(0, tr)) / 1000 * o.speedPx;
    const edge = o.backX + o.dir * (o.width + moved);
    const front = edge - o.dir * 40 * collapse;            // 내려앉으며 벽에서 조금 물러난다
    w.front = edge;
    const t = age / 1000;

    // 정점 — 줄마다 (맵 y) 단면을 맵 x로 펼쳐 월드에 놓는다
    const pos = w.geo.attributes.position.array, aH = w.geo.attributes.aH.array;
    const P = T3D_WAVE_PROFILE.length, R = T3D_WAVE_ROWS;
    const calmWob = 1 - collapse;
    for (let j = 0; j < R; j++) {
      const mapY = j / (R - 1) * T3D_MAP_H;
      const wob = (Math.sin(mapY / 130 + t * 2.3) * 9 + Math.sin(mapY / 47 - t * 3.7) * 4) * calmWob;
      const swell = 1 + Math.sin(mapY / 95 + t * 2.9) * 0.08;
      // 줄마다 벽을 타는 높이가 조금씩 다르다 — 한 장의 판처럼 보이지 않게
      const climbVar = 0.8 + 0.4 * (0.5 + 0.5 * Math.sin(mapY / 61 + 1.7) * Math.sin(mapY / 23 + t * 5));
      for (let i = 0; i < P; i++) {
        let [d, h] = T3D_WAVE_PROFILE[i];
        if (surge > 0) {
          if (d < 0) d *= 1 - surge;                      // 앞으로 나온 입술이 벽에 눌려 펴진다
          d *= 1 - 0.38 * surge;                          // 뒤쪽 물이 밀려와 쌓인다
          const face = i <= 7 ? 1 : Math.max(0, 1 - (i - 7) / 4);
          h *= 1 + 0.6 * surge * (1 - collapse) * face * climbVar;
          h *= 1 - 0.96 * collapse;                       // 내려앉아 얇은 물막이 된다
          d = d * (1 + 0.45 * collapse) + 18 * collapse;  // 그 물막이 뒤로 조금 퍼진다
        }
        // 맵 끝은 돌벽 안쪽 면 — 물은 벽을 뚫고 나가지 않는다 (예전엔 맵 밖으로 비어져 나가 입체감이 깨졌다)
        const mapX = Math.max(0, Math.min(T3D_MAP_W, front - o.dir * (d + (i < 8 ? wob : wob * 0.4))));
        const hh = h * T3D_WAVE_TALL * amp * swell;
        const p = _t3dMapWorld(mapX, mapY);
        const v = (j * P + i) * 3;
        pos[v] = p.x; pos[v + 1] = hh * p.s; pos[v + 2] = p.z;
        aH[j * P + i] = Math.min(1.2, hh / (113 * T3D_WAVE_TALL));
      }
    }
    // 옆면 — 맨 위·맨 아래 줄의 단면을 그대로 베낀다 (속이 빈 껍데기로 보이지 않게)
    for (let e = 0; e < 2; e++) {
      const src = (e ? R - 1 : 0) * P, dst = P * R + e * P;
      for (let i = 0; i < P; i++) {
        pos[(dst + i) * 3] = pos[(src + i) * 3];
        pos[(dst + i) * 3 + 1] = pos[(src + i) * 3 + 1];
        pos[(dst + i) * 3 + 2] = pos[(src + i) * 3 + 2];
        aH[dst + i] = aH[src + i];
      }
    }
    w.geo.attributes.position.needsUpdate = true;
    w.geo.attributes.aH.needsUpdate = true;
    w.mat.uniforms.uTime.value = t;
    w.mat.uniforms.uOpacity.value = opacity;
    w.mat.uniforms.uCrash.value = crash;
    w.mat.uniforms.uFlat.value = collapse;

    // 물보라 — 밀려가는 동안 물마루에서 끊임없이, 끝에 부딪히는 순간 크게
    if (tr >= 0 && tr <= o.travelMs && now >= w.next) {
      w.next = now + 28;
      for (let i = 0; i < 3; i++) _t3dWaveSpray(w, front, 1, Math.random() * T3D_MAP_H);
    }
    if (!w.crashed && tr > o.travelMs) {
      w.crashed = true;
      // 벽을 때린 물이 높이 치솟는다 — 위로 곧게, 그리고 뒤로 흩어진다
      for (let i = 0; i < 80; i++) _t3dWaveSpray(w, edge, 2.3, Math.random() * T3D_MAP_H, { up: true });
    }
    // 물기둥 — 맵 끝을 따라 줄줄이 치솟았다가 퍼지며 흩어진다
    if (tr > o.travelMs) {
      w.plumes.forEach(sp => {
        const u = sp.userData;
        const k = (tr - o.travelMs - u.delay) / T3D_PLUME_MS;
        if (k <= 0 || k >= 1) { sp.visible = false; return; }
        sp.visible = true;
        const up = 1 - Math.pow(1 - Math.min(1, k / 0.3), 3);
        const h = u.hMax * (up * (1 - 0.25 * ease(clamp01((k - 0.45) / 0.55))));
        const wd = u.wMax * (0.55 + 0.75 * ease(k));
        const p = _t3dMapWorld(edge - o.dir * u.back, u.mapY);
        sp.position.set(p.x, 0, p.z);
        sp.scale.set(wd * p.s, Math.max(1, h) * p.s, 1);
        sp.material.opacity = Math.min(1, k / 0.08) * (1 - ease(clamp01((k - 0.35) / 0.65))) * 0.95;
      });
    }
    // 치솟은 물이 무너지는 동안 — 흰 물안개가 계속 피어오른다
    if (crash > 0.25 && now >= w.next) {
      w.next = now + 40;
      for (let i = 0; i < 4; i++) _t3dWaveSpray(w, edge, 1.2 * crash, Math.random() * T3D_MAP_H, { up: true });
    }
    w.spray.forEach(sp => {
      const u = sp.userData;
      if (u.life <= 0) { sp.material.opacity = 0; return; }
      u.life -= dt * u.decay;
      u.vh -= 520 * dt;
      u.mapX += u.vx * dt;
      u.mapY += u.vy * dt;
      u.h = Math.max(0, u.h + u.vh * dt);
      const p = _t3dMapWorld(u.mapX, u.mapY);
      sp.position.set(p.x, u.h * p.s, p.z);
      const sc = u.size * p.s * (0.6 + (1 - u.life) * 0.7);
      sp.scale.set(sc, sc, 1);
      sp.material.opacity = Math.max(0, Math.min(1, u.life * 1.4)) * 0.95 * opacity;
      if (u.h <= 0 && u.vh < 0) u.life = 0;
    });
    return true;
  });
  return true;
}

// ── 돌에 맞았다 ───────────────────────────────────────────
const T3D_IMPACT_MS = 700;
let _t3dChips = [];

/**
 * 돌이 타워에 맞는 순간 (board.js _stoneImpact). 건물이 크게 휘청이고 하얗게 달아오르며,
 * 맞은 벽에서 돌 조각이 카메라 쪽으로 튄다 (조각은 앞 씬 — 건물에 가리지 않는다).
 * @param {HTMLElement} el   .tower
 * @param {number} dir       휘청이는 쪽 (+1 / -1)
 * @returns {boolean} 3D로 그렸으면 true
 */
function towers3dImpact(el, dir = 1) {
  if (!_t3dRenderer || !_t3dScene) return false;
  const t = _t3dTowers.find(x => x.el === el);
  if (!t || t.fall || !t.group.visible) return false;
  t.impactAt = performance.now();
  t.impactDir = dir;
  _t3dEnsureFxScene();
  const g = t.group, s = g.userData.scale, W = g.userData.width, H = g.userData.hud;
  const mat = new THREE.MeshLambertMaterial({ color: t.stone, transparent: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a4448, transparent: true });
  const grp = new THREE.Group();
  grp.position.copy(g.position);
  grp.scale.setScalar(s);
  _t3dFxScene.add(grp);
  const parts = [];
  for (let i = 0; i < 14; i++) {
    const sz = 4 + (i % 4) * 2.5;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.75, sz), i % 4 ? mat : dark);
    const lat = ((i * 37) % 100 / 100 - 0.5) * W * 0.6;
    m.position.set(lat, H * (0.3 + ((i * 53) % 100) / 100 * 0.3), W / 2 + 3);
    grp.add(m);
    parts.push({
      m, half: sz * 0.4,
      vx: lat * 2.2 + dir * (40 + (i % 3) * 30), vy: 70 + (i % 5) * 38, vz: 70 + (i % 4) * 30,
      rx: (i % 2 ? 1 : -1) * (6 + i % 3), rz: (i % 3 - 1) * 5, bounced: false,
    });
  }
  _t3dChips.push({ grp, mats: [mat, dark], parts, born: t.impactAt, last: t.impactAt });
  _t3dDirty = true;
  return true;
}

function _t3dChipStep(now) {
  if (!_t3dChips.length) return false;
  const LIFE = 850;
  _t3dChips = _t3dChips.filter(c => {
    const age = now - c.born;
    if (age >= LIFE) {
      _t3dFxScene.remove(c.grp);
      c.parts.forEach(p => p.m.geometry.dispose());
      c.mats.forEach(m => m.dispose());
      return false;
    }
    const dt = Math.min(0.05, (now - c.last) / 1000);
    c.last = now;
    c.parts.forEach(p => {
      p.vy -= 900 * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.m.rotation.x += p.rx * dt;
      p.m.rotation.z += p.rz * dt;
      if (p.m.position.y < p.half) {
        p.m.position.y = p.half;
        if (!p.bounced) { p.vy = Math.abs(p.vy) * 0.3; p.bounced = true; } else p.vy = 0;
        p.vx *= 0.5; p.vz *= 0.5; p.rx *= 0.4; p.rz *= 0.4;
      }
    });
    const fade = Math.min(1, (LIFE - age) / (LIFE * 0.35));
    c.mats.forEach(m => { m.opacity = fade; });
    return true;
  });
  return true;
}

/** 맞은 순간 돌이 달아오른다 (k: 0~1). 0이면 원래 빛깔로 돌려놓는다 */
function _t3dFlash(t, k) {
  if (!t.flashMats) {
    t.flashMats = [];
    t.group.traverse(o => {
      const m = o.material;
      if (!m || !m.emissive || o.parent === t.outline || t.flashMats.some(x => x.m === m)) return;
      t.flashMats.push({ m, e: m.emissive.getHex(), ei: m.emissiveIntensity });
    });
  }
  if (k <= 0) {
    if (!t.flashOn) return;
    t.flashOn = false;
    t.flashMats.forEach(x => { x.m.emissive.setHex(x.e); x.m.emissiveIntensity = x.ei; });
    return;
  }
  t.flashOn = true;
  t.flashMats.forEach(x => { x.m.emissive.setRGB(1, 0.86, 0.62); x.m.emissiveIntensity = k * 0.95; });
}

/** 연출이 끝났다 — 건물은 숨기고 조각·먼지는 치운다 (떼어 낸 조각은 되살아날 때 돌려 붙인다) */
function _t3dFallDone(t) {
  const f = t.fall;
  f.done = true;
  if (f.deb) _t3dScene.remove(f.deb);
  f.dust.forEach(d => { _t3dScene.remove(d.sp); d.sp.material.dispose(); });
  f.dust = [];
  t.group.visible = false;
  _t3dDirty = true;
  return false;
}

/** 되살아났다 — 떼어 낸 조각을 제자리에, 재질을 원래대로 */
function _t3dFallReset(t) {
  const f = t.fall;
  if (!f) return;
  const g = t.group;
  f.moved.forEach(({ m, p, r }) => { g.add(m); m.position.copy(p); m.rotation.copy(r); m.visible = true; });
  if (f.deb) _t3dScene.remove(f.deb);
  f.rubble.forEach(m => m.geometry.dispose());
  f.dust.forEach(d => { _t3dScene.remove(d.sp); d.sp.material.dispose(); });
  f.mats.forEach(o => {
    o.m.opacity = o.opacity;
    o.m.transparent = o.transparent;
    if (o.emissive != null) { o.m.emissive.setHex(o.emissive); o.m.emissiveIntensity = o.ei; }
    o.m.clippingPlanes = null;
    o.m.needsUpdate = true;
  });
  g.position.y = 0;
  g.rotation.set(0, t.yaw || 0, 0);
  g.scale.setScalar(g.userData.scale);
  t.fall = null;
  t.ghost = undefined;                                   // 반투명(부활 대기) 여부를 다시 맞춘다
  _t3dDirty = true;
}

/** 자라나기 → 숨쉬기 → 가라앉기 */
function _t3dTotemStep(now) {
  if (!_t3dTotems.length) return false;
  _t3dTotems = _t3dTotems.filter(t => {
    const age = now - t.born;
    if (age >= t.ms) { _t3dFxScene.remove(t.group); return false; }
    const IN = 380, OUT = 420;
    let k = 1;
    if (age < IN) {
      const p = age / IN;                       // 톡 튀어나오게 살짝 넘겼다 돌아온다
      k = 1 - Math.pow(1 - p, 3);
      k *= 1 + Math.sin(p * Math.PI) * 0.18;
    } else if (age > t.ms - OUT) {
      k = Math.max(0, (t.ms - age) / OUT);
    }
    // 시듦 (더위) — 잎·꽃잎이 누렇게 바래며 처지고, 구슬 빛이 흐려진다. 열기가 식으면 천천히 돌아온다
    const wTarget = t.wither ? 1 : 0;
    t.wk = (t.wk || 0) + (wTarget - (t.wk || 0)) * 0.06;
    if (Math.abs(t.wk - wTarget) < 0.002) t.wk = wTarget;
    if (t.wk > 0 || t.wkShown) _t3dTotemWitherLook(t, t.wk);
    t.group.scale.set(t.base * k, t.base * k * (1 - 0.1 * t.wk), t.base * k);
    t.group.rotation.y = age / 2600 * (1 - 0.7 * t.wk);   // 시들면 거의 멈춘다
    t.group.rotation.z = 0.13 * t.wk * Math.sin(age / 900 + 0.6);
    // 지진 · 바람에 남은 시간이 줄었다 — 잠깐 부르르 떤다
    if (t.shakeAt && now - t.shakeAt < 450) t.group.rotation.z += Math.sin((now - t.shakeAt) / 28) * 0.12 * (1 - (now - t.shakeAt) / 450);
    t.group.position.y = Math.sin(age / 620) * 2.5 * k * (1 - t.wk);
    if (t.group.userData.orb) {
      const pulse = 1 + Math.sin(age / 340) * 0.22 * (1 - 0.8 * t.wk);
      t.group.userData.orb.scale.setScalar(pulse * (1 - 0.35 * t.wk));
    }
    return true;
  });
  return true;
}



// ════════════════════════════════════════════════════════
//  회복 연출 — 벚꽃
//
//  예전엔 평면 그림(fx/blossom.svg) 한 장을 타워 위에 얹었다. 건물이
//  입체가 되면서는 그 그림이 허공에 붙은 스티커처럼 보인다 — 꿃잎이
//  건물 뒤로 돌아가지 않고, 바닥의 빛도 누워 있지 않기 때문이다.
//
//  그래서 꿃잎을 진짜 공간에 띄우고 타워를 감고 오르게 했다. 타워와 같은
//  씬에 두어서 건물 뒤로 돌면 진짜로 가려진다 — 그게 이 연출의 핵심이다.
//  (토템은 반대로 앞 씬에 둔다. 토템은 타워에 완전히 가려버릴 수 있고,
//   벚꽃은 타워를 둘러싸고 돌기 때문에 절대 다 가려지지 않는다)
// ════════════════════════════════════════════════════════
let _t3dBlooms = [];
let _t3dPetalGeo = null;

/** 꿃잎 한 장 — 밑동이 (0,0), 끝이 +Y. 벚꽃답게 끝이 파여 있다 */
function _t3dPetalGeometry() {
  if (_t3dPetalGeo) return _t3dPetalGeo;
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.bezierCurveTo(5.5, 3.5, 7.5, 10, 4.5, 16);      // 오른쪽 가장자리
  sh.quadraticCurveTo(2.2, 13.4, 0, 12.6);           // 끝의 팼 자리
  sh.quadraticCurveTo(-2.2, 13.4, -4.5, 16);
  sh.bezierCurveTo(-7.5, 10, -5.5, 3.5, 0, 0);
  _t3dPetalGeo = new THREE.ShapeGeometry(sh, 10);
  _t3dPetalGeo.translate(0, -8, 0);                  // 가운데를 중심으로 — 제자리에서 뚤치게
  return _t3dPetalGeo;
}

/**
 * 타워 하나를 감는 벚꽃 회복 연출을 올린다.
 * @param {number} mapX,mapY 놓인 칸 한가운데 (맵 좌표)
 * @param {number} ms        전체 길이
 * @param {string} owner,pos 감을 타워 — 그 건물의 크기에 맞춘다
 * @returns {boolean} 3D로 올렸으면 true (false면 부르는 쪽이 평면 그림을 쓴다)
 */
function towers3dSpawnBlossom(mapX, mapY, ms, owner, pos) {
  if (!_t3dScene || !_t3dRenderer) return false;

  const t = _t3dTowers.find(x => x.el.dataset.owner === owner && x.el.dataset.pos === pos);
  // 올라갈 높이는 흡벽(건물 위팔) 기준이다 — height는 깃대 끝까지라
  // 그걸 쓰면 꿃잎이 건물과 동떨어져 허공에서 흔어진다
  const H = (t && t.group.userData.hud) || 112;
  const W = (t && t.group.userData.width)  || 50;    // 도는 반지름의 기준

  const g = new THREE.Group();
  const life = ms || 1800;
  const petals = [];
  const rings  = [];

  // 바닥에 퍼지는 빛 — 누워 있는 평면이 아니라 진짜로 때에 깔린 고리라
  // 기울기가 저절로 맞는다 (예전 SVG는 이걸 손으로 누여야 했다)
  for (let i = 0; i < 2; i++) {
    // 가산 혼합 — 보통 혼합으로 깔면 어두운 맵 위에서 회색 접시처럼 탁하게 보인다.
    // '바닥에 깔린 빛'은 더해져야 빛으로 읽힌다
    const mat = new THREE.MeshBasicMaterial({
      color: i ? 0xffe2ee : 0xff8fbe, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const r = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 56), mat);
    r.rotation.x = -Math.PI / 2;
    r.position.y = 1.5 + i * 0.4;      // 겁치면 z싸움이 깜빡인다
    r.userData = { delay: i * 0.22, peak: 0.82 - i * 0.24 };
    g.add(r);
    rings.push(r);
  }

  // 꿃잎 — 아래에서 피어나 나선을 그리며 올라간다
  const geo = _t3dPetalGeometry();
  const N = 26;
  for (let i = 0; i < N; i++) {
    const q = i / N;
    const mat = new THREE.MeshBasicMaterial({
      color: i % 5 === 0 ? 0xfff4fa : (i % 2 ? 0xffc2dd : 0xff9cc4),
      transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
    });
    const p = new THREE.Mesh(geo, mat);
    // 같은 자리에서 같이 출발하면 꽃이 아니라 바퀴개로 보인다 — 제각각 떠난다
    p.userData = {
      delay: q * 0.3,                                   // 차례로 피어난다
      a0:    q * Math.PI * 2 * 2.4 + (i % 3) * 0.4,     // 출발 각도
      spin:  2.1 + (i % 4) * 0.5,                       // 도는 양
      r0:    W * 0.5 + (i % 5) * W * 0.07,
      out:   W * 0.22 + (i % 3) * W * 0.09,             // 끝에 살짝 바깥으로 퍼진다
      top:   H * (0.62 + (i % 7) * 0.07),
      size:  1.05 + (i % 4) * 0.14,
      rx:    (i % 6) * 0.5,
      rz:    (i % 5) * 0.6,
      wob:   0.6 + (i % 3) * 0.35
    };
    g.add(p);
    petals.push(p);
  }

  _t3dScene.add(g);
  if (t) {
    // 타워 모형이 있으면 그 발밑에 그대로 올린다 — 넘겨받은 좌표가 어느 좌표계든
    // (화면 좌표든 바닥 좌표든) 건물과 한 치도 어긋나지 않는다
    g.position.set(t.group.position.x, 0, t.group.position.z);
    g.userData.scale = t.group.userData.scale;
    g.scale.setScalar(t.group.userData.scale);
  } else {
    _t3dPlaceAt(g, mapX, mapY);
  }
  _t3dBlooms.push({ group: g, petals, rings, born: performance.now(), ms: life, W, H });
  _t3dDirty = true;
  return true;
}

/** 피어나기 → 감고 오르기 → 흔어지기 */
function _t3dBloomStep(now) {
  if (!_t3dBlooms.length) return false;
  _t3dBlooms = _t3dBlooms.filter(b => {
    const T = (now - b.born) / b.ms;
    if (T >= 1) {
      _t3dScene.remove(b.group);
      b.petals.concat(b.rings).forEach(m => {
        m.material.dispose();
        if (m.geometry !== _t3dPetalGeo) m.geometry.dispose();
      });
      return false;
    }

    b.rings.forEach(r => {
      const u = (T - r.userData.delay) / (1 - r.userData.delay);
      if (u <= 0) { r.visible = false; return; }
      r.visible = true;
      const grow = 1 - Math.pow(1 - Math.min(1, u * 1.6), 3);
      const s = b.W * (0.45 + grow * 1.15);
      r.scale.set(s, s, 1);
      r.material.opacity = r.userData.peak * Math.min(1, u * 8) * Math.max(0, 1 - u * 1.25);
    });

    b.petals.forEach(p => {
      const d = p.userData;
      const u = (T - d.delay) / (1 - d.delay);
      if (u <= 0) { p.visible = false; return; }
      p.visible = true;
      // 위로 갈수록 느려진다 — 띄오를 때는 빠르고 끝에서 머물거리는 느낌
      const rise = 1 - Math.pow(1 - u, 2.2);
      const ang  = d.a0 + u * d.spin;
      const rad  = d.r0 + Math.sin(u * Math.PI) * b.W * 0.18 + u * d.out;
      p.position.set(
        Math.cos(ang) * rad,
        4 + rise * d.top + Math.sin(u * Math.PI * 2 + d.rx) * 2.5 * d.wob,
        Math.sin(ang) * rad
      );
      // 눈에 띄게 뚤치게 해야 '떨어지는 꽃잎'으로 읽힌다 (멈춰 있으면 판때기 같다)
      p.rotation.set(d.rx + u * 3.4 * d.wob, -ang + u * 1.6, d.rz + u * 2.6);
      const sc = d.size * (0.35 + 0.65 * Math.min(1, u * 5));
      p.scale.setScalar(sc);
      p.material.opacity = Math.min(1, u * 7) * Math.min(1, (1 - u) * 2.3);
    });
    return true;
  });
  return true;
}

/** 외부에서 한 프레임 다시 그리라고 알릴 때 */
function towers3dInvalidate() { _t3dDirty = true; }


// ════════════════════════════════════════════════════════
//  사랑의 화살 — 하트
//
//  회복(내 타워): 타워 위에 입체 하트 모형이 아주 작게 나타나 부풀어 오르고, 빛나며 떨다가
//    폭죽처럼 터진다 (2026-09-29 사용자 요청 — 예전의 '바닥에 그려지는 하트'를 대신한다).
//  공격(적 타워): 건물 앞에 카메라를 향한 하트가 화살이 나는 동안 서서히 나타났다가,
//    꽂히는 순간 여러 조각으로 깨져 흩어진다. 조각은 공간으로 튀고 떨어진다.
// ════════════════════════════════════════════════════════
let _t3dLove = [];   // { step(now) → 살아 있으면 true }

/** 단위 하트 윤곽 — 폭 2, 높이 1.375, 가운데가 (0,0). t=0 위 오목점 → t=π 아래 끝 (오른쪽 반쪽) */
function _t3dHeartXY(t) {
  const s = Math.sin(t);
  return { x: s * s * s, y: (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 6) / 16 };
}
function _t3dHeartShape(size, n = 56) {
  const sh = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const p = _t3dHeartXY(i / n * Math.PI * 2);
    if (i === 0) sh.moveTo(p.x * size, p.y * size); else sh.lineTo(p.x * size, p.y * size);
  }
  sh.closePath();
  return sh;
}
function _t3dLoveMat(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
}
function _t3dTowerOf(owner, pos) {
  return _t3dTowers.find(x => x.el.dataset.owner === owner && x.el.dataset.pos === pos) || null;
}
function _t3dDisposeTree(g) {
  const geos = new Set(), mats = new Set();
  g.traverse(o => { if (o.geometry) geos.add(o.geometry); if (o.material) mats.add(o.material); });
  geos.forEach(x => x.dispose());
  mats.forEach(x => x.dispose());
}

/**
 * 타워 앞면 한가운데가 맵(=스테이지) 좌표로 어디에 보이는가 — 화살이 꽂히는 자리.
 * 건물은 3D라 DOM 네모의 가운데가 아니라 모형의 몸통 한가운데를 카메라로 투영해 구한다.
 * @param {number} frac 흉벽 높이의 몇 배 높이인가 (0.5 = 몸통 한가운데쯤)
 * @returns {{x,y}|null}
 */
function towers3dTowerPoint(owner, pos, frac = 0.5) {
  if (!_t3dCamera) return null;
  const t = _t3dTowerOf(owner, pos);
  if (!t) return null;
  const s = t.group.userData.scale || 1;
  const W = t.group.userData.width || 50, H = t.group.userData.hud || 112;
  _t3dCamera.updateMatrixWorld(true);
  // 들림(조준 강조)·흔들림은 빼고 제자리 기준 — 모든 화면이 같은 점을 얻어야 한다
  const v = new THREE.Vector3(t.group.position.x, H * frac * s, t.group.position.z + (W / 2) * s).project(_t3dCamera);
  return _t3dToMap(v);
}

/**
 * 회복 하트 — 타워 위에 입체 하트가 아주 작게 나타나 풍선처럼 부풀어 오르고,
 * 달아올라 떨다가 폭죽처럼 터진다. 터지는 순간 회복이 들어간다(board.js가 burstMs에 맞춘다).
 * 하트는 앞 씬(토템과 같은 곳)에 둔다 — 건물 꼭대기에 걸쳐 있어 뒤 씬에 두면 흉벽에 파묻힌다.
 * @param {number} burstMs 꽂힌 뒤 터질 때까지
 * @returns {boolean} 3D로 그렸으면 true
 */
function towers3dLoveHeal(owner, pos, burstMs = 900) {
  if (!_t3dScene || !_t3dRenderer) return false;
  const t = _t3dTowerOf(owner, pos);
  if (!t) return false;
  _t3dEnsureFxScene();
  const W = t.group.userData.width || 50, H = t.group.userData.hud || 112;
  const g = new THREE.Group();
  g.position.set(t.group.position.x, 0, t.group.position.z);
  g.scale.setScalar(t.group.userData.scale);
  _t3dFxScene.add(g);

  const S = W * 0.62;                // 하트 반 폭 — 흉벽 폭 정도
  const face = new THREE.Group();    // 카메라를 보는 판 — 안에서는 평면 좌표(x 오른쪽, y 위, z 앞)
  // 흉벽 꼭대기에 반쯤 걸친다 — 더 올리면 2행 타워는 화면 위로 잘린다
  face.position.y = H * 0.93;
  face.quaternion.copy(_t3dCamera.quaternion);
  g.add(face);

  // 통통한 입체 하트 — 두께와 둥근 모서리(bevel)가 있어야 '모형'으로 보인다
  const geo = new THREE.ExtrudeGeometry(_t3dHeartShape(S, 48), {
    depth: S * 0.34, bevelEnabled: true, bevelThickness: S * 0.24, bevelSize: S * 0.17,
    bevelSegments: 5, curveSegments: 10, steps: 1
  });
  geo.center();
  const mat = new THREE.MeshPhongMaterial({
    color: 0xff4d8d, emissive: 0xff1f6a, emissiveIntensity: 0.22,
    specular: 0xffffff, shininess: 90, transparent: true, opacity: 1
  });
  const heart = new THREE.Mesh(geo, mat);
  const spin = new THREE.Group();    // 좌우로 살짝 돌아 두께가 보이게 한다
  spin.add(heart);
  face.add(spin);
  const halo = new THREE.Mesh(new THREE.ShapeGeometry(_t3dHeartShape(S * 1.35)), _t3dLoveMat(0xff6fae, 0));
  halo.position.z = -S * 0.6;
  face.add(halo);

  // 폭죽 — 작은 하트와 불꽃이 사방(앞뒤 포함)으로 튀었다가 느려지며 떨어지고 반짝이며 꺼진다
  const heartGeo = new THREE.ShapeGeometry(_t3dHeartShape(5.2));
  const sparkGeo = new THREE.PlaneGeometry(3.8, 3.8);
  const cols = [0xff5c9a, 0xff9cc4, 0xffffff, 0xffd27a, 0xff3f86];
  const bits = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    const isHeart = i % 5 < 2;
    const m = new THREE.Mesh(isHeart ? heartGeo : sparkGeo, _t3dLoveMat(cols[i % cols.length], 0));
    // 구 위에 고르게 흩은 방향 (황금각 나선)
    const yN = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - yN * yN), ph = i * 2.39996;
    const sp = (isHeart ? 190 : 250) + (i % 7) * 22;
    m.userData = { vx: Math.cos(ph) * r * sp, vy: yN * sp * 0.85 + 30, vz: Math.sin(ph) * r * sp * 0.6,
                   tw: i * 1.7, size: isHeart ? 1 + (i % 3) * 0.25 : 0.8 + (i % 4) * 0.2 };
    m.visible = false;
    face.add(m);
    bits.push(m);
  }
  const flash = new THREE.Mesh(new THREE.CircleGeometry(S * 1.1, 40), _t3dLoveMat(0xffffff, 0));
  const ring  = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), _t3dLoveMat(0xffb3d1, 0));
  flash.position.z = ring.position.z = S * 0.5;
  face.add(flash, ring);

  const GROW = burstMs * 0.62, LIFE = burstMs + 1100;
  const born = performance.now();
  let last = born, burst = false;
  const easeBack = u => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
  _t3dLove.push({ step(now) {
    const age = now - born;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (age >= LIFE) { _t3dFxScene.remove(g); _t3dDisposeTree(g); heartGeo.dispose(); sparkGeo.dispose(); return false; }

    if (age < burstMs) {
      if (age < GROW) {
        // 부풀기 — 아주 작게 나와 살짝 넘치게 커졌다 자리 잡는다. 풍선처럼 가로·세로가 엇갈려 출렁인다
        const u = Math.pow(age / GROW, 1.35);            // 처음엔 천천히 — 바람이 차오르는 느낌
        const k = 0.04 + 0.96 * easeBack(u);
        const wob = Math.sin(u * Math.PI * 3) * 0.08 * (1 - u);
        spin.scale.set(k * (1 + wob), k * (1 - wob), k);
      } else {
        // 달아오르기 — 빛이 차오르고 점점 빠르게 떨며 조금씩 더 부푼다 (곧 터진다)
        const u = (age - GROW) / Math.max(1, burstMs - GROW);
        const k = 1 + u * 0.14 + Math.sin(age / (40 - u * 22)) * 0.025 * u;
        spin.scale.set(k, k, k);
        mat.emissiveIntensity = 0.22 + u * 1.1;
        halo.material.opacity = 0.2 + u * 0.55;
        halo.scale.setScalar(1 + u * 0.15);
      }
      spin.rotation.y = Math.sin(age / 260) * 0.45;       // 좌우로 돌아 두께가 보인다
      spin.rotation.z = Math.sin(age / 330) * 0.06;
      face.position.y = H * 0.93 + Math.sin(age / 180) * 1.5;
      return true;
    }

    if (!burst) {
      burst = true;
      spin.visible = halo.visible = false;
      bits.forEach(m => { m.visible = true; });
      t.glowUntil = now + 900;                             // 건물 테두리가 분홍으로 빛난다
    }
    const k = (age - burstMs) / (LIFE - burstMs);
    flash.material.opacity = Math.max(0, 0.95 - k * 7);
    flash.scale.setScalar(0.6 + k * 3);
    ring.material.opacity = Math.max(0, 0.9 - k * 2.6);
    ring.scale.setScalar(S * (0.8 + k * 4.2));
    const drag = Math.pow(0.2, dt);                        // 처음엔 빠르게 퍼지다 금세 느려진다
    bits.forEach(m => {
      const d = m.userData;
      d.vx *= drag; d.vy = d.vy * drag - 120 * dt; d.vz *= drag;
      m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt;
      m.scale.setScalar(d.size * (1 - k * 0.4));
      const twinkle = k > 0.35 ? 0.55 + 0.45 * Math.sin(age / 28 + d.tw) : 1;
      m.material.opacity = Math.max(0, 1 - Math.max(0, k - 0.3) / 0.7) * twinkle;
    });
    return true;
  } });
  _t3dDirty = true;
  return true;
}

/**
 * 공격 하트 — 화살이 나는 동안(flyMs) 서서히 나타났다가 꽂히는 순간 깨진다.
 * @returns {boolean} 3D로 그렸으면 true
 */
function towers3dLoveBreak(owner, pos, flyMs) {
  if (!_t3dScene || !_t3dRenderer) return false;
  const t = _t3dTowerOf(owner, pos);
  if (!t) return false;
  _t3dEnsureFxScene();
  const W = t.group.userData.width || 50, H = t.group.userData.hud || 112;
  const g = new THREE.Group();
  g.position.set(t.group.position.x, 0, t.group.position.z);
  g.scale.setScalar(t.group.userData.scale);
  const face = new THREE.Group();               // 카메라를 보는 판 — 그 안에서는 평면 좌표(x,y)로 다룬다
  face.position.y = H * 0.56;
  face.quaternion.copy(_t3dCamera.quaternion);
  g.add(face);
  _t3dFxScene.add(g);

  const S = W * 0.95;
  const heart = new THREE.Mesh(new THREE.ShapeGeometry(_t3dHeartShape(S)),
    new THREE.MeshBasicMaterial({ color: 0xff3f86, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  const halo  = new THREE.Mesh(new THREE.ShapeGeometry(_t3dHeartShape(S * 1.14)), _t3dLoveMat(0xff7fb4, 0));
  const shine = new THREE.Mesh(new THREE.ShapeGeometry(_t3dHeartShape(S * 0.34)),
    new THREE.MeshBasicMaterial({ color: 0xffd6e6, transparent: true, opacity: 0, depthWrite: false }));
  halo.position.z = -0.5;
  shine.position.set(-S * 0.38, S * 0.2, 0.5);
  face.add(halo, heart, shine);

  // 깨질 조각 — 가운데 한 점에서 뻗는 금으로 나눈 부채꼴 9개. 금은 곧지 않고 한 번 꺾인다
  const N = 54, K = 9, c = { x: S * 0.06, y: S * 0.02 };
  const rim = [];
  for (let i = 0; i < N; i++) { const p = _t3dHeartXY(i / N * Math.PI * 2); rim.push({ x: p.x * S, y: p.y * S }); }
  const shards = [];
  for (let k = 0; k < K; k++) {
    const i0 = Math.floor(k * N / K), i1 = Math.floor((k + 1) * N / K);
    const sh = new THREE.Shape();
    sh.moveTo(c.x, c.y);
    for (let i = i0; i <= i1; i++) { const p = rim[i % N]; sh.lineTo(p.x, p.y); }
    const back = rim[i0 % N], j = (k % 2 ? 0.12 : -0.12);
    sh.lineTo(c.x + (back.x - c.x) * 0.45 + back.y * j, c.y + (back.y - c.y) * 0.45 - back.x * j);
    sh.closePath();
    const mid = rim[Math.floor((i0 + i1) / 2) % N];
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh),
      new THREE.MeshBasicMaterial({ color: k % 3 === 0 ? 0xff6aa2 : 0xff3f86, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }));
    const len = Math.hypot(mid.x, mid.y) || 1;
    m.userData = {
      vx: mid.x / len * (70 + (k % 3) * 28), vy: mid.y / len * (60 + (k % 4) * 20) + 55, vz: (k % 2 ? 1 : -1) * (30 + k * 6),
      spin: (k % 2 ? 1 : -1) * (4 + (k % 3) * 2.2), tilt: (k % 3 - 1) * 3.2
    };
    m.visible = false;
    face.add(m);
    shards.push(m);
  }
  const flash = new THREE.Mesh(new THREE.ShapeGeometry(_t3dHeartShape(S * 1.05)), _t3dLoveMat(0xffffff, 0));
  flash.position.z = 1;
  face.add(flash);

  const born = performance.now();
  const BREAK = 850;
  let last = born, broke = false;
  _t3dLove.push({ step(now) {
    const age = now - born;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (age >= flyMs + BREAK) { _t3dFxScene.remove(g); _t3dDisposeTree(g); return false; }
    if (age < flyMs) {
      // 서서히 나타난다 — 조금씩 커지고, 두근거린다
      const u = Math.min(1, age / Math.max(1, flyMs));
      const e = u * u * (3 - 2 * u);
      face.scale.setScalar((0.62 + 0.38 * e) * (1 + Math.sin(age / 95) * 0.035 * e));
      heart.material.opacity = 0.92 * e;
      halo.material.opacity = 0.45 * e;
      shine.material.opacity = 0.7 * e;
      return true;
    }
    if (!broke) {
      broke = true;
      heart.visible = halo.visible = shine.visible = false;
      shards.forEach(m => { m.visible = true; });
      face.scale.setScalar(1);
    }
    const k = (age - flyMs) / BREAK;
    flash.material.opacity = Math.max(0, 0.9 - k * 5);
    flash.scale.setScalar(1 + k * 1.6);
    shards.forEach(m => {
      const d = m.userData;
      d.vy -= 420 * dt;
      m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt;
      m.rotation.z += d.spin * dt; m.rotation.x += d.tilt * dt;
      m.material.opacity = Math.max(0, 1 - Math.max(0, k - 0.35) / 0.65);
    });
    return true;
  } });
  _t3dDirty = true;
  return true;
}

function _t3dLoveStep(now) {
  if (!_t3dLove.length) return false;
  _t3dLove = _t3dLove.filter(x => x.step(now));
  return true;
}


// ════════════════════════════════════════════════════════
//  소환 유닛 (그림리퍼) — js/units.js가 움직인다
//
//  타워와 같은 씬·같은 카메라에 선다. 건물 앞뒤가 진짜 깊이로 가려진다 —
//  타워 앞에 선 리퍼는 건물을 가리고, 건물 뒤로 돌아간 리퍼는 건물에 가린다.
//  자리는 맵 좌표(이 화면 기준)로 받고, 크기는 줄마다의 원근 배율을 그대로 먹는다.
// ════════════════════════════════════════════════════════
const _t3dSteps = [];   // 매 프레임 불리는 함수 — true를 돌려주면 계속 그린다

/** 매 프레임 할 일을 건다 (유닛 움직임) */
function towers3dAddStep(fn) { if (!_t3dSteps.includes(fn)) _t3dSteps.push(fn); }

function towers3dAddUnit(group) {
  if (!_t3dScene) return false;
  _t3dScene.add(group);
  _t3dDirty = true;
  return true;
}

function towers3dRemoveUnit(group) {
  if (_t3dScene && group) _t3dScene.remove(group);
  _t3dDirty = true;
}

/** 발을 맵 좌표에 놓는다. size = 모델 1 → 화면 px (원근 배율은 따로 곱해진다) */
function towers3dPlaceUnit(group, mapX, mapY, size) {
  const p = _t3dPlaceAt(group, mapX, mapY);
  group.scale.setScalar(p.s * size);
  return p;
}

/** 맵 방향(dx, dy) → 그 방향을 보는 y 회전. 모델의 앞은 +z */
function towers3dYawFor(dx, dy) {
  const wx = dx * Math.cos(T3D_AZI) + dy * Math.sin(T3D_AZI);
  const wz = -dx * Math.sin(T3D_AZI) + dy * Math.cos(T3D_AZI);
  return Math.atan2(wx, wz);
}

/** 유닛 머리 위 한 점 → 화면(스테이지) 좌표 — 체력 막대 같은 빌보드 UI 자리 */
function towers3dUnitPoint(group, localY) {
  if (!_t3dCamera) return null;
  _t3dCamera.updateMatrixWorld(true);
  const v = new THREE.Vector3(group.position.x, localY * group.scale.y, group.position.z).project(_t3dCamera);
  return _t3dToMap(v);
}

/** 월드 좌표 한 점 → 화면(스테이지) 좌표 (유닛 연출이 3D 동작을 따라 그릴 때) */
function towers3dProjectWorld(v) {
  if (!_t3dCamera) return null;
  _t3dCamera.updateMatrixWorld(true);
  const p = v.clone().project(_t3dCamera);
  return _t3dToMap(p);
}

// ══════════════════════════════════════════════════════════
//  토템 머리 위 한 점 — 지속 시간 게이지 자리 (board.js _totemGauge)
// ══════════════════════════════════════════════════════════
function towers3dTotemTop(mapX, mapY) {
  const t = _t3dTotems.find(x => Math.abs(x.mapX - mapX) < 2 && Math.abs(x.mapY - mapY) < 2);
  if (!t || !_t3dCamera) return null;
  const box = new THREE.Box3().setFromObject(t.group);
  return towers3dProjectWorld(new THREE.Vector3(t.group.position.x, box.max.y, t.group.position.z));
}

// ══════════════════════════════════════════════════════════
//  가시 (2026-10-01) — 범위 칸마다 땅에서 가시가 한꺼번에 튀어나온다.
//  타워가 선 칸에서는 건물 발밑 둘레에서 솟아 벽 쪽으로 기울어 박힌다.
//  타워와 같은 씬이라 건물 안으로 들어간 끝은 벽에 가려 '박혀' 보인다.
// ══════════════════════════════════════════════════════════
let _t3dSpikeGeo = null, _t3dSpikeMat = null;
let _t3dSpikes = [];

function _t3dSpikeParts() {
  if (_t3dSpikeGeo) return;
  const g = new THREE.ConeGeometry(1, 1, 7, 4);
  g.translate(0, 0.5, 0);                              // 밑면이 땅(y=0)
  // 밑동은 짙은 고동색, 끝으로 갈수록 바랜 뼈 색 — 가시 끝이 하얗게 번뜩인다
  const pos = g.attributes.position, col = [];
  const base = [0.22, 0.17, 0.12], mid = [0.42, 0.33, 0.22], tip = [0.93, 0.89, 0.78];
  for (let i = 0; i < pos.count; i++) {
    const k = Math.max(0, Math.min(1, pos.getY(i)));
    const c = k < 0.6 ? base.map((v, j) => v + (mid[j] - v) * (k / 0.6))
                      : mid.map((v, j) => v + (tip[j] - v) * ((k - 0.6) / 0.4));
    col.push(c[0], c[1], c[2]);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  _t3dSpikeGeo = g;
  _t3dSpikeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
}

/**
 * @param {object} o { tiles: [{x,y}] 범위 칸 한가운데(맵 px), towers: [{x,y,half}] 범위 안 타워 발밑,
 *                     riseMs: 솟는 순간까지, holdMs: 솟은 뒤 박혀 있는 시간, seed }
 * @returns {boolean} 3D로 그렸으면 true
 */
function towers3dSpikes(o) {
  if (!_t3dScene || !_t3dRenderer) return false;
  _t3dSpikeParts();
  let s = (o.seed || 1) >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s & 0x7fffffff) / 0x7fffffff; };
  const group = new THREE.Group();
  const spikes = [];
  const add = (x, y, r, h, lean, towardX, towardY, delay) => {
    const p = _t3dMapWorld(x, y);
    const m = new THREE.Mesh(_t3dSpikeGeo, _t3dSpikeMat);
    m.position.set(p.x, 0, p.z);
    // 기울기 — 맵에서 그 점 쪽(towardX, towardY)으로 lean 라디안
    const q = _t3dMapWorld(towardX, towardY);
    const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz) || 1;
    m.quaternion.setFromAxisAngle(new THREE.Vector3(dz / len, 0, -dx / len), lean);
    m.scale.set(0.001, 0.001, 0.001);
    m.visible = false;
    group.add(m);
    spikes.push({ m, r: r * p.s, h: h * p.s, delay });
  };
  const near = (x, y) => (o.towers || []).some(t => Math.abs(x - t.x) < t.half + 6 && Math.abs(y - t.y) < t.half + 6);
  (o.tiles || []).forEach(t => {
    for (let i = 0; i < 7; i++) {
      const x = t.x + (rnd() - 0.5) * 84, y = t.y + (rnd() - 0.5) * 84;
      if (near(x, y)) continue;
      const a = rnd() * Math.PI * 2;
      add(x, y, 6 + rnd() * 5, 48 + rnd() * 46, (rnd() - 0.5) * 0.5, x + Math.cos(a) * 40, y + Math.sin(a) * 40, rnd() * 110);
    }
  });
  // 타워 발밑 둘레 — 큼직한 가시가 벽으로 기울어 박힌다
  (o.towers || []).forEach(t => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i + rnd() * 0.6) / n * Math.PI * 2;
      const d = t.half + 2 + rnd() * 10;
      const x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d * 0.9;
      add(x, y, 9 + rnd() * 5, 96 + rnd() * 48, 0.32 + rnd() * 0.22, t.x, t.y, 20 + rnd() * 80);
    }
  });
  _t3dScene.add(group);
  // 솟는 순간의 흙 — 칸마다 갈색 흙덩이가 튄다
  if (!_t3dDustTex) _t3dDust();
  const dirt = [];
  (o.tiles || []).forEach(t => {
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: _t3dDustTex, color: i % 2 ? 0x7a6248 : 0x9b8466,
                                                           transparent: true, opacity: 0, depthWrite: false }));
      const x = t.x + (rnd() - 0.5) * 80, y = t.y + (rnd() - 0.5) * 80;
      sp.userData = { x, y, vx: (rnd() - 0.5) * 160, vy: (rnd() - 0.5) * 90, vh: 160 + rnd() * 200, h: 0, size: 18 + rnd() * 26 };
      group.add(sp);
      dirt.push(sp);
    }
  });
  const now = performance.now();
  _t3dSpikes.push({ group, spikes, dirt, born: now, riseMs: o.riseMs || 0, holdMs: o.holdMs || 2000, last: now });
  towers3dAddStep(_t3dSpikeStep);
  _t3dDirty = true;
  return true;
}

function _t3dSpikeStep(now) {
  if (!_t3dSpikes.length) return false;
  const outBack = k => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
  _t3dSpikes = _t3dSpikes.filter(S => {
    const age = now - S.born - S.riseMs;
    const dt = Math.min(0.05, (now - S.last) / 1000);
    S.last = now;
    if (age > S.holdMs + 520) { _t3dScene.remove(S.group); S.dirt.forEach(d => d.material.dispose()); return false; }
    S.spikes.forEach(sp => {
      const k = (age - sp.delay) / 130;
      if (k <= 0) { sp.m.visible = false; return; }
      sp.m.visible = true;
      let e = k < 1 ? outBack(k) : 1;
      const kr = (age - S.holdMs - sp.delay * 0.5) / 360;   // 다 박고 나면 땅속으로 꺼진다
      if (kr > 0) e *= Math.max(0, 1 - kr * kr);
      const w = sp.r * (0.55 + 0.45 * Math.min(1, e));
      sp.m.scale.set(w, Math.max(0.001, sp.h * e), w);
      if (e <= 0.001) sp.m.visible = false;
    });
    S.dirt.forEach(d => {
      const u = d.userData;
      if (age < 0) { d.material.opacity = 0; return; }
      u.vh -= 620 * dt; u.h = Math.max(0, u.h + u.vh * dt);
      u.x += u.vx * dt; u.y += u.vy * dt;
      const p = _t3dMapWorld(u.x, u.y);
      d.position.set(p.x, u.h * p.s, p.z);
      d.scale.setScalar(u.size * p.s);
      d.material.opacity = Math.max(0, 0.9 - age / 900);
    });
    return true;
  });
  return true;
}

// ══════════════════════════════════════════════════════════
//  톱 (2026-10-01) — 손톱 한 자루가 타워 앞에 나타나 벽을 썬다.
//  날은 수직, 이빨은 아래. 0.5초에 한 번 밀고 당기며(그때마다 7 피해), 썰수록 조금씩 아래로 파고든다.
//  날 끝은 건물 속으로 들어가 벽에 가린다 — 타워와 같은 씬. 불똥·돌가루가 맞닿은 자리에서 튄다.
// ══════════════════════════════════════════════════════════
let _t3dSaws = [];
let _t3dSawSeq = 0;

function _t3dSawModel() {
  const g = new THREE.Group();
  // 날 — 손잡이 쪽이 넓고 끝으로 갈수록 좁아지는 판, 아래 가장자리에 이빨
  const L = 150, TOP = 17, H0 = -15, H1 = -6, TOOTH = 7;
  const sh = new THREE.Shape();
  sh.moveTo(0, TOP);
  sh.lineTo(L, TOP - 3);
  sh.lineTo(L, H1);
  for (let x = L; x > TOOTH * 0.5; x -= TOOTH) {
    const yb = H0 + (H1 - H0) * (x / L);
    sh.lineTo(x - TOOTH * 0.45, yb - 4.5);
    sh.lineTo(x - TOOTH, H0 + (H1 - H0) * Math.max(0, (x - TOOTH) / L));
  }
  sh.lineTo(0, H0);
  sh.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false });
  bladeGeo.translate(0, 0, -0.8);
  const steel = new THREE.MeshPhongMaterial({ color: 0xc7d0d8, specular: 0xffffff, shininess: 110, emissive: 0x1a2028, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(bladeGeo, steel));
  // 등쪽의 밝은 띠 — 쇠가 번뜩인다
  const back = new THREE.Mesh(new THREE.BoxGeometry(L, 3, 2.2),
                              new THREE.MeshPhongMaterial({ color: 0xf2f6fa, specular: 0xffffff, shininess: 140 }));
  back.position.set(L / 2, TOP - 2.5, 0);
  g.add(back);
  // 손잡이 — 구멍 뚫린 나무 손잡이
  const hs = new THREE.Shape();
  hs.moveTo(4, -18); hs.lineTo(4, 26);
  hs.quadraticCurveTo(-6, 36, -26, 34);
  hs.quadraticCurveTo(-50, 30, -52, 8);
  hs.quadraticCurveTo(-54, -14, -40, -24);
  hs.quadraticCurveTo(-14, -30, 4, -18);
  const hole = new THREE.Path();
  hole.moveTo(-14, -8); hole.lineTo(-14, 18);
  hole.quadraticCurveTo(-20, 24, -30, 22);
  hole.quadraticCurveTo(-42, 16, -40, 2);
  hole.quadraticCurveTo(-38, -12, -26, -13);
  hole.quadraticCurveTo(-16, -14, -14, -8);
  hs.holes.push(hole);
  const handleGeo = new THREE.ExtrudeGeometry(hs, { depth: 10, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 2 });
  handleGeo.translate(0, 0, -5);
  g.add(new THREE.Mesh(handleGeo, new THREE.MeshLambertMaterial({ color: 0x9a5a2c, emissive: 0x2a1406 })));
  // 놋쇠 못 둘
  const brass = new THREE.MeshPhongMaterial({ color: 0xd8b04a, specular: 0xfff2c0, shininess: 80 });
  [[-2, 12], [-2, -8]].forEach(([x, y]) => {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 14, 10), brass);
    r.rotation.x = Math.PI / 2;
    r.position.set(x, y, 0);
    g.add(r);
  });
  return g;
}

/**
 * 톱을 띄운다.
 * @param {object} o { x, y: 맞닿는 자리(맵 px — 대상 앞면의 바닥), ux, uy: 써는 방향(맵, 단위 벡터 — 없으면 dir),
 *                     dir: +1이면 왼쪽에서 오른쪽으로, ms: 최대 길이, strokeMs: 한 번 밀고 당기는 시간,
 *                     hit: 대상이 있는가, totem: 대상이 토템이다 (낮게 · 짧게 썰고, 토템과 같은 앞 씬에 그린다) }
 * @returns {number} 톱 번호 (towers3dSawStop에 넘긴다), 3D가 없으면 0
 */
function towers3dSaw(o) {
  if (!_t3dScene || !_t3dRenderer) return 0;
  if (o.ux == null) { o.ux = o.dir || 1; o.uy = 0; }
  if (o.totem) _t3dEnsureFxScene();
  const scene = o.totem ? _t3dFxScene : _t3dScene;
  const model = _t3dSawModel();
  const holder = new THREE.Group();
  holder.add(model);
  scene.add(holder);
  if (!_t3dDustTex) _t3dDust();
  const sparks = [];
  for (let i = 0; i < 48; i++) {
    const dust = i % 3 === 0;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: _t3dDustTex, color: dust ? 0xbdb4a8 : i % 3 === 1 ? 0xffc35a : 0xfff4d8,
      transparent: true, opacity: 0, depthWrite: false, depthTest: dust,
      blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending }));
    sp.userData = { life: 0, dust };
    scene.add(sp);
    sparks.push(sp);
  }
  const id = ++_t3dSawSeq;
  const now = performance.now();
  _t3dSaws.push({ id, o, scene, holder, model, sparks, born: now, last: now, stopAt: now + (o.ms || 6000), lastStroke: -1 });
  towers3dAddStep(_t3dSawStep);
  _t3dDirty = true;
  return id;
}

/** 톱질을 멈춘다 — 뒤로 빠지며 사라진다 */
function towers3dSawStop(id) {
  const s = _t3dSaws.find(x => x.id === id);
  if (s) s.stopAt = Math.min(s.stopAt, performance.now());
}

function _t3dSawSpark(s, x, h, power, dust, y = s.o.y) {
  const sp = s.sparks.find(p => p.userData.life <= 0 && p.userData.dust === dust);
  if (!sp) return;
  const { ux, uy } = s.o;
  const back = (60 + Math.random() * 200) * power;            // 써는 쪽(손잡이 쪽)으로 튄다
  sp.userData = {
    life: 1, dust, x, y: y + (Math.random() - 0.5) * 14, h,
    vx: -ux * back + uy * (Math.random() - 0.5) * 120, vy: -uy * back + (Math.random() - 0.5) * 120,
    vh: dust ? -20 - Math.random() * 40 : (60 + Math.random() * 180) * power,
    g: dust ? 60 : 700, size: dust ? 16 + Math.random() * 14 : 7 + Math.random() * 7,
    decay: dust ? 0.9 : 2 + Math.random() * 1.5,
  };
}

function _t3dSawStep(now) {
  if (!_t3dSaws.length) return false;
  _t3dSaws = _t3dSaws.filter(s => {
    const o = s.o, ux = o.ux, uy = o.uy;
    const age = now - s.born;
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    const out = Math.max(0, (now - s.stopAt) / 320);        // 뽑혀 나가는 중 (0~1)
    if (out >= 1) {
      s.scene.remove(s.holder);
      s.sparks.forEach(sp => { s.scene.remove(sp); sp.material.dispose(); });
      s.holder.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
      return false;
    }
    const IN = 260;
    const inK = Math.min(1, age / IN);                       // 날아 들어온다
    const ease = k => 1 - Math.pow(1 - k, 3);
    const strokeMs = o.strokeMs || 500;
    const cutting = age > IN && out <= 0;
    // 밀고 당기기 — 미는 쪽이 조금 빠르고 힘차다
    const ph = cutting ? ((age - IN) % strokeMs) / strokeMs : 0;
    const stroke = cutting ? (ph < 0.45 ? Math.sin(ph / 0.45 * Math.PI / 2) : Math.cos((ph - 0.45) / 0.55 * Math.PI / 2)) : 0;
    // 썰수록 아래로 파고든다 (벽 가운데 → 발밑 쪽)
    const depth = Math.min(1, Math.max(0, age - IN) / (o.ms || 6000));
    const cutH = o.totem ? 30 : o.hit ? 66 - 34 * depth : 26;   // 토템은 기둥 아래쪽을 썬다
    const reach = o.totem ? 52 : 96;                         // 날 앞쪽이 대상 속에 든다 (토템은 가늘다)
    const along = -reach + stroke * (o.totem ? 26 : 34) - (1 - ease(inK)) * 150 - out * 120;
    const P = _t3dMapWorld(o.x + ux * along, o.y + uy * along);
    const Q = _t3dMapWorld(o.x + ux * (along + 100), o.y + uy * (along + 100));
    s.holder.position.set(P.x, cutH * P.s, P.z);
    s.holder.rotation.set(0, Math.atan2(-(Q.z - P.z), Q.x - P.x), 0);
    s.model.rotation.z = -0.1 - stroke * 0.05 + Math.sin(age / 90) * 0.012;   // 앞이 살짝 숙인 채 흔들린다
    s.holder.scale.setScalar(P.s * 1.05);
    const fade = Math.max(0, Math.min(inK * 1.6, 1 - out));
    s.holder.traverse(m => { if (m.material) { m.material.transparent = fade < 1; m.material.opacity = fade; } });
    // 밀 때마다 불똥 · 돌가루
    if (cutting) {
      const k = Math.floor((age - IN) / strokeMs);
      if (ph < 0.45 && Math.random() < 0.8) for (let i = 0; i < (o.hit ? 3 : 1); i++) _t3dSawSpark(s, o.x, cutH - 12, 1, o.totem);
      if (o.hit && Math.random() < 0.35) _t3dSawSpark(s, o.x - ux * 6, cutH - 14, 0.4, true, o.y - uy * 6);
      if (k !== s.lastStroke) { s.lastStroke = k; for (let i = 0; i < 6; i++) _t3dSawSpark(s, o.x, cutH - 12, 1.4, o.totem && i % 2 === 0); }
    }
    s.sparks.forEach(sp => {
      const u = sp.userData;
      if (u.life <= 0) { sp.material.opacity = 0; return; }
      u.life -= dt * u.decay;
      u.vh -= u.g * dt;
      u.x += u.vx * dt; u.y += u.vy * dt; u.h = Math.max(0, u.h + u.vh * dt);
      const p = _t3dMapWorld(u.x, u.y);
      sp.position.set(p.x, u.h * p.s, p.z);
      sp.scale.setScalar(u.size * p.s * (u.dust ? 1 + (1 - u.life) : 1));
      sp.material.opacity = Math.max(0, u.life) * (u.dust ? 0.55 : 1);
    });
    return true;
  });
  return true;
}

// ══════════════════════════════════════════════════════════
//  섬 가장자리 (2026-10-03 — 예전 돌벽 자리)
//  맵 위·왼쪽·오른쪽 변 바로 바깥을 잔디 블록이 둘러싼다: 바위 밑동(물에 잠김) · 흙 두 겹 · 잔디 머리.
//  높이는 예전 벽과 같은 타일 한 칸(100) 언저리 — 블록마다 조금씩 들쭉날쭉하고, 위에 덤불 · 꽃 · 돌 · 풀포기,
//  바깥으로 낮은 잔디 턱이 군데군데 붙어 진짜 섬 둘레처럼 보인다. 필드와 컷씬(reaper3d.js)이 같은 블록 목록을 쓴다.
//  가까운 쪽(아래 변)은 낮은 나무 부두 — 맨 아랫줄 타일을 가리지 않는다.
//  거기서 바다로 선착장 다리 둘이 뻗고, 그 옆에 요트가 떠 있다 (2026-10-02).
//  바다 수면은 섬 바닥보다 T3D_HARBOR.sea만큼 낮다 — 벽·부두는 수면까지 내려가 물에 잠긴다.
//  바닥판이 원근으로 누워 있어 줄마다 크기가 다르므로(파도와 같은 까닭) 점마다 맵 좌표를 월드로 옮겨 짓는다.
// ══════════════════════════════════════════════════════════
const T3D_WALL_H = 100;     // 높이 — 타일 한 칸
const T3D_WALL_T = 26;      // 두께 (맵 px) — 잔디 블록 한 변
const T3D_WALL_STONE = 12;  // 돌 타일 한 장 (맵 px) — 컷씬의 섬 몸통 무늬
let _t3dWallTex = null;

/**
 * 섬 가장자리 블록 — 맵 공간 상자 목록 (_t3dMapBoxes 꼴). 늘 같은 모양(씨앗 고정)이라 필드와 컷씬이 같다.
 * 꼭대기는 장식까지 T3D_HARBOR.wallTop(116)을 넘지 않는다 — 맵 이동 범위(board.js)가 그 높이를 본다.
 */
function t3dIslandBoxes() {
  const W = T3D_MAP_W, H = T3D_MAP_H, T = T3D_WALL_T, SEA = T3D_HARBOR.sea;
  let seed = 20261003;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tint = (hex, k) => {
    const r = Math.min(255, ((hex >> 16) & 255) * k) | 0, g = Math.min(255, ((hex >> 8) & 255) * k) | 0, b = Math.min(255, (hex & 255) * k) | 0;
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  };
  const out = [];
  const flowers = [0xff6b8a, 0xffd84a, 0xffffff, 0xb48cff, 0xff9a4a];
  // 블록 한 기둥 — (x0..x1 · y0..y1), 바깥쪽 방향 (ox, oy)
  const column = (x0, x1, y0, y1, ox, oy) => {
    const top = 100 + (Math.floor(rnd() * 3) - 1) * 4;          // 96 · 100 · 104
    const v = 0.9 + rnd() * 0.2;
    const B = (h0, h1, c) => out.push({ x0, x1, y0, y1, h0, h1, color: tint(c, v) });
    B(-SEA, 0, 0x5f5b55);                                       // 바위 밑동 — 물에 잠긴다 (필드 바닥 아래)
    B(0, 46, 0x4d3420);                                         // 짙은 흙
    B(46, top - 12, 0x684629);                                  // 흙
    B(top - 12, top - 9, 0x2f5e24);                             // 잔디 뿌리 (흙과 잔디 사이)
    B(top - 9, top, 0x3f7f30);                                  // 잔디 머리 — 밤 빛에 맞춘 짙은 초록
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const deco = (w, d, h, c, dx = 0, dy = 0) => out.push({ x0: cx + dx - w / 2, x1: cx + dx + w / 2, y0: cy + dy - d / 2, y1: cy + dy + d / 2, h0: top, h1: top + h, color: tint(c, 0.92 + rnd() * 0.16) });
    const r = rnd();
    if (r < 0.2) {                                              // 덤불 — 두 덩이
      deco(16, 16, 10, 0x2c6626, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6);
      deco(10, 10, 12, 0x387a2f, (rnd() - 0.5) * 8, (rnd() - 0.5) * 8);
    } else if (r < 0.32) {                                      // 꽃 — 줄기 위에 꽃잎
      const dx = (rnd() - 0.5) * 12, dy = (rnd() - 0.5) * 12;
      deco(2, 2, 6, 0x2f6a24, dx, dy);
      out.push({ x0: cx + dx - 3, x1: cx + dx + 3, y0: cy + dy - 3, y1: cy + dy + 3, h0: top + 6, h1: top + 9, color: tint(flowers[Math.floor(rnd() * flowers.length)], 1) });
    } else if (r < 0.39) {                                      // 돌멩이
      deco(11, 9, 6, 0x9a978e, (rnd() - 0.5) * 8, (rnd() - 0.5) * 8);
    } else if (r < 0.55) {                                      // 풀포기
      for (let k = 0; k < 3; k++) deco(2.5, 2.5, 4 + rnd() * 5, 0x4f9338, (rnd() - 0.5) * 16, (rnd() - 0.5) * 16);
    }
    // 바깥 턱 — 군데군데 낮은 잔디 블록이 바다 쪽으로 붙어 둘레가 들쭉날쭉하다
    if (rnd() < 0.34) {
      const d = T * (0.5 + rnd() * 0.4), th = 34 + Math.floor(rnd() * 4) * 7;
      const bx0 = ox < 0 ? x0 - d : ox > 0 ? x1 : x0, bx1 = ox < 0 ? x0 : ox > 0 ? x1 + d : x1;
      const by0 = oy < 0 ? y0 - d : y0, by1 = oy < 0 ? y0 : y1;
      const C = (h0, h1, c) => out.push({ x0: bx0, x1: bx1, y0: by0, y1: by1, h0, h1, color: tint(c, v * 0.96) });
      C(-SEA, 10, 0x5f5b55);
      C(10, th - 8, 0x684629);
      C(th - 8, th, 0x3f7f30);
    }
  };
  for (let x = -T; x < W + T; x += T) column(x, Math.min(W + T, x + T), -T, 0, 0, -1);   // 먼 쪽 (맵 위 변) — 두 모서리까지
  for (let y = 0; y < H; y += T) column(-T, 0, y, Math.min(H, y + T), -1, 0);           // 왼쪽
  for (let y = 0; y < H; y += T) column(W, W + T, y, Math.min(H, y + T), 1, 0);        // 오른쪽
  return out;
}

/** 12×12 돌 타일 무늬 — 16 × 16장 (192px) 한 장을 되풀이한다 (컷씬의 섬 몸통) */
function _t3dWallTexture() {
  if (_t3dWallTex) return _t3dWallTex;
  const N = 16, S = T3D_WALL_STONE, px = 4;          // 한 장 = 12px → 텍스처 48px (선명하게 4배)
  const c = document.createElement('canvas');
  c.width = c.height = N * S * px;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.fillStyle = '#3a3f48';                           // 줄눈
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = 100 + rnd() * 30, tint = rnd() * 8 - 4;
    const r = l - 6 + tint, gr = l - 2, b = l + 8 - tint;
    const x0 = x * S * px + px * 0.7, y0 = y * S * px + px * 0.7, w = S * px - px * 1.4;
    // 돌 한 장 — 위·왼쪽은 밝게, 아래·오른쪽은 어둡게 (살짝 도드라진 평면 타일)
    const grad = g.createLinearGradient(x0, y0, x0 + w, y0 + w);
    grad.addColorStop(0, `rgb(${r + 14 | 0},${gr + 14 | 0},${b + 14 | 0})`);
    grad.addColorStop(0.5, `rgb(${r | 0},${gr | 0},${b | 0})`);
    grad.addColorStop(1, `rgb(${r - 16 | 0},${gr - 16 | 0},${b - 14 | 0})`);
    g.fillStyle = grad;
    g.fillRect(x0, y0, w, w);
    // 거친 점 · 가끔 금
    for (let k = 0; k < 10; k++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + rnd() * 0.08})`;
      g.fillRect(x0 + rnd() * w, y0 + rnd() * w, px * (0.6 + rnd()), px * (0.6 + rnd()));
    }
    if (rnd() < 0.18) {
      g.strokeStyle = 'rgba(20,22,28,0.55)';
      g.lineWidth = px * 0.5;
      g.beginPath();
      g.moveTo(x0 + rnd() * w, y0);
      g.lineTo(x0 + rnd() * w, y0 + w * (0.4 + rnd() * 0.6));
      g.stroke();
    }
  }
  _t3dWallTex = new THREE.CanvasTexture(c);
  _t3dWallTex.wrapS = _t3dWallTex.wrapT = THREE.RepeatWrapping;
  _t3dWallTex.anisotropy = 4;
  return _t3dWallTex;
}

/**
 * 섬 둘레 — 맵 좌표(px) 기준. 바다 셰이더(seasky.js) · 맵 이동 범위(board.js) · 그림리퍼 컷씬(reaper3d.js)이 같이 읽는다.
 *   sea     바다 수면이 섬 바닥보다 낮은 정도
 *   reach   앞쪽 부두 끝에서 선착장이 바다로 뻗은 길이
 *   piers   선착장 다리 (가운데 x · 폭)       yachts  요트 (가운데 x · y · 길이 · 방향)
 */
const T3D_HARBOR = {
  wall: 26, wallTop: 116, sea: 16, reach: 150,
  piers:  [{ x: 230, w: 70 }, { x: 1370, w: 70 }],
  // 요트는 부두 앞에 옆으로 대 놓았다 — 이 카메라에서 옆모습(선체 · 돛대)이 잘 보인다
  yachts: [{ x: 104, y: 992, len: 112, yaw: -Math.PI / 2 + 0.05, ph: 0 }, { x: 1496, y: 994, len: 104, yaw: Math.PI / 2 - 0.06, ph: 2.1 }]
};

/** 맵 공간 상자들(x0..x1 · y0..y1 · 높이 h0..h1, 색)을 한 메시로 — 점마다 원근 바닥 위로 옮긴다 */
function _t3dMapBoxes(boxes) {
  const pos = [], col = [];
  const P = (x, y, h) => { const p = _t3dMapWorld(x, y); return [p.x, h * p.s, p.z]; };
  const c = new THREE.Color();
  for (const b of boxes) {
    const { x0, x1, y0, y1, h0, h1 } = b;
    c.set(b.color);
    const face = (q, shade) => {
      const [a, bb, cc, d] = q.map(v => P(...v));
      pos.push(...a, ...bb, ...cc, ...a, ...cc, ...d);
      for (let i = 0; i < 6; i++) col.push(c.r * shade, c.g * shade, c.b * shade);
    };
    face([[x0, y0, h1], [x0, y1, h1], [x1, y1, h1], [x1, y0, h1]], 1);        // 윗면
    face([[x0, y1, h0], [x1, y1, h0], [x1, y1, h1], [x0, y1, h1]], 0.78);     // 앞 (카메라 쪽)
    face([[x1, y0, h0], [x0, y0, h0], [x0, y0, h1], [x1, y0, h1]], 0.78);
    face([[x0, y0, h0], [x0, y1, h0], [x0, y1, h1], [x0, y0, h1]], 0.68);
    face([[x1, y1, h0], [x1, y0, h0], [x1, y0, h1], [x1, y1, h1]], 0.68);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

/** 선착장 다리 한 줄 — 맵 공간 상자 목록 (컷씬도 같은 목록을 쓴다) */
function t3dPierBoxes(p) {
  const HB = T3D_HARBOR, y0 = T3D_MAP_H + HB.wall, y1 = y0 + HB.reach;
  const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2;
  const out = [];
  // 널빤지 — 가로로 깔고, 한 장씩 결 색이 다르다
  const woods = ['#7b5b3b', '#6c4f33', '#86653f', '#73553a'];
  let i = 0;
  for (let y = y0; y < y1 - 1; y += 13, i++) {
    out.push({ x0, x1, y0: y, y1: Math.min(y1, y + 11), h0: -5, h1: -1, color: woods[(i * 7 + (p.x | 0)) % 4] });
  }
  // 널빤지를 받치는 양옆 들보
  out.push({ x0: x0 - 2, x1: x0 + 6, y0, y1, h0: -11, h1: -5, color: '#4a3524' });
  out.push({ x0: x1 - 6, x1: x1 + 2, y0, y1, h0: -11, h1: -5, color: '#4a3524' });
  // 말뚝 — 물속에서 올라와 난간 높이까지 (밧줄 매는 기둥)
  for (let y = y0 + 22; y <= y1 - 4; y += 42) {
    out.push({ x0: x0 - 6, x1: x0 + 3, y0: y - 4, y1: y + 4, h0: -HB.sea, h1: 12, color: '#3d2c1e' });
    out.push({ x0: x1 - 3, x1: x1 + 6, y0: y - 4, y1: y + 4, h0: -HB.sea, h1: 12, color: '#3d2c1e' });
  }
  // 끝의 등불 기둥
  out.push({ x0: x1 - 4, x1: x1 + 2, y0: y1 - 8, y1: y1 - 2, h0: -1, h1: 46, color: '#2c2420' });
  return out;
}

/**
 * 앞쪽 부두 — 선착장과 같은 나무 널마루. 맵 아래 변을 따라 (돌벽 두께만큼) 깔고,
 * 윗면은 타일과 같은 높이(0)라 맨 아랫줄을 가리지 않는다. 앞은 굵은 테 보와 물속에서 올라온 말뚝이 받친다.
 */
function t3dQuayBoxes() {
  const HB = T3D_HARBOR, W = T3D_MAP_W, y0 = T3D_MAP_H, y1 = y0 + HB.wall;
  const woods = ['#7b5b3b', '#6c4f33', '#86653f', '#73553a'];
  const out = [];
  let i = 0;
  for (let x = -HB.wall; x < W + HB.wall - 1; x += 14, i++) {
    out.push({ x0: x, x1: Math.min(W + HB.wall, x + 12.5), y0, y1: y1 - 3, h0: -4, h1: 0, color: woods[(i * 5 + (i >> 2)) % 4] });
  }
  out.push({ x0: -HB.wall, x1: W + HB.wall, y0: y1 - 4, y1, h0: -9, h1: 0, color: '#4a3524' });   // 앞 테 보
  for (let x = -HB.wall + 6; x < W + HB.wall; x += 58) {
    out.push({ x0: x, x1: x + 8, y0: y1 - 7, y1: y1 + 2, h0: -HB.sea, h1: -3, color: '#3d2c1e' });  // 말뚝
  }
  return out;
}

/** 등불·돛대 불빛 — 부드러운 빛 점 */
let _t3dGlowTex = null;
function _t3dGlowSprite(color, size) {
  if (!_t3dGlowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    _t3dGlowTex = new THREE.CanvasTexture(c);
    _t3dGlowTex._rpShared = true;
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: _t3dGlowTex, color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  sp.scale.setScalar(size);
  return sp;
}

/**
 * 요트 한 척 — 단위 px, 길이 방향이 +z(뱃머리). 밤이라 돛은 접어 파란 덮개를 씌웠고, 돛대 끝에 정박등이 켜져 있다.
 * 섬 필드(towers3d)와 컷씬(reaper3d)이 같이 쓴다.
 */
function t3dBuildYacht(len) {
  const g = new THREE.Group();
  const L = len, B = len * 0.34;
  // 선체 — 갑판 윤곽(뒤는 판판, 앞은 뾰족)을 아래로 뽑아 내며 좁힌다
  const sh = new THREE.Shape();
  sh.moveTo(-B * 0.42, -L * 0.5);
  sh.lineTo(B * 0.42, -L * 0.5);
  sh.quadraticCurveTo(B * 0.56, L * 0.05, 0, L * 0.5);
  sh.quadraticCurveTo(-B * 0.56, L * 0.05, -B * 0.42, -L * 0.5);
  const hullGeo = new THREE.ExtrudeGeometry(sh, { depth: 16, bevelEnabled: false, curveSegments: 10 });
  hullGeo.rotateX(Math.PI / 2);                           // 윤곽은 바닥(x-z) — 위 8, 아래 -8
  hullGeo.translate(0, 8, 0);
  // 아래로 갈수록 좁게 (배 밑이 둥글게 빠진다)
  const ps = hullGeo.attributes.position;
  for (let i = 0; i < ps.count; i++) {
    const k = Math.max(0, 8 - ps.getY(i)) / 16;
    ps.setX(i, ps.getX(i) * (1 - k * 0.38));
    ps.setZ(i, ps.getZ(i) * (1 - k * 0.12));
  }
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({ color: 0xe9edf3, side: THREE.DoubleSide }));
  g.add(hull);
  // 수선 띠 (짙은 남색) · 갑판
  const band = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({ color: 0x1d2c4a, side: THREE.DoubleSide }));
  band.scale.set(1.03, 0.3, 1.02);
  band.position.y = -5;
  g.add(band);
  const deckGeo = new THREE.ShapeGeometry(sh, 10);
  deckGeo.rotateX(Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, new THREE.MeshLambertMaterial({ color: 0xb98d5e, side: THREE.DoubleSide }));
  deck.position.y = 8.3;
  deck.scale.set(0.9, 1, 0.93);
  g.add(deck);
  // 선실 — 낮은 상자에 검은 창
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(B * 0.6, 9, L * 0.3), new THREE.MeshLambertMaterial({ color: 0xf2f4f8 }));
  cabin.position.set(0, 12.5, -L * 0.08);
  g.add(cabin);
  const win = new THREE.Mesh(new THREE.BoxGeometry(B * 0.62, 3, L * 0.22), new THREE.MeshBasicMaterial({ color: 0x18233a }));
  win.position.set(0, 13.5, -L * 0.08);
  g.add(win);
  // 돛대 · 붐(접은 돛에 파란 덮개)
  const mastH = len * 1.25;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, mastH, 6), new THREE.MeshLambertMaterial({ color: 0xd9dde4 }));
  mast.position.set(0, 8 + mastH / 2, L * 0.08);
  g.add(mast);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, L * 0.42, 8), new THREE.MeshLambertMaterial({ color: 0x2e5aa8 }));
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 22, L * 0.08 - L * 0.21);
  g.add(boom);
  // 버팀줄 — 돛대 끝에서 뱃머리 · 고물로
  const top = new THREE.Vector3(0, 8 + mastH, L * 0.08);
  const rig = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 9, L * 0.48), top, top, new THREE.Vector3(0, 9, -L * 0.48)]);
  g.add(new THREE.LineSegments(rig, new THREE.LineBasicMaterial({ color: 0x9aa6b8, transparent: true, opacity: 0.7 })));
  // 정박등 — 돛대 끝의 흰 불
  const lamp = _t3dGlowSprite(0xfff3d6, 16);
  lamp.position.copy(top);
  g.add(lamp);
  return g;
}

let _t3dYachts = [];
let _t3dHarborLast = 0;

function _t3dBuildWalls() {
  const H = T3D_MAP_H, T = T3D_WALL_T;
  const g = new THREE.Group();
  g.name = 'walls';
  // 섬 가장자리 — 위 · 왼쪽 · 오른쪽을 잔디 블록이 둘러싼다
  g.add(_t3dMapBoxes(t3dIslandBoxes()));
  // 가까운 쪽 — 벽 대신 바닥 높이의 나무 부두 (타일을 가리지 않는다)
  g.add(_t3dMapBoxes(t3dQuayBoxes()));
  // 선착장 다리 둘 · 끝의 등불
  T3D_HARBOR.piers.forEach(p => {
    g.add(_t3dMapBoxes(t3dPierBoxes(p)));
    const w = _t3dMapWorld(p.x + p.w / 2 - 1, H + T + T3D_HARBOR.reach - 5);
    const lamp = _t3dGlowSprite(0xffc36b, 34 * w.s);
    lamp.position.set(w.x, 50 * w.s, w.z);
    g.add(lamp);
  });
  _t3dScene.add(g);

  // 요트 — 선착장 옆에 떠서 천천히 출렁인다
  _t3dYachts = T3D_HARBOR.yachts.map(y => {
    const boat = t3dBuildYacht(y.len);
    const w = _t3dMapWorld(y.x, y.y);
    // 바깥 틀은 맵 축(x · 앞뒤)에 맞추고, 바닥이 앞뒤로 늘어나 보이는 만큼(카메라 고도 30°) 앞뒤로 늘린다 —
    // 그래야 배가 어느 쪽을 보든 바닥 위 크기와 맞는다. 배는 그 안에서 돈다
    boat.rotation.y = y.yaw;
    const inner = new THREE.Group();
    inner.add(boat);
    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.position.set(w.x, -T3D_HARBOR.sea * w.s, w.z);
    wrap.rotation.y = T3D_AZI;
    inner.scale.set(w.s, w.s, w.s * 0.95 / Math.sin(T3D_ELEV));
    _t3dScene.add(wrap);
    return { wrap, boat, y0: wrap.position.y, s: w.s, ph: y.ph };
  });
  towers3dAddStep(_t3dHarborStep);
}

/** 요트 출렁임 — 초당 20번만 (그때만 다시 그린다) */
function _t3dHarborStep(now) {
  if (!_t3dYachts.length || now - _t3dHarborLast < 50) return false;
  _t3dHarborLast = now;
  const t = now / 1000;
  _t3dYachts.forEach(b => {
    b.wrap.position.y = b.y0 + Math.sin(t * 1.3 + b.ph) * 1.6 * b.s;
    b.boat.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.05;   // 옆으로 기우뚱 (배 축 기준)
    b.boat.rotation.x = Math.sin(t * 0.7 + b.ph * 1.7) * 0.025;
  });
  return true;
}

// ══════════════════════════════════════════════════════════
//  불 · 폭발 · 열기 · 방벽 (2026-10-02) — 불덩이 · 폭염 · 벽돌 · 철벽
//  불길은 카메라를 보는 판(빌보드)에 잡음으로 흔들리는 불꽃 셰이더를 그린다 (더하기 섞기).
//  판은 바닥에 발을 딛고 서 있어 타워 뒤의 불은 타워에 가리고, 앞의 불은 타워를 덮는다.
//  불이 타는 동안은 주황 점광원 하나가 그 자리를 비춰 타워 벽이 불빛을 받는다 (미리 만들어 둔 셋을 돌려 쓴다).
// ══════════════════════════════════════════════════════════
let _t3dFireMat = null;
let _t3dFires = [];          // 불길 판 { mesh, born, end, grow, w, h, seed }
let _t3dSparks = [];         // 튀는 불똥 · 피어오르는 잉걸 { sp, born, life, v, g, size }
let _t3dFireLights = [];     // { light, until, base }
let _t3dHazes = [];          // 열기 아지랑이 판 { mesh, born, end }
let _t3dWalls = [];          // 방벽 { group, el, born, end, s, kind }
let _t3dFireStepOn = false;

const T3D_FIRE_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const T3D_NOISE_GLSL = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.1 + vec2(1.7, 9.2); a *= 0.5; } return v; }`;

/** 불꽃 한 장의 재질 — uLife(0~1)로 피고 지고, uSeed로 저마다 다르게 흔들린다 */
function _t3dFireMaterial() {
  if (!_t3dFireMat) {
    _t3dFireMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uSeed: { value: 0 }, uLife: { value: 1 }, uHot: { value: 0 } },
      vertexShader: T3D_FIRE_VERT,
      fragmentShader: `
        uniform float uTime; uniform float uSeed; uniform float uLife; uniform float uHot;
        varying vec2 vUv;
        ${T3D_NOISE_GLSL}
        void main() {
          vec2 uv = vUv;
          float t = uTime * 1.6 + uSeed * 13.0;
          // 위로 흐르는 잡음 — 위로 갈수록 크게 휘어 혀처럼 날름거린다
          float sway = (fbm(vec2(uv.y * 2.6 - t * 1.2, uSeed * 9.0)) - 0.5) * 1.1 * uv.y;
          vec2 q = vec2((uv.x + sway) * 3.2 + uSeed * 5.0, uv.y * 2.2 - t * 1.4);
          float n  = fbm(q);
          float n2 = fbm(q * 2.1 + vec2(3.1, -t * 0.8));
          float x = (uv.x - 0.5) * 2.0 + sway;
          // 아래가 넓고 위로 갈수록 가늘어지는 몸
          float width = max(0.04, 0.95 - uv.y * 0.8);
          float body = 1.0 - abs(x) / width;
          // 위쪽은 잡음으로 갈라져 여러 갈래 불 혀가 된다
          float fl = body * 0.9 + (n - 0.5) * 0.8 - uv.y * 0.55 - smoothstep(0.35, 1.0, uv.y) * (1.0 - n2) * 0.7;
          fl = clamp(fl * 1.3, 0.0, 1.0);
          float a = smoothstep(0.0, 0.5, fl) * smoothstep(0.0, 0.12, uv.y);
          vec3 deep  = vec3(0.42, 0.04, 0.01);
          vec3 mid   = vec3(0.98, 0.30, 0.03);
          vec3 hot   = vec3(1.00, 0.66, 0.18);
          vec3 white = vec3(1.00, 0.90, 0.62);
          vec3 col = mix(deep, mid, smoothstep(0.0, 0.35, fl));
          col = mix(col, hot, smoothstep(0.4, 0.75, fl));
          col = mix(col, white, smoothstep(0.8, 1.0, fl) * smoothstep(0.55, 0.0, uv.y));
          a *= uLife;
          gl_FragColor = vec4(col * (0.85 + uHot), a);
        }`
    });
  }
  const m = _t3dFireMat.clone();
  m.uniforms.uSeed.value = Math.random();
  return m;
}

/** 바닥(맵 좌표)에 발을 딛고 카메라를 보는 판 */
function _t3dBillboard(mat, mapX, mapY, w, h, lift = 0) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const m = new THREE.Mesh(geo, mat);
  const p = _t3dMapWorld(mapX, mapY);
  m.position.set(p.x, lift * p.s, p.z);
  m.scale.set(w * p.s, h * p.s, 1);
  m.quaternion.copy(_t3dCamera.quaternion);
  m.userData.s = p.s;
  return m;
}

/** 주황 점광원 — 셋을 미리 만들어 두고 돌려 쓴다 (불이 생길 때마다 광원 수가 바뀌면 재질이 다시 컴파일된다) */
function _t3dFireLightsInit() {
  if (_t3dFireLights.length || !_t3dScene) return;
  for (let i = 0; i < 3; i++) {
    const light = new THREE.PointLight(0xff7a2a, 0, 520, 1.6);
    _t3dScene.add(light);
    _t3dFireLights.push({ light, until: 0, base: 0 });
  }
}
function _t3dFireLightAt(mapX, mapY, ms, power, tag = null) {
  _t3dFireLightsInit();
  const now = performance.now();
  const slot = _t3dFireLights.find(l => l.until < now) || _t3dFireLights.reduce((a, b) => (a.until < b.until ? a : b));
  if (!slot) return;
  const p = _t3dMapWorld(mapX, mapY);
  slot.light.position.set(p.x, 70 * p.s, p.z);
  slot.until = now + ms;
  slot.born = now;
  slot.base = power;
  slot.tag = tag;
}

/** 불똥 · 잉걸 하나 (빛 점) */
function _t3dSpark(mapX, mapY, h, opt) {
  if (typeof _t3dGlowSprite !== 'function') return;
  const p = _t3dMapWorld(mapX, mapY);
  const sp = _t3dGlowSprite(opt.color || 0xffa040, 1);
  sp.position.set(p.x, h * p.s, p.z);
  _t3dScene.add(sp);
  _t3dSparks.push({ sp, born: performance.now() + (opt.delay || 0), life: opt.life, v: opt.v.clone().multiplyScalar(p.s), g: (opt.g || 0) * p.s, size: opt.size * p.s, tag: opt.tag });
  sp.visible = false;
}

function _t3dFireStepEnsure() {
  if (_t3dFireStepOn) return;
  _t3dFireStepOn = true;
  towers3dAddStep(_t3dFireStep);
}

/** 매 프레임 — 불길이 피고 날름거리다 사그라지고, 불똥이 튀고, 광원이 일렁인다 */
function _t3dFireStep(now) {
  let busy = false;
  const sec = now / 1000;
  _t3dFires = _t3dFires.filter(f => {
    const age = now - f.born;
    if (now >= f.end) { _t3dScene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose(); return false; }
    busy = true;
    if (age < 0) { f.mesh.visible = false; return true; }
    f.mesh.visible = true;
    const grow = Math.min(1, age / f.grow);
    const fade = Math.min(1, (f.end - now) / 380);
    const flick = 0.82 + 0.18 * Math.sin(sec * 17 + f.seed * 40) * Math.sin(sec * 7.3 + f.seed * 9);
    const u = f.mesh.material.uniforms;
    u.uTime.value = sec;
    u.uLife.value = Math.min(1, grow * 1.4) * fade * flick;
    u.uHot.value = f.hot ? f.hot * Math.max(0, 1 - age / 500) : 0;
    const k = (0.35 + 0.65 * (1 - (1 - grow) ** 3)) * (0.7 + 0.3 * fade);
    f.mesh.scale.set(f.w * f.s * (0.9 + 0.1 * flick), f.h * f.s * k * (0.92 + 0.12 * flick), 1);
    return true;
  });
  _t3dSparks = _t3dSparks.filter(s => {
    const age = now - s.born;
    if (age > s.life) { _t3dScene.remove(s.sp); s.sp.material.dispose(); return false; }
    busy = true;
    if (age < 0) return true;
    s.sp.visible = true;
    const t = age / 1000;
    s.sp.position.x += s.v.x * 0.016; s.sp.position.z += s.v.z * 0.016;
    s.sp.position.y += (s.v.y - s.g * t) * 0.016;
    const k = 1 - age / s.life;
    s.sp.scale.setScalar(s.size * (0.4 + 0.6 * k));
    s.sp.material.opacity = Math.min(1, k * 1.6);
    return true;
  });
  _t3dFireLights.forEach(l => {
    if (l.until > now) {
      busy = true;
      const age = now - (l.born || now);
      const env = Math.min(1, age / 120) * Math.min(1, (l.until - now) / 400);
      l.light.intensity = l.base * env * (0.8 + 0.2 * Math.sin(sec * 23) * Math.sin(sec * 9.1));
    } else if (l.light.intensity) { l.light.intensity = 0; busy = true; }
  });
  _t3dHazes = _t3dHazes.filter(h => {
    if (now >= h.end) { _t3dScene.remove(h.mesh); h.mesh.geometry.dispose(); h.mesh.material.dispose(); return false; }
    busy = true;
    const age = now - h.born;
    const u = h.mesh.material.uniforms;
    u.uTime.value = sec;
    u.uLife.value = Math.min(1, age / 700) * Math.min(1, (h.end - now) / 900);
    return true;
  });
  if (_t3dSteamStep(now)) busy = true;
  if (_t3dIceStep(now)) busy = true;
  _t3dWalls = _t3dWalls.filter(w => {
    if (now >= w.end + 520 || !w.el.isConnected) {
      _t3dScene.remove(w.group);
      const mats = new Set();
      w.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) mats.add(o.material); });
      mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      return false;
    }
    busy = true;
    // 땅에서 솟아오른다 → 서 있다 → 무너져 내려앉는다
    const rise = Math.min(1, (now - w.born) / 380);
    const e = 1 - (1 - rise) ** 3;
    const down = Math.max(0, (now - w.end) / 520);
    const sy = e * (1 - down * down);
    w.group.scale.set(w.s, w.s * Math.max(0.001, sy), w.s);
    const shake = rise < 1 ? Math.sin(now / 18) * 1.2 * (1 - rise) : 0;
    w.group.position.x = w.x + shake * w.s;
    w.group.traverse(o => {
      if (!o.material || !o.material.userData.baseOpacity) return;
      o.material.opacity = o.material.userData.baseOpacity * (1 - down);
    });
    // 내 방벽이 사라지는 쪽 타워가 무너지면 같이 없앤다
    if (w.el.classList.contains('destroyed') && w.end > now) w.end = now;
    return true;
  });
  return busy;   // 할 일이 없으면 false — 한 번 걸어 두면 계속 남지만 빈 배열만 훑는다
}

/** 그 칸에 선 타워 (맵 좌표의 발밑 반지름) — 불길을 그 둘레로 비켜 세운다 */
function _t3dTowerOnTile(mapX, mapY) {
  for (const t of _t3dTowers) {
    if (!t.group.visible) continue;
    const c = Number(t.el.style.getPropertyValue('--col')), r = Number(t.el.style.getPropertyValue('--row'));
    if (Math.abs((c + 0.5) * 100 - mapX) < 40 && Math.abs((r + 0.5) * 100 - mapY) < 40) return t;
  }
  return null;
}

/**
 * 칸들이 불탄다 (불덩이 · 폭염).
 * @param {object} o tiles [{x,y}] 칸 가운데(맵 좌표) · ms 타는 시간 · burst 1(덩이가 떨어짐) | 2(폭발) · seed
 * @returns {boolean} 그렸으면 true
 */
function towers3dFireField(o) {
  if (!_t3dScene || !_t3dCamera) return false;
  _t3dFireStepEnsure();
  let seed = (o.seed >>> 0) || 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const now = performance.now();
  const big = o.burst === 2;
  let cx = 0, cy = 0;
  o.tiles.forEach(t => { cx += t.x; cy += t.y; });
  cx /= o.tiles.length; cy /= o.tiles.length;
  // 터지는 순간 — 하얗게 달아오른 빛 덩이가 부풀었다 꺼진다
  const flashAt = big ? o.tiles.filter((_, i) => i % 3 === 0) : [{ x: cx, y: cy }];
  flashAt.forEach((t, i) => {
    if (typeof _t3dGlowSprite !== 'function') return;
    const p = _t3dMapWorld(t.x, t.y);
    const g = _t3dGlowSprite(i % 2 ? 0xffd27a : 0xffa040, 1);
    g.position.set(p.x, (big ? 50 : 30) * p.s, p.z);
    _t3dScene.add(g);
    _t3dSparks.push({ sp: g, born: now + i * 40, life: big ? 520 : 420, v: new THREE.Vector3(), g: 0,
                      size: (big ? 230 : 200) * p.s, flash: true });
    g.visible = false;
  });
  // 불똥 — 사방으로 튀었다가 떨어진다
  const nSpark = big ? 70 : 28;
  for (let i = 0; i < nSpark; i++) {
    const t = o.tiles[Math.floor(rnd() * o.tiles.length)];
    const a = rnd() * Math.PI * 2, sp = (big ? 260 : 190) * (0.4 + rnd());
    _t3dSpark(t.x + (rnd() - 0.5) * 50, t.y + (rnd() - 0.5) * 50, 20 + rnd() * 30, {
      color: rnd() < 0.5 ? 0xffc060 : 0xff7a20, delay: rnd() * 120, life: 500 + rnd() * 500,
      v: new THREE.Vector3(Math.cos(a) * sp, 180 + rnd() * (big ? 360 : 240), Math.sin(a) * sp * 0.6), g: 620, size: 10 + rnd() * 12 });
  }
  // 불길 — 칸마다 큰 불 셋 + 작은 불 둘. 타워가 선 칸은 타워 둘레로 비켜 선다
  o.tiles.forEach((t, ti) => {
    const tower = _t3dTowerOnTile(t.x, t.y);
    const n = big ? 3 : 6;
    for (let k = 0; k < n; k++) {
      let x = t.x + (rnd() - 0.5) * 90, y = t.y + (rnd() - 0.5) * 90;
      if (tower) {
        const a = (k / n) * Math.PI * 2 + rnd() * 0.6;
        x = t.x + Math.cos(a) * 46; y = t.y + Math.sin(a) * 46;
      }
      const small = big ? k >= 2 : k >= 3;
      const w = (small ? 40 : 62) + rnd() * 26, h = (small ? 62 : 104) + rnd() * 50;
      const born = now + (big ? rnd() * 160 : 40 + rnd() * 140);
      const mesh = _t3dBillboard(_t3dFireMaterial(), x, y, w, h);
      mesh.renderOrder = 6;
      mesh.visible = false;
      _t3dScene.add(mesh);
      _t3dFires.push({ mesh, born, end: born + o.ms - rnd() * 200, grow: 160 + rnd() * 160, w, h, s: mesh.userData.s,
                       seed: rnd(), hot: big ? 0.45 : 0.3, tag: o.tag });
    }
  });
  // 타는 동안 피어오르는 잉걸
  const embers = Math.round(o.tiles.length * (o.ms / 1000) * 3);
  for (let i = 0; i < embers; i++) {
    const t = o.tiles[Math.floor(rnd() * o.tiles.length)];
    _t3dSpark(t.x + (rnd() - 0.5) * 80, t.y + (rnd() - 0.5) * 80, 20 + rnd() * 40, {
      color: 0xff9a40, delay: 150 + rnd() * o.ms, life: 900 + rnd() * 700,
      v: new THREE.Vector3((rnd() - 0.5) * 30, 70 + rnd() * 70, 0), g: -10, size: 5 + rnd() * 6, tag: o.tag });
  }
  _t3dFireLightAt(cx, cy, o.ms + 300, big ? 2.4 : 2.0, o.tag);
  _t3dDirty = true;
  return true;
}

/** 타워가 불길에 휩싸인다 — 벽을 타고 오르는 불꽃 (카메라 쪽 벽면에) */
function towers3dTowerBurn(el, ms, power = 1, tag = null) {
  const t = _t3dTowers.find(x => x.el === el);
  if (!t || !_t3dScene || !t.group.visible) return false;
  _t3dFireStepEnsure();
  const now = performance.now();
  const ud = t.group.userData;
  const s = ud.scale, W = ud.width || 56, H = ud.hud || 120;
  const base = t.group.position;
  // 카메라 쪽 수평 방향과 그 옆 방향
  const fx = Math.sin(T3D_AZI), fz = Math.cos(T3D_AZI);
  const n = Math.round(5 + 3 * power);
  for (let k = 0; k < n; k++) {
    const side = ((k / (n - 1)) - 0.5) * 2;                       // -1 … 1 (왼쪽 → 오른쪽)
    const hgt = (0.05 + Math.random() * 0.6) * H;
    const off = W * 0.62;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(geo, _t3dFireMaterial());
    mesh.position.set(base.x + (fx * off + fz * side * W * 0.5) * s, hgt * s, base.z + (fz * off - fx * side * W * 0.5) * s);
    mesh.quaternion.copy(_t3dCamera.quaternion);
    mesh.renderOrder = 7;
    mesh.visible = false;
    _t3dScene.add(mesh);
    const w = (34 + Math.random() * 22) * power ** 0.3, h = (60 + Math.random() * 46) * power ** 0.3;
    const born = now + Math.random() * 220;
    _t3dFires.push({ mesh, born, end: born + ms - Math.random() * 250, grow: 220, w, h, s, seed: Math.random(), hot: 0.3, tag });
  }
  _t3dFireLightAt(Number(el.style.getPropertyValue('--col')) * 100 + 50, Number(el.style.getPropertyValue('--row')) * 100 + 50, ms, 1.6 * power, tag);
  _t3dDirty = true;
  return true;
}

/** 열기 — 칸에서 아지랑이가 일렁이며 올라온다 (흐릿한 주황 결 + 느리게 오르는 열 알갱이) */
function towers3dHeatHaze(o) {
  if (!_t3dScene || !_t3dCamera) return false;
  _t3dFireStepEnsure();
  const now = performance.now();
  let seed = (o.seed >>> 0) || 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const mat0 = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uLife: { value: 0 }, uSeed: { value: 0 } },
    vertexShader: T3D_FIRE_VERT,
    fragmentShader: `
      uniform float uTime; uniform float uLife; uniform float uSeed;
      varying vec2 vUv;
      ${T3D_NOISE_GLSL}
      void main() {
        vec2 uv = vUv;
        float t = uTime * 0.9 + uSeed * 20.0;
        // 위로 오르며 옆으로 일렁이는 결
        float bend = (fbm(vec2(uv.y * 3.0 - t, uSeed * 7.0)) - 0.5) * 0.35;
        // 결은 넓고 흐리게 — 또렷한 줄무늬는 용암처럼 보인다
        float stripes = sin((uv.x + bend) * 11.0 + fbm(vec2(uv.x * 3.0, uv.y * 1.6 - t * 1.1)) * 5.0);
        float shimmer = smoothstep(0.2, 1.0, stripes) * fbm(vec2(uv.x * 5.0, uv.y * 3.0 - t * 1.6));
        float edge = smoothstep(0.0, 0.25, uv.x) * smoothstep(1.0, 0.75, uv.x);
        float fadeUp = (1.0 - uv.y) * (1.0 - uv.y);
        float base = smoothstep(0.35, 0.0, uv.y) * 0.5;
        float a = (shimmer * 0.09 + base * 0.16) * edge * fadeUp * uLife;
        vec3 col = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.75, 0.4), shimmer);
        gl_FragColor = vec4(col, a);
      }`
  });
  o.tiles.forEach(t => {
    const m = mat0.clone();
    m.uniforms.uSeed.value = rnd();
    const mesh = _t3dBillboard(m, t.x + (rnd() - 0.5) * 20, t.y + 10, 118, 150 + rnd() * 40);
    mesh.renderOrder = 5;
    _t3dScene.add(mesh);
    _t3dHazes.push({ mesh, born: now, end: now + o.ms, tag: o.tag });
  });
  mat0.dispose();
  // 열 알갱이 — 느리게 떠오르다 사라진다
  const motes = Math.round(o.tiles.length * (o.ms / 1000) * 1.6);
  for (let i = 0; i < motes; i++) {
    const t = o.tiles[Math.floor(rnd() * o.tiles.length)];
    _t3dSpark(t.x + (rnd() - 0.5) * 90, t.y + (rnd() - 0.5) * 90, 6, {
      color: rnd() < 0.5 ? 0xff8a3c : 0xffc070, delay: rnd() * (o.ms - 1200), life: 1400 + rnd() * 900,
      v: new THREE.Vector3((rnd() - 0.5) * 14, 50 + rnd() * 40, 0), g: -6, size: 5 + rnd() * 5, tag: o.tag });
  }
  _t3dDirty = true;
  return true;
}

// ── 방벽 (벽돌 · 철벽) ──────────────────────────────────────
let _t3dBrickTex = null, _t3dSteelTex = null;

/** 벽돌 무늬 — 붉은 벽돌을 엇갈려 쌓고 줄눈은 밝은 회색 */
function _t3dBrickTexture() {
  if (_t3dBrickTex) return _t3dBrickTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d9cdbb';
  g.fillRect(0, 0, 128, 128);
  let s = 11;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const bw = 32, bh = 16;
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 128; x += bw) {
      const r = 168 + rnd() * 50 | 0, gg = 58 + rnd() * 24 | 0, b = 36 + rnd() * 16 | 0;
      const grad = g.createLinearGradient(0, row * bh, 0, row * bh + bh);
      grad.addColorStop(0, `rgb(${r + 18},${gg + 10},${b + 8})`);
      grad.addColorStop(1, `rgb(${r - 22},${gg - 14},${b - 10})`);
      g.fillStyle = grad;
      g.fillRect(x + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 4; k++) g.fillRect(x + off + 2 + rnd() * (bw - 6), row * bh + 2 + rnd() * (bh - 6), 2, 2);
    }
  }
  _t3dBrickTex = new THREE.CanvasTexture(c);
  _t3dBrickTex.wrapS = _t3dBrickTex.wrapT = THREE.RepeatWrapping;
  _t3dBrickTex._rpShared = true;
  return _t3dBrickTex;
}

/** 강철판 무늬 — 솔질 자국이 난 철판에 가장자리 이음매와 리벳 */
function _t3dSteelTexture() {
  if (_t3dSteelTex) return _t3dSteelTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#aab4c2'); grad.addColorStop(0.5, '#7d8796'); grad.addColorStop(1, '#5f6977');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  let s = 5;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * 128, rnd() * 128, 20 + rnd() * 40, 1);
  }
  g.strokeStyle = 'rgba(20,24,32,0.85)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 125, 125);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 1;
  g.strokeRect(4, 4, 120, 120);
  for (const y of [10, 118]) for (let x = 10; x < 128; x += 27) {
    const rg = g.createRadialGradient(x - 1, y - 1, 0, x, y, 4);
    rg.addColorStop(0, '#f2f5f9'); rg.addColorStop(1, '#3c4450');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.fill();
  }
  _t3dSteelTex = new THREE.CanvasTexture(c);
  _t3dSteelTex.wrapS = _t3dSteelTex.wrapT = THREE.RepeatWrapping;
  _t3dSteelTex._rpShared = true;
  return _t3dSteelTex;
}

/**
 * 타워를 둘러싼 방벽 — 둥근 고리 벽. 반지름은 타워 폭에 맞춰 이웃 칸을 거의 넘지 않는다(3×3칸 안).
 * 높이는 타워 몸통 높이쯤. 카메라 쪽 반은 비치게 해서 타워·체력 숫자가 가리지 않는다.
 *   brick — 얇은 붉은 벽돌 벽, 위에 밝은 갓돌
 *   iron  — 두꺼운 강철판, 위아래 테 · 리벳 · 위로 솟은 쇠 가시 · 은은한 푸른 테두리 빛
 */
function towers3dWallShield(el, kind, ms) {
  const t = _t3dTowers.find(x => x.el === el);
  if (!t || !_t3dScene || !t.group.visible) return false;
  _t3dFireStepEnsure();
  // 같은 벽이 이미 서 있으면 그대로 둔다 (연장 — 끝 시각은 towers3dWallEnd가 맞춘다). 다른 벽이면 새것으로 바꾼다
  if (_t3dWalls.some(w => w.el === el && w.kind === kind && w.end > performance.now())) return true;
  _t3dWalls.filter(w => w.el === el).forEach(w => { w.end = Math.min(w.end, performance.now()); });
  const ud = t.group.userData;
  const iron = kind === 'iron';
  const W = ud.width || 56, H = (ud.hud || 120) * (iron ? 0.92 : 0.86);
  const R = W * 0.78 + (iron ? 16 : 12);
  const T = iron ? 9 : 5;
  const N = iron ? 14 : 18;
  const g = new THREE.Group();
  const camA = Math.atan2(Math.sin(T3D_AZI), Math.cos(T3D_AZI));   // 카메라 쪽 수평 각 (x=sin, z=cos)
  const seg = 2 * Math.PI * R / N;
  // 재질은 벽 하나에 앞(비침) · 뒤 두 벌씩 — 판마다 따로 만들지 않는다
  const tex = (iron ? _t3dSteelTexture() : _t3dBrickTexture()).clone();
  tex.needsUpdate = true;
  tex.repeat.set(iron ? 1 : seg / 26, iron ? H / 60 : H / 26);
  const pair = make => [make(true), make(false)];
  const fade = (m, front, op) => {
    m.transparent = true; m.opacity = front ? op : 1; m.depthWrite = !front; m.side = THREE.DoubleSide;
    m.userData.baseOpacity = m.opacity;
    return m;
  };
  const [panelF, panelB] = pair(front => fade(iron
    ? new THREE.MeshPhongMaterial({ map: tex, shininess: 60, specular: 0x667788 })
    : new THREE.MeshLambertMaterial({ map: tex }), front, iron ? 0.66 : 0.62));
  const [capF, capB] = pair(front => fade(iron
    ? new THREE.MeshPhongMaterial({ color: 0x3e4756, shininess: 90, specular: 0xaabbcc })
    : new THREE.MeshLambertMaterial({ color: 0xcdbca4 }), front, iron ? 0.8 : 0.75));
  const [spikeF, spikeB] = iron
    ? pair(front => fade(new THREE.MeshPhongMaterial({ color: 0xb4bfcc, shininess: 120, specular: 0xffffff }), front, 0.85))
    : [null, null];
  const panelGeo = new THREE.BoxGeometry(seg * 1.02, H, T);
  const capGeo   = new THREE.BoxGeometry(seg * 1.04, iron ? 7 : 4, T + (iron ? 5 : 3));
  const footGeo  = iron ? new THREE.BoxGeometry(seg * 1.04, 6, T + 5) : null;
  const spikeGeo = iron ? new THREE.ConeGeometry(3.4, 12, 6) : null;
  const put = (geo, mat, x, y, z, a) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = a;
    g.add(m);
  };
  for (let i = 0; i < N; i++) {
    const a = (i + 0.5) / N * Math.PI * 2;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    const front = Math.cos(a - camA) > 0.15;
    put(panelGeo, front ? panelF : panelB, x, H / 2, z, a);
    // 위 테두리 — 벽돌은 밝은 갓돌, 철벽은 두꺼운 쇠테 (+ 아래 테 · 위로 솟은 쇠 가시)
    put(capGeo, front ? capF : capB, x, H + (iron ? 3.5 : 2), z, a);
    if (iron) {
      put(footGeo, front ? capF : capB, x, 3, z, a);
      put(spikeGeo, front ? spikeF : spikeB, x, H + 13, z, 0);
    }
  }
  if (iron) {
    // 푸른 테두리 빛 — 바닥에 둘린 고리
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 2, R + 8, 48), new THREE.MeshBasicMaterial({
      color: 0x6fa8e8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.material.userData.baseOpacity = 0.22;
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1;
    g.add(ring);
  }
  const base = t.group.position;
  g.position.set(base.x, 0, base.z);
  const s = ud.scale;
  g.scale.set(s, 0.001, s);
  _t3dScene.add(g);
  const now = performance.now();
  _t3dWalls.push({ group: g, el, born: now, end: now + ms, s, x: base.x, kind });
  // 솟아오를 때 흙먼지
  if (typeof _t3dSpark === 'function') {
    const c = Number(el.style.getPropertyValue('--col')), r = Number(el.style.getPropertyValue('--row'));
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      _t3dSpark((c + 0.5) * 100 + Math.cos(a) * R, (r + 0.5) * 100 + Math.sin(a) * R * 0.6, 4, {
        color: iron ? 0x9fc2ff : 0xc9a27a, delay: Math.random() * 120, life: 500 + Math.random() * 300,
        v: new THREE.Vector3(Math.cos(a) * 60, 60 + Math.random() * 60, Math.sin(a) * 40), g: 300, size: 7 });
    }
  }
  _t3dDirty = true;
  return true;
}

/** 서 있는 방벽의 끝 시각(performance.now 기준)을 타워 데이터에 맞춘다 — 같은 방벽을 또 놓아 늘어난 시간 */
function towers3dWallEnd(el, kind, end) {
  const w = _t3dWalls.find(x => x.el === el && x.kind === kind && x.end > performance.now());
  if (!w) return false;
  w.end = end;
  return true;
}

// ══════════════════════════════════════════════════════════
//  상성 연출 (2026-10-02)
//    물 → 불     : 불길이 사그라지고 흰 김이 쉭 피어오른다 (towers3dFireDouse)
//    바람 → 토템 : 뿌리째 뽑혀 빙글빙글 돌며 날아간다 (towers3dBlowTotem)
//    불 → 토템   : 불이 붙어 까맣게 그을다 재로 주저앉는다 (towers3dBurnTotem)
//    더위 → 토템 : 잎·꽃잎이 누렇게 시들어 처진다 (towers3dTotemWither)
//    얼음전개    : 바닥에서 얼음 결정이 솟고, 타워는 밑동부터 꼭대기까지 얼음이 차오른다 (towers3dIceField · towers3dIce)
//    불 → 얼음   : 반쯤 녹아 물이 흐르거나(1) 다 녹아내린다(2) (towers3dIceMelt · towers3dIceEnd)
// ══════════════════════════════════════════════════════════

// ── 김 ──────────────────────────────────────────────────────
let _t3dSteams = [];   // { sp, born, life, vy, vx, size0, size1, op }

/** 김 한 덩이 — 피어오르며 부풀다 흩어진다 (빛이 아니라 연기라 보통 섞기) */
function _t3dSteamPuff(mapX, mapY, h, delay, o = {}) {
  const p = _t3dMapWorld(mapX, mapY);
  const mat = new THREE.SpriteMaterial({ map: _t3dDust(), color: o.color || 0xeef4fb, transparent: true, opacity: 0, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.position.set(p.x, h * p.s, p.z);
  sp.renderOrder = 8;
  sp.visible = false;
  _t3dScene.add(sp);
  _t3dSteams.push({ sp, born: performance.now() + delay, life: o.life || 1400, vy: (o.vy ?? 60) * p.s, vx: (o.vx || 0) * p.s,
                    size0: (o.size0 || 30) * p.s, size1: (o.size1 || 110) * p.s, op: o.op || 0.6, g: (o.g || 0) * p.s });
}

function _t3dSteamStep(now) {
  if (!_t3dSteams.length) return false;
  _t3dSteams = _t3dSteams.filter(s => {
    const age = now - s.born;
    if (age > s.life) { _t3dScene.remove(s.sp); s.sp.material.dispose(); return false; }
    if (age < 0) return true;
    s.sp.visible = true;
    const k = age / s.life;
    s.sp.position.y += (s.vy - s.g * age / 1000) * 0.016;
    s.sp.position.x += s.vx * 0.016;
    s.sp.scale.setScalar(s.size0 + (s.size1 - s.size0) * Math.sqrt(k));
    s.sp.material.opacity = s.op * Math.min(1, age / 160) * (1 - k);
    return true;
  });
  return true;
}

/**
 * 물에 불이 꺼진다 — 그 불(tag)의 불길 · 열기 · 잉걸 · 불빛이 사그라지고, 칸마다 흰 김이 피어오른다.
 * @param {string} tag  board.js가 불을 붙일 때 준 표시 (towers3dFireField · TowerBurn · HeatHaze의 o.tag)
 * @param {Array<{x,y}>} tiles 김이 오를 칸 가운데 (맵 좌표)
 */
function towers3dFireDouse(tag, tiles) {
  if (!_t3dScene || !_t3dCamera || !tag) return false;
  _t3dFireStepEnsure();
  const now = performance.now();
  _t3dFires.forEach(f => { if (f.tag === tag) f.end = Math.min(f.end, now + 220 + Math.random() * 260); });
  _t3dHazes.forEach(h => { if (h.tag === tag) h.end = Math.min(h.end, now + 600); });
  _t3dSparks.forEach(s => { if (s.tag === tag && s.born > now) s.life = -1; });   // 아직 안 오른 잉걸은 오르지 않는다
  _t3dFireLights.forEach(l => { if (l.tag === tag && l.until > now + 300) l.until = now + 300; });
  (tiles || []).forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      _t3dSteamPuff(t.x + (Math.random() - 0.5) * 70, t.y + (Math.random() - 0.5) * 60, 8 + Math.random() * 18,
                    i * 35 + k * 110 + Math.random() * 80,
                    { life: 1200 + Math.random() * 700, vy: 55 + Math.random() * 45, size0: 26, size1: 110 + Math.random() * 70, op: 0.5 });
    }
  });
  _t3dDirty = true;
  return true;
}

// ── 토템이 날아가고 · 타 버린다 ──────────────────────────────
let _t3dTotemGone = [];   // { group, born, ms, step(now, age) }

/** 서 있는 토템을 목록에서 꺼낸다 (스스로 자라고 숨쉬는 움직임을 멈추고 이쪽 연출에 넘긴다) */
function _t3dTakeTotem(mapX, mapY) {
  const i = _t3dTotems.findIndex(t => Math.abs(t.mapX - mapX) < 2 && Math.abs(t.mapY - mapY) < 2);
  if (i < 0) return null;
  const t = _t3dTotems.splice(i, 1)[0];
  const seen = new Set();
  t.group.traverse(o => {
    if (!o.material || seen.has(o.material)) return;
    seen.add(o.material);
    o.material.transparent = true;
  });
  t.mats = [...seen];
  return t;
}

function _t3dTotemGoneStep(now) {
  if (!_t3dTotemGone.length) return false;
  _t3dTotemGone = _t3dTotemGone.filter(x => {
    const age = now - x.born;
    if (age >= x.ms) {
      _t3dFxScene.remove(x.group);
      (x.extra || []).forEach(m => { _t3dFxScene.remove(m); m.geometry.dispose(); m.material.dispose(); });
      x.mats.forEach(m => m.dispose());
      return false;
    }
    x.step(now, age);
    return true;
  });
  return true;
}

function _t3dTotemGoneEnsure() {
  if (_t3dTotemGone._on) return;
  _t3dTotemGone._on = true;
  towers3dAddStep(_t3dTotemGoneStep);
}

/**
 * 토네이도에 토템이 쓰러진다 — 바람을 맞아 몇 번 휘청이다가, 밑동을 축으로 바람 방향(화면 기준 dir)으로
 * 넘어가 땅에 쿵 부딪혀 한 번 튀고 누운 채 흐려진다. 잎 · 꽃잎은 바람에 흩날린다.
 * (예전엔 뿌리째 뽑혀 날아갔다 — 나무가 통째로 하늘로 솟는 게 어색했다)
 */
function towers3dBlowTotem(mapX, mapY, dir = 1) {
  if (!_t3dFxScene) return false;
  const t = _t3dTakeTotem(mapX, mapY);
  if (!t) return false;
  _t3dTotemGoneEnsure();
  const g = t.group, s = t.base;
  g.scale.setScalar(s);
  g.position.y = 0;
  const x0 = g.position.x, z0 = g.position.z;
  const q0 = g.quaternion.clone();
  // 화면의 오른쪽 = 카메라의 오른쪽을 바닥에 눕힌 방향 → 바람이 부는 쪽
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_t3dCamera.quaternion);
  right.y = 0; right.normalize();
  const wind = right.clone().multiplyScalar(dir);
  // 위쪽을 바람 쪽으로 넘기는 축 = 위 × 바람
  const axis = new THREE.Vector3(0, 1, 0).cross(wind).normalize();
  const qa = new THREE.Quaternion();
  const MS = 1600, SWAY = 0.26, FALL = 0.36;      // 휘청임 · 넘어가는 동안 (비율)
  const LIE = Math.PI / 2 - 0.08;                  // 누운 각 — 잎이 땅에 받쳐 살짝 들린다
  _t3dTotemGone.push({ group: g, mats: t.mats, born: performance.now(), ms: MS, step: (now, age) => {
    const k = age / MS;
    let ang;
    if (k < SWAY) {
      // 바람에 휘청인다 — 점점 크게 흔들리며 바람 쪽으로 기운다
      const u = k / SWAY;
      ang = 0.12 * u + Math.sin(u * Math.PI * 3) * 0.1 * u;
    } else if (k < SWAY + FALL) {
      // 넘어간다 — 처음엔 느리게, 갈수록 빠르게 (무게)
      const u = (k - SWAY) / FALL;
      ang = 0.12 + (LIE - 0.12) * u * u;
    } else {
      // 땅에 부딪혀 한 번 튄 뒤 눕는다
      const u = (k - SWAY - FALL) / (1 - SWAY - FALL);
      ang = LIE - Math.abs(Math.sin(Math.min(1, u * 3) * Math.PI)) * 0.14 * Math.max(0, 1 - u * 3);
    }
    qa.setFromAxisAngle(axis, ang);
    g.quaternion.copy(qa).multiply(q0);
    // 넘어가며 밑동이 바람 쪽으로 조금 끌린다
    const slide = 10 * s * Math.max(0, (k - SWAY) / (1 - SWAY));
    g.position.set(x0 + wind.x * slide, 0, z0 + wind.z * slide);
    const fade = 1 - Math.max(0, (k - 0.72) / 0.28);
    t.mats.forEach(m => { m.opacity = fade; });
    if (Math.abs(k - (SWAY + FALL)) < 0.02 && !g.userData.thud) {
      g.userData.thud = true;
      // 쿵 — 쓰러진 자리에 흙먼지
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        _t3dSteamPuff(mapX + dir * 60 + Math.cos(a) * 30, mapY + Math.sin(a) * 18, 4, i * 15,
                      { color: 0xbfae94, life: 700, vy: 14, vx: Math.cos(a) * 40, size0: 20, size1: 70, op: 0.45 });
      }
    }
  } });
  // 잎 · 꽃잎 — 바람을 타고 흩날린다
  const leaf = t.kind === 'whiteblossom' ? 0xf4f7ff : 0x7fd88e;
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    _t3dSpark(mapX + Math.cos(a) * 20, mapY + Math.sin(a) * 14, 40 + Math.random() * 60, {
      color: i % 3 ? leaf : 0xd8ffd0, delay: 80 + Math.random() * 700, life: 700 + Math.random() * 600,
      v: new THREE.Vector3(right.x * dir * (180 + Math.random() * 260) + Math.cos(a) * 60, 80 + Math.random() * 160,
                           right.z * dir * (180 + Math.random() * 260) + Math.sin(a) * 60), g: 60, size: 5 + Math.random() * 5 });
  }
  _t3dDirty = true;
  return true;
}

/** 맵 위 방향(ux, uy) → 월드 바닥의 단위 벡터 */
function _t3dMapDir(mapX, mapY, ux, uy) {
  const a = _t3dMapWorld(mapX, mapY), b = _t3dMapWorld(mapX + ux * 50, mapY + uy * 50);
  const v = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
  return v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector3(1, 0, 0);
}

/**
 * 톱에 토템이 갈려 버린다 (2026-10-03 상성) — 기둥이 아래쪽에서 잘려, 윗동(기둥 · 구슬 · 잎)이 톱이 민 쪽으로
 * 넘어가 땅에 떨어지고, 남은 그루터기도 흐려진다. 톱밥 · 잎 부스러기가 튄다.
 * @param {number} ux,uy 톱이 써는 방향 (맵) — 윗동은 그쪽으로 넘어간다
 * @param {number} CUT 잘리는 높이 (모형 단위) — 톱은 밑동(23), 듀얼 검은 위쪽(52)을 벤다
 */
function towers3dSawTotem(mapX, mapY, ux = 1, uy = 0, CUT = 23) {
  if (!_t3dFxScene) return false;
  const t = _t3dTakeTotem(mapX, mapY);
  if (!t) return false;
  _t3dTotemGoneEnsure();
  const g = t.group, s = t.base;
  g.scale.setScalar(s);
  g.position.y = 0;
  const top = new THREE.Group();
  top.position.set(0, CUT, 0);
  [...g.children].forEach(m => { if (m.position.y > CUT) { m.position.y -= CUT; top.add(m); } });
  g.add(top);
  // 넘어가는 축 — 그룹 안 좌표로 (그룹은 돌아 있고 크기가 있다)
  const fall = _t3dMapDir(mapX, mapY, ux, uy);
  const axisW = new THREE.Vector3(0, 1, 0).cross(fall).normalize();
  const axis = axisW.applyQuaternion(g.quaternion.clone().invert());
  const slideL = fall.clone().applyQuaternion(g.quaternion.clone().invert());
  const qa = new THREE.Quaternion();
  const MS = 1500;
  _t3dTotemGone.push({ group: g, mats: t.mats, born: performance.now(), ms: MS, step: (now, age) => {
    const k = age / MS;
    const u = Math.max(0, (k - 0.08) / 0.5);          // 잠깐 버티다 넘어간다
    const ang = Math.min(1, u) ** 2 * 1.75;
    qa.setFromAxisAngle(axis, ang);
    top.quaternion.copy(qa);
    // 잘린 자리에서 미끄러져 떨어진다
    top.position.set(slideL.x * 14 * Math.min(1, u), CUT * (1 - Math.min(1, u) ** 2 * 0.85), slideL.z * 14 * Math.min(1, u));
    const fade = 1 - Math.max(0, (k - 0.7) / 0.3);
    t.mats.forEach(m => { m.opacity = fade; });
  } });
  // 톱밥 · 잎 부스러기
  const leaf = t.kind === 'whiteblossom' ? 0xf4f7ff : 0x7fd88e;
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    _t3dSpark(mapX + Math.cos(a) * 14, mapY + Math.sin(a) * 10, i % 2 ? 30 : 70 + Math.random() * 40, {
      color: i % 2 ? 0xd9b77a : (i % 3 ? leaf : 0xc8f0b0), delay: Math.random() * 300, life: 600 + Math.random() * 500,
      v: new THREE.Vector3(Math.cos(a) * 140 + fall.x * 120, 120 + Math.random() * 160, Math.sin(a) * 100 + fall.z * 120),
      g: 520, size: 4 + Math.random() * 5 });
  }
  _t3dDirty = true;
  return true;
}

/**
 * 가시에 토템이 산산조각 난다 (2026-10-03 상성) — 발밑에서 솟은 가시에 꿰뚫려 토막 · 구슬 · 잎이
 * 사방으로 튀어 오르며 돌다 떨어지고, 나무 파편 · 잎이 흩어진다.
 */
function towers3dShatterTotem(mapX, mapY) {
  if (!_t3dFxScene) return false;
  const t = _t3dTakeTotem(mapX, mapY);
  if (!t) return false;
  _t3dTotemGoneEnsure();
  const g = t.group, s = t.base;
  g.scale.setScalar(s);
  g.position.y = 0;
  const parts = g.children.map((m, k) => {
    const a = k * 2.39996 + 0.3;
    const out = 90 + (k % 4) * 30 + m.position.y * 0.6;
    return { m, x0: m.position.x, y0: m.position.y, z0: m.position.z,
             vx: Math.cos(a) * out, vz: Math.sin(a) * out, vy: 180 + (k % 3) * 70 + m.position.y * 1.2,
             rx: (k % 2 ? 1 : -1) * (5 + k % 4 * 2), rz: (k % 3 - 1) * (4 + k % 5) };
  });
  const MS = 1200, G = 900;
  _t3dTotemGone.push({ group: g, mats: t.mats, born: performance.now(), ms: MS, step: (now, age) => {
    const tt = age / 1000;
    parts.forEach(p => {
      const y = Math.max(4, p.y0 + p.vy * tt - G * tt * tt / 2);
      p.m.position.set(p.x0 + p.vx * tt, y, p.z0 + p.vz * tt);
      p.m.rotation.x = p.rx * tt;
      p.m.rotation.z = p.rz * tt;
    });
    const fade = 1 - Math.max(0, (age / MS - 0.6) / 0.4);
    t.mats.forEach(m => { m.opacity = fade; });
  } });
  const leaf = t.kind === 'whiteblossom' ? 0xf4f7ff : 0x7fd88e;
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * Math.PI * 2, sp = 160 + Math.random() * 240;
    _t3dSpark(mapX + Math.cos(a) * 10, mapY + Math.sin(a) * 8, 20 + Math.random() * 80, {
      color: i % 3 === 0 ? leaf : i % 3 === 1 ? 0xa8743e : 0xe8d8b0, delay: Math.random() * 120, life: 500 + Math.random() * 500,
      v: new THREE.Vector3(Math.cos(a) * sp, 160 + Math.random() * 260, Math.sin(a) * sp * 0.7), g: 760, size: 4 + Math.random() * 6 });
  }
  _t3dDirty = true;
  return true;
}

/**
 * 불덩이 · 폭염에 토템이 타 버린다 — 불이 붙어 활활 타오르는 동안 까맣게 그을고(구슬 빛이 꺼진다),
 * 다 타면 재로 주저앉으며 흩어진다. 잉걸이 오르고 주황 불빛이 둘레를 비춘다.
 */
function towers3dBurnTotem(mapX, mapY) {
  if (!_t3dFxScene) return false;
  const t = _t3dTakeTotem(mapX, mapY);
  if (!t) return false;
  _t3dTotemGoneEnsure();
  const g = t.group, s = t.base;
  g.scale.setScalar(s);
  g.position.y = 0;
  const char = new THREE.Color(0x1d1612), ember = new THREE.Color(0xff6a1a);
  const orig = t.mats.map(m => ({ m, c: m.color ? m.color.clone() : null, e: m.emissive ? m.emissive.clone() : null, ei: m.emissiveIntensity }));
  // 불길 — 토템을 감싸는 불꽃 판 넷 (앞 씬이라 토템과 함께 맨 앞에 보인다)
  const flames = [];
  for (let k = 0; k < 4; k++) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const m = new THREE.Mesh(geo, _t3dFireMaterial());
    const a = k / 4 * Math.PI * 2 + 0.4;
    m.position.set(g.position.x + Math.cos(a) * 14 * s, (6 + k * 10) * s, g.position.z + Math.sin(a) * 14 * s);
    m.quaternion.copy(_t3dCamera.quaternion);
    m.renderOrder = 9;
    m.userData.w = (44 + Math.random() * 20) * s;
    m.userData.h = (80 + Math.random() * 40) * s;
    m.userData.seed = Math.random();
    _t3dFxScene.add(m);
    flames.push(m);
  }
  const MS = 1750;
  _t3dTotemGone.push({ group: g, mats: t.mats, extra: flames, born: performance.now(), ms: MS, step: (now, age) => {
    const k = age / MS, sec = now / 1000;
    const burn = Math.min(1, age / 950);                       // 그을림
    const fall = Math.max(0, (age - 950) / (MS - 950));        // 주저앉음
    orig.forEach(o => {
      if (o.c) o.m.color.copy(o.c).lerp(char, burn);
      if (o.e) { o.m.emissive.copy(ember); o.m.emissiveIntensity = 0.55 * Math.sin(Math.min(1, burn * 1.3) * Math.PI) * (1 - fall); }
      o.m.opacity = 1 - Math.max(0, (fall - 0.4) / 0.6);
    });
    if (g.userData.orb) g.userData.orb.scale.setScalar(Math.max(0.01, 1 - burn));
    g.scale.set(s * (1 + 0.15 * fall), s * Math.max(0.12, 1 - 0.88 * fall * fall), s * (1 + 0.15 * fall));
    g.rotation.z = Math.sin(age / 70) * 0.03 * (1 - fall);
    flames.forEach((m, i) => {
      const life = Math.min(1, age / 200) * Math.max(0, 1 - Math.max(0, (age - 1200) / 500));
      const fl = 0.8 + 0.2 * Math.sin(sec * 17 + i * 3) * Math.sin(sec * 7 + i);
      m.material.uniforms.uTime.value = sec;
      m.material.uniforms.uLife.value = life * fl;
      m.material.uniforms.uHot.value = 0.35 * (1 - burn);
      m.scale.set(m.userData.w * (0.85 + 0.15 * fl), m.userData.h * (0.5 + 0.5 * Math.min(1, age / 300)) * (1 - 0.5 * fall), 1);
    });
  } });
  for (let i = 0; i < 22; i++) {
    _t3dSpark(mapX + (Math.random() - 0.5) * 40, mapY + (Math.random() - 0.5) * 30, 20 + Math.random() * 70, {
      color: Math.random() < 0.5 ? 0xffa040 : 0xff6a20, delay: Math.random() * 1300, life: 700 + Math.random() * 600,
      v: new THREE.Vector3((Math.random() - 0.5) * 40, 70 + Math.random() * 90, (Math.random() - 0.5) * 20), g: -10, size: 6 + Math.random() * 6 });
  }
  for (let i = 0; i < 6; i++) {
    _t3dSteamPuff(mapX + (Math.random() - 0.5) * 30, mapY, 70 + Math.random() * 30, 300 + i * 180,
                  { color: 0x2e2622, life: 1400, vy: 50, size0: 30, size1: 120, op: 0.45 });
  }
  _t3dFireLightAt(mapX, mapY, 1500, 1.5);
  _t3dFireStepEnsure();
  _t3dDirty = true;
  return true;
}

/** 시든 모습 (w: 0~1) — 잎은 누렇게, 흰 꽃잎은 바랜 갈색, 구슬과 나무는 흐려진다 */
function _t3dTotemWitherLook(t, w) {
  const u = t.group.userData;
  if (!t.wOrig) t.wOrig = { leaf: u.leaf.color.clone(), le: u.leaf.emissiveIntensity, glow: u.glow.color.clone(), wood: u.wood.color.clone() };
  const o = t.wOrig;
  const dry = new THREE.Color(t.kind === 'whiteblossom' ? 0xb49a6c : 0x9a7a2c);
  u.leaf.color.copy(o.leaf).lerp(dry, w);
  u.leaf.emissiveIntensity = o.le * (1 - 0.85 * w);
  u.glow.color.copy(o.glow).lerp(new THREE.Color(0x6b5a40), 0.7 * w);
  u.wood.color.copy(o.wood).lerp(new THREE.Color(0x4a3420), 0.5 * w);
  t.wkShown = w > 0;
}

/** 더위 속 토템 — on이면 시들고, 열기가 식으면 돌아온다 (회복 25% 감소는 effects.js가 데이터로 센다) */
function towers3dTotemWither(mapX, mapY, on) {
  const t = _t3dTotems.find(x => Math.abs(x.mapX - mapX) < 2 && Math.abs(x.mapY - mapY) < 2);
  if (!t) return false;
  if (!!t.wither !== !!on) {
    t.wither = !!on;
    if (on) {
      // 시드는 순간 — 마른 잎이 몇 장 떨어진다
      for (let i = 0; i < 8; i++) {
        _t3dSpark(mapX + (Math.random() - 0.5) * 40, mapY + (Math.random() - 0.5) * 30, 90 + Math.random() * 20, {
          color: 0xc9a050, delay: Math.random() * 600, life: 900 + Math.random() * 500,
          v: new THREE.Vector3((Math.random() - 0.5) * 40, -10, (Math.random() - 0.5) * 30), g: 40, size: 4 + Math.random() * 3 });
      }
      _t3dFireStepEnsure();
    }
    _t3dDirty = true;
  }
  return true;
}

// ── 얼음 ────────────────────────────────────────────────────
let _t3dIceTex = null;
let _t3dIces = [];        // 타워 얼음 { el, t, group, mats, plane, H, born, end, level, from, to, at, dur, mode, nextDrip }
let _t3dIceFields = [];   // 바닥 얼음 결정 { meshes, born, grow, end, mats }

/** 얼음 무늬 — 옅은 하늘빛에 흰 결과 금 (캔버스로 그린다) */
function _t3dIceTexture() {
  if (_t3dIceTex) return _t3dIceTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#eaf7ff'); gr.addColorStop(0.5, '#bfe4fb'); gr.addColorStop(1, '#9fd2f2');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 128);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // 흰 결 — 비스듬히 흐르는 얼음 결
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.25 + rnd() * 0.4})`;
    g.lineWidth = 1 + rnd() * 2.5;
    const x = rnd() * 64, y = rnd() * 128;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.3) * 30, y + 20 + rnd() * 40); g.stroke();
  }
  // 금 — 가는 진한 선
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = 'rgba(70,120,170,0.35)';
    g.lineWidth = 0.8;
    let x = rnd() * 64, y = rnd() * 128;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 18; y += rnd() * 16; g.lineTo(x, y); }
    g.stroke();
  }
  _t3dIceTex = new THREE.CanvasTexture(c);
  _t3dIceTex.wrapS = _t3dIceTex.wrapT = THREE.RepeatWrapping;
  return _t3dIceTex;
}

function _t3dIceMat(opacity, plane) {
  const m = new THREE.MeshPhongMaterial({
    map: _t3dIceTexture(), color: 0xd4efff, emissive: 0x1f5b8a, emissiveIntensity: 0.32,
    specular: 0xffffff, shininess: 120, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  });
  if (plane) { m.clippingPlanes = [plane]; m.clipShadows = false; }
  return m;
}

/**
 * 타워가 얼어붙는다 — 밑동부터 꼭대기까지 얼음이 차오른다 (반투명 얼음 껍질 · 밑동의 얼음 결정 · 처마 끝 고드름 · 머리의 얼음 덮개).
 * @param {object} o ago 얼기 시작한 지 지난 ms (늦게 들어온 화면은 그만큼 차 있다) · ms 남은 동결 · melt 0|1
 * @returns {boolean} 3D로 그렸으면 true
 */
function towers3dIce(el, o) {
  const t = _t3dTowers.find(x => x.el === el);
  if (!t || !_t3dScene || !_t3dRenderer || !t.group.visible) return false;
  _t3dFireStepEnsure();
  _t3dIces.filter(x => x.el === el).forEach(x => _t3dIceDispose(x));
  _t3dIces = _t3dIces.filter(x => x.el !== el);
  _t3dRenderer.localClippingEnabled = true;
  const ud = t.group.userData;
  const W = ud.width || 56, H = (ud.hud || 120) + 10;
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const shell = _t3dIceMat(0.5, plane), solid = _t3dIceMat(0.78, plane);
  const g = new THREE.Group();
  let seed = (el.id.length * 131 + W) | 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // 껍질 — 몸통을 감싸는 얼음. 층마다 조금씩 비틀어 울퉁불퉁하게
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const h = H / layers;
    const w = W + 12 + rnd() * 6 - i * 1.2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h + 1, w), shell);
    m.position.set((rnd() - 0.5) * 2, h * i + h / 2, (rnd() - 0.5) * 2);
    m.rotation.y = (rnd() - 0.5) * 0.12;
    m.material.map.repeat.set(1, 1);
    g.add(m);
  }
  // 머리 — 처마 위를 덮는 얼음 덮개
  const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 22, 8, W + 22), solid);
  cap.position.set(0, H - 2, 0);
  g.add(cap);
  // 밑동의 얼음 결정 — 바닥에서 비스듬히 솟은 육각 결정들
  const crystal = new THREE.CylinderGeometry(0, 1, 1, 6);
  crystal.translate(0, 0.5, 0);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + rnd() * 0.3;
    const R = W * 0.62 + rnd() * 8;
    const m = new THREE.Mesh(crystal, solid);
    const hh = 18 + rnd() * 34, rr = 4 + rnd() * 4;
    m.scale.set(rr, hh, rr);
    m.position.set(Math.sin(a) * R, -2, Math.cos(a) * R);
    m.rotation.set(Math.cos(a) * (0.25 + rnd() * 0.3), 0, -Math.sin(a) * (0.25 + rnd() * 0.3));
    g.add(m);
  }
  // 고드름 — 처마 끝에서 아래로
  const icicle = new THREE.CylinderGeometry(1, 0, 1, 5);
  icicle.translate(0, -0.5, 0);
  for (let i = 0; i < 16; i++) {
    const side = i % 4, f = (Math.floor(i / 4) + 0.5) / 4 - 0.5;
    const e = (W + 14) / 2;
    const x = side === 0 ? f * 2 * e : side === 1 ? e : side === 2 ? -f * 2 * e : -e;
    const z = side === 0 ? e : side === 1 ? f * 2 * e : side === 2 ? -e : -f * 2 * e;
    const m = new THREE.Mesh(icicle, solid);
    m.scale.set(2.2 + rnd() * 1.5, 10 + rnd() * 16, 2.2 + rnd() * 1.5);
    m.position.set(x, H - 6, z);
    g.add(m);
  }
  _t3dScene.add(g);
  const now = performance.now();
  const ice = { el, t, group: g, mats: [shell, solid], geos: [crystal, icicle], plane, H,
                born: now - (o.ago || 0), end: now + Math.max(0, o.ms || 0), mode: 'grow',
                level: 0, from: 0, to: 1, at: now - (o.ago || 0), dur: 900, nextDrip: 0 };
  _t3dIces.push(ice);
  if (o.melt) towers3dIceMelt(el, o.melt);
  // 얼어붙는 순간 — 찬 김이 발밑에서 퍼진다
  if ((o.ago || 0) < 400) {
    const c = Number(el.style.getPropertyValue('--col')), r = Number(el.style.getPropertyValue('--row'));
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      _t3dSteamPuff((c + 0.5) * 100 + Math.cos(a) * 36, (r + 0.5) * 100 + Math.sin(a) * 24, 6, i * 30,
                    { color: 0xdff2ff, life: 900, vy: 18, vx: Math.cos(a) * 30, size0: 24, size1: 80, op: 0.5 });
    }
  }
  _t3dDirty = true;
  return true;
}

/** 얼음이 더 오래 간다 (언 타워에 얼음전개를 또 썼다) — 차오른 얼음은 그대로, 남은 시간만 */
function towers3dIceExtend(el, ms) {
  const x = _t3dIces.find(i => i.el === el && (i.mode === 'grow' || i.mode === 'half'));
  if (!x) return false;
  x.end = performance.now() + Math.max(0, ms);
  // 다시 언다는 표시 — 얼음 위로 서리 빛이 반짝인다
  const c = Number(el.style.getPropertyValue('--col')), r = Number(el.style.getPropertyValue('--row'));
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    _t3dSpark((c + 0.5) * 100 + Math.cos(a) * 34, (r + 0.5) * 100 + Math.sin(a) * 22, Math.random() * x.H * x.level, {
      color: 0xeaf8ff, delay: i * 25, life: 700 + Math.random() * 400, v: new THREE.Vector3(0, 30, 0), g: 0, size: 5 + Math.random() * 5 });
  }
  _t3dDirty = true;
  return true;
}

/** 불에 녹는다 — 1: 반쯤 녹아 얼음이 절반으로 내려앉고 물이 흐른다 · 2: 다 녹아내린다 */
function towers3dIceMelt(el, level) {
  const x = _t3dIces.find(i => i.el === el && i.mode !== 'gone');
  if (!x) return false;
  if (level >= 2) return towers3dIceEnd(el, 'melt');
  const now = performance.now();
  x.from = x.level; x.to = 0.5; x.at = now; x.dur = 800;
  x.mode = 'half';
  x.dripUntil = now + 2600;
  return true;
}

/**
 * 얼음이 사라진다 — melt: 녹아내리며 물이 고였다 마른다 · shatter: 금이 가며 깨져 흩어진다
 * · smash: 땅·돌 카드에 맞아 산산조각 (쇄빙) — 큰 얼음 조각이 사방으로 튄다
 */
function towers3dIceEnd(el, how = 'shatter') {
  const x = _t3dIces.find(i => i.el === el && i.mode !== 'gone' && i.mode !== 'melt' && i.mode !== 'shatter');
  if (!x) return false;
  const now = performance.now();
  if (how === 'smash') {
    const c = Number(el.style.getPropertyValue('--col')), r = Number(el.style.getPropertyValue('--row'));
    const mx = (c + 0.5) * 100, my = (r + 0.5) * 100;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, sp = 220 + Math.random() * 260;
      _t3dSpark(mx + Math.cos(a) * 26, my + Math.sin(a) * 18, 10 + Math.random() * (x.H * x.level), {
        color: i % 3 ? 0xe6f7ff : 0x7fc8ff, delay: Math.random() * 40, life: 600 + Math.random() * 500,
        v: new THREE.Vector3(Math.cos(a) * sp, 200 + Math.random() * 260, Math.sin(a) * sp * 0.6), g: 900, size: 10 + Math.random() * 10 });
    }
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      _t3dSteamPuff(mx + Math.cos(a) * 30, my + Math.sin(a) * 20, 8, i * 20,
                    { color: 0xeaf6ff, life: 700, vy: 30, vx: Math.cos(a) * 60, size0: 30, size1: 110, op: 0.55 });
    }
    how = 'shatter';
  }
  x.mode = how;
  x.from = x.level; x.at = now; x.dur = how === 'melt' ? 900 : 380; x.to = how === 'melt' ? 0 : x.level;
  const c = Number(el.style.getPropertyValue('--col')), r = Number(el.style.getPropertyValue('--row'));
  const mx = (c + 0.5) * 100, my = (r + 0.5) * 100;
  if (how === 'melt') {
    for (let i = 0; i < 10; i++) {
      _t3dSteamPuff(mx + (Math.random() - 0.5) * 60, my + (Math.random() - 0.5) * 30, 20 + Math.random() * 80, i * 70,
                    { life: 1100, vy: 60, size0: 24, size1: 90, op: 0.45 });
    }
    x.dripUntil = now + 900;
  } else {
    // 깨진 조각 — 하얀 빛 알갱이가 사방으로 튀었다 떨어진다
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 200;
      _t3dSpark(mx + Math.cos(a) * 20, my + Math.sin(a) * 14, 20 + Math.random() * (x.H * x.level), {
        color: i % 2 ? 0xdff4ff : 0x9fd8ff, delay: Math.random() * 80, life: 500 + Math.random() * 400,
        v: new THREE.Vector3(Math.cos(a) * sp, 120 + Math.random() * 180, Math.sin(a) * sp * 0.6), g: 640, size: 6 + Math.random() * 6 });
    }
  }
  _t3dDirty = true;
  return true;
}

function _t3dIceDispose(x) {
  _t3dScene.remove(x.group);
  x.group.traverse(o => { if (o.geometry && !x.geos.includes(o.geometry)) o.geometry.dispose(); });
  x.geos.forEach(g => g.dispose());
  x.mats.forEach(m => m.dispose());
  x.mode = 'gone';
}

/**
 * 얼음전개 바닥 — 칸마다 얼음 결정 무리가 바닥에서 솟는다 (가운데에서 가장자리로 번지며). 동결이 끝나면 꺼져 사라진다.
 * @param {object} o tiles [{x,y}] · growMs 번지는 시간 · ms 전체 · seed
 */
function towers3dIceField(o) {
  if (!_t3dScene || !_t3dCamera) return false;
  _t3dFireStepEnsure();
  let seed = (o.seed >>> 0) || 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const mat = _t3dIceMat(0.72, null);
  const geo = new THREE.CylinderGeometry(0, 1, 1, 6);
  geo.translate(0, 0.5, 0);
  let cx = 0, cy = 0;
  o.tiles.forEach(t => { cx += t.x; cy += t.y; });
  cx /= o.tiles.length; cy /= o.tiles.length;
  const far = Math.max(1, ...o.tiles.map(t => Math.hypot(t.x - cx, t.y - cy)));
  const now = performance.now();
  const meshes = [];
  o.tiles.forEach(t => {
    const tower = _t3dTowerOnTile(t.x, t.y);
    const n = 3 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      let x = t.x + (rnd() - 0.5) * 80, y = t.y + (rnd() - 0.5) * 80;
      if (tower) { const a = rnd() * Math.PI * 2; x = t.x + Math.cos(a) * 48; y = t.y + Math.sin(a) * 40; }
      const p = _t3dMapWorld(x, y);
      const m = new THREE.Mesh(geo, mat);
      const h = (14 + rnd() * 30) * p.s, r = (4 + rnd() * 5) * p.s;
      m.position.set(p.x, 0, p.z);
      m.rotation.set((rnd() - 0.5) * 0.9, rnd() * Math.PI, (rnd() - 0.5) * 0.9);
      m.userData = { h, r, delay: Math.hypot(x - cx, y - cy) / far * o.growMs * 0.8 + rnd() * 120 };
      m.scale.set(r, 0.001, r);
      m.renderOrder = 4;
      _t3dScene.add(m);
      meshes.push(m);
    }
  });
  _t3dIceFields.push({ meshes, born: now, grow: o.growMs, end: now + o.ms, mats: [mat], geos: [geo] });
  // 서리 빛 알갱이 — 반짝이며 내려앉는다
  for (let i = 0; i < o.tiles.length * 3; i++) {
    const t = o.tiles[Math.floor(rnd() * o.tiles.length)];
    _t3dSpark(t.x + (rnd() - 0.5) * 90, t.y + (rnd() - 0.5) * 90, 40 + rnd() * 60, {
      color: 0xe8f6ff, delay: rnd() * o.growMs, life: 800 + rnd() * 500,
      v: new THREE.Vector3((rnd() - 0.5) * 20, -30, 0), g: 10, size: 4 + rnd() * 4 });
  }
  _t3dDirty = true;
  return true;
}

/** 매 프레임 — 얼음이 차오르고 · 반쯤 녹고 · 녹아내리거나 깨진다. 바닥 결정이 솟고 꺼진다 */
function _t3dIceStep(now) {
  let busy = false;
  _t3dIces = _t3dIces.filter(x => {
    if (x.mode === 'gone') return false;
    const t = x.t;
    if (!x.el.isConnected || t.el.classList.contains('destroyed') || t.fall) { _t3dIceDispose(x); return false; }
    busy = true;
    // 시간이 다 됐다 — 깨져 흩어진다
    if ((x.mode === 'grow' || x.mode === 'half') && now >= x.end) towers3dIceEnd(x.el, 'shatter');
    const k = Math.min(1, (now - x.at) / x.dur);
    const e = x.mode === 'grow' ? 1 - (1 - k) ** 2 : k * k * (3 - 2 * k);
    x.level = x.from + (x.to - x.from) * e;
    // 타워를 따라간다 (들썩임 · 가라앉음 · 흔들림)
    const g = x.group, tg = t.group, s = tg.userData.scale;
    g.position.copy(tg.position);
    g.rotation.set(0, tg.rotation.y, tg.rotation.z);
    g.scale.setScalar(s);
    x.plane.constant = tg.position.y + x.H * s * x.level + 0.5;
    let op = 1;
    if (x.mode === 'shatter') {
      g.scale.setScalar(s * (1 + 0.08 * k));
      op = 1 - k;
    } else if (x.mode === 'melt') {
      op = 1 - Math.max(0, (k - 0.6) / 0.4);
    }
    x.mats[0].opacity = 0.5 * op;
    x.mats[1].opacity = 0.78 * op;
    // 녹는 동안 물이 흘러내린다 — 반짝이는 물방울
    if (x.dripUntil > now && now > x.nextDrip) {
      x.nextDrip = now + 70;
      const c = Number(x.el.style.getPropertyValue('--col')), r = Number(x.el.style.getPropertyValue('--row'));
      const a = Math.random() * Math.PI * 2;
      _t3dSpark((c + 0.5) * 100 + Math.cos(a) * 30, (r + 0.5) * 100 + Math.sin(a) * 18, x.H * x.level * (0.4 + Math.random() * 0.6), {
        color: 0x8fd0ff, life: 500 + Math.random() * 300, v: new THREE.Vector3(0, -40, 0), g: 380, size: 3 + Math.random() * 3 });
    }
    if ((x.mode === 'melt' || x.mode === 'shatter') && k >= 1) { _t3dIceDispose(x); return false; }
    return true;
  });
  _t3dIceFields = _t3dIceFields.filter(f => {
    const age = now - f.born;
    if (now >= f.end + 600) {
      f.meshes.forEach(m => _t3dScene.remove(m));
      f.geos.forEach(g => g.dispose());
      f.mats.forEach(m => m.dispose());
      return false;
    }
    busy = true;
    const out = Math.max(0, (now - f.end) / 600);
    f.meshes.forEach(m => {
      const u = m.userData;
      const k = Math.min(1, Math.max(0, (age - u.delay) / 260));
      const grow = 1 - (1 - k) ** 3;
      m.scale.set(u.r, Math.max(0.001, u.h * grow * (1 - out)), u.r);
    });
    f.mats[0].opacity = 0.72 * (1 - out);
    return true;
  });
  return busy;
}
