import type { MiddlewareHandler } from "hono";
import { AppError } from "../lib/errors";
import type { AppEnv } from "../types";

/**
 * Límite de peticiones con el binding de Rate Limiting de Workers (F1-10). Es aproximado y por
 * centro de datos: complementa, no sustituye, a los contadores estrictos del login.
 * La clave es el usuario si hay sesión y la IP si no.
 */
export function rateLimit(
  binding: "API_RATE_LIMITER" | "AUTH_RATE_LIMITER",
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env[binding] as RateLimit | undefined;
    if (limiter) {
      const auth = c.get("auth");
      const key = auth ? `user:${auth.user.id}` : `ip:${c.get("meta").ip}`;
      const { success } = await limiter.limit({ key: `${binding}:${key}` });
      if (!success) {
        c.header("Retry-After", "60");
        throw new AppError(429);
      }
    }
    await next();
  };
}
