import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns, isTable, sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema.js";
import { tenantColumns } from "../src/lib/tenant.js";
import { appWith } from "./helpers/auth.js";
import { createTestDb } from "./helpers/pglite.js";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
/** Files allowed to name tenant tables without the helper: their definition and the helper itself. */
const EXEMPT = new Set(["db/schema.ts", "lib/tenant.ts"]);

/** Tables created with tenantColumns() (orgId NOT NULL). Billing tables have a nullable owner orgId: not tenant. */
export function tenantTableNames(module: Record<string, unknown>): string[] {
  return Object.entries(module)
    .filter(([, value]) => isTable(value))
    .filter(([, table]) => getTableColumns(table as never).orgId?.notNull === true)
    .map(([name]) => name);
}

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** A scope value: a variable (`scope.where(...)`) or an inline `tenantScope(c)` / `scopeFor(orgId)`. */
const SCOPE = String.raw`(?:\w+|tenantScope\([^)]*\)|scopeFor\([^)]*\))`;

/**
 * Per-statement check (statement = code between semicolons, comments removed): every query that touches a
 * tenant table must be filtered by `<scope>.where(<table>...)`, every insert must use
 * `.values(<scope>.values(...))`, and no update may `.set({ orgId })` (moving rows between tenants).
 * Heuristic limits (documented in CLAUDE.md): joins into a tenant table, raw `sql` and statements broken by
 * semicolons inside callbacks are not analysed; review those by hand.
 */
export function unscopedTenantUsages(files: Array<{ path: string; source: string }>, tables: string[]): string[] {
  return files.flatMap(({ path, source }) =>
    stripComments(source)
      .split(";")
      .flatMap((statement) =>
        tables.flatMap((table) => {
          const problems: string[] = [];
          const reads = new RegExp(String.raw`\.query\.${table}\.|\.(?:from|update|delete)\(\s*${table}\b`);
          const scopedWhere = new RegExp(String.raw`${SCOPE}\.where\(\s*${table}\b`);
          const inserts = new RegExp(String.raw`\.insert\(\s*${table}\b`);
          const scopedValues = new RegExp(String.raw`\.values\(\s*${SCOPE}\.values\(`);
          const movesTenant = new RegExp(String.raw`\.update\(\s*${table}\b[\s\S]*\.set\(\s*\{[^}]*\borgId\b`);
          if (reads.test(statement) && !scopedWhere.test(statement))
            problems.push(`${path}: ${table} without scope.where()`);
          if (inserts.test(statement) && !scopedValues.test(statement)) {
            problems.push(`${path}: insert into ${table} without scope.values()`);
          }
          if (movesTenant.test(statement)) problems.push(`${path}: update of ${table} sets orgId`);
          return problems;
        }),
      ),
  );
}

function sourceFiles(dir: string): Array<{ path: string; source: string }> {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    const path = relative(srcDir, full).replaceAll("\\", "/");
    return full.endsWith(".ts") && !EXEMPT.has(path) ? [{ path, source: readFileSync(full, "utf8") }] : [];
  });
}

describe("tenant scoping is hard to forget (static check over src/)", () => {
  it("every query on a table with orgId in src/ goes through tenantScope()", () => {
    expect(unscopedTenantUsages(sourceFiles(srcDir), tenantTableNames(schema))).toEqual([]);
  });

  it("the check works per statement, not per file", () => {
    const tables = ["projects"];
    const file = (path: string, source: string) => ({ path, source });
    expect(
      unscopedTenantUsages(
        [
          file("bad.ts", "const rows = await db.query.projects.findMany();"),
          // The helper used once in the file no longer whitelists the other statements.
          file(
            "mixed.ts",
            "const s = tenantScope(c); await db.query.projects.findMany({ where: s.where(projects) }); await db.delete(projects).where(eq(projects.id, id));",
          ),
          file(
            "good.ts",
            [
              "const s = tenantScope(c)",
              "await db.query.projects.findMany({ where: s.where(projects, eq(projects.archived, false)) })",
              "await db.select().from(projects).where(tenantScope(c).where(projects))",
              "await db.insert(projects).values(s.values({ name }))",
              "await db.update(projects).set({ name }).where(s.where(projects, eq(projects.id, id)))",
            ].join(";\n"),
          ),
          file("insert.ts", "await db.insert(projects).values({ name, orgId: body.orgId });"),
          file("move.ts", "await db.update(projects).set({ orgId: other }).where(s.where(projects));"),
          file("comment.ts", "// db.query.projects is listed elsewhere\nexport const x = 1;"),
        ],
        tables,
      ),
    ).toEqual([
      "bad.ts: projects without scope.where()",
      "mixed.ts: projects without scope.where()",
      "insert.ts: insert into projects without scope.values()",
      "move.ts: update of projects sets orgId",
    ]);
    const fakeSchema = { projects: pgTable("projects", { id: serial("id"), ...tenantColumns() }) };
    expect(tenantTableNames(fakeSchema)).toEqual(["projects"]);
    expect(tenantTableNames(schema)).not.toContain("subscriptions");
  });
});

describe("tenantScope() isolates organizations (Postgres real)", async () => {
  const testDb = await createTestDb();
  afterAll(() => testDb.close());
  const projects = pgTable("projects", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    ...tenantColumns(),
  });
  await testDb.db.execute(sql`create table projects (id serial primary key, name text not null, org_id text not null)`);
  const { db } = testDb;

  const { requireOrgRole } = await import("../src/middlewares/auth.js");
  const { tenantScope } = await import("../src/lib/tenant.js");
  const routes = new Hono()
    .use(requireOrgRole())
    .post("/", async (c) => {
      const body = (await c.req.json()) as { name: string; orgId?: string };
      // The client cannot choose the organization: values() overrides it.
      await db.insert(projects).values(tenantScope(c).values({ name: body.name, orgId: body.orgId ?? "" }));
      return c.json({ ok: true }, 201);
    })
    .get("/", async (c) => c.json(await db.select().from(projects).where(tenantScope(c).where(projects))));

  const orgA = appWith("/projects", routes, { userId: "u1", orgId: "org_a", orgRole: "org:member" });
  const orgB = appWith("/projects", routes, { userId: "u2", orgId: "org_b", orgRole: "org:member" });
  const noOrg = appWith("/projects", routes, { userId: "u3" });
  const post = (name: string, orgId?: string) => ({
    method: "POST",
    body: JSON.stringify({ name, orgId }),
    headers: { "Content-Type": "application/json" },
  });

  it("writes are stamped with the active org and reads only see it", async () => {
    await orgA.request("/projects", post("A1"));
    await orgA.request("/projects", post("A2 forged", "org_b"));
    await orgB.request("/projects", post("B1"));
    const a = (await (await orgA.request("/projects")).json()) as Array<{ name: string; orgId: string }>;
    const b = (await (await orgB.request("/projects")).json()) as Array<{ name: string; orgId: string }>;
    expect(a.map((p) => p.name).sort()).toEqual(["A1", "A2 forged"]);
    expect(a.every((p) => p.orgId === "org_a")).toBe(true);
    expect(b.map((p) => p.name)).toEqual(["B1"]);
  });

  it("without an active organization the request is refused before any query", async () => {
    expect((await noOrg.request("/projects")).status).toBe(403);
  });
});
