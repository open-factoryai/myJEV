/**
 * Backend probing for GET /api/health and GET /api/backends.
 * Kept deliberately dependency-free (global fetch, Node >= 18).
 */
import OpenAI from "openai";
import { resolveApiKey, resolveBaseUrl, resolveModel } from "../src/lib/evaluate";
import type { ServerConfig } from "./config";

const DECIDER_PROBES = ["/health", "/healthz", "/v1/models", "/"];

export interface BackendStatus {
  name: string;
  ok: boolean | null; // null = not probed / unknown
  url?: string;
  detail?: string;
  latency_ms?: number;
}

export async function probeDecider(cfg: ServerConfig, timeoutMs = 2500): Promise<BackendStatus> {
  const base = cfg.decider.baseUrl.replace(/\/+$/, "");
  const t0 = Date.now();
  for (const p of DECIDER_PROBES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${p}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok || res.status === 405 || res.status === 401) {
        return {
          name: "decider",
          ok: true,
          url: base,
          detail: `reachable via ${p} (HTTP ${res.status})`,
          latency_ms: Date.now() - t0,
        };
      }
    } catch {
      clearTimeout(timer);
    }
  }
  return {
    name: "decider",
    ok: false,
    url: base,
    detail: "unreachable — start it with `docker compose --profile mock up` or the GPU profile",
    latency_ms: Date.now() - t0,
  };
}

export async function listModels(
  cfg: ServerConfig,
  apiKey?: string,
  baseUrl?: string,
  timeoutMs = 8000
): Promise<{ ok: boolean; models: string[]; error?: string; baseUrl?: string }> {
  const url = resolveBaseUrl(baseUrl) ?? cfg.defaults.baseUrl;
  const key = resolveApiKey(apiKey) ?? "";
  if (!key && !url) return { ok: false, models: [], error: "no api key / base url configured" };
  try {
    const client = new OpenAI({ apiKey: key || "not-needed", baseURL: url, timeout: timeoutMs, maxRetries: 0 });
    const page = await client.models.list();
    const models = (page.data ?? [])
      .map((m) => m.id)
      .filter(Boolean)
      .sort()
      .slice(0, 500);
    return { ok: true, models, baseUrl: url };
  } catch (err) {
    return {
      ok: false,
      models: [],
      baseUrl: url,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    };
  }
}

export function publicConfig(cfg: ServerConfig) {
  return {
    service: "myjev",
    version: cfg.version,
    mode: cfg.isProd ? "production" : "development",
    defaults: {
      mode: cfg.defaults.mode,
      model: cfg.defaults.model,
      base_url: cfg.defaults.baseUrl ?? null,
      temperature: cfg.defaults.temperature,
      softmax_temperature: cfg.defaults.softmaxTemperature,
      concurrency: cfg.defaults.concurrency,
      timeout_ms: cfg.defaults.timeoutMs,
      retries: cfg.defaults.retries,
    },
    backends: ["parallel", "oneshot", "decider", "mock"],
    decider: {
      url: cfg.decider.baseUrl,
      enabled: cfg.decider.enabled,
      key_configured: Boolean(cfg.decider.apiKey),
    },
    llm: {
      key_configured: cfg.hasLlmKey,
      key_source: cfg.llmKeySource,
      base_url: cfg.defaults.baseUrl ?? "https://api.openai.com/v1 (openai default)",
      default_model: resolveModel(),
    },
    security: {
      auth_required: Boolean(cfg.apiToken) || cfg.requireAuth,
      rate_limit: cfg.rateLimit.max > 0 ? `${cfg.rateLimit.max}/${Math.round(cfg.rateLimit.windowMs / 1000)}s` : "off",
      cors: cfg.corsOrigins.length ? cfg.corsOrigins : "*",
      allow_client_overrides: cfg.allowClientOverrides,
    },
    logging: { requests: cfg.requestLog.enabled, file: cfg.requestLog.enabled ? cfg.requestLog.file : null },
    uptime_s: Math.round(process.uptime()),
  };
}
