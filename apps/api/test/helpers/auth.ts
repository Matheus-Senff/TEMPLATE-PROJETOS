import { Hono, type MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { errorHandler, notFoundHandler } from "../../src/middlewares/error-handler.js";

export type FakeAuth = {
  userId: string | null;
  /** Result of `has({ reverification })` (Clerk `fva` claim fresh enough). Default true. */
  reverified?: boolean;
  orgId?: string | null;
  orgRole?: string | null;
  claims?: Record<string, unknown>;
};

/**
 * Stands in for clerkMiddleware(): sets the same `clerkAuth` context function @clerk/hono's getAuth() reads,
 * so routes run with requireAuth/requireRole/requireOrgRole/requireReverification exactly as in production.
 */
export const fakeAuth = (auth: FakeAuth): MiddlewareHandler =>
  createMiddleware(async (c, next) => {
    const authObject = {
      userId: auth.userId,
      orgId: auth.orgId ?? null,
      orgRole: auth.orgRole ?? null,
      sessionClaims: auth.claims ?? {},
      has: (params: { reverification?: unknown }) => (params.reverification ? (auth.reverified ?? true) : false),
    };
    (c.set as (key: string, value: unknown) => void)("clerkAuth", () => authObject);
    await next();
  });

/** Mounts `routes` at `path` behind a fake Clerk session, with the API's JSON error handlers. */
export function appWith(path: string, routes: Hono<never>, auth: FakeAuth) {
  const app = new Hono().use(fakeAuth(auth)).route(path, routes as unknown as Hono);
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
}

export const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});
