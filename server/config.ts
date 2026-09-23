/**
 * Server runtime configuration.
 *
 * Every knob is an environment variable (see .env.example) with a per-request override.
 * Nothing here throws: myJEV must boot even with zero keys so the UI can explain what's missing.
 */
import { envStr } from "../src/lib/evaluate";

function num(key: string, fallback: number): number {
  const raw = envStr(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = envStr(key);
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function list(key: string): string[] {
  const raw = envStr(key);
  if (!raw || raw === "*") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ServerConfig {
  port: number;
  host: string;
  isProd: boolean;
  webRoot: string;
  trustProxy: boolean | number | string;
  bodyLimit: string;
  corsOrigins: string[];
  apiToken: string | null;
  requireAuth: boolean;
  rateLimit: { windowMs: number; max: number };
  requestLog: { enabled: boolean; file: string; maxSizeBytes: number };
  defaults: {
    mode: string;
    model: string;
    baseUrl: string | undefined;
    temperature: number;
    softmaxTemperature: number;
    concurrency: number;
    timeoutMs: number;
    retries: number;
    maxTokens: number;
  };
  decider: { baseUrl: string; apiKey: string | undefined; enabled: boolean };
  hasLlmKey: boolean;
  llmKeySource: string | null;
  allowClientOverrides: boolean;
  version: string;
}

const KEY_SOURCES = [
  "OPENAI_API_KEY",
  "MYJEV_API_KEY",
  "CEREBRAS_API_KEY",
  "GROQ_API_KEY",
  "PUTER_API_KEY",
  "OPENROUTER_API_KEY",
  "TOGETHER_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "API_KEY",
];

export function loadConfig(): ServerConfig {
  const llmKeySource = KEY_SOURCES.find((k) => Boolean(envStr(k))) ?? null;
  return {
    port: num("PORT", 3001),
    host: envStr("HOST") || "0.0.0.0",
    isProd: envStr("NODE_ENV") === "production" || bool("MYJEV_PROD", false),
    webRoot: envStr("MYJEV_WEB_ROOT") || "",
    trustProxy: bool("TRUST_PROXY", true),
    bodyLimit: envStr("BODY_LIMIT") || "2mb",
    corsOrigins: list("CORS_ORIGINS"),
    apiToken: envStr("MYJEV_API_TOKEN", "API_TOKEN") ?? null,
    requireAuth: bool("REQUIRE_AUTH", false),
    rateLimit: {
      windowMs: num("RATE_LIMIT_WINDOW_MS", 60_000),
      max: num("RATE_LIMIT_MAX", 120),
    },
    requestLog: {
      enabled: bool("LOG_REQUESTS", false),
      file: envStr("LOG_FILE") || "logs/myjev.jsonl",
      maxSizeBytes: num("LOG_MAX_BYTES", 5 * 1024 * 1024),
    },
    defaults: {
      mode: envStr("MYJEV_DEFAULT_MODE") || "parallel",
      model: envStr("MYJEV_MODEL", "OPENAI_MODEL") || "gpt-4o-mini",
      baseUrl: envStr("OPENAI_BASE_URL", "MYJEV_BASE_URL", "LLM_BASE_URL"),
      temperature: num("MYJEV_TEMPERATURE", 0),
      softmaxTemperature: num("MYJEV_SOFTMAX_TEMPERATURE", 1),
      concurrency: num("MYJEV_CONCURRENCY", 8),
      timeoutMs: num("MYJEV_TIMEOUT_MS", 60_000),
      retries: num("MYJEV_RETRIES", 2),
      maxTokens: num("MYJEV_MAX_TOKENS", 32),
    },
    decider: {
      baseUrl: envStr("DECIDER_BASE_URL") || "http://localhost:8000",
      apiKey: envStr("DECIDER_API_KEY", "TYPESAFE_API_KEY"),
      enabled: bool("ENABLE_DECIDER", true),
    },
    hasLlmKey: Boolean(llmKeySource),
    llmKeySource,
    allowClientOverrides: bool("ALLOW_CLIENT_OVERRIDES", true),
    version: envStr("MYJEV_VERSION") || "2.0.0",
  };
}

export type { ServerConfig as Config };
