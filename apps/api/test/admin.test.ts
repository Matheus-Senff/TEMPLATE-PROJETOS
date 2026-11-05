import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock("../src/config/clerk.js");
  vi.doUnmock("../src/services/audit.service.js");
  vi.doUnmock("../src/services/notification.service.js");
  vi.doUnmock("../src/services/user.service.js");
});

const setup = async () => {
  const users = {
    getUserList: vi.fn(async () => ({
      totalCount: 1,
      data: [
        {
          id: "user_1",
          firstName: "Ana",
          lastName: "Souza",
          primaryEmailAddress: { emailAddress: "ana@x.com" },
          publicMetadata: { role: "admin" },
          createdAt: Date.UTC(2026, 0, 1),
          lastSignInAt: null,
        },
      ],
    })),
    updateUserMetadata: vi.fn(async () => ({})),
  };
  const audit = vi.fn(async () => {});
  const notify = vi.fn(async () => ({}));
  vi.doMock("../src/config/clerk.js", () => ({ clerkClient: { users } }));
  vi.doMock("../src/services/audit.service.js", () => ({ audit }));
  vi.doMock("../src/services/notification.service.js", () => ({ notify }));
  const ensureUser = vi.fn(async () => {});
  vi.doMock("../src/services/user.service.js", () => ({ ensureUser }));
  return { users, audit, notify, ensureUser, service: await import("../src/modules/admin/admin.service.js") };
};

describe("admin", () => {
  it("lists users from Clerk with their platform role", async () => {
    const { service, users } = await setup();
    const result = await service.listUsers(2, "ana");
    expect(users.getUserList).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 40, query: "ana", orderBy: "-created_at" }),
    );
    expect(result.users[0]).toMatchObject({ id: "user_1", name: "Ana Souza", email: "ana@x.com", role: "admin" });
  });

  it("changes another user's role, audits and notifies (creating the local row first)", async () => {
    const { service, users, audit, notify, ensureUser } = await setup();
    await service.setUserRole("admin_1", "user_2", "admin", "1.2.3.4");
    expect(users.updateUserMetadata).toHaveBeenCalledWith("user_2", { publicMetadata: { role: "admin" } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.role_changed", entityId: "user_2" }));
    expect(ensureUser).toHaveBeenCalledWith("user_2");
    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not swallow a failed notification", async () => {
    const { service, notify } = await setup();
    notify.mockRejectedValueOnce(new Error("db down"));
    await expect(service.setUserRole("admin_1", "user_2", "member")).rejects.toThrow("db down");
  });

  it("refuses to change the admin's own role", async () => {
    const { service, users } = await setup();
    await expect(service.setUserRole("admin_1", "admin_1", "member")).rejects.toThrow("próprio papel");
    expect(users.updateUserMetadata).not.toHaveBeenCalled();
  });
});
