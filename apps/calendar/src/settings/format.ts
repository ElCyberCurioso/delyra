import { SUGGESTED_TIME_ZONES } from "@delyra/shared";

/** Fecha y hora en la zona del usuario: «21 nov 2026, 18:42». */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

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
  if (!userAgent) return "Dispositivo desconocido";
  const browser = BROWSERS.find(([token]) => userAgent.includes(token))?.[1] ?? "Navegador";
  const os = SYSTEMS.find(([token]) => userAgent.includes(token))?.[1];
  return os ? `${browser} en ${os}` : browser;
}

/** Nombre del país a partir del código ISO que añade Cloudflare. */
export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const AUDIT_LABELS: Readonly<Record<string, string>> = {
  "user.registered": "Cuenta creada",
  "login.success": "Inicio de sesión",
  "login.failure": "Contraseña incorrecta al iniciar sesión",
  "login.locked": "Inicio de sesión bloqueado por demasiados intentos",
  "second_factor.success": "Verificación en dos pasos superada",
  "second_factor.failure": "Código de verificación incorrecto",
  "second_factor.recovery_code_used": "Entrada con un código de recuperación",
  "totp.enrolled": "Verificación en dos pasos activada",
  "totp.reconfigured": "App autenticadora cambiada",
  "recovery_codes.regenerated": "Códigos de recuperación regenerados",
  "password.reset_requested": "Solicitud de recuperación de contraseña",
  "password.reset": "Contraseña restablecida desde el correo",
  "password.changed": "Contraseña cambiada",
  "profile.updated": "Perfil actualizado",
  "settings.updated": "Preferencias actualizadas",
  "reauth.failure": "Confirmación de identidad fallida en Ajustes",
  "session.logout": "Cierre de sesión",
  "session.revoked": "Sesión cerrada desde Ajustes",
  "admin.user_disabled": "Cuenta desactivada por un administrador",
  "admin.user_enabled": "Cuenta reactivada por un administrador",
  "admin.totp_reset": "Verificación en dos pasos reiniciada por un administrador",
};

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

export const WEEK_START_OPTIONS = [
  { value: "1", label: "Lunes" },
  { value: "0", label: "Domingo" },
  { value: "6", label: "Sábado" },
] as const;

export const LOCALE_OPTIONS = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
] as const;
