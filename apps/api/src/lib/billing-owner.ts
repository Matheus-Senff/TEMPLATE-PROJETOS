import { getAuth } from "@clerk/hono";
import { eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { env } from "../config/env.js";

/**
 * Who a subscription/customer belongs to. B2C (default): the signed-in user. B2B: the active Clerk organization
 * (BILLING_OWNER=org), so every member gets the plan and moving to org billing is a config change, not a rewrite.
 */
export type BillingOwner = { type: "user"; id: string } | { type: "org"; id: string };

/**
 * Billing owner of the current request (after `requireAuth`). With BILLING_OWNER=org it requires an active
 * organization; `manage: true` (checkout, portal) also requires the org admin role.
 */
export function billingOwner(c: Context, options: { manage?: boolean } = {}): BillingOwner {
  if (env.BILLING_OWNER === "org") {
    const auth = getAuth(c);
    if (!auth?.orgId) throw new HTTPException(403, { message: "Selecione uma organização." });
    if (options.manage && auth.orgRole !== "org:admin") {
      throw new HTTPException(403, { message: "Só administradores da organização gerenciam a assinatura." });
    }
    return { type: "org", id: auth.orgId };
  }
  const userId = (c.get as (key: string) => unknown)("userId") ?? getAuth(c)?.userId;
  if (typeof userId !== "string") throw new HTTPException(401, { message: "Faça login para continuar." });
  return { type: "user", id: userId };
}

/** Values for the owner columns of `billing_customers` / `subscriptions`. */
export const ownerColumns = (owner: BillingOwner) =>
  owner.type === "user" ? { userId: owner.id, orgId: null } : { userId: null, orgId: owner.id };

/** Filter by owner: `where(byOwner(subscriptions, owner))`. */
export const byOwner = (table: { userId: PgColumn; orgId: PgColumn }, owner: BillingOwner): SQL =>
  owner.type === "user" ? eq(table.userId, owner.id) : eq(table.orgId, owner.id);

/** Metadata stamped on every Stripe object the API creates (server side only, so it can be trusted). */
export const ownerMetadata = (owner: BillingOwner, actorId: string) => ({
  ownerType: owner.type,
  ownerId: owner.id,
  actorId,
});
