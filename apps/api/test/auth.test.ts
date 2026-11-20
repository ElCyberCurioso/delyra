import { meResponseSchema, problemDetailsSchema } from "@delyra/shared";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { generateTotp } from "../src/lib/totp";
import { devOutbox } from "../src/services/mailer";
import {
  invite,
  nextTotp,
  PASSWORD,
  registerUser,
  TestClient,
  TURNSTILE,
  uniqueEmail,
} from "./helpers";

async function problem(response: Response) {
  return problemDetailsSchema.parse(await response.json());
}

describe("registro desde invitación y alta de TOTP", () => {
  it("recorre el flujo completo y rota el token en cada cambio de estado", async () => {
    const email = uniqueEmail();
    const { token } = await invite(email);
    const client = new TestClient();

    const check = await client.post("/api/auth/invitation", { token });
    expect(await check.json()).toMatchObject({ email, role: "member" });

    const register = await client.post("/api/auth/register", {
      token,
      name: "Ana",
      password: PASSWORD,
      turnstileToken: TURNSTILE,
    });
    expect(register.status).toBe(201);
    expect(await register.json()).toEqual({ next: "totp-setup" });
    expect(register.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/i);
    const pendingCookie = client.cookie;

    const me = meResponseSchema.parse(await (await client.get("/api/auth/me")).json());
    expect(me.state).toBe("pending_totp");
    // Sin TOTP no hay acceso a nada más.
    expect((await client.get("/api/me/sessions")).status).toBe(401);

    const setup = await (
      await client.post("/api/auth/totp/setup")
    ).json<{
      secret: string;
      otpauthUri: string;
    }>();
    expect(setup.otpauthUri).toContain(encodeURIComponent(email));
    expect((await client.post("/api/auth/totp/confirm", { code: "000000" })).status).toBe(400);

    const confirm = await client.post("/api/auth/totp/confirm", {
      code: await generateTotp(setup.secret),
    });
    expect(confirm.status).toBe(200);
    const { recoveryCodes } = await confirm.json<{ recoveryCodes: string[] }>();
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(client.cookie).not.toBe(pendingCookie);

    const active = meResponseSchema.parse(await (await client.get("/api/auth/me")).json());
    expect(active).toMatchObject({ state: "active", user: { email, role: "member" } });
    expect(active.settings).toEqual({ timeZone: "Europe/Madrid", locale: "es", weekStart: 1 });

    // Fijación de sesión: el token anterior al segundo factor ya no vale.
    const attacker = new TestClient();
    attacker.cookie = pendingCookie;
    expect((await attacker.get("/api/auth/me")).status).toBe(401);
  });

  it("no permite reutilizar una invitación", async () => {
    const { token } = await invite(uniqueEmail());
    const body = { token, name: "X", password: PASSWORD, turnstileToken: TURNSTILE };
    expect((await new TestClient().post("/api/auth/register", body)).status).toBe(201);
    const again = await new TestClient().post("/api/auth/register", body);
    expect(again.status).toBe(400);
    expect((await problem(again)).detail).toMatch(/invitación/);
  });

  it("rechaza invitaciones caducadas o inventadas", async () => {
    const { token } = await invite(uniqueEmail(), "member", -1);
    const expired = await new TestClient().post("/api/auth/register", {
      token,
      name: "X",
      password: PASSWORD,
      turnstileToken: TURNSTILE,
    });
    expect(expired.status).toBe(400);
    const fake = await new TestClient().post("/api/auth/invitation", { token: "a".repeat(43) });
    expect(fake.status).toBe(404);
  });

  it("exige Turnstile y una contraseña de al menos 12 caracteres", async () => {
    const { token } = await invite(uniqueEmail());
    const client = new TestClient();
    const bot = await client.post("/api/auth/register", {
      token,
      name: "X",
      password: PASSWORD,
      turnstileToken: "token-falso",
    });
    expect(bot.status).toBe(400);
    const short = await client.post("/api/auth/register", {
      token,
      name: "X",
      password: "corta",
      turnstileToken: TURNSTILE,
    });
    expect(short.status).toBe(422);
    expect((await problem(short)).errors?.[0]?.path).toBe("password");
  });
});

describe("login en dos pasos", () => {
  it("contraseña → pendiente de 2FA → TOTP → sesión completa", async () => {
    const { email, secret } = await registerUser();
    const client = new TestClient();
    const login = await client.post("/api/auth/login", {
      email,
      password: PASSWORD,
      turnstileToken: TURNSTILE,
    });
    expect(await login.json()).toEqual({ next: "2fa" });
    const pending = meResponseSchema.parse(await (await client.get("/api/auth/me")).json());
    expect(pending).toEqual({ state: "pending_2fa", user: null, settings: null });
    expect((await client.get("/api/me/audit")).status).toBe(401);

    const ok = await client.post("/api/auth/login/second-factor", { code: await nextTotp(secret) });
    expect(ok.status).toBe(200);
    expect((await client.get("/api/me/audit")).status).toBe(200);
  });

  it("rechaza reutilizar un código TOTP ya aceptado (replay)", async () => {
    const { email, secret } = await registerUser();
    const code = await nextTotp(secret);
    const first = new TestClient();
    await first.post("/api/auth/login", { email, password: PASSWORD, turnstileToken: TURNSTILE });
    expect((await first.post("/api/auth/login/second-factor", { code })).status).toBe(200);

    const second = new TestClient();
    await second.post("/api/auth/login", { email, password: PASSWORD, turnstileToken: TURNSTILE });
    expect((await second.post("/api/auth/login/second-factor", { code })).status).toBe(401);
  });

  it("acepta cada código de recuperación una sola vez", async () => {
    const { email, recoveryCodes } = await registerUser();
    const code = recoveryCodes[0] ?? "";
    const a = new TestClient();
    await a.post("/api/auth/login", { email, password: PASSWORD, turnstileToken: TURNSTILE });
    const ok = await a.post("/api/auth/login/second-factor", { code: code.toUpperCase() });
    expect(await ok.json()).toEqual({ next: "done", remainingRecoveryCodes: 9 });

    const b = new TestClient();
    await b.post("/api/auth/login", { email, password: PASSWORD, turnstileToken: TURNSTILE });
    expect((await b.post("/api/auth/login/second-factor", { code })).status).toBe(401);
  });

  it("revoca la sesión pendiente tras 5 códigos erróneos", async () => {
    const { email, secret } = await registerUser();
    const client = new TestClient();
    await client.post("/api/auth/login", { email, password: PASSWORD, turnstileToken: TURNSTILE });
    for (let i = 0; i < 5; i++) {
      await client.post("/api/auth/login/second-factor", { code: "123456" });
    }
    expect(client.cookie).toBeNull();
    const after = await client.post("/api/auth/login/second-factor", {
      code: await nextTotp(secret),
    });
    expect(after.status).toBe(401);
  });

  it("no revela si un email existe (mismo código y mensaje)", async () => {
    const { email } = await registerUser();
    const wrong = await new TestClient().post("/api/auth/login", {
      email,
      password: "contraseña equivocada",
      turnstileToken: TURNSTILE,
    });
    const unknown = await new TestClient().post("/api/auth/login", {
      email: uniqueEmail("nadie"),
      password: "contraseña equivocada",
      turnstileToken: TURNSTILE,
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await problem(wrong)).detail).toBe((await problem(unknown)).detail);
  });

  it("bloquea la cuenta tras 5 fallos aunque luego llegue la contraseña buena", async () => {
    const { email } = await registerUser();
    const client = new TestClient();
    for (let i = 0; i < 5; i++) {
      await client.post("/api/auth/login", {
        email,
        password: `mala ${String(i)} contraseña`,
        turnstileToken: TURNSTILE,
      });
    }
    // También desde otra IP: el contador es por cuenta.
    const locked = await new TestClient().post("/api/auth/login", {
      email,
      password: PASSWORD,
      turnstileToken: TURNSTILE,
    });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("el cierre de sesión invalida la cookie", async () => {
    const { client } = await registerUser();
    const stolen = client.cookie;
    expect((await client.post("/api/auth/logout")).status).toBe(204);
    const replay = new TestClient();
    replay.cookie = stolen;
    expect((await replay.get("/api/auth/me")).status).toBe(401);
  });
});

describe("protección CSRF", () => {
  it("rechaza mutaciones sin Origin, con Origin ajeno o sin JSON", async () => {
    const client = new TestClient();
    const body = { email: "a@b.co", password: "x", turnstileToken: TURNSTILE };
    expect((await client.request("POST", "/api/auth/login", body, { Origin: "" })).status).toBe(
      403,
    );
    expect(
      (await client.request("POST", "/api/auth/login", body, { Origin: "https://evil.example" }))
        .status,
    ).toBe(403);
    expect(
      (await client.request("POST", "/api/auth/login", body, { "Content-Type": "text/plain" }))
        .status,
    ).toBe(415);
  });
});

describe("sesiones y recursos de otros usuarios", () => {
  it("lista las sesiones propias y responde 404 a una sesión ajena", async () => {
    const ana = await registerUser();
    const luis = await registerUser();
    const anaSessions = await (
      await ana.client.get("/api/me/sessions")
    ).json<{
      sessions: { id: string; current: boolean }[];
    }>();
    expect(anaSessions.sessions.some((s) => s.current)).toBe(true);
    const anaSessionId = anaSessions.sessions[0]?.id ?? "";
    expect((await luis.client.delete(`/api/me/sessions/${anaSessionId}`)).status).toBe(404);
    expect((await ana.client.get("/api/auth/me")).status).toBe(200);
  });
});

describe("recuperación de contraseña", () => {
  it("envía el enlace, cambia la contraseña, cierra sesiones y conserva el TOTP", async () => {
    const { client, email, secret } = await registerUser();
    const requester = new TestClient();
    const forgot = await requester.post("/api/auth/password/forgot", {
      email,
      turnstileToken: TURNSTILE,
    });
    expect(forgot.status).toBe(202);
    const mail = devOutbox.findLast((m) => m.to === email);
    const token = /#token=([\w-]+)/.exec(mail?.text ?? "")?.[1] ?? "";
    expect(token).not.toBe("");

    const newPassword = "otra contraseña distinta 2026";
    expect(
      (await requester.post("/api/auth/password/reset", { token, password: newPassword })).status,
    ).toBe(204);
    expect((await client.get("/api/auth/me")).status).toBe(401);
    expect(
      (await requester.post("/api/auth/password/reset", { token, password: newPassword })).status,
    ).toBe(400);

    const login = new TestClient();
    const step = await login.post("/api/auth/login", {
      email,
      password: newPassword,
      turnstileToken: TURNSTILE,
    });
    expect(await step.json()).toEqual({ next: "2fa" });
    expect(
      (await login.post("/api/auth/login/second-factor", { code: await nextTotp(secret) })).status,
    ).toBe(200);
  });

  it("responde igual si el email no existe y no envía nada", async () => {
    const before = devOutbox.length;
    const email = uniqueEmail("fantasma");
    const response = await new TestClient().post("/api/auth/password/forgot", {
      email,
      turnstileToken: TURNSTILE,
    });
    expect(response.status).toBe(202);
    expect(devOutbox.slice(before).some((m) => m.to === email)).toBe(false);
  });
});

describe("administración", () => {
  it("oculta las rutas de admin a los miembros (404)", async () => {
    const { client } = await registerUser("member");
    expect((await client.get("/api/admin/users")).status).toBe(404);
    expect((await new TestClient().get("/api/admin/users")).status).toBe(401);
  });

  it("crea invitaciones, desactiva usuarios y resetea el 2FA", async () => {
    const admin = await registerUser("admin");
    const email = uniqueEmail("invitado");
    const created = await admin.client.post("/api/admin/invitations", { email, role: "member" });
    expect(created.status).toBe(201);
    const { link } = await created.json<{ link: string }>();
    expect(link).toMatch(/^http:\/\/localhost:5173\/registro#token=[\w-]{43}$/);

    const member = await registerUser("member");
    const users = await (
      await admin.client.get("/api/admin/users")
    ).json<{
      users: { id: string; email: string }[];
    }>();
    const memberId = users.users.find((u) => u.email === member.email)?.id ?? "";

    expect((await admin.client.post(`/api/admin/users/${memberId}/reset-2fa`)).status).toBe(204);
    expect((await member.client.get("/api/auth/me")).status).toBe(401);
    const relogin = new TestClient();
    const step = await relogin.post("/api/auth/login", {
      email: member.email,
      password: PASSWORD,
      turnstileToken: TURNSTILE,
    });
    expect(await step.json()).toEqual({ next: "totp-setup" });

    expect((await admin.client.post(`/api/admin/users/${memberId}/disable`)).status).toBe(204);
    const disabled = await new TestClient().post("/api/auth/login", {
      email: member.email,
      password: PASSWORD,
      turnstileToken: TURNSTILE,
    });
    expect(disabled.status).toBe(401);
  });
});

describe("configuración pública", () => {
  it("expone la site key de Turnstile del entorno", async () => {
    const config = await (await new TestClient().get("/api/auth/config")).json();
    expect(config).toEqual({ turnstileSiteKey: env.TURNSTILE_SITE_KEY });
  });
});
