# fx/forest.svg 생성 — 풀 포기 위치를 손으로 적기엔 많아서 만들어 낸다 (시드 고정)
import io, math, random

random.seed(7)
CX = CY = 400.0
R   = 275.0           # 사거리(300)보다 조금 작게. 타일맵 기준 이웃 타워까지 224, 반대쪽 끝까지 400이므로
                      # 가운데에 놓으면 3개, 위/아래에 놓으면 2개만 범위에 들어온다
                      # 가운데에 놓으면 3개, 위/아래에 놓으면 2개만 범위에 들어온다
                      # 가운데에 놓으면 3개, 위/아래에 놓으면 2개만 범위에 들어온다

def f(v): return f'{v:.1f}'

tufts = []
for i in range(34):
    a = random.uniform(0, 360)
    rr = math.sqrt(random.uniform(0.06, 1.0)) * (R - 26)
    x = CX + rr * math.cos(math.radians(a))
    y = CY + rr * math.sin(math.radians(a)) * 0.92      # 아주 살짝만 눌러 바닥처럼 (위아래 타워도 덮어야 한다)
    lean = random.uniform(-16, 16)
    sc   = random.uniform(0.75, 1.25)
    grp  = i % 4
    delay = 0.08 + (rr / R) * 0.55 + random.uniform(0, 0.12)
    tufts.append((x, y, lean, sc, grp, delay))

leaves = []
for i in range(7):
    a = random.uniform(0, 360)
    rr = math.sqrt(random.uniform(0.05, 0.9)) * (R - 60)
    x = CX + rr * math.cos(math.radians(a))
    y = CY + rr * math.sin(math.radians(a)) * 0.92
    leaves.append((x, y, random.uniform(-70, 70), random.uniform(-150, -90),
                   random.uniform(-220, 220), random.uniform(0.3, 2.4), random.uniform(0.6, 1.0)))

tuft_css = '\n'.join(
    f'    .t{i} {{ animation-delay: {d:.2f}s, {d + 0.9:.2f}s; }}'
    for i, (_, _, _, _, _, d) in enumerate(tufts))

leaf_css = '\n'.join(
    f'''    @keyframes lf{i} {{
      0%   {{ transform: translate(0,0) rotate(0deg) scale(0.6); opacity: 0; }}
      15%  {{ opacity: 0.9; }}
      100% {{ transform: translate({dx:.0f}px,{dy:.0f}px) rotate({rot:.0f}deg) scale(1); opacity: 0; }}
    }}
    .lf{i} {{ animation: lf{i} 2.6s ease-out {delay:.2f}s infinite; }}'''
    for i, (_, _, dx, dy, rot, delay, _) in enumerate(leaves))

tuft_svg = '\n'.join(
    f'  <g transform="translate({f(x)} {f(y)}) rotate({f(lean)}) scale({sc:.2f})">'
    f'<g class="tuft t{i} g{grp}"><use href="#grass"/></g></g>'
    for i, (x, y, lean, sc, grp, _) in enumerate(tufts))

leaf_svg = '\n'.join(
    f'  <g transform="translate({f(x)} {f(y)})"><g class="leaf lf{i}" style="transform-box: fill-box; transform-origin: 50% 50%;">'
    f'<use href="#leaf" transform="scale({sc:.2f})"/></g></g>'
    for i, (x, y, _, _, _, _, sc) in enumerate(leaves))

svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<!--
  숲의정령(forest_spirit) — cards.js의 cast: 'forest'
  기준점(타워 중심) = (400, 400) · 반지름 380 (타워 3개가 들어가는 원) · 전체 길이 5.4초
  설치형 회복이라 회복(5초)이 도는 동안 토템이 남아 있는다.
  가운데 나무를 기준으로 초록 초원이 깔리고, 토템 고리가 천천히 돌며 풀이 돋는다.
  ※ 이 파일은 fx/forest.gen.py가 만들어 낸다 — 손으로 고치지 말고 그 스크립트를 고쳐 다시 실행할 것
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <defs>
    <radialGradient id="fGround">
      <stop offset="0%"   stop-color="#b9f7c8" stop-opacity="0.34"/>
      <stop offset="45%"  stop-color="#6fd98c" stop-opacity="0.24"/>
      <stop offset="82%"  stop-color="#3fae6a" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#2f9158" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fBlade" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%"   stop-color="#3da65f"/>
      <stop offset="60%"  stop-color="#7fe09a"/>
      <stop offset="100%" stop-color="#d6ffe3"/>
    </linearGradient>
    <filter id="fSoft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="0.7"/>
    </filter>
    <filter id="fHalo" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3" result="g"/>
      <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <!-- 풀 한 포기 (밑동이 0,0) -->
    <g id="grass" filter="url(#fSoft)" fill="none" stroke="url(#fBlade)" stroke-width="3" stroke-linecap="round">
      <path d="M 0 0 C 1 -8 3 -14 6 -19"/>
      <path d="M 0 0 C 0 -10 0 -17 -1 -23"/>
      <path d="M 0 0 C -1 -8 -4 -13 -7 -17"/>
    </g>

    <!-- 떠오르는 잎 -->
    <g id="leaf">
      <path d="M 0 0 C 5 -4 9 -9 8 -14 C 4 -14 -1 -10 -2 -5 Z" fill="#9dedb4" opacity="0.9"/>
    </g>
  </defs>

  <style>
    .all, .ground, .ring, .tree {{ transform-box: view-box; transform-origin: 400px 400px; }}

    /* 끝날 때 통째로 스르륵 사라진다 */
    .all {{ animation: fade 5.4s linear both; }}
    @keyframes fade {{
      0%, 87% {{ opacity: 1; }}
      100%    {{ opacity: 0; }}
    }}

    /* 초원이 깔린다 */
    .ground {{ animation: ground 0.55s cubic-bezier(0.2, 0.9, 0.3, 1) both; }}
    @keyframes ground {{
      0%   {{ transform: scale(0.15); opacity: 0; }}
      70%  {{ transform: scale(1.04); opacity: 1; }}
      100% {{ transform: scale(1);    opacity: 1; }}
    }}

    /* 토템 고리 — 두 겹이 반대로 천천히 돈다 */
    .ring-out {{ animation: ringin 0.6s ease-out 0.1s both, spin 26s linear 0.1s infinite; }}
    .ring-in  {{ animation: ringin 0.6s ease-out 0.2s both, spinb 19s linear 0.2s infinite; }}
    @keyframes ringin {{
      0%   {{ opacity: 0; }}
      100% {{ opacity: 1; }}
    }}
    @keyframes spin  {{ from {{ transform: rotate(0deg); }}   to {{ transform: rotate(360deg); }} }}
    @keyframes spinb {{ from {{ transform: rotate(0deg); }}   to {{ transform: rotate(-360deg); }} }}

    /* 풀이 돋아 바람에 흔들린다 */
    .tuft {{
      transform-box: fill-box;
      transform-origin: 50% 100%;
      animation-name: grow, sway;
      animation-duration: 0.5s, 3.2s;
      animation-timing-function: cubic-bezier(0.2, 0.9, 0.3, 1), ease-in-out;
      animation-fill-mode: both, both;
      animation-iteration-count: 1, infinite;
    }}
    @keyframes grow {{
      0%   {{ transform: scaleY(0.05) scaleX(0.7); opacity: 0; }}
      60%  {{ transform: scaleY(1.12) scaleX(1);   opacity: 1; }}
      100% {{ transform: scaleY(1)    scaleX(1);   opacity: 1; }}
    }}
    @keyframes sway {{
      0%, 100% {{ transform: rotate(-4deg); }}
      50%      {{ transform: rotate(4deg); }}
    }}
    .g1 {{ animation-duration: 0.5s, 3.8s; }}
    .g2 {{ animation-duration: 0.5s, 2.9s; }}
    .g3 {{ animation-duration: 0.5s, 4.4s; }}

{tuft_css}

    /* 가운데 나무 — 톡 튀어나온 뒤 숨쉬듯 흔들린다 */
    .tree {{ animation: pop 0.55s cubic-bezier(0.2, 1.3, 0.4, 1) 0.08s both, bob 2.8s ease-in-out 0.7s infinite; }}
    @keyframes pop {{
      0%   {{ transform: scale(0.2) translateY(16px); opacity: 0; }}
      100% {{ transform: scale(1)   translateY(0);    opacity: 1; }}
    }}
    @keyframes bob {{
      0%, 100% {{ transform: translateY(0)    scale(1); }}
      50%      {{ transform: translateY(-7px) scale(1.04); }}
    }}

{leaf_css}
  </style>

  <g class="all">
    <ellipse class="ground" cx="400" cy="400" rx="275" ry="258" fill="url(#fGround)"/>

    <g class="ring ring-out" fill="none" stroke="#a6f4bd" stroke-width="3" stroke-linecap="round"
       opacity="0.55" filter="url(#fHalo)">
      <ellipse cx="400" cy="400" rx="268" ry="252" stroke-dasharray="46 34"/>
    </g>
    <g class="ring ring-in" fill="none" stroke="#c9ffd9" stroke-width="2.5" stroke-linecap="round"
       opacity="0.45" filter="url(#fHalo)">
      <ellipse cx="400" cy="400" rx="202" ry="190" stroke-dasharray="20 44"/>
    </g>

{tuft_svg}

{leaf_svg}

    <!-- 가운데 나무는 3D로 선다 (js/towers3d.js towers3dSpawnTotem) — 여기엔 바닥 장식만 남긴다 -->
  </g>
</svg>
'''

import os
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'forest.svg')
io.open(out, 'w', encoding='utf-8', newline=chr(10)).write(svg)
print('ok forest.svg', len(svg), 'bytes')
