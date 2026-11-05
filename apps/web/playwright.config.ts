import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
/** Vercel Deployment Protection on previews: "Protection Bypass for Automation" secret. */
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

/**
 * E2E against a production build (`next build` + `next start`), or against a deployed URL (E2E_BASE_URL,
 * e.g. a Vercel preview: .github/workflows/e2e-preview.yml).
 * - e2e/*.spec.ts: public pages, always (HTTP checks need no secrets).
 * - e2e/auth/*.spec.ts: signed-in flows with @clerk/testing; they need a Clerk DEVELOPMENT instance
 *   (E2E_CLERK_PUBLISHABLE_KEY/E2E_CLERK_SECRET_KEY) and the full stack (E2E_BASE_URL with web + API + DB + R2),
 *   and skip cleanly otherwise.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: "on-first-retry",
    ...(bypass && {
      extraHTTPHeaders: { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" },
    }),
    ...(executablePath && { launchOptions: { executablePath } }),
  },
  projects: [
    // Fetches a Clerk testing token (bypasses bot protection) when the E2E_CLERK_* secrets exist.
    { name: "setup", testMatch: /global\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      dependencies: ["setup"],
      // Signed-in flows create real users: run them once (desktop).
      testIgnore: /auth\//,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? "npm run start" : "npm run build && npm run start",
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
