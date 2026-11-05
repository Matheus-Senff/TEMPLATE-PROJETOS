import { and, count, desc, eq, isNull, lt, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/index.js";
import { notifications, type Notification } from "../db/schema.js";
import { decodeCursor, toPage } from "../lib/pagination.js";
import { isSafePath } from "../lib/redirect.js";
import { notifyUser } from "./realtime.service.js";

export type NotificationType = "info" | "success" | "warning" | "error";

export type NotifyInput = {
  type?: NotificationType;
  title: string;
  body?: string;
  /** Relative path inside the app (e.g. `/dashboard/pedidos/123`). */
  link?: string;
};

/** Event name on the user's private Ably channel (`user:<id>`). The web bell listens to it. */
export const NOTIFICATION_EVENT = "notification";

/**
 * Stores a notification and pushes it in real time (Ably) when enabled.
 * Call from services and jobs whenever something the user cares about happens.
 */
export async function notify(userId: string, input: NotifyInput): Promise<Notification> {
  if (input.link && !isSafePath(input.link)) throw new Error("notify(): link must be a relative path");
  const [row] = await db
    .insert(notifications)
    .values({ userId, type: input.type ?? "info", title: input.title, body: input.body, link: input.link })
    .returning();
  if (!row) throw new Error("notify(): insert returned no row");
  await notifyUser(userId, NOTIFICATION_EVENT, row).catch(() => {});
  return row;
}

/** Page of notifications plus the unread count, in one round-trip from the client. */
export async function listNotifications(userId: string, options: { limit: number; cursor?: string; unread?: boolean }) {
  const after = options.cursor ? decodeCursor(options.cursor) : null;
  const rowsQuery = db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, userId),
      options.unread ? isNull(notifications.readAt) : undefined,
      after
        ? or(
            lt(notifications.createdAt, after.createdAt),
            and(eq(notifications.createdAt, after.createdAt), lt(notifications.id, after.id)),
          )
        : undefined,
    ),
    orderBy: [desc(notifications.createdAt), desc(notifications.id)],
    limit: options.limit + 1,
  });
  const [rows, unread] = await Promise.all([rowsQuery, unreadCount(userId)]);
  return { ...toPage(rows, options.limit), unreadCount: unread };
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.value ?? 0;
}

/** Marks one notification as read. 404 when it does not exist or belongs to someone else. */
export async function markRead(userId: string, id: string): Promise<void> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });
  if (updated.length === 0) throw new HTTPException(404, { message: "Notificação não encontrada." });
}

export async function markAllRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
