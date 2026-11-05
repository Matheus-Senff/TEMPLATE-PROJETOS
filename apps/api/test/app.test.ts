import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DbModule from "../src/db/index.js";

/** The real neon-http client cannot reach a database offline: /health gets a controllable stub. */
let databaseUp = true;
const execute = vi.fn(async () => {
  if (!databaseUp) throw new Error("connection refused");
  return { rows: [{ "?column?": 1 }] };
});
vi.doMock("../src/db/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof DbModule>();
  return { ...original, db: Object.assign(Object.create(original.db), { execute }) };
});
const { app } = await import("../src/app.js");

beforeEach(() => {
  databaseUp = true;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("app", () => {
  it("GET /health answers only the status publicly, after a database round-trip", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(execute).toHaveBeenCalled();
  });

  it("GET /health answers 503 when the database is down", async () => {
    databaseUp = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error" });
  });

  it("GET /health/live does not touch the database", async () => {
    execute.mockClear();
    const res = await app.request("/health/live");
    expect(await res.json()).toEqual({ status: "ok" });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/me"],
    ["GET", "/me/export"],
    ["DELETE", "/me"],
    ["GET", "/uploads"],
    ["DELETE", "/uploads/00000000-0000-0000-0000-000000000000"],
    ["POST", "/uploads/00000000-0000-0000-0000-000000000000/confirm"],
    ["GET", "/notifications"],
    ["GET", "/notifications/unread-count"],
    ["GET", "/admin/users"],
    ["POST", "/admin/users/user_1/role"],
    ["POST", "/uploads/presign"],
    ["GET", "/uploads/00000000-0000-0000-0000-000000000000/download"],
    ["POST", "/stripe/checkout"],
    ["GET", "/realtime/token"],
  ])("%s %s requires authentication", async (method, path) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it("disabled modules answer 503", async () => {
    expect((await app.request("/stripe/webhook", { method: "POST" })).status).toBe(503);
    expect((await app.request("/jobs/send-welcome-email", { method: "POST" })).status).toBe(503);
    expect((await app.request("/webhooks/clerk", { method: "POST" })).status).toBe(503);
    expect((await app.request("/cron/retention")).status).toBe(503);
  });

  it("unknown routes answer JSON 404", async () => {
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});

describe("health details and cron (CRON_SECRET)", () => {
  const SECRET = "cron-secret-with-32-characters!!";

  const load = async () => {
    vi.resetModules();
    vi.stubEnv("CRON_SECRET", SECRET);
    const cleanupOldRecords = vi.fn(async () => ({ webhookEvents: 0, notifications: 0, auditIps: 0, staleUploads: 0 }));
    vi.doMock("../src/services/retention.service.js", () => ({ cleanupOldRecords }));
    const module = await import("../src/app.js");
    vi.doUnmock("../src/services/retention.service.js");
    return { app: module.app, cleanupOldRecords };
  };

  it("shows module details only with the bearer secret", async () => {
    const { app: secured } = await load();
    expect(await (await secured.request("/health")).json()).toEqual({ status: "ok" });
    const detailed = await (
      await secured.request("/health", { headers: { Authorization: `Bearer ${SECRET}` } })
    ).json();
    expect(detailed).toMatchObject({ status: "ok", database: true, features: { stripe: false, cron: true } });
  });

  it("runs the retention job only with the right bearer secret", async () => {
    const { app: secured, cleanupOldRecords } = await load();
    expect((await secured.request("/cron/retention")).status).toBe(401);
    expect((await secured.request("/cron/retention", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const res = await secured.request("/cron/retention", { headers: { Authorization: `Bearer ${SECRET}` } });
    expect(res.status).toBe(200);
    expect(cleanupOldRecords).toHaveBeenCalledOnce();
  });
});
