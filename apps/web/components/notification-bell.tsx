"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { unwrap, useApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { isSafePath } from "@/lib/redirect";
import { useRealtime, useRealtimeEvent } from "./realtime-provider";
import { useToast, type ToastType } from "./toast";

type Item = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

const POLL_MS = 60_000;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * Bell + dropdown for the signed-in user. Real time through the shared Ably connection (`notify()` on the API);
 * polls every minute only when Ably is disabled and the tab is visible. New notifications also show a toast.
 */
export function NotificationBell() {
  const api = useApi();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useRealtime();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);

  const { data, isError, isPending, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: async () => unwrap(await api.notifications.$get({ query: { limit: "10" } })),
    refetchInterval: status === "connected" ? false : POLL_MS,
    refetchIntervalInBackground: false,
  });
  const items = (data?.items ?? []) as Item[];
  const unread = data?.unreadCount ?? 0;

  useEffect(() => {
    if (!data) return;
    const list = data.items as Item[];
    const ids = new Set(list.map((i) => i.id));
    if (seen.current) {
      const fresh = list.find((i) => !seen.current?.has(i.id) && !i.readAt);
      if (fresh) toast({ type: fresh.type as ToastType, title: fresh.title, body: fresh.body });
    }
    seen.current = ids;
  }, [data, toast]);

  useRealtimeEvent("notification", () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => unwrap(await api.notifications[":id"].read.$post({ param: { id } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
  const readAll = useMutation({
    mutationFn: async () => unwrap(await api.notifications["read-all"].$post()),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openItem(item: Item) {
    if (!item.readAt) markRead.mutate(item.id);
    if (isSafePath(item.link)) {
      setOpen(false);
      router.push(item.link);
    }
  }

  return (
    <div className="relative" ref={panel}>
      <button
        aria-label={unread > 0 ? `Notificações: ${unread} não lidas` : "Notificações"}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative rounded-md p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-800"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <p className="text-sm font-semibold">Notificações</p>
            {unread > 0 && (
              <button className="text-xs text-neutral-500 hover:underline" onClick={() => readAll.mutate()}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          {isError && items.length === 0 ? (
            <div className="space-y-2 px-3 py-6 text-center text-sm" role="alert">
              <p className="text-red-600">Não foi possível carregar as notificações.</p>
              <button
                className="text-neutral-600 underline disabled:opacity-50"
                disabled={isRefetching}
                onClick={() => refetch()}
              >
                Tentar de novo
              </button>
            </div>
          ) : isPending ? (
            <p className="px-3 py-6 text-center text-sm text-neutral-500">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-neutral-500">Nenhuma notificação.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    className="flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    onClick={() => openItem(item)}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-transparent" : "bg-blue-600"}`}
                    />
                    <span className="min-w-0">
                      <span className={`block ${item.readAt ? "" : "font-medium"}`}>{item.title}</span>
                      {item.body && <span className="block text-neutral-600 dark:text-neutral-400">{item.body}</span>}
                      <span className="block text-xs text-neutral-400">
                        {dateFormat.format(new Date(item.createdAt))}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
