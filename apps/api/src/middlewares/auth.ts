import { reverificationError } from "@clerk/backend/internal";
import { clerkMiddleware, getAuth } from "@clerk/hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { clerkConfig } from "../config/clerk.js";
import { env } from "../config/env.js";
import { ensureUser } from "../services/user.service.js";

export type AuthVariables = {
  userId: string;
};

/** Origins allowed to use a session token (`azp` claim). Blocks tokens minted for other sites. */
export const authorizedParties = (): string[] => [
  ...new Set(
    [env.APP_URL, ...env.CORS_ORIGINS].filter((origin) => origin !== "*").map((origin) => origin.replace(/\/+$/, "")),
  ),
];

const partyPattern = env.AUTHORIZED_PARTY_PATTERN ? new RegExp(env.AUTHORIZED_PARTY_PATTERN) : null;

/**
 * `azp` check: the exact origins above or, for preview deployments, AUTHORIZED_PARTY_PATTERN. Same rule as
 * Clerk: a token without `azp` is not bound to an origin.
 */
export function isAuthorizedParty(azp: unknown): boolean {
  if (typeof azp !== "string" || azp === "") return true;
  const origin = azp.replace(/\/+$/, "");
  return authorizedParties().includes(origin) || Boolean(partyPattern?.test(origin));
}

/**
 * Verifies the Clerk session JWT (cookie or `Authorization: Bearer`) on every request. With
 * AUTHORIZED_PARTY_PATTERN the origin check moves to `requireAuth` (Clerk only accepts an exact list).
 */
export const clerkAuth = () =>
  clerkMiddleware({ ...clerkConfig, ...(partyPattern ? {} : { authorizedParties: authorizedParties() }) });

/**
 * Rejects unauthenticated requests and exposes `c.get("userId")` to handlers. Also guarantees the local
 * `users` row exists (cached per instance), so FKs (files, notifications, subscriptions) never fail.
 */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const auth = getAuth(c);
  if (!auth?.userId || (partyPattern && !isAuthorizedParty(auth.sessionClaims?.azp))) {
    throw new HTTPException(401, { message: "Faça login para continuar." });
  }
  await ensureUser(auth.userId);
  c.set("userId", auth.userId);
  await next();
});

export type Role = "admin" | "member";

/**
 * Platform role, only from the user's `publicMetadata.role` (set by you in Clerk, never by the user).
 * Clerk > Sessions > Customize session token: `{ "metadata": "{{user.public_metadata}}" }`. Default "member".
 * Organization roles are separate (`requireOrgRole`): any user can create an org and be its admin.
 */
export function roleFromClaims(claims: Record<string, unknown> | null | undefined): Role {
  const metadata = claims?.metadata as { role?: unknown } | undefined;
  return metadata?.role === "admin" ? "admin" : "member";
}

/** Platform admin area: `.get("/admin/x", requireAuth, requireRole("admin"), handler)`. */
export const requireRole = (...roles: Role[]) =>
  createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const role = roleFromClaims(getAuth(c)?.sessionClaims as Record<string, unknown> | undefined);
    if (!roles.includes(role)) throw new HTTPException(403, { message: "Você não tem permissão para esta ação." });
    await next();
  });

export type OrgVariables = AuthVariables & { orgId: string; orgRole: string };

/**
 * Requires an active Clerk organization and one of `roles` inside it (e.g. "org:admin", "org:member").
 * Exposes `c.get("orgId")`: filter every tenant query by it.
 */
export const requireOrgRole = (...roles: string[]) =>
  createMiddleware<{ Variables: OrgVariables }>(async (c, next) => {
    const auth = getAuth(c);
    if (!auth?.orgId || !auth.orgRole) throw new HTTPException(403, { message: "Selecione uma organização." });
    if (roles.length > 0 && !roles.includes(auth.orgRole)) {
      throw new HTTPException(403, { message: "Você não tem permissão nesta organização." });
    }
    c.set("orgId", auth.orgId);
    c.set("orgRole", auth.orgRole);
    await next();
  });

/** Clerk reverification presets: "strict" = re-entered credentials (2FA when enabled) in the last 10 minutes. */
export type ReverificationLevel = "strict" | "strict_mfa" | "moderate" | "lax";

/**
 * Irreversible actions (account deletion, role changes, payouts...): require that the user re-verified
 * recently (Clerk `fva` claim). Otherwise answers 403 with Clerk's reverification hint, which the web
 * `useReverification()` hook turns into a re-authentication modal and then retries the request.
 * Use after `requireAuth`.
 */
export const requireReverification = (level: ReverificationLevel = "strict") =>
  createMiddleware(async (c, next) => {
    const auth = getAuth(c);
    if (!auth?.has?.({ reverification: level })) return c.json(reverificationError(level), 403);
    await next();
  });
