import { describe, expect, it } from "vitest";
import { safeNext } from "./environments";
import { emailSchema, passwordSchema, recoveryCodeSchema } from "./schemas/auth";

describe("safeNext (F1-13)", () => {
  it.each([
    ["https://work.delyra.app/tableros/1?x=1#y", "https://work.delyra.app/tableros/1?x=1#y"],
    ["https://delyra.app/", "https://delyra.app/"],
    ["/ajustes?tab=seguridad", "/ajustes?tab=seguridad"],
  ])("acepta %s", (next, expected) => {
    expect(safeNext("production", next)).toBe(expected);
  });

  it.each([
    "https://delyra.app.evil.com/",
    "https://evil.com/?https://delyra.app",
    "https://evil.com#https://work.delyra.app",
    "//evil.com/x",
    "/\\evil.com",
    "https://user:pass@work.delyra.app/",
    "http://delyra.app/",
    "https://delyra.app:444/",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://localhost:5173/",
    "",
    "relativo-sin-barra",
  ])("rechaza %s", (next) => {
    expect(safeNext("production", next)).toBe("/");
  });

  it("admite los orígenes de desarrollo solo en desarrollo", () => {
    expect(safeNext("development", "http://localhost:5174/x")).toBe("http://localhost:5174/x");
  });
});

describe("esquemas de autenticación", () => {
  it("normaliza el email", () => {
    expect(emailSchema.parse("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(emailSchema.safeParse("no-es-un-email").success).toBe(false);
  });

  it("exige contraseñas de 12 a 128 caracteres", () => {
    expect(passwordSchema.safeParse("corta").success).toBe(false);
    expect(passwordSchema.safeParse("x".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("acepta códigos de recuperación con o sin guion", () => {
    expect(recoveryCodeSchema.parse("ABCDE-FGH23")).toBe("abcde-fgh23");
    expect(recoveryCodeSchema.safeParse("abcdefgh23").success).toBe(true);
    expect(recoveryCodeSchema.safeParse("abc").success).toBe(false);
  });
});
