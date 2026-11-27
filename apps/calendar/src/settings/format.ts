import { SUGGESTED_TIME_ZONES } from "@delyra/shared";
import { getLocale, LOCALE_NAMES } from "@delyra/ui";
import { settingsMessages } from "./messages";

// El orden importa: Edge y Opera también dicen «Chrome», y Chrome dice «Safari».
const BROWSERS: readonly [string, string][] = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];
const SYSTEMS: readonly [string, string][] = [
  ["iPhone", "iOS"],
  ["iPad", "iOS"],
  ["Android", "Android"],
  ["Windows", "Windows"],
  ["Mac OS X", "macOS"],
  ["Linux", "Linux"],
];

/** «Chrome en Windows» a partir del User-Agent; sin librerías y sin pretender exactitud. */
export function describeUserAgent(userAgent: string | null): string {
  const t = settingsMessages().device;
  if (!userAgent) return t.unknown;
  const browser = BROWSERS.find(([token]) => userAgent.includes(token))?.[1] ?? t.browser;
  const os = SYSTEMS.find(([token]) => userAgent.includes(token))?.[1];
  return os ? t.on(browser, os) : browser;
}

/** Nombre del país a partir del código ISO que añade Cloudflare. */
export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([getLocale()], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Nombre legible de un evento del historial de seguridad (o el código si es nuevo). */
export function auditLabel(event: string): string {
  const labels: Readonly<Record<string, string>> = settingsMessages().audit;
  return labels[event] ?? event;
}

/** Eventos que conviene destacar: pueden indicar que alguien intenta entrar. */
export const SUSPICIOUS_EVENTS = new Set([
  "login.failure",
  "login.locked",
  "second_factor.failure",
  "reauth.failure",
]);

/** Zona actual, las sugeridas y después el resto de zonas IANA que conoce el navegador. */
export function timeZoneOptions(current: string): { value: string; label: string }[] {
  const all =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zones = [...new Set([current, ...SUGGESTED_TIME_ZONES, ...all])];
  return zones.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }));
}

export function weekStartOptions() {
  const t = settingsMessages().weekStart;
  return [
    { value: "1", label: t.monday },
    { value: "0", label: t.sunday },
    { value: "6", label: t.saturday },
  ];
}

export const LOCALE_OPTIONS = [
  { value: "es", label: LOCALE_NAMES.es },
  { value: "en", label: LOCALE_NAMES.en },
] as const;
