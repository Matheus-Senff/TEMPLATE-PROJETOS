import { isNull, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Every timestamp column uses millisecond precision (Postgres defaults to microseconds). A JS Date only has
 * milliseconds, so with microseconds a `(created_at, id)` pagination cursor could skip rows created within the
 * same millisecond. Always use `timestampMs()` (test/schema.test.ts fails otherwise).
 */
export const timestampMs = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

const timestamps = {
  createdAt: timestampMs("created_at").notNull().defaultNow(),
  updatedAt: timestampMs("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Local mirror of Clerk users (id = Clerk user id). Every FK to users.id is ON UPDATE CASCADE: if the auth
 * provider ever changes, ids are remapped with one `UPDATE users SET id = ...` (see CLAUDE.md, "Sair do Clerk").
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  ...timestamps,
});

/**
 * Upload lifecycle: `pending` from presign until the browser confirms the PUT (the API checks the object with
 * HeadObject), then `ready`. Only ready files are listed or downloadable; stale pending rows and their objects
 * are removed by the retention job.
 */
export const fileStatus = ["pending", "ready"] as const;
export type FileStatus = (typeof fileStatus)[number];

/** Metadata of objects uploaded to R2. */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    key: text("key").notNull().unique(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }),
    status: text("status", { enum: fileStatus }).notNull().default("ready"),
    ...timestamps,
  },
  (table) => [
    index("files_owner_id_idx").on(table.ownerId, table.createdAt, table.id),
    index("files_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);

/** Webhook events already handled (Stripe retries and may deliver the same event more than once). */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    type: text("type").notNull(),
    createdAt: timestampMs("created_at").notNull().defaultNow(),
    /** Null while a delivery is being handled; a stale null claim (crash/timeout) is retried by processOnce(). */
    processedAt: timestampMs("processed_at"),
  },
  (table) => [index("webhook_events_created_at_idx").on(table.createdAt)],
);

/** In-app notifications (bell + toast). Create with `notify()`; delivered in real time through Ably when enabled. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    type: text("type").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestampMs("read_at"),
    createdAt: timestampMs("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("notifications_user_id_idx").on(table.userId, table.createdAt, table.id),
    index("notifications_unread_idx").on(table.userId).where(isNull(table.readAt)),
  ],
);

/** Who did what (LGPD, support, incident investigation). Write with `audit()`; never update or delete rows. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestampMs("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_actor_id_idx").on(table.actorId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entity, table.entityId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Billing owner columns: exactly one of `userId` (B2C, default) or `orgId` (B2B, Clerk organization) is set.
 * Which one is used comes from BILLING_OWNER (see src/lib/billing-owner.ts), so moving to org billing is config.
 */
const billingOwnerColumns = {
  userId: text("user_id").references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
  orgId: text("org_id"),
};

/** Stripe customer of each billing owner (one per user or org). */
export const billingCustomers = pgTable(
  "billing_customers",
  {
    stripeCustomerId: text("stripe_customer_id").primaryKey(),
    ...billingOwnerColumns,
    createdAt: timestampMs("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_customers_user_id_idx").on(table.userId),
    uniqueIndex("billing_customers_org_id_idx").on(table.orgId),
    check("billing_customers_one_owner", sql`(${table.userId} is null) <> (${table.orgId} is null)`),
  ],
);

/**
 * Local copy of Stripe subscriptions, written only from Stripe data (webhooks re-fetch the subscription, so
 * event order does not matter). Read it for access checks (`getEntitlement`, `requirePlan`), never Stripe.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    /** Stripe subscription id (sub_...). */
    id: text("id").primaryKey(),
    ...billingOwnerColumns,
    stripeCustomerId: text("stripe_customer_id").notNull(),
    /** Stripe status: active, trialing, past_due, unpaid, canceled, incomplete, incomplete_expired, paused. */
    status: text("status").notNull(),
    priceId: text("price_id"),
    quantity: integer("quantity"),
    currentPeriodEnd: timestampMs("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestampMs("canceled_at"),
    trialEnd: timestampMs("trial_end"),
    ...timestamps,
  },
  (table) => [
    index("subscriptions_user_id_idx").on(table.userId),
    index("subscriptions_org_id_idx").on(table.orgId),
    index("subscriptions_customer_idx").on(table.stripeCustomerId),
    check("subscriptions_one_owner", sql`(${table.userId} is null) <> (${table.orgId} is null)`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
