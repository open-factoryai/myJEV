# ══════════════════════════════════════════════════════════════════════════
#  myJEV — Makefile
#  Everything is a thin wrapper over docker compose / npm. `make help` lists it.
# ══════════════════════════════════════════════════════════════════════════

SHELL            := /bin/bash
COMPOSE          ?= docker compose
PROFILES         ?=
NAMESPACE        ?= myjev
TAG              ?= latest
PLATFORMS        ?= linux/amd64
PUSH             ?= false
REGISTRY         ?= ghcr.io
REGISTRY_NS      ?= open-factoryai
WEB_PORT         ?= 8080
API_PORT         ?= 3001
MOCK_PORT        ?= 8001
DECIDER_PORT     ?= 8000

ifneq ($(PROFILES),)
  PROFILE_FLAGS := $(addprefix --profile ,$(PROFILES))
else
  PROFILE_FLAGS :=
endif

.DEFAULT_GOAL := help
.PHONY: help install dev build build-client build-server start typecheck test smoke \
        up down restart logs ps pull buildx push release clean clean-volumes \
        mock demo gpu tls aio status health curl-evaluate curl-mock curl-decider \
        shell-api shell-web lint-config env

## ── help ──────────────────────────────────────────────────────────────────
help: ## Show this help
	@printf '\n\033[1mmyJEV — make targets\033[0m\n\n'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@printf '\n\033[2mProfiles: PROFILES="mock tls" make up\033[0m\n\n'

## ── local (no docker) ─────────────────────────────────────────────────────
install: ## npm install
	npm install

env: ## Create .env from .env.example (never overwrites)
	@test -f .env && echo ".env already exists" || cp .env.example .env

dev: env ## Run UI+API with hot reload on :3001
	npm run dev

build: ## Typecheck + build SPA and server bundle
	npm run typecheck && npm run build

build-client: ## Vite build only → dist/
	npm run build:client

build-server: ## esbuild server bundle only → dist-server/
	npm run build:server

start: build ## Build, then serve production bundle on :3001
	NODE_ENV=production npm run start

typecheck: ## tsc --noEmit (client + server projects)
	npm run typecheck

mock: ## Run the offline mock decider on :8000
	PORT=8000 node docker/mock/mock-decider.mjs

smoke: ## Build, boot the server + mock, exercise /api/evaluate (no API key needed)
	bash scripts/smoke-test.sh

test: smoke ## alias for smoke

## ── docker compose ────────────────────────────────────────────────────────
up: env ## Compose up (PROFILES="mock dev gpu tls aio ops")
	$(COMPOSE) $(PROFILE_FLAGS) up -d --build

down: ## Compose down
	$(COMPOSE) $(PROFILE_FLAGS) down

restart: ## Restart all services
	$(COMPOSE) $(PROFILE_FLAGS) restart

logs: ## Tail logs
	$(COMPOSE) $(PROFILE_FLAGS) logs -f --tail=120

ps: ## Service status + health
	$(COMPOSE) $(PROFILE_FLAGS) ps

status: ps ## alias for ps

pull: ## Pull latest images
	$(COMPOSE) $(PROFILE_FLAGS) pull

demo: ## Up with the offline mock (no keys, no GPU) → http://localhost:8080
	$(COMPOSE) --profile mock up -d --build
	@echo "→ http://localhost:$(WEB_PORT)   (UI, mode: mock or provider 'Mock (offline demo)')"

gpu: ## Up with the real Mapika/decider GPU server (needs nvidia container toolkit)
	$(COMPOSE) --profile gpu up -d --build decider
	$(COMPOSE) --profile gpu up -d --build web api

tls: ## Up with the Caddy TLS front door → https://localhost:8443
	$(COMPOSE) --profile tls up -d --build

aio: ## Single all-in-one container → http://localhost:3001
	$(COMPOSE) --profile aio up -d --build all-in-one

shell-api: ## Shell into the api container
	$(COMPOSE) exec api sh

shell-web: ## Shell into the web (nginx) container
	$(COMPOSE) exec web sh

health: ## Probe /api/health through nginx and directly
	@bash scripts/healthcheck.sh http://localhost:$(WEB_PORT) || true
	@bash scripts/healthcheck.sh http://localhost:$(API_PORT) || true

lint-config: ## Validate compose + nginx + Dockerfile syntax locally
	@$(COMPOSE) config --quiet && echo "compose: OK"
	@docker run --rm -v $$PWD/docker/nginx/nginx.conf:/tmp/nginx.conf:ro \
		-v $$PWD/docker/nginx/conf.d:/etc/nginx/conf.d:ro \
		nginx:1.27-alpine nginx -t -c /tmp/nginx.conf || echo "nginx: skipped (docker not available)"

## ── images / registry ─────────────────────────────────────────────────────
buildx: ## Multi-arch build with buildx (PLATFORMS=linux/amd64,linux/arm64)
	PLATFORMS=$(PLATFORMS) PUSH=$(PUSH) REGISTRY=$(REGISTRY) REGISTRY_NAMESPACE=$(REGISTRY_NS) \
	TAG=$(TAG) NAMESPACE=$(NAMESPACE) bash scripts/docker-build.sh

push: ## Build + push (REGISTRY=ghcr.io REGISTRY_NS=yourorg TAG=v2.0.0)
	PUSH=true PLATFORMS=$(PLATFORMS) REGISTRY=$(REGISTRY) REGISTRY_NAMESPACE=$(REGISTRY_NS) \
	TAG=$(TAG) NAMESPACE=$(NAMESPACE) bash scripts/docker-build.sh

release: ## Tag + push :latest and :$(TAG)
	TAG=$(TAG) $(MAKE) push
	TAG=latest $(MAKE) push

## ── quick API calls ───────────────────────────────────────────────────────
curl-evaluate: ## POST a sample /api/evaluate (mock mode) to :$(API_PORT)
	@curl -sS -X POST http://localhost:$(API_PORT)/api/evaluate \
		-H 'content-type: application/json' \
		-d '{"mode":"mock","state":"Charged twice again!! Fix it ASAP.","questions":{"department":{"type":"choice","instructions":"Which team?","criteria":{"billing":"charges, refunds","technical":"bugs","other":"else"}},"angry":{"type":"noul","instructions":"Strong frustration?"}}}' \
		| head -c 2000; echo

curl-mock: ## POST the same sample to the mock decider wire format (:$(MOCK_PORT))
	@curl -sS -X POST http://localhost:$(MOCK_PORT)/v1/systemone \
		-H 'content-type: application/json' \
		-d '{"state":"My card was charged twice.","questions":{"team":{"type":"choice","instructions":"Which team?","criteria":{"billing":"charges, refunds","technical":"bugs, outages"}}}}' \
		| head -c 1200; echo

curl-decider: ## POST a sample to the real decider (:$(DECIDER_PORT))
	@curl -sS -X POST http://localhost:$(DECIDER_PORT)/v1/systemone \
		-H 'content-type: application/json' \
		-d '{"state":"My card was charged twice.","questions":{"team":{"type":"choice","instructions":"Which team?","criteria":{"billing":"charges, refunds","technical":"bugs, outages"}},"refund":{"type":"noul","instructions":"Is a refund needed?"}}}' \
		| head -c 2000; echo

## ── cleanup ───────────────────────────────────────────────────────────────
clean: ## Remove local build output
	rm -rf dist dist-server coverage *.tsbuildinfo

clean-volumes: down ## Down + delete volumes (logs, node_modules, weights!)
	$(COMPOSE) $(PROFILE_FLAGS) down -v --remove-orphans
	@echo "volumes removed"
