import { newId } from "@delyra/shared";
import type { MiddlewareHandler } from "hono";
import { createLogger } from "../lib/logger";
import type { AppEnv } from "../types";

/**
 * Asigna un `requestId` propio (no se acepta el del cliente, para no permitir
 * inyectar valores en los logs) y un logger hijo que lo incluye en cada línea.
 */
export function requestContext(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = newId();
    c.set("requestId", requestId);
    c.set("logger", createLogger({ requestId }));
    await next();
    c.res.headers.set("X-Request-Id", requestId);
  };
}
