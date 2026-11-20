import { apiSecurityHeaders } from "@delyra/shared";
import type { MiddlewareHandler } from "hono";

const HEADERS = Object.entries(apiSecurityHeaders());

/** Cabeceras de seguridad de la API (F0-12) y `no-store` por defecto: las respuestas son privadas. */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    for (const [name, value] of HEADERS) c.res.headers.set(name, value);
    if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  };
}
