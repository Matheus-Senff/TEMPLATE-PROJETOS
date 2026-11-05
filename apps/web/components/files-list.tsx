"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { unwrap, useApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "./toast";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { EmptyState, Skeleton } from "./ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "./ui/table";

const PAGE = 10;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const formatSize = (bytes: number | null) => (bytes === null ? "-" : `${(bytes / 1024).toFixed(0)} KB`);
const fileName = (key: string) =>
  key
    .split("/")
    .pop()
    ?.replace(/^[0-9a-f-]{36}-/, "") ?? key;

type FileItem = { id: string; key: string };

/**
 * Reference for large lists: cursor pagination (`GET /uploads`) with TanStack Query and every screen state,
 * plus a destructive action with confirmation (`DELETE /uploads/:id`).
 */
export function FilesList() {
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [toDelete, setToDelete] = useState<FileItem | null>(null);

  const query = useInfiniteQuery({
    queryKey: queryKeys.files.list(),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.uploads.$get({ query: { limit: String(PAGE), ...(pageParam && { cursor: pageParam }) } })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const remove = useMutation({
    mutationFn: async (file: FileItem) => unwrap(await api.uploads[":id"].$delete({ param: { id: file.id } })),
    onSuccess: (_data, file) => {
      toast({ type: "success", title: "Arquivo excluído", body: fileName(file.key) });
      setToDelete(null);
    },
    onError: (error) => toast({ type: "error", title: "Não foi possível excluir", body: error.message }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.files.all }),
  });

  const download = useMutation({
    mutationFn: async (file: FileItem) => unwrap(await api.uploads[":id"].download.$get({ param: { id: file.id } })),
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: (error) => toast({ type: "error", title: "Não foi possível baixar", body: error.message }),
  });

  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (query.isError)
    return (
      <EmptyState
        title="Não foi possível carregar os arquivos"
        description={query.error.message}
        action={
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );

  const files = query.data.pages.flatMap((page) => page.items);
  if (files.length === 0)
    return <EmptyState title="Nenhum arquivo ainda" description="Envie o primeiro arquivo acima." />;

  return (
    <div className="space-y-2">
      <Table>
        <THead>
          <TR>
            <TH>Arquivo</TH>
            <TH>Tipo</TH>
            <TH>Tamanho</TH>
            <TH>Enviado em</TH>
            <TH>
              <span className="sr-only">Ações</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {files.map((file) => (
            <TR key={file.id}>
              <TD className="max-w-48 truncate">{fileName(file.key)}</TD>
              <TD>{file.contentType}</TD>
              <TD>{formatSize(file.size)}</TD>
              <TD>{dateFormat.format(new Date(file.createdAt))}</TD>
              <TD className="text-right whitespace-nowrap">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Baixar ${fileName(file.key)}`}
                  loading={download.isPending && download.variables?.id === file.id}
                  onClick={() => download.mutate(file)}
                >
                  Baixar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600"
                  aria-label={`Excluir ${fileName(file.key)}`}
                  onClick={() => setToDelete(file)}
                >
                  Excluir
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {query.hasNextPage && (
        <Button variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          Carregar mais
        </Button>
      )}
      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)} title="Excluir arquivo?">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {toDelete ? `"${fileName(toDelete.key)}" será apagado definitivamente.` : null}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setToDelete(null)}>
            Cancelar
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => toDelete && remove.mutate(toDelete)}>
            Excluir
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
