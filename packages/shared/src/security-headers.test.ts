import { describe, expect, it } from "vitest";
import {
  apiSecurityHeaders,
  renderStaticHeadersFile,
  SPA_CSP_REPORT_ONLY,
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

  it("la CSP completa va en modo informe y no permite inline ni eval", () => {
    expect(SPA_CSP_REPORT_ONLY).not.toContain("unsafe-inline");
    expect(SPA_CSP_REPORT_ONLY).not.toContain("unsafe-eval");
    expect(SPA_CSP_REPORT_ONLY).toContain("report-uri /api/csp-report");
  });

  it("solo abre la CSP al origen de Turnstile, para el script y el iframe del desafío", () => {
    expect(SPA_CSP_REPORT_ONLY).toContain("script-src 'self' https://challenges.cloudflare.com;");
    expect(SPA_CSP_REPORT_ONLY).toContain("frame-src https://challenges.cloudflare.com;");
    expect(SPA_CSP_REPORT_ONLY).toContain("connect-src 'self';");
  });

  it("la API no permite cargar nada", () => {
    const headers = apiSecurityHeaders();
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("genera un _headers con reglas para todo y caché inmutable para /assets", () => {
    const file = renderStaticHeadersFile();
    expect(file.startsWith("/*\n")).toBe(true);
    expect(file).toContain("  Content-Security-Policy-Report-Only: ");
    expect(file).toContain("/assets/*\n  Cache-Control: public, max-age=31536000, immutable");
  });
});
