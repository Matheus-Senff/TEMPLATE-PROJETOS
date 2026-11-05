import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

neonConfig.webSocketConstructor ??= ws;

/** Drizzle over Neon's HTTP driver: one round-trip per query, ideal for reads and single writes. */
export const db = drizzle({ client: neon(env.DATABASE_URL), schema, casing: "snake_case" });

export type Database = typeof db;
export type Tx = Parameters<Parameters<NeonDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * Interactive transaction (all or nothing) over a short-lived WebSocket pool, created and closed per call
 * as Neon recommends for serverless. Use it whenever several writes must succeed together
 * (order + items + stock, payment + access). Keep external calls (Stripe, e-mail) outside the callback.
 */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    return await drizzlePool({ client: pool, schema, casing: "snake_case" }).transaction(fn);
  } finally {
    await pool.end();
  }
}

export { schema };
