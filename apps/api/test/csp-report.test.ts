import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors";
import { parseCspReports } from "../src/routes/csp-report";

const post = (body: string, contentType: string) =>
  exports.default.fetch(
    new Request("https://delyra.app/api/csp-report", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    }),
  );

const legacyReport = {
  "csp-report": {
    "document-uri": "https://delyra.app/ajustes?token=no-debe-registrarse",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://evil.example/x.js?q=1",
    disposition: "report",
  },
};

describe("POST /api/csp-report", () => {
  it("acepta informes en formato report-uri", async () => {
    const response = await post(JSON.stringify(legacyReport), "application/csp-report");
    expect(response.status).toBe(204);
  });

  it("acepta informes de la Reporting API", async () => {
    const body = JSON.stringify([
      { type: "csp-violation", body: { effectiveDirective: "style-src", blockedURL: "inline" } },
    ]);
    const response = await post(body, "application/reports+json");
    expect(response.status).toBe(204);
  });

  it("rechaza otros tipos de contenido con 415", async () => {
    const response = await post(JSON.stringify(legacyReport), "text/plain");
    expect(response.status).toBe(415);
  });

  it("rechaza JSON mal formado con 400", async () => {
    const response = await post("{no es json", "application/csp-report");
    expect(response.status).toBe(400);
  });

  it("rechaza cuerpos de más de 16 KiB con 413", async () => {
    const response = await post(JSON.stringify({ x: "a".repeat(17 * 1024) }), "application/json");
    expect(response.status).toBe(413);
  });
});

describe("parseCspReports", () => {
  it("se queda solo con el origen bloqueado y la ruta del documento", () => {
    expect(parseCspReports(legacyReport)).toEqual([
      {
        directive: "script-src-elem",
        blocked: "https://evil.example",
        documentPath: "/ajustes",
        disposition: "report",
      },
    ]);
  });

  it("ignora informes que no son de CSP", () => {
    expect(parseCspReports([{ type: "deprecation", body: {} }])).toEqual([]);
  });

  it("lanza AppError 400 ante formatos desconocidos", () => {
    expect(() => parseCspReports({ foo: 1 })).toThrow(AppError);
  });
});
