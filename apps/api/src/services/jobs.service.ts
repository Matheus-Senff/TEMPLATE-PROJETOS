import { z } from "zod";
import { getQStash, upstashConfig } from "../config/upstash.js";
import { contactSchema } from "../modules/contact/contact.schemas.js";
import { emailTemplates, sendEmail } from "./email.service.js";

/**
 * Background jobs. Each job has a zod payload schema and a handler.
 * With QStash configured, `enqueue()` publishes to QStash, which calls POST /jobs/<name>
 * (signed, with automatic retries). Without it, the handler runs inline.
 */
export const jobs = {
  "send-welcome-email": {
    schema: z.object({ userId: z.string(), email: z.string().email(), name: z.string().nullable() }),
    handler: async ({ userId, email, name }: { userId: string; email: string; name: string | null }) => {
      await sendEmail({ to: email, ...emailTemplates.welcome(name), idempotencyKey: `welcome-${userId}` });
    },
  },
  "delete-user-data": {
    schema: z.object({ userId: z.string().min(1) }),
    handler: async ({ userId }: { userId: string }) => {
      const { deleteUserData } = await import("./user.service.js");
      await deleteUserData(userId);
    },
  },
  "send-contact-email": {
    schema: contactSchema.extend({ id: z.string().uuid() }),
    handler: async (input: z.infer<typeof contactSchema> & { id: string }) => {
      const { deliverContactMessage } = await import("../modules/contact/contact.service.js");
      await deliverContactMessage(input);
    },
  },
  /** Retention: schedule once with `schedule("cleanup-old-records", "0 4 * * *", {})`. */
  "cleanup-old-records": {
    schema: z.object({}),
    handler: async () => {
      const { cleanupOldRecords } = await import("./retention.service.js");
      await cleanupOldRecords();
    },
  },
} as const;

export type JobName = keyof typeof jobs;
export type JobPayload<N extends JobName> = z.infer<(typeof jobs)[N]["schema"]>;

export type EnqueueOptions = {
  /** Delay before running, in seconds. */
  delay?: number;
  /** QStash retries on failure (default 3). */
  retries?: number;
  /** Deduplicates identical jobs within QStash's window. */
  deduplicationId?: string;
};

export async function runJob<N extends JobName>(name: N, payload: unknown): Promise<void> {
  const job = jobs[name];
  const handler = job.handler as (payload: JobPayload<N>) => Promise<void>;
  await handler(job.schema.parse(payload) as JobPayload<N>);
}

export async function enqueue<N extends JobName>(name: N, payload: JobPayload<N>, options: EnqueueOptions = {}) {
  const qstash = upstashConfig.queueEnabled ? await getQStash() : null;
  if (!qstash || !upstashConfig.apiPublicUrl) {
    await runJob(name, payload);
    return { messageId: null, inline: true };
  }
  const result = await qstash.publishJSON({
    url: `${upstashConfig.apiPublicUrl.replace(/\/+$/, "")}/jobs/${name}`,
    body: payload,
    ...(options.delay !== undefined && { delay: options.delay }),
    ...(options.retries !== undefined && { retries: options.retries }),
    ...(options.deduplicationId && { deduplicationId: options.deduplicationId }),
  });
  return { messageId: result.messageId, inline: false };
}

/** Recurring job (cron in UTC), e.g. `schedule("send-report", "0 11 * * *", {...})`. Requires QStash. */
export async function schedule<N extends JobName>(name: N, cron: string, payload: JobPayload<N>) {
  const qstash = await getQStash();
  if (!qstash || !upstashConfig.apiPublicUrl) throw new Error("QStash is not configured");
  return qstash.schedules.create({
    destination: `${upstashConfig.apiPublicUrl.replace(/\/+$/, "")}/jobs/${name}`,
    cron,
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
}
