import { intlLocale } from "./core";

/** Fechas y tamaños en el idioma de la interfaz, con los mismos formatos en las dos apps. */

/** Fecha sola: «27 nov 2026». */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" }).format(new Date(iso));
}

/** Fecha y hora en la zona de la cuenta: «21 nov 2026, 18:42». */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** Fecha y hora cortas, en la zona del navegador: «21/11/26, 18:42». */
export function formatShortDateTime(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/** Tamaño de un fichero: «512 B», «34 KB», «1.2 MB». */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
