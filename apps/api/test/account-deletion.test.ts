import type { AccountDeletionSummary, BoardDetail, CardDetail } from "@delyra/shared";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { invitations, users } from "../src/db/schema";
import { devOutbox } from "../src/services/mailer";
import { nextTotp, ORIGIN, PASSWORD, registerUser, TestClient, TURNSTILE } from "./helpers";

/** Borrado de la cuenta por la propia persona (F8-12). */

vi.setConfig({ testTimeout: 30_000 });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function json<T>(response: Response | Promise<Response>): Promise<T> {
  return (await response).json<T>();
}

async function meId(client: TestClient) {
  return (await json<{ user: { id: string } }>(client.get("/api/auth/me"))).user.id;
}

async function newBoard(client: TestClient, name: string) {
  const board = await json<BoardDetail>(client.post("/api/boards", { name, template: "personal" }));
  const { card } = await json<{ card: CardDetail }>(
    client.post(`/api/columns/${board.columns[0]?.id ?? ""}/cards`, { title: "Tarea" }),
  );
  return { boardId: board.board.id, cardId: card.id };
}

async function share(
  owner: TestClient,
  boardId: string,
  guest: { client: TestClient; email: string },
) {
  await owner.post(`/api/boards/${boardId}/invitations`, { email: guest.email, role: "editor" });
  const { invitations: pending } = await json<{ invitations: { id: string }[] }>(
    guest.client.get("/api/board-invitations"),
  );
  for (const invitation of pending) {
    await guest.client.post(`/api/board-invitations/${invitation.id}/accept`);
  }
}

async function attach(client: TestClient, cardId: string) {
  const response = await exports.default.fetch(
    new Request(`https://delyra.test/api/cards/${cardId}/attachments`, {
      method: "POST",
      headers: {
        "cf-connecting-ip": client.ip,
        Origin: ORIGIN,
        "Content-Type": "image/png",
        "Content-Length": String(PNG.byteLength),
        "X-Filename": "foto.png",
        Cookie: `__Secure-sid=${client.cookie ?? ""}`,
      },
      body: PNG,
    }),
  );
  expect(response.status).toBe(201);
}

const keys = async (bucket: R2Bucket, prefix: string) =>
  (await bucket.list({ prefix })).objects.map((o) => o.key);

describe("eliminar la cuenta (F8-12)", () => {
  // Primero: cada fichero de test empieza con la base de datos vacía, así que aquí no hay más
  // administradores.
  it("la única persona administradora no puede eliminar su cuenta", async () => {
    const admin = await registerUser("admin");
    const summary = await json<AccountDeletionSummary>(admin.client.get("/api/me/deletion"));
    expect(summary).toEqual({ sharedBoards: 0, sharedWith: 0, lastAdmin: true });

    const blocked = await admin.client.request("DELETE", "/api/me", {
      password: PASSWORD,
      code: await nextTotp(admin.secret),
    });
    expect(blocked.status).toBe(409);
    expect(await meId(admin.client)).toBeTruthy();

    await registerUser("admin");
    expect(
      (await json<AccountDeletionSummary>(admin.client.get("/api/me/deletion"))).lastAdmin,
    ).toBe(false);
  });

  it("pide la contraseña y el código, y con uno mal no borra nada", async () => {
    const ana = await registerUser();
    for (const body of [
      { password: "no es la contraseña", code: await nextTotp(ana.secret) },
      { password: PASSWORD, code: "000000" },
    ]) {
      expect((await ana.client.request("DELETE", "/api/me", body)).status).toBe(400);
    }
    expect((await ana.client.request("DELETE", "/api/me", { password: PASSWORD })).status).toBe(
      422,
    );
    expect(await meId(ana.client)).toBeTruthy();
  });

  it("borra todo lo suyo, también sus tableros compartidos, y deja lo ajeno", async () => {
    const ana = await registerUser();
    const bob = await registerUser();
    const anaId = await meId(ana.client);

    // Tablero de Ana compartido con Bob, con un adjunto.
    const anas = await newBoard(ana.client, "De Ana");
    await attach(ana.client, anas.cardId);
    await share(ana.client, anas.boardId, bob);
    // Tablero de Bob compartido con Ana, donde Ana comenta.
    const bobs = await newBoard(bob.client, "De Bob");
    await share(bob.client, bobs.boardId, ana);
    expect(
      (await ana.client.post(`/api/cards/${bobs.cardId}/comments`, { body: "Hola" })).status,
    ).toBe(201);
    // Una copia de seguridad suya en R2.
    await env.BACKUPS.put(`users/${anaId}/copia.zip`, "zip");

    expect(await json<AccountDeletionSummary>(ana.client.get("/api/me/deletion"))).toEqual({
      sharedBoards: 1,
      sharedWith: 1,
      lastAdmin: false,
    });
    expect(await keys(env.ATTACHMENTS, `boards/${anaId}/`)).toHaveLength(1);

    const sessionBefore = ana.client.cookie;
    const deleted = await ana.client.request("DELETE", "/api/me", {
      password: PASSWORD,
      code: await nextTotp(ana.secret),
    });
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("set-cookie")).toMatch(/__Secure-sid=;.*Max-Age=0/i);

    // La sesión ya no vale (ni con la cookie de antes) y no se puede volver a entrar.
    const stale = new TestClient();
    stale.cookie = sessionBefore;
    expect((await stale.get("/api/auth/me")).status).toBe(401);
    const again = new TestClient();
    await again.post("/api/auth/login", {
      email: ana.email,
      password: PASSWORD,
      turnstileToken: TURNSTILE,
    });
    expect((await again.get("/api/auth/me")).status).toBe(401);

    // En D1 no queda ni la cuenta ni la invitación con su email.
    const db = createDb(env.DB);
    expect(await db.select().from(users).where(eq(users.id, anaId))).toEqual([]);
    expect(await db.select().from(invitations).where(eq(invitations.email, ana.email))).toEqual([]);
    // Ni en R2.
    expect(await keys(env.ATTACHMENTS, `boards/${anaId}/`)).toEqual([]);
    expect(await keys(env.BACKUPS, `users/${anaId}/`)).toEqual([]);

    // Bob pierde el tablero de Ana; el suyo sigue, con el comentario sin autor.
    expect((await bob.client.get(`/api/boards/${anas.boardId}`)).status).toBe(404);
    const card = await json<{ card: CardDetail }>(bob.client.get(`/api/cards/${bobs.cardId}`));
    expect(card.card.commentList).toEqual([
      expect.objectContaining({ body: "Hola", authorName: null }),
    ]);

    // Y le llega el correo de confirmación.
    expect(devOutbox.findLast((m) => m.to === ana.email)?.subject).toBe(
      "Tu cuenta de Delyra se ha eliminado",
    );
  });
});
