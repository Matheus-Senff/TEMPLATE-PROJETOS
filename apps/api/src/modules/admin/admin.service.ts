import { HTTPException } from "hono/http-exception";
import { clerkClient } from "../../config/clerk.js";
import { audit } from "../../services/audit.service.js";
import { notify } from "../../services/notification.service.js";
import { ensureUser } from "../../services/user.service.js";
import type { AdminRole } from "./admin.schemas.js";

export const ADMIN_PAGE_SIZE = 20;

/** Users straight from Clerk (source of truth for identity and the platform role in publicMetadata.role). */
export async function listUsers(page: number, q?: string) {
  const { data, totalCount } = await clerkClient.users.getUserList({
    limit: ADMIN_PAGE_SIZE,
    offset: page * ADMIN_PAGE_SIZE,
    orderBy: "-created_at",
    ...(q && { query: q }),
  });
  return {
    total: totalCount,
    pageSize: ADMIN_PAGE_SIZE,
    users: data.map((user) => ({
      id: user.id,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      email: user.primaryEmailAddress?.emailAddress ?? null,
      role: (user.publicMetadata.role === "admin" ? "admin" : "member") as AdminRole,
      createdAt: new Date(user.createdAt).toISOString(),
      lastSignInAt: user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : null,
    })),
  };
}

/**
 * Changes the platform role (publicMetadata.role, read by requireRole through the session token).
 * Takes effect on the user's next token refresh (about a minute). An admin cannot change their own role.
 */
export async function setUserRole(actorId: string, userId: string, role: AdminRole, ip?: string): Promise<void> {
  if (actorId === userId) throw new HTTPException(400, { message: "Você não pode alterar o próprio papel." });
  await clerkClient.users.updateUserMetadata(userId, { publicMetadata: { role } });
  await audit({ actorId, action: "user.role_changed", entity: "user", entityId: userId, metadata: { role }, ip });
  // The target may never have used the API (no local row yet): create it before the FK'd notification.
  await ensureUser(userId);
  await notify(userId, {
    type: "info",
    title: role === "admin" ? "Você agora é administrador" : "Seu acesso de administrador foi removido",
  });
}
