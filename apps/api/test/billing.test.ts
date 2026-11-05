import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWith, json } from "./helpers/auth.js";
import { createTestDb } from "./helpers/pglite.js";

const testDb = await createTestDb();
vi.doMock("../src/db/index.js", () => testDb.module);
const schema = await import("../src/db/schema.js");
const { db } = testDb;

const notify = vi.fn(async () => ({}));
vi.doMock("../src/services/notification.service.js", () => ({ notify }));

beforeEach(async () => {
  await testDb.reset();
  notify.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  await db.insert(schema.users).values({ id: "u1", email: "u1@x.com" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});
afterAll(() => testDb.close());

type SessionFields = {
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  payment_status?: string;
  subscription?: string | null;
};

const checkoutEvent = (type: string, fields: SessionFields = {}) =>
  ({
    id: `evt_${Math.random()}`,
    type,
    data: {
      object: {
        id: "cs_1",
        mode: "payment",
        payment_status: "paid",
        client_reference_id: "u1",
        metadata: { ownerType: "user", ownerId: "u1", actorId: "u1" },
        subscription: null,
        ...fields,
      },
    },
  }) as never;

const stripeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  canceled_at: null,
  trial_end: null,
  metadata: {},
  items: { data: [{ price: { id: "price_pro" }, quantity: 1, current_period_end: 1_900_000_000 }] },
  ...overrides,
});

/** Loads the billing service with Stripe "enabled" (no network: every call used is spied). */
async function withStripe(env: Record<string, string> = {}) {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const { getStripe } = await import("../src/config/stripe.js");
  const stripe = (await getStripe())!;
  const service = await import("../src/services/billing.service.js");
  return { stripe, service };
}

const userOwner = { type: "user", id: "u1" } as const;

describe("checkout webhook (Postgres real)", () => {
  it.each(["checkout.session.completed", "checkout.session.async_payment_succeeded"])(
    "confirms on %s when paid and the session was created by the API",
    async (type) => {
      const { handleStripeEvent } = await import("../src/services/billing.service.js");
      await handleStripeEvent(checkoutEvent(type));
      expect(notify).toHaveBeenCalledWith("u1", expect.objectContaining({ type: "success" }));
      expect(await db.query.auditLogs.findFirst()).toMatchObject({ action: "checkout.paid", actorId: "u1" });
    },
  );

  it("does not confirm a boleto checkout before the money arrives", async () => {
    const { handleStripeEvent } = await import("../src/services/billing.service.js");
    await handleStripeEvent(checkoutEvent("checkout.session.completed", { payment_status: "unpaid" }));
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores a Payment Link with a forged client_reference_id (no server-side metadata)", async () => {
    const { handleStripeEvent } = await import("../src/services/billing.service.js");
    await handleStripeEvent(checkoutEvent("checkout.session.completed", { metadata: {} }));
    await handleStripeEvent(checkoutEvent("checkout.session.completed", { metadata: { ownerId: "someone-else" } }));
    expect(notify).not.toHaveBeenCalled();
    expect(await db.query.auditLogs.findMany()).toEqual([]);
  });

  it("skips (without failing, so Stripe does not retry for days) when the user was deleted", async () => {
    const { handleStripeEvent } = await import("../src/services/billing.service.js");
    const ghost = { client_reference_id: "u_gone", metadata: { ownerId: "u_gone" } };
    await expect(handleStripeEvent(checkoutEvent("checkout.session.completed", ghost))).resolves.toBeUndefined();
    await expect(
      handleStripeEvent(checkoutEvent("checkout.session.async_payment_failed", ghost)),
    ).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores a checkout whose line items use a price outside STRIPE_PRICE_IDS", async () => {
    const { stripe, service } = await withStripe({ STRIPE_PRICE_IDS: "price_ok" });
    const listLineItems = vi
      .spyOn(stripe.checkout.sessions, "listLineItems")
      .mockResolvedValueOnce({ data: [{ price: { id: "price_cheap" } }] } as never)
      .mockResolvedValueOnce({ data: [{ price: { id: "price_ok" } }] } as never);

    await service.handleStripeEvent(checkoutEvent("checkout.session.completed"));
    expect(notify).not.toHaveBeenCalled();
    await service.handleStripeEvent(checkoutEvent("checkout.session.completed"));
    expect(notify).toHaveBeenCalledOnce();
    expect(listLineItems).toHaveBeenCalledTimes(2);
  });

  it("warns the user when the asynchronous payment fails", async () => {
    const { handleStripeEvent } = await import("../src/services/billing.service.js");
    await handleStripeEvent(checkoutEvent("checkout.session.async_payment_failed", { payment_status: "unpaid" }));
    expect(notify).toHaveBeenCalledWith("u1", expect.objectContaining({ type: "error" }));
  });
});

describe("subscriptions: persistence and entitlement (Postgres real)", () => {
  beforeEach(() => db.insert(schema.billingCustomers).values({ stripeCustomerId: "cus_1", userId: "u1" }));

  it("checkout of a subscription stores its state from Stripe and grants access", async () => {
    const { stripe, service } = await withStripe();
    const retrieve = vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription() as never);
    await service.handleStripeEvent(
      checkoutEvent("checkout.session.completed", { subscription: "sub_1", payment_status: "paid" }),
    );
    expect(retrieve).toHaveBeenCalledWith("sub_1");
    const row = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, "sub_1") });
    expect(row).toMatchObject({ userId: "u1", status: "active", priceId: "price_pro", stripeCustomerId: "cus_1" });
    expect(row?.currentPeriodEnd?.getTime()).toBe(1_900_000_000_000);
    expect(await service.hasActiveSubscription(userOwner)).toBe(true);
    expect(await service.hasActiveSubscription(userOwner, { priceIds: ["price_other"] })).toBe(false);
  });

  it("re-fetches on every subscription event, so a stale event cannot overwrite the current state", async () => {
    const { stripe, service } = await withStripe();
    const current = vi.spyOn(stripe.subscriptions, "retrieve");
    // Stripe already says "canceled"; a late "updated" event with an old "active" payload arrives afterwards.
    current.mockResolvedValue(stripeSubscription({ status: "canceled", canceled_at: 1_800_000_000 }) as never);
    const stale = { id: "evt_old", type: "customer.subscription.updated", data: { object: stripeSubscription() } };
    await service.handleStripeEvent(stale as never);
    const entitlement = await service.getEntitlement(userOwner);
    expect(entitlement).toMatchObject({ active: false, status: "canceled" });
  });

  it("customer.subscription.deleted revokes access and notifies the owner", async () => {
    const { stripe, service } = await withStripe();
    const retrieve = vi.spyOn(stripe.subscriptions, "retrieve");
    retrieve.mockResolvedValueOnce(stripeSubscription() as never);
    await service.syncSubscription("sub_1");
    expect(await service.hasActiveSubscription(userOwner)).toBe(true);

    retrieve.mockResolvedValueOnce(stripeSubscription({ status: "canceled" }) as never);
    await service.handleStripeEvent({
      id: "evt_del",
      type: "customer.subscription.deleted",
      data: { object: stripeSubscription({ status: "canceled" }) },
    } as never);
    expect(await service.hasActiveSubscription(userOwner)).toBe(false);
    expect(notify).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "Assinatura encerrada" }));
  });

  it("past_due keeps access during dunning; unpaid does not", async () => {
    const { stripe, service } = await withStripe();
    const retrieve = vi.spyOn(stripe.subscriptions, "retrieve");
    retrieve.mockResolvedValueOnce(stripeSubscription({ status: "past_due" }) as never);
    await service.syncSubscription("sub_1");
    expect(await service.hasActiveSubscription(userOwner)).toBe(true);
    retrieve.mockResolvedValueOnce(stripeSubscription({ status: "unpaid" }) as never);
    await service.syncSubscription("sub_1");
    expect(await service.hasActiveSubscription(userOwner)).toBe(false);
  });

  it("ignores subscriptions of unknown customers and of erased users", async () => {
    const { stripe, service } = await withStripe();
    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValueOnce(
      stripeSubscription({ customer: "cus_unknown" }) as never,
    );
    await expect(service.syncSubscription("sub_x")).resolves.toBeNull();
    expect(await db.query.subscriptions.findMany()).toEqual([]);
  });

  it("requirePlan() answers 402 without an entitled subscription and lets subscribers through", async () => {
    const { Hono } = await import("hono");
    const { stripe } = await withStripe();
    const { requirePlan } = await import("../src/middlewares/plan.js");
    const { requireAuth } = await import("../src/middlewares/auth.js");
    const routes = new Hono().get("/report", requireAuth, requirePlan(), (c) => c.json({ ok: true }));
    const app = appWith("/paid", routes, { userId: "u1" });

    expect((await app.request("/paid/report")).status).toBe(402);
    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription() as never);
    const { syncSubscription } = await import("../src/services/billing.service.js");
    await syncSubscription("sub_1");
    expect((await app.request("/paid/report")).status).toBe(200);
  });
});

describe("checkout creation", () => {
  const routes = async () => {
    const { billingRoutes } = await import("../src/routes/billing.js");
    return appWith("/stripe", billingRoutes, { userId: "u1" });
  };

  it("sets server-side owner metadata and creates the customer once, with an idempotency key", async () => {
    const { stripe } = await withStripe();
    const createCustomer = vi.spyOn(stripe.customers, "create").mockResolvedValue({ id: "cus_new" } as never);
    vi.spyOn(stripe.subscriptions, "list").mockResolvedValue({ data: [] } as never);
    vi.spyOn(stripe.checkout.sessions, "list").mockResolvedValue({ data: [] } as never);
    const createSession = vi
      .spyOn(stripe.checkout.sessions, "create")
      .mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/x" } as never);
    const app = await routes();

    const res = await app.request("/stripe/checkout", json({ priceId: "price_1", mode: "subscription" }));
    expect(res.status).toBe(201);
    const metadata = { ownerType: "user", ownerId: "u1", actorId: "u1" };
    expect(createCustomer).toHaveBeenCalledWith(expect.objectContaining({ metadata }), {
      idempotencyKey: "customer-create-user-u1",
    });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ client_reference_id: "u1", metadata, subscription_data: { metadata } }),
    );
    // Second checkout reuses the stored customer.
    await app.request("/stripe/checkout", json({ priceId: "price_1", mode: "subscription" }));
    expect(createCustomer).toHaveBeenCalledOnce();
    expect(await db.query.billingCustomers.findFirst()).toMatchObject({ stripeCustomerId: "cus_new", userId: "u1" });
  });

  it("refuses a second subscription (409) when Stripe already has a live one", async () => {
    const { stripe } = await withStripe();
    await db.insert(schema.billingCustomers).values({ stripeCustomerId: "cus_1", userId: "u1" });
    vi.spyOn(stripe.subscriptions, "list").mockResolvedValue({ data: [{ id: "sub_1", status: "trialing" }] } as never);
    const createSession = vi.spyOn(stripe.checkout.sessions, "create");
    const res = await (await routes()).request("/stripe/checkout", json({ priceId: "price_1" }));
    expect(res.status).toBe(409);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("reuses an open Checkout session for the same price instead of creating another", async () => {
    const { stripe } = await withStripe();
    await db.insert(schema.billingCustomers).values({ stripeCustomerId: "cus_1", userId: "u1" });
    vi.spyOn(stripe.subscriptions, "list").mockResolvedValue({
      data: [{ id: "sub_old", status: "canceled" }],
    } as never);
    vi.spyOn(stripe.checkout.sessions, "list").mockResolvedValue({
      data: [
        {
          id: "cs_open",
          mode: "subscription",
          url: "https://checkout.stripe.com/open",
          line_items: { data: [{ price: { id: "price_1" }, quantity: 1 }] },
        },
      ],
    } as never);
    const createSession = vi.spyOn(stripe.checkout.sessions, "create");
    const res = await (await routes()).request("/stripe/checkout", json({ priceId: "price_1" }));
    expect(await res.json()).toEqual({ id: "cs_open", url: "https://checkout.stripe.com/open" });
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("success page sync (POST /stripe/checkout/sync)", () => {
  const session = (overrides: Record<string, unknown> = {}) => ({
    id: "cs_1",
    status: "complete",
    payment_status: "paid",
    mode: "subscription",
    client_reference_id: "u1",
    metadata: { ownerType: "user", ownerId: "u1" },
    subscription: "sub_1",
    ...overrides,
  });

  it("syncs the subscription right away (idempotent with the webhook) and reports it as paid", async () => {
    const { stripe } = await withStripe();
    await db.insert(schema.billingCustomers).values({ stripeCustomerId: "cus_1", userId: "u1" });
    vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(session() as never);
    vi.spyOn(stripe.subscriptions, "retrieve").mockResolvedValue(stripeSubscription() as never);
    const { billingRoutes } = await import("../src/routes/billing.js");
    const app = appWith("/stripe", billingRoutes, { userId: "u1" });

    const first = await (await app.request("/stripe/checkout/sync", json({ sessionId: "cs_1" }))).json();
    expect(first).toMatchObject({ status: "paid", entitlement: { active: true, priceId: "price_pro" } });
    await app.request("/stripe/checkout/sync", json({ sessionId: "cs_1" }));
    expect(await db.query.subscriptions.findMany()).toHaveLength(1);
  });

  it("reports processing for a boleto/Pix still unpaid, and 404 for someone else's session", async () => {
    const { stripe } = await withStripe();
    const retrieve = vi.spyOn(stripe.checkout.sessions, "retrieve");
    const { billingRoutes } = await import("../src/routes/billing.js");
    const app = appWith("/stripe", billingRoutes, { userId: "u1" });

    retrieve.mockResolvedValueOnce(session({ payment_status: "unpaid" }) as never);
    expect(await (await app.request("/stripe/checkout/sync", json({ sessionId: "cs_1" }))).json()).toMatchObject({
      status: "processing",
    });
    retrieve.mockResolvedValueOnce(
      session({ client_reference_id: "u2", metadata: { ownerType: "user", ownerId: "u2" } }) as never,
    );
    expect((await app.request("/stripe/checkout/sync", json({ sessionId: "cs_1" }))).status).toBe(404);
  });
});

describe("GET /stripe/subscription", () => {
  it("answers the plan state from the local table even with Stripe disabled", async () => {
    const { billingRoutes } = await import("../src/routes/billing.js");
    const app = appWith("/stripe", billingRoutes, { userId: "u1" });
    expect(await (await app.request("/stripe/subscription")).json()).toEqual({
      active: false,
      status: null,
      priceId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      features: [],
    });
  });

  it("with BILLING_OWNER=org the active organization is the owner", async () => {
    vi.stubEnv("BILLING_OWNER", "org");
    await db.insert(schema.subscriptions).values({
      id: "sub_org",
      orgId: "org_1",
      stripeCustomerId: "cus_org",
      status: "active",
    });
    const { billingRoutes } = await import("../src/routes/billing.js");
    const member = appWith("/stripe", billingRoutes, { userId: "u1", orgId: "org_1", orgRole: "org:member" });
    const noOrg = appWith("/stripe", billingRoutes, { userId: "u1" });
    expect(await (await member.request("/stripe/subscription")).json()).toMatchObject({ active: true });
    expect((await noOrg.request("/stripe/subscription")).status).toBe(403);
    // Only org admins manage billing.
    expect((await member.request("/stripe/portal", { method: "POST" })).status).toBe(403);
  });
});
