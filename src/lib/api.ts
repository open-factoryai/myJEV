/** Browser-side API client for the myJEV server. */
import type { AppConfig, BatchRequest, BatchResponse, EvaluateRequest, EvaluateResponse } from "./types";
import { buildRequestPreview } from "./types";

export interface ServerConfigResponse {
  service: string;
  version: string;
  mode: string;
  defaults: {
    mode: string;
    model: string;
    base_url: string | null;
    temperature: number;
    softmax_temperature: number;
    concurrency: number;
    timeout_ms: number;
    retries: number;
  };
  backends: string[];
  decider: { url: string; enabled: boolean; key_configured: boolean };
  llm: { key_configured: boolean; key_source: string | null; base_url: string; default_model: string };
  security: {
    auth_required: boolean;
    rate_limit: string;
    cors: string[] | "*";
    allow_client_overrides: boolean;
  };
  logging: { requests: boolean; file: string | null };
  uptime_s: number;
  probe?: { decider?: { ok: boolean | null; detail?: string; latency_ms?: number } };
}

export interface BackendsResponse {
  decider: { ok: boolean | null; url?: string; detail?: string; latency_ms?: number };
  llm: { ok: boolean; url?: string; detail?: string };
  mock: { ok: boolean; detail?: string };
}

async function request<T>(url: string, init?: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 400) };
  }
  if (!res.ok) {
    const msg =
      (data as { error?: string } | null)?.error || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data as T;
}

export const getToken = (): string => {
  try {
    return localStorage.getItem("myjev-token") || "";
  } catch {
    return "";
  }
};
export const setToken = (t: string) => {
  try {
    if (t) localStorage.setItem("myjev-token", t);
    else localStorage.removeItem("myjev-token");
  } catch {
    /* ignore */
  }
};

export const fetchServerConfig = () => request<ServerConfigResponse>("/api/config", undefined, getToken());
export const fetchHealth = () => request<ServerConfigResponse & { ok: boolean }>("/api/health", undefined, getToken());
export const fetchBackends = () => request<BackendsResponse>("/api/backends", undefined, getToken());

export const fetchModels = (baseUrl?: string, apiKey?: string) => {
  const qs = new URLSearchParams();
  if (baseUrl) qs.set("base_url", baseUrl);
  if (apiKey) qs.set("api_key", apiKey);
  const suffix = qs.toString() ? `?${qs}` : "";
  return request<{ ok: boolean; models: string[]; error?: string }>(
    `/api/models${suffix}`,
    undefined,
    getToken()
  );
};

export function runEvaluate(cfg: AppConfig, state: string, questions: EvaluateRequest["questions"]) {
  const body = buildRequestPreview(cfg, state, questions);
  return request<EvaluateResponse>("/api/evaluate", {
    method: "POST",
    body: JSON.stringify(body),
  }, getToken());
}

export function runBatch(cfg: AppConfig, body: BatchRequest) {
  const payload: BatchRequest = {
    ...body,
    mode: cfg.mode,
    temperature: cfg.temperature,
    softmax_temperature: cfg.softmaxTemperature,
    timeout_ms: cfg.timeoutMs,
    retries: cfg.retries,
    log: cfg.logRequests,
  };
  if (cfg.mode === "decider") {
    if (cfg.deciderUrl) payload.decider_url = cfg.deciderUrl;
    if (cfg.deciderApiKey) payload.api_key = cfg.deciderApiKey;
  } else if (cfg.mode !== "mock") {
    if (cfg.model) payload.model = cfg.model;
    if (cfg.baseUrl) payload.base_url = cfg.baseUrl;
    if (cfg.apiKey) payload.api_key = cfg.apiKey;
  }
  return request<BatchResponse>("/api/evaluate/batch", {
    method: "POST",
    body: JSON.stringify(payload),
  }, getToken());
}
