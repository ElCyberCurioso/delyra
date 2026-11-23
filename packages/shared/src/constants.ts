import { z } from "zod";

export const APP_NAME = "Delyra";

export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
export const localeSchema = z.enum(SUPPORTED_LOCALES);

export const DEFAULT_TIME_ZONE = "Europe/Madrid";

/** Zonas que se ofrecen primero en los selectores. Cualquier zona IANA válida es aceptable. */
export const SUGGESTED_TIME_ZONES = [
  "Europe/Madrid",
  "Atlantic/Canary",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Mexico_City",
  "America/Bogota",
  "America/Argentina/Buenos_Aires",
  "UTC",
] as const;

const IANA_ZONE_PATTERN = /^(?:UTC|[A-Z][A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/** Zona IANA reconocida por el runtime (`Europe/Madrid`); rechaza desplazamientos como `+01:00`. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!IANA_ZONE_PATTERN.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { error: "Zona horaria no válida" });

/** Lunes. El calendario empieza la semana en lunes salvo que el usuario elija otra cosa. */
export const DEFAULT_WEEK_START = 1;

export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);
