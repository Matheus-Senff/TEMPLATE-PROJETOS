import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { clerkClient } from "../config/clerk.js";
import { db } from "../db/index.js";
import { auditLogs, billingCustomers, files, notifications, subscriptions, users, type User } from "../db/schema.js";
import { audit } from "./audit.service.js";
import { enqueue } from "./jobs.service.js";

/**
 * Per-instance cache of user ids known to have a local row, so `ensureUser()` (called by `requireAuth` on every
 * authenticated request) costs one query per user per instance every few minutes, not one per request.
 */
const KNOWN_TTL_MS = 10 * 60 * 1000;
const KNOWN_MAX = 10_000;
const knownUsers = new Map<string, number>();

function remember(userId: string): void {
  if (knownUsers.size >= KNOWN_MAX) knownUsers.delete(knownUsers.keys().next().value!);
  knownUsers.set(userId, Date.now() + KNOWN_TTL_MS);
}

/** Users Clerk answered 404 for (deleted, token still valid for a few seconds): no Clerk call per request. */
const GONE_TTL_MS = 60 * 1000;
const goneUsers = new Map<string, number>();
/** One in-flight creation per user: a burst of first requests makes one Clerk call, not one each. */
const inflight = new Map<string, Promise<void>>();

/** Drops the cache entries (after the user is erased). */
export const forgetUser = (userId: string): boolean => {
  goneUsers.delete(userId);
  return knownUsers.delete(userId);
};

/**
 * Welcome e-mail only for accounts created recently. Without the Clerk webhook, rows are created lazily on
 * the first request, which for an existing project (or a database restore) can be a user from years ago.
 */
export const WELCOME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type NewUserInput = {
  id: string;
  email: string | null;
  name: string | null;
  /** When the account was created in Clerk (ms or Date). Unknown = treated as old (no welcome e-mail). */
  createdAt: number | Date | null;
};

const isRecent = (createdAt: number | Date | null, now = Date.now()) =>
  createdAt !== null && now - new Date(createdAt).getTime() < WELCOME_MAX_AGE_MS;

/**
 * Inserts the local row. Race-safe: ON CONFLICT DO NOTHING means exactly one caller (Clerk webhook
 * `user.created` or the first authenticated request, whichever comes first) creates it, and only that
 * caller enqueues the welcome e-mail (if the account is new). Returns true when this call created the row.
 */
export async function createUserRow(input: NewUserInput): Promise<boolean> {
  const [created] = await db
    .insert(users)
    .values({ id: input.id, email: input.email })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (!created) return false;
  if (input.email && isRecent(input.createdAt)) {
    try {
      // Awaited (no fire-and-forget: serverless may freeze the function right after the response).
      await enqueue(
        "send-welcome-email",
        { userId: input.id, email: input.email, name: input.name },
        { deduplicationId: `welcome-${input.id}` },
      );
    } catch (error) {
      // The row exists either way; with QStash the job is retried, inline it is only logged (Sentry).
      console.error(`welcome e-mail for ${input.id} failed`, error);
    }
  }
  return true;
}

const clerkStatus = (error: unknown) => (error as { status?: number }).status;

/**
 * Guarantees the local `users` row exists (FKs from files, notifications, subscriptions...). Called by
 * `requireAuth`, so every signed-in request has it, even without the Clerk webhook. Creates it from Clerk
 * on first sight; a user already deleted in Clerk (token still valid for a few seconds) gets 401 and is
 * not resurrected.
 */
export async function ensureUser(userId: string): Promise<void> {
  const until = knownUsers.get(userId);
  if (until !== undefined && until > Date.now()) return;
  const goneUntil = goneUsers.get(userId);
  if (goneUntil !== undefined && goneUntil > Date.now()) throw accountNotFound();

  let pending = inflight.get(userId);
  if (!pending) {
    pending = loadOrCreate(userId).finally(() => inflight.delete(userId));
    inflight.set(userId, pending);
  }
  await pending;
}

const accountNotFound = () => new HTTPException(401, { message: "Conta não encontrada." });

async function loadOrCreate(userId: string): Promise<void> {
  const existing = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true } });
  if (!existing) {
    const clerkUser = await clerkClient.users.getUser(userId).catch((error: unknown) => {
      if (clerkStatus(error) === 404) {
        goneUsers.set(userId, Date.now() + GONE_TTL_MS);
        throw accountNotFound();
      }
      throw error;
    });
    await createUserRow({
      id: userId,
      email: clerkUser.primaryEmailAddress?.emailAddress ?? null,
      name: clerkUser.firstName,
      createdAt: clerkUser.createdAt,
    });
  }
  remember(userId);
}

/** The local user row (created from Clerk if needed). */
export async function getOrCreateUser(userId: string): Promise<User> {
  await ensureUser(userId);
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) throw new Error(`User ${userId} vanished`);
  return row;
}

/**
 * Webhook `user.created`: creates the row (welcome e-mail if this call created it) or refreshes the e-mail.
 * Checks Clerk first, so a late or retried `user.created` arriving after `user.deleted` cannot resurrect it.
 */
export async function upsertUser(userId: string, email: string | null, name: string | null = null): Promise<void> {
  const clerkUser = await clerkClient.users.getUser(userId).catch((error: unknown) => {
    if (clerkStatus(error) === 404) return null;
    throw error;
  });
  if (!clerkUser) return;
  const created = await createUserRow({ id: userId, email, name, createdAt: clerkUser.createdAt });
  if (!created) await updateUserEmail(userId, email);
  remember(userId);
}

/**
 * Webhook `user.updated`: update only, never insert. A late or retried `user.updated` delivered after
 * `user.deleted` must not bring an erased user back.
 */
export async function updateUserEmail(userId: string, email: string | null): Promise<void> {
  await db.update(users).set({ email }).where(eq(users.id, userId));
}

/** Stripe customers owned by a user (`billing_customers`). */
async function stripeCustomersOf(userId: string): Promise<string[]> {
  const customers = await db.query.billingCustomers.findMany({
    where: eq(billingCustomers.userId, userId),
    columns: { stripeCustomerId: true },
  });
  return customers.map((customer) => customer.stripeCustomerId);
}

/**
 * Erases a user: Stripe (subscriptions canceled, customer deleted), R2 objects in batches, the user row
 * (files, notifications, subscriptions and billing rows cascade) and, LAST, the Clerk account. If any step
 * fails, the job throws and is retried while the login still exists. Idempotent: every step tolerates being
 * repeated (an already deleted Clerk user, e.g. from the `user.deleted` webhook, is fine).
 * Audit rows are kept (accountability) but anonymized.
 * Organization-owned billing (BILLING_OWNER=org) is not touched: it belongs to the organization.
 */
export async function deleteUserData(userId: string): Promise<{ files: number }> {
  const customers = await stripeCustomersOf(userId);
  if (customers.length > 0) {
    const { deleteStripeCustomer } = await import("./billing.service.js");
    for (const customerId of customers) await deleteStripeCustomer(customerId);
  }

  const owned = await db.query.files.findMany({ where: eq(files.ownerId, userId), columns: { key: true } });
  // Throws before the row is deleted, so the job retries and no object is orphaned.
  const { deleteObjects } = await import("./storage.service.js");
  await deleteObjects(owned.map((file) => file.key));

  await db.delete(users).where(eq(users.id, userId));
  forgetUser(userId);
  await db.update(auditLogs).set({ actorId: null, ip: null }).where(eq(auditLogs.actorId, userId));
  await audit({
    actorId: null,
    action: "user.data_deleted",
    entity: "user",
    entityId: userId,
    metadata: { files: owned.length, stripeCustomers: customers.length },
  });
  await clerkClient.users.deleteUser(userId).catch((error: unknown) => {
    if (clerkStatus(error) !== 404) throw error;
  });
  return { files: owned.length };
}

/**
 * Everything stored about the user (LGPD data portability). Every new user-owned table must be added here
 * (and covered by the erasure above).
 */
export async function exportUserData(userId: string) {
  const [user, userFiles, userNotifications, userSubscriptions, customers, logs] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.files.findMany({ where: eq(files.ownerId, userId) }),
    db.query.notifications.findMany({ where: eq(notifications.userId, userId) }),
    db.query.subscriptions.findMany({ where: eq(subscriptions.userId, userId) }),
    db.query.billingCustomers.findMany({ where: eq(billingCustomers.userId, userId) }),
    db.query.auditLogs.findMany({ where: eq(auditLogs.actorId, userId) }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    user: user ?? null,
    files: userFiles,
    notifications: userNotifications,
    billing: { customers, subscriptions: userSubscriptions },
    activity: logs,
  };
}
