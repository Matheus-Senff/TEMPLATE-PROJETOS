import { db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/** Appends to `audit_logs`. Never throws: auditing must not break the request. No personal data in metadata. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
    });
  } catch (error) {
    console.warn(`audit: failed to record "${entry.action}"`, error);
  }
}
