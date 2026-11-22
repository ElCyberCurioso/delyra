import type {
  BoardDetail,
  BoardLiveMessage,
  BoardMembers,
  BoardSummary,
  CardDetail,
  PendingBoardInvitation,
} from "@delyra/shared";
import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { ORIGIN, registerUser, type TestClient } from "./helpers";

/** Tableros compartidos (F7-04) y tiempo real (F7-05): permisos cruzados en cada recurso. */

vi.setConfig({ testTimeout: 30_000 });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function json<T>(response: Response | Promise<Response>): Promise<T> {
  return (await response).json<T>();
}

async function me(client: TestClient) {
  return (await json<{ user: { id: string; name: string } }>(client.get("/api/auth/me"))).user;
}

/** Tablero con una tarjeta, etiqueta, checklist, comentario y adjunto del dueño. */
async function setupBoard(owner: TestClient) {
  const board = await json<BoardDetail>(
    owner.post("/api/boards", { name: "Compartido", template: "personal" }),
  );
  const { label } = await json<{ label: { id: string } }>(
    owner.post(`/api/boards/${board.board.id}/labels`, { name: "Etiqueta", color: "#eb5757" }),
  );
  const { card } = await json<{ card: CardDetail }>(
    owner.post(`/api/columns/${board.columns[0]?.id ?? ""}/cards`, { title: "Tarea" }),
  );
  const withChecklist = await json<{ card: CardDetail }>(
    owner.post(`/api/cards/${card.id}/checklist`, { text: "Paso" }),
  );
  const withComment = await json<{ card: CardDetail }>(
    owner.post(`/api/cards/${card.id}/comments`, { body: "Del dueño" }),
  );
  const uploaded = await exports.default.fetch(
    new Request(`https://delyra.test/api/cards/${card.id}/attachments`, {
      method: "POST",
      headers: {
        "cf-connecting-ip": owner.ip,
        Origin: ORIGIN,
        "Content-Type": "image/png",
        "Content-Length": String(PNG.byteLength),
        "X-Filename": "foto.png",
        Cookie: `__Secure-sid=${owner.cookie ?? ""}`,
      },
      body: PNG,
    }),
  );
  const attachment = (await uploaded.json<{ card: CardDetail }>()).card.attachmentList[0];
  return {
    board,
    columnId: board.columns[0]?.id ?? "",
    labelId: label.id,
    cardId: card.id,
    checklistId: withChecklist.card.checklistItems[0]?.id ?? "",
    commentId: withComment.card.commentList[0]?.id ?? "",
    attachmentId: attachment?.id ?? "",
  };
}

async function invite(
  owner: TestClient,
  boardId: string,
  email: string,
  role: "editor" | "reader",
) {
  return owner.post(`/api/boards/${boardId}/invitations`, { email, role });
}

async function accept(client: TestClient) {
  const { invitations } = await json<{ invitations: PendingBoardInvitation[] }>(
    client.get("/api/board-invitations"),
  );
  const [invitation] = invitations;
  if (!invitation) throw new Error("sin invitación");
  return json<{ boardId: string }>(client.post(`/api/board-invitations/${invitation.id}/accept`));
}

describe("compartir un tablero (F7-04)", () => {
  it("un editor trabaja en el tablero y aparece como autor; un lector solo mira", async () => {
    const owner = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    const ids = await setupBoard(owner.client);
    const boardId = ids.board.board.id;

    expect((await invite(owner.client, boardId, bob.email, "editor")).status).toBe(201);
    expect((await invite(owner.client, boardId, carol.email, "reader")).status).toBe(201);
    const pending = await json<{ invitations: PendingBoardInvitation[] }>(
      bob.client.get("/api/board-invitations"),
    );
    expect(pending.invitations).toEqual([
      expect.objectContaining({
        boardName: "Compartido",
        role: "editor",
        invitedBy: "Persona de prueba",
      }),
    ]);
    expect(await accept(bob.client)).toEqual({ boardId });
    await accept(carol.client);

    const bobBoards = await json<{ boards: BoardSummary[] }>(bob.client.get("/api/boards"));
    expect(bobBoards.boards).toEqual([
      expect.objectContaining({ id: boardId, role: "editor", ownerName: "Persona de prueba" }),
    ]);
    const ownerBoards = await json<{ boards: BoardSummary[] }>(owner.client.get("/api/boards"));
    expect(ownerBoards.boards[0]).toMatchObject({ role: "owner", ownerName: null, members: 2 });

    // El editor crea, mueve y comenta.
    const created = await bob.client.post(`/api/columns/${ids.columnId}/cards`, {
      title: "De Bob",
    });
    expect(created.status).toBe(201);
    const { card } = await created.json<{ card: CardDetail }>();
    const commented = await json<{ card: CardDetail }>(
      bob.client.post(`/api/cards/${card.id}/comments`, { body: "Hecho por Bob" }),
    );
    const bobUser = await me(bob.client);
    expect(commented.card.commentList[0]).toMatchObject({ authorName: bobUser.name, mine: true });
    expect(commented.card.activity.find((a) => a.kind === "created")?.actorName).toBe(bobUser.name);
    const asOwner = await json<{ card: CardDetail }>(owner.client.get(`/api/cards/${card.id}`));
    expect(asOwner.card.commentList[0]?.mine).toBe(false);

    // El lector ve todo, incluido el adjunto, pero no puede cambiar nada.
    expect((await carol.client.get(`/api/boards/${boardId}`)).status).toBe(200);
    expect((await carol.client.get(`/api/attachments/${ids.attachmentId}`)).status).toBe(200);
    expect(
      (await carol.client.post(`/api/columns/${ids.columnId}/cards`, { title: "No" })).status,
    ).toBe(403);
    expect(
      (await carol.client.post(`/api/cards/${ids.cardId}/comments`, { body: "No" })).status,
    ).toBe(403);
    expect(
      (await carol.client.request("PATCH", `/api/cards/${ids.cardId}`, { title: "No" })).status,
    ).toBe(403);
    expect((await carol.client.delete(`/api/cards/${ids.cardId}`)).status).toBe(403);
  });

  it("quien no es miembro recibe 404 en todo lo del tablero", async () => {
    const owner = await registerUser();
    const dave = await registerUser();
    const ids = await setupBoard(owner.client);
    const boardId = ids.board.board.id;
    const checks: [string, string, unknown?][] = [
      ["GET", `/api/boards/${boardId}`],
      ["GET", `/api/boards/${boardId}/members`],
      ["GET", `/api/boards/${boardId}/export`],
      ["GET", `/api/boards/${boardId}/archived`],
      ["PATCH", `/api/boards/${boardId}`, { name: "x" }],
      ["DELETE", `/api/boards/${boardId}`],
      ["POST", `/api/boards/${boardId}/columns`, { name: "x" }],
      ["POST", `/api/boards/${boardId}/labels`, { name: "x", color: "#000000" }],
      ["POST", `/api/boards/${boardId}/invitations`, { email: "x@example.com", role: "editor" }],
      ["PATCH", `/api/columns/${ids.columnId}`, { name: "x" }],
      ["POST", `/api/columns/${ids.columnId}/cards`, { title: "x" }],
      ["DELETE", `/api/columns/${ids.columnId}`],
      ["PATCH", `/api/labels/${ids.labelId}`, { name: "x" }],
      ["DELETE", `/api/labels/${ids.labelId}`],
      ["GET", `/api/cards/${ids.cardId}`],
      ["PATCH", `/api/cards/${ids.cardId}`, { title: "x" }],
      ["POST", `/api/cards/${ids.cardId}/comments`, { body: "x" }],
      ["DELETE", `/api/cards/${ids.cardId}`],
      ["PATCH", `/api/checklist/${ids.checklistId}`, { done: true }],
      ["DELETE", `/api/checklist/${ids.checklistId}`],
      ["PATCH", `/api/comments/${ids.commentId}`, { body: "x" }],
      ["DELETE", `/api/comments/${ids.commentId}`],
      ["GET", `/api/attachments/${ids.attachmentId}`],
      ["DELETE", `/api/attachments/${ids.attachmentId}`],
    ];
    for (const [method, path, body] of checks) {
      const response = await dave.client.request(method, path, body ?? {});
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    // Y nada ha cambiado para el dueño.
    const card = await json<{ card: CardDetail }>(owner.client.get(`/api/cards/${ids.cardId}`));
    expect(card.card).toMatchObject({ title: "Tarea" });
    expect(card.card.commentList).toHaveLength(1);
  });

  it("solo el dueño borra, invita y gestiona; los comentarios solo los edita su autor", async () => {
    const owner = await registerUser();
    const bob = await registerUser();
    const ids = await setupBoard(owner.client);
    const boardId = ids.board.board.id;
    await invite(owner.client, boardId, bob.email, "editor");
    await accept(bob.client);
    const bobId = (await me(bob.client)).id;

    expect((await bob.client.delete(`/api/boards/${boardId}`)).status).toBe(403);
    expect((await invite(bob.client, boardId, "otra@example.com", "reader")).status).toBe(403);
    // Los avisos por Telegram le llegan al dueño: el editor cambia la fecha, no el aviso.
    const due = { allDay: true, at: "2027-03-01", tz: "Europe/Madrid" };
    expect((await bob.client.request("PATCH", `/api/cards/${ids.cardId}`, { due })).status).toBe(
      200,
    );
    const reminders = [{ offsetMinutes: -540, channel: "telegram" }];
    expect(
      (await bob.client.request("PATCH", `/api/cards/${ids.cardId}`, { reminders })).status,
    ).toBe(403);
    expect(
      (
        await bob.client.request("PATCH", `/api/boards/${boardId}/members/${bobId}`, {
          role: "reader",
        })
      ).status,
    ).toBe(403);
    // El comentario del dueño: el editor ni lo edita ni lo borra.
    expect(
      (await bob.client.request("PATCH", `/api/comments/${ids.commentId}`, { body: "x" })).status,
    ).toBe(403);
    expect((await bob.client.delete(`/api/comments/${ids.commentId}`)).status).toBe(403);
    // El dueño puede quitar el de Bob (moderar) y bajarlo a lector.
    const { card } = await json<{ card: CardDetail }>(
      bob.client.post(`/api/cards/${ids.cardId}/comments`, { body: "De Bob" }),
    );
    const bobComment = card.commentList.find((c) => c.body === "De Bob");
    expect((await owner.client.delete(`/api/comments/${bobComment?.id ?? ""}`)).status).toBe(200);
    const members = await json<BoardMembers>(
      owner.client.request("PATCH", `/api/boards/${boardId}/members/${bobId}`, { role: "reader" }),
    );
    expect(members.members.find((m) => m.userId === bobId)).toMatchObject({
      role: "reader",
      email: bob.email,
    });
    expect(
      (await bob.client.post(`/api/columns/${ids.columnId}/cards`, { title: "x" })).status,
    ).toBe(403);
    // Los miembros no ven los emails de los demás.
    const asBob = await json<BoardMembers>(bob.client.get(`/api/boards/${boardId}/members`));
    expect(asBob.members.every((m) => m.email === null)).toBe(true);
    expect(asBob.invitations).toEqual([]);

    // Bob se va del tablero.
    expect((await bob.client.delete(`/api/boards/${boardId}/members/${bobId}`)).status).toBe(204);
    expect((await bob.client.get(`/api/boards/${boardId}`)).status).toBe(404);
  });

  it("invitar no revela si la dirección tiene cuenta; la invitación es solo de ese email", async () => {
    const owner = await registerUser();
    const bob = await registerUser();
    const mallory = await registerUser();
    const ids = await setupBoard(owner.client);
    const boardId = ids.board.board.id;
    const unknown = await invite(owner.client, boardId, "nadie-con-cuenta@example.com", "editor");
    const known = await invite(owner.client, boardId, bob.email, "editor");
    expect(unknown.status).toBe(known.status);
    const { invitations } = await json<BoardMembers>(
      owner.client.get(`/api/boards/${boardId}/members`),
    );
    expect(invitations.map((i) => i.email).sort()).toEqual(
      ["nadie-con-cuenta@example.com", bob.email].sort(),
    );
    // Mallory no puede aceptar la de Bob aunque conozca su id.
    const bobPending = await json<{ invitations: PendingBoardInvitation[] }>(
      bob.client.get("/api/board-invitations"),
    );
    const id = bobPending.invitations[0]?.id ?? "";
    expect((await mallory.client.post(`/api/board-invitations/${id}/accept`)).status).toBe(404);
    expect((await mallory.client.get(`/api/boards/${boardId}`)).status).toBe(404);
    // Invitar a quien ya está, o al dueño, no tiene sentido.
    expect((await invite(owner.client, boardId, owner.email, "editor")).status).toBe(409);
  });
});

// ── Tiempo real (F7-05) ──────────────────────────────────────────────────────

async function connect(client: TestClient, boardId: string, origin: string | null = ORIGIN) {
  const response = await exports.default.fetch(
    new Request(`https://delyra.test/api/boards/${boardId}/live`, {
      headers: {
        Upgrade: "websocket",
        "cf-connecting-ip": client.ip,
        ...(origin ? { Origin: origin } : {}),
        Cookie: `__Secure-sid=${client.cookie ?? ""}`,
      },
    }),
  );
  const socket = response.webSocket;
  const messages: BoardLiveMessage[] = [];
  const closed: { code?: number } = {};
  if (socket) {
    socket.accept();
    socket.addEventListener("message", (event) => {
      messages.push(JSON.parse(String(event.data)) as BoardLiveMessage);
    });
    socket.addEventListener("close", (event) => {
      closed.code = event.code;
    });
  }
  return { response, socket, messages, closed };
}

async function until(check: () => boolean, ms = 3_000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return check();
}

describe("tablero en vivo (F7-05)", () => {
  it("avisa a los demás de cada cambio y de quién está mirando", async () => {
    const owner = await registerUser();
    const bob = await registerUser();
    const ids = await setupBoard(owner.client);
    const boardId = ids.board.board.id;
    await invite(owner.client, boardId, bob.email, "editor");
    await accept(bob.client);

    const ownerLive = await connect(owner.client, boardId);
    expect(ownerLive.response.status).toBe(101);
    const bobLive = await connect(bob.client, boardId);
    expect(bobLive.response.status).toBe(101);
    const bobUser = await me(bob.client);

    expect(
      await until(() =>
        ownerLive.messages.some((m) => m.type === "presence" && m.users.length === 2),
      ),
    ).toBe(true);

    await bob.client.post(`/api/columns/${ids.columnId}/cards`, { title: "En vivo" });
    expect(
      await until(() =>
        ownerLive.messages.some((m) => m.type === "changed" && m.by === bobUser.id),
      ),
    ).toBe(true);
    // Los mensajes no llevan datos del tablero.
    expect(JSON.stringify(ownerLive.messages)).not.toContain("En vivo");

    // Al quitarle el acceso, se le avisa, su conexión se cierra y deja de contar como presente.
    await owner.client.delete(`/api/boards/${boardId}/members/${bobUser.id}`);
    expect(await until(() => bobLive.closed.code === 4403)).toBe(true);
    expect(bobLive.messages.some((m) => m.type === "revoked")).toBe(true);
    const presence = ownerLive.messages.filter((m) => m.type === "presence");
    expect(presence.at(-1)).toMatchObject({ users: [{ id: (await me(owner.client)).id }] });
    ownerLive.socket?.close();
  });

  it("sin acceso, sin el Origin de la app o sin WebSocket, no se conecta", async () => {
    const owner = await registerUser();
    const dave = await registerUser();
    const ids = await setupBoard(owner.client);
    const boardId = ids.board.board.id;
    expect((await connect(dave.client, boardId)).response.status).toBe(404);
    expect((await connect(owner.client, boardId, "https://evil.example")).response.status).toBe(
      403,
    );
    expect((await connect(owner.client, boardId, null)).response.status).toBe(403);
    expect((await owner.client.get(`/api/boards/${boardId}/live`)).status).toBe(426);
  });
});
