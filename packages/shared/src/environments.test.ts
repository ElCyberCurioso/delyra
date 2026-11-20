import { describe, expect, it } from "vitest";
import { findAppByOrigin, isAllowedOrigin } from "./environments";

describe("isAllowedOrigin", () => {
  it("acepta exactamente los orígenes del entorno", () => {
    expect(isAllowedOrigin("production", "https://delyra.app")).toBe(true);
    expect(isAllowedOrigin("production", "https://work.delyra.app")).toBe(true);
    expect(isAllowedOrigin("staging", "https://delyra-stg.app")).toBe(true);
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
    expect(isAllowedOrigin("production", "https://delyra-stg.app")).toBe(false);
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
