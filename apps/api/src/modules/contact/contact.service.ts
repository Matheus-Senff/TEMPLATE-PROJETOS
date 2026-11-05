import { env } from "../../config/env.js";
import { emailLayout, escapeHtml, sendEmail } from "../../services/email.service.js";
import type { ContactInput } from "./contact.schemas.js";

/** Delivers a contact message to CONTACT_EMAIL (job "send-contact-email"). Without it, only logs. */
export async function deliverContactMessage(input: ContactInput & { id: string }): Promise<void> {
  if (!env.CONTACT_EMAIL) {
    console.info(`[contact] CONTACT_EMAIL not set; message ${input.id} received`);
    return;
  }
  const rows = [
    ["Nome", input.name],
    ["E-mail", input.email],
    ["Telefone", input.phone || "-"],
  ]
    .map(([label, value]) => `<p style="margin:0 0 4px"><strong>${label}:</strong> ${escapeHtml(value ?? "")}</p>`)
    .join("");
  await sendEmail({
    to: env.CONTACT_EMAIL,
    replyTo: input.email,
    subject: `Novo contato: ${input.name}`,
    html: emailLayout(
      "Nova mensagem de contato",
      `${rows}<p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>`,
    ),
    text: `${input.name} <${input.email}> ${input.phone ?? ""}\n\n${input.message}`,
    idempotencyKey: `contact-${input.id}`,
  });
}
