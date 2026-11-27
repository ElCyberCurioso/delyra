/**
 * Cabeceras de seguridad comunes (F0-12). Las usan el middleware de la API y el
 * generador del fichero `_headers` de las dos SPA, para que no diverjan.
 */

const CSP_REPORT_PATH = "/api/csp-report";
const CSP_REPORT_GROUP = "csp-endpoint";

/** Dos años. En `.app` el navegador ya fuerza HTTPS por la precarga del TLD. */
const HSTS_VALUE = "max-age=63072000; includeSubDomains";

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

/** Origen del widget anti-bots (Turnstile): script e iframe del desafío. */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * CSP de las SPA en modo bloqueo (F7-08). Tras meses en modo informe (F0-12), las únicas
 * excepciones necesarias son:
 * - `style-src 'unsafe-inline'`: FullCalendar y los avisos (sonner) insertan su CSS en `<style>`.
 *   Los scripts siguen sin `unsafe-inline` ni `unsafe-eval`, y una inyección de CSS no puede
 *   sacar datos fuera: `img-src`, `font-src` y `connect-src` no admiten otros orígenes.
 * - `font-src data:`: la fuente de iconos de FullCalendar va incrustada.
 */
export const SPA_CSP = [
  "default-src 'self'",
  `script-src 'self' ${TURNSTILE_ORIGIN}`,
  `frame-src ${TURNSTILE_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `report-uri ${CSP_REPORT_PATH}`,
  `report-to ${CSP_REPORT_GROUP}`,
].join("; ");

/**
 * La API solo devuelve JSON y adjuntos para descargar: nada se puede cargar, enmarcar ni
 * ejecutar desde sus respuestas (`sandbox` cubre un adjunto abierto directamente, F4-06).
 */
const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox";

/**
 * Las SPA pueden usar el micrófono propio (dictado del alta rápida); ningún iframe ni otro
 * origen, y la API sigue sin él.
 */
const SPA_PERMISSIONS_POLICY = PERMISSIONS_POLICY.replace("microphone=()", "microphone=(self)");

const COMMON_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": HSTS_VALUE,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": PERMISSIONS_POLICY,
  "Cross-Origin-Opener-Policy": "same-origin",
};

export function spaSecurityHeaders(): Record<string, string> {
  return {
    ...COMMON_HEADERS,
    "Permissions-Policy": SPA_PERMISSIONS_POLICY,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": SPA_CSP,
    "Reporting-Endpoints": `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`,
  };
}

export function apiSecurityHeaders(): Record<string, string> {
  return {
    ...COMMON_HEADERS,
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": API_CSP,
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

/**
 * Contenido del fichero `_headers` de Workers Static Assets.
 * Los ficheros de `/assets/` llevan hash en el nombre y se pueden cachear para siempre.
 */
export function renderStaticHeadersFile(): string {
  const lines = ["/*"];
  for (const [name, value] of Object.entries(spaSecurityHeaders())) {
    lines.push(`  ${name}: ${value}`);
  }
  lines.push("", "/assets/*", "  Cache-Control: public, max-age=31536000, immutable", "");
  return lines.join("\n");
}
