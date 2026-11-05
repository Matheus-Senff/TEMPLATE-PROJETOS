import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../src/db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const tableNames = () =>
  Object.values(schema)
    .filter((value) => typeof value === "object" && value !== null && Symbol.for("drizzle:Name") in value)
    .map((table) => (table as unknown as Record<symbol, string>)[Symbol.for("drizzle:Name")]);

async function createPgliteDb() {
  const client = new PGlite();
  const db = drizzle({ client, schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

/**
 * Real Postgres server (CI service container): a fresh database per call, every migration applied with the
 * node-postgres driver, dropped on close. Same API as PGlite, so tests do not change.
 */
async function createServerDb(serverUrl: string) {
  const [{ default: pg }, nodePg, { migrate: migratePg }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
  ]);
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  // Small pool: test files run in parallel against one server (max_connections defaults to 100).
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  // DROP DATABASE ... WITH (FORCE) terminates clients still closing (57P01); without a listener that
  // becomes an uncaught exception and fails the run even though every test passed.
  pool.on("error", (error: Error & { code?: string }) => {
    if (error.code !== "57P01") throw error;
  });
  pool.on("connect", (client) => {
    client.on("error", (error: Error & { code?: string }) => {
      if (error.code !== "57P01") throw error;
    });
  });
  const db = nodePg.drizzle({ client: pool, schema, casing: "snake_case" });
  await migratePg(db, { migrationsFolder });
  return {
    // Same query builder surface as the PGlite database for the services under test.
    db: db as unknown as Awaited<ReturnType<typeof createPgliteDb>>["db"],
    close: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

/**
 * Real Postgres with every migration applied: catches wrong SQL, constraints and indexes.
 * PGlite in memory by default; with TEST_DATABASE_URL (CI job "db") a real Postgres server.
 * Usage in a test file:
 *   const testDb = await createTestDb();
 *   vi.doMock("../src/db/index.js", () => testDb.module);
 *   beforeEach(() => testDb.reset());
 */
export async function createTestDb() {
  const serverUrl = process.env.TEST_DATABASE_URL;
  const { db, close } = serverUrl ? await createServerDb(serverUrl) : await createPgliteDb();
  const tables = tableNames();
  return {
    db,
    module: { db, schema, transaction: <T>(fn: (tx: typeof db) => Promise<T>) => db.transaction(fn) },
    reset: () => db.execute(sql.raw(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`)),
    close,
  };
}
