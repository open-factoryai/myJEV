import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { TabId } from "./Sidebar";
import { type AppConfig, type BackendMode } from "../lib/types";

type MenuId = "file" | "run" | "view" | "help";

const TABS: { id: TabId; label: string }[] = [
  { id: "playground", label: "Playground" },
  { id: "batch", label: "Batch" },
  { id: "history", label: "History" },
  { id: "datasets", label: "Datasets" },
  { id: "api", label: "API" },
];

const MODES: { id: BackendMode; label: string }[] = [
  { id: "parallel", label: "parallel — micro-scorers" },
  { id: "oneshot", label: "oneshot — single call" },
  { id: "decider", label: "decider — Mapika weights" },
  { id: "mock", label: "mock — offline" },
];

export function MenuBar({
  tab,
  onTab,
  config,
  patch,
  reset,
  onRun,
  running,
  onSettings,
  onSaveDataset,
  onImport,
  onExportDatasets,
  onExportPayload,
  canExportPayload,
  repoUrl,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  config: AppConfig;
  patch: (p: Partial<AppConfig>) => void;
  reset: () => void;
  onRun: () => void;
  running: boolean;
  onSettings: () => void;
  onSaveDataset: () => void;
  onImport: () => void;
  onExportDatasets: () => void;
  onExportPayload: () => void;
  canExportPayload: boolean;
  repoUrl: string;
}) {
  const [open, setOpen] = useState<MenuId | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // close on outside click and on Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = useCallback((id: MenuId) => setOpen((cur) => (cur === id ? null : id)), []);

  /** Wrap an action so the menu always closes after it fires. */
  const act = useCallback(
    (fn: () => void) => () => {
      setOpen(null);
      fn();
    },
    []
  );

  const Item = ({
    icon,
    label,
    shortcut,
    checked,
    disabled,
    onClick,
  }: {
    icon?: string;
    label: string;
    shortcut?: string;
    checked?: boolean;
    disabled?: boolean;
    onClick: () => void;
  }) => (
    <button type="button" className="menu-item" role="menuitem" disabled={disabled} onClick={onClick}>
      <span className="menu-item-icon" aria-hidden>{icon ?? ""}</span>
      <span className="menu-item-label">{label}</span>
      {checked !== undefined && <span className="menu-check" aria-hidden>{checked ? "✓" : ""}</span>}
      {shortcut && <span className="menu-shortcut">{shortcut}</span>}
    </button>
  );

  const Divider = () => <div className="menu-divider" role="separator" />;

  const Root = ({ id, label, children }: { id: MenuId; label: string; children: ReactNode }) => (
    <div className={`menu-root ${open === id ? "open" : ""}`}>
      <button
        type="button"
        className="menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open === id}
        onClick={() => toggle(id)}
        onMouseEnter={() => setOpen((cur) => (cur ? id : cur))}
      >
        {label}
        <span className="menu-caret" aria-hidden>▾</span>
      </button>
      {open === id && (
        <div className="menu-pop" role="menu">
          {children}
        </div>
      )}
    </div>
  );

  return (
    <div className="menubar" ref={barRef} role="menubar">
      <Root id="file" label="File">
        <Item icon="▤" label="Save as dataset…" shortcut="⌘S" onClick={act(onSaveDataset)} />
        <Item icon="↥" label="Import datasets…" onClick={act(onImport)} />
        <Item icon="↧" label="Export all datasets" onClick={act(onExportDatasets)} />
        <Divider />
        <Item
          icon="⌁"
          label="Export request payload"
          disabled={!canExportPayload}
          onClick={act(onExportPayload)}
        />
      </Root>

      <Root id="run" label="Run">
        <Item icon="▶" label="Run evaluation" shortcut="⌘↵" disabled={running} onClick={act(onRun)} />
        <Divider />
        {MODES.map((m) => (
          <Item
            key={m.id}
            icon="◈"
            label={m.label}
            checked={config.mode === m.id}
            onClick={act(() => patch({ mode: m.id }))}
          />
        ))}
        <Divider />
        <Item icon="⚙" label="Settings…" shortcut="⌘," onClick={act(onSettings)} />
      </Root>

      <Root id="view" label="View">
        {TABS.map((t) => (
          <Item key={t.id} label={t.label} checked={tab === t.id} onClick={act(() => onTab(t.id))} />
        ))}
        <Divider />
        <Item label="Dark theme" checked={config.theme === "dark"} onClick={act(() => patch({ theme: "dark" }))} />
        <Item label="Light theme" checked={config.theme === "light"} onClick={act(() => patch({ theme: "light" }))} />
        <Divider />
        <Item
          label="Comfortable density"
          checked={config.density === "comfortable"}
          onClick={act(() => patch({ density: "comfortable" }))}
        />
        <Item
          label="Compact density"
          checked={config.density === "compact"}
          onClick={act(() => patch({ density: "compact" }))}
        />
        <Divider />
        <Item icon="↺" label="Reset to server defaults" onClick={act(reset)} />
      </Root>

      <Root id="help" label="Help">
        <Item icon="⌁" label="API reference" onClick={act(() => onTab("api"))} />
        <Item
          icon="↗"
          label="Mapika/decider"
          onClick={act(() => window.open("https://github.com/Mapika/decider", "_blank", "noreferrer"))}
        />
        <Item
          icon="↗"
          label="Documentation"
          onClick={act(() => window.open(repoUrl, "_blank", "noreferrer"))}
        />
        <Divider />
        <div className="menu-sect">
          <span>Run</span>
          <span className="menu-shortcut">⌘/Ctrl + ↵</span>
        </div>
        <div className="menu-sect">
          <span>Close drawer</span>
          <span className="menu-shortcut">Esc</span>
        </div>
      </Root>
    </div>
  );
}
