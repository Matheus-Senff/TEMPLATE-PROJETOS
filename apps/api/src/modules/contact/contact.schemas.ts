import { z } from "zod";

/** Shared with the web form (`@app/api/schemas/contact`): only zod imports allowed in *.schemas.ts files. */
export const contactSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(254),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[\d\s()+-]*$/, "Telefone inválido")
    .optional()
    .or(z.literal("")),
  message: z.string().trim().min(10, "Escreva pelo menos 10 caracteres").max(5000),
  /** Honeypot: hidden field that only bots fill (the route accepts and drops it silently). */
  website: z.string().max(200).optional(),
  /** Cloudflare Turnstile token (widget action "contact"); required by the API when Turnstile is on. */
  turnstileToken: z.string().max(2048).optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;
