/** Identity used by metadata, sitemap, legal pages and footer. Change per project. */
export const site = {
  name: "Template Projeto",
  description: "Next.js + Hono + Neon + Clerk + R2",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
  locale: "pt_BR",
  company: "[RAZÃO SOCIAL]",
  document: "[CNPJ]",
  contactEmail: "[contato@seudominio.com.br]",
  dpoEmail: "[privacidade@seudominio.com.br]",
  legalUpdatedAt: "[DD/MM/AAAA]",
} as const;

/** Public routes listed in the sitemap. Private areas stay out (see robots.ts). */
export const publicRoutes = ["/", "/contato", "/privacidade", "/termos"] as const;
