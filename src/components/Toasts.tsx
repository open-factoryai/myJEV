import { toast, useToasts } from "../lib/toast";

const ICONS: Record<string, string> = {
  success: "✓",
  error: "✕",
  warn: "!",
  info: "i",
};

export function Toasts() {
  const items = useToasts();
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">{ICONS[t.kind]}</span>
          <div className="toast-body">
            <div className="toast-msg">{t.message}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
          </div>
          <button type="button" className="toast-close" onClick={() => toast.dismiss(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
