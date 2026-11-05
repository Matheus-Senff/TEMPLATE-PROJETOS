import { apiStatus, authEnabled, clerkBackend, expect, signIn, test } from "./fixtures";

test.describe("área logada", () => {
  test.skip(!authEnabled, "requer E2E_CLERK_* e E2E_BASE_URL (ambiente completo)");

  test("painel carrega com o nome do usuário e o sininho", async ({ page, user }) => {
    await signIn(page, user.email);
    await expect(page.getByRole("heading", { level: 1, name: /Olá, E2E/ })).toBeVisible();
    await page.getByRole("button", { name: /Notificações/ }).click();
    await expect(page.getByText(/Nenhuma notificação|Não foi possível carregar/)).toBeVisible();
  });

  test("arquivo: envia, confirma, lista e exclui", async ({ page, user }) => {
    await signIn(page, user.email);
    await page.locator('input[type="file"]').setInputFiles({
      name: "e2e.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("arquivo de teste E2E"),
    });
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.getByText("Arquivo enviado")).toBeVisible();
    const row = page.getByRole("row", { name: /e2e\.txt/ });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: /Excluir/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Excluir", exact: true }).click();
    await expect(page.getByText("Arquivo excluído")).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test("não administrador não acessa /admin nem a API de administração", async ({ page, user }) => {
    await signIn(page, user.email, "/admin");
    await expect(page).toHaveURL(/\/dashboard/);
    expect(await apiStatus(page, "/api/admin/users")).toBe(403);
  });

  test("exclusão de conta apaga o usuário no Clerk", async ({ page, user }) => {
    await signIn(page, user.email);
    await page.getByRole("button", { name: "Excluir conta" }).click();
    await page.getByRole("button", { name: "Excluir definitivamente" }).click();
    // Fresh sign-in counts as a recent verification; otherwise Clerk's reverification modal shows up here.
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect
      .poll(async () =>
        clerkBackend()
          .users.getUser(user.id)
          .then(() => "exists")
          .catch(() => "deleted"),
      )
      .toBe("deleted");
  });
});
