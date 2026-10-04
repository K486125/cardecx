/* ════════════════════════════════════════════════════════════
   그림리퍼 3D (three.js)

   참고: 카드 그림(img/cards/grim_reaper.jpg · 원본 Grim_Reaper1.png)과 사용자가 준 실루엣.
     · 깊은 두건 속 해골 — 찡그린 눈썹뼈, 비스듬한 눈구멍, 그 안에서 빛나는 보랏빛 눈
     · 끝이 갈기갈기 찢어진 검은 로브 — 누더기 조각이 끝단·소매에서 휘날린다
     · 보랏빛 기운 — 발밑에서 연기가 피어오르고 불티가 오른다
     · 크게 휜 낫 — 날 바깥 테가 보랏빛으로 빛나고, 자루에 룬 고리가 감겨 있다
     · 자세 — 땅에서 조금 떠서 앞으로 기울고, 낫을 몸 앞에 대각선으로 든다 (날은 왼쪽 위)

   파일 없이 도형으로 짜 맞춘다 (타워처럼). 같은 모델을 두 곳에서 쓴다:
     · 필드 유닛 — towers3d.js의 씬에 서서 걷고 낫을 휘두른다 (js/units.js)
     · 컷씬     — 화면 전체를 덮는 따로 된 씬 (아래 reaperCutscene)

   모델 크기: 키 약 2.0 (발끝 y=0 ~ 두건 끝), 앞 = +z. 부르는 쪽이 배율을 곱한다.
════════════════════════════════════════════════════════════ */

const REAPER_ROBE  = 0x100e16;
const REAPER_RIM   = 0x8a6cd6;
const REAPER_GLOW  = 0x9d6bff;

/** 시드 고정 난수 — 모든 화면에서 같은 모양 (units.js의 분열 칸 섞기도 이것을 쓴다) */
function _rpRand(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// ── 공용 텍스처 (한 번만 만들고 모든 리퍼가 같이 쓴다 — 지우지 않는다) ─────────
const _rpTex = {};
function _rpCanvasTex(key, size, draw) {
  if (_rpTex[key]) return _rpTex[key];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex._rpShared = true;   // r128 텍스처에는 userData가 없다
  return (_rpTex[key] = tex);
}
/** 부드러운 빛 한 점 */
function _rpGlowTex() {
  return _rpCanvasTex('glow', 64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
}
/** 뭉게뭉게한 연기 한 덩이 */
function _rpSmokeTex() {
  return _rpCanvasTex('smoke', 128, (g, s) => {
    const rand = _rpRand(77);
    for (let i = 0; i < 9; i++) {
      const x = s * (0.3 + rand() * 0.4), y = s * (0.3 + rand() * 0.4), rr = s * (0.18 + rand() * 0.2);
      const r = g.createRadialGradient(x, y, 0, x, y, rr);
      r.addColorStop(0, 'rgba(255,255,255,0.5)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    }
  });
}
/** 떠도는 해골 영혼 (카드 그림 배경의 해골들) */
function _rpSkullTex() {
  return _rpCanvasTex('skull', 128, (g) => {
    g.shadowColor = '#fff';
    g.shadowBlur = 14;
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(64, 54, 36, 38, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(40, 72); g.lineTo(88, 72); g.lineTo(82, 104); g.lineTo(46, 104); g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'destination-out';
    [[48, 58, -0.4], [80, 58, 0.4]].forEach(([x, y, rot]) => { g.beginPath(); g.ellipse(x, y, 12, 9, rot, 0, Math.PI * 2); g.fill(); });
    g.beginPath(); g.moveTo(64, 70); g.lineTo(58, 82); g.lineTo(70, 82); g.closePath(); g.fill();
    for (let i = 0; i < 5; i++) g.fillRect(49 + i * 7, 90, 2, 12);
  });
}

/**
 * 검은 천 — 정면은 거의 까맣고, 비스듬히 보이는 가장자리만 보랏빛으로 빛난다 (프레넬).
 * grad: 아래로 갈수록 보랏빛이 도는 그러데이션 (로브 끝단이 기운에 물든 것처럼)
 * 컷씬에서 포탈 면으로 잘라야 해서 자르기(clipping) 조각을 넣었다.
 * (뒷면만 그리는 확대 껍데기는 열린 천 안쪽이 넓은 보라색 면으로 비쳐서 버렸다)
 */
function _rpCloth(color = REAPER_ROBE, rim = REAPER_RIM, rimStr = 1.0, rimPow = 2.3, grad = 0) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uRim: { value: new THREE.Color(rim) },
      uRimStr: { value: rimStr }, uRimPow: { value: rimPow }, uOpacity: { value: 1 }, uGrad: { value: grad },
    },
    vertexShader: `
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying float vY;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mvPosition.xyz);
        vY = position.y;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform vec3 uRim; uniform float uRimStr; uniform float uRimPow; uniform float uOpacity; uniform float uGrad;
      varying vec3 vN; varying vec3 vV; varying float vY;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float ndv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
        float rim = pow(1.0 - ndv, uRimPow) * uRimStr;
        float light = 0.5 + 0.6 * clamp(dot(n, normalize(vec3(-0.35, 0.8, 0.55))), 0.0, 1.0);
        vec3 base = uColor * light;
        base += vec3(0.16, 0.06, 0.3) * uGrad * (1.0 - smoothstep(0.0, 0.7, vY));
        gl_FragColor = vec4(base + uRim * rim, uOpacity);
      }`,
  });
}

function _rpBoneMat() { return new THREE.MeshPhongMaterial({ color: 0xd6cdb9, shininess: 10, specular: 0x1c1c1c }); }
function _rpGlowMat(color, opacity = 0.9) {
  return new THREE.SpriteMaterial({ map: _rpGlowTex(), color, transparent: true, opacity,
                                     blending: THREE.AdditiveBlending, depthWrite: false });
}

/** 누더기 한 조각 — 위가 넓고 아래로 가늘어지며 끝이 들쭉날쭉 */
function _rpTatter(len, w, rand, mat = null) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w * (0.25 + rand() * 0.2), -len * (0.55 + rand() * 0.2));
  s.lineTo(w * 0.05, -len);
  s.lineTo(-w * (0.15 + rand() * 0.2), -len * (0.7 + rand() * 0.15));
  s.lineTo(-w * 0.3, -len * 0.35);
  s.closePath();
  return new THREE.Mesh(new THREE.ShapeGeometry(s), mat || _rpCloth(REAPER_ROBE, REAPER_RIM, 1.1, 1.8, 0));
}

/** 로브 — 가슴에서 끝단으로 종처럼 퍼지고, 끝단은 깊게 찢어져 있다 */
function _rpRobe(rand) {
  const prof = [[0.001, 1.5], [0.15, 1.49], [0.23, 1.42], [0.25, 1.26], [0.27, 1.02], [0.32, 0.74], [0.4, 0.42], [0.5, 0.16], [0.56, 0.04]];
  const SEG = 56;
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), SEG);
  const pos = geo.attributes.position;
  const teeth = [];
  for (let i = 0; i <= SEG; i++) teeth.push(rand());
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.2) continue;
    const x = pos.getX(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = Math.round(((a + Math.PI) / (Math.PI * 2)) * SEG) % (SEG + 1);
    const low = y < 0.1;
    const tooth = k % 2 === 0 ? teeth[k] * 0.32 + 0.05 : 0;          // 깊게 찢긴 틈
    const flare = 1 + (k % 2 ? 0.1 + teeth[k] * 0.14 : 0);            // 뾰족한 끝은 밖으로
    pos.setXYZ(i, x * (low ? flare : 1), y + (low ? tooth : tooth * 0.4), z * (low ? flare : 1));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, _rpCloth(REAPER_ROBE, REAPER_RIM, 1.0, 2.3, 1));
}

/** 두건 — 목에서 부풀어 올라 위로 뾰족해지고, 꼭대기가 뒤로 휘어 넘어간다. 앞은 세로로 트여 있다 */
function _rpHood(mat = _rpCloth(REAPER_ROBE, REAPER_RIM, 1.15, 2.0), innerColor = 0x030206) {
  const g = new THREE.Group();
  const prof = [[0.2, -0.22], [0.236, -0.09], [0.245, 0.04], [0.222, 0.15], [0.17, 0.25], [0.11, 0.33], [0.05, 0.4], [0.002, 0.45]];
  // LatheGeometry의 phi 0 = +z(앞) — 앞쪽 ±0.6rad를 비워 얼굴 트임을 만든다
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 36, 0.6, Math.PI * 2 - 1.2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y > 0.1) z -= Math.pow(y - 0.1, 1.6) * 1.1;                      // 꼭대기가 뒤로 휘어 넘어간다
    if (y > 0.05 && y < 0.3 && z > 0.05) z += 0.06 * (1 - Math.abs(y - 0.17) / 0.13);   // 이마 위로 늘어진 차양
    pos.setXYZ(i, x, y, z * 1.08);
  }
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, mat));
  // 두건 안쪽 그늘 — 얼굴 뒤를 까맣게 막는다
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: innerColor }));
  inner.position.z = -0.045;
  g.add(inner);
  return g;
}

/** 해골 — 찡그린 눈썹뼈, 비스듬히 치켜 올라간 눈구멍, 이를 드러낸 턱 */
function _rpSkull() {
  const g = new THREE.Group();
  const bone = _rpBoneMat();
  const dark = new THREE.MeshBasicMaterial({ color: 0x07060a });
  const cran = new THREE.Mesh(new THREE.SphereGeometry(0.12, 26, 20), bone);
  cran.scale.set(0.86, 1.03, 0.95);
  g.add(cran);
  // 광대 — 양옆이 튀어나와 얼굴이 각져 보인다
  [-1, 1].forEach(s => {
    const ck = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), bone);
    ck.scale.set(1.2, 0.55, 0.8);
    ck.position.set(s * 0.056, -0.044, 0.066);
    g.add(ck);
  });
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.066, 18, 12), bone);
  muzzle.scale.set(0.78, 0.74, 0.8);
  muzzle.position.set(0, -0.078, 0.038);
  g.add(muzzle);
  // 눈썹뼈 — 가운데로 내려앉은 V자 (화난 얼굴)
  [-1, 1].forEach(s => {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.016, 0.04), bone);
    brow.position.set(s * 0.043, 0.034, 0.094);
    brow.rotation.z = s * 0.4;
    g.add(brow);
  });
  // 눈구멍 · 눈빛
  const eyes = [], glows = [];
  [-1, 1].forEach(s => {
    const sock = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), dark);
    sock.scale.set(1.25, 0.78, 0.7);
    sock.rotation.z = s * 0.42;
    sock.position.set(s * 0.043, 0.004, 0.094);
    g.add(sock);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xd9c4ff, transparent: true, opacity: 0 }));
    eye.position.set(s * 0.043, 0.002, 0.112);
    g.add(eye);
    eyes.push(eye);
    const glow = new THREE.Sprite(_rpGlowMat(0x8b4dff, 0));
    glow.position.copy(eye.position).add(new THREE.Vector3(0, 0, 0.01));
    glow.scale.setScalar(0.09);
    g.add(glow);
    glows.push(glow);
  });
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.042, 3), dark);
  nose.position.set(0, -0.045, 0.114);
  nose.rotation.x = Math.PI;
  g.add(nose);
  // 윗니 · 턱(아랫니) — 턱은 움직인다
  for (let i = -2; i <= 2; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.018, 0.01), bone);
    t.position.set(i * 0.014, -0.1, 0.096 - Math.abs(i) * 0.005);
    g.add(t);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.118, 0.03);
  const jb = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.022, 0.075), bone);
  jb.position.set(0, -0.012, 0.02);
  jaw.add(jb);
  for (let i = -2; i <= 2; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.016, 0.009), bone);
    t.position.set(i * 0.013, 0.01, 0.058 - Math.abs(i) * 0.005);
    jaw.add(t);
  }
  g.add(jaw);
  g.userData = { eyes, glows, jaw };
  return g;
}

/** 뼈 손 — 손바닥과 마디진 손가락 (curl 1이면 쥔 손, 0이면 편 갈퀴 손) */
function _rpHand(curl) {
  const g = new THREE.Group();
  const bone = _rpBoneMat();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.028), bone));
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set(-0.027 + i * 0.018, -0.035, 0);
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.006, 0.05, 6), bone);
    a.position.y = -0.025;
    f.add(a);
    const b = new THREE.Group();
    b.position.y = -0.05;
    const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0025, 0.048, 6), bone);
    bm.position.y = -0.024;
    b.add(bm);
    b.rotation.x = curl * 1.5 + 0.35;      // 끝마디는 늘 조금 굽은 갈퀴
    f.add(b);
    f.rotation.x = curl * 1.2;
    f.rotation.z = (i - 1.5) * 0.08;
    g.add(f);
  }
  const th = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.004, 0.055, 6), bone);
  th.position.set(0.045, -0.015, 0.012);
  th.rotation.z = 0.8;
  g.add(th);
  return g;
}

/** 소매 — 팔꿈치 아래로 넓게 늘어지고 끝이 찢어져 있다 */
function _rpSleeve(rand, mat = null) {
  const pts = [[0.05, 0], [0.062, -0.12], [0.08, -0.26], [0.115, -0.38]].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 16);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > -0.37) continue;
    pos.setY(i, pos.getY(i) - (i % 2 ? rand() * 0.1 : 0));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat || _rpCloth(REAPER_ROBE, REAPER_RIM, 1.0, 2.2));
}

/** 낫 — 옹이 진 긴 자루(룬 고리) + 크게 휜 날 (바깥 테가 보랏빛으로 빛난다) */
function _rpScythe(rand) {
  const g = new THREE.Group();
  const wood = _rpCloth(0x241a15, 0xb08a70, 0.8, 2.0);
  // 자루 — 쥔 손이 원점, 위로 1.2 · 아래로 1.05
  const pts = [];
  for (let i = 0; i <= 9; i++) {
    const y = -1.05 + i * 0.25;
    pts.push(new THREE.Vector3((rand() - 0.5) * 0.04, y, (rand() - 0.5) * 0.02));
  }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.026, 8, false), wood));
  [0.32, -0.38].forEach(y => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), wood);
    k.position.set(0.004, y, 0);
    k.scale.set(1, 0.7, 1);
    g.add(k);
  });
  // 룬 고리 — 자루에 감긴 보랏빛 띠
  const rune = new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
  [0.62, 0.05, -0.6].forEach(y => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.006, 6, 18), rune);
    r.position.y = y;
    r.rotation.x = Math.PI / 2;
    g.add(r);
  });

  // 날 — 바깥 호와 안쪽 호로 초승달. 자루 끝(0, 1.18)에서 왼쪽(-x)으로 크게 휘어 내려간다
  const s = new THREE.Shape();
  const N = 32, R = 0.8, TOP = 1.18;
  const outer = [], inner = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = Math.PI * 0.04 + t * Math.PI * 0.66;
    outer.push([-Math.sin(a) * R * 1.04 + 0.02, Math.cos(a) * R * 0.6 - 0.5]);
    const w = 0.15 * (1 - t) ** 0.8 + 0.006;
    inner.push([-Math.sin(a) * (R - w) * 1.04 + 0.02, Math.cos(a) * (R - w) * 0.6 - 0.5 - w * 0.45]);
  }
  s.moveTo(outer[0][0], outer[0][1]);
  outer.forEach(([x, y]) => s.lineTo(x, y));
  for (let i = inner.length - 1; i >= 0; i--) s.lineTo(inner[i][0], inner[i][1]);
  s.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 1 });
  bladeGeo.translate(0, 0, -0.013);
  const steel = new THREE.MeshPhongMaterial({ color: 0x24242e, specular: 0xc8b8ff, shininess: 110 });
  const blade = new THREE.Mesh(bladeGeo, steel);
  blade.position.y = TOP;
  g.add(blade);
  // 날 바깥 테 — 은빛 심 + 보랏빛 번짐
  const edgeCurve = new THREE.CatmullRomCurve3(outer.map(([x, y]) => new THREE.Vector3(x, y + TOP, 0.004)));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, 48, 0.008, 5, false), new THREE.MeshBasicMaterial({ color: 0xf1ebff })));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, 48, 0.026, 6, false), new THREE.MeshBasicMaterial({
    color: 0x7b4dff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })));
  // 흘러내린 자국 — 날 안쪽에 가는 고드름
  for (let i = 3; i < N - 3; i += 3) {
    const [x, y] = inner[i];
    const len = 0.04 + rand() * 0.1;
    const d = new THREE.Mesh(new THREE.ConeGeometry(0.009, len, 5), steel);
    d.position.set(x, TOP + y - len / 2 + 0.004, 0);
    d.rotation.z = Math.PI;
    g.add(d);
  }
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.08, 10), steel);
  ring.position.y = TOP - 0.06;
  g.add(ring);
  // 날에서 번지는 빛
  const bg = new THREE.Sprite(_rpGlowMat(REAPER_GLOW, 0.35));
  bg.position.set(outer[Math.round(N * 0.45)][0], TOP + outer[Math.round(N * 0.45)][1], 0.02);
  bg.scale.setScalar(0.55);
  g.add(bg);

  const tip = new THREE.Object3D();
  tip.position.set(outer[N][0], TOP + outer[N][1], 0);
  g.add(tip);
  const root = new THREE.Object3D();
  root.position.set(outer[Math.round(N * 0.3)][0], TOP + outer[Math.round(N * 0.3)][1], 0);
  g.add(root);
  g.userData = { blade, tip, root };
  return g;
}

/** 발밑 기운 — 보랏빛 연기가 피어오르고 불티가 오른다 (자세 함수가 시간에 맞춰 움직인다) */
function _rpAura() {
  const g = new THREE.Group();
  const smokes = [], embers = [];
  for (let i = 0; i < 8; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: _rpSmokeTex(), color: 0x3a1f6e, transparent: true,
                                                           opacity: 0.5, depthWrite: false }));
    sp.userData = { a: (i / 8) * Math.PI * 2, ph: i / 8 };
    g.add(sp);
    smokes.push(sp);
  }
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Sprite(_rpGlowMat(0xc0a0ff, 0.9));
    sp.userData = { a: i * 2.4, ph: (i * 0.37) % 1 };
    g.add(sp);
    embers.push(sp);
  }
  const pool = new THREE.Sprite(_rpGlowMat(0x5a2fc0, 0.55));
  pool.scale.set(1.5, 0.5, 1);
  pool.position.y = 0.03;
  g.add(pool);
  g.userData = { smokes, embers };
  return g;
}

/**
 * 리퍼 한 명을 만든다.
 * 부품: body(떠다니는 몸), head(두건+해골), armR(낫 쥔 팔), armL, scythe, skull, tatters, aura
 */
function reaperBuild(seed = 7) {
  const rand = _rpRand(seed);
  const root = new THREE.Group();
  const aura = _rpAura();
  root.add(aura);
  const body = new THREE.Group();
  root.add(body);

  const robe = _rpRobe(rand);
  body.add(robe);

  // 어깨 망토 — 로브 위에 한 겹 더, 끝이 찢어져 있다
  const capeGeo = new THREE.ConeGeometry(0.36, 0.46, 24, 3, true);
  const cp = capeGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) if (cp.getY(i) < -0.2) cp.setY(i, cp.getY(i) - (i % 2 ? rand() * 0.12 : 0));
  capeGeo.computeVertexNormals();
  const cape = new THREE.Mesh(capeGeo, _rpCloth(REAPER_ROBE, REAPER_RIM, 1.0, 2.2));
  cape.position.y = 1.3;
  body.add(cape);

  // 누더기 조각 — 끝단 둘레에서 휘날린다
  const tatters = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rand() * 0.3;
    const piv = new THREE.Group();
    piv.position.set(Math.cos(a) * 0.46, 0.22 + rand() * 0.08, Math.sin(a) * 0.46);
    piv.rotation.y = -a + Math.PI / 2;
    const t = _rpTatter(0.28 + rand() * 0.2, 0.12 + rand() * 0.05, rand);
    piv.add(t);
    piv.userData = { base: 0.35 + rand() * 0.2, ph: rand() * 6.28, amp: 0.12 + rand() * 0.1 };
    body.add(piv);
    tatters.push(piv);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.64, 0.03);
  head.add(_rpHood());
  const skull = _rpSkull();
  skull.position.set(0, -0.02, 0.055);
  head.add(skull);
  body.add(head);

  // 낫 쥔 팔 (오른쪽 = -x, 정면에서 보면 왼쪽)
  const armR = new THREE.Group();
  armR.position.set(-0.25, 1.4, 0.03);
  const slR = _rpSleeve(rand);
  slR.rotation.z = -0.22;
  armR.add(slR);
  const tR = _rpTatter(0.24, 0.08, rand);
  tR.position.set(-0.1, -0.36, 0.02);
  armR.add(tR);
  const handR = _rpHand(1);
  handR.position.set(-0.1, -0.42, 0.06);
  armR.add(handR);
  const scythe = _rpScythe(rand);
  scythe.position.set(-0.1, -0.44, 0.1);
  armR.add(scythe);
  body.add(armR);

  // 빈 팔 — 갈퀴 같은 손을 앞으로 뻗는다
  const armL = new THREE.Group();
  armL.position.set(0.25, 1.4, 0.03);
  const slL = _rpSleeve(rand);
  slL.rotation.z = 0.2;
  armL.add(slL);
  const tL = _rpTatter(0.22, 0.08, rand);
  tL.position.set(0.1, -0.36, 0.02);
  armL.add(tL);
  const handL = _rpHand(0.2);
  handL.position.set(0.09, -0.45, 0.04);
  handL.rotation.z = 0.15;
  armL.add(handL);
  body.add(armL);

  // 발밑 그림자
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  root.add(shadow);

  root.userData = {
    body, head, skull, armR, armL, scythe, robe, shadow, aura, tatters, sleeveTatters: [tR, tL],
    eyes: skull.userData.eyes, eyeGlows: skull.userData.glows, jaw: skull.userData.jaw,
    tip: scythe.userData.tip, bladeRoot: scythe.userData.root,
  };
  return root;
}

// 쉬는 자세 — 낫을 몸 앞에 대각선으로 (날은 왼쪽 위 · 자루 끝은 오른쪽 아래)
const REAPER_REST = { ax: -0.5, az: -0.1, sz: 0.62, sx: 0.12 };

/**
 * 자세 — 모든 화면이 같은 시각에 같은 자세 (게임 시간 기준 값을 넘긴다).
 * @param {object} p
 *   walk  걷는 위상 (걸은 칸 수). 걷지 않으면 null
 *   swing 0~1 휘두르기 진행 (null이면 쉬는 자세)
 *   look  0~1 고개를 들어 얼굴을 보인다 (컷씬)
 *   t     ms  흔들림·연기 시계
 */
function reaperPose(r, p) {
  const u = r.userData;
  const t = (p.t || 0) / 1000;
  const walking = p.walk != null;

  // 떠 있다 — 발이 없으니 걷지 않고 미끄러진다. 걸음마다 통통 튀면 뒤뚱거리는 것처럼 보여서
  // 느리게 오르내리기만 하고, 좌우 흔들림은 아주 작게 둔다
  const glide = walking || p.glide;
  u.body.position.y = 0.06 + Math.sin(t * (glide ? 1.4 : 2.1)) * (glide ? 0.03 : 0.025);
  u.body.rotation.z = Math.sin(t * 0.9) * (glide ? 0.012 : 0.02);
  u.body.rotation.x = glide ? 0.22 : 0.12;                  // 앞으로 기울어 위협적으로
  u.robe.rotation.y = Math.sin(t * 3.1) * 0.05;
  const look = p.look || 0;
  u.head.rotation.x = 0.16 - look * 0.3;                    // 평소엔 고개를 숙여 눈만 번뜩인다
  u.head.rotation.y = Math.sin(t * 0.9) * 0.08 * (1 - look);
  u.armL.rotation.x = -0.35 + (glide ? -0.15 + Math.sin(t * 1.1) * 0.05 : Math.sin(t * 1.7) * 0.06);
  u.armL.rotation.z = 0.28;

  // 누더기 — 바람에 날리듯 (걸을 땐 더 크게 뒤로)
  const gust = glide ? 1.9 : 1;
  u.tatters.forEach(tp => {
    const d = tp.userData;
    tp.rotation.x = d.base * gust + Math.sin(t * 2.6 + d.ph) * d.amp * gust;
  });
  u.sleeveTatters.forEach((tp, i) => { tp.rotation.x = 0.2 + Math.sin(t * 3 + i * 2) * 0.18 * gust; });

  // 기운 — 연기는 끝단 둘레에서 피어올라 흩어지고, 불티는 곧게 오른다
  u.aura.userData.smokes.forEach(sp => {
    const d = sp.userData;
    const ph = (t * 0.55 + d.ph) % 1;
    const a = d.a + t * 0.4;
    sp.position.set(Math.cos(a) * (0.42 + ph * 0.25), 0.05 + ph * 0.75, Math.sin(a) * (0.42 + ph * 0.25));
    sp.scale.setScalar(0.35 + ph * 0.55);
    sp.material.opacity = Math.sin(ph * Math.PI) * 0.55 * (sp.material.userData.fadeK ?? 1);
  });
  u.aura.userData.embers.forEach(sp => {
    const d = sp.userData;
    const ph = (t * 0.45 + d.ph) % 1;
    sp.position.set(Math.cos(d.a) * 0.35, 0.1 + ph * 1.5, Math.sin(d.a) * 0.35);
    sp.scale.setScalar(0.05 * (1 - ph) + 0.02);
    sp.material.opacity = (1 - ph) * 0.9 * (sp.material.userData.fadeK ?? 1);
  });

  // 낫 — 쉴 땐 대각선으로 든다. 휘두를 땐 어깨 위 바깥으로 크게 치켜들었다가
  // 몸을 비틀며 앞을 가로질러 반대편 아래로 내리친다 (팔은 어깨, 낫은 손을 축으로 따로 돈다)
  let ax = 0, az = 0, sz = 0, sy = 0;
  if (p.swing != null) {
    const s = p.swing;
    if (s < 0.4) {
      const k = s / 0.4, e = 1 - (1 - k) ** 2;
      az = -1.25 * e; sz = 0.95 * e; ax = -0.35 * e; sy = 0.6 * e;
    } else if (s < 0.62) {
      const k = (s - 0.4) / 0.22, e = k * k * (3 - 2 * k);
      az = -1.25 + 2.05 * e; sz = 0.95 - 3.4 * e; ax = -0.35 + 1.0 * e; sy = 0.6 - 1.35 * e;
    } else {
      const k = (s - 0.62) / 0.38, e = 1 - (1 - k) ** 3;
      az = 0.8 * (1 - e); sz = -2.45 * (1 - e); ax = 0.65 * (1 - e); sy = -0.75 * (1 - e);
    }
    u.jaw.rotation.x = Math.max(0, Math.sin(s * Math.PI)) * 0.35;   // 입을 벌린다
  } else {
    u.jaw.rotation.x = 0.04 + Math.max(0, Math.sin(t * 0.7)) * 0.05;
  }
  u.body.rotation.y = sy;
  u.armR.rotation.x = REAPER_REST.ax + ax + Math.sin(t * 1.5) * 0.03;
  u.armR.rotation.z = REAPER_REST.az + az;
  u.scythe.rotation.z = REAPER_REST.sz + sz;
  u.scythe.rotation.x = REAPER_REST.sx;
}

/** 눈빛 (0~1) */
function reaperEyes(r, k) {
  r.userData.eyes.forEach(e => { e.material.opacity = k; });
  r.userData.eyeGlows.forEach(g => { g.material.opacity = k * 0.85; g.scale.setScalar(0.03 + k * 0.045); });
}

// ── 기절 · 둔화 표시 (2026-10-01) ─────────────────────────────
// 기절(침수): 머리 위를 노란 별 넷이 빙빙 돈다. 둔화(파도): 몸을 감은 물빛 고리 둘이 느리게 돈다.
let _rpStarTex = null;
function _rpStatusStar() {
  if (_rpStarTex) return _rpStarTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  glow.addColorStop(0, 'rgba(255, 245, 170, 0.9)');
  glow.addColorStop(1, 'rgba(255, 220, 90, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff6b0';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? 7 : 24;
    g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  _rpStarTex = new THREE.CanvasTexture(c);
  return _rpStarTex;
}

function _rpStatusBuild(r) {
  const fx = new THREE.Group();
  // 몸 높이 (모델 단위) — 별을 머리 바로 위에 띄운다
  const box = new THREE.Box3().setFromObject(r);
  const s = r.scale.y || 1;
  const top = Math.max(1.2, Math.min(2.4, (box.max.y - r.position.y) / s));
  const stars = new THREE.Group();
  stars.position.y = top + 0.12;
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: _rpStatusStar(), transparent: true, depthWrite: false, depthTest: false }));
    sp.scale.setScalar(0.24);
    sp.userData.a = i * Math.PI / 2;
    stars.add(sp);
  }
  fx.add(stars);
  const rings = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  ringMat.userData.keepTransparent = true;
  [[0.35, 0.36], [0.95, 0.3]].forEach(([y, rad]) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.022, 6, 40, Math.PI * 1.5), ringMat);
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    rings.add(m);
  });
  fx.add(rings);
  fx.userData = { stars, rings, top };
  r.add(fx);
  return fx;
}

/** 매 프레임 — status: 'stun' | 'slow' | null */
function reaperStatusFx(r, status, t) {
  let fx = r.userData.statusFx;
  if (!status && !fx) return;
  if (!fx) fx = r.userData.statusFx = _rpStatusBuild(r);
  const { stars, rings } = fx.userData;
  stars.visible = status === 'stun';
  rings.visible = status === 'slow';
  if (stars.visible) {
    const a0 = t / 260;
    stars.children.forEach(sp => {
      const a = a0 + sp.userData.a;
      sp.position.set(Math.cos(a) * 0.3, Math.sin(a * 2) * 0.04, Math.sin(a) * 0.3);
    });
  }
  if (rings.visible) rings.children.forEach((m, i) => { m.rotation.z = (i ? -1 : 1) * t / 900; });
}

/** 전체 투명도 — 사라지기·나타나기 */
function reaperFade(r, k) {
  r.traverse(o => {
    if (!o.material) return;
    const m = o.material;
    if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.uniforms ? m.uniforms.uOpacity.value : m.opacity;
    m.userData.fadeK = k;
    if (m.uniforms?.uOpacity) { m.uniforms.uOpacity.value = m.userData.baseOpacity * k; m.transparent = k < 1 || m.userData.baseOpacity < 1; }
    else if (o.isSprite) { /* 기운·눈빛은 자세 함수가 fadeK를 곱해 쓴다 */ if (!r.userData.aura.children.includes(o)) m.opacity = m.userData.baseOpacity * k; }
    else { m.transparent = k < 1 || m.userData.baseOpacity < 1 || !!m.userData.keepTransparent; m.opacity = m.userData.baseOpacity * k; }
  });
}

// ════════════════════════════════════════════════════════════
//  유령 — 그림리퍼가 쓰러지면 쌓인 영혼 수만큼 솟아 타워로 날아든다 (2026-09-30 사용자 참고 그림)
//    · 머리부터 발끝까지 한 장의 잿빛 수의 — 반쯤 비치고, 가장자리가 희게 빛난다
//    · 두건을 덮어쓴 해골 — 비명을 지르듯 턱이 벌어져 있다
//    · 두 팔을 앞으로 뻗어 뼈 손가락을 편다 — 소매 아래로 긴 천이 드리운다
//    · 발이 없다 — 아래로 갈수록 가늘어져 찢어진 꼬리로 흩어지고, 밑에 안개가 깔린다
//  리퍼와 같은 식으로 떠서 미끄러진다 (ghostPose — reaperPose의 glide와 같은 결)
// ════════════════════════════════════════════════════════════
const GHOST_CLOTH = 0x56606b;
const GHOST_RIM   = 0xdfe9f2;

function _ghCloth(opacity = 0.8, rimStr = 1.25) {
  const m = _rpCloth(GHOST_CLOTH, GHOST_RIM, rimStr, 1.6, 0);
  m.uniforms.uOpacity.value = opacity;
  m.transparent = true;
  m.depthWrite = false;
  return m;
}

/** 수의 — 어깨에서 조금 부풀었다가 아래로 가늘어지며 찢어진 꼬리가 된다 */
function _ghShroud(rand) {
  const prof = [[0.001, 1.52], [0.15, 1.5], [0.22, 1.42], [0.23, 1.24], [0.215, 1.0], [0.2, 0.78], [0.17, 0.56],
                [0.13, 0.36], [0.08, 0.18], [0.03, 0.04], [0.002, -0.12]];
  const SEG = 40;
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), SEG);
  const pos = geo.attributes.position;
  const teeth = [];
  for (let i = 0; i <= SEG; i++) teeth.push(rand());
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.7) continue;
    const x = pos.getX(i), z = pos.getZ(i);
    const k = Math.round(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * SEG) % (SEG + 1);
    const cut = Math.min(1, (0.7 - y) / 0.7);            // 아래로 갈수록 깊게 찢어진다
    const tooth = k % 2 === 0 ? teeth[k] * 0.3 * cut : 0;
    const fl = 1 + (k % 2 ? 0.25 * cut * teeth[k] : 0);
    pos.setXYZ(i, x * fl, y + tooth, z * fl - cut * cut * 0.4);    // 꼬리는 뒤로 흘러간다
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, _ghCloth(0.85));
}

function _ghMist() {
  const g = new THREE.Group();
  const smokes = [], embers = [];
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: _rpSmokeTex(), color: 0xb6c2cc, transparent: true,
                                                           opacity: 0.4, depthWrite: false }));
    sp.userData = { a: (i / 7) * Math.PI * 2, ph: i / 7 };
    g.add(sp);
    smokes.push(sp);
  }
  g.userData = { smokes, embers };
  return g;
}

/**
 * 유령 한 명을 만든다. 크기·앞 방향은 리퍼와 같다 (키 약 1.9, 앞 = +z).
 * 부품: body, head, skull, armL, armR, shroud, tatters, sleeveDrapes, aura(안개)
 */
function ghostBuild(seed = 11) {
  const rand = _rpRand(seed);
  const root = new THREE.Group();
  const aura = _ghMist();
  root.add(aura);
  const body = new THREE.Group();
  root.add(body);
  const shroud = _ghShroud(rand);
  body.add(shroud);

  // 몸을 감은 긴 천 조각 — 허리 둘레에서 뒤로 흘러내린다
  const tatters = [];
  const tMat = _ghCloth(0.55, 1.5);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (1.15 + (i / 8) * 0.7) + rand() * 0.2;   // 옆·뒤로만 (앞은 비워 얼굴·손이 보이게)
    const piv = new THREE.Group();
    piv.position.set(Math.cos(a) * 0.2, 0.9 + rand() * 0.2, Math.sin(a) * 0.2);
    piv.rotation.y = -a + Math.PI / 2;
    piv.add(_rpTatter(0.75 + rand() * 0.35, 0.16 + rand() * 0.06, rand, tMat));
    piv.userData = { base: 0.3 + rand() * 0.2, ph: rand() * 6.28, amp: 0.14 + rand() * 0.1 };
    body.add(piv);
    tatters.push(piv);
  }

  // 두건 · 해골 — 턱이 벌어져 있다
  const head = new THREE.Group();
  head.position.set(0, 1.62, 0.04);
  head.scale.setScalar(1.15);
  head.add(_rpHood(_ghCloth(0.9, 1.3), 0x0b0d12));
  const skull = _rpSkull();
  skull.scale.setScalar(1.3);                          // 두건 밖으로 드러난 큰 해골 (참고 그림)
  skull.position.set(0, -0.035, 0.1);
  skull.userData.glows.forEach(g => g.material.color.set(0xcfe8ff));
  skull.userData.eyes.forEach(e => e.material.color.set(0xeaf6ff));
  head.add(skull);
  body.add(head);

  // 두 팔 — 앞으로 뻗어 편 뼈 손, 소매 밑으로 긴 천이 드리운다
  const arms = [], sleeveDrapes = [];
  [-1, 1].forEach(sd => {
    const arm = new THREE.Group();
    arm.position.set(sd * 0.24, 1.38, 0.04);
    const sl = _rpSleeve(rand, _ghCloth(0.8, 1.3));
    sl.rotation.z = sd * 0.18;
    arm.add(sl);
    const dr = _rpTatter(0.85, 0.22, rand, tMat);
    dr.position.set(sd * 0.08, -0.34, 0.0);
    arm.add(dr);
    sleeveDrapes.push(dr);
    const hand = _rpHand(0.05);
    hand.position.set(sd * 0.07, -0.44, 0.03);
    hand.rotation.z = sd * 0.2;
    arm.add(hand);
    body.add(arm);
    arms.push(arm);
  });

  root.userData = {
    ghost: true, body, head, skull, shroud, aura, tatters, sleeveDrapes,
    armR: arms[0], armL: arms[1],
    eyes: skull.userData.eyes, eyeGlows: skull.userData.glows, jaw: skull.userData.jaw,
  };
  return root;
}

/**
 * 유령 자세 — 리퍼처럼 떠서 미끄러지고(glide), 두 팔을 앞으로 뻗은 채 천이 뒤로 날린다.
 * @param {object} p  { t: ms, glide: 움직이는 중인가 }
 */
function ghostPose(r, p) {
  const u = r.userData;
  const t = (p.t || 0) / 1000;
  const glide = !!p.glide;
  u.body.position.y = 0.2 + Math.sin(t * (glide ? 1.4 : 2.0)) * 0.05;
  u.body.rotation.x = glide ? 0.3 : 0.14;
  u.body.rotation.z = Math.sin(t * 0.9) * 0.03;
  u.shroud.rotation.y = Math.sin(t * 2.2) * 0.08;
  u.head.rotation.x = 0.05 + Math.sin(t * 1.3) * 0.05;
  u.head.rotation.y = Math.sin(t * 0.8) * 0.12;
  u.jaw.rotation.x = 0.42 + Math.max(0, Math.sin(t * 3.4)) * 0.18;     // 비명
  [u.armR, u.armL].forEach((a, i) => {
    const sd = i ? 1 : -1;
    a.rotation.x = -1.2 + Math.sin(t * 1.5 + i * 1.3) * 0.1;           // 앞으로 뻗는다
    a.rotation.z = sd * (0.4 + Math.sin(t * 1.1 + i) * 0.06);
  });
  const gust = glide ? 1.7 : 1;
  u.tatters.forEach(tp => {
    const d = tp.userData;
    tp.rotation.x = d.base * gust + Math.sin(t * 2.4 + d.ph) * d.amp * gust;
  });
  u.sleeveDrapes.forEach((tp, i) => { tp.rotation.x = 0.9 + Math.sin(t * 2.8 + i * 2) * 0.2 * gust; });
  u.aura.userData.smokes.forEach(sp => {
    const d = sp.userData;
    const ph = (t * 0.5 + d.ph) % 1;
    const a = d.a + t * 0.35;
    sp.position.set(Math.cos(a) * (0.2 + ph * 0.35), 0.05 + ph * 0.45, Math.sin(a) * (0.2 + ph * 0.35));
    sp.scale.setScalar(0.35 + ph * 0.5);
    sp.material.opacity = Math.sin(ph * Math.PI) * 0.45 * (sp.material.userData.fadeK ?? 1);
  });
}

// ════════════════════════════════════════════════════════════
//  발밑 표시 — 브롤스타즈의 캐릭터 발밑 원처럼 (2026-09-30 사용자 참고 그림)
//    · 바닥 원: 진영 색 굵은 고리 · 안쪽 옅은 흰 고리 · 여덟 모 별 무늬 · 네 방향의 작은 색 꽃잎
//    · 그 둘레에 ')' 모양 활 네 개가 빙빙 돈다 (움직일 때 더 빠르게)
//  내 유닛은 초록 고리 + 하늘색 활, 상대 유닛은 빨강 고리 + 주홍 활. 유닛 모형의 자식으로 붙어 같이 움직인다.
// ════════════════════════════════════════════════════════════
const UNIT_RING_COLORS = {
  mine:  { ring: '#46e04e', ringDark: '#1f8f2a', arc: '#6fd6ff', arcDark: '#2a86c4' },
  enemy: { ring: '#ff4d57', ringDark: '#9c1c26', arc: '#ff9a6b', arcDark: '#b8452a' },
};

function _rpRingDiskTex(side) {
  const C = UNIT_RING_COLORS[side];
  return _rpCanvasTex('ringDisk_' + side, 256, (g, s) => {
    const c = s / 2;
    // 안쪽 옅은 그늘
    g.fillStyle = 'rgba(20, 16, 30, 0.35)';
    g.beginPath(); g.arc(c, c, 96, 0, Math.PI * 2); g.fill();
    // 여덟 모 별 무늬
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 50 : 72;
      g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = 'rgba(120, 96, 70, 0.45)';
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(236, 222, 196, 0.9)';
    g.stroke();
    // 안쪽 흰 고리
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    g.beginPath(); g.arc(c, c, 90, 0, Math.PI * 2); g.stroke();
    // 네 방향 꽃잎 (노랑 · 분홍 · 하늘 · 노랑)
    ['#ffe66b', '#ffb3d9', '#bfe8ff', '#ffe66b'].forEach((col, i) => {
      const a = i / 4 * Math.PI * 2;
      g.fillStyle = col;
      g.beginPath(); g.arc(c + Math.cos(a) * 92, c + Math.sin(a) * 92, 15, 0, Math.PI * 2); g.fill();
    });
    // 진영 색 굵은 고리 (어두운 테 → 밝은 몸)
    g.lineWidth = 24;
    g.strokeStyle = C.ringDark;
    g.beginPath(); g.arc(c, c, 110, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 17;
    g.strokeStyle = C.ring;
    g.beginPath(); g.arc(c, c, 110, 0, Math.PI * 2); g.stroke();
  });
}

function _rpRingArcTex(side) {
  const C = UNIT_RING_COLORS[side];
  return _rpCanvasTex('ringArc_' + side, 256, (g, s) => {
    const c = s / 2, R = 106, span = 0.34 * Math.PI;         // 활 하나 약 61°
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a0 = i / 4 * Math.PI * 2 + Math.PI / 4 - span / 2;
      g.lineWidth = 26; g.strokeStyle = C.arcDark;
      g.beginPath(); g.arc(c, c, R, a0, a0 + span); g.stroke();
      g.lineWidth = 18; g.strokeStyle = C.arc;
      g.beginPath(); g.arc(c, c, R, a0, a0 + span); g.stroke();
      g.lineWidth = 5; g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      g.beginPath(); g.arc(c, c, R - 3, a0 + 0.08, a0 + span - 0.08); g.stroke();
    }
  });
}

/**
 * 발밑 표시를 만든다. 유닛 모형(group)에 자식으로 붙인다.
 * @param {boolean} mine  이 화면 주인의 유닛인가
 * @param {number} r      바닥 원 반지름 (모형 단위)
 */
function unitRingBuild(mine, r = 0.62) {
  const side = mine ? 'mine' : 'enemy';
  const g = new THREE.Group();
  const mk = (tex, size) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.material.userData.keepTransparent = true;   // 그림 가장자리가 비치는 판 — 투명도 조절(reaperFade)이 꺼 버리지 않게
    m.renderOrder = 3;          // 발밑 연기·안개(투명 스프라이트) 뒤에 그려 묻히지 않게 — 몸은 깊이로 가린다
    g.add(m);
    return m;
  };
  const disk = mk(_rpRingDiskTex(side), r * 2 * 1.04);
  disk.position.y = 0.012;
  const arcs = mk(_rpRingArcTex(side), r * 2 * 1.62);
  arcs.position.y = 0.018;
  g.userData = { disk, arcs, spin: 0, last: 0 };
  return g;
}

/**
 * 발밑 표시를 돌린다. 몸이 바라보는 쪽(yaw)과 상관없이 바닥에 반듯이 누워 돈다.
 * @param {number} t      ms (게임 시간 — 모든 화면이 같은 각도)
 * @param {boolean} moving 움직이는 중이면 더 빠르게
 * @param {number} yaw    부모(유닛)가 돌아간 각도
 */
function unitRingPose(ring, t, moving, yaw) {
  const u = ring.userData;
  const dt = u.last ? Math.min(100, Math.max(0, t - u.last)) : 0;
  u.last = t;
  u.spin += dt / 1000 * (moving ? 2.4 : 1.0);
  ring.rotation.y = -yaw;
  u.arcs.rotation.z = u.spin;
  const pulse = 1 + Math.sin(t / 260) * 0.03;
  u.disk.scale.set(pulse, pulse, 1);
}

function reaperDispose(r) {
  r.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (m.map && !m.map._rpShared) m.map.dispose();
      m.dispose();
    });
  });
}

// ── 베기 꼬리 ────────────────────────────────────────────────
// 날이 지나간 자리를 따라 빛나는 띠. 프레임마다 쌓지 않고, 지금부터 조금 전까지의 자세를 여러 번
// 다시 계산해 그 순간들의 날끝·날뿌리를 잇는다 — 프레임이 끊겨도, 어느 화면에서 봐도 같은 모양이다.
const REAPER_TRAIL_N = 20;

function reaperTrailCreate() {
  const n = REAPER_TRAIL_N;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 6), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array((n + 1) * 6), 3));
  const idx = [];
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/**
 * @param {THREE.Mesh} trail   reaperTrailCreate 결과 (월드 좌표 그대로 — 씬 바로 밑에 둔다)
 * @param {THREE.Group} r      리퍼
 * @param {(ago: number) => number|null} swingAt  ago ms 전의 휘두르기 진행 (없으면 null)
 * @param {object} pose        지금 자세 (다 계산한 뒤 되돌려 놓는다)
 * @param {number} stepMs      표본 간격
 */
function reaperTrailUpdate(trail, r, swingAt, pose, stepMs = 9) {
  const n = REAPER_TRAIL_N;
  const P = trail.geometry.attributes.position, C = trail.geometry.attributes.color;
  const u = r.userData;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let any = false, last = null;
  for (let i = 0; i <= n; i++) {
    const s = swingAt(i * stepMs);
    // 내리치는 구간(0.36~0.8)에서만 빛난다 — 들어 올릴 땐 꼬리가 없다
    const k = s == null ? 0 : Math.max(0, Math.min(1, (s - 0.36) / 0.06)) * Math.max(0, Math.min(1, (0.82 - s) / 0.12));
    if (s != null) {
      reaperPose(r, { ...pose, swing: s });
      r.updateMatrixWorld(true);
      u.tip.getWorldPosition(a);
      u.bladeRoot.getWorldPosition(b);
      last = [a.x, a.y, a.z, b.x, b.y, b.z];
    }
    const p = last || [0, 0, 0, 0, 0, 0];
    P.setXYZ(i * 2, p[0], p[1], p[2]);
    P.setXYZ(i * 2 + 1, p[3], p[4], p[5]);
    const f = (1 - i / n) ** 1.2 * k;
    if (f > 0.01) any = true;
    C.setXYZ(i * 2, 0.96 * f, 0.92 * f, 1.0 * f);         // 날끝 — 흰빛
    C.setXYZ(i * 2 + 1, 0.42 * f, 0.18 * f, 0.9 * f);     // 날뿌리 쪽 — 보랏빛으로 스러진다
  }
  P.needsUpdate = true;
  C.needsUpdate = true;
  trail.visible = any;
  reaperPose(r, pose);
  r.updateMatrixWorld(true);
}


// ════════════════════════════════════════════════════════════
//  컷씬 — 그림리퍼 소환
//
//  두 플레이어·관전자 화면 모두에 뜬다. 이 동안 게임 시간은 멈춘다 (utils.js gameNow).
//  흐름 (REAPER_CUT_MS):
//    암전 → 보랏빛 번개와 함께 허공이 세로로 찢어지고, 흑백 나선 포탈이 열린다 (바닥 충격파)
//    → 리퍼가 포탈 면을 뚫고 미끄러져 나온다 (포탈 뒤쪽은 잘려 보이지 않는다) · 해골 영혼이 주위를 돈다
//    → 고개를 들어 얼굴을 보이고, 눈이 번뜩인다 · 이름이 박힌다
//    → 몸을 비틀어 낫을 크게 휘두른다 → 그 베기가 화면 자체를 대각선으로 가르고,
//      갈라진 두 조각이 벌어지며 필드가 드러난다
// ════════════════════════════════════════════════════════════
const REAPER_CUT_MS = 6900;
let _rpCut = null;

/**
 * 컷씬 카메라 시야 — 세로 42°가 기본, 화면이 좁으면 가로 64°가 나오도록 세로를 넓힌다.
 * (카메라 자리는 리퍼 전신과 들어 올린 낫이 세로 42° 안에 다 들어오게 잡혀 있다)
 */
function _rpFitCam(cam, aspect) {
  const need = 2 * Math.atan(Math.tan(32 * Math.PI / 180) / aspect) * 180 / Math.PI;
  cam.aspect = aspect;
  cam.fov = Math.max(42, need);
  cam.updateProjectionMatrix();
}

/**
 * 포탈 — 참고 이미지 (2026-09-30): 깊은 검은 속에 가는 붉은 나선 실이 빨려 들고,
 * 그 둘레에 하얗게 달아오른 붉은 네온 고리, 바깥은 붉은 붓질이 소용돌이치며 가장자리가 거칠게 흩어진다.
 * uTear: 처음엔 세로로 가는 균열 → 둥글게 벌어진다
 */
function _rpPortalMat() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 }, uTear: { value: 0.02 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform float uOpen; uniform float uTear;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; } return v; }
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        p.x /= max(uTear, 0.02);
        float r = length(p) / 0.62;                  // 1 = 붓질 바깥 가장자리 (평균)
        float a = atan(p.y, p.x);
        vec3 red = vec3(1.0, 0.07, 0.09);
        // 거친 가장자리 — 각도마다 들쭉날쭉, 천천히 일렁인다
        float en = fbm(vec2(a * 4.5 + 7.0, uTime * 0.35));
        float R = 1.0 + (en - 0.5) * 0.38;
        // 바깥 붓질 — 소용돌이를 따라 결이 난 붉은 획
        float sw = a * 2.0 + log(r + 0.05) * 3.2 - uTime * 1.5;
        float grain = fbm(vec2(sw * 2.6, r * 16.0 - uTime * 0.6));
        float strand = pow(abs(sin(sw * 5.0 + grain * 5.0)), 2.5);
        float band = smoothstep(0.6, 0.72, r) * (1.0 - smoothstep(R - 0.1, R + 0.01, r));
        vec3 col = red * band * (0.18 + 0.75 * grain * (0.4 + strand));
        col += vec3(1.0, 0.55, 0.5) * band * pow(strand, 8.0) * grain * 1.1;      // 밝게 튀는 붓 끝
        // 속 — 깊은 검정에 가는 붉은 나선 실
        float spiral = a * 3.0 + log(r + 0.02) * 9.0 - uTime * 2.4;
        float thread = pow(1.0 - abs(sin(spiral)), 70.0);
        col += red * thread * smoothstep(0.12, 0.45, r) * (1.0 - smoothstep(0.5, 0.6, r)) * 0.95;
        // 네온 고리 — 흰 심 + 붉은 번짐
        float d = r - 0.6;
        float pulse = 0.85 + 0.15 * sin(uTime * 6.0);
        col += vec3(1.0, 0.94, 0.94) * exp(-pow(d / 0.02, 2.0)) * 1.5 * pulse;
        col += red * exp(-pow(d / 0.075, 2.0)) * 1.3 * pulse;
        col += red * exp(-pow(d / 0.22, 2.0)) * 0.35;
        // 바깥으로 번지는 붉은 안개
        float inside = 1.0 - smoothstep(R - 0.04, R + 0.03, r);
        float haze = (1.0 - smoothstep(R, R + 0.4, r)) * 0.4 * (0.5 + 0.5 * en);
        col += red * haze * (1.0 - inside);
        gl_FragColor = vec4(col, max(inside, haze) * uOpen);
      }`
  });
}

/** 번개 — 포탈 가장자리에서 튀는 들쭉날쭉한 빛줄기. 몇십 ms마다 모양을 새로 뽑는다 */
function _rpBolt(line, cx, cy, R) {
  const a0 = Math.random() * Math.PI * 2;
  const pts = [];
  let a = a0, r = R * (0.95 + Math.random() * 0.1);
  const steps = 9;
  const out = Math.random() < 0.5;            // 밖으로 뻗거나, 가장자리를 따라 긴다
  for (let i = 0; i <= steps; i++) {
    pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.02 + Math.random() * 0.05));
    if (out) r += 0.09 + Math.random() * 0.06; else a += 0.07 + Math.random() * 0.05;
    a += (Math.random() - 0.5) * 0.25;
    r += (Math.random() - 0.5) * 0.08;
  }
  line.geometry.setFromPoints(pts);
}

// ── 컷씬 배경 — 필드와 같은 섬 · 바다 · 밤하늘 (2026-10-02) ─────────────────
//  필드의 섬을 그대로 옮겨 놓는다: 16×9 타일 바닥, 위·왼쪽·오른쪽 돌벽(성가퀴), 앞쪽 돌 부두와 선착장 · 요트.
//  섬 밖은 바다(수면은 섬 바닥보다 조금 낮다), 그 위로 별 · 구름 · 달이 뜬 밤하늘.
//  달은 카메라가 바라보는 쪽(소환한 사람 진영 너머) 왼쪽 위에 낮게 떠 — 벽 너머로 늘 보인다.
const RP_MOON_DIR = new THREE.Vector3(-0.36, 0.13, -1).normalize();

function _rpSkyMat() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uMoon: { value: RP_MOON_DIR } },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform float uTime; uniform vec3 uMoon;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 hor = vec3(0.075, 0.12, 0.23), mid = vec3(0.025, 0.045, 0.11), top = vec3(0.006, 0.01, 0.03);
        vec3 col = mix(mix(hor, mid, smoothstep(0.0, 0.18, h)), top, smoothstep(0.15, 0.7, h));
        // 별 — 방향을 경위도 칸으로 나눠 칸마다 하나
        vec2 sp = vec2(atan(d.x, -d.z) * 160.0, asin(clamp(d.y, -1.0, 1.0)) * 160.0);
        vec2 cell = floor(sp);
        float r = hash(cell);
        if (r > 0.9) {
          vec2 c = cell + 0.2 + 0.6 * vec2(hash(cell + 3.1), hash(cell + 7.7));
          float big = step(0.985, r);
          float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
          col += vec3(0.8, 0.86, 1.0) * smoothstep(0.5 + big * 0.35, 0.0, length(sp - c)) * (0.55 + big * 1.4) * tw * smoothstep(0.01, 0.08, h);
        }
        // 엷은 구름 — 달 쪽은 은빛으로 밝다
        float md = acos(clamp(dot(d, uMoon), -1.0, 1.0));
        float cl = fbm(d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.01, 0.0));
        float cloud = smoothstep(0.55, 0.82, cl) * smoothstep(0.02, 0.12, h);
        col = mix(col, vec3(0.1, 0.13, 0.2) + vec3(0.35, 0.38, 0.45) * exp(-md * 4.0), cloud * 0.55);
        // 달무리 · 달
        col += vec3(0.55, 0.62, 0.8) * exp(-md * 14.0) * 0.4 + vec3(0.8, 0.85, 1.0) * exp(-md * 45.0) * 0.3;
        float R = 0.034;
        if (md < R) {
          vec3 ax = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
          vec3 ay = cross(ax, uMoon);
          vec2 q = vec2(dot(d - uMoon, ax), dot(d - uMoon, ay)) / R;
          float crater = fbm(q * 3.0 + 4.0);
          vec3 mc = mix(vec3(0.8, 0.83, 0.9), vec3(0.98, 0.97, 0.92), smoothstep(0.35, 0.7, crater));
          mc *= 0.82 + 0.18 * (1.0 - length(q - vec2(-0.25, 0.25)));
          col = mix(col, mc, smoothstep(R, R * 0.93, md));
        }
        col += vec3(0.1, 0.14, 0.24) * exp(-h * 40.0) * 0.6;
        gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);
      }`
  });
}

/** 바다 — 섬 둘레 물결 · 하늘 반사 · 달빛 길 · 섬 가장자리 거품 · 먼 수평선 안개 */
function _rpSeaMat(isle) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMoon: { value: RP_MOON_DIR }, uIsle: { value: isle } },
    vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      varying vec3 vW; uniform float uTime; uniform vec3 uMoon; uniform vec4 uIsle;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
      float waves(vec2 p, float t, float fade) {
        float h = sin(dot(p, vec2(0.9, 0.42)) * 1.1 + t * 1.1) * 0.35 + sin(dot(p, vec2(-0.5, 0.86)) * 1.7 + t * 1.5) * 0.22;
        float a = 0.3, f = 1.0;
        for (int i = 0; i < 4; i++) { h += (noise(p * 1.4 * f + vec2(t * 0.35, -t * 0.22) * f) - 0.5) * a * fade; f *= 2.1; a *= 0.5; fade *= fade; }
        return h;
      }
      void main() {
        float t = uTime;
        vec3 V = normalize(cameraPosition - vW);
        float dist = length(vW.xz - cameraPosition.xz);
        float fade = clamp(1.4 - dist / 60.0, 0.0, 1.0);
        vec2 p = vW.xz * 0.8;
        float e = 0.06 + dist * 0.004;
        float h0 = waves(p, t, fade);
        float hx = waves(p + vec2(e, 0.0), t, fade), hz = waves(p + vec2(0.0, e), t, fade);
        float amp = 0.12 * mix(0.25, 1.0, fade);
        vec3 n = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
        vec3 R = reflect(-V, n);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 hor = vec3(0.075, 0.12, 0.23), mid = vec3(0.025, 0.045, 0.11);
        vec3 refl = mix(hor, mid, smoothstep(0.0, 0.3, max(R.y, 0.0)));
        vec3 water = mix(vec3(0.004, 0.028, 0.065), vec3(0.015, 0.075, 0.13), smoothstep(-0.4, 0.5, h0));
        vec2 q = max(max(uIsle.xy - vW.xz, vW.xz - uIsle.zw), 0.0);
        float dIs = length(q);
        water = mix(water, vec3(0.03, 0.17, 0.2), exp(-dIs / 2.5) * 0.5);
        vec3 col = mix(water, refl, clamp(fres, 0.0, 1.0));
        // 달빛 — 물결마다 반짝이는 길
        float m = max(dot(R, uMoon), 0.0);
        col += vec3(0.8, 0.85, 1.0) * (pow(m, 900.0) * 2.5 + pow(m, 60.0) * 0.25);
        // 섬 가장자리 거품
        float wob = (noise(vW.xz * 3.0 + t * 0.8) - 0.5) * 0.25;
        float foam = smoothstep(0.28, 0.03, dIs + wob) * (0.45 + 0.55 * noise(vW.xz * 8.0 + t * 1.7));
        col = mix(col, vec3(0.7, 0.78, 0.84), foam * 0.6 * fade);
        col *= mix(0.6, 1.0, smoothstep(0.0, 0.7, dIs));
        // 수평선 안개
        col = mix(col, hor * 0.85, smoothstep(40.0, 220.0, dist));
        gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);
      }`
  });
}

/** 컷씬 바닥 — 필드와 같은 16×9 타일 (소환한 사람 진영 = 0~7열) */
function _rpFieldTex(mine) {
  const S = 64, c = document.createElement('canvas');
  c.width = 9 * S; c.height = 16 * S;               // 가로 = 행(0~8), 세로 = 열(0~15, 위가 0열)
  const g = c.getContext('2d');
  g.fillStyle = '#0b1328';
  g.fillRect(0, 0, c.width, c.height);
  for (let col = 0; col < 16; col++) for (let row = 0; row < 9; row++) {
    const own = col < 8;
    const blue = own === !!mine;
    const x = row * S, y = col * S;
    g.fillStyle = blue ? 'rgba(60,130,255,0.15)' : 'rgba(255,70,70,0.14)';
    g.fillRect(x, y, S, S);
    const grd = g.createLinearGradient(x, y, x + S, y);
    grd.addColorStop(0, 'rgba(255,255,255,0.07)');
    grd.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = grd;
    g.fillRect(x, y, S, S);
    g.strokeStyle = blue ? 'rgba(140,190,255,0.22)' : 'rgba(255,160,160,0.22)';
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, S - 2, S - 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

/**
 * 섬 · 바다 · 하늘을 scene에 넣는다. W(mx, my)는 맵 좌표(px) → 컷씬 월드 (x, z), K는 맵 1px의 월드 길이.
 * 돌아오는 sky · sea는 매 프레임 시간을 넘겨 받는다.
 */
/** 맵 공간 상자들(색 있는)을 한 메시로 — 섬 가장자리 블록은 수가 많아 따로 만들면 무겁다 */
function _rpBoxesMesh(boxes, W, K) {
  const pos = [], col = [];
  const c = new THREE.Color();
  const P = (mx, my, h) => { const w = W(mx, my); return [w.x, h * K, w.z]; };
  boxes.forEach(b => {
    c.set(b.color);
    const face = (q, shade) => {
      const [a, bb, cc, d] = q.map(v => P(...v));
      pos.push(...a, ...bb, ...cc, ...a, ...cc, ...d);
      for (let i = 0; i < 6; i++) col.push(c.r * shade, c.g * shade, c.b * shade);
    };
    const { x0, x1, y0, y1, h0, h1 } = b;
    face([[x0, y0, h1], [x0, y1, h1], [x1, y1, h1], [x1, y0, h1]], 1);
    face([[x0, y1, h0], [x1, y1, h0], [x1, y1, h1], [x0, y1, h1]], 0.78);
    face([[x1, y0, h0], [x0, y0, h0], [x0, y0, h1], [x1, y0, h1]], 0.78);
    face([[x0, y0, h0], [x0, y1, h0], [x0, y1, h1], [x0, y0, h1]], 0.68);
    face([[x1, y1, h0], [x1, y0, h0], [x1, y0, h1], [x1, y1, h1]], 0.68);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

function _rpBuildArena(scene, W, K, mine) {
  const HB = typeof T3D_HARBOR !== 'undefined' ? T3D_HARBOR
    : { wall: 26, sea: 16, reach: 150, piers: [], yachts: [] };
  const MW = 1600, MH = 900, T = HB.wall, SEA = HB.sea * K;
  const box = (mx0, mx1, my0, my1, h0, h1, mat) => {
    const a = W(mx0, my0), b = W(mx1, my1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(b.x - a.x), (h1 - h0) * K, Math.abs(b.z - a.z)), mat);
    m.position.set((a.x + b.x) / 2, (h0 + h1) / 2 * K, (a.z + b.z) / 2);
    scene.add(m);
    return m;
  };
  // 바닥 (타일)
  const a = W(0, 0), b = W(MW, MH);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(b.x - a.x), Math.abs(b.z - a.z)),
    new THREE.MeshLambertMaterial({ map: _rpFieldTex(mine) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  scene.add(ground);
  // 돌 — 필드 벽과 같은 12px 돌 타일 (텍스처는 필드 것을 복제해 반복만 다르게)
  const stone = (lenPx, hPx) => {
    let map = null;
    if (typeof _t3dWallTexture === 'function') {
      map = _t3dWallTexture().clone();
      map.needsUpdate = true;
      map.repeat.set(lenPx / 192, hPx / 192);
    }
    return new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : 0x8e96a6 });
  };
  // 섬 몸통 — 바닥 아래 수면까지. 앞쪽(아래 변)은 나무 부두 (필드와 같은 널마루)
  box(-T, MW + T, -T, MH, -HB.sea, -0.5, stone(MW, HB.sea));
  // 부두 · 선착장 · 등불 · 섬 가장자리(잔디 블록 — 필드와 같은 목록)
  const mats = {};
  const matOf = c => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({ color: c }));
  if (typeof t3dIslandBoxes === 'function') scene.add(_rpBoxesMesh(t3dIslandBoxes(), W, K));
  if (typeof t3dQuayBoxes === 'function') t3dQuayBoxes().forEach(q => box(q.x0, q.x1, q.y0, q.y1, q.h0, q.h1, matOf(q.color)));
  (HB.piers || []).forEach(p => {
    if (typeof t3dPierBoxes === 'function') t3dPierBoxes(p).forEach(q => box(q.x0, q.x1, q.y0, q.y1, q.h0, q.h1, matOf(q.color)));
    if (typeof _t3dGlowSprite === 'function') {
      const l = _t3dGlowSprite(0xffc36b, 34 * K), w = W(p.x + p.w / 2 - 1, MH + T + HB.reach - 5);
      l.position.set(w.x, 50 * K, w.z);
      scene.add(l);
    }
  });
  // 요트 — 맵 +y(앞쪽)가 컷씬의 +x
  const yachts = [];
  (HB.yachts || []).forEach(y => {
    if (typeof t3dBuildYacht !== 'function') return;
    const boat = t3dBuildYacht(y.len);
    const w = W(y.x, y.y);
    boat.scale.setScalar(K);
    boat.position.set(w.x, -SEA, w.z);
    boat.rotation.y = Math.PI / 2 + y.yaw;
    scene.add(boat);
    yachts.push({ boat, ph: y.ph });
  });
  // 바다 · 하늘
  const i0 = W(-T, -T), i1 = W(MW + T, MH + T);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
    _rpSeaMat(new THREE.Vector4(Math.min(i0.x, i1.x), Math.min(i0.z, i1.z), Math.max(i0.x, i1.x), Math.max(i0.z, i1.z))));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set((i0.x + i1.x) / 2, -SEA, (i0.z + i1.z) / 2);
  scene.add(sea);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(250, 32, 16), _rpSkyMat());
  sky.renderOrder = -1;
  scene.add(sky);
  return {
    step(sec, cam) {
      sea.material.uniforms.uTime.value = sec;
      sky.material.uniforms.uTime.value = sec;
      sky.position.copy(cam.position);
      yachts.forEach(y => {
        y.boat.position.y = -SEA + Math.sin(sec * 1.3 + y.ph) * 1.6 * K;
        y.boat.rotation.z = Math.sin(sec * 0.9 + y.ph) * 0.05;
      });
    }
  };
}

/**
 * 컷씬을 띄운다.
 * @param {object} o
 *   mine    이 화면 기준 내 리퍼인가 (포탈 뒤 타워·바닥 색)
 *   name    소환한 플레이어 이름
 *   leftMs  남은 길이 (늦게 받은 화면은 그만큼 앞을 건너뛴다)
 *   onEnd   끝났을 때
 * @returns {boolean} 띄웠으면 true (WebGL이 없으면 false — 부르는 쪽은 그냥 진행)
 */
function reaperCutscene(o) {
  if (typeof THREE === 'undefined') return false;
  if (_rpCut) _rpCutEnd(true);
  const total = REAPER_CUT_MS;
  const left = Math.max(0, Math.min(total, o.leftMs ?? total));
  if (left < 300) { o.onEnd?.(); return false; }

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { o.onEnd?.(); return false; }
  if (!renderer.getContext()) { o.onEnd?.(); return false; }
  renderer.localClippingEnabled = true;

  const W = window.innerWidth, H = window.innerHeight;
  const wrap = document.createElement('div');
  wrap.className = 'reaper-cut';
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H);
  renderer.domElement.className = 'reaper-cut-canvas';
  wrap.appendChild(renderer.domElement);
  const mk = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; wrap.appendChild(d); return d; };
  const vignette = mk('reaper-cut-vignette');
  const title = mk('reaper-cut-title',
    `<span class="rct-name">${typeof t === 'function' ? t('card_grim_reaper_name') : 'Grim Reaper'}</span>` +
    (o.name ? `<span class="rct-by">${String(o.name).replace(/[<>&"]/g, '')}</span>` : ''));
  const black = mk('reaper-cut-black');
  const flash = mk('reaper-cut-flash');
  const slashLine = mk('reaper-cut-slash');
  document.body.appendChild(wrap);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1528);
  scene.fog = new THREE.Fog(0x0d1528, 26, 95);           // 먼 섬 끝이 수평선 안개 빛으로 스며든다
  const cam = new THREE.PerspectiveCamera(42, W / H, 0.05, 400);

  // 조명은 필드(towers3d.js)와 같게 — 달빛(차가운 빛) · 하늘빛. 달이 있는 쪽(앞 왼쪽 위)에서 테두리 빛
  scene.add(new THREE.HemisphereLight(0xc4d4f4, 0x23304c, 0.9));
  const key = new THREE.DirectionalLight(0xe4ecff, 0.78);
  key.position.set(0.55, 1.1, 0.55);
  scene.add(key);
  const moonRim = new THREE.DirectionalLight(0x9fc2ff, 0.45);
  moonRim.position.copy(RP_MOON_DIR);
  scene.add(moonRim);
  const PX = 0, PZ = -2.6, PY = 1.25;                  // 포탈 자리 (소환한 칸)
  const back = new THREE.PointLight(0xff3040, 0, 3.2);  // 포탈에서 새어 나오는 붉은 빛 (타워까지는 닿지 않게)
  back.position.set(PX, PY, PZ + 0.3);
  scene.add(back);
  const face = new THREE.PointLight(0x9d6bff, 0, 2.5);  // 눈빛이 켜질 때 얼굴을 보랏빛으로
  scene.add(face);

  // 바닥 · 타워 셋 — 필드와 똑같은 건물을 필드와 같은 칸 배치로 세운다 (체력 숫자는 없다).
  // 카메라는 상대 진영 쪽에서 소환한 사람의 진영을 바라본다 — 문(상대를 향한 면)이 카메라를 본다.
  // 1칸 = TS (필드의 100px = 건물 배율 0.021 × 100). 포탈은 소환한 칸 (너무 멀면 타워 앞 두 칸쯤으로 당긴다)
  const TS = 2.1;
  const TT = { left: [4, 2], king: [3, 4], right: [4, 6] };
  const LANE_COL = { 2: 4, 4: 3, 6: 4 };
  const row0 = o.tile?.row ?? 4;
  const laneCol = LANE_COL[row0] ?? 4;
  const col0 = laneCol + Math.min(Math.max((o.tile?.col ?? laneCol + 1) - laneCol, 1), 2.2);
  const toX = row => PX + (row - row0) * TS;
  const toZ = col => PZ + (col - col0) * TS;
  // 필드와 같은 섬 (16×9 칸 · 돌벽 · 부두 · 선착장 · 요트) 과 바다 · 밤하늘 — 맵 (x, y) px → 컷씬 (z, x)
  const arena = _rpBuildArena(scene,
    (mx, my) => ({ x: PX + (my / 100 - 0.5 - row0) * TS, z: PZ + (mx / 100 - 0.5 - col0) * TS }), TS / 100, o.mine);
  const cutTowers = [];
  if (typeof towers3dBuildLike === 'function') {
    Object.entries(TT).forEach(([pos, [c, r]]) => {
      if (o.alive && o.alive[pos] === false) return;   // 무너진 타워는 없다
      const tw = towers3dBuildLike(!!o.mine, pos, 'front');
      tw.scale.setScalar(0.021);
      tw.position.set(toX(r), 0, toZ(c));
      scene.add(tw);
      cutTowers.push(tw);
    });
  }

  // 포탈 (가장자리 밖 촉수까지 그리려고 판을 크게 둔다 — 셰이더 안에서 0.62가 가장자리)
  const portalMat = _rpPortalMat();
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), portalMat);
  portal.position.set(PX, PY, PZ);
  scene.add(portal);
  const PR = 4.2 / 2 * 0.62;                            // 월드 기준 포탈 반지름
  // 번개
  const bolts = [];
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
      color: i % 2 ? 0xffe2e2 : 0xff3348, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
    l.position.set(PX, 0, PZ);
    scene.add(l);
    bolts.push(l);
  }
  // 빨려 드는 부스러기
  const motes = new THREE.Group();
  for (let i = 0; i < 46; i++) {
    const sp = new THREE.Sprite(_rpGlowMat(i % 3 ? 0xffd0d0 : 0xff2a3c, 0));
    sp.userData = { a: Math.random() * Math.PI * 2, s: 0.5 + Math.random(), o: Math.random() };
    motes.add(sp);
  }
  motes.position.set(PX, PY, PZ + 0.05);
  scene.add(motes);
  // 바닥 — 충격파 고리와 포탈 아래 보랏빛 웅덩이
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 64), new THREE.MeshBasicMaterial({
    color: 0xff4455, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  shock.rotation.x = -Math.PI / 2;
  shock.position.set(PX, 0.02, PZ);
  scene.add(shock);
  const pool = new THREE.Sprite(_rpGlowMat(0xc0101e, 0));
  pool.scale.set(4.5, 1.2, 1);
  pool.position.set(PX, 0.05, PZ + 0.3);
  scene.add(pool);
  // 해골 영혼 — 리퍼 둘레를 돈다 (카드 그림 배경의 해골들)
  const ghosts = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: _rpSkullTex(), color: 0x9d7bff, transparent: true, opacity: 0,
                                                          blending: THREE.AdditiveBlending, depthWrite: false }));
    g.userData = { a: (i / 5) * Math.PI * 2, y: 0.9 + (i % 3) * 0.45, s: 0.26 + (i % 2) * 0.1 };
    scene.add(g);
    ghosts.push(g);
  }

  // 리퍼 — 포탈 면 뒤쪽은 잘라서, 면을 뚫고 나오는 것처럼 보이게 한다
  const rp = reaperBuild(11);
  rp.scale.setScalar(1.18);
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, 1), -PZ);   // z >= PZ 만 그린다
  rp.traverse(m => { if (m.material) { m.material.clippingPlanes = [clip]; m.material.clipping = true; } });
  scene.add(rp);
  const trail = reaperTrailCreate();
  scene.add(trail);

  // 시간표 (ms)
  // 휘두르기는 1.5초 — 치켜들고(0.35) 잠깐 멈칫했다가(0.5까지) 내리치는 구간을 늘려 슬로모션처럼 보인다
  const T = { tear: 300, open: 750, emerge: 1700, emergeEnd: 3900, look: 3700, lookEnd: 4550,
              swing: 4600, swingEnd: 6100, cut: 5640, end: total };
  const SW = T.swingEnd - T.swing;
  const swingOf = ms => {
    if (ms < 0) return null;
    const k = Math.min(1, ms / SW);
    if (k < 0.35) return k / 0.35 * 0.4;
    if (k < 0.5) return 0.4;
    if (k < 0.82) return 0.4 + (k - 0.5) / 0.32 * 0.22;
    return 0.62 + (k - 0.82) / 0.18 * 0.38;
  };
  const start = performance.now() - (total - left);
  const ease = k => k * k * (3 - 2 * k);
  const lerp = (a, b, k) => a + (b - a) * k;
  const cl = k => Math.max(0, Math.min(1, k));
  let lastBolt = 0, split = null;

  // 화면 가르기 — 베는 순간의 한 장을 두 조각으로 잘라 벌린다 (그 뒤는 3D를 그리지 않는다)
  const doSplit = () => {
    const cv = renderer.domElement;
    const ang = 24 * Math.PI / 180;                     // 왼쪽 위 → 오른쪽 아래
    const w = cv.clientWidth, h = cv.clientHeight;
    const dy = Math.tan(ang) * w / 2;
    const halves = [0, 1].map(i => {
      const c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      c.getContext('2d').drawImage(cv, 0, 0);
      c.className = 'reaper-cut-half';
      c.style.clipPath = i === 0
        ? `polygon(0 0, 100% 0, 100% ${(h / 2 + dy) / h * 100}%, 0 ${(h / 2 - dy) / h * 100}%)`
        : `polygon(0 ${(h / 2 - dy) / h * 100}%, 100% ${(h / 2 + dy) / h * 100}%, 100% 100%, 0 100%)`;
      wrap.insertBefore(c, vignette);
      return c;
    });
    cv.style.visibility = 'hidden';
    wrap.classList.add('reaper-cut-open');              // 바탕을 비워 필드가 비친다
    split = { halves, nx: -Math.sin(ang), ny: Math.cos(ang) };
  };

  const step = () => {
    if (!_rpCut || _rpCut.wrap !== wrap) return;
    const e = performance.now() - start;
    if (e >= total) { _rpCutEnd(false); return; }
    _rpCut.raf = requestAnimationFrame(step);

    // ── 화면이 갈라진 뒤 — 두 조각이 벌어지며 사라진다 ──
    if (split) {
      const k = cl((e - T.cut) / (T.end - T.cut - 80));
      const d = ease(k) * Math.max(W, H) * 0.55;
      split.halves.forEach((c, i) => {
        const sgn = i === 0 ? -1 : 1;
        c.style.transform = `translate(${(split.nx * d * sgn).toFixed(1)}px, ${(split.ny * d * sgn).toFixed(1)}px) rotate(${(sgn * k * 3).toFixed(2)}deg)`;
        c.style.opacity = (1 - k * k).toFixed(3);
      });
      slashLine.style.opacity = (1 - cl(k * 3)).toFixed(3);
      title.style.opacity = (1 - cl(k * 2)).toFixed(3);
      vignette.style.opacity = (1 - cl(k * 2)).toFixed(3);
      flash.style.opacity = (Math.max(0, 0.7 - k * 4)).toFixed(3);
      return;
    }

    // 암전 — 처음
    black.style.opacity = (e < T.tear ? 1 : 1 - cl((e - T.tear) / 220)).toFixed(3);

    // 포탈 — 세로 균열 → 둥글게 열림
    const tearK = ease(cl((e - T.tear) / 380));
    const openK = cl((e - T.tear) / 200);
    const roundK = ease(cl((e - T.open + 250) / 550));
    portalMat.uniforms.uTime.value = e / 1000;
    portalMat.uniforms.uOpen.value = openK;
    portalMat.uniforms.uTear.value = 0.03 + roundK * 0.97;
    portal.scale.set(1, 0.25 + tearK * 0.75, 1);
    portal.rotation.z = -e / 1400;
    back.intensity = 1.6 * roundK;
    pool.material.opacity = 0.7 * roundK;
    // 번개 — 열릴 때 가장 많이
    if (e - lastBolt > 70) {
      lastBolt = e;
      bolts.forEach(l => {
        const on = e > T.tear && Math.random() < (e < T.emergeEnd ? 0.75 : 0.35);
        l.material.opacity = on ? 0.9 : 0;
        if (on) _rpBolt(l, 0, PY, PR * portal.scale.y);   // l은 이미 포탈 x에 놓여 있다
      });
    }
    // 충격파 — 둥글게 열리는 순간 바닥을 훑는다
    const sk = cl((e - T.open) / 700);
    shock.scale.setScalar(0.3 + sk * 6);
    shock.material.opacity = sk > 0 && sk < 1 ? (1 - sk) * 0.9 : 0;
    // 부스러기 — 소용돌이치며 빨려 든다
    motes.children.forEach(sp => {
      const d = sp.userData;
      const ph = ((e / 1000) * d.s * 0.6 + d.o) % 1;
      const r = (1 - ph) * 2.2 + 0.2;
      const a = d.a + ph * 5;
      sp.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.9, (1 - ph) * 0.6);
      sp.scale.setScalar(0.04 + (1 - ph) * 0.05);
      sp.material.opacity = Math.sin(ph * Math.PI) * roundK;
    });

    // 리퍼 — 포탈을 뚫고 천천히 미끄러져 나온다 (걷지 않는다 — 앞으로 기운 채 떠서 다가온다)
    const wk = cl((e - T.emerge) / (T.emergeEnd - T.emerge));
    const wke = wk * wk * (3 - 2 * wk) * 0.6 + wk * 0.4;       // 처음과 끝만 살짝 부드럽게, 대체로 일정한 속도
    const z = lerp(PZ - 1.1, 0.25, wke);
    const rx = PX;
    rp.position.set(rx, 0, z);
    rp.rotation.y = lerp(0.35, 0.08, wke);                       // 카메라 쪽으로 몸을 돌리며 나온다
    const lookK = ease(cl((e - T.look) / (T.lookEnd - T.look)));
    const swingK = swingOf(e - T.swing);
    const pose = { t: e, glide: wk > 0 && wk < 1, swing: swingK, look: swingK != null ? lookK * (1 - cl(swingK * 3)) : lookK };
    reaperPose(rp, pose);
    const eyeK = cl((e - T.look - 250) / 250);
    reaperEyes(rp, 0.25 + eyeK * 0.75);
    face.intensity = eyeK * 0.5;
    face.position.set(rx, 1.72, z + 0.45);
    if (swingK != null) {
      reaperTrailUpdate(trail, rp, ago => swingOf(e - ago - T.swing), pose, 16);
    } else {
      trail.visible = false;
    }

    // 해골 영혼
    ghosts.forEach((g, i) => {
      const d = g.userData;
      const k = cl((e - T.emerge - 300) / 600) * (1 - cl((e - T.swing) / 500));
      const a = d.a + e / 900;
      g.position.set(rx + Math.cos(a) * 1.25, d.y + Math.sin(e / 500 + i) * 0.1, z + Math.sin(a) * 0.9);
      g.scale.setScalar(d.s);
      g.material.opacity = k * 0.38;
    });

    // 카메라 — 첫 장면은 넓게: 타워와 그 왼쪽 앞의 포탈이 함께 보인다 (천천히 다가간다)
    //        → 나오는 리퍼를 따라 낮게 → 얼굴 쪽으로 다가가되 전신이 다 보이게(살짝 기울임) → 휘두를 땐 물러나며 흔들림
    const k0 = ease(cl(e / T.emergeEnd));
    let cx = lerp(PX + 3.4, PX + 2.4, k0), cy = lerp(4.4, 3.2, k0), cz = lerp(PZ + 10.5, PZ + 8.2, k0);
    let lx = lerp(PX - 0.4, PX - 0.2, k0), ly = 1.5, lz = lerp(PZ - 3.2, PZ - 2.2, k0), roll = 0;
    if (e > T.emerge) {
      const k = ease(cl((e - T.emerge) / (T.emergeEnd - T.emerge + 300)));
      cx = lerp(cx, rx + 1.1, k); cy = lerp(cy, 1.25, k); cz = lerp(cz, z + 4.6, k);
      lx = lerp(lx, rx, k); ly = lerp(ly, 1.3, k); lz = lerp(lz, z, k);
    }
    if (e > T.look) {
      cx = lerp(cx, rx + 0.35, lookK); cy = lerp(cy, 1.45, lookK); cz = lerp(cz, z + 3.9, lookK);
      lx = lerp(lx, rx, lookK); ly = lerp(ly, 1.22, lookK); lz = z;
      roll = lookK * 0.05;
    }
    if (swingK != null) {
      const k = ease(cl((e - T.swing) / (SW * 0.55)));
      cx = lerp(rx + 0.35, rx - 0.5, k); cy = lerp(1.45, 1.35, k); cz = lerp(z + 3.9, z + 5.0, k); lx = rx; ly = lerp(1.22, 1.38, k);
      roll = lerp(0.05, -0.04, k);
      if (swingK > 0.45 && swingK < 0.7) { cx += (Math.random() - 0.5) * 0.06; cy += (Math.random() - 0.5) * 0.06; }
    }
    cam.position.set(cx, cy, cz);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.lookAt(lx, ly, lz);

    // 번쩍임 — 균열이 열릴 때(보라) · 눈이 켜질 때 · 베는 순간(흰)
    const fTear = Math.max(0, 1 - Math.abs(e - T.tear - 60) / 160) * 0.7;
    const fEye = Math.max(0, 1 - Math.abs(e - T.look - 380) / 140) * 0.25;
    flash.style.opacity = Math.max(fTear, fEye).toFixed(3);
    flash.classList.toggle('violet', e < T.look);

    // 이름 — 얼굴이 보일 때 박힌다
    const tk = cl((e - T.look - 250) / 260);
    title.style.opacity = tk.toFixed(3);
    title.style.transform = `translate(-50%, 0) scale(${(1.35 - 0.35 * ease(tk)).toFixed(3)})`;
    title.style.filter = `blur(${((1 - tk) * 6).toFixed(1)}px)`;

    arena.step(e / 1000, cam);
    renderer.render(scene, cam);

    // 베는 순간 — 화면을 가르는 빛줄기, 그리고 이 장면을 두 조각으로
    if (e >= T.cut) {
      slashLine.classList.add('on');
      flash.classList.remove('violet');
      flash.style.opacity = '0.75';
      doSplit();
    }
  };

  const onResize = () => {
    if (split) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    _rpFitCam(cam, w / h);
  };
  window.addEventListener('resize', onResize);
  _rpCut = { wrap, renderer, scene, raf: 0, onEnd: o.onEnd, onResize };
  _rpFitCam(cam, W / H);
  step();
  return true;
}

function _rpCutEnd(silent) {
  const c = _rpCut;
  if (!c) return;
  _rpCut = null;
  cancelAnimationFrame(c.raf);
  window.removeEventListener('resize', c.onResize);
  c.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map && !o.material.map._rpShared) o.material.map.dispose(); o.material.dispose(); }
  });
  c.renderer.dispose();
  c.renderer.forceContextLoss?.();
  c.wrap.classList.add('reaper-cut-out');
  setTimeout(() => c.wrap.remove(), 260);
  if (!silent) c.onEnd?.();
}

/** 경기가 끝나는 등 — 컷씬을 바로 걷는다 */
function reaperCutsceneStop() { _rpCutEnd(true); }
