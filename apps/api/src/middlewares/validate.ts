import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z, type ZodType } from "zod";

/** Default zod messages in Brazilian Portuguese (custom messages in schemas still win). */
z.config(z.locales.ptBR());

/**
 * zValidator with the API's error shape: 400 `{ error, issues }` (the web `unwrap()` shows `error`).
 * Use instead of zValidator in every route.
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
      return c.json(
        { error: issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; "), issues },
        400,
      );
    }
  });
