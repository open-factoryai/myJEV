#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
#  myJEV — build (and optionally push) all container images.
#
#  ./scripts/docker-build.sh                        # local build, linux/amd64
#  PUSH=true TAG=v2.0.0 ./scripts/docker-build.sh   # buildx multi-arch + push
#
#  Env:
#    REGISTRY=ghcr.io  REGISTRY_NAMESPACE=open-factoryai
#    IMAGES="api web mock-decider"     (space separated; add "decider dev")
#    PLATFORMS=linux/amd64,linux/arm64
#    TAG=latest  NAMESPACE=myjev  PUSH=false
#    NODE_VERSION=22
# ══════════════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"

REGISTRY="${REGISTRY:-ghcr.io}"
REGISTRY_NAMESPACE="${REGISTRY_NAMESPACE:-open-factoryai}"
IMAGES="${IMAGES:-api web mock-decider}"
PLATFORMS="${PLATFORMS:-linux/amd64}"
TAG="${TAG:-latest}"
NAMESPACE="${NAMESPACE:-myjev}"
PUSH="${PUSH:-false}"
NODE_VERSION="${NODE_VERSION:-22}"
MYJEV_VERSION="${MYJEV_VERSION:-$(node -p "require('./package.json').version" 2>/dev/null || echo 2.0.0)}"
BUILDER="${BUILDER:-myjev-builder}"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
info() { printf '%s▸%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YEL" "$RST" "$*"; }
fail() { printf '%s✕%s %s\n' "$RED" "$RST" "$*" >&2; }

command -v docker >/dev/null 2>&1 || { fail "docker not found in PATH"; exit 1; }

# context/dockerfile per image
ctx_of()      { case "$1" in mock-decider) echo "docker/mock" ;; decider) echo "docker/decider" ;; *) echo "." ;; esac; }
dockerfile_of() {
  case "$1" in
    api)         echo "docker/Dockerfile.api" ;;
    web)         echo "docker/Dockerfile.web" ;;
    dev)         echo "docker/Dockerfile.dev" ;;
    mock-decider) echo "Dockerfile" ;;
    decider)     echo "Dockerfile" ;;
    *) fail "unknown image '$1' (expected: api web dev mock-decider decider)"; exit 1 ;;
  esac
}

remote_ref() { echo "${REGISTRY}/${REGISTRY_NAMESPACE}/myjev-$1:${TAG}"; }
local_ref()  { echo "${NAMESPACE}/$1:${TAG}"; }

# ── sanity checks ───────────────────────────────────────────────────────────
if [[ -f .env ]]; then
  if grep -Eq '^[[:space:]]*(OPENAI_API_KEY|GROQ_API_KEY|CEREBRAS_API_KEY|MYJEV_API_TOKEN|HF_TOKEN)=[^[:space:]]+' .env; then
    warn ".env contains non-empty secrets — .dockerignore excludes it, double-check before pushing images."
  fi
fi
if [[ ! -f .dockerignore ]]; then fail ".dockerignore missing — refusing to build"; exit 1; fi

# ── builder setup for multi-arch / push ─────────────────────────────────────
USE_BUILDX=0
if [[ "$PUSH" == "true" || "$PLATFORMS" == *","* ]]; then
  if docker buildx version >/dev/null 2>&1; then
    USE_BUILDX=1
    docker buildx inspect "$BUILDER" >/dev/null 2>&1 || docker buildx create --name "$BUILDER" --driver docker-container --use >/dev/null
    docker buildx use "$BUILDER"
    docker buildx inspect --bootstrap >/dev/null
    info "buildx builder '$BUILDER' ready (platforms: $PLATFORMS)"
  else
    warn "buildx unavailable — falling back to the classic builder (single platform, no push)"
  fi
fi

if [[ "$PUSH" == "true" ]]; then
  info "images will be pushed to ${REGISTRY}/${REGISTRY_NAMESPACE}/myjev-*:${TAG}"
  warn "make sure you ran:  docker login ${REGISTRY}"
fi

# ── build loop ──────────────────────────────────────────────────────────────
declare -a BUILT=()
for image in $IMAGES; do
  ctx="$(ctx_of "$image")"
  dockerfile="$(dockerfile_of "$image")"
  local_ref_v="$(local_ref "$image")"
  remote_ref_v="$(remote_ref "$image")"

  echo
  info "building ${image}  ${DIM}(context: ${ctx}, dockerfile: ${dockerfile})${RST}"

  args=(
    --build-arg "NODE_VERSION=${NODE_VERSION}"
    --build-arg "MYJEV_VERSION=${MYJEV_VERSION}"
    --build-arg "UID=${PUID:-1001}"
    --build-arg "GID=${PGID:-1001}"
  )
  [[ -n "${NPM_FLAGS:-}" ]] && args+=(--build-arg "NPM_FLAGS=${NPM_FLAGS}")

  tags=(-t "$local_ref_v")
  [[ "$PUSH" == "true" || "$USE_BUILDX" == "1" ]] && tags+=(-t "$remote_ref_v")

  if [[ "$USE_BUILDX" == "1" ]]; then
    output_flag="--load"
    [[ "$PUSH" == "true" ]] && output_flag="--push"
    [[ "$PLATFORMS" == *","* && "$PUSH" != "true" ]] && output_flag=""   # multi-arch can't load into docker
    docker buildx build \
      --platform "$PLATFORMS" \
      -f "${ctx}/${dockerfile}" \
      "${tags[@]}" \
      "${args[@]}" \
      --provenance=false --sbom=false \
      ${output_flag} \
      "$ctx"
  else
    docker build \
      -f "${ctx}/${dockerfile}" \
      "${tags[@]}" \
      "${args[@]}" \
      "$ctx"
  fi

  BUILT+=("$local_ref_v")
done

echo
info "done:"
for ref in "${BUILT[@]}"; do printf '   %s\n' "$ref"; done

if [[ "$USE_BUILDX" == "0" && "$PUSH" == "true" ]]; then
  echo
  info "pushing local tags…"
  for image in $IMAGES; do
    docker tag "$(local_ref "$image")" "$(remote_ref "$image")"
    docker push "$(remote_ref "$image")"
  done
fi

cat <<EOF

${DIM}Run it:
  docker compose up -d --build                       # nginx UI :8080 + api :3001
  docker compose --profile mock up -d --build        # + offline mock decider
  docker run --rm -p 3001:3001 --env-file .env $(local_ref api)   # single container${RST}
EOF
