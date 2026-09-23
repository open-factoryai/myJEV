# myJEV — Docker Guide

Everything about running myJEV in containers: topologies, profiles, images, GPU, TLS,
registries, hardening and troubleshooting.

> TL;DR
> ```bash
> cp .env.example .env
> docker compose --profile mock up -d --build
> open http://localhost:8080        # UI (nginx) → API (node) → mock decider, zero keys
> ```

---

## 1. The images

| Image | Dockerfile | Base | Purpose |
|-------|-----------|------|---------|
| `myjev/web` | `docker/Dockerfile.web` | `nginx:1.27-alpine` | static SPA + `/api` reverse proxy, unprivileged `:8080`, healthcheck |
| `myjev/api` | `docker/Dockerfile.api` | `node:22-alpine` | bundled Express API (+ can serve the SPA itself), tini, non-root, healthcheck, JSONL log volume |
| `myjev/dev` | `docker/Dockerfile.dev` | `node:22-bookworm-slim` | hot-reload dev server (tsx watch + Vite HMR) |
| `myjev/mock-decider` | `docker/mock/Dockerfile` | `node:22-alpine` | offline `POST /v1/systemone` stand-in (zero deps) |
| `myjev/decider` | `docker/decider/Dockerfile` | `nvidia/cuda:12.4-runtime` | real Mapika/decider weights on GPU (profile `gpu`) |

Shared properties:

* **Multi-stage builds** — deps → build (typecheck + bundle) → slim runtime. No compilers, no dev deps,
  no source in the final layers.
* **Non-root** by default (`UID/GID` build args, `1001:1001` in production images).
* **`tini` as PID 1** — proper signal handling, no zombies.
* **HEALTHCHECK** on every image (`/api/health`, `/healthz`, `/health`).
* **Reproducible deps** — `npm ci` with a mounted build cache; `package-lock.json` is committed.
* **Secrets never enter a layer** — `.env` and `*.key/*.pem/*.crt` are excluded by `.dockerignore`.

Build them by hand if you like:

```bash
docker build -f docker/Dockerfile.api -t myjev/api:latest .
docker build -f docker/Dockerfile.web -t myjev/web:latest .
docker build -t myjev/mock-decider:latest docker/mock
```

Or use the helper (handles buildx, multi-arch, tagging, pushing):

```bash
./scripts/docker-build.sh                                   # local: api web mock-decider
PUSH=true TAG=v2.0.0 REGISTRY_NS=yourorg ./scripts/docker-build.sh
make buildx PLATFORMS=linux/amd64,linux/arm64
```

---

## 2. Compose topologies (profiles)

`docker-compose.yml` is one file with composable profiles — turn services on per flag:

| Command | What runs | Ports |
|---------|-----------|-------|
| `docker compose up -d --build` | `web` (nginx) + `api` (node) | `:8080` UI, `:3001` API |
| `docker compose --profile mock up -d --build` | + `mock` decider (offline) | `:8001` → mock |
| `docker compose --profile aio up -d --build` | single **all-in-one** container (node serves UI + API) | `:3001` |
| `docker compose --profile dev up -d --build` | hot-reload dev container (bind-mounted source) | `:3001` |
| `docker compose --profile dev-api up -d --build` | API-only dev container (tsx watch) | `:3002` |
| `docker compose --profile gpu up -d --build` | + real Mapika/decider on NVIDIA GPU | `:8000` |
| `docker compose --profile tls up -d --build` | + Caddy HTTPS front door | `:8443` https, `:8081` http |
| `docker compose --profile ops up -d --build` | + Watchtower auto-updates for web/api | — |

Profiles combine freely:

```bash
docker compose --profile mock --profile tls up -d --build
make up PROFILES="mock tls"
```

### How the default topology hangs together

```
            ┌────────────────────────────────────────────────┐
browser ───▶│  web (nginx :8080)                             │
            │   ├── /            → SPA from dist/ (immutable │
            │   │                  asset caching, SPA 404→/) │
            │   └── /api/*  ─────▶ api (node :3001)          │
            │                         ├── parallel/oneshot → your LLM provider
            │                         ├── decider → mock:8000 or decider:8000
            │                         └── mock → built into the api image
            └────────────────────────────────────────────────┘
```

* nginx resolves `api` through Docker's embedded DNS at **request time** (`resolver 127.0.0.11`),
  so the web container boots even if the API is still starting.
* The `dev` service carries the network alias `api`, so `--profile dev` works behind the same nginx.
* `mock` carries the alias `decider` too — flipping from mock to real GPU weights is a one-line
  `.env` change (`DECIDER_BASE_URL=http://decider:8000`), no compose edits.

### Ports

All overridable from `.env`: `WEB_PORT` (8080), `API_PORT` (3001), `AIO_PORT`, `DEV_PORT`,
`DEV_API_PORT`, `MOCK_PORT` (8001), `DECIDER_PORT` (8000), `TLS_PORT` (8443), `CADDY_HTTP_PORT` (8081).

Keep the API private (only behind nginx) by commenting out the `ports:` block on the `api` service —
compose already exposes it internally on the `myjev` network, and nginx proxies `/api`.

---

## 3. Configuration

One `.env` file drives everything (compose substitution + container env). Start from
`.env.example` (every knob, commented) or `.env.docker.example` (minimal, deployment-shaped).
Full reference: [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

The three decisions that matter:

```env
# 1) Which backend by default?
MYJEV_DEFAULT_MODE=parallel        # parallel | oneshot | decider | mock

# 2) Which LLM?
OPENAI_API_KEY=sk-...                # or GROQ_API_KEY, CEREBRAS_API_KEY, …
OPENAI_BASE_URL=https://api.groq.com/openai/v1
MYJEV_MODEL=llama-3.3-70b-versatile

# 3) Which decider?
DECIDER_BASE_URL=http://mock:8000    # or http://decider:8000 (GPU profile)
```

`.env` is passed to the api/dev/aio containers via `env_file` **and** compose substitution.
Real shell environment variables always win over file values (docker `environment:` overrides
`env_file:`), so container paths like `LOG_FILE=/app/logs/myjev.jsonl` are pinned in the compose file.

> **Keep comments on their own line when the value is empty.** Compose keeps everything after
> `=` as the value, so `NPM_FLAGS=   # comment` passes `# comment` to the image build and npm
> fails with `EINVALIDTAGNAME`. Trailing comments after a *non-empty* value are fine.

---

## 4. First run, step by step

```bash
git clone <your-fork> myjev && cd myjev
cp .env.example .env

# offline demo — no keys, no GPU, deterministic
docker compose --profile mock up -d --build
docker compose --profile mock ps          # wait for healthy

curl -s localhost:8080/api/health | head -c 400
bash scripts/healthcheck.sh http://localhost:8080

open http://localhost:8080
# → Settings → Provider "Mock (offline demo)"  (or mode = mock)
# → Run myJEV
```

Then switch to a real model by editing `.env` and `docker compose up -d` again (or just paste a
key in Settings — it is stored in your browser and sent per-request; prefer the server env for
shared installs).

---

## 5. Development workflow

```bash
# hot reload, everything in containers
docker compose --profile dev up -d --build
open http://localhost:3001        # tsx watch + Vite HMR

# or just the API in a container, UI on your host
docker compose --profile dev-api up -d --build
npm run dev:client                # vite on :5173, proxies /api to :3001
```

* Source is **bind-mounted** (`./` → `/app`); `node_modules` lives in a named volume so your host's
  OS never matters.
* File watching uses polling (`CHOKIDAR_USEPOLLING=true`) — works on Docker Desktop and WSL2.
* `make logs` tails everything; `docker compose exec dev bash` drops you into the dev box.
* On Linux, set `PUID=$(id -u)` / `PGID=$(id -g)` in `.env` so mounted files stay writable
  (`DEV_UID`/`DEV_GID` for the dev image).

---

## 6. GPU: real Mapika/decider weights

Prereqs: NVIDIA driver + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).

```bash
docker compose --profile gpu up -d --build decider
docker compose --profile gpu logs -f decider        # first boot downloads weights (~4 GB for 2B)

# in .env
DECIDER_BASE_URL=http://decider:8000

docker compose --profile gpu up -d --build web api
curl -s localhost:8000/v1/systemone -H 'content-type: application/json' \
  -d '{"state":"My card was charged twice.","questions":{"team":{"type":"choice","instructions":"Which team?","criteria":{"billing":"charges","technical":"bugs"}}}}'
```

Knobs (`.env`): `DECIDER_MODEL` (default `Mapika/decider-2b`), `DECIDER_REF` (git ref to pin),
`DECIDER_CUDA_IMAGE`, `DECIDER_BAKE_WEIGHTS=true` (download weights **during build** so the
container has zero cold-start — bigger image), `DECIDER_SHM_SIZE`, `HF_TOKEN` for gated models.
Weights persist in the `decider_weights` volume; health check allows a 10 min start period.

No GPU on the host? Run the model anywhere reachable and just point `DECIDER_BASE_URL` at it —
the api container only needs HTTP.

---

## 7. TLS with Caddy

```bash
# localhost with Caddy's internal CA (accept the warning once):
docker compose --profile tls up -d --build
open https://localhost:8443
```

Real domain:

```env
MYJEV_HOST=jev.example.com
MYJEV_TLS_INTERNAL=            # empty → Let's Encrypt HTTP-01 (ports 80/443 must be reachable,
                                 # adjust the port mapping to 80:8443 or run Caddy on 443)
```

Bring your own certificate:

```bash
./scripts/gen-certs.sh jev.internal       # → certs/tls.crt + certs/tls.key
# .env: MYJEV_TLS_INTERNAL=  and  MYJEV_CERT_DIR=./certs
# uncomment the /certs volume on the caddy service
```

Caddy proxies `/api/*` → `api:3001` and everything else → `web:8080`, with long write timeouts
for slow LLM calls.

---

## 8. Registries & CI

* `scripts/docker-build.sh` — buildx multi-arch (`linux/amd64,linux/arm64`), tags
  `<registry>/<ns>/myjev-<image>:<tag>`, optional `PUSH=true`.
* GitHub Actions (`.github/workflows/docker.yml`):
  1. `test` — typecheck + build + **offline smoke test**
  2. `images` — matrix build for api / web / mock-decider with GHA cache, pushed to GHCR on main/tags
  3. `compose` — boots the real stack and probes it over HTTP
* Point Compose at a registry: `IMAGE_NAMESPACE=ghcr.io/yourorg IMAGE_TAG=v2.0.0 docker compose pull && docker compose up -d`.
* `--profile ops` adds Watchtower for automatic image updates (scoped to the myJEV containers).

---

## 9. Hardening checklist (production)

- [ ] `MYJEV_API_TOKEN=<long-random>` + `REQUIRE_AUTH=true` (UI: paste the token in Settings → Server)
- [ ] `ALLOW_CLIENT_OVERRIDES=false` — ignore client-supplied keys/URLs
- [ ] `CORS_ORIGINS=https://app.example.com` — no wildcard
- [ ] Comment out `api.ports:` — API only reachable through nginx/Caddy
- [ ] TLS via the `tls` profile or your ingress
- [ ] `RATE_LIMIT_MAX` tuned to your quota; consider a real gateway for multi-tenant use
- [ ] `LOG_REQUESTS=true` (JSONL audit trail in the `myjev_logs` volume — rotate/ship it)
- [ ] Pin versions: `IMAGE_TAG=v2.0.0`, `NODE_VERSION=22`, `DECIDER_REF=<commit>`
- [ ] `READ_ONLY_FS=true` (default images already run with `no-new-privileges`, dropped caps, tmpfs)
- [ ] Resource limits (`API_CPUS`, `API_MEMORY`) sized for your workload

---

## 10. Operations cheat-sheet

```bash
make ps                 # status + health
make logs               # tail all services
docker compose logs -f api
docker compose restart api
docker compose exec api sh             # shell into the API
docker compose exec web sh             # shell into nginx
docker compose exec api node scripts/healthcheck.mjs

# update
git pull && docker compose --profile mock up -d --build

# disk
docker system df
make clean-volumes      # ⚠ deletes logs, node_modules volume and decider weights
```

Volumes: `myjev_logs` (JSONL audit log), `myjev_node_modules` (dev), `decider_weights` (HF cache),
`caddy_data` / `caddy_config` (certificates).

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `web` shows "api down", 502 on `/api/*` | api container not healthy yet — `docker compose ps`, `docker compose logs api`. nginx retries DNS every 10 s; just wait, or `docker compose restart web`. |
| `No API key configured` in the UI | no key server-side and none pasted — set `OPENAI_API_KEY` in `.env` + `up -d` again, paste one in Settings, or use mode `mock` / `--profile mock`. |
| `decider … connection refused` | `DECIDER_BASE_URL` unreachable **from the api container**. Inside compose use service names (`http://mock:8000`, `http://decider:8000`) — not `localhost`. |
| GPU profile: `could not select device driver "nvidia"` | NVIDIA Container Toolkit missing, or Docker Desktop without GPU support. |
| Ollama/vLLM on the host unreachable | use `http://host.docker.internal:11434/v1`; on **Linux** add `extra_hosts: ["host.docker.internal:host-gateway"]` to the api service. |
| Port already in use | change `WEB_PORT` / `API_PORT` / … in `.env` (or stop the squatter: `lsof -i :8080`). |
| `npm ci` fails behind a corporate proxy | `NPM_FLAGS=--registry=https://your-mirror` in `.env`, or configure docker build-time proxies. |
| `npm error code EINVALIDTAGNAME` / `Invalid tag name "#"` during the build | `NPM_FLAGS` in `.env` has a trailing comment on an empty value, so `#` is passed to npm as a package name. Put the comment on its own line (or after a real value): `NPM_FLAGS=` — see [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md). |
| Files owned by root after dev runs (Linux) | set `DEV_UID`/`DEV_GID` (and `PUID`/`PGID`) to your `id -u`/`id -g`. |
| Extremely slow first `up` | building Vite + npm ci cold; subsequent runs use build caches. `BUILDKIT_PROGRESS=plain` for detail. |

Debug probe:

```bash
docker compose exec api wget -qO- http://mock:8000/health       # from api → mock
docker compose exec web wget -qO- http://api:3001/api/config    # from web → api
```
