import { describe, expect, it } from "vitest";
import {
  createLogger,
  isSensitiveKey,
  type LogEntry,
  REDACTED,
  safeErrorMessage,
  sanitize,
} from "../src/lib/logger";
import { pseudonymize } from "../src/lib/pseudonymize";

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "passwordHash",
    "new_password",
    "token",
    "sessionToken",
    "refresh_token",
    "Authorization",
    "cookie",
    "set-cookie",
    "totpSecret",
    "totp_seed",
    "otp",
    "chat_id",
    "chatId",
    "recoveryCode",
    "apiKey",
    "signed_url",
    "email",
    "title",
    "notes",
    "location",
  ])("marca %s como sensible", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["requestId", "route", "status", "durationMs", "userId", "event", "component"])(
    "permite %s",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe("sanitize", () => {
  it("redacta claves sensibles a cualquier profundidad", () => {
    const result = sanitize({ user: { email: "a@b.c", prefs: { totpSecret: "JBSWY3DP" } }, ok: 1 });
    expect(result).toEqual({ user: { email: REDACTED, prefs: { totpSecret: REDACTED } }, ok: 1 });
  });

  it("recorta cadenas largas y limita la profundidad", () => {
    const deep = { a: { b: { c: { d: { e: { f: "x" } } } } } };
    expect(JSON.stringify(sanitize(deep))).toContain("[MaxDepth]");
    expect((sanitize("x".repeat(5000)) as string).length).toBeLessThan(2100);
  });

  it("serializa errores sin la traza", () => {
    expect(sanitize(new TypeError("fallo"))).toEqual({ name: "TypeError", message: "fallo" });
  });
});

describe("createLogger", () => {
  it("escribe JSON con los campos base y no deja sobrescribir level/event", () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ requestId: "r1" }, (entry) => entries.push(entry)).child({
      route: "/api/x",
    });
    logger.warn("algo", { level: "debug", event: "otro", password: "hunter2" });
    expect(entries[0]).toMatchObject({
      level: "warn",
      event: "algo",
      requestId: "r1",
      route: "/api/x",
      password: REDACTED,
    });
  });
});

describe("safeErrorMessage", () => {
  it("elimina URLs, que pueden llevar firmas", () => {
    const message = safeErrorMessage(
      new Error("fallo al leer https://r2.example/x?X-Amz-Signature=abc"),
    );
    expect(message).toBe("Error: fallo al leer [url]");
  });
});

describe("pseudonymize", () => {
  it("es estable para la misma clave y distinto entre claves", async () => {
    const a = await pseudonymize("user-1", "clave-1");
    expect(await pseudonymize("user-1", "clave-1")).toBe(a);
    expect(await pseudonymize("user-1", "clave-2")).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(a).not.toContain("user-1");
  });

  it("exige una clave", async () => {
    await expect(pseudonymize("user-1", "")).rejects.toThrow();
  });
});
