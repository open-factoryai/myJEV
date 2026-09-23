# syntax=docker/dockerfile:1.7
# ══════════════════════════════════════════════════════════════════════════
#  Mapika/decider — real System One weights behind HTTP (POST /v1/systemone)
#
#  REQUIRES an NVIDIA GPU + the NVIDIA Container Toolkit on the host.
#  decider-2b needs roughly 4 GB VRAM; larger checkpoints need more.
#
#  build:
#    docker build -f docker/decider/Dockerfile \
#      --build-arg DECIDER_REF=main \
#      --build-arg DECIDER_MODEL=Mapika/decider-2b \
#      -t myjev/decider:latest .
#
#  run (compose):
#    docker compose --profile gpu up -d --build decider
#
#  The model weights land in a named volume (decider_weights) so rebuilds and
#  restarts don't re-download. First boot downloads from Hugging Face unless
#  you pre-seed the volume or bake them in with BAKE_WEIGHTS=true.
# ══════════════════════════════════════════════════════════════════════════
ARG CUDA_IMAGE=nvidia/cuda:12.4.1-runtime-ubuntu22.04
FROM ${CUDA_IMAGE}

ARG PYTHON_VERSION=3.11
ARG DECIDER_REF=main
ARG DECIDER_MODEL=Mapika/decider-2b
ARG BAKE_WEIGHTS=false
ARG HF_HOME=/models

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=${HF_HOME} \
    HUGGINGFACE_HUB_CACHE=${HF_HOME}/hub \
    TRANSFORMERS_CACHE=${HF_HOME}/hub \
    DECIDER_MODEL=${DECIDER_MODEL} \
    PORT=8000 \
    HOST=0.0.0.0

# ── system packages ────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        python${PYTHON_VERSION} python${PYTHON_VERSION}-venv python${PYTHON_VERSION}-dev \
        python3-pip git curl ca-certificates tini \
    && ln -sf /usr/bin/python${PYTHON_VERSION} /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/decider

# ── the model server ───────────────────────────────────────────────────────
# Upstream may rename things; pin a ref you trust for production builds.
RUN --mount=type=cache,target=/root/.cache/pip \
    git clone --depth 1 --branch ${DECIDER_REF} https://github.com/Mapika/decider.git /opt/decider/repo \
    || git clone --depth 1 https://github.com/Mapika/decider.git /opt/decider/repo; \
    cd /opt/decider/repo \
    && (pip install -e ".[serve]" || pip install -e . || pip install -r requirements.txt) \
    && python -c "import torch, sys; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())" || true

# ── optional: bake the weights into the image (bigger image, cold start = 0) ─
RUN if [ "${BAKE_WEIGHTS}" = "true" ]; then \
        mkdir -p ${HF_HOME} \
        && python - <<'PY' || echo "[decider] weight pre-download skipped/failed — will download on first boot"
import os
model = os.environ.get("DECIDER_MODEL", "Mapika/decider-2b")
try:
    from huggingface_hub import snapshot_download
    print("[decider] downloading", model)
    snapshot_download(model)
except Exception as exc:  # pragma: no cover
    print("[decider] snapshot_download failed:", exc)
PY
    fi

RUN mkdir -p ${HF_HOME} /opt/decider/logs

EXPOSE 8000
VOLUME ["/models"]

# Upstream exposes scripts/serve.sh; fall back to the module entrypoint if the
# layout differs. Override `command:` in compose if you need something else.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8000/health || curl -fsS http://127.0.0.1:8000/v1/models || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "-lc", "cd /opt/decider/repo && (bash scripts/serve.sh ${DECIDER_MODEL} ${PORT} || python -m decider.serve --model ${DECIDER_MODEL} --port ${PORT} --host ${HOST})"]
