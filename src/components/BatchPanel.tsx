import { useMemo, useState } from "react";
import type { AppConfig, BatchItem, BatchResponse, QuestionDraft } from "../lib/types";
import { draftsToQuestions } from "../lib/types";
import { runBatch } from "../lib/api";
import { copyText, downloadFile } from "../lib/storage";
import { toast } from "../lib/toast";

interface Props {
  config: AppConfig;
  questions: QuestionDraft[];
}

const SAMPLE = `{"id":"t1","state":"Charged twice again!! Fix it ASAP."}
{"id":"t2","state":"The dashboard throws a 500 when I open the billing tab."}
{"id":"t3","state":"Can we get a quote for 400 seats this quarter? Budget approved."}
{"id":"t4","state":"I can't log in since you enabled SSO, my 2FA codes are rejected."}
{"id":"t5","state":"This product is absolute garbage and the CEO should be ashamed."}`;

export function BatchPanel({ config, questions }: Props) {
  const [text, setText] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<BatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useSharedQuestions, setUseSharedQuestions] = useState(true);

  const wire = useMemo(() => draftsToQuestions(questions), [questions]);
  const parsed = useMemo(() => {
    const items: BatchItem[] = [];
    const errors: string[] = [];
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line, i) => {
        try {
          const obj = JSON.parse(line) as BatchItem;
          if (obj.state === undefined) errors.push(`line ${i + 1}: missing "state"`);
          else items.push(obj);
        } catch {
          // bare string lines are treated as state
          items.push({ id: `line-${i + 1}`, state: line.replace(/^["']|["']$/g, "") });
        }
      });
    return { items, errors };
  }, [text]);

  const run = async () => {
    if (parsed.items.length === 0) {
      setError("No items to run");
      return;
    }
    if (useSharedQuestions && Object.keys(wire).length === 0) {
      setError("No questions defined — add questions in the Playground tab or embed them per item");
      return;
    }
    setBusy(true);
    setError(null);
    setResponse(null);
    try {
      const res = await runBatch(config, {
        items: parsed.items,
        questions: useSharedQuestions ? wire : undefined,
        concurrency: config.concurrency,
      });
      setResponse(res);
      toast.success(`Batch done · ${res.ok}/${res.total} ok · ${res.latency_ms} ms`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Batch failed", msg.slice(0, 160));
    } finally {
      setBusy(false);
    }
  };

  const rows = response?.rows ?? [];
  const questionNames = Object.keys(wire);

  return (
    <div className="tab-body split">
      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Batch input (JSONL)</span>
          <span className="panel-meta">
            {parsed.items.length} item(s){parsed.errors.length ? ` · ${parsed.errors.length} bad` : ""}
          </span>
        </div>
        <div className="panel-body">
          <p className="set-help" style={{ marginTop: 0 }}>
            One JSON object per line: <code>{'{"id":"…","state":"…"}'}</code>. A line can also carry its own{" "}
            <code>questions</code>. Plain-text lines are accepted as bare states.
          </p>
          <textarea
            className="textarea tall mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          {parsed.errors.length > 0 && <div className="error-box">{parsed.errors.join("\n")}</div>}
          <label className="set-check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={useSharedQuestions} onChange={(e) => setUseSharedQuestions(e.target.checked)} />
            <span>
              Use the Playground question set
              <small>
                {Object.keys(wire).length} question(s): {questionNames.join(", ") || "—"}
              </small>
            </span>
          </label>
          <div className="run-bar inline">
            <button type="button" className="run-btn" onClick={run} disabled={busy}>
              {busy && <span className="spinner" />}
              {busy ? "Running batch…" : `Run ${parsed.items.length || ""} item(s)`}
            </button>
            <span className="run-status">
              mode {config.mode} · concurrency {config.concurrency}
            </span>
            <span className="run-spacer" />
            <button type="button" className="ghost-btn small" onClick={() => setText(SAMPLE)}>
              Load sample
            </button>
            <button type="button" className="ghost-btn small" onClick={() => setText("")}>
              Clear
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span className="panel-title">Batch output</span>
          {response && (
            <div className="panel-tools">
              <button
                type="button"
                className="ghost-btn small"
                onClick={async () => (await copyText(JSON.stringify(response, null, 2))) && toast.success("Copied")}
              >
                Copy JSON
              </button>
              <button
                type="button"
                className="ghost-btn small"
                onClick={() => {
                  const lines = rows.map((r) =>
                    JSON.stringify({
                      id: r.id,
                      ok: r.ok,
                      error: r.error,
                      answers: r.result?.answers ?? null,
                    })
                  );
                  downloadFile("myjev-batch.jsonl", lines.join("\n"), "application/x-ndjson");
                  toast.success("Downloaded JSONL");
                }}
              >
                Download JSONL
              </button>
              <button
                type="button"
                className="ghost-btn small"
                onClick={() => {
                  const header = ["id", "ok", ...questionNames.flatMap((q) => [`${q}.value`, `${q}.confidence`])];
                  const csv = [header.join(",")].concat(
                    rows.map((r) => {
                      const cells = [r.id, String(r.ok)];
                      for (const q of questionNames) {
                        const a = r.result?.answers?.[q];
                        if (!a) cells.push("", "");
                        else if (a.type === "choice") cells.push(csvCell(a.choice), a.confidence.toFixed(3));
                        else if (a.type === "score") cells.push(csvCell(String(a.score)), a.confidence.toFixed(3));
                        else cells.push(a.noul.toFixed(3), "");
                      }
                      return cells.join(",");
                    })
                  );
                  downloadFile("myjev-batch.csv", csv.join("\n"), "text/csv");
                  toast.success("Downloaded CSV");
                }}
              >
                Download CSV
              </button>
            </div>
          )}
        </div>
        <div className="panel-body">
          {error && <div className="error-box">{error}</div>}
          {!response && !error && (
            <div className="results-empty">
              <div className="results-empty-icon">≡</div>
              <div style={{ fontWeight: 500, color: "var(--text-muted)" }}>Batch results appear here</div>
              <div style={{ fontSize: 13, maxWidth: 360 }}>
                Runs against <code>POST /api/evaluate/batch</code> with a server-side concurrency cap. Good for
                regression-testing a prompt or scoring a whole inbox.
              </div>
            </div>
          )}
          {response && (
            <>
              <div className="batch-summary">
                <span className="pill ok">{response.ok} ok</span>
                {response.failed > 0 && <span className="pill bad">{response.failed} failed</span>}
                <span className="pill">{response.total} total</span>
                <span className="pill">{response.latency_ms} ms</span>
                <span className="pill">mode {response.mode}</span>
              </div>
              <div className="table-wrap">
                <table className="batch-table">
                  <thead>
                    <tr>
                      <th>id</th>
                      <th>state</th>
                      {questionNames.map((q) => (
                        <th key={q}>{q}</th>
                      ))}
                      <th>ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const item = parsed.items[r.index];
                      const stateStr = typeof item?.state === "string" ? item.state : JSON.stringify(item?.state ?? "");
                      return (
                        <tr key={r.id + r.index} className={r.ok ? "" : "row-error"}>
                          <td className="mono">{r.id}</td>
                          <td className="state-cell" title={stateStr}>
                            {stateStr.slice(0, 70)}
                          </td>
                          {questionNames.map((q) => {
                            const a = r.result?.answers?.[q];
                            if (!a) return <td key={q} className="mono dim">{r.ok ? "—" : (r.error ?? "").slice(0, 30)}</td>;
                            if (a.type === "choice")
                              return (
                                <td key={q}>
                                  <span className="cell-choice">{a.choice}</span>
                                  <span className="dim">{(a.confidence * 100).toFixed(0)}%</span>
                                </td>
                              );
                            if (a.type === "score")
                              return (
                                <td key={q}>
                                  <span className="cell-score">{a.score.toFixed(2)}</span>
                                  <span className="dim">{a.legend[String(Math.round(a.score))] ?? ""}</span>
                                </td>
                              );
                            return (
                              <td key={q}>
                                <span className="cell-noul">{(a.noul * 100).toFixed(0)}%</span>
                              </td>
                            );
                          })}
                          <td className="mono dim">{r.result?.meta?.latency_ms ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
