import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { env } from "../config/env.js";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json(
    {
      error: "Erro interno. Tente novamente em instantes.",
      ...(env.NODE_ENV !== "production" && { detail: err.message }),
    },
    500,
  );
};

export const notFoundHandler: NotFoundHandler = (c) => c.json({ error: "Recurso não encontrado." }, 404);
