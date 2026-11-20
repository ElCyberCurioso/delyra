import { z } from "zod";
import appOrigins from "./app-origins.json";

/** Sin staging (ADR-0003): solo desarrollo local y producción. */
export const APP_ENVIRONMENTS = ["development", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
export const appEnvironmentSchema = z.enum(APP_ENVIRONMENTS);

export type AppId = "calendar" | "work";

export interface AppOrigins {
  readonly calendar: string;
  readonly work: string;
}

/**
 * Orígenes de cada app por entorno (§3.6 del plan). Es la lista blanca de `Origin` y de `next`.
 * Vive en `app-origins.json` porque también lo leen el workflow de despliegue y
 * `scripts/check-deploy-config.mjs`.
 */
export const APP_ORIGINS: Readonly<Record<AppEnvironment, AppOrigins>> = {
  production: appOrigins.production,
  development: appOrigins.development,
};

export function allowedOrigins(environment: AppEnvironment): readonly string[] {
  const origins = APP_ORIGINS[environment];
  return [origins.calendar, origins.work];
}

/**
 * Comparación exacta de origen (esquema + host + puerto). Nunca por prefijo:
 * `https://delyra.app.evil.com` no es `https://delyra.app`.
 */
export function isAllowedOrigin(environment: AppEnvironment, origin: string | null | undefined) {
  if (!origin) return false;
  let normalized: string;
  try {
    const url = new URL(origin);
    if (url.origin === "null") return false;
    normalized = url.origin;
  } catch {
    return false;
  }
  return normalized === origin && allowedOrigins(environment).includes(normalized);
}

/**
 * Valida el destino de `next` tras iniciar sesión (F1-13). Solo admite una ruta relativa
 * del propio sitio o una URL cuyo origen esté exactamente en la lista blanca del entorno.
 * Cualquier otra cosa (otros dominios, `//evil.com`, `javascript:`, prefijos engañosos como
 * `https://delyra.app.evil.com`) devuelve `fallback`.
 */
export function safeNext(
  environment: AppEnvironment,
  next: string | null | undefined,
  fallback = "/",
): string {
  if (!next || next.length > 2048) return fallback;
  if (next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) {
    try {
      const url = new URL(next, "https://placeholder.invalid");
      return url.origin === "https://placeholder.invalid"
        ? `${url.pathname}${url.search}${url.hash}`
        : fallback;
    } catch {
      return fallback;
    }
  }
  try {
    const url = new URL(next);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return allowedOrigins(environment).includes(url.origin) && !url.username && !url.password
      ? url.href
      : fallback;
  } catch {
    return fallback;
  }
}

/** Localiza el entorno y la app a partir del origen en el que se ejecuta la SPA. */
export function findAppByOrigin(
  origin: string,
): { environment: AppEnvironment; app: AppId; origins: AppOrigins } | null {
  for (const environment of APP_ENVIRONMENTS) {
    const origins = APP_ORIGINS[environment];
    if (origins.calendar === origin) return { environment, app: "calendar", origins };
    if (origins.work === origin) return { environment, app: "work", origins };
  }
  return null;
}
