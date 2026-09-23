import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppConfig } from "./hooks/useAppConfig";
import {
  DEFAULT_EXAMPLES,
  draftsToQuestions,
  questionsToDrafts,
  type Dataset,
  type EvaluateResponse,
  type QuestionDraft,
} from "./lib/types";
import { runEvaluate, setToken, getToken } from "./lib/api";
import { readJSON, writeJSON, downloadFile, uid } from "./lib/storage";
import { toast } from "./lib/toast";
import { Sidebar, type TabId } from "./components/Sidebar";
import { MenuBar } from "./components/MenuBar";
import { Playground } from "./components/Playground";
import { BatchPanel } from "./components/BatchPanel";
import { DatasetsPanel, HistoryPanel, ApiPanel, type HistoryEntry } from "./components/Panels";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { Toasts } from "./components/Toasts";

const DATASETS_KEY = "myjev-datasets-v2";
const HISTORY_KEY = "myjev-history-v2";
const HISTORY_LIMIT = 50;
const REPO_URL = "https://github.com/open-factoryai/myJEV";

export function App() {
  const {
    config,
    patch,
    reset,
    applyProvider,
    setMode,
    serverConfig,
    serverOnline,
    deciderReachable,
    refreshServerConfig,
  } = useAppConfig();

  const [tab, setTab] = useState<TabId>("playground");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiToken, setApiToken] = useState(getToken);
  const importInputRef = useRef<HTMLInputElement>(null);

  const customDatasets = useMemo(() => readJSON<Dataset[]>(DATASETS_KEY, []), []);
  const [datasets, setDatasets] = useState<Dataset[]>(() => [...DEFAULT_EXAMPLES, ...customDatasets]);

  const [activeDataset, setActiveDataset] = useState<string>(DEFAULT_EXAMPLES[0].id);
  const [state, setState] = useState<string>(DEFAULT_EXAMPLES[0].state);
  const [questions, setQuestions] = useState<QuestionDraft[]>(DEFAULT_EXAMPLES[0].questions);

  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => readJSON<HistoryEntry[]>(HISTORY_KEY, []));

  useEffect(() => writeJSON(HISTORY_KEY, history.slice(0, HISTORY_LIMIT)), [history]);
  useEffect(() => setToken(apiToken), [apiToken]);

  // keep custom datasets in sync with storage
  useEffect(() => {
    const custom = datasets.filter((d) => !d.builtin);
    writeJSON(DATASETS_KEY, custom);
  }, [datasets]);

  const loadDataset = useCallback(
    (id: string) => {
      const ds = datasets.find((d) => d.id === id);
      if (!ds) return;
      setActiveDataset(id);
      setState(ds.state);
      setQuestions(ds.questions.map((q) => ({ ...q, id: uid("q") })));
      setResult(null);
      setError(null);
      setTab("playground");
    },
    [datasets]
  );

  const run = useCallback(async () => {
    const wire = draftsToQuestions(questions);
    if (Object.keys(wire).length === 0) {
      setError("Add at least one valid question (a choice needs ≥2 option keys, a score ≥2 levels).");
      toast.warn("Nothing to run", "Add at least one valid question");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const t0 = performance.now();
    try {
      const res = await runEvaluate(config, state, wire);
      setResult(res);
      const entry: HistoryEntry = {
        id: uid("run"),
        ts: Date.now(),
        mode: res.meta?.mode ?? config.mode,
        model: res.model,
        latency_ms: res.meta?.latency_ms ?? Math.round(performance.now() - t0),
        calls: res.meta?.parallel_calls ?? 0,
        questions: Object.keys(wire).length,
        statePreview: state.replace(/\s+/g, " ").slice(0, 120),
        config,
        state,
        drafts: questions,
        result: res,
      };
      setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT));
      toast.success(
        `${Object.keys(res.answers).length} answer(s) in ${res.meta?.latency_ms ?? "?"} ms`,
        `${res.meta?.mode} · ${res.model}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Run failed", msg.slice(0, 180));
    } finally {
      setLoading(false);
    }
  }, [config, questions, state]);

  // first-run nudge when the server has no key and we're not in mock mode
  useEffect(() => {
    if (serverConfig && !serverConfig.llm.key_configured && config.mode !== "mock" && config.mode !== "decider" && !config.apiKey) {
      toast.warn(
        "No LLM key on the server",
        "Set OPENAI_API_KEY in .env / compose, paste a key in Settings, or switch mode to 'mock' for an offline demo.",
        12000
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverConfig]);

  const saveDataset = useCallback(() => {
    const name = window.prompt("Dataset name", "My dataset");
    if (!name) return;
    const ds: Dataset = {
      id: uid("ds"),
      name,
      description: window.prompt("Description (optional)", "") ?? "",
      state,
      questions,
    };
    setDatasets((prev) => [...prev.filter((d) => d.name !== name || d.builtin), ds]);
    setActiveDataset(ds.id);
    toast.success(`Saved "${name}"`, "Stored in your browser");
  }, [questions, state]);

  const deleteDataset = useCallback((id: string) => {
    setDatasets((prev) => prev.filter((d) => d.id !== id || d.builtin));
    toast.info("Dataset deleted");
  }, []);

  const importDataset = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Dataset | Dataset[];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const added: Dataset[] = [];
      for (const d of list) {
        if (!d || typeof d !== "object") continue;
        const qs: QuestionDraft[] = Array.isArray(d.questions)
          ? d.questions
          : d.questions
            ? questionsToDrafts(d.questions as never)
            : [];
        added.push({
          id: uid("ds"),
          name: d.name || file.name.replace(/\.json$/i, ""),
          description: d.description || "imported",
          state: typeof d.state === "string" ? d.state : JSON.stringify(d.state ?? "", null, 2),
          questions: qs.map((q) => ({ ...q, id: uid("q") })),
        });
      }
      if (added.length === 0) throw new Error("No datasets found in file");
      setDatasets((prev) => [...prev, ...added]);
      toast.success(`Imported ${added.length} dataset(s)`);
    } catch (e) {
      toast.error("Import failed", e instanceof Error ? e.message : String(e));
    }
  }, []);

  const restoreRun = useCallback((entry: HistoryEntry) => {
    setState(entry.state);
    setQuestions(entry.drafts.map((q) => ({ ...q, id: uid("q") })));
    setResult(entry.result);
    setError(null);
    patch({
      mode: entry.config.mode,
      model: entry.config.model,
      baseUrl: entry.config.baseUrl,
      deciderUrl: entry.config.deciderUrl,
      temperature: entry.config.temperature,
      softmaxTemperature: entry.config.softmaxTemperature,
      concurrency: entry.config.concurrency,
    });
    setTab("playground");
    toast.info("Run restored", `${entry.mode} · ${entry.model}`);
  }, [patch]);

  // ⌘/Ctrl + Enter runs the playground, ⌘/Ctrl + S saves a dataset,
  // ⌘/Ctrl + , opens settings — matching what the menu bar advertises
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (tab === "playground") void run();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveDataset();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, tab, saveDataset]);

  const statusDot =
    serverOnline === null ? "unknown" : serverOnline ? "ok" : "bad";

  return (
    <div className="app">
      <MenuBar
        tab={tab}
        onTab={setTab}
        config={config}
        patch={patch}
        reset={reset}
        onRun={() => void run()}
        running={loading}
        onSettings={() => setSettingsOpen(true)}
        onSaveDataset={saveDataset}
        onImport={() => importInputRef.current?.click()}
        onExportDatasets={() => {
          downloadFile("myjev-datasets-all.json", JSON.stringify(datasets, null, 2));
          toast.success("All datasets exported");
        }}
        onExportPayload={() => {
          downloadFile(
            "myjev-request.json",
            JSON.stringify({ mode: config.mode, model: config.model, state, questions: draftsToQuestions(questions) }, null, 2)
          );
          toast.success("Request payload exported");
        }}
        canExportPayload={Object.keys(draftsToQuestions(questions)).length > 0}
        repoUrl={REPO_URL}
      />

      <div className="app-body">
        <Sidebar active={tab} onChange={setTab} counts={{ history: history.length, datasets: datasets.length }} />

        <div className="content">
          <header className="header">
            <div className="header-spacer" />
            <div className="status-strip">
              <span className={`status-dot ${statusDot}`} title={serverOnline ? "API reachable" : "API unreachable"} />
              <span className="status-text">api {serverOnline === null ? "…" : serverOnline ? "up" : "down"}</span>
              {serverConfig && (
                <span className="status-sep">·</span>
              )}
              {serverConfig && (
                <span className="status-text" title={serverConfig.llm.key_source ?? "no key on server"}>
                  key {serverConfig.llm.key_configured ? serverConfig.llm.key_source?.replace("_API_KEY", "").toLowerCase() : "none"}
                </span>
              )}
              <span className="status-sep">·</span>
              <span
                className={`status-text ${deciderReachable === true ? "ok" : deciderReachable === false ? "dim" : ""}`}
                title={serverConfig?.decider.url}
              >
                decider {deciderReachable === null ? "?" : deciderReachable ? "up" : "down"}
              </span>
              <span className="status-sep">·</span>
              <span className="status-text mode-pill" title="Current backend mode">
                {config.mode}
              </span>
            </div>

            <div className="header-actions">
              <button
                type="button"
                className="theme-toggle"
                onClick={() => patch({ theme: config.theme === "dark" ? "light" : "dark" })}
                title={`Switch to ${config.theme === "dark" ? "light" : "dark"} theme`}
                aria-label={`Switch to ${config.theme === "dark" ? "light" : "dark"} theme`}
              >
                <span aria-hidden>{config.theme === "dark" ? "☾" : "☀"}</span>
                <span>{config.theme === "dark" ? "Dark" : "Light"}</span>
              </button>
              <button
                type="button"
                className="ghost-btn small"
                onClick={async () => {
                  const cfg = await refreshServerConfig();
                  cfg ? toast.success("Server config refreshed", `v${cfg.version}`) : toast.error("Server unreachable");
                }}
                title="Re-read server config (GET /api/config)"
              >
                ⟳
              </button>
              <button type="button" className="settings-btn" onClick={() => setSettingsOpen(true)}>
                <span aria-hidden>⚙</span> Settings
              </button>
            </div>
          </header>

        {tab === "playground" && (
          <Playground
            state={state}
            setState={setState}
            questions={questions}
            setQuestions={setQuestions}
            config={config}
            datasets={datasets}
            activeDataset={activeDataset}
            onLoadDataset={loadDataset}
            onSaveDataset={saveDataset}
            result={result}
            error={error}
            loading={loading}
            onRun={run}
          />
        )}
        {tab === "batch" && <BatchPanel config={config} questions={questions} />}
        {tab === "history" && (
          <HistoryPanel history={history} onRestore={restoreRun} onClear={() => { setHistory([]); toast.info("History cleared"); }} />
        )}
        {tab === "datasets" && (
          <DatasetsPanel
            datasets={datasets}
            onLoad={loadDataset}
            onDelete={deleteDataset}
            onImport={importDataset}
            onExportAll={() => {
              downloadFile("myjev-datasets-all.json", JSON.stringify(datasets, null, 2));
              toast.success("All datasets exported");
            }}
          />
        )}
        {tab === "api" && <ApiPanel config={config} state={state} questions={questions} />}
        </div>
      </div>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importDataset(f);
          e.target.value = "";
        }}
      />

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        patch={patch}
        reset={reset}
        applyProvider={applyProvider}
        setMode={setMode}
        serverConfig={serverConfig}
        serverOnline={serverOnline}
        token={apiToken}
        onTokenChange={setApiToken}
      />

      <Toasts />
    </div>
  );
}

export default App;
