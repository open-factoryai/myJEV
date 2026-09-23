# syntax=docker/dockerfile:1.7
# ══════════════════════════════════════════════════════════════════════════
#  mock-decider — offline stand-in for a Mapika/decider GPU server.
#  Speaks POST /v1/systemone so the whole myJEV stack can be exercised
#  with no GPU, no API key and no internet access.
#
#  build: docker build -t myjev/mock-decider:latest docker/mock
#  run:   docker run --rm -p 8000:8000 myjev/mock-decider:latest
# ══════════════════════════════════════════════════════════════════════════
FROM node:22-alpine

ARG UID=1001
ARG GID=1001

ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0 \
    MOCK_MODEL=mock-decider-2b \
    MOCK_LATENCY_MS=0

WORKDIR /app
RUN apk add --no-cache tini wget \
 && addgroup -g ${GID} -S myjev \
 && adduser -u ${UID} -S myjev -G myjev

COPY --chown=${UID}:${GID} package.json mock-decider.mjs ./
USER ${UID}:${GID}

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "mock-decider.mjs"]
