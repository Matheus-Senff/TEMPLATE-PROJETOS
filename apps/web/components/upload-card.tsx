"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "@/lib/query-keys";
import { unwrap, useApi } from "@/lib/api";
import { buttonClass, Card, Status } from "./card";
import { FilesList } from "./files-list";
import { useToast } from "./toast";

/**
 * Presign on the API, PUT the file straight to R2 (it never passes through the API), then confirm so the API
 * checks the object and marks it ready (only confirmed files are listed and count as stored).
 */
export function UploadCard() {
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "muted" | "error" | "ok" } | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setStatus({ text: "Gerando URL assinada...", tone: "muted" });
    try {
      const contentType = file.type || "application/octet-stream";
      const presign = await unwrap(
        await api.uploads.presign.$post({ json: { fileName: file.name, contentType, size: file.size } }),
      );

      setStatus({ text: "Enviando para o R2...", tone: "muted" });
      const put = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!put.ok) throw new Error(`R2 respondeu ${put.status} (confira o CORS do bucket)`);

      setStatus({ text: "Confirmando...", tone: "muted" });
      await unwrap(await api.uploads[":id"].confirm.$post({ param: { id: presign.id } }));
      setStatus({ text: `Enviado: ${file.name}`, tone: "ok" });
      toast({ type: "success", title: "Arquivo enviado", body: file.name });
      void queryClient.invalidateQueries({ queryKey: queryKeys.files.all });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ text: message, tone: "error" });
      toast({ type: "error", title: "Falha no envio", body: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Arquivos (Cloudflare R2)">
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
      <button className={buttonClass} disabled={!file || busy} onClick={upload}>
        Enviar
      </button>
      <Status text={status?.text ?? null} tone={status?.tone} />
      <FilesList />
    </Card>
  );
}
