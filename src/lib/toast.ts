import { useSyncExternalStore } from "react";

export type ToastKind = "info" | "success" | "error" | "warn";
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  toasts = [...toasts];
  listeners.forEach((l) => l());
}

export const toast = {
  show(message: string, kind: ToastKind = "info", detail?: string, ttl = 4200) {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    toasts = [...toasts, { id, kind, message, detail }].slice(-5);
    emit();
    if (ttl > 0) setTimeout(() => toast.dismiss(id), ttl);
    return id;
  },
  success: (m: string, d?: string, ttl = 4200) => toast.show(m, "success", d, ttl),
  error: (m: string, d?: string, ttl = 8000) => toast.show(m, "error", d, ttl),
  warn: (m: string, d?: string, ttl = 6000) => toast.show(m, "warn", d, ttl),
  info: (m: string, d?: string, ttl = 4200) => toast.show(m, "info", d, ttl),
  dismiss(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  },
  clear() {
    toasts = [];
    emit();
  },
};

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => toasts
  );
}
