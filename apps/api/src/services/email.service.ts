import { emailConfig, getResend } from "../config/resend.js";

export type EmailMessage = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Prevents duplicate sends when a job is retried. */
  idempotencyKey?: string;
};

const maskEmail = (to: string | string[]): string =>
  (Array.isArray(to) ? to : [to]).map((address) => address.replace(/^(.).*(@.*)$/, "$1***$2")).join(",");

/** Sends through Resend; without RESEND_API_KEY it only logs (handy in development). */
export async function sendEmail(message: EmailMessage): Promise<{ id: string | null }> {
  const resend = emailConfig.enabled ? await getResend() : null;
  if (!resend) {
    console.info(`[email:disabled] to=${maskEmail(message.to)} subject="${message.subject}"`);
    return { id: null };
  }
  const { data, error } = await resend.emails.send(
    {
      from: emailConfig.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text && { text: message.text }),
      ...(message.replyTo && { replyTo: message.replyTo }),
    },
    message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
  );
  if (error) throw new Error(`Resend: ${error.message}`);
  return { id: data?.id ?? null };
}

export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );

/** Minimal layout shared by every template. Swap for React Email if you need richer designs. */
export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:32px">
<tr><td><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

export const emailTemplates = {
  welcome: (name: string | null) => ({
    subject: "Bem-vindo(a)!",
    html: emailLayout(
      `Olá${name ? `, ${escapeHtml(name)}` : ""}!`,
      `<p style="line-height:1.5">Sua conta foi criada com sucesso. Troque este texto pela mensagem do seu produto.</p>`,
    ),
    text: `Olá${name ? `, ${name}` : ""}! Sua conta foi criada com sucesso.`,
  }),
};
