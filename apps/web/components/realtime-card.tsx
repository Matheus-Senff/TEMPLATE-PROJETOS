"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { Card, Status } from "./card";
import { useRealtime, useRealtimeEvent } from "./realtime-provider";

type Notice = { id: string; name: string; data: string };

/** Shows messages on the user's private channel `user:<userId>` (shared connection from RealtimeProvider). */
export function RealtimeCard() {
  const { userId } = useAuth();
  const { status } = useRealtime();
  const [notices, setNotices] = useState<Notice[]>([]);

  useRealtimeEvent(null, (message) => {
    setNotices((prev) =>
      [
        { id: message.id ?? crypto.randomUUID(), name: message.name ?? "", data: JSON.stringify(message.data) },
        ...prev,
      ].slice(0, 10),
    );
  });

  const label = status === "disabled" ? "desativado (sem ABLY_API_KEY na API)" : status;
  return (
    <Card title="Tempo real (Ably)">
      <Status
        text={`Conexão: ${label}`}
        tone={status === "connected" ? "ok" : status === "failed" ? "error" : "muted"}
      />
      {notices.length === 0 ? (
        <Status text={`Nenhuma mensagem ainda. Publique no canal user:${userId ?? "<id>"}.`} />
      ) : (
        <ul className="space-y-1 text-sm">
          {notices.map((n) => (
            <li key={n.id}>
              <span className="font-medium">{n.name}</span> {n.data}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
