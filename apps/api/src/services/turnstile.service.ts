import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { turnstileConfig } from "../config/turnstile.js";

type SiteverifyResponse = {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

const hostnameAllowed = (hostname: string | undefined, allowed: readonly string[]): boolean => {
  const host = hostname?.toLowerCase();
  return Boolean(host) && allowed.some((entry) => host === entry || host!.endsWith(`.${entry}`));
};

/**
 * Validates a Turnstile token server-side (siteverify). Tokens are single-use and expire after 5 minutes.
 * No-op while Turnstile is disabled. Fails closed: if Cloudflare cannot be reached, the request is refused.
 * `action` must match the `action` passed to the widget on the web, so a token from one form cannot be
 * replayed on another.
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip: string | undefined,
  action?: string,
): Promise<void> {
  if (!turnstileConfig.enabled || !turnstileConfig.secretKey) return;
  if (!token) throw new HTTPException(400, { message: "Confirme que você não é um robô e tente de novo." });

  const body = new URLSearchParams({
    secret: turnstileConfig.secretKey,
    response: token,
    idempotency_key: randomUUID(),
  });
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  let result: SiteverifyResponse;
  try {
    const response = await fetch(turnstileConfig.verifyUrl, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`siteverify answered ${response.status}`);
    result = (await response.json()) as SiteverifyResponse;
  } catch (error) {
    console.error("turnstile: siteverify failed", error);
    throw new HTTPException(503, { message: "Não foi possível verificar o envio agora. Tente de novo em instantes." });
  }

  const valid =
    result.success &&
    hostnameAllowed(result.hostname, turnstileConfig.allowedHostnames) &&
    (!action || result.action === action);
  if (!valid) {
    console.warn("turnstile: token rejected", {
      errors: result["error-codes"],
      hostname: result.hostname,
      action: result.action,
    });
    throw new HTTPException(400, { message: "Verificação anti-robô falhou. Recarregue a página e tente de novo." });
  }
}
