import { describe, expect, it } from "vitest";
import { createProblem, isProblemDetails, PROBLEM_TYPES } from "./problem";

describe("createProblem", () => {
  it("usa el tipo y el título por defecto del código", () => {
    expect(createProblem(404)).toEqual({
      type: PROBLEM_TYPES.notFound,
      title: "Recurso no encontrado",
      status: 404,
    });
  });

  it("permite añadir detalle y extensiones sin cambiar el status", () => {
    const problem = createProblem(422, { detail: "Falta el título", requestId: "abc" });
    expect(problem).toMatchObject({ status: 422, detail: "Falta el título", requestId: "abc" });
  });

  it("recurre al genérico 4xx o 5xx para códigos sin entrada propia", () => {
    expect(createProblem(418).type).toBe(PROBLEM_TYPES.badRequest);
    expect(createProblem(502).type).toBe(PROBLEM_TYPES.internal);
  });

  it("rechaza códigos que no son de error", () => {
    expect(() => createProblem(200)).toThrow(RangeError);
    expect(() => createProblem(600)).toThrow(RangeError);
  });
});

describe("isProblemDetails", () => {
  it("reconoce un problem+json válido", () => {
    expect(isProblemDetails(createProblem(500))).toBe(true);
  });

  it("rechaza objetos incompletos", () => {
    expect(isProblemDetails({ title: "x" })).toBe(false);
    expect(isProblemDetails(null)).toBe(false);
  });
});
