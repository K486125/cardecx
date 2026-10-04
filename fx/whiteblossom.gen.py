# fx/whiteblossom.svg 생성 — 꽃잎 위치를 손으로 적기엔 많아서 만들어 낸다 (시드 고정)
# 숲의정령(forest.gen.py)과 같은 토템 형태이고, 풀 대신 흰 꽃잎이 원을 따라 흩날린다.
import io, math, os, random

random.seed(19)
CX = CY = 400.0
R   = 275.0           # 사거리(300)보다 조금 작게. 타일맵 기준 이웃 타워까지 224, 반대쪽 끝까지 400이므로
                      # 가운데에 놓으면 3개, 위/아래에 놓으면 2개만 범위에 들어온다
                      # 가운데에 놓으면 3개, 위/아래에 놓으면 2개만 범위에 들어온다
                      # 가운데에 놓으면 3개, 위/아래에 놓으면 2개만 범위에 들어온다
FLAT = 0.92           # 아주 살짝만 눌러 바닥처럼

def f(v): return f'{v:.1f}'

# 궤도 3겹 — 겹마다 다른 속도로 돌아 '흩날리는' 느낌을 만든다
ORBITS = [(0, 28.0, 1), (1, 38.0, -1), (2, 21.0, 1)]
petals = []
for i in range(30):
    o  = i % 3
    a  = random.uniform(0, 360)
    rr = math.sqrt(random.uniform(0.10, 1.0)) * (R - 30)
    x  = CX + rr * math.cos(math.radians(a))
    y  = CY + rr * math.sin(math.radians(a)) * FLAT
    petals.append((o, x, y, random.uniform(0, 360), random.uniform(0.7, 1.25),
                   random.uniform(0.1, 0.75), i % 4))

drifts = []
for i in range(8):
    a  = random.uniform(0, 360)
    rr = math.sqrt(random.uniform(0.05, 0.8)) * (R - 70)
    x  = CX + rr * math.cos(math.radians(a))
    y  = CY + rr * math.sin(math.radians(a)) * FLAT
    drifts.append((x, y, random.uniform(-90, 90), random.uniform(-160, -100),
                   random.uniform(-260, 260), random.uniform(0.2, 2.6), random.uniform(0.6, 1.0)))

orbit_css = '\n'.join(
    f'    .o{o} {{ animation: pop-orbit 0.6s ease-out {0.1 + o * 0.08:.2f}s both, '
    f'{"spin" if d > 0 else "spinb"} {dur:.0f}s linear infinite; }}'
    for o, dur, d in ORBITS)

petal_css = '\n'.join(
    f'    .p{i} {{ animation-delay: {d:.2f}s, {d + 0.8:.2f}s; }}'
    for i, (_, _, _, _, _, d, _) in enumerate(petals))

drift_css = '\n'.join(
    f'''    @keyframes wf{i} {{
      0%   {{ transform: translate(0,0) rotate(0deg) scale(0.5); opacity: 0; }}
      15%  {{ opacity: 0.95; }}
      100% {{ transform: translate({dx:.0f}px,{dy:.0f}px) rotate({rot:.0f}deg) scale(1); opacity: 0; }}
    }}
    .wf{i} {{ animation: wf{i} 2.8s ease-out {delay:.2f}s infinite; }}'''
    for i, (_, _, dx, dy, rot, delay, _) in enumerate(drifts))

def petals_of(o):
    return '\n'.join(
        f'      <g transform="translate({f(x)} {f(y)}) rotate({f(rot)}) scale({sc:.2f})">'
        f'<g class="petal p{i} b{b}"><use href="#wleaf"/></g></g>'
        for i, (oo, x, y, rot, sc, _, b) in enumerate(petals) if oo == o)

orbit_svg = '\n'.join(
    f'    <g class="orbit o{o}">\n{petals_of(o)}\n    </g>' for o, _, _ in ORBITS)

drift_svg = '\n'.join(
    f'    <g transform="translate({f(x)} {f(y)})">'
    f'<g class="drift wf{i}" style="transform-box: fill-box; transform-origin: 50% 50%;">'
    f'<use href="#wleaf" transform="scale({sc:.2f})"/></g></g>'
    for i, (x, y, _, _, _, _, sc) in enumerate(drifts))

svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<!--
  흰꽃(cherry_blossom_evo) — cards.js의 cast: 'whiteblossom'
  기준점(타워 중심) = (400, 400) · 반지름 344 (타워 3개가 들어가는 원) · 전체 길이 5.4초
  숲의정령과 같은 토템 형태. 가운데 흰 꽃을 기준으로 흰 꽃잎이 원을 따라 흩날린다.
  ※ 이 파일은 fx/whiteblossom.gen.py가 만들어 낸다 — 손으로 고치지 말고 그 스크립트를 고쳐 다시 실행할 것
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <defs>
    <radialGradient id="wGround">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="45%"  stop-color="#f4f7ff" stop-opacity="0.22"/>
      <stop offset="82%"  stop-color="#dfe8ff" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#dfe8ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wPetal" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%"   stop-color="#e8eefc"/>
      <stop offset="45%"  stop-color="#fdfdff"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <filter id="wSoft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="0.8"/>
    </filter>
    <filter id="wHalo" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3" result="g"/>
      <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <!-- 흰 꽃잎 한 장 (밑동이 0,0, 끝이 위쪽 · 끝이 살짝 팬 벚꽃잎) -->
    <g id="wleaf" filter="url(#wSoft)">
      <path d="M 0 0 C 7 -5 12.5 -13 10.5 -22 C 9.5 -27 7 -29.5 4.5 -28 C 3 -27 1.5 -26 0 -24 Z" fill="url(#wPetal)"/>
      <path d="M 0 0 C 7 -5 12.5 -13 10.5 -22 C 9.5 -27 7 -29.5 4.5 -28 C 3 -27 1.5 -26 0 -24 Z" fill="url(#wPetal)" transform="scale(-1,1)"/>
    </g>
  </defs>

  <style>
    .all, .ground, .ring, .orbit, .core {{ transform-box: view-box; transform-origin: 400px 400px; }}

    /* 끝날 때 통째로 스르륵 사라진다 */
    .all {{ animation: fade 5.4s linear both; }}
    @keyframes fade {{
      0%, 87% {{ opacity: 1; }}
      100%    {{ opacity: 0; }}
    }}

    /* 흰 빛 바닥이 깔린다 */
    .ground {{ animation: ground 0.55s cubic-bezier(0.2, 0.9, 0.3, 1) both; }}
    @keyframes ground {{
      0%   {{ transform: scale(0.15); opacity: 0; }}
      70%  {{ transform: scale(1.04); opacity: 1; }}
      100% {{ transform: scale(1);    opacity: 1; }}
    }}

    /* 토템 고리 — 두 겹이 반대로 천천히 돈다 */
    .ring-out {{ animation: ringin 0.6s ease-out 0.1s both, spin 24s linear 0.1s infinite; }}
    .ring-in  {{ animation: ringin 0.6s ease-out 0.2s both, spinb 17s linear 0.2s infinite; }}
    @keyframes ringin {{ 0% {{ opacity: 0; }} 100% {{ opacity: 1; }} }}

    @keyframes spin  {{ from {{ transform: rotate(0deg); }} to {{ transform: rotate(360deg); }} }}
    @keyframes spinb {{ from {{ transform: rotate(0deg); }} to {{ transform: rotate(-360deg); }} }}

    /* 꽃잎 궤도 — 겹마다 속도가 달라 흩날리는 것처럼 보인다 */
    @keyframes pop-orbit {{ 0% {{ opacity: 0; }} 100% {{ opacity: 1; }} }}
{orbit_css}

    /* 꽃잎 한 장 — 피어난 뒤 제자리에서 살랑인다 */
    .petal {{
      transform-box: fill-box;
      transform-origin: 50% 100%;
      animation-name: bloom, flutter;
      animation-duration: 0.5s, 3.4s;
      animation-timing-function: cubic-bezier(0.2, 0.9, 0.3, 1), ease-in-out;
      animation-fill-mode: both, both;
      animation-iteration-count: 1, infinite;
    }}
    @keyframes bloom {{
      0%   {{ transform: scale(0.1)  rotate(-14deg); opacity: 0; }}
      65%  {{ transform: scale(1.12) rotate(4deg);   opacity: 1; }}
      100% {{ transform: scale(1)    rotate(0deg);   opacity: 1; }}
    }}
    @keyframes flutter {{
      0%, 100% {{ transform: rotate(-7deg) scale(1); }}
      50%      {{ transform: rotate(7deg)  scale(1.06); }}
    }}
    .b1 {{ animation-duration: 0.5s, 4.1s; }}
    .b2 {{ animation-duration: 0.5s, 2.8s; }}
    .b3 {{ animation-duration: 0.5s, 4.8s; }}

{petal_css}

    /* 가운데 흰 꽃 — 톡 튀어나온 뒤 숨쉬듯 흔들린다 */
    .core {{ animation: pop 0.55s cubic-bezier(0.2, 1.3, 0.4, 1) 0.08s both, bob 3s ease-in-out 0.7s infinite; }}
    @keyframes pop {{
      0%   {{ transform: scale(0.2) rotate(-40deg); opacity: 0; }}
      100% {{ transform: scale(1)   rotate(0deg);   opacity: 1; }}
    }}
    @keyframes bob {{
      0%, 100% {{ transform: translateY(0)    scale(1)    rotate(0deg); }}
      50%      {{ transform: translateY(-6px) scale(1.05) rotate(6deg); }}
    }}

{drift_css}
  </style>

  <g class="all">
    <ellipse class="ground" cx="400" cy="400" rx="275" ry="258" fill="url(#wGround)"/>

    <g class="ring ring-out" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"
       opacity="0.5" filter="url(#wHalo)">
      <ellipse cx="400" cy="400" rx="268" ry="252" stroke-dasharray="42 36"/>
    </g>
    <g class="ring ring-in" fill="none" stroke="#f2f6ff" stroke-width="2.5" stroke-linecap="round"
       opacity="0.42" filter="url(#wHalo)">
      <ellipse cx="400" cy="400" rx="202" ry="190" stroke-dasharray="18 46"/>
    </g>

{orbit_svg}

{drift_svg}

    <!-- 가운데 꽃은 3D로 선다 (js/towers3d.js towers3dSpawnTotem) — 여기엔 흔날리는 꽃잎만 -->
  </g>
</svg>
'''

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'whiteblossom.svg')
io.open(out, 'w', encoding='utf-8', newline=chr(10)).write(svg)
print('ok whiteblossom.svg', len(svg), 'bytes')
