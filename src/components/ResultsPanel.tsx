import { useMemo, useState } from "react";
import type { Answer, EvaluateResponse } from "../lib/types";
import { copyText, downloadFile } from "../lib/storage";
import { toast } from "../lib/toast";

interface Props {
  result: EvaluateResponse | null;
  error: string | null;
  loading: boolean;
}

function ChoiceResult({ name, answer }: { name: string; answer: Extract<Answer, { type: "choice" }> }) {
  const entries = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
  return (
    <div className="answer-card">
      <div className="answer-card-header">
        <span className="question-type-badge choice">choice</span>
        <span className="answer-name">{name}</span>
        <span className="answer-value" style={{ color: "var(--choice)" }}>
          {answer.choice}
        </span>
      </div>
      <div className="answer-body">
        {entries.map(([key, p]) => (
          <div className="prob-bar-row" key={key}>
            <span className="prob-label" title={key}>
              {key}
            </span>
            <div className="prob-track">
              <div
                className="prob-fill choice"
                style={{ width: `${Math.round(p * 100)}%`, opacity: key === answer.choice ? 1 : 0.55 }}
              />
            </div>
            <span className="prob-pct">{(p * 100).toFixed(1)}%</span>
          </div>
        ))}
        <div className="confidence-row">
          Confidence <span className="confidence-val">{(answer.confidence * 100).toFixed(1)}%</span>
          <span className="entropy-tag">margin {(Math.round((entries[0]?.[1] ?? 0) * 100) - Math.round((entries[1]?.[1] ?? 0) * 100))}pp</span>
        </div>
      </div>
    </div>
  );
}

function ScoreResult({ name, answer }: { name: string; answer: Extract<Answer, { type: "score" }> }) {
  const max = Math.max(0, ...Object.keys(answer.legend).map((k) => Number(k)));
  const label =
    answer.legend[String(Math.round(answer.score))] ?? answer.legend[String(Math.floor(answer.score))] ?? "";
  const probs =
    answer.probabilities ??
    Object.fromEntries(Object.keys(answer.legend).map((k) => [k, Number(k) === Math.round(answer.score) ? 1 : 0]));
  const pct = max > 0 ? (answer.score / max) * 100 : 0;

  return (
    <div className="answer-card">
      <div className="answer-card-header">
        <span className="question-type-badge score">score</span>
        <span className="answer-name">{name}</span>
        <span className="answer-value" style={{ color: "var(--score)" }}>
          {answer.score.toFixed(2)}
        </span>
      </div>
      <div className="answer-body">
        <div className="score-gauge">
          <span className="score-number">{answer.score.toFixed(2)}</span>
          <span className="score-max">/ {max}</span>
        </div>
        <div className="score-track">
          <div className="score-marker" style={{ left: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
        {label && <div className="score-legend">{label}</div>}
        {Object.entries(answer.legend).map(([k, v]) => {
          const p = probs[k] ?? 0;
          return (
            <div className="prob-bar-row" key={k}>
              <span className="prob-label" title={`${k}: ${v}`}>
                {k}: {v}
              </span>
              <div className="prob-track">
                <div className="prob-fill score" style={{ width: `${Math.round(p * 100)}%` }} />
              </div>
              <span className="prob-pct">{(p * 100).toFixed(0)}%</span>
            </div>
          );
        })}
        <div className="confidence-row">
          Confidence <span className="confidence-val">{(answer.confidence * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

function NoulResult({ name, answer }: { name: string; answer: Extract<Answer, { type: "noul" }> }) {
  const pct = Math.round(answer.noul * 1000) / 10;
  return (
    <div className="answer-card">
      <div className="answer-card-header">
        <span className="question-type-badge noul">noul</span>
        <span className="answer-name">{name}</span>
        <span className="answer-value" style={{ color: "var(--noul)" }}>
          {pct >= 50 ? "true" : "false"}
        </span>
      </div>
      <div className="answer-body">
        <div className="noul-big">{pct.toFixed(1)}%</div>
        <div className="noul-label">probability true</div>
        <div className="prob-bar-row">
          <span className="prob-label">true</span>
          <div className="prob-track">
            <div className="prob-fill noul" style={{ width: `${pct}%` }} />
          </div>
          <span className="prob-pct">{pct.toFixed(0)}%</span>
        </div>
        <div className="prob-bar-row">
          <span className="prob-label">false</span>
          <div className="prob-track">
            <div className="prob-fill noul" style={{ width: `${100 - pct}%`, opacity: 0.45 }} />
          </div>
          <span className="prob-pct">{(100 - pct).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

export function ResultsPanel({ result, error, loading }: Props) {
  const [view, setView] = useState<"cards" | "json">("cards");

  const summary = useMemo(() => {
    if (!result) return null;
    const entries = Object.values(result.answers);
    const conf = entries
      .map((a) => ("confidence" in a ? a.confidence : a.type === "noul" ? Math.abs(a.noul - 0.5) * 2 : 0))
      .filter((n) => Number.isFinite(n));
    const avg = conf.length ? conf.reduce((s, n) => s + n, 0) / conf.length : 0;
    return {
      count: entries.length,
      avgConfidence: avg,
      lowest: entries.length
        ? Object.entries(result.answers).sort((a, b) => {
            const ca = "confidence" in a[1] ? a[1].confidence : Math.abs(a[1].noul - 0.5) * 2;
            const cb = "confidence" in b[1] ? b[1].confidence : Math.abs(b[1].noul - 0.5) * 2;
            return ca - cb;
          })[0][0]
        : "",
    };
  }, [result]);

  if (loading) {
    return (
      <div className="results-empty">
        <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
        <div>Running…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-body">
        <div className="error-box">{error}</div>
        <div className="error-hints">
          <div className="error-hint-title">Common fixes</div>
          <ul>
            <li>No key? Set <code>OPENAI_API_KEY</code> in <code>.env</code> / compose, or paste one in Settings.</li>
            <li>Try mode <code>mock</code> — it runs fully offline and proves the wiring end-to-end.</li>
            <li>Local models: point base url at <code>http://host.docker.internal:11434/v1</code> (Ollama) or your vLLM port.</li>
            <li>Decider mode: the GPU server must be reachable from the <em>api</em> container (use <code>http://decider:8000</code> inside compose).</li>
          </ul>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="results-empty">
        <div className="results-empty-icon">◎</div>
        <div style={{ fontWeight: 500, color: "var(--text-muted)" }}>Decision output appears here</div>
        <div style={{ fontSize: 13, maxWidth: 340 }}>
          Modes: <b>parallel</b> · <b>oneshot</b> · <b>decider</b> (Mapika/decider RLCD weights) · <b>mock</b> (offline)
        </div>
      </div>
    );
  }

  const json = JSON.stringify(result, null, 2);

  return (
    <>
      <div className="results-toolbar">
        <div className="seg">
          <button type="button" className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>
            Cards
          </button>
          <button type="button" className={view === "json" ? "active" : ""} onClick={() => setView("json")}>
            JSON
          </button>
        </div>
        <div className="toolbar-spacer" />
        {summary && (
          <span className="summary-chip" title="Average confidence across answers">
            ø conf {(summary.avgConfidence * 100).toFixed(0)}% · weakest: {summary.lowest}
          </span>
        )}
        <button
          type="button"
          className="ghost-btn"
          onClick={async () => (await copyText(json)) && toast.success("JSON copied")}
        >
          Copy
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            downloadFile(`myjev-${Date.now()}.json`, json);
            toast.success("Downloaded result JSON");
          }}
        >
          Download
        </button>
      </div>

      <div className="panel-body">
        {view === "json" ? (
          <pre className="json-view">{json}</pre>
        ) : (
          Object.entries(result.answers).map(([name, answer]) => {
            if (answer.type === "choice") return <ChoiceResult key={name} name={name} answer={answer} />;
            if (answer.type === "score") return <ScoreResult key={name} answer={answer} name={name} />;
            return <NoulResult key={name} name={name} answer={answer} />;
          })
        )}

        <div className="usage-footer">
          <span>model: {result.model}</span>
          {result.meta && (
            <>
              <span>mode: {result.meta.mode}</span>
              {result.meta.backend && <span className="ellipsis" title={result.meta.backend}>backend: {result.meta.backend}</span>}
              <span>calls: {result.meta.parallel_calls}</span>
              {result.meta.retries ? <span>retries: {result.meta.retries}</span> : null}
              <span>{result.meta.latency_ms} ms</span>
              {result.meta.request_id && <span className="ellipsis" title={result.meta.request_id}>req: {result.meta.request_id.slice(0, 8)}</span>}
            </>
          )}
          {result.usage.input_tokens != null && <span>in: {result.usage.input_tokens} tok</span>}
          {result.usage.output_tokens != null && <span>out: {result.usage.output_tokens} tok</span>}
        </div>
      </div>
    </>
  );
}
