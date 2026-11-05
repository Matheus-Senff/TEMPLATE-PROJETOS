import { clerk } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import { test as base, expect, type Page } from "@playwright/test";

/**
 * Signed-in flows run only with a Clerk DEVELOPMENT instance and the full stack (web + API + DB + R2), i.e.
 * E2E_BASE_URL pointing to a running environment (a Vercel preview in CI, or `npm run dev` locally).
 */
export const authEnabled = Boolean(
  process.env.E2E_CLERK_SECRET_KEY && process.env.E2E_CLERK_PUBLISHABLE_KEY && process.env.E2E_BASE_URL,
);

export const clerkBackend = () => createClerkClient({ secretKey: process.env.E2E_CLERK_SECRET_KEY! });

/** Disposable user per test (`+clerk_test` addresses never receive real e-mail). Deleted afterwards. */
export const test = base.extend<{ user: { id: string; email: string } }>({
  user: async ({}, provide) => {
    const email = `e2e+${Date.now()}${Math.floor(Math.random() * 1000)}+clerk_test@example.com`;
    const created = await clerkBackend().users.createUser({
      emailAddress: [email],
      firstName: "E2E",
      skipPasswordRequirement: true,
    });
    await provide({ id: created.id, email });
    await clerkBackend()
      .users.deleteUser(created.id)
      .catch(() => {}); // already deleted by the account-deletion test
  },
});

/** Signs in through Clerk (sign-in token, no password) and opens `path`. */
export async function signIn(page: Page, email: string, path = "/dashboard") {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: email });
  await page.goto(path);
}

/** Calls the API through the same-origin proxy with the page's Clerk session (like `useApi()`). */
export async function apiStatus(page: Page, path: string): Promise<number> {
  return page.evaluate(async (url) => {
    const token = await window.Clerk.session?.getToken();
    return (await fetch(url, { headers: { Authorization: `Bearer ${token ?? ""}` } })).status;
  }, path);
}

export { expect };
