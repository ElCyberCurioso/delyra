import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/**
 * Una línea por petición. Se registra el patrón de la ruta (`/api/events/:id`), nunca la
 * URL real ni la query, que pueden llevar identificadores o tokens.
 */
export function requestLogger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const startedAt = performance.now();
    await next();
    const status = c.res.status;
    const fields = {
      method: c.req.method,
      route: c.req.routePath,
      status,
      durationMs: Math.round(performance.now() - startedAt),
      colo: c.req.raw.cf?.colo,
      cfRay: c.req.header("cf-ray"),
    };
    const logger = c.get("logger");
    if (status >= 500) logger.error("http_request", fields);
    else logger.info("http_request", fields);
  };
}
