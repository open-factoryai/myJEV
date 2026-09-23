export type TabId = "playground" | "batch" | "history" | "datasets" | "api";

const TABS: { id: TabId; label: string; icon: string; hint: string }[] = [
  { id: "playground", label: "Playground", icon: "◎", hint: "state + typed questions → answers" },
  { id: "batch", label: "Batch", icon: "≡", hint: "score many states at once (JSONL)" },
  { id: "history", label: "History", icon: "↺", hint: "last 50 runs, restore & compare" },
  { id: "datasets", label: "Datasets", icon: "▤", hint: "built-in + saved examples" },
  { id: "api", label: "API", icon: "⌁", hint: "endpoints, cURL, Python, Docker" },
];

export function Sidebar({
  active,
  onChange,
  counts,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
  counts: { history: number; datasets: number };
}) {
  return (
    <nav className="sidebar" aria-label="Sections">
      <div className="sidebar-brand">
        <div className="header-logo">MJ</div>
        <div className="sidebar-brand-text">
          <div className="header-title">myJEV</div>
          <div className="header-sub">System One playground</div>
        </div>
      </div>

      <div className="sidebar-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`side-tab ${active === t.id ? "active" : ""}`}
            onClick={() => onChange(t.id)}
            title={t.hint}
          >
            <span className="side-icon">{t.icon}</span>
            <span className="side-label">{t.label}</span>
            {t.id === "history" && counts.history > 0 && <span className="side-count">{counts.history}</span>}
            {t.id === "datasets" && counts.datasets > 0 && <span className="side-count">{counts.datasets}</span>}
          </button>
        ))}
      </div>

      <div className="sidebar-foot">
        <a href="https://github.com/Mapika/decider" target="_blank" rel="noreferrer noopener" className="side-link">
          Mapika/decider ↗
        </a>
        <span className="side-hint">v2 · MIT</span>
      </div>
    </nav>
  );
}
