#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
#  myJEV — local smoke test (no Docker, no API key required)
#
#  1. typecheck + build (SPA and server bundle)
#  2. boot the mock decider            (:8000)
#  3. boot the API in production mode  (:3001)
#  4. exercise /api/health, /api/config, /api/evaluate (mock + decider),
#     /api/evaluate/batch, error handling and the SPA
#
#  Usage:  ./scripts/smoke-test.sh [--skip-build]
# ══════════════════════════════════════════════════════════════════════════
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"

API_PORT="${API_PORT:-3101}"
MOCK_PORT="${MOCK_PORT:-8100}"
SKIP_BUILD=0
[[ "${1:-}" == "--skip-build" ]] && SKIP_BUILD=1

GRN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  %s✕%s %s\n' "$RED" "$RST" "$*"; }
step(){ printf '\n%s▸ %s%s\n' "$YEL" "$*" "$RST"; }
note(){ printf '  %s·%s %s\n' "$DIM" "$RST" "$*"; }

check() { # description, expected-substring, actual
  if echo "$3" | grep -q "$2"; then ok "$1"; else bad "$1 (expected '$2', got: $(echo "$3" | head -c 200))"; fi
}

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null
  [[ -n "${MOCK_PID:-}" ]] && kill "$MOCK_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

wait_for() { # url, tries
  local url="$1" tries="${2:-40}"
  for ((i=0; i<tries; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

command -v node >/dev/null || { bad "node not found"; exit 1; }
command -v curl >/dev/null || { bad "curl not found"; exit 1; }

echo
echo "myJEV smoke test — node $(node -v)"
echo "═══════════════════════════════════════════════════════════"

if [[ "$SKIP_BUILD" == "0" ]]; then
  step "install + typecheck + build"
  [[ -d node_modules ]] || npm install --no-audit --no-fund >/tmp/myjev-install.log 2>&1 || { bad "npm install (see /tmp/myjev-install.log)"; exit 1; }
  ok "dependencies present"
  npm run typecheck >/tmp/myjev-tsc.log 2>&1 && ok "tsc --noEmit (client + server)" || { bad "typecheck — tail:"; tail -25 /tmp/myjev-tsc.log | sed 's/^/      /'; }
  npm run build >/tmp/myjev-build.log 2>&1 && ok "vite build + esbuild server bundle" || { bad "build — tail:"; tail -25 /tmp/myjev-build.log | sed 's/^/      /'; exit 1; }
  [[ -f dist/index.html ]] && ok "dist/index.html exists" || bad "dist/index.html missing"
  [[ -f dist-server/server/index.js ]] && ok "dist-server/server/index.js exists" || bad "server bundle missing"
else
  step "skipping build (--skip-build)"
fi

step "boot mock decider on :${MOCK_PORT}"
PORT="$MOCK_PORT" HOST=127.0.0.1 node docker/mock/mock-decider.mjs >/tmp/myjev-mock.log 2>&1 &
MOCK_PID=$!
wait_for "http://127.0.0.1:${MOCK_PORT}/health" && ok "mock /health" || { bad "mock did not start"; tail -20 /tmp/myjev-mock.log | sed 's/^/      /'; exit 1; }

step "boot myJEV API (production) on :${API_PORT}"
NODE_ENV=production PORT="$API_PORT" HOST=127.0.0.1 \
  DECIDER_BASE_URL="http://127.0.0.1:${MOCK_PORT}" \
  LOG_REQUESTS=true LOG_FILE="/tmp/myjev-smoke.jsonl" \
  MYJEV_DEFAULT_MODE=mock \
  node dist-server/server/index.js >/tmp/myjev-api.log 2>&1 &
API_PID=$!
wait_for "http://127.0.0.1:${API_PORT}/api/health" && ok "api /api/health" || { bad "api did not start"; tail -30 /tmp/myjev-api.log | sed 's/^/      /'; exit 1; }

BASE="http://127.0.0.1:${API_PORT}"

step "GET endpoints"
H="$(curl -s "$BASE/api/health")"
check "/api/health ok:true" '"ok":true' "$H"
check "/api/health lists mock backend" '"mock"' "$H"
C="$(curl -s "$BASE/api/config")"
check "/api/config service" '"service":"myjev"' "$C"
check "/api/config version" '"version"' "$C"
B="$(curl -s "$BASE/api/backends")"
check "/api/backends decider reachable" '"ok":true' "$B"

step "SPA is served by the api image (single-container mode)"
S="$(curl -s "$BASE/")"
check "GET / returns the app shell" 'id="root"' "$S"
A="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/some/spa/route")"
[[ "$A" == "200" ]] && ok "SPA fallback route → 200" || bad "SPA fallback route → $A"

step "POST /api/evaluate — mode=mock (offline)"
R="$(curl -s -X POST "$BASE/api/evaluate" -H 'content-type: application/json' -d '{
  "mode":"mock",
  "state":"This is the SECOND month I have been billed twice for the Pro plan. Fix it ASAP!!",
  "questions":{
    "department":{"type":"choice","instructions":"Which team should handle this?","criteria":{"billing":"Charges, refunds, invoices","technical":"Bugs or product issues","account":"Login / access problems","other":"Does not fit"}},
    "urgency":{"type":"score","instructions":"How urgent is this?","criteria":["Low","Medium","High","Critical"]},
    "angry":{"type":"noul","instructions":"Is the customer expressing strong frustration?"}
  }}')"
check "answers present" '"answers"' "$R"
check "department=billing" '"choice":"billing"' "$R"
check "probabilities present" '"probabilities"' "$R"
check "score answer" '"type":"score"' "$R"
check "noul answer" '"type":"noul"' "$R"
check "meta.mode=mock" '"mode":"mock"' "$R"
check "latency reported" '"latency_ms"' "$R"

step "POST /api/evaluate — mode=decider → mock wire format"
D="$(curl -s -X POST "$BASE/api/evaluate" -H 'content-type: application/json' -d "{
  \"mode\":\"decider\",
  \"decider_url\":\"http://127.0.0.1:${MOCK_PORT}\",
  \"state\":\"My card was charged twice and the dashboard throws a 500.\",
  \"questions\":{
    \"team\":{\"type\":\"choice\",\"instructions\":\"Which team?\",\"criteria\":{\"billing\":\"charges, refunds\",\"technical\":\"bugs, outages\"}},
    \"refund\":{\"type\":\"noul\",\"instructions\":\"Is a refund needed?\"}
  }}")"
check "decider answers present" '"answers"' "$D"
check "decider meta.mode" '"mode":"decider"' "$D"
check "decider backend url" '127.0.0.1' "$D"

step "POST /api/evaluate/batch"
BT="$(curl -s -X POST "$BASE/api/evaluate/batch" -H 'content-type: application/json' -d '{
  "mode":"mock",
  "items":[{"id":"t1","state":"charged twice, refund now"},{"id":"t2","state":"api returns 500 on the billing tab"},{"id":"t3","state":"cannot log in, my 2fa codes are rejected"}],
  "questions":{"team":{"type":"choice","instructions":"Which team?","criteria":{"billing":"charges","technical":"bugs","account":"login"}}},
  "concurrency":2}')"
check "batch rows" '"rows"' "$BT"
check "batch total=3" '"total":3' "$BT"
check "batch ok=3" '"ok":3' "$BT"

step "request validation"
E1="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/evaluate" -H 'content-type: application/json' -d '{"questions":{}}')"
[[ "$E1" == "400" ]] && ok "missing state → 400" || bad "missing state → $E1"
E2="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/evaluate" -H 'content-type: application/json' -d '{"mode":"mock","state":"x","questions":{}}')"
[[ "$E2" == "400" || "$E2" == "502" ]] && ok "empty questions rejected → $E2" || bad "empty questions → $E2"
E3="$(curl -s -X POST "$BASE/api/evaluate" -H 'content-type: application/json' -d '{"mode":"parallel","state":"x","questions":{"q":{"type":"noul","instructions":"y"}}}')"
# This assertion only holds when the server has no LLM key. If a key IS
# configured (e.g. a developer .env pointing at Ollama), the real call
# succeeds, so skip rather than report a false failure.
if curl -s "$BASE/api/config" | grep -q '"key_configured":true'; then
  note "LLM key is configured → skipping the no-key error assertion"
else
  check "no API key → helpful error" 'No API key' "$E3"
fi
E4="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/nope")"
[[ "$E4" == "404" ]] && ok "unknown api route → 404" || bad "unknown api route → $E4"

step "audit log"
if [[ -s /tmp/myjev-smoke.jsonl ]]; then
  ok "JSONL log written ($(wc -l < /tmp/myjev-smoke.jsonl) lines)"
else
  bad "no audit log at /tmp/myjev-smoke.jsonl"
fi

step "docker artifacts present"
for f in docker/Dockerfile.api docker/Dockerfile.web docker/Dockerfile.dev docker/mock/Dockerfile docker/decider/Dockerfile \
         docker/nginx/nginx.conf docker/nginx/conf.d/myjev.conf docker/nginx/caddy/Caddyfile docker/entrypoint.sh \
         docker-compose.yml .dockerignore .env.example Makefile; do
  [[ -f "$f" ]] && ok "$f" || bad "$f missing"
done

echo
echo "═══════════════════════════════════════════════════════════"
printf '  %s passed, %s failed\n' "$PASS" "$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo
  note "api log tail:"; tail -20 /tmp/myjev-api.log | sed 's/^/      /'
  exit 1
fi
ok "smoke test green"
exit 0
