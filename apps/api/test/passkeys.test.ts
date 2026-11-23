import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { countPasskeys } from "../src/services/passkeys";
import { resetSecondFactor } from "../src/services/second-factor";
import { nextTotp, PASSWORD, registerUser, TestClient, TURNSTILE } from "./helpers";
import { SoftAuthenticator } from "./webauthn";

/** Llaves de acceso como segundo factor alternativo al TOTP (F7-09). */

interface Options {
  challenge: string;
  rp: { id: string; name: string };
  rpId: string;
  user: { name: string; displayName: string };
  excludeCredentials: { id: string }[];
  allowCredentials: { id: string }[];
}

/** Opciones de alta tras reautenticarse con la contraseña y un código (TOTP o de recuperación). */
async function creationOptions(client: TestClient, code: string) {
  const res = await client.post("/api/me/passkeys/options", { password: PASSWORD, code });
  expect(res.status).toBe(200);
  return (await res.json<{ options: Options }>()).options;
}

/** Usuario con una llave ya registrada. */
async function userWithPasskey() {
  const account = await registerUser();
  const authenticator = await SoftAuthenticator.create();
  const options = await creationOptions(account.client, await nextTotp(account.secret));
  const added = await account.client.post("/api/me/passkeys", {
    name: "Portátil",
    response: await authenticator.register(options),
  });
  expect(added.status).toBe(201);
  return { ...account, authenticator };
}

/** Primer paso del login (contraseña): deja la sesión pendiente del segundo factor. */
async function passwordStep(email: string) {
  const client = new TestClient();
  const res = await client.post("/api/auth/login", {
    email,
    password: PASSWORD,
    turnstileToken: TURNSTILE,
  });
  expect(await res.json()).toEqual({ next: "2fa" });
  return client;
}

async function loginOptions(client: TestClient) {
  const res = await client.post("/api/auth/login/passkey/options");
  expect(res.status).toBe(200);
  return (await res.json<{ options: Options }>()).options;
}

describe("alta de llaves de acceso", () => {
  it("pide contraseña y código, y guarda la llave con su nombre", async () => {
    const { client, email, secret, recoveryCodes } = await registerUser();
    expect((await client.post("/api/me/passkeys/options", {})).status).toBe(422);
    expect(
      (
        await client.post("/api/me/passkeys/options", {
          password: "otra contraseña cualquiera",
          code: await nextTotp(secret),
        })
      ).status,
    ).toBe(400);

    const options = await creationOptions(client, await nextTotp(secret));
    expect(options.rp).toEqual({ id: "localhost", name: "Delyra" });
    expect(options.user.name).toBe(email);
    expect(options.excludeCredentials).toEqual([]);

    const authenticator = await SoftAuthenticator.create();
    const added = await client.post("/api/me/passkeys", {
      name: "  Portátil  ",
      response: await authenticator.register(options),
    });
    expect(added.status).toBe(201);
    const { passkey } = await added.json<{ passkey: { id: string; name: string } }>();
    expect(passkey.name).toBe("Portátil");

    const list = await (
      await client.get("/api/me/passkeys")
    ).json<{
      passkeys: { createdAt: string }[];
    }>();
    expect(list.passkeys).toMatchObject([
      { id: passkey.id, name: "Portátil", lastUsedAt: null, backedUp: false },
    ]);
    expect(Date.parse(list.passkeys[0]?.createdAt ?? "")).not.toBeNaN();
    const security = await (await client.get("/api/me/security")).json<{ passkeys: number }>();
    expect(security.passkeys).toBe(1);

    // La misma llave no se registra dos veces: va en la lista de excluidas.
    const again = await creationOptions(client, recoveryCodes[0] ?? "");
    expect(again.excludeCredentials.map((c) => c.id)).toEqual([authenticator.id]);
  });

  it("rechaza otro origen, otro reto, un reto ya usado y llaves duplicadas", async () => {
    const { client, recoveryCodes, authenticator } = await userWithPasskey();
    const fresh = await SoftAuthenticator.create();

    let options = await creationOptions(client, recoveryCodes[0] ?? "");
    const foreign = await client.post("/api/me/passkeys", {
      name: "Phishing",
      response: await fresh.register(options, { origin: "https://delyra.app.evil.com" }),
    });
    expect(foreign.status).toBe(400);
    // El reto se gastó con el intento anterior.
    const reused = await client.post("/api/me/passkeys", {
      name: "Reutilizado",
      response: await fresh.register(options),
    });
    expect(reused.status).toBe(400);

    options = await creationOptions(client, recoveryCodes[1] ?? "");
    const otherChallenge = await client.post("/api/me/passkeys", {
      name: "Otro reto",
      response: await fresh.register(options, { challenge: "b3RybyByZXRv" }),
    });
    expect(otherChallenge.status).toBe(400);

    options = await creationOptions(client, recoveryCodes[2] ?? "");
    const duplicate = await client.post("/api/me/passkeys", {
      name: "Duplicada",
      response: await authenticator.register(options),
    });
    expect(duplicate.status).toBe(409);

    const list = await (await client.get("/api/me/passkeys")).json<{ passkeys: unknown[] }>();
    expect(list.passkeys).toHaveLength(1);
  });

  it("sin reautenticar no hay reto, así que no se puede añadir ninguna", async () => {
    const { client } = await registerUser();
    const authenticator = await SoftAuthenticator.create();
    const res = await client.post("/api/me/passkeys", {
      name: "Sin reto",
      response: await authenticator.register({ challenge: "c2luLXJldG8", rp: { id: "localhost" } }),
    });
    expect(res.status).toBe(400);
  });
});

describe("inicio de sesión con llave de acceso", () => {
  it("sustituye al código y activa la sesión", async () => {
    const { email, authenticator } = await userWithPasskey();
    const client = await passwordStep(email);
    const me = await (await client.get("/api/auth/me")).json<{ state: string; passkey: boolean }>();
    expect(me).toMatchObject({ state: "pending_2fa", passkey: true });

    const options = await loginOptions(client);
    expect(options.rpId).toBe("localhost");
    expect(options.allowCredentials.map((c) => c.id)).toEqual([authenticator.id]);
    const done = await client.post("/api/auth/login/passkey", {
      response: await authenticator.sign(options),
    });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ next: "done", remainingRecoveryCodes: null });
    const active = await (await client.get("/api/auth/me")).json<{ state: string }>();
    expect(active.state).toBe("active");

    const list = await (
      await client.get("/api/me/passkeys")
    ).json<{
      passkeys: { lastUsedAt: string | null }[];
    }>();
    expect(list.passkeys[0]?.lastUsedAt).not.toBeNull();
  });

  it("no acepta una firma repetida, de otro origen ni con el contador hacia atrás", async () => {
    const { email, authenticator } = await userWithPasskey();

    // Firma válida de un login anterior: su reto ya no es el de la sesión nueva.
    const first = await passwordStep(email);
    const captured = await authenticator.sign(await loginOptions(first));
    expect((await first.post("/api/auth/login/passkey", { response: captured })).status).toBe(200);
    const replay = await passwordStep(email);
    await loginOptions(replay);
    expect((await replay.post("/api/auth/login/passkey", { response: captured })).status).toBe(401);

    const phishing = await passwordStep(email);
    const evil = await authenticator.sign(await loginOptions(phishing), {
      origin: "https://delyra.app.evil.com",
    });
    expect((await phishing.post("/api/auth/login/passkey", { response: evil })).status).toBe(401);

    // Un clon de la llave con el contador por detrás.
    const clone = await passwordStep(email);
    const behind = await authenticator.sign(await loginOptions(clone), { counter: 1 });
    expect((await clone.post("/api/auth/login/passkey", { response: behind })).status).toBe(401);
    const state = await (await clone.get("/api/auth/me")).json<{ state: string }>();
    expect(state.state).toBe("pending_2fa");
  });

  it("una llave de otra cuenta no sirve", async () => {
    const owner = await userWithPasskey();
    const other = await userWithPasskey();
    const client = await passwordStep(owner.email);
    const options = await loginOptions(client);
    const res = await client.post("/api/auth/login/passkey", {
      response: await other.authenticator.sign({ ...options }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ detail: "La llave de acceso no es válida" });
  });

  it("sin llaves no hay opciones y el código sigue funcionando", async () => {
    const { email, secret } = await registerUser();
    const client = await passwordStep(email);
    const me = await (await client.get("/api/auth/me")).json<{ passkey: boolean }>();
    expect(me.passkey).toBe(false);
    expect((await client.post("/api/auth/login/passkey/options")).status).toBe(404);
    const done = await client.post("/api/auth/login/second-factor", {
      code: await nextTotp(secret),
    });
    expect(done.status).toBe(200);
  });

  it("con la sesión ya activa no se puede volver a usar el segundo paso", async () => {
    const { client } = await userWithPasskey();
    expect((await client.post("/api/auth/login/passkey/options")).status).toBe(401);
  });
});

describe("gestión de llaves", () => {
  it("quita una llave propia; la de otra persona responde como inexistente", async () => {
    const owner = await userWithPasskey();
    const other = await userWithPasskey();
    const mine = await (
      await owner.client.get("/api/me/passkeys")
    ).json<{
      passkeys: { id: string }[];
    }>();
    const theirs = await (
      await other.client.get("/api/me/passkeys")
    ).json<{
      passkeys: { id: string }[];
    }>();
    const theirId = theirs.passkeys[0]?.id ?? "";
    const myId = mine.passkeys[0]?.id ?? "";

    expect((await owner.client.delete(`/api/me/passkeys/${theirId}`)).status).toBe(404);
    expect((await owner.client.delete("/api/me/passkeys/no-es-un-id")).status).toBe(404);
    expect((await owner.client.delete(`/api/me/passkeys/${myId}`)).status).toBe(204);
    const after = await (
      await owner.client.get("/api/me/passkeys")
    ).json<{ passkeys: unknown[] }>();
    expect(after.passkeys).toEqual([]);

    const login = await passwordStep(owner.email);
    expect((await login.post("/api/auth/login/passkey/options")).status).toBe(404);
  });

  it("el reseteo del 2FA por un administrador también quita las llaves", async () => {
    const { client } = await userWithPasskey();
    const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    const db = createDb(env.DB);
    expect(await countPasskeys(db, me.user.id)).toBe(1);
    await resetSecondFactor(db, me.user.id);
    expect(await countPasskeys(db, me.user.id)).toBe(0);
  });
});
