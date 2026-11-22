import { describe, expect, it } from "vitest";
import {
  apiSecurityHeaders,
  renderStaticHeadersFile,
  SPA_CSP,
  spaSecurityHeaders,
} from "./security-headers";

describe("cabeceras de seguridad", () => {
  it("las SPA prohíben el framing y declaran HSTS con subdominios", () => {
    const headers = spaSecurityHeaders();
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toContain("includeSubDomains");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("la CSP se aplica (bloqueo) sin scripts inline ni eval y sigue informando", () => {
    const csp = spaSecurityHeaders()["Content-Security-Policy"] ?? "";
    expect(csp).toBe(SPA_CSP);
    expect(csp).toMatch(/script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
    expect(csp).not.toContain("unsafe-eval");
    expect(/script-src[^;]*/.exec(csp)?.[0]).not.toContain("unsafe-inline");
    expect(csp).toContain("report-uri /api/csp-report");
    expect(spaSecurityHeaders()["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("solo abre la CSP al origen de Turnstile, para el script y el iframe del desafío", () => {
    expect(SPA_CSP).toContain("frame-src https://challenges.cloudflare.com;");
    expect(SPA_CSP).toContain("connect-src 'self';");
    // Sin orígenes externos para imágenes ni fuentes: una inyección de CSS no saca datos.
    expect(SPA_CSP).toContain("img-src 'self' data: blob:;");
    expect(SPA_CSP).toContain("font-src 'self' data:;");
  });

  it("la API no permite cargar nada", () => {
    const headers = apiSecurityHeaders();
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("genera un _headers con reglas para todo y caché inmutable para /assets", () => {
    const file = renderStaticHeadersFile();
    expect(file.startsWith("/*\n")).toBe(true);
    expect(file).toContain("  Content-Security-Policy: default-src 'self'");
    expect(file).toContain("/assets/*\n  Cache-Control: public, max-age=31536000, immutable");
  });
});
