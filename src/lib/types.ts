/**
 * myJEV — shared types (client + server).
 *
 * Wire format is compatible with TypeSafe "Jev" / Mapika decider:
 *   POST /v1/systemone { state, questions }
 */

export type QuestionType = "choice" | "score" | "noul" | "boolean";

export interface ChoiceQuestion {
  type: "choice";
  instructions?: string;
  /** option key -> human description */
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions?: string;
  /** ordered level labels; index === score */
  criteria: string[];
}

export interface NoulQuestion {
  type: "noul" | "boolean";
  instructions?: string;
}

export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;
export type Questions = Record<string, Question>;

/**
 * parallel / oneshot = OpenAI-compatible LLM micro-scorers
 * decider            = Mapika/decider HTTP server (real System One weights)
 * mock               = deterministic offline scorer (no network, great for CI/smoke tests)
 */
export type BackendMode = "parallel" | "oneshot" | "decider" | "mock";
export const BACKEND_MODES: BackendMode[] = ["parallel", "oneshot", "decider", "mock"];

/** Knobs that change *how* the LLM backends score. */
export interface EvaluateOptions {
  /** sampling temperature for the scorer calls (0 = deterministic) */
  temperature?: number;
  /** softmax temperature applied to the logit vector (lower = sharper distribution) */
  softmax_temperature?: number;
  /** max simultaneous scorer calls (default 8) */
  concurrency?: number;
  /** per HTTP call timeout in ms (default 60000) */
  timeout_ms?: number;
  /** retries per scorer call on 429/5xx/network (default 2) */
  retries?: number;
  /** cap output tokens of the micro-scorer calls (default 32) */
  max_tokens?: number;
  /** free-form extra guidance injected into the scorer system prompt */
  system_prompt_extra?: string;
  /** persist this request to the server-side JSONL audit log */
  log?: boolean;
}

export interface EvaluateRequest extends EvaluateOptions {
  state: string | Record<string, unknown> | unknown[];
  questions: Questions;
  model?: string;
  base_url?: string;
  api_key?: string;
  mode?: BackendMode;
  /** Override for the Mapika/decider server, e.g. http://decider:8000 */
  decider_url?: string;
  /** server-assigned correlation id (echoed back in meta.request_id) */
  request_id?: string;
}

export interface BatchItem {
  id?: string;
  state: string | Record<string, unknown> | unknown[];
  questions?: Questions;
}

export interface BatchRequest extends EvaluateOptions {
  items: BatchItem[];
  questions?: Questions;
  model?: string;
  base_url?: string;
  api_key?: string;
  mode?: BackendMode;
  decider_url?: string;
  concurrency?: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities?: Record<string, number>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface EvaluateMeta {
  mode: BackendMode;
  latency_ms: number;
  parallel_calls: number;
  backend?: string;
  request_id?: string;
  retries?: number;
  errors?: string[];
}

export interface EvaluateResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number | null; output_tokens: number | null };
  meta?: EvaluateMeta;
  error?: string;
}

export interface BatchResultRow {
  id: string;
  index: number;
  ok: boolean;
  error?: string;
  result?: EvaluateResponse;
}

export interface BatchResponse {
  mode: BackendMode;
  model: string;
  total: number;
  ok: number;
  failed: number;
  latency_ms: number;
  rows: BatchResultRow[];
}

/* ────────────────────────────── UI drafts ────────────────────────────── */

export interface QuestionDraft {
  id: string;
  name: string;
  type: QuestionType;
  instructions: string;
  options: { key: string; description: string }[];
  levels: string[];
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  builtin?: boolean;
  state: string;
  questions: QuestionDraft[];
}

export interface AppConfig {
  mode: BackendMode;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  deciderUrl: string;
  deciderApiKey: string;
  temperature: number;
  softmaxTemperature: number;
  concurrency: number;
  timeoutMs: number;
  retries: number;
  theme: "dark" | "light";
  density: "comfortable" | "compact";
  accent: string;
  logRequests: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  mode: "parallel",
  provider: "openai",
  model: "gpt-4o-mini",
  baseUrl: "",
  apiKey: "",
  deciderUrl: "",
  deciderApiKey: "",
  temperature: 0,
  softmaxTemperature: 1,
  concurrency: 8,
  timeoutMs: 60000,
  retries: 2,
  theme: "dark",
  density: "comfortable",
  accent: "#14b8a6",
  logRequests: false,
};

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  needsKey: boolean;
  note?: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o4-mini"],
    needsKey: true,
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"],
    needsKey: true,
    note: "very fast, cheap",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    models: ["llama-3.3-70b", "llama3.1-8b", "qwen-3-32b"],
    needsKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku", "meta-llama/llama-3.3-70b-instruct"],
    needsKey: true,
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-7B-Instruct-Turbo"],
    needsKey: true,
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-small-latest", "ministral-8b-latest-2410"],
    needsKey: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat"],
    needsKey: true,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://host.docker.internal:11434/v1",
    models: ["qwen2.5:7b", "llama3.2:3b", "gemma2:9b"],
    needsKey: false,
    note: "100% local · use http://localhost:11434/v1 outside Docker",
  },
  {
    id: "vllm",
    label: "vLLM / LM Studio (local)",
    baseUrl: "http://host.docker.internal:1234/v1",
    models: ["local-model"],
    needsKey: false,
  },
  {
    id: "mock",
    label: "Mock (offline demo)",
    baseUrl: "http://mock:8000",
    models: ["mock-decider"],
    needsKey: false,
    note: "deterministic keyword scorer · zero cost",
  },
  {
    id: "custom",
    label: "Custom…",
    baseUrl: "",
    models: [],
    needsKey: false,
  },
];

/* ─────────────────────────── built-in datasets ───────────────────────── */

export const DEFAULT_EXAMPLES: Dataset[] = [
  {
    id: "ticket-triage",
    name: "Ticket Triage",
    description: "One ticket, two problems — watch the probabilities disagree",
    builtin: true,
    state: JSON.stringify(
      {
        ticket_id: "SUP-48213",
        plan: "Pro (annual)",
        subject: "Charged twice, and the billing page is broken",
        message:
          "I was charged twice for the Pro plan this month. On top of that, the billing " +
          "dashboard now throws an error every time I open it, so I can't even download my " +
          "invoice. I've emailed twice with no response. This is unacceptable and I need it " +
          "fixed urgently!!! I'm seriously considering moving to a competitor.",
        customer_since: "2022",
      },
      null,
      2
    ),
    questions: [
      {
        id: "q1",
        name: "team",
        type: "choice",
        instructions: "Which team should own this ticket?",
        options: [
          { key: "billing", description: "Charges, refunds, invoices" },
          { key: "technical", description: "Bugs or broken product behaviour" },
          { key: "account", description: "Login and access problems" },
        ],
        levels: [],
      },
      {
        id: "q2",
        name: "severity",
        type: "score",
        instructions: "How severe is this ticket?",
        options: [],
        levels: [
          "Low - no real impact",
          "Medium - annoying but workable",
          "High - customer is blocked",
          "Critical - churn risk",
        ],
      },
      {
        id: "q3",
        name: "angry",
        type: "noul",
        instructions: "Is the customer expressing strong frustration or anger?",
        options: [],
        levels: [],
      },
    ],
  },
  {
    id: "stripe-integration",
    name: "Stripe Integration",
    description: "Failing Stripe connect",
    builtin: true,
    state:
      "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
    questions: [
      {
        id: "q1",
        name: "department",
        type: "choice",
        instructions: "Which team should handle this",
        options: [
          { key: "billing", description: "Payment or subscription issues" },
          { key: "technical", description: "Bugs or integration problems" },
          { key: "sales", description: "Pricing or account questions" },
        ],
        levels: [],
      },
      {
        id: "q2",
        name: "frustration",
        type: "score",
        instructions: "How frustrated the customer appears",
        options: [],
        levels: ["Calm, just stating facts", "Frustrated but civil", "Very angry, strong language"],
      },
      {
        id: "q3",
        name: "is_urgent",
        type: "noul",
        instructions: "The message conveys urgency or time-sensitivity",
        options: [],
        levels: [],
      },
    ],
  },
  {
    id: "content-mod",
    name: "Content Moderation",
    description: "Toxicity check + action",
    builtin: true,
    state:
      "This product is absolute garbage and the CEO should be ashamed. Refund me now or I'll post this everywhere.",
    questions: [
      {
        id: "q1",
        name: "toxic",
        type: "noul",
        instructions: "Does this message contain toxic or abusive language?",
        options: [],
        levels: [],
      },
      {
        id: "q2",
        name: "action",
        type: "choice",
        instructions: "Recommended moderation action",
        options: [
          { key: "allow", description: "Publish as-is" },
          { key: "flag", description: "Flag for human review" },
          { key: "block", description: "Block / remove" },
        ],
        levels: [],
      },
    ],
  },
  {
    id: "triage-medical",
    name: "Triage Signals",
    description: "Clinical-style escalation flags",
    builtin: true,
    state:
      "Patient reports chest tightness after climbing one flight of stairs, radiating to left arm, 20 minutes, diaphoresis present. No prior cardiac history.",
    questions: [
      {
        id: "q1",
        name: "escalation",
        type: "choice",
        instructions: "Recommended escalation path",
        options: [
          { key: "emergency", description: "Immediate emergency services" },
          { key: "urgent", description: "Same-day urgent care" },
          { key: "routine", description: "Routine follow-up" },
        ],
        levels: [],
      },
      {
        id: "q2",
        name: "acuity",
        type: "score",
        instructions: "Clinical acuity",
        options: [],
        levels: ["Minimal", "Mild", "Moderate", "Severe", "Life-threatening"],
      },
      {
        id: "q3",
        name: "cardiac_red_flags",
        type: "noul",
        instructions: "Are cardiac red-flag symptoms present?",
        options: [],
        levels: [],
      },
    ],
  },
  {
    id: "lead-scoring",
    name: "Lead Scoring",
    description: "Sales inbound qualification",
    builtin: true,
    state: JSON.stringify(
      {
        company: "Northwind Logistics",
        employees: 850,
        message:
          "We're evaluating tools to replace our in-house routing stack this quarter. Budget approved. Can we book a technical deep-dive with our CTO next week?",
        source: "pricing_page_form",
      },
      null,
      2
    ),
    questions: [
      {
        id: "q1",
        name: "segment",
        type: "choice",
        instructions: "Which segment does this lead belong to",
        options: [
          { key: "enterprise", description: ">500 employees, complex needs" },
          { key: "midmarket", description: "100-500 employees" },
          { key: "smb", description: "<100 employees" },
        ],
        levels: [],
      },
      {
        id: "q2",
        name: "intent",
        type: "score",
        instructions: "Purchase intent",
        options: [],
        levels: ["Just browsing", "Researching", "Evaluating", "Ready to buy"],
      },
      {
        id: "q3",
        name: "has_budget",
        type: "noul",
        instructions: "The lead indicates budget is available",
        options: [],
        levels: [],
      },
    ],
  },
];

/* ─────────────────────────── draft -> wire format ────────────────────── */

export function draftsToQuestions(drafts: QuestionDraft[]): Questions {
  const out: Questions = {};
  for (const d of drafts) {
    const name = d.name.trim();
    if (!name) continue;
    if (d.type === "choice") {
      const criteria: Record<string, string> = {};
      for (const o of d.options) {
        if (o.key.trim()) criteria[o.key.trim()] = o.description || o.key;
      }
      if (Object.keys(criteria).length === 0) continue;
      out[name] = { type: "choice", instructions: d.instructions, criteria };
    } else if (d.type === "score") {
      const levels = d.levels.filter((l) => l.trim().length >= 0);
      if (levels.length === 0) continue;
      out[name] = { type: "score", instructions: d.instructions, criteria: levels };
    } else {
      out[name] = { type: "noul", instructions: d.instructions };
    }
  }
  return out;
}

export function questionsToDrafts(questions: Questions): QuestionDraft[] {
  return Object.entries(questions).map(([name, q], i) => {
    const id = `q-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    if (q.type === "choice") {
      return {
        id,
        name,
        type: "choice",
        instructions: q.instructions ?? "",
        options: Object.entries(q.criteria).map(([key, description]) => ({ key, description })),
        levels: [],
      };
    }
    if (q.type === "score") {
      return {
        id,
        name,
        type: "score",
        instructions: q.instructions ?? "",
        options: [],
        levels: [...q.criteria],
      };
    }
    return { id, name, type: "noul", instructions: q.instructions ?? "", options: [], levels: [] };
  });
}

export function newQuestionId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Compact JSON view used by the "Request" / "cURL" panels. */
export function buildRequestPreview(cfg: AppConfig, state: string, questions: Questions) {
  let parsedState: string | Record<string, unknown> | unknown[] = state;
  try {
    const p = JSON.parse(state);
    if (p && typeof p === "object") parsedState = p;
  } catch {
    /* plain string state */
  }
  const body: EvaluateRequest = {
    mode: cfg.mode,
    state: parsedState,
    questions,
    temperature: cfg.temperature,
    softmax_temperature: cfg.softmaxTemperature,
    concurrency: cfg.concurrency,
    timeout_ms: cfg.timeoutMs,
    retries: cfg.retries,
    log: cfg.logRequests,
  };
  if (cfg.mode === "decider") {
    if (cfg.deciderUrl) body.decider_url = cfg.deciderUrl;
    if (cfg.deciderApiKey) body.api_key = cfg.deciderApiKey;
  } else if (cfg.mode !== "mock") {
    if (cfg.model) body.model = cfg.model;
    if (cfg.baseUrl) body.base_url = cfg.baseUrl;
    if (cfg.apiKey) body.api_key = cfg.apiKey;
  }
  return body;
}
