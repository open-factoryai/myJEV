import { useCallback, useEffect, useState } from "react";
import { fetchHealth, fetchServerConfig, type ServerConfigResponse } from "../lib/api";
import { DEFAULT_CONFIG, PROVIDERS, type AppConfig, type BackendMode } from "../lib/types";
import { readJSON, writeJSON } from "../lib/storage";

const CONFIG_KEY = "myjev-config-v2";

/** Relative luminance of a #rrggbb colour (0 = black, 1 = white). */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const DARK_INK = "#06201d";
const LIGHT_INK = "#ffffff";

/** WCAG contrast ratio between two colours. */
function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Ink colour for text on a filled accent surface (Run button, toasts).
 * Picks whichever of dark/light ink actually contrasts more, so mid-tone
 * accents the user picks in Settings stay legible instead of washing out.
 */
function accentInk(accent: string): string {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) return LIGHT_INK;
  const bg = luminance(accent);
  return contrast(bg, luminance(DARK_INK)) >= contrast(bg, luminance(LIGHT_INK)) ? DARK_INK : LIGHT_INK;
}

function sanitize(raw: Partial<AppConfig> | null): AppConfig {
  const base: AppConfig = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  base.temperature = Number.isFinite(base.temperature) ? base.temperature : 0;
  base.softmaxTemperature = Number.isFinite(base.softmaxTemperature) ? base.softmaxTemperature : 1;
  base.concurrency = Math.max(1, Math.min(64, Math.floor(base.concurrency || 8)));
  base.timeoutMs = Math.max(1000, Math.min(600000, Math.floor(base.timeoutMs || 60000)));
  base.retries = Math.max(0, Math.min(8, Math.floor(base.retries || 0)));
  if (!["dark", "light"].includes(base.theme)) base.theme = "dark";
  if (!["comfortable", "compact"].includes(base.density)) base.density = "comfortable";
  if (!["parallel", "oneshot", "decider", "mock"].includes(base.mode)) base.mode = "parallel";
  return base;
}

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(() => sanitize(readJSON<Partial<AppConfig>>(CONFIG_KEY, DEFAULT_CONFIG)));
  const [serverConfig, setServerConfig] = useState<ServerConfigResponse | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [deciderReachable, setDeciderReachable] = useState<boolean | null>(null);

  useEffect(() => {
    writeJSON(CONFIG_KEY, config);
    const root = document.documentElement;
    root.dataset.theme = config.theme;
    root.dataset.density = config.density;
    root.style.setProperty("--accent", config.accent || DEFAULT_CONFIG.accent);
    root.style.setProperty("--accent-contrast", accentInk(config.accent || DEFAULT_CONFIG.accent));
  }, [config]);

  const patch = useCallback((p: Partial<AppConfig>) => setConfig((prev) => sanitize({ ...prev, ...p })), []);

  const reset = useCallback(() => {
    setConfig(sanitize(serverDefaults(serverConfig)));
  }, [serverConfig]);

  // Pull server defaults once, so the UI reflects .env / docker-compose configuration.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetchServerConfig();
        if (cancelled) return;
        setServerConfig(cfg);
        setServerOnline(true);
        setDeciderReachable(cfg.probe?.decider?.ok ?? null);
        setConfig((prev) => {
          const stored = readJSON<Partial<AppConfig> | null>(CONFIG_KEY, null);
          if (stored && (stored.model || stored.mode)) return sanitize({ ...serverDefaults(cfg), ...prev });
          return sanitize(serverDefaults(cfg));
        });
      } catch {
        if (!cancelled) setServerOnline(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // light-weight health poll (also gives the decider dot in the header a live signal)
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const h = await fetchHealth();
        if (cancelled) return;
        setServerOnline(true);
        setServerConfig(h);
        setDeciderReachable(h.probe?.decider?.ok ?? null);
      } catch {
        if (!cancelled) setServerOnline(false);
      }
    };
    const t = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const applyProvider = useCallback(
    (providerId: string) => {
      const preset = PROVIDERS.find((p) => p.id === providerId);
      if (!preset) return;
      if (preset.id === "custom") {
        patch({ provider: "custom" });
        return;
      }
      const next: Partial<AppConfig> = { provider: preset.id, baseUrl: preset.baseUrl };
      if (preset.models[0]) next.model = preset.models[0];
      if (preset.id === "mock") next.mode = "mock";
      else if (config.mode === "mock") next.mode = "parallel";
      patch(next);
    },
    [patch, config.mode]
  );

  const setMode = useCallback(
    (mode: BackendMode) => {
      const next: Partial<AppConfig> = { mode };
      if (mode === "mock") next.provider = "mock";
      else if (config.provider === "mock") {
        next.provider = "openai";
        next.baseUrl = "https://api.openai.com/v1";
        next.model = "gpt-4o-mini";
      }
      patch(next);
    },
    [patch, config.provider]
  );

  return {
    config,
    patch,
    reset,
    applyProvider,
    setMode,
    serverConfig,
    serverOnline,
    deciderReachable,
    refreshServerConfig: async () => {
      try {
        const cfg = await fetchServerConfig();
        setServerConfig(cfg);
        setServerOnline(true);
        return cfg;
      } catch {
        setServerOnline(false);
        return null;
      }
    },
  };
}

function serverDefaults(cfg: ServerConfigResponse | null): Partial<AppConfig> {
  if (!cfg) return {};
  const out: Partial<AppConfig> = {};
  const mode = cfg.defaults.mode;
  if (mode === "parallel" || mode === "oneshot" || mode === "decider" || mode === "mock") out.mode = mode;
  if (cfg.defaults.model) out.model = cfg.defaults.model;
  if (cfg.defaults.base_url) out.baseUrl = cfg.defaults.base_url;
  if (cfg.decider?.url) out.deciderUrl = cfg.decider.url;
  if (typeof cfg.defaults.temperature === "number") out.temperature = cfg.defaults.temperature;
  if (typeof cfg.defaults.softmax_temperature === "number") out.softmaxTemperature = cfg.defaults.softmax_temperature;
  if (typeof cfg.defaults.concurrency === "number") out.concurrency = cfg.defaults.concurrency;
  if (typeof cfg.defaults.timeout_ms === "number") out.timeoutMs = cfg.defaults.timeout_ms;
  if (typeof cfg.defaults.retries === "number") out.retries = cfg.defaults.retries;
  return out;
}
