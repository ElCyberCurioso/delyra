import { describe, expect, it } from "vitest";
import { APP_ENVIRONMENTS, APP_ORIGINS, findAppByOrigin, isAllowedOrigin } from "./environments";

describe("APP_ORIGINS", () => {
  it.each(APP_ENVIRONMENTS)("los orígenes de %s son orígenes exactos y distintos", (env) => {
    const { calendar, work } = APP_ORIGINS[env];
    for (const origin of [calendar, work]) expect(new URL(origin).origin).toBe(origin);
    expect(calendar).not.toBe(work);
  });

  it("producción usa HTTPS y staging vive en workers.dev con los nombres de los Workers", () => {
    expect(APP_ORIGINS.production).toEqual({
      calendar: "https://delyra.app",
      work: "https://work.delyra.app",
    });
    expect(APP_ORIGINS.staging.calendar).toMatch(
      /^https:\/\/delyra-calendar-staging\.[a-z0-9-]+\.workers\.dev$/,
    );
    expect(APP_ORIGINS.staging.work).toMatch(
      /^https:\/\/delyra-work-staging\.[a-z0-9-]+\.workers\.dev$/,
    );
  });

  it("staging nunca comparte dominio con producción (ADR-0003)", () => {
    for (const origin of [APP_ORIGINS.staging.calendar, APP_ORIGINS.staging.work]) {
      expect(new URL(origin).hostname.endsWith("delyra.app")).toBe(false);
    }
  });
});

describe("isAllowedOrigin", () => {
  it("acepta exactamente los orígenes del entorno", () => {
    expect(isAllowedOrigin("production", "https://delyra.app")).toBe(true);
    expect(isAllowedOrigin("production", "https://work.delyra.app")).toBe(true);
    expect(isAllowedOrigin("staging", APP_ORIGINS.staging.calendar)).toBe(true);
    expect(isAllowedOrigin("staging", APP_ORIGINS.staging.work)).toBe(true);
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
    expect(isAllowedOrigin("production", APP_ORIGINS.staging.calendar)).toBe(false);
    expect(isAllowedOrigin("staging", "https://delyra.app")).toBe(false);
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
