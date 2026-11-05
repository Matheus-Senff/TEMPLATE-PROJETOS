import { env } from "./env.js";

/**
 * Cloudflare Turnstile (invisible/managed bot check). Disabled when TURNSTILE_SECRET_KEY is empty
 * (production refuses to start that way unless TURNSTILE_DISABLED=true, see env.ts).
 */
export const turnstileConfig = {
  enabled: Boolean(env.TURNSTILE_SECRET_KEY) && !env.TURNSTILE_DISABLED,
  secretKey: env.TURNSTILE_SECRET_KEY,
  /** A token is only accepted when it was solved on one of these hostnames (or their subdomains). */
  allowedHostnames: (env.TURNSTILE_ALLOWED_HOSTNAMES?.length
    ? env.TURNSTILE_ALLOWED_HOSTNAMES
    : [new URL(env.APP_URL).hostname]
  ).map((host) => host.toLowerCase()),
  verifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
} as const;
