import { z } from "zod";

/** Shared with the web admin page (`@app/api/schemas/admin`): only zod imports allowed in *.schemas.ts files. */
export const roleSchema = z.enum(["admin", "member"]);
export const setRoleSchema = z.object({ role: roleSchema });
export const listUsersQuery = z.object({
  page: z.coerce.number().int().min(0).max(10_000).default(0),
  q: z.string().trim().max(100).optional(),
});

export type AdminRole = z.infer<typeof roleSchema>;
