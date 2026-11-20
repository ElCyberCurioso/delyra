import { describe, expect, it } from "vitest";
import { APP_ENVIRONMENTS, APP_ORIGINS, findAppByOrigin, isAllowedOrigin } from "./environments";

describe("APP_ORIGINS", () => {
  it.each(APP_ENVIRONMENTS)("los orígenes de %s son orígenes exactos y distintos", (env) => {
    const { calendar, work } = APP_ORIGINS[env];
    for (const origin of [calendar, work]) expect(new URL(origin).origin).toBe(origin);
    expect(calendar).not.toBe(work);
  });

  it("producción usa los dominios definitivos por HTTPS", () => {
    expect(APP_ORIGINS.production).toEqual({
      calendar: "https://delyra.app",
      work: "https://work.delyra.app",
    });
  });

  it("solo hay desarrollo local y producción (ADR-0003)", () => {
    expect([...APP_ENVIRONMENTS].sort()).toEqual(["development", "production"]);
  });
});

describe("isAllowedOrigin", () => {
  it("acepta exactamente los orígenes del entorno", () => {
    expect(isAllowedOrigin("production", "https://delyra.app")).toBe(true);
    expect(isAllowedOrigin("production", "https://work.delyra.app")).toBe(true);
    expect(isAllowedOrigin("development", "http://localhost:5173")).toBe(true);
  });

  it.each([
    "https://delyra.app.evil.com",
    "https://evil.com/https://delyra.app",
    "https://delyra.app:8443",
    "http://delyra.app",
    "https://www.delyra.app",
    "https://delyra.app/",
    "https://DELYRA.app",
    "null",
    "",
  ])("rechaza %s", (origin) => {
    expect(isAllowedOrigin("production", origin)).toBe(false);
  });

  it("no mezcla entornos", () => {
    expect(isAllowedOrigin("production", "http://localhost:5173")).toBe(false);
    expect(isAllowedOrigin("development", "https://delyra.app")).toBe(false);
  });

  it("rechaza valores ausentes", () => {
    expect(isAllowedOrigin("production", null)).toBe(false);
    expect(isAllowedOrigin("production", undefined)).toBe(false);
  });
});

describe("findAppByOrigin", () => {
  it("identifica entorno y app", () => {
    expect(findAppByOrigin("https://work.delyra.app")).toMatchObject({
      environment: "production",
      app: "work",
    });
    expect(findAppByOrigin("http://localhost:5173")).toMatchObject({
      environment: "development",
      app: "calendar",
    });
  });

  it("devuelve null para orígenes desconocidos", () => {
    expect(findAppByOrigin("https://example.com")).toBeNull();
  });
});
