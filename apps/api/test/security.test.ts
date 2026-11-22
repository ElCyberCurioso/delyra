import { newId } from "@delyra/shared";
import { describe, expect, it } from "vitest";
import { invite, PASSWORD, registerUser, TestClient, TURNSTILE, uniqueEmail } from "./helpers";

/**
 * Criterio de aceptación de la Fase 1: ninguna ruta de cuenta ni de administración responde
 * sin una sesión completa (contraseña + segundo factor), y las de admin no existen para un
 * miembro.
 */

const PROTECTED: readonly [method: string, path: string][] = [
  ["GET", "/api/me/security"],
  ["GET", "/api/me/sessions"],
  ["GET", "/api/me/audit"],
  ["PATCH", "/api/me/profile"],
  ["PATCH", "/api/me/settings"],
  ["POST", "/api/me/password"],
  ["POST", "/api/me/recovery-codes"],
  ["POST", "/api/me/totp/reconfigure"],
  ["POST", "/api/me/totp/reconfigure/confirm"],
  ["POST", "/api/me/sessions/revoke-others"],
  ["DELETE", `/api/me/sessions/${newId()}`],
  ["GET", "/api/calendars"],
  ["POST", "/api/calendars"],
  ["PATCH", `/api/calendars/${newId()}`],
  ["DELETE", `/api/calendars/${newId()}`],
  ["GET", "/api/events?from=2027-01-01T00:00:00Z&to=2027-02-01T00:00:00Z"],
  ["GET", "/api/events/search?q=hola"],
  ["GET", `/api/events/${newId()}`],
  ["POST", "/api/events"],
  ["PATCH", `/api/events/${newId()}`],
  ["DELETE", `/api/events/${newId()}`],
  ["GET", "/api/boards"],
  ["POST", "/api/boards"],
  ["GET", `/api/boards/${newId()}`],
  ["PATCH", `/api/boards/${newId()}`],
  ["DELETE", `/api/boards/${newId()}`],
  ["POST", `/api/boards/${newId()}/columns`],
  ["POST", `/api/boards/${newId()}/labels`],
  ["GET", `/api/boards/${newId()}/archived`],
  ["GET", `/api/boards/${newId()}/members`],
  ["POST", `/api/boards/${newId()}/invitations`],
  ["DELETE", `/api/boards/${newId()}/invitations/${newId()}`],
  ["PATCH", `/api/boards/${newId()}/members/${newId()}`],
  ["DELETE", `/api/boards/${newId()}/members/${newId()}`],
  ["GET", `/api/boards/${newId()}/live`],
  ["GET", "/api/board-invitations"],
  ["POST", `/api/board-invitations/${newId()}/accept`],
  ["POST", `/api/board-invitations/${newId()}/decline`],
  ["PATCH", `/api/columns/${newId()}`],
  ["POST", `/api/columns/${newId()}/move`],
  ["DELETE", `/api/columns/${newId()}`],
  ["POST", `/api/columns/${newId()}/cards`],
  ["PATCH", `/api/labels/${newId()}`],
  ["DELETE", `/api/labels/${newId()}`],
  ["GET", "/api/cards/due?from=2027-01-01T00:00:00Z&to=2027-02-01T00:00:00Z"],
  ["GET", `/api/cards/${newId()}`],
  ["PATCH", `/api/cards/${newId()}`],
  ["DELETE", `/api/cards/${newId()}`],
  ["POST", `/api/cards/${newId()}/move`],
  ["POST", `/api/cards/${newId()}/archive`],
  ["POST", `/api/cards/${newId()}/restore`],
  ["POST", `/api/cards/${newId()}/checklist`],
  ["POST", `/api/cards/${newId()}/comments`],
  ["PATCH", `/api/checklist/${newId()}`],
  ["DELETE", `/api/checklist/${newId()}`],
  ["PATCH", `/api/comments/${newId()}`],
  ["DELETE", `/api/comments/${newId()}`],
  ["GET", `/api/attachments/${newId()}`],
  ["DELETE", `/api/attachments/${newId()}`],
  ["GET", "/api/imports"],
  ["GET", `/api/imports/${newId()}`],
  ["POST", `/api/imports/${newId()}/start`],
  ["DELETE", `/api/imports/${newId()}`],
  ["GET", "/api/google/status"],
  ["POST", "/api/google/authorize"],
  ["GET", "/api/subscriptions"],
  ["POST", "/api/subscriptions"],
  ["POST", `/api/subscriptions/${newId()}/sync`],
  ["DELETE", `/api/subscriptions/${newId()}`],
  ["GET", "/api/backups"],
  ["POST", "/api/backups"],
  ["PUT", "/api/backups/settings"],
  ["GET", `/api/backups/${newId()}/download`],
  ["DELETE", `/api/backups/${newId()}`],
  ["POST", "/api/restores"],
  ["GET", `/api/restores/${newId()}`],
  ["POST", `/api/restores/${newId()}/start`],
  ["POST", `/api/restores/${newId()}/undo`],
  ["DELETE", `/api/restores/${newId()}`],
  ["GET", `/api/calendars/${newId()}/export`],
  ["GET", `/api/boards/${newId()}/export`],
  ["GET", `/api/calendars/${newId()}/feed`],
  ["POST", `/api/calendars/${newId()}/feed`],
  ["DELETE", `/api/calendars/${newId()}/feed`],
  ["GET", "/api/holidays?from=2027-01-01&to=2027-02-01"],
  ["PUT", "/api/holidays/region"],
  ["GET", "/api/admin/users"],
  ["GET", "/api/admin/invitations"],
  ["POST", "/api/admin/invitations"],
  ["POST", `/api/admin/users/${newId()}/disable`],
  ["POST", `/api/admin/users/${newId()}/reset-2fa`],
];

async function statuses(client: TestClient) {
  const result: string[] = [];
  for (const [method, path] of PROTECTED) {
    const response = await client.request(method, path, {});
    result.push(`${String(response.status)} ${method} ${path.split("/").slice(0, 4).join("/")}`);
  }
  return result;
}

describe("rutas protegidas", () => {
  it("sin sesión responden 401", async () => {
    for (const line of await statuses(new TestClient())) expect(line).toMatch(/^401 /);
  });

  it("con la contraseña pero sin el segundo factor responden 401", async () => {
    const { email } = await registerUser();
    const client = new TestClient();
    await client.post("/api/auth/login", { email, password: PASSWORD, turnstileToken: TURNSTILE });
    expect((await client.get("/api/auth/me")).status).toBe(200);
    for (const line of await statuses(client)) expect(line).toMatch(/^401 /);
  });

  it("recién registrado y sin TOTP configurado responden 401", async () => {
    const email = uniqueEmail();
    const { token } = await invite(email, "admin");
    const client = new TestClient();
    await client.post("/api/auth/register", {
      token,
      name: "Sin TOTP",
      password: PASSWORD,
      turnstileToken: TURNSTILE,
    });
    for (const line of await statuses(client)) expect(line).toMatch(/^401 /);
  });

  it("un miembro con sesión completa no ve las rutas de admin (404)", async () => {
    const { client } = await registerUser("member");
    const admin = (await statuses(client)).filter((line) => line.includes("/api/admin"));
    expect(admin.length).toBeGreaterThan(0);
    for (const line of admin) expect(line).toMatch(/^404 /);
  });
});
