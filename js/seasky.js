// ============================================================
//  seasky.js — 게임 필드 뒤의 배경: 밤바다 + 밤하늘 (2026-10-02)
//
//  필드(돌벽으로 둘러싼 섬)를 땅으로 삼아, 그 땅과 같은 평면에 바다가 펼쳐진다.
//    · 바다 — 필드 바닥판(.ground)과 똑같은 원근(perspective · rotateX)으로 누운 물.
//      화면의 점마다 그 원근을 거꾸로 풀어 '바닥 좌표'를 구하고, 물결은 그 바닥 좌표에 그린다.
//      그래서 맵을 끌거나 확대·축소하면 바다도 필드와 한 몸으로 같이 움직이고 커진다.
//      돌벽 밑동에는 물이 부딪혀 거품이 일고, 섬 가까이는 얕아서 물빛이 밝다.
//    · 수평선 — 진짜 원근대로라면 수평선이 맵 위로 3000px 넘게 떨어져 있어 볼 수가 없다.
//      그래서 필드 먼 쪽 끝(벽)부터는 두 번째 원근으로 이어 붙여(기울기·폭이 끝에서 맞물린다)
//      벽 너머 조금 위에 수평선이 오게 했다. 그 위가 밤하늘이다.
//    · 하늘 — 수평선에 붙어 있다. 별 · 엷은 구름 · 달(맵 오른쪽 위)과 달무리, 달빛 길이 바다에 비친다.
//  화면 전체를 덮는 셰이더 한 장(WebGL 원본 API — 필드의 three.js와 따로 논다).
//  평소에는 30fps로 그리지만, 맵이 움직인 프레임은 바로 그려서 필드와 어긋나지 않는다.
// ============================================================
(function initSeaSky() {
  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform vec2  uRes;      // 화면(뷰포트) 크기 — 레이아웃 px
    uniform vec2  uPan;      // 타일 맵의 translate (레이아웃 px)
    uniform float uZoom;     // 타일 맵의 scale
    uniform float uD, uSa, uCa;          // 바닥판 원근: perspective(d), sin/cos(tilt)
    uniform float uYtop, uYh, uSEdge, uC; // 먼 쪽 끝의 화면 높이 · 수평선 높이 · 끝의 폭 비율 · 이어 붙인 원근의 세기
    const vec2 HALF = vec2(800.0, 450.0); // 맵 반 크기
    const vec2 ISLE = vec2(826.0, 476.0); // 돌벽 · 앞쪽 부두 바깥 면까지 (맵 + 두께 26)
    uniform float uDrop;                 // 수면이 섬 바닥보다 낮은 정도 (towers3d.js T3D_HARBOR.sea)
    uniform vec4  uPier[2];              // 선착장 바닥 자리 (x0, y0, x1, y1) — 맵 가운데 기준
    uniform vec4  uYacht[2];             // 요트 (x, y, 길이, 방향)

    // 화면 높이 Y(맵 가운데 기준) → 바닥 v · 그 자리의 폭 비율 s · 화면 1px당 바닥 px · 이어 붙인 원근 안에서의 깊이
    float groundV(float Y, out float s, out float dvdy, out float far) {
      far = 0.0;
      if (Y >= uYtop) {
        float den = uD * uCa + Y * uSa;
        float v = Y * uD / den;
        s = uD / (uD - v * uSa);
        dvdy = uD * uD * uCa / (den * den);
        return v;
      }
      // 필드 먼 끝 너머 — 이어 붙인 원근 (수평선에서 무한히 멀어진다)
      far = min((uYtop - Y) / (uYtop - uYh), 0.9999);
      s = uSEdge * (1.0 - far);
      dvdy = uC / (uYtop - uYh) / ((1.0 - far) * (1.0 - far));
      return -HALF.y - uC * far / (1.0 - far);
    }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    // fp — 화면 한 점이 덮는 크기(p 단위). 한 점에 물결이 여러 개 들어갈 만큼 멀면
    // 그 옥타브는 뺀다 — 안 그러면 멀리서 줄무늬(모아레)가 소실점으로 모여 보인다
    float fbm(vec2 p, float fp) {
      float v = 0.0, a = 0.5, f = 1.0;
      for (int i = 0; i < 5; i++) {
        float keep = clamp(1.6 - fp * f * 2.2, 0.0, 1.0);
        v += a * (noise(p) - 0.5) * keep;
        p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; f *= 2.03;
      }
      return v;
    }
    // 사인 물결 하나 — 파장의 1/4보다 화면 한 점이 크면 사라진다
    float swell(vec2 p, vec2 dir, float k, float w, float t, float fp) {
      return sin(dot(p, dir) * k + t * w) * clamp(2.0 - fp * k * 0.65, 0.0, 1.0);
    }

    vec3 skyCol(float h) {
      vec3 hor = vec3(0.075, 0.12, 0.23), mid = vec3(0.025, 0.045, 0.11), top = vec3(0.006, 0.01, 0.03);
      return mix(mix(hor, mid, smoothstep(0.0, 0.35, h)), top, smoothstep(0.3, 1.0, h));
    }

    // 물결 높이 — 바닥 좌표(맵 px / 130) 위의 여러 방향 긴 물결 + 바람 잔물결
    float waves(vec2 p, float t, float fp) {
      float h = 0.0;
      h += swell(p, vec2(0.9, 0.42), 1.6, 1.1, t, fp) * 0.35;
      h += swell(p, vec2(-0.5, 0.86), 2.3, 1.5, t, fp) * 0.22;
      h += swell(p, vec2(0.2, -1.0), 3.7, 2.1, t, fp) * 0.12;
      h += fbm(p * 1.8 + vec2(t * 0.35, -t * 0.22), fp * 1.8) * 0.55;
      return h;
    }

    float sparkleK(vec2 p, float t) { return smoothstep(0.35, 0.8, noise(p * 9.0 + vec2(0.0, t * 2.0))); }

    void main() {
      float t = uTime;
      vec2 L = vec2(vUv.x, 1.0 - vUv.y) * uRes;          // 화면 점 (레이아웃 px, 아래로 +)
      vec2 M = (L - uPan) / uZoom - HALF;                // 맵 가운데 기준 '화면에 보이는' 맵 px
      float hY = uPan.y + (HALF.y + uYh) * uZoom;        // 수평선의 화면 높이
      vec2 moon = vec2(uPan.x + 1330.0 * uZoom, hY - 70.0 - 150.0 * uZoom);
      float moonR = 15.0 + 22.0 * uZoom;
      vec3 col;

      if (M.y < uYh) {
        // ── 하늘 ── (수평선에 붙어 맵과 같이 오르내린다)
        float up = hY - L.y;
        float h = up / 420.0;
        col = skyCol(h);
        vec2 sp = vec2(L.x - uPan.x * 0.6, up) / 4.2;
        vec2 cell = floor(sp);
        float r = hash(cell);
        if (r > 0.9) {
          vec2 c = cell + 0.2 + 0.6 * vec2(hash(cell + 3.1), hash(cell + 7.7));
          float d = length(sp - c);
          float tw = 0.6 + 0.4 * sin(t * (1.5 + r * 3.0) + r * 40.0);
          float big = step(0.985, r);
          col += vec3(0.8, 0.86, 1.0) * smoothstep(0.55 + big * 0.35, 0.0, d) * (0.5 + big * 1.5) * tw * smoothstep(0.02, 0.2, h);
        }
        float cl = fbm(vec2((L.x - uPan.x * 0.6) / 230.0 + t * 0.012, up / 70.0), 0.0) + 0.5;
        float cloud = smoothstep(0.55, 0.8, cl) * smoothstep(0.0, 0.2, h) * (1.0 - smoothstep(0.8, 1.3, h));
        vec2 md = L - moon;
        float dm = length(md);
        float lit = exp(-dm / 260.0);
        col = mix(col, vec3(0.1, 0.13, 0.2) + vec3(0.35, 0.38, 0.45) * lit, cloud * 0.55);
        col += vec3(0.55, 0.62, 0.8) * exp(-dm / (moonR * 4.5)) * 0.35 + vec3(0.8, 0.85, 1.0) * exp(-dm / (moonR * 1.4)) * 0.25;
        if (dm < moonR) {
          vec2 q = md / moonR;
          float crater = fbm(q * 3.0 + 4.0, 0.0) + 0.5;
          vec3 moonC = mix(vec3(0.82, 0.85, 0.9), vec3(0.98, 0.97, 0.92), smoothstep(0.35, 0.7, crater));
          moonC *= 0.82 + 0.18 * (1.0 - length(q - vec2(-0.25, -0.25)));
          col = mix(col, moonC, smoothstep(moonR, moonR - 1.2, dm));
        }
        col += vec3(0.1, 0.14, 0.24) * exp(-up / 22.0) * 0.6;
      } else {
        // ── 바다 ── 화면 점 → 바닥 좌표(g, 맵 px). 필드 안은 .ground와 똑같은 원근을 푼다
        // 수면은 섬 바닥보다 uDrop 낮다 — 낮은 면은 화면에서 그만큼(카메라 고도 30°) 아래에 그려지므로,
        // 같은 화면 점이 보는 수면 자리는 조금 더 먼 쪽이다 (한 번 어림한 폭 비율로 고쳐 다시 푼다)
        float s, dvdy, far;
        groundV(M.y, s, dvdy, far);
        float v = groundV(M.y - uDrop * 0.866 * s, s, dvdy, far);
        vec2 g = vec2(M.x / s, v);                         // 바닥 좌표 (맵 가운데 0, 아래로 +)
        // 화면 1px이 덮는 바닥 px — 멀어질수록 앞뒤(세로)로 훨씬 길게 늘어난다
        float fp = max(1.0 / s, dvdy) / uZoom;
        float detail = clamp(1.6 - fp / 6.0, 0.0, 1.0);    // 거품·잔빛처럼 가는 무늬를 덜어 낸다
        vec2 p = g / 130.0;
        float fpp = fp / 130.0;
        float e = max(0.05, fpp);
        float h0 = waves(p, t, fpp);
        float hx = waves(p + vec2(e, 0.0), t, fpp), hz = waves(p + vec2(0.0, e), t, fpp);
        vec3 n = normalize(vec3(-(hx - h0) / e * 0.55, 1.0, -(hz - h0) / e * 0.55));
        // 내려다보는 각도 — 필드 위는 72°(바닥판이 18° 누웠다), 수평선으로 갈수록 눕는다
        float elev = mix(1.2566, 0.03, pow(far, 0.6));
        vec3 vv = normalize(vec3(0.0, sin(elev), cos(elev)));
        vec3 rf = reflect(-vv, n);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, vv), 0.0), 5.0);

        // 섬(돌벽 바깥 면)까지의 거리 — 얕은 물빛 · 밑동 그늘 · 부서지는 거품
        vec2 q = abs(g) - ISLE;
        float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
        float shallow = exp(-max(dist, 0.0) / 150.0);
        vec3 deep = vec3(0.004, 0.028, 0.065), mid = vec3(0.015, 0.075, 0.13), shoal = vec3(0.03, 0.17, 0.2);
        vec3 water = mix(deep, mid, smoothstep(-0.4, 0.5, h0));
        water = mix(water, shoal, shallow * 0.55);
        vec3 refl = skyCol(clamp(rf.y * 1.1, 0.0, 1.0));
        col = mix(water, refl, clamp(fres, 0.0, 1.0));

        // 달빛 길 — 달 아래 바다에 세로로 늘어진 반짝임 (가까울수록 넓게 흩어진다)
        float below = max(L.y - hY, 0.0);
        float dx = L.x - moon.x;
        float wid = 4.0 + moonR * 0.4 + below * 0.32;
        float path = exp(-dx * dx / (wid * wid)) * exp(-below / (900.0 * uZoom + 200.0));
        float sparkle = smoothstep(0.6, 0.95, noise(p * 5.0 + vec2(0.0, t * 1.3))) * smoothstep(0.0, 0.4, h0 + 0.25);
        col += vec3(0.75, 0.8, 0.95) * path * (0.1 + sparkle * 0.8 + pow(max(rf.y, 0.0), 3.0) * 0.3);
        // 물마루 거품 · 잔빛
        col += vec3(0.6, 0.7, 0.8) * smoothstep(0.5, 0.75, h0 + (noise(p * 9.0 + t) - 0.5) * 0.3 * detail) * 0.05 * detail;

        // 벽 밑동 — 벽 그늘로 조금 어둡고, 물이 부딪혀 하얗게 부서졌다 밀려 나간다
        if (dist > -2.0) {
          float wob = (noise(g / 26.0 + vec2(t * 0.8, -t * 0.6)) - 0.5) * 14.0;
          col *= mix(0.55, 1.0, smoothstep(0.0, 34.0, dist));
          float edge = smoothstep(11.0, 1.0, dist + wob * 0.7) * (0.45 + 0.55 * noise(g / 7.0 + t * 1.7));
          float lap = smoothstep(0.75, 1.0, sin(dist / 13.0 - t * 1.8 + wob * 0.15))
                    * smoothstep(80.0, 18.0, dist) * smoothstep(0.35, 0.7, noise(g / 22.0 - t * 0.3));
          col = mix(col, vec3(0.72, 0.8, 0.86), clamp(edge * 0.55 + lap * 0.3, 0.0, 1.0) * detail);
        }
        // 선착장 — 널빤지 밑 그늘, 말뚝 둘레 물결, 끝 등불이 물에 길게 비친다
        for (int i = 0; i < 2; i++) {
          vec4 r = uPier[i];
          vec2 c = clamp(g, r.xy, r.zw);
          float dIn = length(g - c);
          col *= mix(0.45, 1.0, smoothstep(0.0, 14.0, dIn));
          // 말뚝 — 양옆 42px마다
          float py = r.y + 22.0 + clamp(floor((g.y - r.y - 22.0) / 42.0 + 0.5), 0.0, 2.0) * 42.0;
          float dl = length(g - vec2(r.x - 1.5, py)), dr = length(g - vec2(r.z + 1.5, py));
          float dp = min(dl, dr);
          float ring = smoothstep(7.5, 4.5, dp) * 0.55 + smoothstep(0.75, 1.0, sin(dp / 3.0 - t * 3.0)) * smoothstep(22.0, 7.0, dp) * 0.3;
          col = mix(col, vec3(0.7, 0.78, 0.84), ring * detail);
          // 등불 (다리 끝 바깥 모서리) — 따뜻한 빛이 일렁이며 카메라 쪽으로 늘어진다
          vec2 lp = vec2(r.z - 1.0, r.w - 5.0);
          float ldx = g.x - lp.x + h0 * 9.0, ldy = g.y - lp.y;
          float streak = exp(-ldx * ldx / 40.0) * exp(-abs(ldy - 30.0) / 55.0) * (0.55 + 0.45 * sparkleK(p, t));
          float pool = exp(-dot(g - lp, g - lp) / 2600.0);
          col += vec3(1.0, 0.68, 0.32) * (streak * 0.55 + pool * 0.12);
        }
        // 요트 — 배 밑 그늘과 선체 둘레 물결
        for (int i = 0; i < 2; i++) {
          vec4 y = uYacht[i];
          vec2 d = g - y.xy;
          float cs = cos(y.w), sn = sin(y.w);
          vec2 l = vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
          float e = length(l / vec2(y.z * 0.19, y.z * 0.5));
          col *= mix(0.5, 1.0, smoothstep(0.8, 1.35, e));
          float bob = sin(t * 1.3 + float(i) * 2.1) * 0.04;
          float lapY = smoothstep(0.1, 0.0, abs(e - 1.12 - bob)) * 0.5 + smoothstep(0.08, 0.0, abs(e - 1.4 - bob * 2.0)) * 0.2;
          col = mix(col, vec3(0.7, 0.78, 0.84), lapY * detail * smoothstep(0.3, 0.6, noise(l / 9.0 + t)));
        }
        // 수평선 안개
        col = mix(col, vec3(0.06, 0.1, 0.19), smoothstep(0.82, 1.0, far) * 0.9);
      }
      gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);
    }`;

  const SCALE = 0.8;           // 조금 낮은 해상도로 그려 늘린다
  const FPS = 30;
  const HORIZON_GAP = 260;     // 필드 먼 끝(화면 위)에서 수평선까지 (맵 px)

  /** 바닥판 원근 — towers3d.js t3dGroundProject와 같은 CSS 변수(--field-tilt / --field-depth)를 읽는다 */
  function groundParams() {
    const map = document.getElementById('tile-map');
    const cs = map ? getComputedStyle(map) : null;
    const tilt = (parseFloat(cs?.getPropertyValue('--field-tilt')) || 18) * Math.PI / 180;
    const d = parseFloat(cs?.getPropertyValue('--field-depth')) || 1100;
    const sa = Math.sin(tilt), ca = Math.cos(tilt);
    const sEdge = d / (d + 450 * sa);                        // 먼 끝(v = -450)의 폭 비율
    const yTop = -450 * ca * sEdge;                          // 먼 끝이 화면에 그려지는 높이
    const dvdY = d * d * ca / Math.pow(d * ca + yTop * sa, 2);  // 먼 끝에서 화면 1px당 바닥 px
    const yH = yTop - HORIZON_GAP;
    return { d, sa, ca, sEdge, yTop, yH, c: dvdY * (yTop - yH) };
  }

  function start() {
    const host = document.querySelector('.game-map');
    if (!host || host.querySelector('#sea-sky')) return;
    const cv = document.createElement('canvas');
    cv.id = 'sea-sky';
    cv.className = 'sea-sky';
    host.insertBefore(cv, host.firstChild);
    const gl = cv.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) { cv.remove(); return; }        // WebGL이 없으면 예전 남색 배경 그대로
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[seasky]', gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { cv.remove(); return; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.remove(); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    for (const k of ['uTime', 'uRes', 'uPan', 'uZoom', 'uD', 'uSa', 'uCa', 'uYtop', 'uYh', 'uSEdge', 'uC', 'uDrop', 'uPier', 'uYacht']) U[k] = gl.getUniformLocation(prog, k);

    let gp = null;
    const resize = () => {
      const w0 = cv.offsetWidth, h0 = cv.offsetHeight;      // 레이아웃 px (맵 이동·확대와 같은 단위)
      const r = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(2, Math.round(r.width * dpr * SCALE)), h = Math.max(2, Math.round(r.height * dpr * SCALE));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
      gl.uniform2f(U.uRes, w0 || 1, h0 || 1);
      if (!gp && document.getElementById('tile-map')) {
        gp = groundParams();
        gl.uniform1f(U.uD, gp.d); gl.uniform1f(U.uSa, gp.sa); gl.uniform1f(U.uCa, gp.ca);
        gl.uniform1f(U.uYtop, gp.yTop); gl.uniform1f(U.uYh, gp.yH);
        gl.uniform1f(U.uSEdge, gp.sEdge); gl.uniform1f(U.uC, gp.c);
        // 섬 둘레 (towers3d.js) — 맵 가운데 기준으로 옮겨 넘긴다
        const HB = typeof T3D_HARBOR !== 'undefined' ? T3D_HARBOR : null;
        gl.uniform1f(U.uDrop, HB ? HB.sea : 0);
        const pier = [], yacht = [];
        for (let i = 0; i < 2; i++) {
          const p = HB?.piers[i], y = HB?.yachts[i];
          const y0 = 900 + (HB?.wall || 0), y1 = y0 + (HB?.reach || 0);
          pier.push(...(p ? [p.x - p.w / 2 - 800, y0 - 450, p.x + p.w / 2 - 800, y1 - 450] : [9e4, 9e4, 9e4, 9e4]));
          yacht.push(...(y ? [y.x - 800, y.y - 450, y.len, y.yaw] : [9e4, 9e4, 1, 0]));
        }
        gl.uniform4fv(U.uPier, pier);
        gl.uniform4fv(U.uYacht, yacht);
      }
    };
    // 지금 타일 맵의 이동·확대 (board.js의 _panX / _panY / _zoom)
    const view = () => (typeof _zoom === 'number') ? [_panX, _panY, _zoom] : [0, 0, 1];
    const t0 = performance.now();
    let last = 0, lastView = '';
    const frame = now => {
      requestAnimationFrame(frame);
      if (document.hidden) return;
      if (!cv.isConnected || !cv.offsetWidth) return;     // 게임 화면이 아직 안 보인다
      const [px, py, z] = view();
      const key = `${Math.round(px)},${Math.round(py)},${z}`;
      // 맵이 움직였으면 바로 그린다 — 필드와 바다가 한 프레임이라도 어긋나면 섬이 떠 보인다
      if (key === lastView && now - last < 1000 / FPS) return;
      last = now;
      lastView = key;
      resize();
      gl.uniform2f(U.uPan, Math.round(px), Math.round(py));
      gl.uniform1f(U.uZoom, z);
      gl.uniform1f(U.uTime, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    requestAnimationFrame(frame);
    window.seaSkyReady = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
