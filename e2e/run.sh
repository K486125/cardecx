#!/usr/bin/env bash
# e2e 실행기 — 소스를 e2e/site/로 복사하고, 정적 서버와 에뮬레이터를 띄우고, 테스트를 돌린다.
#   bash e2e/run.sh all                  회귀 테스트 전부 (SUITE)
#   bash e2e/run.sh cooldown dual sword  특정 테스트만
#   bash e2e/run.sh                      목록만 보여준다
# 에뮬레이터(실시간 DB)는 Java 21 이상이 필요하다 — 아래에서 사용자 폴더의 JDK를 집어 쓴다.
# 실제 DB(cardbattles-441263)는 절대 건드리지 않는다 — 'demo-' 프로젝트 에뮬레이터에만 붙는다.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"
PROJECT=demo-cardecx

# 회귀 테스트 — 'all'이 돌리는 목록. 새 테스트를 만들면 여기에 넣는다 (스크린샷 도구는 tools/에 둔다)
SUITE="duel net netstate netreaper pending cooldown hotkeyblock touch pan mapzoom ghost
stack status fixes5 rules6 patchnotes totem blossom arrow sword stone stonehell wind quake
firewall firebot water botwater synergy thornsaw wallstack towers3d towerfall fxmix hellredirect
reaper reaperbot reaperspec spectate spec3 plan4a plan4c plan4d fix3 fields"

# ── Java 21 ────────────────────────────────────────────────
if [ -z "${JAVA_HOME:-}" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -qE '"(2[1-9]|[3-9][0-9])'; then
  JDK="$(ls -d "$HOME"/.jdks/jdk-21* /c/Users/HUN/.jdks/jdk-21* 2>/dev/null | head -1)"
  if [ -z "$JDK" ]; then
    echo "Java 21을 찾지 못했습니다. ~/.jdks/jdk-21... 이 있어야 합니다." >&2
    exit 1
  fi
  export JAVA_HOME="$JDK"
fi
export PATH="$JAVA_HOME/bin:$PATH"

# ── 소스 동기화 ────────────────────────────────────────────
mkdir -p "$HERE/site"
cp -r "$SRC/css" "$SRC/js" "$SRC/fx" "$SRC/img" "$SRC/game.html" "$SRC/index.html" "$HERE/site/" 2>/dev/null
cp "$SRC/database.rules.json" "$HERE/" 2>/dev/null

# 에뮬레이터 전용 설정 — 프로젝트의 진짜 firebase-config.js(실제 키·실제 DB)는 절대 복사하지 않는다
if [ ! -s "$HERE/site/firebase-config.js" ]; then
  cat > "$HERE/site/firebase-config.js" <<'CFGEOF'
// 테스트 전용 Firebase 설정 — 에뮬레이터에만 붙는다.
firebase.initializeApp({
  apiKey:            'demo-emulator-key',
  authDomain:        'demo-cardecx.firebaseapp.com',
  databaseURL:       'http://127.0.0.1:9000/?ns=demo-cardecx-default-rtdb',
  projectId:         'demo-cardecx',
  storageBucket:     'demo-cardecx.appspot.com',
  messagingSenderId: '0',
  appId:             '1:0:web:demo'
});
firebase.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: false });

// 앱이 전역 db를 쓴다 (js/room.js, js/sync.js 등) — 진짜 설정 파일과 같은 이름으로 만들어 준다
const db = firebase.database();
CFGEOF
fi
echo "소스 동기화 완료"

# ── 정적 서버 (5055) ───────────────────────────────────────
if ! curl -s -o /dev/null http://127.0.0.1:5055/index.html; then
  (cd "$HERE" && nohup python srv.py site > http.log 2>&1 & ) </dev/null >/dev/null 2>&1
  for i in $(seq 40); do curl -s -o /dev/null http://127.0.0.1:5055/index.html && break; sleep 0.25; done
fi
curl -s -o /dev/null http://127.0.0.1:5055/index.html && echo "정적 서버 준비 (5055)" || { echo "정적 서버 실패"; exit 1; }

# ── 에뮬레이터 (auth 9099 / database 9000) ─────────────────
if ! curl -s -o /dev/null "http://127.0.0.1:9000/.json?ns=${PROJECT}-default-rtdb"; then
  (cd "$HERE" && nohup firebase.cmd emulators:start --project "$PROJECT" > emu.log 2>&1 & ) </dev/null >/dev/null 2>&1
  for i in $(seq 120); do
    curl -s -o /dev/null "http://127.0.0.1:9000/.json?ns=${PROJECT}-default-rtdb" && break
    grep -qi "error" "$HERE/emu.log" 2>/dev/null && { tail -20 "$HERE/emu.log"; echo "에뮬레이터 실패"; exit 1; }
    sleep 0.5
  done
fi
curl -s -o /dev/null "http://127.0.0.1:9000/.json?ns=${PROJECT}-default-rtdb" \
  && echo "에뮬레이터 준비 (db 9000 / auth 9099)" || { tail -20 "$HERE/emu.log"; echo "에뮬레이터 실패"; exit 1; }
# auth 에뮬레이터까지 떠야 브라우저가 로그인한다 (먼저 열면 auth/network-request-failed)
for i in $(seq 60); do curl -s -o /dev/null "http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/config" && break; sleep 0.5; done

# ── 테스트 ─────────────────────────────────────────────────
if [ $# -eq 0 ]; then
  echo
  echo "회귀 테스트 (all):"; echo "$SUITE" | tr '\n' ' '; echo
  echo "그 밖:"; (cd "$HERE" && ls *.mjs | sed 's/\.mjs$//' | grep -vE '_body$|^lib$' | tr '\n' ' '); echo
  echo
  echo "예: bash e2e/run.sh all  ·  bash e2e/run.sh cooldown dual"
  exit 0
fi
[ "$1" = "all" ] && set -- $SUITE

fails=0
failed=""
for t in "$@"; do
  echo
  echo "══ $t ═══════════════════════════════════════════"
  # 파이프를 타면 node의 종료 코드가 사라진다 — 출력을 받아 두고 코드를 따로 잡는다
  out=$(cd "$HERE" && node --experimental-websocket "$t.mjs" 2>&1)
  st=$?
  printf '%s\n' "$out" | grep -v UNDICI | grep -v trace-warnings
  if [ "$st" -ne 0 ]; then
    fails=$((fails + 1))
    failed="$failed $t"
    echo "  → $t 실패 (종료 코드 $st)"
  fi
done

echo
if [ "$fails" -eq 0 ]; then echo "전부 통과"; else echo "$fails개 실패:$failed"; fi
exit $fails
