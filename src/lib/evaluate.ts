/**
 * myJEV evaluate backends
 * ─────────────────────────
 *  parallel : one tiny `{p}` LLM call per option/level, then softmax over logits
 *  oneshot  : a single structured-JSON LLM call for all questions
 *  decider  : Mapika/decider HTTP server → POST {base}/v1/systemone (real System One weights)
 *  mock     : deterministic offline keyword scorer (no network, no keys, no cost)
 *
 * This module is shared: it runs on the server (Node) and is type-checked for the client.
 * Everything network-related goes through `callJson`, which adds timeout + retry + abort.
 */
import OpenAI from "openai";
import type {
  Answer,
  BackendMode,
  BatchItem,
  BatchRequest,
  BatchResponse,
  BatchResultRow,
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResponse,
  Question,
  Questions,
} from "./types";

/* ────────────────────────────── helpers ────────────────────────────── */

const DEFAULTS = {
  model: "gpt-4o-mini",
  temperature: 0,
  softmaxTemperature: 1,
  concurrency: 8,
  timeoutMs: 60_000,
  retries: 2,
  maxTokens: 32,
};

export function envStr(...keys: string[]): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function envNum(key: string, fallback: number): number {
  const raw = envStr(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run async jobs with a concurrency cap (keeps token spend + rate limits sane). */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const cap = Math.max(1, Math.floor(limit));
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(cap, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** fetch with timeout + retry on 429 / 5xx / network errors. Returns {text, status, attempts}. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; retries?: number; label?: string } = {}
): Promise<{ text: string; status: number; attempts: number }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const retries = clamp(Math.floor(opts.retries ?? DEFAULTS.retries), 0, 8);
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const text = await res.text();
      clearTimeout(timer);
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        const backoff = Math.min(8000, 400 * 2 ** attempt) + Math.random() * 150;
        await sleep(backoff);
        continue;
      }
      return { text, status: res.status, attempts: attempt + 1 };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await sleep(Math.min(8000, 400 * 2 ** attempt));
        continue;
      }
    }
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const timedOut = /abort/i.test(reason);
  throw new Error(
    `${opts.label ?? url} failed after ${retries + 1} attempt(s): ${
      timedOut ? `timeout after ${timeoutMs}ms` : reason
    }`
  );
}

function softmax(logits: number[], temperature = 1): number[] {
  const t = Math.max(0.05, temperature);
  const scaled = logits.map((x) => x / t);
  const max = Math.max(...scaled);
  const exps = scaled.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/** independent probabilities -> a single distribution via logit softmax */
function scoresToDistribution(scores: number[], softmaxTemperature = 1): number[] {
  const logits = scores.map((p) => {
    const c = clamp(p, 0.001, 0.999);
    return Math.log(c / (1 - c));
  });
  return softmax(logits, softmaxTemperature);
}

/** confidence = blend of top probability and the margin to runner-up */
/**
 * confidence = blend of the top probability and the margin to the runner-up.
 * The margin term is capped so a single dominant option can't always read as 100%.
 */
function confidenceFrom(probs: number[]): number {
  const sorted = [...probs].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const gap = Math.min(0.5, top - (sorted[1] ?? 0));
  return round3(clamp(0.5 * top + 0.5 * (gap + 0.5), 0, 0.999));
}

function stateToString(state: EvaluateRequest["state"]): string {
  return typeof state === "string" ? state : JSON.stringify(state, null, 2);
}

/* ─────────────────────────── LLM client factory ────────────────────── */

export function resolveApiKey(explicit?: string): string | undefined {
  return (
    (explicit && explicit.trim()) ||
    envStr(
      "OPENAI_API_KEY",
      "MYJEV_API_KEY",
      "CEREBRAS_API_KEY",
      "GROQ_API_KEY",
      "PUTER_API_KEY",
      "OPENROUTER_API_KEY",
      "TOGETHER_API_KEY",
      "MISTRAL_API_KEY",
      "DEEPSEEK_API_KEY",
      "API_KEY"
    )
  );
}

export function resolveBaseUrl(explicit?: string): string | undefined {
  return (
    (explicit && explicit.trim()) ||
    envStr("OPENAI_BASE_URL", "MYJEV_BASE_URL", "LLM_BASE_URL", "OPENAI_API_BASE")
  );
}

export function resolveModel(explicit?: string): string {
  return (explicit && explicit.trim()) || envStr("MYJEV_MODEL", "OPENAI_MODEL") || DEFAULTS.model;
}

function makeClient(apiKey?: string, baseUrl?: string, timeoutMs?: number) {
  const key = resolveApiKey(apiKey);
  const url = resolveBaseUrl(baseUrl);
  if (!key && !url) {
    throw new Error(
      "No API key configured. Set OPENAI_API_KEY (server env / .env), pass api_key in the request, " +
        "or switch the UI to provider 'Mock (offline demo)' / mode 'mock'."
    );
  }
  return new OpenAI({
    apiKey: key || "not-needed",
    baseURL: url,
    timeout: timeoutMs ?? DEFAULTS.timeoutMs,
    maxRetries: 0, // retries are handled by us so the UI can report them
  });
}

/* ─────────────────────────── micro-scorer call ─────────────────────── */

interface ScoreCallResult {
  probability: number;
  tokens_in: number;
  tokens_out: number;
  retried: boolean;
}

const PROB_SCHEMA = {
  type: "object",
  properties: { p: { type: "number", minimum: 0, maximum: 1 } },
  required: ["p"],
  additionalProperties: false,
} as const;

function extractProbability(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as { p?: number; probability?: number; value?: number };
    const p = Number(parsed.p ?? parsed.probability ?? parsed.value);
    if (Number.isFinite(p)) return clamp(p, 0, 1);
  } catch {
    /* fall through to regex */
  }
  const m = raw.match(/(?:^|[^0-9.])(0?\.\d+|1(?:\.0+)?|0|1)(?:[^0-9.]|$)/);
  if (m) return clamp(parseFloat(m[1]), 0, 1);
  return 0.5;
}

async function scoreProposition(
  client: OpenAI,
  model: string,
  state: string,
  statement: string,
  opts: Required<Pick<EvaluateOptions, "temperature">> & {
    maxTokens: number;
    timeoutMs: number;
    retries: number;
    systemPromptExtra?: string;
  }
): Promise<ScoreCallResult> {
  const system =
    "You are a calibrated probability estimator. " +
    "Given a STATE and a STATEMENT, return only how likely the statement is true " +
    "based solely on the state. Do not invent facts. " +
    'Respond with JSON: {"p": <number 0 to 1>}.' +
    (opts.systemPromptExtra ? `\n\nAdditional guidance: ${opts.systemPromptExtra}` : "");
  const user = `STATE:\n${state}\n\nSTATEMENT:\n${statement}\n\nHow likely is the statement true (0-1)?`;
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  const base = { model, messages, temperature: opts.temperature, max_tokens: opts.maxTokens };
  const withTimeout = { timeout: opts.timeoutMs, maxRetries: opts.retries };

  let completion: OpenAI.Chat.Completions.ChatCompletion | undefined;
  let retried = false;

  // 1) strict json_schema (OpenAI / Groq / Together / vLLM support it)
  try {
    completion = await client.chat.completions.create(
      {
        ...base,
        response_format: {
          type: "json_schema",
          json_schema: { name: "prob", strict: true, schema: PROB_SCHEMA as never },
        },
      } as never,
      withTimeout as never
    );
  } catch {
    // 2) loose json_object (Cerebras, Ollama, LM Studio, older gateways)
    try {
      retried = true;
      completion = await client.chat.completions.create(
        { ...base, response_format: { type: "json_object" } } as never,
        withTimeout as never
      );
    } catch {
      // 3) plain text (some local servers reject response_format entirely)
      retried = true;
      completion = await client.chat.completions.create(base as never, withTimeout as never);
    }
  }

  const raw = completion?.choices?.[0]?.message?.content ?? "{}";
  return {
    probability: extractProbability(raw),
    tokens_in: completion?.usage?.prompt_tokens ?? 0,
    tokens_out: completion?.usage?.completion_tokens ?? 0,
    retried,
  };
}

/* ─────────────────────────── parallel backend ──────────────────────── */

type RuntimeOpts = {
  temperature: number;
  softmaxTemperature: number;
  concurrency: number;
  timeoutMs: number;
  retries: number;
  maxTokens: number;
  systemPromptExtra?: string;
};

function runtimeOpts(req: EvaluateOptions): RuntimeOpts {
  return {
    temperature: clamp(Number(req.temperature ?? envNum("MYJEV_TEMPERATURE", DEFAULTS.temperature)), 0, 2),
    softmaxTemperature: clamp(
      Number(req.softmax_temperature ?? envNum("MYJEV_SOFTMAX_TEMPERATURE", DEFAULTS.softmaxTemperature)),
      0.05,
      10
    ),
    concurrency: clamp(
      Math.floor(Number(req.concurrency ?? envNum("MYJEV_CONCURRENCY", DEFAULTS.concurrency))),
      1,
      64
    ),
    timeoutMs: clamp(
      Math.floor(Number(req.timeout_ms ?? envNum("MYJEV_TIMEOUT_MS", DEFAULTS.timeoutMs))),
      1000,
      600_000
    ),
    retries: clamp(Math.floor(Number(req.retries ?? envNum("MYJEV_RETRIES", DEFAULTS.retries))), 0, 8),
    maxTokens: clamp(
      Math.floor(Number(req.max_tokens ?? envNum("MYJEV_MAX_TOKENS", DEFAULTS.maxTokens))),
      8,
      4096
    ),
    systemPromptExtra: req.system_prompt_extra || envStr("MYJEV_SYSTEM_PROMPT_EXTRA"),
  };
}

/** Flatten every scorer call for the whole request, then run them under one concurrency cap. */
async function evaluateParallel(
  client: OpenAI,
  model: string,
  state: string,
  questions: Questions,
  opts: RuntimeOpts
) {
  type Job = { question: string; kind: "choice" | "score" | "noul"; index: number; statement: string };
  const jobs: Job[] = [];

  for (const [name, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      const instructions = q.instructions?.trim() || `Select the best label for "${name}"`;
      Object.entries(q.criteria).forEach(([key, desc], index) => {
        jobs.push({
          question: name,
          kind: "choice",
          index,
          statement:
            `The correct ${instructions.toLowerCase().replace(/\?$/, "")} is "${key}"` +
            (desc ? ` (${desc})` : "") +
            ".",
        });
      });
    } else if (q.type === "score") {
      const instructions = q.instructions?.trim() || `Rate "${name}"`;
      q.criteria.forEach((label, index) => {
        jobs.push({
          question: name,
          kind: "score",
          index,
          statement: `On the scale for "${instructions}", the most appropriate rating is level ${index}: "${label}".`,
        });
      });
    } else {
      let statement = q.instructions?.trim() || `The proposition "${name}" is true.`;
      if (!/[.?!]$/.test(statement)) statement += ".";
      jobs.push({ question: name, kind: "noul", index: 0, statement });
    }
  }

  const results = await mapLimit(jobs, opts.concurrency, async (job) => {
    const r = await scoreProposition(client, model, state, job.statement, opts);
    return { job, ...r };
  });

  const answers: Record<string, Answer> = {};
  let tokens_in = 0;
  let tokens_out = 0;
  let retries = 0;

  for (const [name, q] of Object.entries(questions)) {
    const rows = results.filter((r) => r.job.question === name).sort((a, b) => a.job.index - b.job.index);
    tokens_in += rows.reduce((s, r) => s + r.tokens_in, 0);
    tokens_out += rows.reduce((s, r) => s + r.tokens_out, 0);
    retries += rows.filter((r) => r.retried).length;

    if (q.type === "noul" || q.type === "boolean") {
      answers[name] = { type: "noul", noul: round3(rows[0]?.probability ?? 0.5) };
      continue;
    }

    const probs = scoresToDistribution(
      rows.map((r) => r.probability),
      opts.softmaxTemperature
    );

    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const probabilities: Record<string, number> = {};
      keys.forEach((k, i) => (probabilities[k] = round3(probs[i] ?? 0)));
      let best = 0;
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
      answers[name] = {
        type: "choice",
        choice: keys[best] ?? "",
        confidence: confidenceFrom(probs),
        probabilities,
      };
    } else if (q.type === "score") {
      const legend: Record<string, string> = {};
      const probabilityMap: Record<string, number> = {};
      q.criteria.forEach((label: string, i: number) => {
        legend[String(i)] = label;
        probabilityMap[String(i)] = round3(probs[i] ?? 0);
      });
      const score = probs.reduce((s, p, i) => s + p * i, 0);
      answers[name] = {
        type: "score",
        score: Math.round(score * 100) / 100,
        confidence: confidenceFrom(probs),
        legend,
        probabilities: probabilityMap,
      };
    } else {
      answers[name] = { type: "noul", noul: round3(probs[0] ?? 0.5) };
    }
  }

  return { answers, tokens_in, tokens_out, calls: jobs.length, retries };
}

/* ─────────────────────────── oneshot backend ───────────────────────── */

async function evaluateOneshot(
  client: OpenAI,
  model: string,
  state: string,
  questions: Questions,
  opts: RuntimeOpts
) {
  const lines: string[] = [];
  for (const [name, q] of Object.entries(questions)) {
    let desc = `- ${name} (${q.type === "boolean" ? "noul" : q.type}): ${q.instructions ?? ""}`;
    if (q.type === "choice") {
      desc += `\n  Options -> ${Object.entries(q.criteria)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ")}`;
    } else if (q.type === "score") {
      desc += `\n  Levels -> ${q.criteria.map((l, i) => `${i}=${l}`).join(" | ")}`;
    }
    lines.push(desc);
  }

  const system =
    "You are a precise decision engine. Answer every question using only the provided state. " +
    "Return probabilities that reflect genuine uncertainty. Do not invent information." +
    (opts.systemPromptExtra ? `\n\nAdditional guidance: ${opts.systemPromptExtra}` : "");
  const user =
    `STATE:\n${state}\n\nQUESTIONS:\n${lines.join("\n")}\n\n` +
    `Respond with a single JSON object whose top-level keys are the question names.\n` +
    `For choice: {"choice": string, "confidence": number, "probabilities": {<option>: number}}\n` +
    `For score:  {"score": number, "confidence": number, "probabilities": {"<level index>": number}}\n` +
    `For noul:   {"noul": number}   (probability the statement is true, 0..1)`;

  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  const withTimeout = { timeout: opts.timeoutMs, maxRetries: opts.retries };

  let completion: OpenAI.Chat.Completions.ChatCompletion | undefined;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        messages,
        temperature: opts.temperature,
        response_format: { type: "json_object" },
      } as never,
      withTimeout as never
    );
  } catch {
    completion = await client.chat.completions.create(
      { model, messages, temperature: opts.temperature } as never,
      withTimeout as never
    );
  }

  const content = completion?.choices?.[0]?.message?.content ?? "{}";
  let parsed: Record<string, Record<string, unknown>>;
  try {
    const jsonText = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(jsonText) as Record<string, Record<string, unknown>>;
  } catch {
    throw new Error(`One-shot model returned non-JSON: ${content.slice(0, 240)}`);
  }

  const answers: Record<string, Answer> = {};
  for (const [name, q] of Object.entries(questions)) {
    const data = (parsed[name] ?? parsed[name.replace(/[^a-z0-9]/gi, "_")] ?? {}) as Record<string, unknown>;
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      const rawChoice = String(data.choice ?? data.answer ?? "");
      const choice = keys.includes(rawChoice) ? rawChoice : (keys[0] ?? "");
      const confidence = clamp(Number(data.confidence ?? 0.5) || 0.5, 0, 1);
      const probabilities: Record<string, number> = {};
      const given = (data.probabilities ?? {}) as Record<string, unknown>;
      for (const k of keys) probabilities[k] = round3(clamp(Number(given[k] ?? 0) || 0, 0, 1));
      if (Object.values(probabilities).every((v) => v === 0)) probabilities[choice] = confidence;
      answers[name] = { type: "choice", choice, confidence: round3(confidence), probabilities };
    } else if (q.type === "score") {
      const legend: Record<string, string> = {};
      const probabilityMap: Record<string, number> = {};
      q.criteria.forEach((l, i) => {
        legend[String(i)] = l;
      });
      const given = (data.probabilities ?? {}) as Record<string, unknown>;
      let any = false;
      q.criteria.forEach((_l, i) => {
        const v = Number(given[String(i)] ?? 0) || 0;
        probabilityMap[String(i)] = round3(clamp(v, 0, 1));
        if (v > 0) any = true;
      });
      answers[name] = {
        type: "score",
        score: clamp(Number(data.score ?? 0) || 0, 0, Math.max(0, q.criteria.length - 1)),
        confidence: round3(clamp(Number(data.confidence ?? 0.5) || 0.5, 0, 1)),
        legend,
        probabilities: any ? probabilityMap : undefined,
      };
    } else {
      answers[name] = {
        type: "noul",
        noul: round3(clamp(Number(data.noul ?? data.probability ?? 0.5) || 0, 0, 1)),
      };
    }
  }

  return {
    answers,
    tokens_in: completion?.usage?.prompt_tokens ?? 0,
    tokens_out: completion?.usage?.completion_tokens ?? 0,
    calls: 1,
    retries: 0,
  };
}

/* ─────────────────────────── decider backend ───────────────────────── */

/**
 * Call a Mapika/decider-compatible HTTP server (TypeSafe wire format).
 * https://github.com/Mapika/decider — scripts/serve.sh Mapika/decider-2b 8000
 */
export async function evaluateDecider(
  state: EvaluateRequest["state"],
  questions: Questions,
  deciderUrl: string,
  apiKey?: string,
  opts: Partial<RuntimeOpts> = {}
): Promise<{
  answers: Record<string, Answer>;
  model: string;
  tokens_in: number | null;
  tokens_out: number | null;
  attempts: number;
}> {
  const base = deciderUrl.replace(/\/+$/, "");
  const url = `${base}/v1/systemone`;
  const key =
    (apiKey && apiKey.trim()) || envStr("DECIDER_API_KEY", "TYPESAFE_API_KEY") || "local";

  const { text, status, attempts } = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ state, questions, model: "decider" }),
    },
    {
      timeoutMs: opts.timeoutMs ?? DEFAULTS.timeoutMs,
      retries: opts.retries ?? DEFAULTS.retries,
      label: `decider (${base})`,
    }
  );

  if (status >= 400) {
    throw new Error(
      `decider ${status} from ${url}: ${text.slice(0, 400)}\n` +
        `Is the GPU server up?  scripts/serve.sh Mapika/decider-2b 8000  (or: docker compose --profile mock up)`
    );
  }

  let data: {
    model?: string;
    answers?: Record<string, Record<string, unknown>>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`decider returned non-JSON: ${text.slice(0, 240)}`);
  }

  const answers: Record<string, Answer> = {};
  const rawAnswers = data.answers ?? {};

  for (const [name, q] of Object.entries(questions)) {
    const a = (rawAnswers[name] ?? {}) as Record<string, unknown>;
    if (q.type === "choice") {
      const probs = (a.probabilities as Record<string, number>) ?? {};
      const keys = Object.keys(q.criteria);
      const choice = String(a.choice ?? keys[0] ?? "");
      answers[name] = {
        type: "choice",
        choice,
        confidence: round3(
          clamp(Number(a.confidence ?? a.certainty ?? probs[choice] ?? 0.5) || 0.5, 0, 1)
        ),
        probabilities: keys.reduce(
          (acc, k) => {
            acc[k] = round3(clamp(Number(probs[k] ?? 0) || 0, 0, 1));
            return acc;
          },
          {} as Record<string, number>
        ),
      };
    } else if (q.type === "score") {
      const legend: Record<string, string> = {};
      q.criteria.forEach((l, i) => (legend[String(i)] = l));
      const probs =
        (a.probabilities as Record<string, number>) ?? (a.level_fit as Record<string, number>) ?? {};
      const probabilityMap: Record<string, number> = {};
      q.criteria.forEach((_l, i) => {
        probabilityMap[String(i)] = round3(clamp(Number(probs[String(i)] ?? 0) || 0, 0, 1));
      });
      answers[name] = {
        type: "score",
        score: Number(a.score ?? 0) || 0,
        confidence: round3(clamp(Number(a.confidence ?? a.fit_mass ?? 0.5) || 0.5, 0, 1)),
        legend,
        probabilities: probabilityMap,
      };
    } else {
      answers[name] = {
        type: "noul",
        noul: round3(clamp(Number(a.noul ?? a.probability ?? 0.5) || 0, 0, 1)),
      };
    }
  }

  return {
    answers,
    model: data.model ?? "Mapika/decider-2b",
    tokens_in: data.usage?.input_tokens ?? null,
    tokens_out: data.usage?.output_tokens ?? null,
    attempts,
  };
}

/* ──────────────────────────── mock backend ─────────────────────────── */

const MOCK_CONCEPTS: Record<string, string[]> = {
  billing: ["charge", "charged", "billing", "bill", "invoice", "refund", "payment", "subscription", "price", "pricing", "cost", "double", "twice", "stripe", "card", "receipt"],
  technical: ["bug", "error", "crash", "fail", "failing", "broken", "integration", "api", "timeout", "500", "exception", "stack", "latency", "outage", "down", "glitch"],
  account: ["login", "log in", "password", "access", "locked", "2fa", "sso", "session", "username", "sign in", "mfa", "permission"],
  sales: ["demo", "quote", "enterprise", "contract", "discount", "sales", "plan", "upgrade", "budget", "procurement", "pilot"],
  other: [],
  angry: ["angry", "furious", "!!", "asap", "ridiculous", "unacceptable", "garbage", "ashamed", "screwed", "worst", "never again", "lawyer", "chargeback", "escalate"],
  urgent: ["asap", "urgent", "immediately", "now", "today", "deadline", "losing sales", "emergency", "critical", "this quarter", "next week", "blocker"],
  toxic: ["garbage", "ashamed", "idiot", "stupid", "scam", "hate", "worst", "trash", "threat", "post this everywhere", "sue"],
  positive: ["great", "love", "thanks", "excellent", "happy", "awesome", "perfect", "pleased"],
};

function conceptHits(text: string): Record<string, number> {
  const lower = text.toLowerCase();
  const hits: Record<string, number> = {};
  for (const [concept, words] of Object.entries(MOCK_CONCEPTS)) {
    hits[concept] = words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
  }
  return hits;
}

/** Deterministic, offline "System One-ish" scorer — same shape as the decider backend. */
export function evaluateMock(
  state: EvaluateRequest["state"],
  questions: Questions,
  softmaxTemperature = 1
): { answers: Record<string, Answer>; model: string } {
  const text = stateToString(state);
  const hits = conceptHits(text);
  const words = Math.max(1, text.split(/\s+/).length);
  const exclamations = (text.match(/!/g) ?? []).length;
  const caps = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  const heat = clamp((exclamations * 0.12 + caps * 0.15 + (hits.angry ?? 0) * 0.2) / Math.max(1, words / 40), 0, 1);

  const answers: Record<string, Answer> = {};
  for (const [name, q] of Object.entries(questions)) {
    const nameHints = conceptHits(`${name} ${q.instructions ?? ""}`);
    if (q.type === "choice") {
      const criteria: Record<string, string> = q.criteria;
      const keys = Object.keys(criteria);
      const logits = keys.map((k) => {
        const direct = hits[k] ?? 0;
        const descHits = Object.values(conceptHits(criteria[k] ?? "")).reduce<number>(
          (s, n) => s + Math.min(n, 3) * 0.35,
          0
        );
        const nameHint = nameHints[k] ?? 0;
        return direct * 0.9 + descHits * 0.5 + nameHint * 0.25;
      });
      const max = Math.max(0.0001, ...logits);
      const probs = softmax(
        logits.map((l) => (l / max) * 3),
        softmaxTemperature
      );
      const probabilities: Record<string, number> = {};
      keys.forEach((k, i) => (probabilities[k] = round3(probs[i] ?? 0)));
      let best = 0;
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
      answers[name] = {
        type: "choice",
        choice: keys[best] ?? "",
        confidence: confidenceFrom(probs),
        probabilities,
      };
    } else if (q.type === "score") {
      const levels = q.criteria.length;
      const intensity = clamp(heat * 0.7 + ((hits.urgent ?? 0) + (hits.angry ?? 0)) * 0.12, 0, 1);
      const center = intensity * (levels - 1);
      const logits = q.criteria.map((_l, i) => -Math.pow(i - center, 2) * 1.6);
      const probs = softmax(logits, softmaxTemperature);
      const legend: Record<string, string> = {};
      const probabilityMap: Record<string, number> = {};
      q.criteria.forEach((l, i) => {
        legend[String(i)] = l;
        probabilityMap[String(i)] = round3(probs[i] ?? 0);
      });
      answers[name] = {
        type: "score",
        score: Math.round(probs.reduce((s, p, i) => s + p * i, 0) * 100) / 100,
        confidence: confidenceFrom(probs),
        legend,
        probabilities: probabilityMap,
      };
    } else {
      const stmt = `${name} ${q.instructions ?? ""}`.toLowerCase();
      const concept =
        Object.keys(MOCK_CONCEPTS).find((c) => stmt.includes(c) || c.includes(stmt.trim())) ?? null;
      let p: number;
      if (concept) {
        p = clamp(0.18 + (hits[concept] ?? 0) * 0.22 + heat * 0.25, 0.02, 0.98);
      } else {
        p = clamp(0.2 + heat * 0.7 + Math.min(words / 400, 0.2), 0.02, 0.98);
      }
      answers[name] = { type: "noul", noul: round3(p) };
    }
  }
  return { answers, model: "myjev-mock" };
}

/* ───────────────────────────── main entry ──────────────────────────── */

export async function evaluate(req: EvaluateRequest): Promise<EvaluateResponse> {
  const t0 = Date.now();
  const opts = runtimeOpts(req);
  const mode: BackendMode = req.mode ?? "parallel";
  const questions = req.questions ?? {};

  if (Object.keys(questions).length === 0) {
    throw new Error("At least one question is required");
  }

  if (mode === "mock") {
    const { answers, model } = evaluateMock(req.state, questions, opts.softmaxTemperature);
    return {
      model,
      answers,
      usage: { input_tokens: null, output_tokens: null },
      meta: {
        mode,
        latency_ms: Date.now() - t0,
        parallel_calls: 0,
        backend: "offline-mock",
        request_id: req.request_id,
      },
    };
  }

  if (mode === "decider") {
    const url =
      (req.decider_url && req.decider_url.trim()) ||
      envStr("DECIDER_BASE_URL") ||
      "http://localhost:8000";
    const result = await evaluateDecider(req.state, questions, url, req.api_key, opts);
    return {
      model: result.model,
      answers: result.answers,
      usage: { input_tokens: result.tokens_in, output_tokens: result.tokens_out },
      meta: {
        mode,
        latency_ms: Date.now() - t0,
        parallel_calls: 1,
        backend: url,
        request_id: req.request_id,
        retries: Math.max(0, result.attempts - 1),
      },
    };
  }

  const stateStr = stateToString(req.state);
  const model = resolveModel(req.model);
  const client = makeClient(req.api_key, req.base_url, opts.timeoutMs);

  const out =
    mode === "oneshot"
      ? await evaluateOneshot(client, model, stateStr, questions, opts)
      : await evaluateParallel(client, model, stateStr, questions, opts);

  return {
    model,
    answers: out.answers,
    usage: {
      input_tokens: out.tokens_in || null,
      output_tokens: out.tokens_out || null,
    },
    meta: {
      mode,
      latency_ms: Date.now() - t0,
      parallel_calls: out.calls,
      backend: resolveBaseUrl(req.base_url) ?? "openai-compatible",
      request_id: req.request_id,
      retries: out.retries,
    },
  };
}

/** Batch endpoint: many states, one question set (or per-item overrides). */
export async function evaluateBatch(req: BatchRequest): Promise<BatchResponse> {
  const t0 = Date.now();
  const opts = runtimeOpts(req);
  const items: BatchItem[] = Array.isArray(req.items) ? req.items : [];
  if (items.length === 0) throw new Error("batch: 'items' must be a non-empty array");
  const limit = envNum("MYJEV_BATCH_MAX", 200);
  if (items.length > limit) throw new Error(`batch: too many items (${items.length} > ${limit})`);

  const shared = req.questions ?? {};
  const rows = await mapLimit(items, opts.concurrency, async (item, index): Promise<BatchResultRow> => {
    const id = item.id ?? `item-${index}`;
    const questions = item.questions && Object.keys(item.questions).length > 0 ? item.questions : shared;
    if (item.state === undefined || item.state === null) {
      return { id, index, ok: false, error: "missing 'state'" };
    }
    if (Object.keys(questions).length === 0) {
      return { id, index, ok: false, error: "no questions (provide req.questions or item.questions)" };
    }
    try {
      const result = await evaluate({
        state: item.state,
        questions,
        model: req.model,
        base_url: req.base_url,
        api_key: req.api_key,
        mode: req.mode ?? "parallel",
        decider_url: req.decider_url,
        temperature: req.temperature,
        softmax_temperature: req.softmax_temperature,
        concurrency: 1,
        timeout_ms: req.timeout_ms,
        retries: req.retries,
      });
      return { id, index, ok: true, result };
    } catch (err) {
      return { id, index, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  rows.sort((a, b) => a.index - b.index);
  const firstModel = rows.find((r) => r.ok)?.result?.model;
  return {
    mode: req.mode ?? "parallel",
    model: firstModel ?? resolveModel(req.model),
    total: rows.length,
    ok: rows.filter((r) => r.ok).length,
    failed: rows.filter((r) => !r.ok).length,
    latency_ms: Date.now() - t0,
    rows,
  };
}

export type { Question, Questions, Answer };
