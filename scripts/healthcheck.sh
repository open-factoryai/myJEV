#!/usr/bin/env bash
# Probe an myJEV deployment: /healthz (nginx) + /api/health + a mock-mode evaluate.
#   ./scripts/healthcheck.sh [BASE_URL]        default: http://localhost:8080
set -uo pipefail

BASE="${1:-http://localhost:8080}"
BASE="${BASE%/}"
TOKEN="${MYJEV_API_TOKEN:-}"
AUTH=(); [[ -n "$TOKEN" ]] && AUTH=(-H "Authorization: Bearer ${TOKEN}")

GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; }
bad()  { printf '  %s✕%s %s\n' "$RED" "$RST" "$*"; }
note() { printf '  %s·%s %s\n' "$DIM" "$RST" "$*"; }

have() { command -v "$1" >/dev/null 2>&1; }
have curl || { bad "curl is required"; exit 2; }

probe() { # url label
  local url="$1" label="$2" code
  code="$(curl -s -o /tmp/myjev-health.$$ -w '%{http_code}' --max-time 8 "${AUTH[@]}" "$url" || echo 000)"
  if [[ "$code" =~ ^2 ]]; then
    ok "$label → HTTP $code"
    head -c 400 /tmp/myjev-health.$$ 2>/dev/null | tr -d '\n' | sed 's/^/      /'
    echo
  else
    bad "$label → HTTP $code"
    head -c 300 /tmp/myjev-health.$$ 2>/dev/null | tr -d '\n' | sed 's/^/      /'
    echo
  fi
  rm -f /tmp/myjev-health.$$
  [[ "$code" =~ ^2 ]]
}

echo
echo "myJEV health check — ${BASE}"
echo "──────────────────────────────────────────────"

FAILED=0
probe "${BASE}/api/health"  "GET  /api/health"  || FAILED=$((FAILED+1))
probe "${BASE}/api/config"  "GET  /api/config"  || FAILED=$((FAILED+1))

echo
note "POST /api/evaluate (mode=mock — offline, no API key needed)"
BODY='{"mode":"mock","state":"Charged twice again!! Fix it ASAP.","questions":{"department":{"type":"choice","instructions":"Which team?","criteria":{"billing":"charges, refunds","technical":"bugs","account":"login problems","other":"else"}},"urgency":{"type":"score","instructions":"How urgent?","criteria":["Low","Medium","High","Critical"]},"angry":{"type":"noul","instructions":"Strong frustration?"}}}'
RESP="$(curl -s --max-time 20 -X POST "${BASE}/api/evaluate" -H 'content-type: application/json' "${AUTH[@]}" -d "$BODY")"
if echo "$RESP" | grep -q '"answers"'; then
  ok "evaluate returned answers"
  echo "$RESP" | head -c 700 | sed 's/^/      /'; echo
  if have python3; then
    echo "$RESP" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for k,v in (d.get("answers") or {}).items():
    if v.get("type")=="choice": print(f"      {k:12s} choice  -> {v[\"choice\"]:10s} conf {v[\"confidence\"]*100:5.1f}%")
    elif v.get("type")=="score": print(f"      {k:12s} score   -> {v[\"score\"]:.2f}/{max(map(int,v[\"legend\"]))} conf {v[\"confidence\"]*100:5.1f}%")
    else: print(f"      {k:12s} noul    -> {v[\"noul\"]*100:5.1f}%")
' 2>/dev/null || true
  fi
else
  bad "evaluate failed: $(echo "$RESP" | head -c 300)"
  FAILED=$((FAILED+1))
fi

echo
note "POST /api/evaluate/batch (mode=mock)"
BATCH='{"mode":"mock","items":[{"id":"a","state":"billing charged twice"},{"id":"b","state":"api returns 500 on login"}],"questions":{"team":{"type":"choice","instructions":"Which team?","criteria":{"billing":"charges","technical":"bugs","account":"login"}}}}'
BRESP="$(curl -s --max-time 25 -X POST "${BASE}/api/evaluate/batch" -H 'content-type: application/json' "${AUTH[@]}" -d "$BATCH")"
if echo "$BRESP" | grep -q '"rows"'; then
  ok "batch ok → $(echo "$BRESP" | head -c 120)"
else
  bad "batch failed: $(echo "$BRESP" | head -c 200)"
  FAILED=$((FAILED+1))
fi

echo "──────────────────────────────────────────────"
if [[ "$FAILED" -eq 0 ]]; then ok "all checks passed"; exit 0; else bad "$FAILED check(s) failed"; exit 1; fi
