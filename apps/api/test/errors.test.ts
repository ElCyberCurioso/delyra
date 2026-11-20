import { PROBLEM_CONTENT_TYPE, PROBLEM_TYPES, problemDetailsSchema } from "@delyra/shared";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const request = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://delyra.app${path}`, init));

describe("errores problem+json", () => {
  it.each(["/api/no-existe", "/api/health/../../etc/passwd", "/fuera-de-api"])(
    "%s responde 404 problem+json",
    async (path) => {
      const response = await request(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Type")).toBe(PROBLEM_CONTENT_TYPE);
      const problem = problemDetailsSchema.parse(await response.json());
      expect(problem.type).toBe(PROBLEM_TYPES.notFound);
      expect(problem.requestId).toBe(response.headers.get("X-Request-Id"));
    },
  );

  it("las respuestas de error también llevan las cabeceras de seguridad", async () => {
    const response = await request("/api/no-existe");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("no expone trazas ni detalles internos", async () => {
    const response = await request("/api/no-existe");
    const text = await response.text();
    expect(text).not.toMatch(/stack|at\s+\w+\s+\(/i);
  });
});
