import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { clerkWebhookConfig } from "../config/clerk.js";
import { enqueue } from "../services/jobs.service.js";
import { updateUserEmail, upsertUser } from "../services/user.service.js";
import { processOnce } from "../services/webhook.service.js";

type ClerkUserPayload = {
  first_name?: string | null;
  primary_email_address_id: string | null;
  email_addresses: Array<{ id: string; email_address: string }>;
};

const primaryEmail = (user: ClerkUserPayload): string | null =>
  user.email_addresses.find((address) => address.id === user.primary_email_address_id)?.email_address ?? null;

/**
 * Clerk calls this directly (signed with Svix, no session). Answers 503 while
 * CLERK_WEBHOOK_SIGNING_SECRET is not set. Subscribe to user.created, user.updated and user.deleted.
 */
export const webhooksRoutes = new Hono().post("/clerk", async (c) => {
  if (!clerkWebhookConfig.enabled) throw new HTTPException(503, { message: "Clerk webhooks are disabled" });

  const { verifyWebhook } = await import("@clerk/backend/webhooks");
  const event = await verifyWebhook(c.req.raw, { signingSecret: clerkWebhookConfig.signingSecret }).catch(() => {
    throw new HTTPException(400, { message: "Invalid webhook signature" });
  });
  const deliveryId = c.req.header("svix-id");
  if (!deliveryId) throw new HTTPException(400, { message: "Missing svix-id" });

  const { duplicate } = await processOnce("clerk", deliveryId, event.type, async () => {
    switch (event.type) {
      case "user.created": {
        // Creates the row (and sends the welcome e-mail) unless the first API request already did.
        await upsertUser(event.data.id, primaryEmail(event.data), event.data.first_name ?? null);
        break;
      }
      case "user.updated": {
        // Update only: a retried user.updated arriving after user.deleted must not recreate the row.
        await updateUserEmail(event.data.id, primaryEmail(event.data));
        break;
      }
      case "user.deleted": {
        if (event.data.id)
          await enqueue("delete-user-data", { userId: event.data.id }, { deduplicationId: `delete-${event.data.id}` });
        break;
      }
      default:
        break;
    }
  });
  return c.json({ received: true, duplicate });
});
