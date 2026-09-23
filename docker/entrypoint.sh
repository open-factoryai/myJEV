#!/bin/sh
# myJEV API container entrypoint — prints the effective configuration, then execs CMD.
set -e

mask() {
  # show only the tail of a secret so logs stay safe
  case "$1" in
    "") echo "(unset)" ;;
    *) echo "…${1#"${1%????}"} (len ${#1})" ;;
  esac
}

echo "──────────────────────────────────────────────"
echo " myJEV API  v${MYJEV_VERSION:-dev}"
echo "──────────────────────────────────────────────"
echo "  node        : $(node -v 2>/dev/null || echo '?')"
echo "  NODE_ENV    : ${NODE_ENV:-development}"
echo "  listen      : ${HOST:-0.0.0.0}:${PORT:-3001}"
echo "  web root    : ${MYJEV_WEB_ROOT:-<auto-detect>}"
echo "  default mode: ${MYJEV_DEFAULT_MODE:-parallel}"
echo "  model       : ${MYJEV_MODEL:-<openai default>}"
echo "  base url    : ${OPENAI_BASE_URL:-${MYJEV_BASE_URL:-<provider default>}}"
echo "  llm key     : $(mask "${OPENAI_API_KEY:-${MYJEV_API_KEY:-${CEREBRAS_API_KEY:-${GROQ_API_KEY:-}}}}")"
echo "  decider     : ${DECIDER_BASE_URL:-http://localhost:8000}"
echo "  auth        : ${MYJEV_API_TOKEN:+bearer token set}${MYJEV_API_TOKEN:-off}"
echo "  rate limit  : ${RATE_LIMIT_MAX:-120} req / $(( ${RATE_LIMIT_WINDOW_MS:-60000} / 1000 ))s"
echo "  request log : ${LOG_REQUESTS:-false} → ${LOG_FILE:-logs/myjev.jsonl}"
echo "──────────────────────────────────────────────"

exec "$@"
