import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock("../src/db/index.js");
  vi.doUnmock("../src/services/realtime.service.js");
});

const row = {
  id: "n1",
  userId: "u1",
  type: "info",
  title: "Oi",
  body: null,
  link: null,
  readAt: null,
  createdAt: new Date(),
};

function mockDb(updatedRows: unknown[] = []) {
  const inserted: unknown[] = [];
  vi.doMock("../src/db/index.js", () => ({
    db: {
      insert: () => ({ values: (v: unknown) => (inserted.push(v), { returning: async () => [row] }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => updatedRows }) }) }),
    },
  }));
  return inserted;
}

describe("notify()", () => {
  it("stores the notification and pushes it to the user's channel", async () => {
    const inserted = mockDb();
    const notifyUser = vi.fn(async () => {});
    vi.doMock("../src/services/realtime.service.js", () => ({ notifyUser }));
    const { notify, NOTIFICATION_EVENT } = await import("../src/services/notification.service.js");

    await expect(notify("u1", { title: "Oi", link: "/dashboard" })).resolves.toEqual(row);
    expect(inserted[0]).toMatchObject({ userId: "u1", type: "info", title: "Oi", link: "/dashboard" });
    expect(notifyUser).toHaveBeenCalledWith("u1", NOTIFICATION_EVENT, row);
  });

  it("still stores it when realtime is disabled", async () => {
    mockDb();
    vi.doMock("../src/services/realtime.service.js", () => ({
      notifyUser: async () => Promise.reject(new Error("503")),
    }));
    const { notify } = await import("../src/services/notification.service.js");
    await expect(notify("u1", { title: "Oi" })).resolves.toEqual(row);
  });

  it("rejects absolute links (open redirect)", async () => {
    mockDb();
    const { notify } = await import("../src/services/notification.service.js");
    await expect(notify("u1", { title: "x", link: "https://evil.com" })).rejects.toThrow("relative path");
    await expect(notify("u1", { title: "x", link: "//evil.com" })).rejects.toThrow("relative path");
    await expect(notify("u1", { title: "x", link: "/\\evil.com" })).rejects.toThrow("relative path");
  });
});

describe("markRead()", () => {
  it("answers 404 when the notification is not the user's", async () => {
    mockDb([]);
    const { markRead } = await import("../src/services/notification.service.js");
    await expect(markRead("u2", "n1")).rejects.toThrow("Notificação não encontrada");
  });

  it("marks the user's own notification", async () => {
    mockDb([{ id: "n1" }]);
    const { markRead } = await import("../src/services/notification.service.js");
    await expect(markRead("u1", "n1")).resolves.toBeUndefined();
  });
});
