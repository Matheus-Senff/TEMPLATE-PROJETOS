import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./config/env.js";

/**
 * Vercel: this default export is the deployed function (zero-config Hono detection).
 * Locally (`npm run dev` / `npm start`) a Node server is started instead.
 */
export default app;

if (!process.env.VERCEL) {
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.info(`Server listening on http://localhost:${info.port}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
