"use client";

import { useAuth, useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { unwrap, unwrapReverifiable, useApi } from "@/lib/api";
import { useToast } from "./toast";
import { Button } from "./ui/button";
import { Input, Select } from "./ui/input";
import { Badge, EmptyState, Skeleton } from "./ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "./ui/table";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

/** Users list with search, pagination and role change (GET/POST /admin/users). */
export function AdminUsers() {
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  const users = useQuery({
    queryKey: ["admin", "users", page, q],
    queryFn: async () => unwrap(await api.admin.users.$get({ query: { page: String(page), ...(q && { q }) } })),
    placeholderData: (previous) => previous,
  });

  // Role changes require a recent re-authentication (API requireReverification): Clerk shows its modal and retries.
  const changeRole = useReverification(async (id: string, role: "admin" | "member") =>
    unwrapReverifiable(await api.admin.users[":id"].role.$post({ param: { id }, json: { role } })),
  );
  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "admin" | "member" }) => changeRole(id, role),
    onSuccess: () => toast({ type: "success", title: "Papel atualizado", body: "Vale no próximo acesso do usuário." }),
    onError: (error) =>
      isReverificationCancelledError(error)
        ? toast({ type: "info", title: "Alteração cancelada", body: "Confirme sua identidade para alterar papéis." })
        : toast({ type: "error", title: "Não foi possível alterar", body: error.message }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  const pages = users.data ? Math.ceil(users.data.total / users.data.pageSize) : 0;

  return (
    <div className="space-y-4">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQ(search.trim());
        }}
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou e-mail"
          aria-label="Buscar usuários"
          className="max-w-xs"
        />
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>

      {users.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : users.isError ? (
        <EmptyState
          title="Não foi possível carregar"
          description={users.error.message}
          action={
            <Button size="sm" variant="secondary" onClick={() => users.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : users.data.users.length === 0 ? (
        <EmptyState title="Nenhum usuário encontrado" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Nome</TH>
              <TH>E-mail</TH>
              <TH>Criado em</TH>
              <TH>Papel</TH>
            </TR>
          </THead>
          <TBody>
            {users.data.users.map((user) => (
              <TR key={user.id}>
                <TD>
                  {user.name ?? "-"} {user.id === userId && <Badge>você</Badge>}
                </TD>
                <TD>{user.email ?? "-"}</TD>
                <TD>{dateFormat.format(new Date(user.createdAt))}</TD>
                <TD>
                  <Select
                    aria-label={`Papel de ${user.email ?? user.id}`}
                    className="h-8 w-32"
                    value={user.role}
                    disabled={user.id === userId || setRole.isPending}
                    onChange={(e) => setRole.mutate({ id: user.id, role: e.target.value as "admin" | "member" })}
                  >
                    <option value="member">Membro</option>
                    <option value="admin">Admin</option>
                  </Select>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {pages > 1 && (
        <nav className="flex items-center gap-2 text-sm" aria-label="Paginação">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span>
            Página {page + 1} de {pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </nav>
      )}
    </div>
  );
}
