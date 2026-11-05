import type { Resend } from "resend";
import { env } from "./env.js";
import { lazy } from "./lazy.js";

export const emailConfig = {
  enabled: Boolean(env.RESEND_API_KEY),
  from: env.EMAIL_FROM,
} as const;

/** Loaded on first use. `null` when RESEND_API_KEY is not set: e-mails are then only logged. */
export const getResend = lazy(async (): Promise<Resend | null> => {
  if (!env.RESEND_API_KEY) return null;
  const { Resend: ResendClient } = await import("resend");
  return new ResendClient(env.RESEND_API_KEY);
});
