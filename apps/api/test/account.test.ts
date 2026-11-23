import { describe, expect, it } from "vitest";
import { generateTotp } from "../src/lib/totp";
import { nextTotp, PASSWORD, registerUser, TestClient, TURNSTILE } from "./helpers";

async function login(email: string, password: string, code: string) {
  const client = new TestClient();
  await client.post("/api/auth/login", { email, password, turnstileToken: TURNSTILE });
  const done = await client.post("/api/auth/login/second-factor", { code });
  return { client, status: done.status };
}

describe("perfil y preferencias", () => {
  it("cambia nombre, zona horaria, idioma e inicio de semana", async () => {
    const { client } = await registerUser();
    expect((await client.request("PATCH", "/api/me/profile", { name: "Ana López" })).status).toBe(
      200,
    );
    const settings = await client.request("PATCH", "/api/me/settings", {
      timeZone: "America/Bogota",
      locale: "en",
      weekStart: 0,
    });
    expect(settings.status).toBe(200);
    const me = await (
      await client.get("/api/auth/me")
    ).json<{
      user: { name: string };
      settings: unknown;
    }>();
    expect(me.user.name).toBe("Ana López");
    expect(me.settings).toEqual({
      timeZone: "America/Bogota",
      locale: "en",
      weekStart: 0,
    });
  });

  it("valida zona horaria, idioma e inicio de semana", async () => {
    const { client } = await registerUser();
    for (const body of [
      { timeZone: "+01:00", locale: "es", weekStart: 1 },
      { timeZone: "Marte/Olympus", locale: "es", weekStart: 1 },
      { timeZone: "Europe/Madrid", locale: "fr", weekStart: 1 },
      { timeZone: "Europe/Madrid", locale: "es", weekStart: 7 },
    ]) {
      expect((await client.request("PATCH", "/api/me/settings", body)).status).toBe(422);
    }
  });
});

describe("cambio de contraseña", () => {
  it("exige la actual, cierra las demás sesiones y rota el token de esta", async () => {
    const { client, email, secret } = await registerUser();
    const other = await login(email, PASSWORD, await nextTotp(secret));
    expect(other.status).toBe(200);
    const oldCookie = client.cookie;

    const wrong = await client.post("/api/me/password", {
      currentPassword: "no es la contraseña",
      newPassword: "otra frase larga y segura",
    });
    expect(wrong.status).toBe(400);

    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- contraseña ficticia de prueba
    const newPassword = "otra frase larga y segura";
    const ok = await client.post("/api/me/password", { currentPassword: PASSWORD, newPassword });
    expect(await ok.json()).toEqual({ revokedSessions: 1 });
    expect(client.cookie).not.toBe(oldCookie);
    expect((await client.get("/api/auth/me")).status).toBe(200);
    expect((await other.client.get("/api/auth/me")).status).toBe(401);

    const stale = new TestClient();
    stale.cookie = oldCookie;
    expect((await stale.get("/api/auth/me")).status).toBe(401);

    const relogin = new TestClient();
    const step = await relogin.post("/api/auth/login", {
      email,
      password: newPassword,
      turnstileToken: TURNSTILE,
    });
    expect(await step.json()).toEqual({ next: "2fa" });
  });

  it("rechaza repetir la actual o usar el email", async () => {
    const { client, email } = await registerUser();
    const same = await client.post("/api/me/password", {
      currentPassword: PASSWORD,
      newPassword: PASSWORD,
    });
    expect(same.status).toBe(422);
    const withEmail = await client.post("/api/me/password", {
      currentPassword: PASSWORD,
      newPassword: `${email.split("@")[0] ?? ""} y algo más`,
    });
    expect(withEmail.status).toBe(422);
  });

  it("bloquea tras 5 intentos con la contraseña equivocada", async () => {
    const { client } = await registerUser();
    for (let i = 0; i < 5; i++) {
      await client.post("/api/me/password", {
        currentPassword: `equivocada ${String(i)}`,
        newPassword: "otra frase larga y segura",
      });
    }
    const locked = await client.post("/api/me/password", {
      currentPassword: PASSWORD,
      newPassword: "otra frase larga y segura",
    });
    expect(locked.status).toBe(429);
    const audit = await (await client.get("/api/me/audit")).json<{ events: { event: string }[] }>();
    expect(audit.events.filter((e) => e.event === "reauth.failure")).toHaveLength(5);
  });
});

describe("códigos de recuperación", () => {
  it("se regeneran con contraseña y código; los anteriores dejan de valer", async () => {
    const { client, email, secret, recoveryCodes } = await registerUser();
    const noCode = await client.post("/api/me/recovery-codes", {
      password: PASSWORD,
      code: "000000",
    });
    expect(noCode.status).toBe(400);

    const response = await client.post("/api/me/recovery-codes", {
      password: PASSWORD,
      code: await nextTotp(secret),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const fresh = (await response.json<{ recoveryCodes: string[] }>()).recoveryCodes;
    expect(fresh).toHaveLength(10);

    expect((await login(email, PASSWORD, recoveryCodes[0] ?? "")).status).toBe(401);
    expect((await login(email, PASSWORD, fresh[0] ?? "")).status).toBe(200);
    const overview = await (
      await client.get("/api/me/security")
    ).json<{
      remainingRecoveryCodes: number;
    }>();
    expect(overview.remainingRecoveryCodes).toBe(9);
  });
});

describe("reconfiguración del TOTP", () => {
  it("la semilla nueva sustituye a la anterior solo al confirmarla", async () => {
    const { client, email, secret, recoveryCodes } = await registerUser();
    const other = await login(email, PASSWORD, recoveryCodes[0] ?? "");
    expect(other.status).toBe(200);

    const start = await client.post("/api/me/totp/reconfigure", {
      password: PASSWORD,
      code: await nextTotp(secret),
    });
    expect(start.status).toBe(200);
    const { secret: newSecret } = await start.json<{ secret: string }>();
    expect(newSecret).not.toBe(secret);

    // Un código de la app antigua no confirma la nueva.
    const wrong = await client.post("/api/me/totp/reconfigure/confirm", {
      code: await generateTotp(secret, Date.now() + 60_000),
    });
    expect(wrong.status).toBe(400);

    const confirm = await client.post("/api/me/totp/reconfigure/confirm", {
      code: await generateTotp(newSecret),
    });
    expect(await confirm.json()).toEqual({ revokedSessions: 1 });
    expect((await other.client.get("/api/auth/me")).status).toBe(401);
    expect((await client.get("/api/auth/me")).status).toBe(200);

    expect((await login(email, PASSWORD, await nextTotp(newSecret))).status).toBe(200);
    expect((await login(email, PASSWORD, await nextTotp(secret))).status).toBe(401);
  });

  it("sin reautenticación no se puede empezar ni confirmar", async () => {
    const { client } = await registerUser();
    const start = await client.post("/api/me/totp/reconfigure", {
      password: "equivocada",
      code: "123456",
    });
    expect(start.status).toBe(400);
    const confirm = await client.post("/api/me/totp/reconfigure/confirm", { code: "123456" });
    expect(confirm.status).toBe(400);
  });
});

describe("panel de admin", () => {
  it("muestra quién tiene 2FA y no deja resetear el propio", async () => {
    const admin = await registerUser("admin");
    const { users } = await (
      await admin.client.get("/api/admin/users")
    ).json<{
      users: { id: string; email: string; hasTotp: boolean }[];
    }>();
    const self = users.find((u) => u.email === admin.email);
    expect(self?.hasTotp).toBe(true);
    const reset = await admin.client.post(`/api/admin/users/${self?.id ?? ""}/reset-2fa`);
    expect(reset.status).toBe(409);
  });
});

describe("historial de seguridad", () => {
  it("cada usuario ve solo sus eventos, del más reciente al más antiguo", async () => {
    const ana = await registerUser();
    const luis = await registerUser();
    await ana.client.request("PATCH", "/api/me/profile", { name: "Ana" });
    const events = (
      await (await ana.client.get("/api/me/audit")).json<{ events: { event: string }[] }>()
    ).events.map((e) => e.event);
    expect(events[0]).toBe("profile.updated");
    expect(events).toContain("totp.enrolled");
    const luisEvents = (
      await (await luis.client.get("/api/me/audit")).json<{ events: { event: string }[] }>()
    ).events.map((e) => e.event);
    expect(luisEvents).not.toContain("profile.updated");
  });
});
