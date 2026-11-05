import { and, isNotNull, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLogs, notifications, webhookEvents } from "../db/schema.js";
import { cleanupStaleUploads } from "./upload.service.js";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Retention windows (LGPD: keep only what is needed). Audit rows are kept (accountability), but their IP
 * address is erased after `auditIpDays` (Marco Civil requires 6 months of access logs). The /privacidade page
 * states these numbers: keep them in sync.
 */
export const retention = { webhookEventsDays: 90, readNotificationsDays: 180, auditIpDays: 180 } as const;

export type RetentionResult = {
  webhookEvents: number;
  notifications: number;
  auditIps: number;
  staleUploads: number;
};

/**
 * Runs daily from Vercel Cron (GET /cron/retention, see vercel.json) or a QStash schedule
 * (`schedule("cleanup-old-records", "0 7 * * *", {})`). Idempotent.
 */
export async function cleanupOldRecords(now = new Date()): Promise<RetentionResult> {
  const before = (days: number) => new Date(now.getTime() - days * DAY);
  const [events, oldNotifications, ips] = await Promise.all([
    db
      .delete(webhookEvents)
      .where(lt(webhookEvents.createdAt, before(retention.webhookEventsDays)))
      .returning({ id: webhookEvents.id }),
    db
      .delete(notifications)
      .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, before(retention.readNotificationsDays))))
      .returning({ id: notifications.id }),
    db
      .update(auditLogs)
      .set({ ip: null })
      .where(and(isNotNull(auditLogs.ip), lt(auditLogs.createdAt, before(retention.auditIpDays))))
      .returning({ id: auditLogs.id }),
  ]);
  const staleUploads = await cleanupStaleUploads(now);
  return {
    webhookEvents: events.length,
    notifications: oldNotifications.length,
    auditIps: ips.length,
    staleUploads,
  };
}
