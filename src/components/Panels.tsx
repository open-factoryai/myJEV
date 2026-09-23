import type { AppConfig, Dataset, EvaluateResponse, QuestionDraft } from "../lib/types";
import { copyText, downloadFile } from "../lib/storage";
import { toast } from "../lib/toast";

/* ─────────────────────────────── History ─────────────────────────────── */

export interface HistoryEntry {
  id: string;
  ts: number;
  mode: string;
  model: string;
  latency_ms: number;
  calls: number;
  questions: number;
  statePreview: string;
  config: AppConfig;
  state: string;
  drafts: QuestionDraft[];
  result: EvaluateResponse;
}

export function HistoryPanel({
  history,
  onRestore,
  onClear,
}: {
  history: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
  onClear: () => void;
}) {
  return (
    <div className="tab-body single">
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Run history</span>
          <div className="panel-tools">
            {history.length > 0 && (
              <>
                <button
                  type="button"
                  className="ghost-btn small"
                  onClick={() => {
                    downloadFile("myjev-history.json", JSON.stringify(history, null, 2));
                    toast.success("History exported");
                  }}
                >
                  Export JSON
                </button>
                <button type="button" className="ghost-btn small danger" onClick={onClear}>
                  Clear
                </button>
              </>
            )}
          </div>
        </div>
        <div className="panel-body">
          {history.length === 0 ? (
            <div className="results-empty">
              <div className="results-empty-icon">↺</div>
              <div style={{ fontWeight: 500, color: "var(--text-muted)" }}>No runs yet</div>
              <div style={{ fontSize: 13, maxWidth: 340 }}>
                Every successful run is stored in your browser (last 50). Click one to restore its state, questions and
                answers — handy for A/B-ing modes and models.
              </div>
            </div>
          ) : (
            <div className="history-list">
              {history.map((h) => (
                <button key={h.id} type="button" className="history-card" onClick={() => onRestore(h)}>
                  <div className="history-card-top">
                    <span className={`pill mode-${h.mode}`}>{h.mode}</span>
                    <span className="mono dim">{h.model}</span>
                    <span className="run-spacer" />
                    <span className="mono dim">{new Date(h.ts).toLocaleString()}</span>
                  </div>
                  <div className="history-state">{h.statePreview}</div>
                  <div className="history-card-bottom">
                    <span className="mono dim">
                      {h.questions} q · {h.calls} calls · {h.latency_ms} ms
                    </span>
                    <span className="history-answers">
                      {Object.entries(h.result.answers)
                        .map(([k, a]) => `${k}=${a.type === "choice" ? a.choice : a.type === "score" ? a.score.toFixed(2) : `${(a.noul * 100).toFixed(0)}%`}`)
                        .join("  ·  ")}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────────── Datasets ────────────────────────────── */

export function DatasetsPanel({
  datasets,
  onLoad,
  onDelete,
  onImport,
  onExportAll,
}: {
  datasets: Dataset[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  onExportAll: () => void;
}) {
  return (
    <div className="tab-body single">
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Datasets</span>
          <div className="panel-tools">
            <label className="ghost-btn small file-btn">
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImport(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button type="button" className="ghost-btn small" onClick={onExportAll}>
              Export all
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div className="dataset-grid">
            {datasets.map((d) => (
              <div key={d.id} className={`dataset-card ${d.builtin ? "builtin" : ""}`}>
                <div className="dataset-head">
                  <span className="dataset-name">{d.name}</span>
                  {d.builtin ? <span className="pill">built-in</span> : <span className="pill custom">saved</span>}
                </div>
                <div className="dataset-desc">{d.description}</div>
                <div className="dataset-meta mono">
                  {d.questions.length} question(s) · {d.questions.map((q) => q.type).join(", ")}
                </div>
                <pre className="dataset-state">{d.state.slice(0, 220)}{d.state.length > 220 ? "…" : ""}</pre>
                <div className="dataset-actions">
                  <button type="button" className="ghost-btn small" onClick={() => onLoad(d.id)}>
                    Load in Playground
                  </button>
                  {!d.builtin && (
                    <button type="button" className="ghost-btn small danger" onClick={() => onDelete(d.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────────── API docs ────────────────────────────── */

export function ApiPanel({ config, state, questions }: { config: AppConfig; state: string; questions: QuestionDraft[] }) {
  const wire = Object.fromEntries(
    Object.entries(
      questions.reduce<Record<string, unknown>>((acc, d) => {
        if (!d.name.trim()) return acc;
        if (d.type === "choice") {
          const criteria: Record<string, string> = {};
          d.options.forEach((o) => o.key.trim() && (criteria[o.key.trim()] = o.description || o.key));
          if (Object.keys(criteria).length) acc[d.name] = { type: "choice", instructions: d.instructions, criteria };
        } else if (d.type === "score") {
          if (d.levels.length) acc[d.name] = { type: "score", instructions: d.instructions, criteria: d.levels };
        } else {
          acc[d.name] = { type: "noul", instructions: d.instructions };
        }
        return acc;
      }, {})
    )
  );

  let parsedState: unknown = state;
  try {
    const p = JSON.parse(state);
    if (p && typeof p === "object") parsedState = p;
  } catch {
    /* string */
  }

  const body = {
    mode: config.mode,
    state: parsedState,
    questions: wire,
    ...(config.mode === "decider"
      ? { decider_url: config.deciderUrl || undefined }
      : config.mode === "mock"
        ? {}
        : { model: config.model || undefined, base_url: config.baseUrl || undefined }),
    temperature: config.temperature,
    softmax_temperature: config.softmaxTemperature,
    concurrency: config.concurrency,
    timeout_ms: config.timeoutMs,
    retries: config.retries,
  };

  const curl = [
    "curl -X POST $MYJEV_URL/api/evaluate \\",
    "  -H 'Content-Type: application/json' \\",
    config.mode === "mock" ? "" : "",
    `  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const python = `import requests\n\nr = requests.post(\n    "http://localhost:8080/api/evaluate",\n    json=${JSON.stringify(body, null, 4).replace(/\n/g, "\n    ")},\n    timeout=120,\n)\nprint(r.json()["answers"])`;

  const ts = `const res = await fetch("/api/evaluate", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, "\n  ")}),\n});\nconst { answers } = await res.json();`;

  return (
    <div className="tab-body single">
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">API</span>
          <span className="panel-meta">same payload the UI sends</span>
        </div>
        <div className="panel-body">
          <div className="endpoints">
            {[
              ["POST", "/api/evaluate", "single state + questions"],
              ["POST", "/api/evaluate/batch", "{ items: [{id, state, questions?}], questions? }"],
              ["GET", "/api/health", "liveness, config, decider probe"],
              ["GET", "/api/config", "non-secret server config"],
              ["GET", "/api/backends", "probe decider + list provider models"],
              ["GET", "/api/models?base_url=&api_key=", "model list from a provider"],
            ].map(([m, p, d]) => (
              <div className="endpoint" key={p}>
                <span className={`method ${m.toLowerCase()}`}>{m}</span>
                <code>{p}</code>
                <span className="endpoint-desc">{d}</span>
              </div>
            ))}
          </div>

          <CodeBlock title="cURL" code={curl} />
          <CodeBlock title="Python (requests)" code={python} language="python" />
          <CodeBlock title="TypeScript / fetch" code={ts} language="ts" />
          <CodeBlock
            title="Docker"
            language="bash"
            code={[
              "# 1) UI (nginx) + API, no GPU",
              "docker compose up -d --build",
              "open http://localhost:8080",
              "",
              "# 2) offline demo without any API key",
              "docker compose --profile mock up -d --build",
              "#    then in Settings: mode = mock   (or provider = Mock)",
              "",
              "# 3) hot-reload development",
              "docker compose --profile dev up -d --build",
              "open http://localhost:3001",
              "",
              "# 4) everything + TLS front door",
              "docker compose --profile mock --profile tls up -d --build",
              "open https://localhost:8443",
              "",
              "# 5) real Mapika/decider weights (NVIDIA GPU required)",
              "docker compose --profile gpu up -d --build",
            ].join("\n")}
          />
        </div>
      </section>
    </div>
  );
}

function CodeBlock({ title, code, language }: { title: string; code: string; language?: string }) {
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{title}</span>
        {language && <span className="mono dim">{language}</span>}
        <span className="run-spacer" />
        <button
          type="button"
          className="ghost-btn small"
          onClick={async () => (await copyText(code)) && toast.success(`${title} copied`)}
        >
          Copy
        </button>
      </div>
      <pre className="json-view small">{code}</pre>
    </div>
  );
}
