/**
 * Cabeceras de seguridad comunes (F0-12). Las usan el middleware de la API y el
 * generador del fichero `_headers` de las dos SPA, para que no diverjan.
 */

export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_REPORT_GROUP = "csp-endpoint";

/** Dos años. En `.app` el navegador ya fuerza HTTPS por la precarga del TLD. */
export const HSTS_VALUE = "max-age=63072000; includeSubDomains";

export const PERMISSIONS_POLICY = [
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

/** Directivas que ya se aplican (no rompen nada): impiden el framing e inyecciones de `<base>`. */
export const SPA_CSP_ENFORCED = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

/** Origen del widget anti-bots (Turnstile): script e iframe del desafío. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** Política completa en modo informe hasta F7-08, cuando pasa a bloqueo. */
export const SPA_CSP_REPORT_ONLY = [
  "default-src 'self'",
  `script-src 'self' ${TURNSTILE_ORIGIN}`,
  `frame-src ${TURNSTILE_ORIGIN}`,
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
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

/** La API solo devuelve JSON: nada se puede cargar ni enmarcar desde sus respuestas. */
export const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

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
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": SPA_CSP_ENFORCED,
    "Content-Security-Policy-Report-Only": SPA_CSP_REPORT_ONLY,
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
