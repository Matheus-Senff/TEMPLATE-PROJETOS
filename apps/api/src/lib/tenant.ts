import { and, eq, type SQL } from "drizzle-orm";
import { text, type PgColumn } from "drizzle-orm/pg-core";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Multi-tenant (SaaS with several companies) - off by default. To turn it on for a table:
 *   export const projects = pgTable("projects", { id: ..., ...tenantColumns(), ... },
 *     (t) => [index("projects_org_id_idx").on(t.orgId, t.createdAt)]);
 * Routes: `.use(requireAuth, requireOrgRole())`, then every query goes through `tenantScope(c)`:
 *   const scope = tenantScope(c);
 *   await db.query.projects.findMany({ where: scope.where(projects, eq(projects.archived, false)) });
 *   await db.insert(projects).values(scope.values({ name }));
 *   await db.update(projects).set({ name }).where(scope.where(projects, eq(projects.id, id)));
 * test/tenant.test.ts fails if a module touches a table with `orgId` without `tenantScope(`.
 * Organizations come from Clerk (enable Organizations in the Clerk dashboard). B2B tip: give every user a
 * personal organization at sign-up, so all data is org-scoped from day one (see CLAUDE.md).
 */
export const tenantColumns = () => ({ orgId: text("org_id").notNull() });

type TenantTable = { orgId: PgColumn };

/** Low-level filter (prefer `tenantScope`): combine with `and(byTenant(t, orgId), ...)`. */
export function byTenant(table: TenantTable, orgId: string): SQL {
  if (!orgId) throw new Error("byTenant(): orgId is required");
  return eq(table.orgId, orgId);
}

export type TenantScope = {
  orgId: string;
  /** `where` already filtered by the active organization, plus any extra conditions. */
  where: (table: TenantTable, ...conditions: Array<SQL | undefined>) => SQL;
  /** Insert values stamped with the active organization (overrides any orgId coming from the client). */
  values: <T extends object>(values: T) => T & { orgId: string };
};

/** Scope builder for an explicit organization id (jobs, webhooks). Routes use `tenantScope(c)`. */
export function scopeFor(orgId: string): TenantScope {
  if (!orgId) throw new Error("tenantScope(): orgId is required");
  return {
    orgId,
    where: (table, ...conditions) => and(byTenant(table, orgId), ...conditions)!,
    values: (values) => ({ ...values, orgId }),
  };
}

/**
 * Query helpers pre-filtered by the request's active Clerk organization (set by `requireOrgRole()`).
 * Throws 403 when there is none, so a tenant query can never run unscoped.
 */
export function tenantScope(c: Context): TenantScope {
  const orgId = (c.get as (key: string) => unknown)("orgId");
  if (typeof orgId !== "string" || !orgId) throw new HTTPException(403, { message: "Selecione uma organização." });
  return scopeFor(orgId);
}
