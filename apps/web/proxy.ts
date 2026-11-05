import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { proxiedApiHeaders, resolveApiUrl } from "./api-proxy";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/admin(.*)", "/billing(.*)"]);

const clerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

/**
 * /api/* (the API proxy) skips Clerk: the API verifies the token itself. With API_PROXY_SECRET the request is
 * rewritten here with the visitor IP signed by the secret (see api-proxy.ts); without it, next.config.ts
 * rewrites it and the API sees the platform's forwarded headers only.
 */
export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const secret = process.env.API_PROXY_SECRET;
    if (!secret) return NextResponse.next();
    const target = new URL(`${resolveApiUrl()}${req.nextUrl.pathname.slice("/api".length)}${req.nextUrl.search}`);
    return NextResponse.rewrite(target, { request: { headers: proxiedApiHeaders(req.headers, secret) } });
  }
  return clerk(req, event);
}

export const config = {
  matcher: [
    // `monitoring` (Sentry tunnel) and `ingest` (PostHog) are rewrites and skip this file. Next route handlers
    // must not live under /api: it is the API proxy.
    "/((?!_next|monitoring|ingest|api/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/api/:path*",
    "/(trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
