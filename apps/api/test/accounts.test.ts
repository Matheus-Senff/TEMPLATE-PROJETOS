import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock("../src/db/index.js");
  vi.doUnmock("../src/services/user.service.js");
  vi.doUnmock("../src/services/webhook.service.js");
  vi.doUnmock("../src/services/storage.service.js");
  vi.doUnmock("../src/services/audit.service.js");
  vi.doUnmock("../src/services/billing.service.js");
  vi.doUnmock("../src/config/clerk.js");
});

const SECRET_BYTES = Buffer.from("clerk-webhook-test-secret");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function signedRequest(payload: unknown, secretBytes = SECRET_BYTES): Request {
  const body = JSON.stringify(payload);
  const id = "msg_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("http://localhost/clerk", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
  });
}

describe("Clerk webhook", () => {
  const setup = async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SECRET);
    const upsertUser = vi.fn(async () => {});
    const updateUserEmail = vi.fn(async () => {});
    vi.doMock("../src/services/webhook.service.js", () => ({
      processOnce: async (_s: string, _id: string, _t: string, handler: () => Promise<void>) => {
        await handler();
        return { duplicate: false };
      },
    }));
    vi.doMock("../src/services/user.service.js", () => ({
      upsertUser,
      updateUserEmail,
      getOrCreateUser: vi.fn(),
      exportUserData: vi.fn(),
    }));
    const { webhooksRoutes } = await import("../src/routes/webhooks.js");
    return { app: webhooksRoutes, upsertUser, updateUserEmail };
  };

  const userPayload = {
    id: "user_1",
    primary_email_address_id: "e2",
    email_addresses: [
      { id: "e1", email_address: "old@x.com" },
      { id: "e2", email_address: "new@x.com" },
    ],
  };

  it("rejects an invalid signature with 400", async () => {
    const { app } = await setup();
    const res = await app.request(signedRequest({ type: "user.updated", data: {} }, Buffer.from("wrong")));
    expect(res.status).toBe(400);
  });

  it("user.updated only updates the primary e-mail (never inserts, so it cannot resurrect a deleted user)", async () => {
    const { app, upsertUser, updateUserEmail } = await setup();
    const res = await app.request(signedRequest({ type: "user.updated", object: "event", data: userPayload }));
    expect(res.status).toBe(200);
    expect(updateUserEmail).toHaveBeenCalledWith("user_1", "new@x.com");
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it("user.created creates the local row", async () => {
    const { app, upsertUser, updateUserEmail } = await setup();
    const res = await app.request(signedRequest({ type: "user.created", object: "event", data: userPayload }));
    expect(res.status).toBe(200);
    expect(upsertUser).toHaveBeenCalledWith("user_1", "new@x.com", null);
    expect(updateUserEmail).not.toHaveBeenCalled();
  });
});

describe("deleteUserData", () => {
  const steps: string[] = [];
  const mockClerk = (deleteUser = vi.fn(async () => void steps.push("clerk"))) => {
    vi.doMock("../src/config/clerk.js", () => ({ clerkClient: { users: { deleteUser } } }));
    return deleteUser;
  };

  const mockDb = (customers: string[], keys: string[]) => {
    steps.length = 0;
    mockClerk();
    const deletedTables: unknown[] = [];
    const updated = vi.fn(() => ({ where: async () => {} }));
    vi.doMock("../src/db/index.js", () => ({
      db: {
        query: {
          billingCustomers: { findMany: async () => customers.map((stripeCustomerId) => ({ stripeCustomerId })) },
          files: { findMany: async () => keys.map((key) => ({ key })) },
        },
        delete: (table: unknown) => ({ where: async () => (steps.push("db"), deletedTables.push(table)) }),
        update: () => ({ set: updated }),
      },
    }));
    return { deletedTables, updated };
  };

  it("deletes R2 objects in one batch call, the user row and anonymizes audit logs", async () => {
    const deleteObjects = vi.fn(async (keys: string[]) => ({ deleted: keys.length }));
    vi.doMock("../src/services/storage.service.js", () => ({ deleteObjects }));
    vi.doMock("../src/services/audit.service.js", () => ({ audit: vi.fn(async () => {}) }));
    const { deletedTables, updated } = mockDb([], ["users/u1/a.pdf", "users/u1/b.png"]);
    const { deleteUserData } = await import("../src/services/user.service.js");
    const { users } = await import("../src/db/schema.js");

    await expect(deleteUserData("u1")).resolves.toEqual({ files: 2 });
    expect(deleteObjects).toHaveBeenCalledExactlyOnceWith(["users/u1/a.pdf", "users/u1/b.png"]);
    expect(deletedTables).toEqual([users]);
    expect(updated).toHaveBeenCalledWith({ actorId: null, ip: null });
    expect(steps).toEqual(["db", "clerk"]); // the login goes last
  });

  it("an already deleted Clerk user (user.deleted webhook) does not fail the erasure", async () => {
    vi.doMock("../src/services/storage.service.js", () => ({ deleteObjects: vi.fn(async () => ({ deleted: 0 })) }));
    vi.doMock("../src/services/audit.service.js", () => ({ audit: vi.fn(async () => {}) }));
    mockDb([], []);
    mockClerk(vi.fn(async () => Promise.reject(Object.assign(new Error("not found"), { status: 404 }))));
    const { deleteUserData } = await import("../src/services/user.service.js");
    await expect(deleteUserData("u1")).resolves.toEqual({ files: 0 });
  });

  it("keeps the Clerk login when R2 fails, so the erasure can be retried", async () => {
    vi.doMock("../src/services/storage.service.js", () => ({
      deleteObjects: vi.fn(async () => Promise.reject(new Error("r2 down"))),
    }));
    vi.doMock("../src/services/audit.service.js", () => ({ audit: vi.fn() }));
    mockDb([], ["k"]);
    const { deleteUserData } = await import("../src/services/user.service.js");
    await expect(deleteUserData("u1")).rejects.toThrow("r2 down");
    expect(steps).toEqual([]);
  });

  it("cancels Stripe subscriptions and deletes the customer before erasing the row", async () => {
    const deleteStripeCustomer = vi.fn(async () => ({ canceled: 1 }));
    vi.doMock("../src/services/billing.service.js", () => ({ deleteStripeCustomer }));
    vi.doMock("../src/services/storage.service.js", () => ({ deleteObjects: vi.fn(async () => ({ deleted: 0 })) }));
    vi.doMock("../src/services/audit.service.js", () => ({ audit: vi.fn(async () => {}) }));
    const { deletedTables } = mockDb(["cus_1"], []);
    const { deleteUserData } = await import("../src/services/user.service.js");

    await deleteUserData("u1");
    expect(deleteStripeCustomer).toHaveBeenCalledWith("cus_1");
    expect(deletedTables).toHaveLength(1);
  });

  it("keeps the user row when an object fails to delete, so the job retries", async () => {
    vi.doMock("../src/services/storage.service.js", () => ({
      deleteObjects: vi.fn(async () => Promise.reject(new Error("Failed to delete 1 of 1 objects"))),
    }));
    vi.doMock("../src/services/audit.service.js", () => ({ audit: vi.fn() }));
    const { deletedTables } = mockDb([], ["k"]);
    const { deleteUserData } = await import("../src/services/user.service.js");
    await expect(deleteUserData("u1")).rejects.toThrow("Failed to delete 1 of 1");
    expect(deletedTables).toEqual([]);
  });
});

describe("deleteStripeCustomer", () => {
  const withStripe = async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getStripe } = await import("../src/config/stripe.js");
    return (await getStripe())!;
  };

  it("cancels live subscriptions, skips finished ones and deletes the customer", async () => {
    const stripe = await withStripe();
    const subscriptions = [
      { id: "sub_live", status: "active" },
      { id: "sub_old", status: "canceled" },
      { id: "sub_due", status: "past_due" },
    ];
    vi.spyOn(stripe.subscriptions, "list").mockReturnValue(
      (async function* () {
        yield* subscriptions;
      })() as never,
    );
    const cancel = vi.spyOn(stripe.subscriptions, "cancel").mockResolvedValue({} as never);
    const del = vi.spyOn(stripe.customers, "del").mockResolvedValue({} as never);
    const { deleteStripeCustomer } = await import("../src/services/billing.service.js");

    await expect(deleteStripeCustomer("cus_1")).resolves.toEqual({ canceled: 2 });
    expect(cancel.mock.calls.map((call) => call[0])).toEqual(["sub_live", "sub_due"]);
    expect(del).toHaveBeenCalledWith("cus_1");
  });

  it("treats an already deleted customer as done", async () => {
    const stripe = await withStripe();
    vi.spyOn(stripe.subscriptions, "list").mockImplementation(() => {
      throw Object.assign(new Error("No such customer"), { code: "resource_missing" });
    });
    const { deleteStripeCustomer } = await import("../src/services/billing.service.js");
    await expect(deleteStripeCustomer("cus_gone")).resolves.toEqual({ canceled: 0 });
  });

  it("refuses to erase a paying customer while Stripe is disabled", async () => {
    const { deleteStripeCustomer } = await import("../src/services/billing.service.js");
    await expect(deleteStripeCustomer("cus_1")).rejects.toThrow("Stripe is disabled");
  });
});

describe("roles", () => {
  it("reads the platform role only from public metadata, defaulting to member", async () => {
    const { roleFromClaims } = await import("../src/middlewares/auth.js");
    expect(roleFromClaims({ metadata: { role: "admin" } })).toBe("admin");
    expect(roleFromClaims({ metadata: { role: "owner" } })).toBe("member");
    expect(roleFromClaims({ org_role: "org:admin" })).toBe("member");
    expect(roleFromClaims(null)).toBe("member");
  });
});

describe("cursor pagination", () => {
  it("round-trips the cursor and returns the next page marker only when there are more rows", async () => {
    const { decodeCursor, encodeCursor, toPage } = await import("../src/lib/pagination.js");
    const ids = ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000002"];
    const rows = [3, 2, 1].map((n) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      createdAt: new Date(Date.UTC(2026, 0, n)),
    }));

    const first = toPage(rows, 2);
    expect(first.items).toHaveLength(2);
    expect(decodeCursor(first.nextCursor!)).toEqual({ id: ids[1], createdAt: rows[1]!.createdAt });
    expect(toPage(rows, 3).nextCursor).toBeNull();
    expect(decodeCursor(encodeCursor(rows[0]!)).id).toBe(ids[0]);
    expect(() => decodeCursor("lixo")).toThrow();
  });
});
