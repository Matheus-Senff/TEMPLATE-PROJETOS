import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { webhookEvents } from "../db/schema.js";

/** A claim without processed_at older than this is treated as a crashed attempt and retried. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

/**
 * Runs `handler` at most once per (source, id): providers retry and may deliver an event twice.
 * The id is claimed first; if the handler fails, the claim is released so the retry runs it again.
 * If a previous attempt died mid-way (timeout), its stale claim is taken over on the next delivery.
 */
export async function processOnce(
  source: string,
  id: string,
  type: string,
  handler: () => Promise<void>,
): Promise<{ duplicate: boolean }> {
  const byId = and(eq(webhookEvents.id, id), eq(webhookEvents.source, source));
  const claimed = await db
    .insert(webhookEvents)
    .values({ id, source, type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (claimed.length === 0) {
    const stale = await db
      .update(webhookEvents)
      .set({ createdAt: new Date() })
      .where(
        and(
          byId,
          isNull(webhookEvents.processedAt),
          lt(webhookEvents.createdAt, new Date(Date.now() - STALE_CLAIM_MS)),
        ),
      )
      .returning({ id: webhookEvents.id });
    if (stale.length === 0) return { duplicate: true };
  }
  try {
    await handler();
  } catch (error) {
    await db.delete(webhookEvents).where(byId);
    throw error;
  }
  await db.update(webhookEvents).set({ processedAt: new Date() }).where(byId);
  return { duplicate: false };
}
