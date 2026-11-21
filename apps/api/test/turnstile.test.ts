import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors";
import { TURNSTILE_DUMMY_TOKEN, verifyTurnstile } from "../src/lib/turnstile";

function siteverify(body: unknown) {
  return vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body)));
}

describe("verificación de Turnstile", () => {
  it("en desarrollo sin secreto acepta solo el token de prueba, sin red", async () => {
    const fetchImpl = siteverify({ success: true });
    const env = { APP_ENV: "development" as const };
    expect(await verifyTurnstile(env, TURNSTILE_DUMMY_TOKEN, "1.2.3.4", fetchImpl)).toBe(true);
    expect(await verifyTurnstile(env, "otro-token", "1.2.3.4", fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("en producción sin secreto falla cerrado (503)", async () => {
    const error = await verifyTurnstile(
      { APP_ENV: "production" },
      TURNSTILE_DUMMY_TOKEN,
      "1.2.3.4",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(503);
  });

  it("en producción el token ficticio no sirve: se consulta a Cloudflare", async () => {
    const fetchImpl = siteverify({ success: false });
    const env = { APP_ENV: "production" as const, TURNSTILE_SECRET_KEY: "s" };
    expect(await verifyTurnstile(env, TURNSTILE_DUMMY_TOKEN, "1.2.3.4", fetchImpl)).toBe(false);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      response: TURNSTILE_DUMMY_TOKEN,
      remoteip: "1.2.3.4",
    });
  });

  it("en producción exige que el desafío se resolviera en un dominio de Delyra", async () => {
    const env = { APP_ENV: "production" as const, TURNSTILE_SECRET_KEY: "s" };
    const ok = siteverify({ success: true, hostname: "work.delyra.app" });
    expect(await verifyTurnstile(env, "t", "1.2.3.4", ok)).toBe(true);
    const foreign = siteverify({ success: true, hostname: "evil.example" });
    expect(await verifyTurnstile(env, "t", "1.2.3.4", foreign)).toBe(false);
  });

  it("si Cloudflare no responde, no deja pasar", async () => {
    const env = { APP_ENV: "production" as const, TURNSTILE_SECRET_KEY: "s" };
    const down = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("network")));
    expect(await verifyTurnstile(env, "t", "1.2.3.4", down)).toBe(false);
  });
});
