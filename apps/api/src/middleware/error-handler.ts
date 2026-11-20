import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { AppError, problemResponse } from "../lib/errors";
import { safeErrorMessage } from "../lib/logger";
import type { AppEnv } from "../types";

/** Manejo central de errores: siempre `problem+json`, nunca trazas al cliente. */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const logger = c.get("logger");

  if (err instanceof AppError || err instanceof HTTPException) {
    if (err.status >= 500) {
      logger.error("http_error", { status: err.status, error: safeErrorMessage(err) });
    }
    return problemResponse(c, err.status, err instanceof AppError ? err.problem : {});
  }

  logger.error("unhandled_error", {
    error: safeErrorMessage(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return problemResponse(c, 500);
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) => problemResponse(c, 404);
