"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ToastType = "info" | "success" | "warning" | "error";
export type ToastInput = { type?: ToastType; title: string; body?: string | null; duration?: number };
type Toast = ToastInput & { id: string };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

const tone: Record<ToastType, string> = {
  info: "border-neutral-300 dark:border-neutral-700",
  success: "border-green-500",
  warning: "border-amber-500",
  error: "border-red-500",
};

/** Wrap the app once (layout). Then `const toast = useToast(); toast({ type: "success", title: "Salvo" })`. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      setToasts((list) => [...list.slice(-3), { ...input, id }]);
      setTimeout(() => dismiss(id), input.duration ?? (input.type === "error" ? 8000 : 5000));
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed top-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            className={`pointer-events-auto rounded-lg border-l-4 bg-white p-3 text-sm shadow-lg dark:bg-neutral-900 ${tone[t.type ?? "info"]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{t.title}</p>
                {t.body && <p className="mt-0.5 text-neutral-600 dark:text-neutral-400">{t.body}</p>}
              </div>
              <button
                aria-label="Fechar"
                className="text-neutral-400 hover:text-neutral-700"
                onClick={() => dismiss(t.id)}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (toast: ToastInput) => void {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast() must be used inside <ToastProvider>");
  return toast;
}
