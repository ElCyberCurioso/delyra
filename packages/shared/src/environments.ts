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
