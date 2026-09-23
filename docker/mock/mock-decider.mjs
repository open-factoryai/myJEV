#!/usr/bin/env node
/**
 * mock-decider — a tiny stand-in for a Mapika/decider GPU server.
 *
 * Speaks the same wire format myJEV expects:
 *   GET  /health           → {"status":"ok"}
 *   GET  /v1/models        → model list
 *   POST /v1/systemone     → { model, answers, usage }
 *
 * It is deterministic, offline and free: it scores each option by keyword
 * overlap with the state, then softmaxes the scores. Perfect for
 *   • demos and screenshots with no API key
 *   • CI / smoke tests of the whole myJEV stack
 *   • frontend work while the GPU box is busy
 *
 * Zero dependencies — plain node:http.
 *
 *   node docker/mock/mock-decider.mjs
 *   PORT=8000 MOCK_LATENCY_MS=120 MOCK_API_KEY=local node docker/mock/mock-decider.mjs
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "0.0.0.0";
const MODEL = process.env.MOCK_MODEL || "mock-decider-2b";
const LATENCY = Number(process.env.MOCK_LATENCY_MS || 0);
const API_KEY = process.env.MOCK_API_KEY || "";
const MAX_BODY = Number(process.env.MOCK_MAX_BODY || 2 * 1024 * 1024);

/* ── keyword concept bank ──────────────────────────────────────────────── */
const CONCEPTS = {
  billing: ["charge", "charged", "billing", "bill", "invoice", "refund", "payment", "paid", "subscription", "price", "pricing", "cost", "double", "twice", "stripe", "card", "receipt", "money"],
  technical: ["bug", "error", "crash", "fail", "failing", "broken", "integration", "api", "timeout", "500", "exception", "stack", "latency", "outage", "down", "glitch", "traceback"],
  account: ["login", "log in", "password", "access", "locked", "2fa", "sso", "session", "username", "sign in", "mfa", "permission", "profile"],
  sales: ["demo", "quote", "enterprise", "contract", "discount", "sales", "seats", "budget", "procurement", "pilot", "onboarding"],
  emergency: ["emergency", "chest", "breath", "unconscious", "bleeding", "stroke", "severe", "life-threatening", "ambulance"],
  urgent: ["asap", "urgent", "immediately", "now", "today", "deadline", "losing sales", "critical", "this quarter", "next week", "blocker", "escalate"],
  angry: ["angry", "furious", "!!", "ridiculous", "unacceptable", "garbage", "ashamed", "screwed", "worst", "never again", "lawyer", "chargeback"],
  toxic: ["garbage", "ashamed", "idiot", "stupid", "scam", "hate", "worst", "trash", "sue", "post this everywhere"],
  positive: ["great", "love", "thanks", "excellent", "happy", "awesome", "perfect", "pleased"],
  allow: ["friendly", "helpful", "thanks", "great", "please", "question"],
  flag: ["review", "moderate", "complaint", "borderline"],
  block: ["abuse", "threat", "hate", "spam", "toxic"],
  low: ["fyi", "just wondering", "no rush", "when you can"],
  medium: ["soon", "this week", "help"],
  high: ["asap", "urgent", "blocking", "losing sales"],
  critical: ["emergency", "outage", "down", "critical", "immediately", "!!"],
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function softmax(values, temperature = 1) {
  const t = Math.max(0.05, temperature);
  const scaled = values.map((v) => v / t);
  const max = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

function hits(text) {
  const lower = String(text || "").toLowerCase();
  const out = {};
  for (const [concept, words] of Object.entries(CONCEPTS)) {
    out[concept] = words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
  }
  return out;
}

function heatScore(state) {
  const text = String(state || "");
  const exclamations = (text.match(/!/g) || []).length;
  const caps = (text.match(/\b[A-Z]{3,}\b/g) || []).length;
  const h = hits(text);
  const words = Math.max(1, text.split(/\s+/).length);
  return clamp((exclamations * 0.12 + caps * 0.14 + h.angry * 0.22 + h.urgent * 0.1) / Math.max(1, words / 45), 0, 1);
}

function confidenceFrom(probs) {
  const sorted = [...probs].sort((a, b) => b - a);
  const top = sorted[0] || 0;
  const gap = Math.min(0.5, top - (sorted[1] || 0));
  return round(clamp(0.5 * top + 0.5 * (gap + 0.5), 0, 0.999));
}

function answerQuestion(name, q, state) {
  const h = hits(state);
  const heat = heatScore(state);
  const instructions = q.instructions || "";

  if (q.type === "choice") {
    const criteria = q.criteria || {};
    const keys = Object.keys(criteria);
    if (keys.length === 0) return { type: "choice", choice: "", confidence: 0, probabilities: {} };

    const scores = keys.map((k) => {
      const direct = h[k] || 0;
      const descScore = Object.entries(hits(`${k} ${criteria[k] || ""}`)).reduce(
        (s, [concept, n]) => s + Math.min(h[concept] || 0, 3) * (n > 0 ? 0.35 : 0),
        0
      );
      const nameScore = Object.entries(hits(`${name} ${instructions}`)).reduce(
        (s, [concept, n]) => s + (concept === k ? n * 0.3 : 0),
        0
      );
      return direct * 1.1 + descScore * 0.6 + nameScore + 0.05;
    });

    const max = Math.max(0.0001, ...scores);
    const probs = softmax(
      scores.map((s) => (s / max) * 3.2),
      1
    );
    const probabilities = {};
    keys.forEach((k, i) => (probabilities[k] = round(probs[i])));
    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
    return {
      type: "choice",
      choice: keys[best],
      confidence: confidenceFrom(probs),
      probabilities,
    };
  }

  if (q.type === "score") {
    const levels = Array.isArray(q.criteria) ? q.criteria : [];
    if (levels.length === 0) return { type: "score", score: 0, confidence: 0, legend: {} };

    const intensity = clamp(heat * 0.75 + (h.urgent + h.angry) * 0.1, 0, 1);
    const center = intensity * (levels.length - 1);
    const probs = softmax(
      levels.map((_l, i) => -Math.pow(i - center, 2) * 1.7),
      1
    );
    const legend = {};
    const probabilities = {};
    levels.forEach((l, i) => {
      legend[String(i)] = l;
      probabilities[String(i)] = round(probs[i]);
    });
    const score = probs.reduce((s, p, i) => s + p * i, 0);
    return {
      type: "score",
      score: round(score, 2),
      confidence: confidenceFrom(probs),
      legend,
      probabilities,
    };
  }

  // noul / boolean
  const stmt = `${name} ${instructions}`.toLowerCase();
  const concept = Object.keys(CONCEPTS).find((c) => stmt.includes(c)) || null;
  const p = concept
    ? clamp(0.16 + (h[concept] || 0) * 0.24 + heat * 0.28, 0.02, 0.98)
    : clamp(0.2 + heat * 0.72, 0.02, 0.98);
  return { type: "noul", noul: round(p) };
}

function systemOne(payload) {
  const state = payload.state;
  const questions = payload.questions || {};
  const stateText = typeof state === "string" ? state : JSON.stringify(state);
  const answers = {};
  for (const [name, q] of Object.entries(questions)) {
    answers[name] = answerQuestion(name, q || {}, stateText);
  }
  const tokens = Math.round(stateText.length / 4) + JSON.stringify(questions).length / 12;
  return {
    model: MODEL,
    answers,
    usage: { input_tokens: Math.round(tokens), output_tokens: Math.round(Object.keys(answers).length * 12) },
    meta: { engine: "mock-decider", deterministic: true, latency_ms: LATENCY },
  };
}

function send(res, status, body, type = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(text),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "x-mock-decider": "1",
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") return send(res, 204, "");

  if (path === "/health" || path === "/healthz" || path === "/") {
    return send(res, 200, {
      status: "ok",
      service: "mock-decider",
      model: MODEL,
      note: "Deterministic offline stand-in for Mapika/decider. Swap in the real GPU server with --profile gpu.",
      endpoints: ["/health", "/v1/models", "/v1/systemone"],
      uptime_s: Math.round(process.uptime()),
    });
  }

  if (path === "/v1/models") {
    return send(res, 200, { object: "list", data: [{ id: MODEL, object: "model", owned_by: "myjev-mock" }] });
  }

  if (path === "/v1/systemone" || path === "/api/evaluate") {
    if (req.method !== "POST") return send(res, 405, { error: "use POST" });
    if (API_KEY) {
      const auth = req.headers.authorization || "";
      const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
      if (token !== API_KEY) return send(res, 401, { error: "invalid bearer token" });
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch (err) {
      return send(res, 400, { error: `invalid JSON body: ${err.message}` });
    }
    if (payload.state === undefined || payload.state === null) {
      return send(res, 400, { error: "missing 'state'" });
    }
    if (!payload.questions || typeof payload.questions !== "object") {
      return send(res, 400, { error: "missing 'questions' object" });
    }
    if (LATENCY > 0) await new Promise((r) => setTimeout(r, LATENCY));
    try {
      return send(res, 200, systemOne(payload));
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  send(res, 404, { error: `unknown route ${req.method} ${path}` });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-decider] listening on http://${HOST}:${PORT}`);
  console.log(`[mock-decider] POST /v1/systemone · model=${MODEL} · latency=${LATENCY}ms · auth=${API_KEY ? "on" : "off"}`);
});

const shutdown = (sig) => {
  console.log(`\n[mock-decider] ${sig} — closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
