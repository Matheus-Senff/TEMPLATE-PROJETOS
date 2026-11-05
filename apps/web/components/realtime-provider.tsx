"use client";

import { useAuth } from "@clerk/nextjs";
import type * as Ably from "ably";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";

export type RealtimeStatus = "idle" | "disabled" | Ably.ConnectionState;
type Handler = (message: Ably.InboundMessage) => void;
type RealtimeContextValue = {
  status: RealtimeStatus;
  subscribe: (event: string | null, handler: Handler) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * One Ably connection per signed-in user, shared by the whole app (bell, cards, pages).
 * The SDK is loaded only after sign-in; status "disabled" when the API has no ABLY_API_KEY.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { userId, getToken } = useAuth();
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const handlers = useRef(new Set<{ event: string | null; handler: Handler }>());

  useEffect(() => {
    if (!userId) return;
    let client: Ably.Realtime | undefined;
    let cancelled = false;
    let disabled = false;

    void import("ably").then(({ Realtime }) => {
      if (cancelled) return;
      client = new Realtime({
        authCallback: async (_params, callback) => {
          try {
            const res = await fetch(`${API_URL}/realtime/token`, {
              headers: { Authorization: `Bearer ${(await getToken()) ?? ""}` },
            });
            if (res.status === 503) {
              disabled = true;
              setStatus("disabled");
              queueMicrotask(() => client?.close());
              throw new Error("Ably desativado na API");
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            callback(null, await res.text());
          } catch (error) {
            callback(error instanceof Error ? error.message : String(error), null);
          }
        },
      });
      client.connection.on((change) => !disabled && setStatus(change.current));
      void client.channels.get(`user:${userId}`).subscribe((message) => {
        handlers.current.forEach((h) => (h.event === null || h.event === message.name) && h.handler(message));
      });
    });

    return () => {
      cancelled = true;
      client?.close();
    };
  }, [userId, getToken]);

  const value: RealtimeContextValue = {
    status: userId ? status : "idle",
    subscribe: (event, handler) => {
      const entry = { event, handler };
      handlers.current.add(entry);
      return () => handlers.current.delete(entry);
    },
  };

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime() must be used inside <RealtimeProvider>");
  return ctx;
}

/** Runs `handler` for messages on the user's channel (`event` null = every message). */
export function useRealtimeEvent(event: string | null, handler: Handler): void {
  const { subscribe } = useRealtime();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => subscribe(event, (message) => latest.current(message)), [subscribe, event]);
}
