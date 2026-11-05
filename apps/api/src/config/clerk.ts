import { createClerkClient } from "@clerk/backend";
import { env } from "./env.js";

export const clerkConfig = {
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  /** Networkless session verification when set (no JWKS fetch on cold start). */
  ...(env.CLERK_JWT_KEY && { jwtKey: env.CLERK_JWT_KEY }),
} as const;

export const clerkWebhookConfig = {
  enabled: Boolean(env.CLERK_WEBHOOK_SIGNING_SECRET),
  signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET,
} as const;

/** Backend API client (users, organizations, sessions...). */
export const clerkClient = createClerkClient(clerkConfig);
