# myJEV — Configuration Reference

Every knob, its default, and what it does. Set via environment (`.env`, compose, `docker run -e`)
or — unless noted — overridden **per request** through the API/UI.

Server precedence: request value → environment variable → built-in default.
Environment precedence: real shell/compose env → `.env` → `.env.local` → `.env.<NODE_ENV>`.

---

## 1. Backend selection

| Variable | Default | Description |
|----------|---------|-------------|
| `MYJEV_DEFAULT_MODE` | `parallel` | Default backend: `parallel` \| `oneshot` \| `decider` \| `mock`. Per-request `mode` overrides it. |
| `ENABLE_DECIDER` | `true` | Advertise the decider backend in `/api/config`. |

Per request: `mode`.

## 2. LLM backends (`parallel`, `oneshot`)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Primary key. These are also probed, in order: `MYJEV_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `PUTER_API_KEY`, `OPENROUTER_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `API_KEY`. |
| `OPENAI_BASE_URL` | provider default | Any OpenAI-compatible endpoint. Aliases: `MYJEV_BASE_URL`, `LLM_BASE_URL`, `OPENAI_API_BASE`. |
| `MYJEV_MODEL` | `gpt-4o-mini` | Default model (aliases: `OPENAI_MODEL`). Per-request `model`. |

Per request: `model`, `base_url`, `api_key` (unless `ALLOW_CLIENT_OVERRIDES=false`).

**Micro-scorer prompt** (mode `parallel`), fixed shape:

```
system: You are a calibrated probability estimator. Given a STATE and a STATEMENT,
        return only how likely the statement is true based solely on the state.
        Do not invent facts. Respond with JSON: {"p": <number 0 to 1>}.
user:   STATE:\n{state}\n\nSTATEMENT:\n{statement}\n\nHow likely is the statement true (0-1)?
```

`choice` questions become one statement per option ("The correct … is *key* (desc).");
`score` questions one per level; `noul` is a single statement. Option probabilities are combined
with a softmax over logit-transformed scores — so they always sum to 1.
Strict `json_schema` → loose `json_object` → plain-text fallbacks are tried in order, which makes
it work on OpenAI, Groq, Cerebras, Together, OpenRouter, Mistral, DeepSeek, Ollama, vLLM and LM Studio.

## 3. Scoring knobs

| Variable | Default | Request field | Range | Description |
|----------|---------|---------------|-------|-------------|
| `MYJEV_TEMPERATURE` | `0` | `temperature` | 0–2 | Sampling temperature of the scorer calls. `0` = deterministic. |
| `MYJEV_SOFTMAX_TEMPERATURE` | `1` | `softmax_temperature` | 0.05–10 | Applied when combining option scores. `<1` sharper, `>1` flatter. |
| `MYJEV_CONCURRENCY` | `8` | `concurrency` | 1–64 | Max simultaneous scorer calls per request. |
| `MYJEV_TIMEOUT_MS` | `60000` | `timeout_ms` | 1000–600000 | Per upstream call (OpenAI SDK + decider fetch + retries). |
| `MYJEV_RETRIES` | `2` | `retries` | 0–8 | Retries on 429 / 5xx / network errors, exponential backoff. |
| `MYJEV_MAX_TOKENS` | `32` | `max_tokens` | 8–4096 | Output budget of a `{"p": …}` call. |
| `MYJEV_SYSTEM_PROMPT_EXTRA` | — | `system_prompt_extra` | — | Extra guidance appended to every scorer/oneshot system prompt. |
| `MYJEV_BATCH_MAX` | `200` | — | — | Max items accepted by `/api/evaluate/batch`. |

Confidence for `choice`/`score` = `0.5·top + 0.5·(margin+0.5)` (margin capped at 0.5) — a blend of
the winning probability and the gap to the runner-up.

## 4. Decider backend (`mode: decider`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DECIDER_BASE_URL` | `http://localhost:8000` | Base URL of a Mapika/decider (or mock) server. Inside compose use `http://mock:8000` / `http://decider:8000`. |
| `DECIDER_API_KEY` | `local` | Bearer token sent to the decider (aliases: `TYPESAFE_API_KEY`). |

Wire format: `POST {base}/v1/systemone` with `{state, questions, model:"decider"}` — the TypeSafe shape.
Per request: `decider_url`, `api_key`.

## 5. Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port (container CMD exposes 3001). |
| `HOST` | `0.0.0.0` | Bind address. |
| `NODE_ENV` | `development` | `production` serves the built SPA and disables Vite middleware (the images set this). |
| `SERVE_STATIC` | — | `true` forces SPA serving even in dev (rarely needed). |
| `MYJEV_WEB_ROOT` | auto | Where the built SPA lives. Auto-detected (`./dist`) when unset. |
| `BODY_LIMIT` | `2mb` | express.json limit. |
| `TRUST_PROXY` | `true` | Honour `X-Forwarded-For` from nginx/Caddy (sets express `trust proxy`). |
| `CORS_ORIGINS` | `*` | Comma-separated allow-list, e.g. `https://app.example.com,https://admin.example.com`. Empty/`*` = allow all. |
| `MYJEV_VERSION` | package version | Reported by `/api/config` and printed at boot. |

## 6. Security

| Variable | Default | Description |
|----------|---------|-------------|
| `MYJEV_API_TOKEN` | — | When set, every `/api/*` call requires `Authorization: Bearer <token>` (or `?token=`). Paste the same token into UI → Settings → Server. |
| `REQUIRE_AUTH` | `false` | `true` + no token configured → the API refuses to serve (fail closed). |
| `ALLOW_CLIENT_OVERRIDES` | `true` | `false` = requests carrying `api_key` / `base_url` / `decider_url` are rejected with 403. Recommended for shared deployments. |
| `RATE_LIMIT_MAX` | `120` | Requests per `RATE_LIMIT_WINDOW_MS` per IP+path. `0` disables. Sends `X-RateLimit-*` headers. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Fixed window length. |

## 7. Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_REQUESTS` | `false` | Write a JSONL audit entry for every evaluate call (mode, model, tokens, latency, request id). |
| `LOG_FILE` | `logs/myjev.jsonl` | Audit log path (absolute, or relative to the work dir). Containers pin `/app/logs/myjev.jsonl` on the `myjev_logs` volume. |
| `LOG_MAX_BYTES` | `5242880` | Rotate at this size, keep 5 rotated files. |
| `VITE_LOG_LEVEL` | `warn` | Vite middleware log level in dev (`info`/`warn`/`error`/`silent`). |

Every response carries `X-Request-Id` (honours an incoming one) and `meta.request_id` — correlate
UI errors with server logs by that id.

## 8. Docker / Compose

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPOSE_PROJECT_NAME` | `myjev` | Project prefix for containers/volumes/network. |
| `IMAGE_NAMESPACE` / `IMAGE_TAG` | `myjev` / `latest` | Which images compose runs (point at a registry for CI deploys). |
| `NODE_VERSION` | `22` | Base image tag for all node images. |
| `RESTART_POLICY` | `unless-stopped` | Compose restart for every service. |
| `READ_ONLY_FS` | `false` | `true` = `read_only: true` on web/api/mock (they already run cap-dropped with tmpfs). |
| `PUID` / `PGID` | `1001` | UID/GID of the production images. |
| `DEV_UID` / `DEV_GID` | `1000` | UID/GID of the dev image (match your host user on Linux). |
| `NPM_FLAGS` | — | Extra npm flags during image builds (mirror registry etc.). Must be empty or contain **one whole flag** — see the note below. |
| `SERVER_MINIFY` / `VITE_SOURCEMAP` | `true` / `false` | Server bundle minification / client sourcemaps. |
| `WEB_PORT` / `API_PORT` | `8080` / `3001` | Host port mappings. |
| `AIO_PORT` / `DEV_PORT` / `DEV_API_PORT` | `3001` / `3001` / `3002` | Other profiles. |
| `MOCK_PORT` / `DECIDER_PORT` | `8001` / `8000` | Decider backends. |
| `TLS_PORT` / `CADDY_HTTP_PORT` | `8443` / `8081` | Caddy listeners. |
| `API_CPUS` / `API_MEMORY` / `API_MEMORY_RESERVATION` | `2.0` / `1g` / `256m` | Resource limits for the api container. |
| `LOG_MAX_SIZE` / `LOG_MAX_FILE` | `10m` / `5` | Docker json-file log rotation for all services. |
| `NETWORK_NAME` / `VOLUME_PREFIX` | `myjev` | Network/volume naming. |

> **No trailing comments on `NPM_FLAGS`.** Docker Compose passes the raw value to
> `--build-arg NPM_FLAGS=…`, so a comment on the same line becomes part of the value:
>
> ```env
> NPM_FLAGS=                         # e.g. --registry=https://my.npm.mirror   ← WRONG
> NPM_FLAGS=--registry=https://my.npm.mirror    # this works (comment after a value)
> ```
>
> The result is `npm error code EINVALIDTAGNAME: Invalid tag name "#"` during the image build.

### GPU profile

| Variable | Default | Description |
|----------|---------|-------------|
| `DECIDER_CUDA_IMAGE` | `nvidia/cuda:12.4.1-runtime-ubuntu22.04` | CUDA base. |
| `DECIDER_REF` | `main` | Git ref of Mapika/decider to build from — pin a commit for production. |
| `DECIDER_MODEL` | `Mapika/decider-2b` | Checkpoint served at boot. |
| `DECIDER_BAKE_WEIGHTS` | `false` | `true` downloads weights during build (zero cold start, much bigger image). |
| `DECIDER_SHM_SIZE` | `2gb` | Shared memory for torch. |
| `HF_TOKEN` | — | Hugging Face token for gated models. |
| `DECIDER_WEIGHTS_PATH` | — | Optional local weights dir to bind-mount (uncomment the volume in compose). |

### TLS profile

| Variable | Default | Description |
|----------|---------|-------------|
| `MYJEV_HOST` | `localhost` | Site address Caddy serves. Set your domain for Let's Encrypt. |
| `MYJEV_TLS_INTERNAL` | `internal` | `internal` = Caddy CA (self-signed). Empty + `MYJEV_CERT_DIR` = your own certs. |
| `MYJEV_AUTO_HTTPS` | `internal` | Caddy `auto_https` global mode. |
| `MYJEV_CERT_DIR` | `./certs` | Host dir with `tls.crt`/`tls.key` (see `scripts/gen-certs.sh`). |

### Ops profile

| Variable | Default | Description |
|----------|---------|-------------|
| `WATCHTOWER_POLL_INTERVAL` | `86400` | Seconds between update checks. |
| `WATCHTOWER_NOTIFICATIONS` | — | e.g. `slack` (configure via Watchtower's own env). |

## 9. Registry / CI

| Variable | Default | Description |
|----------|---------|-------------|
| `REGISTRY` | `ghcr.io` | Target registry for `scripts/docker-build.sh`. |
| `REGISTRY_NAMESPACE` | `open-factoryai` | Registry org/user. |
| `IMAGES` | `api web mock-decider` | Which images to build (add `decider`, `dev`). |
| `PLATFORMS` | `linux/amd64` | buildx platforms (`,`-separated for multi-arch). |
| `PUSH` | `false` | Push after build. |

---

## 10. Request-time overrides (cheat sheet)

```jsonc
POST /api/evaluate
{
  "mode": "parallel",              // parallel | oneshot | decider | mock
  "state": "…",                    // string or arbitrary JSON
  "questions": { … },              // { name: {type, instructions?, criteria} }
  "model": "llama-3.3-70b-versatile",
  "base_url": "https://api.groq.com/openai/v1",
  "api_key": "gsk_…",              // ignored when ALLOW_CLIENT_OVERRIDES=false
  "decider_url": "http://decider:8000",
  "temperature": 0,
  "softmax_temperature": 0.8,      // sharper distributions
  "concurrency": 8,
  "timeout_ms": 60000,
  "retries": 2,
  "max_tokens": 32,
  "system_prompt_extra": "Prefer 'other' when evidence is thin.",
  "log": true                      // audit-log this request even if LOG_REQUESTS=false
}
```

All numeric fields are clamped server-side to the ranges in §3 — bad values can't turn into
runaway token spend.
