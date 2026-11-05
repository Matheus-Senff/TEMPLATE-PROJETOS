/**
 * Applies the Drizzle migrations (apps/api/drizzle). Runs in the API's Vercel build (`vercel-build`), so a
 * failed migration fails the build and the previous deployment keeps serving; code never goes live before its
 * migrations. Migrations must be expand/contract compatible: the old version keeps serving while (and right
 * after) they run.
 *
 * Which database:
 * - MIGRATE_DATABASE_URL set: that URL, anywhere (CI fresh Postgres, manual fallback workflow).
 * - VERCEL_ENV=production: DATABASE_URL_UNPOOLED (Neon-Vercel integration) / POSTGRES_URL_NON_POOLING, or the
 *   direct host derived from DATABASE_URL (Neon "-pooler" removed). If PRODUCTION_DATABASE_HOST is set, the
 *   URL must point to it.
 * - VERCEL_ENV=preview: only with MIGRATE_PREVIEW=true and PRODUCTION_DATABASE_HOST set to prove the preview
 *   database (its own Neon branch) is NOT production. Never touches production from a preview.
 * - Anything else (local `npm run build`, CI build): skipped. Locally use `npm run db:migrate` (dev branch).
 *
 * Drizzle applies all pending migrations in ONE transaction: locks taken by an early migration (e.g. a column
 * type change rewriting a table under ACCESS EXCLUSIVE) are held until the last one commits. Keep slow
 * rewrites of big tables in a deploy of their own, at a quiet hour, and rehearse them on a Neon branch first.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Neon pooled host (`ep-x-pooler.region...`) -> direct host (`ep-x.region...`). */
export function directUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.replace("-pooler.", ".");
  return parsed.toString();
}

const hostOf = (url: string) => new URL(url).hostname.replace("-pooler.", ".");

export type MigrationTarget = { url: string; reason: string } | { skip: string };

/** Decides where (and whether) to migrate. Pure: exported for tests. */
export function resolveTarget(env: NodeJS.ProcessEnv): MigrationTarget {
  if (env.MIGRATE_DATABASE_URL) return { url: env.MIGRATE_DATABASE_URL, reason: "MIGRATE_DATABASE_URL" };

  const productionHost = env.PRODUCTION_DATABASE_HOST?.trim();
  const candidate =
    env.DATABASE_URL_UNPOOLED ?? env.POSTGRES_URL_NON_POOLING ?? (env.DATABASE_URL && directUrl(env.DATABASE_URL));

  if (env.VERCEL_ENV === "production") {
    if (!candidate) throw new Error("Production build without DATABASE_URL_UNPOOLED/DATABASE_URL: cannot migrate.");
    if (productionHost && hostOf(candidate) !== productionHost) {
      throw new Error(`Production build points to ${hostOf(candidate)}, not PRODUCTION_DATABASE_HOST.`);
    }
    return { url: candidate, reason: "production build" };
  }
  if (env.VERCEL_ENV === "preview") {
    if (env.MIGRATE_PREVIEW !== "true")
      return { skip: "preview build (set MIGRATE_PREVIEW=true to migrate its branch)" };
    if (!productionHost)
      return { skip: "preview build without PRODUCTION_DATABASE_HOST (cannot prove it is not prod)" };
    if (!candidate) return { skip: "preview build without a database URL" };
    if (hostOf(candidate) === productionHost) {
      throw new Error("Preview build is configured with the PRODUCTION database. Refusing to migrate.");
    }
    return { url: candidate, reason: "preview branch database" };
  }
  return { skip: "not a Vercel build (use `npm run db:migrate` against your Neon dev branch)" };
}

/** Same key for every migrator (Vercel builds, the manual CI job): they run one at a time. */
export const MIGRATION_LOCK_KEY = 726_310_042;

type LockConnection = { query: (sql: string) => Promise<unknown>; release: () => void };

/**
 * Holds a session-level advisory lock on a dedicated connection while `run` migrates on other connections of
 * the pool. Two builds (or a build and the manual job) deploying at once serialize: the second waits, then
 * finds nothing left to apply. Needs a direct (unpooled) connection: PgBouncer transaction mode would drop it.
 */
export async function withMigrationLock<T>(connect: () => Promise<LockConnection>, run: () => Promise<T>): Promise<T> {
  const connection = await connect();
  try {
    await connection.query(`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    try {
      return await run();
    } finally {
      await connection.query(`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`).catch(() => {});
    }
  } finally {
    connection.release();
  }
}

async function migrateNeon(url: string) {
  const [{ Pool, neonConfig }, { drizzle }, { migrate }, { default: ws }] = await Promise.all([
    import("@neondatabase/serverless"),
    import("drizzle-orm/neon-serverless"),
    import("drizzle-orm/neon-serverless/migrator"),
    import("ws"),
  ]);
  neonConfig.webSocketConstructor ??= ws;
  const pool = new Pool({ connectionString: url });
  try {
    await withMigrationLock(
      () => pool.connect(),
      () => migrate(drizzle({ client: pool }), { migrationsFolder }),
    );
  } finally {
    await pool.end();
  }
}

/** Plain Postgres (CI service container, self-hosted): `pg` (devDependency) over TCP. */
async function migratePostgres(url: string) {
  const [{ default: pg }, { drizzle }, { migrate }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
    import("drizzle-orm/node-postgres/migrator"),
  ]);
  const pool = new pg.Pool({ connectionString: url });
  try {
    await withMigrationLock(
      () => pool.connect(),
      () => migrate(drizzle({ client: pool }), { migrationsFolder }),
    );
  } finally {
    await pool.end();
  }
}

async function main() {
  const target = resolveTarget(process.env);
  if ("skip" in target) {
    console.info(`[migrate] skipped: ${target.skip}`);
    return;
  }
  const host = new URL(target.url).hostname;
  console.info(`[migrate] applying migrations to ${host} (${target.reason})`);
  if (host.endsWith(".neon.tech")) await migrateNeon(target.url);
  else await migratePostgres(target.url);
  console.info("[migrate] done");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error("[migrate] FAILED: the build stops here, the current deployment keeps serving.", error);
    process.exit(1);
  });
}
