import { useMemo } from "react";
import type { AppConfig, Dataset, EvaluateResponse, QuestionDraft } from "../lib/types";
import { buildRequestPreview, draftsToQuestions } from "../lib/types";
import { QuestionEditor, newQuestion } from "./QuestionEditor";
import { ResultsPanel } from "./ResultsPanel";
import { copyText, downloadFile } from "../lib/storage";
import { toast } from "../lib/toast";

interface Props {
  state: string;
  setState: (s: string) => void;
  questions: QuestionDraft[];
  setQuestions: React.Dispatch<React.SetStateAction<QuestionDraft[]>>;
  config: AppConfig;
  datasets: Dataset[];
  activeDataset: string;
  onLoadDataset: (id: string) => void;
  onSaveDataset: () => void;
  result: EvaluateResponse | null;
  error: string | null;
  loading: boolean;
  onRun: () => void;
}

export function Playground({
  state,
  setState,
  questions,
  setQuestions,
  config,
  datasets,
  activeDataset,
  onLoadDataset,
  onSaveDataset,
  result,
  error,
  loading,
  onRun,
}: Props) {
  const wire = useMemo(() => draftsToQuestions(questions), [questions]);
  const requestPreview = useMemo(() => buildRequestPreview(config, state, wire), [config, state, wire]);
  const stateIsJson = useMemo(() => {
    try {
      const p = JSON.parse(state);
      return Boolean(p && typeof p === "object");
    } catch {
      return false;
    }
  }, [state]);
  const invalidQuestions = questions.filter((q) => {
    if (!q.name.trim()) return true;
    if (q.type === "choice" && q.options.filter((o) => o.key.trim()).length < 2) return true;
    if (q.type === "score" && q.levels.length < 2) return true;
    return false;
  });

  const move = (id: string, dir: -1 | 1) =>
    setQuestions((prev) => {
      const i = prev.findIndex((q) => q.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const modeHint =
    config.mode === "decider"
      ? `decider · ${config.deciderUrl || "server DECIDER_BASE_URL"} → POST /v1/systemone`
      : config.mode === "mock"
        ? "mock · offline deterministic scorer (no keys, no network)"
        : config.mode === "parallel"
          ? `parallel · ${Object.values(wire).reduce((n, q) => n + (q.type === "choice" ? Object.keys(q.criteria).length : q.type === "score" ? q.criteria.length : 1), 0)} scorer call(s)`
          : `oneshot · 1 call → ${config.model || "default model"}`;

  return (
    <div className="main">
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Input</span>
          <div className="panel-tools">
            <button
              type="button"
              className="ghost-btn small"
              onClick={async () => {
                const ok = await copyText(JSON.stringify(requestPreview, null, 2));
                ok ? toast.success("Request JSON copied") : toast.error("Copy failed");
              }}
              title="Copy the exact JSON this UI will POST"
            >
              Copy request
            </button>
            <button
              type="button"
              className="ghost-btn small"
              onClick={() => {
                downloadFile(
                  "myjev-dataset.json",
                  JSON.stringify({ name: "custom", description: "exported from myJEV UI", state, questions }, null, 2)
                );
                toast.success("Dataset exported");
              }}
            >
              Export
            </button>
          </div>
        </div>

        <div className="panel-body">
          <div className="examples">
            {datasets.map((ex) => (
              <button
                key={ex.id}
                type="button"
                className={`example-chip ${activeDataset === ex.id ? "active" : ""} ${ex.builtin ? "" : "custom"}`}
                onClick={() => onLoadDataset(ex.id)}
                title={ex.description}
              >
                {ex.builtin ? "" : "★ "}
                {ex.name}
              </button>
            ))}
            <button type="button" className="example-chip save" onClick={onSaveDataset} title="Save current state + questions as a dataset">
              + Save current
            </button>
          </div>

          <div className="field">
            <div className="field-label">
              <span>
                State {stateIsJson && <span className="tag ok">json</span>}
              </span>
              <span className="hint">{state.length} chars</span>
            </div>
            <textarea
              className="textarea"
              value={state}
              onChange={(e) => setState(e.target.value)}
              spellCheck={false}
              placeholder='Free text or JSON, e.g. {"subject": "...", "message": "..."}'
            />
          </div>

          <div className="field">
            <div className="field-label">
              <span>
                Questions <span className="hint">{questions.length}</span>
                {invalidQuestions.length > 0 && (
                  <span className="tag warn" title={invalidQuestions.map((q) => q.name || "(unnamed)").join(", ")}>
                    {invalidQuestions.length} incomplete
                  </span>
                )}
              </span>
              <span className="hint">{Object.keys(wire).length} sent</span>
            </div>

            <div className="questions-list">
              {questions.map((q, i) => (
                <QuestionEditor
                  key={q.id}
                  question={q}
                  index={i}
                  total={questions.length}
                  onChange={(next) => setQuestions((prev) => prev.map((x) => (x.id === q.id ? next : x)))}
                  onRemove={() => setQuestions((prev) => prev.filter((x) => x.id !== q.id))}
                  onDuplicate={() =>
                    setQuestions((prev) => {
                      const copy = { ...q, id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: `${q.name}_copy` };
                      const idx = prev.findIndex((x) => x.id === q.id);
                      const next = [...prev];
                      next.splice(idx + 1, 0, copy);
                      return next;
                    })
                  }
                  onMove={(dir) => move(q.id, dir)}
                />
              ))}
            </div>

            <div className="add-question-row">
              <button type="button" className="add-type-btn" onClick={() => setQuestions((p) => [...p, newQuestion("choice")])}>
                + Choice
              </button>
              <button type="button" className="add-type-btn" onClick={() => setQuestions((p) => [...p, newQuestion("score")])}>
                + Score
              </button>
              <button type="button" className="add-type-btn" onClick={() => setQuestions((p) => [...p, newQuestion("noul")])}>
                + Noul
              </button>
              <button
                type="button"
                className="add-type-btn"
                onClick={() => {
                  setQuestions([]);
                  toast.info("Questions cleared");
                }}
              >
                Clear all
              </button>
            </div>
          </div>

          <details className="request-preview">
            <summary>Request preview (POST /api/evaluate)</summary>
            <pre className="json-view small">{JSON.stringify(requestPreview, null, 2)}</pre>
          </details>
        </div>

        <div className="run-bar">
          <button type="button" className="run-btn" onClick={onRun} disabled={loading || Object.keys(wire).length === 0}>
            {loading && <span className="spinner" />}
            {loading ? "Running…" : "Run myJEV"}
          </button>
          <span className="run-status">{modeHint}</span>
          <span className="run-spacer" />
          <kbd className="kbd">⌘/Ctrl + ⏎</kbd>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Output</span>
          {result?.meta && (
            <span className="panel-meta">
              {result.meta.mode} · {result.meta.latency_ms} ms · {result.meta.parallel_calls} call(s)
            </span>
          )}
        </div>
        <ResultsPanel result={result} error={error} loading={loading} />
      </section>
    </div>
  );
}
