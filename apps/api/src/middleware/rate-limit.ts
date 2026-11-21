import type { MiddlewareHandler } from "hono";
import { AppError } from "../lib/errors";
import type { AppEnv } from "../types";

/**
 * Límite de peticiones con el binding de Rate Limiting de Workers (F1-10). Es aproximado y por
 * centro de datos: complementa, no sustituye, a los contadores estrictos del login.
 * La clave es el usuario si hay sesión y la IP si no.
 *
 * Si el binding falla, la petición sigue (se registra un aviso): una caída del limitador no debe
 * tumbar la API, y la fuerza bruta del login ya la frenan los contadores de D1.
 */
export function rateLimit(
  binding: "API_RATE_LIMITER" | "AUTH_RATE_LIMITER",
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env[binding] as RateLimit | undefined;
    if (limiter) {
      const auth = c.get("auth");
      const key = auth ? `user:${auth.user.id}` : `ip:${c.get("meta").ip}`;
      let success = true;
      try {
        ({ success } = await limiter.limit({ key: `${binding}:${key}` }));
      } catch (error) {
        c.get("logger").warn("rate_limiter_unavailable", { binding, error });
      }
      if (!success) {
        c.header("Retry-After", "60");
        throw new AppError(429);
      }
    }
    await next();
  };
}
