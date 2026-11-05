import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

/** Clerk testing token (bypasses bot protection in tests). Only with a Clerk development instance. */
setup("clerk testing token", async () => {
  setup.skip(!process.env.E2E_CLERK_SECRET_KEY || !process.env.E2E_CLERK_PUBLISHABLE_KEY, "sem E2E_CLERK_*");
  process.env.CLERK_PUBLISHABLE_KEY = process.env.E2E_CLERK_PUBLISHABLE_KEY;
  process.env.CLERK_SECRET_KEY = process.env.E2E_CLERK_SECRET_KEY;
  await clerkSetup();
});
