import { appEnvironmentSchema, isAllowedOrigin } from "@delyra/shared";
import type { MiddlewareHandler } from "hono";
import { AppError } from "../lib/errors";
import type { AppEnv } from "../types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Protección CSRF (F1-05, §3.5): toda petición que cambia estado debe venir de un origen de la
 * lista blanca (cabecera `Origin`, que el navegador no deja falsificar) y declarar
 * `Content-Type: application/json`, que un formulario HTML no puede enviar sin CORS.
 *
 * `rawBodyPaths` (subida de adjuntos) admite otro `Content-Type`, pero sigue exigiendo el
 * `Origin`; además esas rutas exigen una cabecera propia (`X-Filename`) que un formulario
 * HTML tampoco puede añadir.
 */
export function csrfProtection(
  options: { exemptPaths?: string[]; rawBodyPaths?: RegExp[] } = {},
): MiddlewareHandler<AppEnv> {
  const exempt = new Set(options.exemptPaths ?? []);
  const raw = options.rawBodyPaths ?? [];
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || exempt.has(c.req.path)) {
      await next();
      return;
    }
    const environment = appEnvironmentSchema.parse(c.env.APP_ENV);
    if (!isAllowedOrigin(environment, c.req.header("origin"))) {
      throw new AppError(403, { detail: "Origen no permitido" });
    }
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- regex fijas del código, no del usuario
    if (raw.some((pattern) => pattern.test(c.req.path))) {
      if (!c.req.header("x-filename")) throw new AppError(415);
      await next();
      return;
    }
    const contentType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new AppError(415);
    await next();
  };
}
