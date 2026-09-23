import { useState } from "react";
import { fetchModels, type ServerConfigResponse } from "../lib/api";
import { BACKEND_MODES, PROVIDERS, type AppConfig, type BackendMode } from "../lib/types";
import { toast } from "../lib/toast";

interface Props {
  open: boolean;
  onClose: () => void;
  config: AppConfig;
  patch: (p: Partial<AppConfig>) => void;
  reset: () => void;
  applyProvider: (id: string) => void;
  setMode: (m: BackendMode) => void;
  serverConfig: ServerConfigResponse | null;
  serverOnline: boolean | null;
  token: string;
  onTokenChange: (t: string) => void;
}

const ACCENTS = ["#14b8a6", "#22d3ee", "#8b5cf6", "#ec4899", "#f59e0b", "#22c55e", "#f2555a"];

const MODE_HELP: Record<BackendMode, string> = {
  parallel: "One tiny {p} call per option/level → logit softmax. Most calibrated, more calls.",
  oneshot: "A single structured-JSON call for all questions. Cheapest & fastest, coarser probabilities.",
  decider: "Mapika/decider HTTP server (POST /v1/systemone). Real System One weights, needs GPU.",
  mock: "Deterministic offline keyword scorer. Zero cost, no keys — great for demos, CI and smoke tests.",
};

export function SettingsDrawer({
  open,
  onClose,
  config,
  patch,
  reset,
  applyProvider,
  setMode,
  serverConfig,
  serverOnline,
  token,
  onTokenChange,
}: Props) {
  const [modelList, setModelList] = useState<string[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);

  const loadModels = async () => {
    setModelsBusy(true);
    try {
      const res = await fetchModels(config.baseUrl || undefined, config.apiKey || undefined);
      if (res.ok && res.models.length) {
        setModelList(res.models);
        toast.success(`${res.models.length} models fetched`);
      } else {
        setModelList(null);
        toast.warn("Provider did not return a model list", res.error);
      }
    } catch (e) {
      toast.error("Could not list models", e instanceof Error ? e.message : String(e));
    } finally {
      setModelsBusy(false);
    }
  };

  if (!open) return null;

  const provider = PROVIDERS.find((p) => p.id === config.provider) ?? PROVIDERS[PROVIDERS.length - 1];
  const llmModes = config.mode === "parallel" || config.mode === "oneshot";

  return (
    <div className="drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Settings">
        <div className="drawer-head">
          <div>
            <div className="drawer-title">Settings</div>
            <div className="drawer-sub">
              server {serverOnline === null ? "…" : serverOnline ? "online" : "offline"}
              {serverConfig ? ` · v${serverConfig.version}` : ""}
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {/* ── backend mode ─────────────────────────────── */}
          <section className="set-group">
            <div className="set-title">Backend mode</div>
            <div className="mode-grid">
              {BACKEND_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`mode-card ${config.mode === m ? "active" : ""}`}
                  onClick={() => setMode(m)}
                  title={MODE_HELP[m]}
                >
                  <span className="mode-name">{m}</span>
                </button>
              ))}
            </div>
            <p className="set-help">{MODE_HELP[config.mode]}</p>
          </section>

          {/* ── LLM provider ─────────────────────────────── */}
          {config.mode !== "decider" && config.mode !== "mock" && (
            <section className="set-group">
              <div className="set-title">Provider</div>
              <select className="set-input" value={config.provider} onChange={(e) => applyProvider(e.target.value)}>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.note ? ` — ${p.note}` : ""}
                  </option>
                ))}
              </select>

              <label className="set-label">
                Base URL
                <input
                  className="set-input mono"
                  value={config.baseUrl}
                  onChange={(e) => patch({ baseUrl: e.target.value })}
                  placeholder={provider.baseUrl || "https://api.openai.com/v1"}
                  spellCheck={false}
                />
              </label>

              <label className="set-label">
                Model
                <div className="row-gap">
                  <input
                    className="set-input mono"
                    list="myjev-models"
                    value={config.model}
                    onChange={(e) => patch({ model: e.target.value })}
                    placeholder="gpt-4o-mini"
                    spellCheck={false}
                  />
                  <button type="button" className="ghost-btn small" onClick={loadModels} disabled={modelsBusy}>
                    {modelsBusy ? "…" : "Fetch list"}
                  </button>
                </div>
                <datalist id="myjev-models">
                  {(modelList ?? provider.models).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>

              {modelList && (
                <div className="model-chips">
                  {modelList.slice(0, 24).map((m) => (
                    <button key={m} type="button" className="model-chip" onClick={() => patch({ model: m })}>
                      {m}
                    </button>
                  ))}
                </div>
              )}

              <label className="set-label">
                API key
                <input
                  className="set-input mono"
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => patch({ apiKey: e.target.value })}
                  placeholder={
                    serverConfig?.llm.key_configured
                      ? `server has ${serverConfig.llm.key_source} — leave blank to use it`
                      : "sk-… (or set OPENAI_API_KEY on the server)"
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <p className="set-help">
                Keys typed here are stored in your browser (localStorage) and sent per-request. Prefer setting
                <code> OPENAI_API_KEY</code> on the server for shared deployments.
              </p>
            </section>
          )}

          {/* ── decider ──────────────────────────────────── */}
          {config.mode === "decider" && (
            <section className="set-group">
              <div className="set-title">Mapika/decider server</div>
              <label className="set-label">
                URL
                <input
                  className="set-input mono"
                  value={config.deciderUrl}
                  onChange={(e) => patch({ deciderUrl: e.target.value })}
                  placeholder={serverConfig?.decider.url || "http://localhost:8000"}
                  spellCheck={false}
                />
              </label>
              <label className="set-label">
                API key (optional)
                <input
                  className="set-input mono"
                  type="password"
                  value={config.deciderApiKey}
                  onChange={(e) => patch({ deciderApiKey: e.target.value })}
                  placeholder={serverConfig?.decider.key_configured ? "server key configured" : "local"}
                  autoComplete="off"
                />
              </label>
              <p className="set-help">
                Inside Docker Compose use <code>http://decider:8000</code> (or <code>http://mock:8000</code> for the
                offline mock). Leave blank to use the server's <code>DECIDER_BASE_URL</code>.
              </p>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => patch({ deciderUrl: "http://mock:8000" })}
              >
                Use compose mock service
              </button>
            </section>
          )}

          {/* ── scoring knobs ────────────────────────────── */}
          {config.mode !== "mock" && (
            <section className="set-group">
              <div className="set-title">Scoring</div>
              <Slider
                label="Sampling temperature"
                value={config.temperature}
                min={0}
                max={1.5}
                step={0.05}
                onChange={(v) => patch({ temperature: v })}
                help="0 = deterministic scorer calls"
              />
              {llmModes && (
                <Slider
                  label="Softmax temperature"
                  value={config.softmaxTemperature}
                  min={0.1}
                  max={4}
                  step={0.05}
                  onChange={(v) => patch({ softmaxTemperature: v })}
                  help="Lower = sharper distribution over options"
                />
              )}
              <Slider
                label="Concurrency"
                value={config.concurrency}
                min={1}
                max={32}
                step={1}
                integer
                onChange={(v) => patch({ concurrency: v })}
                help="Parallel scorer calls per request"
              />
              <Slider
                label="Timeout (ms)"
                value={config.timeoutMs}
                min={2000}
                max={180000}
                step={1000}
                integer
                onChange={(v) => patch({ timeoutMs: v })}
              />
              <Slider
                label="Retries"
                value={config.retries}
                min={0}
                max={6}
                step={1}
                integer
                onChange={(v) => patch({ retries: v })}
                help="On 429 / 5xx / network errors, exponential backoff"
              />
            </section>
          )}

          {/* ── appearance ───────────────────────────────── */}
          <section className="set-group">
            <div className="set-title">Appearance</div>
            <div className="set-row">
              <span className="set-row-label">Theme</span>
              <div className="seg">
                <button type="button" className={config.theme === "dark" ? "active" : ""} onClick={() => patch({ theme: "dark" })}>
                  Dark
                </button>
                <button type="button" className={config.theme === "light" ? "active" : ""} onClick={() => patch({ theme: "light" })}>
                  Light
                </button>
              </div>
            </div>
            <div className="set-row">
              <span className="set-row-label">Density</span>
              <div className="seg">
                <button
                  type="button"
                  className={config.density === "comfortable" ? "active" : ""}
                  onClick={() => patch({ density: "comfortable" })}
                >
                  Comfortable
                </button>
                <button
                  type="button"
                  className={config.density === "compact" ? "active" : ""}
                  onClick={() => patch({ density: "compact" })}
                >
                  Compact
                </button>
              </div>
            </div>
            <div className="set-row">
              <span className="set-row-label">Accent</span>
              <div className="swatches">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch ${config.accent === c ? "active" : ""}`}
                    style={{ background: c }}
                    onClick={() => patch({ accent: c })}
                    aria-label={`Accent ${c}`}
                  />
                ))}
                <input
                  type="color"
                  className="swatch-picker"
                  value={config.accent}
                  onChange={(e) => patch({ accent: e.target.value })}
                  aria-label="Custom accent colour"
                />
              </div>
            </div>
          </section>

          {/* ── server / ops ─────────────────────────────── */}
          <section className="set-group">
            <div className="set-title">Server</div>
            <label className="set-label">
              myJEV API token (if MYJEV_API_TOKEN is set)
              <input
                className="set-input mono"
                type="password"
                value={token}
                onChange={(e) => onTokenChange(e.target.value)}
                placeholder={serverConfig?.security.auth_required ? "required" : "not required"}
                autoComplete="off"
              />
            </label>
            <label className="set-check">
              <input type="checkbox" checked={config.logRequests} onChange={(e) => patch({ logRequests: e.target.checked })} />
              <span>
                Audit-log these requests server-side
                <small>LOG_REQUESTS writes JSONL{serverConfig?.logging.file ? ` → ${serverConfig.logging.file}` : ""}</small>
              </span>
            </label>
            {serverConfig && (
              <dl className="kv">
                <div>
                  <dt>version</dt>
                  <dd>{serverConfig.version}</dd>
                </div>
                <div>
                  <dt>env</dt>
                  <dd>{serverConfig.mode}</dd>
                </div>
                <div>
                  <dt>llm key</dt>
                  <dd>{serverConfig.llm.key_source ?? "not set"}</dd>
                </div>
                <div>
                  <dt>server base url</dt>
                  <dd className="mono small">{serverConfig.llm.base_url}</dd>
                </div>
                <div>
                  <dt>decider</dt>
                  <dd className="mono small">{serverConfig.decider.url}</dd>
                </div>
                <div>
                  <dt>rate limit</dt>
                  <dd>{serverConfig.security.rate_limit}</dd>
                </div>
                <div>
                  <dt>client overrides</dt>
                  <dd>{serverConfig.security.allow_client_overrides ? "allowed" : "locked"}</dd>
                </div>
                <div>
                  <dt>uptime</dt>
                  <dd>{serverConfig.uptime_s}s</dd>
                </div>
              </dl>
            )}
            <div className="set-actions">
              <button type="button" className="ghost-btn" onClick={reset}>
                Reset to server defaults
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  integer,
  help,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  help?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="set-slider">
      <span className="set-slider-head">
        <span>{label}</span>
        <span className="set-slider-val mono">{integer ? Math.round(value) : value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {help && <span className="set-help">{help}</span>}
    </label>
  );
}
