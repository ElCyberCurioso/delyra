import { appEnvironmentSchema, isAllowedOrigin } from "@delyra/shared";
import type { MiddlewareHandler } from "hono";
import { AppError } from "../lib/errors";
import type { AppEnv } from "../types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Protección CSRF (F1-05, §3.5): toda petición que cambia estado debe venir de un origen de la
 * lista blanca (cabecera `Origin`, que el navegador no deja falsificar) y declarar
 * `Content-Type: application/json`, que un formulario HTML no puede enviar sin CORS.
 */
export function csrfProtection(
  options: { exemptPaths?: string[] } = {},
): MiddlewareHandler<AppEnv> {
  const exempt = new Set(options.exemptPaths ?? []);
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || exempt.has(c.req.path)) {
      await next();
      return;
    }
    const environment = appEnvironmentSchema.parse(c.env.APP_ENV);
    if (!isAllowedOrigin(environment, c.req.header("origin"))) {
      throw new AppError(403, { detail: "Origen no permitido" });
    }
    const contentType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new AppError(415);
    await next();
  };
}
