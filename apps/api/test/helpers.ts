import type { Role } from "@delyra/shared";
import { env, exports } from "cloudflare:workers";
import { createDb } from "../src/db/client";
import { generateTotp } from "../src/lib/totp";
import { TURNSTILE_DUMMY_TOKEN } from "../src/lib/turnstile";
import { createInvitation } from "../src/services/invitations";

export const ORIGIN = "http://localhost:5173";
export const TURNSTILE = TURNSTILE_DUMMY_TOKEN;
export const PASSWORD = "una contraseña muy segura 2026";

let ipCounter = 0;

/** Cliente con cookie e IP propias (cada prueba usa una IP distinta para no compartir límites). */
export class TestClient {
  cookie: string | null = null;
  readonly ip = `10.${String(Math.floor(++ipCounter / 250) % 250)}.${String(ipCounter % 250)}.7`;

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const init: RequestInit = {
      method,
      headers: {
        "cf-connecting-ip": this.ip,
        ...(method === "GET" ? {} : { Origin: ORIGIN, "Content-Type": "application/json" }),
        ...(this.cookie ? { Cookie: `__Secure-sid=${this.cookie}` } : {}),
        ...headers,
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    };
    const response = await exports.default.fetch(new Request(`https://delyra.test${path}`, init));
    const setCookie = response.headers.get("set-cookie");
    if (setCookie?.startsWith("__Secure-sid=")) {
      const value = /^__Secure-sid=([^;]*)/.exec(setCookie)?.[1] ?? "";
      this.cookie = value && !/Max-Age=0/i.test(setCookie) ? value : null;
    }
    return response;
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body?: unknown) => this.request("POST", path, body);
  delete = (path: string) => this.request("DELETE", path, {});
}

let emailCounter = 0;
export function uniqueEmail(prefix = "user") {
  return `${prefix}${String(++emailCounter)}-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

export async function invite(email: string, role: Role = "member", expiresInDays = 7) {
  const db = createDb(env.DB);
  return createInvitation(db, { email, role, createdBy: null, expiresInDays });
}

/** Registra y completa el alta de TOTP. Devuelve el cliente con sesión activa y la semilla. */
export async function registerUser(role: Role = "member") {
  const email = uniqueEmail(role);
  const { token } = await invite(email, role);
  const client = new TestClient();
  const register = await client.post("/api/auth/register", {
    token,
    name: "Persona de prueba",
    password: PASSWORD,
    turnstileToken: TURNSTILE,
  });
  if (register.status !== 201) throw new Error(`registro: ${String(register.status)}`);
  const setup = await (await client.post("/api/auth/totp/setup")).json<{ secret: string }>();
  const confirm = await client.post("/api/auth/totp/confirm", {
    code: await generateTotp(setup.secret),
  });
  const { recoveryCodes } = await confirm.json<{ recoveryCodes: string[] }>();
  return { client, email, secret: setup.secret, recoveryCodes };
}

/** Código TOTP de un paso posterior (el actual ya se usó y el anti-replay lo rechazaría). */
export function nextTotp(secret: string, steps = 1) {
  return generateTotp(secret, Date.now() + steps * 30_000);
}
