import { expect, test } from "@playwright/test";

const h1 = (html: string) => html.match(/<h1[^>]*>([^<]*)/)?.[1];

test.describe("páginas públicas (HTTP)", () => {
  test("home responde com título e links legais no rodapé", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(h1(html)).toBeTruthy();
    expect(html).toContain('href="/privacidade"');
    expect(html).toContain('href="/termos"');
  });

  test("política de privacidade e termos respondem", async ({ request }) => {
    expect(h1(await (await request.get("/privacidade")).text())).toBe("Política de Privacidade");
    expect(h1(await (await request.get("/termos")).text())).toBe("Termos de Uso");
  });

  test("página de contato tem o formulário", async ({ request }) => {
    const html = await (await request.get("/contato")).text();
    expect(h1(html)).toBe("Contato");
    expect(html).toContain("Enviar mensagem");
  });

  test("rota inexistente responde 404 com a página própria", async ({ request }) => {
    const res = await request.get("/rota-que-nao-existe");
    expect(res.status()).toBe(404);
    expect(h1(await res.text())).toBe("Página não encontrada");
  });

  test("respostas trazem os headers de segurança", async ({ request }) => {
    const headers = (await request.get("/")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("imagem de compartilhamento, ícone e manifest", async ({ request }) => {
    const og = await request.get("/opengraph-image");
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/png");
    expect((await request.get("/icon.svg")).status()).toBe(200);
    expect(await (await request.get("/manifest.webmanifest")).json()).toMatchObject({ display: "standalone" });
  });

  test("robots.txt bloqueia áreas privadas e aponta o sitemap", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /dashboard");
    expect(robots).toContain("sitemap.xml");
    expect(await (await request.get("/sitemap.xml")).text()).toContain("/privacidade");
  });
});

/**
 * Real browser: needs a real Clerk development instance (dummy keys make Clerk redirect the browser
 * to a handshake that cannot succeed). Set the E2E_CLERK_PUBLISHABLE_KEY/E2E_CLERK_SECRET_KEY secrets in CI.
 */
test.describe("páginas públicas (navegador)", () => {
  test.skip(!process.env.E2E_CLERK_PUBLISHABLE_KEY, "requer chaves de teste do Clerk (E2E_CLERK_*)");

  test("home renderiza sem erros e navega pelo rodapé", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Privacidade" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Política de Privacidade" })).toBeVisible();
    await page.getByRole("link", { name: "Termos de uso" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Termos de Uso" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("área privada exige login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/sign-in/);
  });
});
