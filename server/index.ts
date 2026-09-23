/**
 * myJEV API server
 * ──────────────────
 *  POST /api/evaluate        single state + typed questions -> structured answers
 *  POST /api/evaluate/batch  many states, one question set
 *  GET  /api/health          liveness + backend probe
 *  GET  /api/config          non-secret runtime config (used by the UI)
 *  GET  /api/models          list models from the configured provider
 *
 *  In development it mounts Vite in middleware mode (HMR).
 *  In production it serves ./dist (single-image mode) — or you can run nginx in front
 *  and only use this process for /api (docker compose default).
 */
import "./loadEnv";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluate, evaluateBatch } from "../src/lib/evaluate";
import type { BatchRequest, EvaluateRequest } from "../src/lib/types";
import { loadConfig } from "./config";
import { listModels, probeDecider, publicConfig } from "./health";
import { initLogger, logRequest, closeLogger } from "./logger";
import { authMiddleware, rateLimitMiddleware } from "./middleware";

const cfg = loadConfig();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Find the built SPA. Works for `node dist-server/server/index.js`, tsx, and the Docker image. */
function resolveWebRoot(): string | null {
  const candidates: string[] = [];
  if (cfg.webRoot) candidates.push(path.resolve(cfg.webRoot));
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, "dist"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) {
    try {
      if (fs.statSync(path.join(c, "index.html")).isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

async function main() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", cfg.trustProxy);

  app.use(
    cors({
      origin: cfg.corsOrigins.length ? cfg.corsOrigins : true,
      credentials: false,
      exposedHeaders: ["X-Request-Id", "X-RateLimit-Remaining"],
    })
  );
  app.use(express.json({ limit: cfg.bodyLimit }));

  initLogger(cfg);

  app.use((req, res, next) => {
    const id = (req.header("x-request-id") || crypto.randomUUID()).slice(0, 36);
    res.setHeader("X-Request-Id", id);
    (req as express.Request & { id?: string }).id = id;
    const t0 = Date.now();
    res.on("finish", () => {
      if (!cfg.requestLog.enabled) return;
      logRequest({
        ts: new Date().toISOString(),
        request_id: id,
        route: req.path,
        status: res.statusCode,
        latency_ms: Date.now() - t0,
        ip: req.ip,
      });
    });
    next();
  });

  console.log(
    `[myjev] v${cfg.version} · env=${cfg.isProd ? "production" : "development"} · ` +
      `llm_key=${cfg.llmKeySource ?? "none"} · base_url=${cfg.defaults.baseUrl ?? "openai-default"} · ` +
      `decider=${cfg.decider.baseUrl} · auth=${cfg.apiToken ? "on" : "off"} · ` +
      `rate_limit=${cfg.rateLimit.max || "off"} · log_requests=${cfg.requestLog.enabled}`
  );

  /* ─────────────────────────── API routes ─────────────────────────── */

  const api = express.Router();
  api.use(authMiddleware(cfg));
  api.use(rateLimitMiddleware(cfg));

  api.get("/health", async (_req, res) => {
    const decider = await probeDecider(cfg, 1500);
    res.json({
      ok: true,
      ...publicConfig(cfg),
      probe: { decider },
    });
  });

  api.get("/config", (_req, res) => res.json(publicConfig(cfg)));

  api.get("/backends", async (_req, res) => {
    const decider = await probeDecider(cfg, 2500);
    const llm = await listModels(cfg, undefined, undefined, 5000);
    res.json({
      decider,
      llm: {
        name: "openai-compatible",
        ok: llm.ok,
        url: llm.baseUrl,
        detail: llm.ok ? `${llm.models.length} models` : llm.error,
      },
      mock: { name: "mock", ok: true, detail: "always available (offline)" },
    });
  });

  api.get("/models", async (req, res) => {
    if (!cfg.allowClientOverrides) {
      return res.status(403).json({ error: "Client overrides disabled (ALLOW_CLIENT_OVERRIDES=false)" });
    }
    const apiKey = typeof req.query.api_key === "string" ? req.query.api_key : undefined;
    const baseUrl = typeof req.query.base_url === "string" ? req.query.base_url : undefined;
    const out = await listModels(cfg, apiKey, baseUrl);
    res.json(out);
  });

  api.post("/evaluate", async (req, res) => {
    const t0 = Date.now();
    const requestId = (req as express.Request & { id?: string }).id ?? crypto.randomUUID();
    const body = (req.body ?? {}) as EvaluateRequest;

    if (body.state === undefined || body.state === null) {
      return res.status(400).json({ error: "Missing 'state'", request_id: requestId });
    }
    if (!body.questions || typeof body.questions !== "object" || Array.isArray(body.questions)) {
      return res.status(400).json({ error: "Missing 'questions' object", request_id: requestId });
    }
    if (!cfg.allowClientOverrides && (body.api_key || body.base_url || body.decider_url)) {
      return res
        .status(403)
        .json({ error: "Server is locked (ALLOW_CLIENT_OVERRIDES=false): api_key/base_url/decider_url are ignored", request_id: requestId });
    }

    try {
      const result = await evaluate({
        state: body.state,
        questions: body.questions,
        model: body.model,
        base_url: body.base_url,
        api_key: body.api_key,
        temperature: body.temperature ?? cfg.defaults.temperature,
        softmax_temperature: body.softmax_temperature ?? cfg.defaults.softmaxTemperature,
        concurrency: body.concurrency ?? cfg.defaults.concurrency,
        timeout_ms: body.timeout_ms ?? cfg.defaults.timeoutMs,
        retries: body.retries ?? cfg.defaults.retries,
        max_tokens: body.max_tokens ?? cfg.defaults.maxTokens,
        system_prompt_extra: body.system_prompt_extra,
        mode: (body.mode ?? cfg.defaults.mode) as EvaluateRequest["mode"],
        decider_url: body.decider_url,
        request_id: requestId,
      });

      if (cfg.requestLog.enabled || body.log) {
        logRequest({
          ts: new Date().toISOString(),
          request_id: requestId,
          route: "/api/evaluate",
          mode: result.meta?.mode,
          model: result.model,
          status: 200,
          latency_ms: Date.now() - t0,
          questions: Object.keys(body.questions).length,
          calls: result.meta?.parallel_calls,
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          ip: req.ip,
        });
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[/api/evaluate]", message);
      if (cfg.requestLog.enabled || body.log) {
        logRequest({
          ts: new Date().toISOString(),
          request_id: requestId,
          route: "/api/evaluate",
          mode: body.mode,
          model: body.model,
          status: 500,
          latency_ms: Date.now() - t0,
          error: message.slice(0, 500),
          ip: req.ip,
        });
      }
      res.status(502).json({
        error: message,
        request_id: requestId,
        model: body.model ?? "unknown",
        answers: {},
        usage: { input_tokens: null, output_tokens: null },
      });
    }
  });

  api.post("/evaluate/batch", async (req, res) => {
    const t0 = Date.now();
    const requestId = (req as express.Request & { id?: string }).id ?? crypto.randomUUID();
    const body = (req.body ?? {}) as BatchRequest;
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: "Missing 'items' array", request_id: requestId });
    }
    try {
      const out = await evaluateBatch({
        ...body,
        concurrency: body.concurrency ?? cfg.defaults.concurrency,
        temperature: body.temperature ?? cfg.defaults.temperature,
        timeout_ms: body.timeout_ms ?? cfg.defaults.timeoutMs,
        retries: body.retries ?? cfg.defaults.retries,
        mode: body.mode ?? (cfg.defaults.mode as BatchRequest["mode"]),
      });
      logRequest({
        ts: new Date().toISOString(),
        request_id: requestId,
        route: "/api/evaluate/batch",
        mode: out.mode,
        model: out.model,
        status: 200,
        latency_ms: Date.now() - t0,
        questions: out.total,
        ip: req.ip,
      });
      res.json(out);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[/api/evaluate/batch]", message);
      res.status(502).json({ error: message, request_id: requestId });
    }
  });

  app.use("/api", api);

  /* ───────────────────── static SPA / Vite dev middleware ───────────────────── */

  const webRoot = resolveWebRoot();
  const serveSpa = Boolean(cfg.isProd || process.env.SERVE_STATIC === "true");

  if (serveSpa) {
    if (!webRoot) {
      console.warn("[myjev] NODE_ENV=production but no built SPA found (dist/index.html). API-only mode.");
      app.get("/", (_req, res) =>
        res
          .status(200)
          .type("text/plain")
          .send(
            "myJEV API is running (no UI bundle found).\n" +
              "POST /api/evaluate · GET /api/health · GET /api/config\n" +
              "Build the UI with `npm run build:client` or run the `web` (nginx) container.\n"
          )
      );
    } else {
      console.log(`[myjev] serving SPA from ${webRoot}`);
      app.use(express.static(webRoot, { index: false, maxAge: "1h" }));
      app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webRoot!, "index.html")));
    }
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: path.resolve(__dirname, ".."),
      configFile: path.resolve(__dirname, "../vite.config.ts"),
      server: { middlewareMode: true, hmr: { protocol: "ws", host: undefined } },
      appType: "spa",
      logLevel: (["info", "warn", "error", "silent"].includes(process.env.VITE_LOG_LEVEL || "")
        ? (process.env.VITE_LOG_LEVEL as "info" | "warn" | "error" | "silent")
        : "warn"),
    });
    app.use(vite.middlewares);
    console.log("[myjev] vite dev middleware mounted (HMR on)");
  }

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: `Unknown API route ${req.method} ${req.path}` });
    }
    res.status(404).type("text/plain").send("Not found");
  });

  /* ───────────────────────────── listen + shutdown ─────────────────────────── */

  const server = app.listen(cfg.port, cfg.host, () => {
    const shown = cfg.host === "0.0.0.0" ? "localhost" : cfg.host;
    console.log("");
    console.log("  myJEV — System One decision playground");
    console.log(`  → http://${shown}:${cfg.port}`);
    console.log(`  → POST /api/evaluate   (modes: parallel | oneshot | decider | mock)`);
    console.log(`  → POST /api/evaluate/batch`);
    console.log(`  → GET  /api/health · /api/config · /api/backends · /api/models`);
    console.log("");
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[myjev] ${signal} received — draining…`);
    const killer = setTimeout(() => {
      console.error("[myjev] forced exit after 10s");
      process.exit(1);
    }, 10_000);
    killer.unref();
    server.close(() => {
      closeLogger();
      clearTimeout(killer);
      console.log("[myjev] bye");
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => console.error("[myjev] unhandledRejection:", reason));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
