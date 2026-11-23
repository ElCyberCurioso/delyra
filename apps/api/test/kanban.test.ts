import type { BoardDetail, BoardSummary, CardDetail, DueCard } from "@delyra/shared";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { cards } from "../src/db/schema";
import { runAutoarchive } from "../src/jobs/autoarchive";
import { registerUser, type TestClient } from "./helpers";

/** Kanban (F4-03 a F4-07, F4-12): tableros, columnas, tarjetas y permisos entre usuarios. */

const db = () => createDb(env.DB);

async function json<T>(response: Response, status: number): Promise<T> {
  if (response.status !== status) {
    throw new Error(
      `esperaba ${String(status)}, llegó ${String(response.status)}: ${await response.text()}`,
    );
  }
  return response.json<T>();
}

async function newBoard(client: TestClient, template = "personal", name = "Mi tablero") {
  return json<BoardDetail>(await client.post("/api/boards", { name, template }), 201);
}

async function newCard(client: TestClient, columnId: string, title: string) {
  const { card } = await json<{ card: CardDetail }>(
    await client.post(`/api/columns/${columnId}/cards`, { title }),
    201,
  );
  return card;
}

async function board(client: TestClient, id: string) {
  return json<BoardDetail>(await client.get(`/api/boards/${id}`), 200);
}

async function move(client: TestClient, cardId: string, columnId: string, index: number) {
  return client.post(`/api/cards/${cardId}/move`, { columnId, index });
}

const titlesIn = (detail: BoardDetail, columnId: string) =>
  detail.cards
    .filter((c) => c.columnId === columnId)
    .sort((a, b) => (a.position < b.position ? -1 : 1))
    .map((c) => c.title);

describe("plantillas (F4-03)", () => {
  it("cada plantilla crea sus columnas, límites WIP, columna hecha y etiquetas", async () => {
    const { client } = await registerUser();
    const personal = await newBoard(client, "personal");
    expect(personal.columns.map((c) => [c.name, c.wipLimit, c.isDone])).toEqual([
      ["Por hacer", null, false],
      ["Haciendo", 3, false],
      ["Hecho", null, true],
    ]);
    expect(personal.labels.map((l) => l.name)).toEqual(["Casa", "Recados", "Importante"]);

    const sprint = await newBoard(client, "sprint");
    expect(sprint.columns.map((c) => c.name)).toEqual([
      "Backlog",
      "Por hacer",
      "En curso",
      "En revisión",
      "Hecho",
    ]);
    const audit = await newBoard(client, "audit");
    expect(audit.columns.at(-1)).toMatchObject({ name: "Cerrado", isDone: true });
    expect(audit.labels).toHaveLength(5);
    const empty = await newBoard(client, "empty");
    expect(empty.columns).toHaveLength(0);

    const { boards } = await json<{ boards: BoardSummary[] }>(await client.get("/api/boards"), 200);
    expect(boards).toHaveLength(4);
  });

  it("renombra, cambia el autoarchivado y borra el tablero", async () => {
    const { client } = await registerUser();
    const { board: created } = await newBoard(client);
    const patched = await json<BoardDetail>(
      await client.request("PATCH", `/api/boards/${created.id}`, {
        name: "Casa",
        autoarchiveDays: 0,
      }),
      200,
    );
    expect(patched.board).toMatchObject({ name: "Casa", autoarchiveDays: 0 });
    expect((await client.delete(`/api/boards/${created.id}`)).status).toBe(204);
    expect((await client.get(`/api/boards/${created.id}`)).status).toBe(404);
  });
});

describe("columnas y tarjetas (F4-03, F4-04)", () => {
  it("crea, ordena y mueve tarjetas entre columnas con índices fraccionarios", async () => {
    const { client } = await registerUser();
    const detail = await newBoard(client);
    const [todo, doing] = detail.columns;
    if (!todo || !doing) throw new Error("faltan columnas");
    const a = await newCard(client, todo.id, "A");
    await newCard(client, todo.id, "B");
    const c = await newCard(client, todo.id, "C");
    expect(titlesIn(await board(client, detail.board.id), todo.id)).toEqual(["A", "B", "C"]);

    await json(await move(client, c.id, todo.id, 0), 200);
    expect(titlesIn(await board(client, detail.board.id), todo.id)).toEqual(["C", "A", "B"]);

    await json(await move(client, a.id, doing.id, 0), 200);
    const after = await board(client, detail.board.id);
    expect(titlesIn(after, todo.id)).toEqual(["C", "B"]);
    expect(titlesIn(after, doing.id)).toEqual(["A"]);
  });

  it("al entrar en la columna hecha guarda completed_at y al salir lo quita", async () => {
    const { client } = await registerUser();
    const detail = await newBoard(client);
    const [todo, , done] = detail.columns;
    if (!todo || !done) throw new Error("faltan columnas");
    const card = await newCard(client, todo.id, "Comprar pan");
    const moved = await json<{ card: CardDetail }>(await move(client, card.id, done.id, 0), 200);
    expect(moved.card.completedAt).not.toBeNull();
    expect(moved.card.activity.map((a) => a.kind)).toContain("completed");
    const back = await json<{ card: CardDetail }>(await move(client, card.id, todo.id, 0), 200);
    expect(back.card.completedAt).toBeNull();
    expect(back.card.activity.map((a) => a.kind)).toContain("reopened");
  });

  it("avisa al superar el límite WIP sin impedir el movimiento", async () => {
    const { client } = await registerUser();
    const detail = await newBoard(client);
    const [todo, doing] = detail.columns;
    if (!todo || !doing) throw new Error("faltan columnas");
    const flags: boolean[] = [];
    for (const title of ["1", "2", "3", "4"]) {
      const card = await newCard(client, todo.id, title);
      const result = await json<{ wipExceeded: boolean }>(
        await move(client, card.id, doing.id, 99),
        200,
      );
      flags.push(result.wipExceeded);
    }
    expect(flags).toEqual([false, false, false, true]);
    expect(titlesIn(await board(client, detail.board.id), doing.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("reordena columnas, las edita y al borrar una se van sus tarjetas", async () => {
    const { client } = await registerUser();
    const detail = await newBoard(client);
    const [todo, doing, done] = detail.columns;
    if (!todo || !doing || !done) throw new Error("faltan columnas");
    const moved = await json<BoardDetail>(
      await client.post(`/api/columns/${done.id}/move`, { index: 0 }),
      200,
    );
    expect(moved.columns.map((c) => c.name)).toEqual(["Hecho", "Por hacer", "Haciendo"]);

    const edited = await json<BoardDetail>(
      await client.request("PATCH", `/api/columns/${doing.id}`, { name: "En curso", wipLimit: 5 }),
      200,
    );
    expect(edited.columns.find((c) => c.id === doing.id)).toMatchObject({
      name: "En curso",
      wipLimit: 5,
    });

    const card = await newCard(client, todo.id, "Se va con la columna");
    expect((await client.delete(`/api/columns/${todo.id}`)).status).toBe(204);
    expect((await client.get(`/api/cards/${card.id}`)).status).toBe(404);
  });

  it("no mueve una tarjeta a una columna de otro tablero", async () => {
    const { client } = await registerUser();
    const one = await newBoard(client);
    const two = await newBoard(client);
    const card = await newCard(client, one.columns[0]?.id ?? "", "Tarea");
    expect((await move(client, card.id, two.columns[0]?.id ?? "", 0)).status).toBe(422);
  });
});

describe("detalle de tarjeta (F4-05, F4-07)", () => {
  it("guarda título, descripción, prioridad, etiquetas y actividad", async () => {
    const { client } = await registerUser();
    const detail = await newBoard(client);
    const card = await newCard(client, detail.columns[0]?.id ?? "", "Borrador");
    const label = detail.labels[0]?.id ?? "";
    const { card: updated } = await json<{ card: CardDetail }>(
      await client.request("PATCH", `/api/cards/${card.id}`, {
        title: "Definitivo",
        description: "## Notas\n- una",
        priority: "high",
        labelIds: [label],
      }),
      200,
    );
    expect(updated).toMatchObject({
      title: "Definitivo",
      description: "## Notas\n- una",
      priority: "high",
      labelIds: [label],
      hasDescription: true,
    });
    expect(updated.activity.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["created", "renamed", "described", "priority"]),
    );
  });

  it("cada tarjeta puede tener su color (cualquier #rrggbb) o ninguno", async () => {
    const { client } = await registerUser();
    const detail = await newBoard(client);
    const card = await newCard(client, detail.columns[0]?.id ?? "", "Pintar");
    expect(card.color).toBeNull();
    const colored = await json<{ card: CardDetail }>(
      await client.request("PATCH", `/api/cards/${card.id}`, { color: "#A855F7" }),
      200,
    );
    expect(colored.card.color).toBe("#a855f7");
    expect((await board(client, detail.board.id)).cards[0]?.color).toBe("#a855f7");
    expect(
      (await client.request("PATCH", `/api/cards/${card.id}`, { color: "morado" })).status,
    ).toBe(422);
    const cleared = await json<{ card: CardDetail }>(
      await client.request("PATCH", `/api/cards/${card.id}`, { color: null }),
      200,
    );
    expect(cleared.card.color).toBeNull();
  });

  it("rechaza etiquetas de otro tablero", async () => {
    const { client } = await registerUser();
    const one = await newBoard(client);
    const two = await newBoard(client);
    const card = await newCard(client, one.columns[0]?.id ?? "", "Tarea");
    const response = await client.request("PATCH", `/api/cards/${card.id}`, {
      labelIds: [two.labels[0]?.id ?? ""],
    });
    expect(response.status).toBe(422);
  });

  it("checklist y comentarios: crear, marcar, editar y borrar", async () => {
    const { client } = await registerUser();
    const detail = await newBoard(client);
    const card = await newCard(client, detail.columns[0]?.id ?? "", "Mudanza");
    await json(await client.post(`/api/cards/${card.id}/checklist`, { text: "Cajas" }), 201);
    const { card: withTwo } = await json<{ card: CardDetail }>(
      await client.post(`/api/cards/${card.id}/checklist`, { text: "Furgoneta" }),
      201,
    );
    expect(withTwo.checklistItems.map((i) => i.text)).toEqual(["Cajas", "Furgoneta"]);
    const first = withTwo.checklistItems[0]?.id ?? "";
    const { card: checked } = await json<{ card: CardDetail }>(
      await client.request("PATCH", `/api/checklist/${first}`, { done: true }),
      200,
    );
    expect(checked.checklist).toEqual({ done: 1, total: 2 });
    expect((await client.request("PATCH", `/api/checklist/${first}`, {})).status).toBe(200);
    const { card: oneLeft } = await json<{ card: CardDetail }>(
      await client.delete(`/api/checklist/${first}`),
      200,
    );
    expect(oneLeft.checklist).toEqual({ done: 0, total: 1 });

    const { card: commented } = await json<{ card: CardDetail }>(
      await client.post(`/api/cards/${card.id}/comments`, { body: "Llamar el lunes" }),
      201,
    );
    const comment = commented.commentList[0]?.id ?? "";
    const { card: edited } = await json<{ card: CardDetail }>(
      await client.request("PATCH", `/api/comments/${comment}`, { body: "Llamar el martes" }),
      200,
    );
    expect(edited.commentList.map((c) => c.body)).toEqual(["Llamar el martes"]);
    const { card: none } = await json<{ card: CardDetail }>(
      await client.delete(`/api/comments/${comment}`),
      200,
    );
    expect(none.comments).toBe(0);
  });

  it("archiva y restaura; las archivadas salen del tablero y van a su vista", async () => {
    const { client } = await registerUser();
    const detail = await newBoard(client);
    const card = await newCard(client, detail.columns[0]?.id ?? "", "Vieja");
    await json(await client.post(`/api/cards/${card.id}/archive`), 200);
    expect((await board(client, detail.board.id)).cards).toHaveLength(0);
    const { cards: archived } = await json<{ cards: { id: string }[] }>(
      await client.get(`/api/boards/${detail.board.id}/archived`),
      200,
    );
    expect(archived.map((c) => c.id)).toEqual([card.id]);
    await json(await client.post(`/api/cards/${card.id}/restore`), 200);
    expect((await board(client, detail.board.id)).cards.map((c) => c.id)).toEqual([card.id]);
  });

  it("la fecha límite crea una alerta por defecto y aparece en la capa de tareas", async () => {
    const { client } = await registerUser();
    const detail = await newBoard(client, "personal", "Trabajo <casa>");
    const timed = await newCard(client, detail.columns[0]?.id ?? "", "Entregar informe");
    const { card } = await json<{ card: CardDetail }>(
      await client.request("PATCH", `/api/cards/${timed.id}`, {
        due: { allDay: false, at: "2027-05-10T15:00:00Z", tz: "Europe/Madrid" },
      }),
      200,
    );
    expect(card.due).toEqual({
      allDay: false,
      at: "2027-05-10T15:00:00.000Z",
      tz: "Europe/Madrid",
    });
    expect(card.reminders).toEqual([
      expect.objectContaining({ offsetMinutes: 60, nextFireAt: "2027-05-10T14:00:00.000Z" }),
    ]);

    const allDay = await newCard(client, detail.columns[0]?.id ?? "", "Pagar seguro");
    await json(
      await client.request("PATCH", `/api/cards/${allDay.id}`, {
        due: { allDay: true, at: "2027-05-12", tz: "Europe/Madrid" },
      }),
      200,
    );

    const range = "from=2027-05-01T00:00:00Z&to=2027-06-01T00:00:00Z";
    const { cards: due } = await json<{ cards: DueCard[] }>(
      await client.get(`/api/cards/due?${range}`),
      200,
    );
    expect(due.map((c) => [c.title, c.boardName, c.due.at])).toEqual([
      ["Entregar informe", "Trabajo <casa>", "2027-05-10T15:00:00.000Z"],
      ["Pagar seguro", "Trabajo <casa>", "2027-05-12"],
    ]);
    const outside = await json<{ cards: DueCard[] }>(
      await client.get("/api/cards/due?from=2027-06-01T00:00:00Z&to=2027-07-01T00:00:00Z"),
      200,
    );
    expect(outside.cards).toHaveLength(0);

    // Quitar la fecha borra sus alertas.
    const { card: cleared } = await json<{ card: CardDetail }>(
      await client.request("PATCH", `/api/cards/${timed.id}`, { due: null }),
      200,
    );
    expect(cleared.reminders).toHaveLength(0);
  });
});

describe("autoarchivado (F4-07)", () => {
  it("archiva las terminadas hace más de los días del tablero", async () => {
    const { client } = await registerUser();
    const keep = await newBoard(client, "personal", "Nunca");
    await client.request("PATCH", `/api/boards/${keep.board.id}`, { autoarchiveDays: 0 });
    const auto = await newBoard(client, "personal", "Catorce días");
    const done = (detail: BoardDetail) => detail.columns.find((c) => c.isDone)?.id ?? "";

    const old = await newCard(client, auto.columns[0]?.id ?? "", "Vieja");
    const recent = await newCard(client, auto.columns[0]?.id ?? "", "Reciente");
    const never = await newCard(client, keep.columns[0]?.id ?? "", "Para siempre");
    for (const [card, detail] of [
      [old, auto],
      [recent, auto],
      [never, keep],
    ] as const) {
      await move(client, card.id, done(detail), 0);
    }
    const now = Date.now();
    const daysAgo = (days: number) => new Date(now - days * 86_400_000);
    await db()
      .update(cards)
      .set({ completedAt: daysAgo(15) })
      .where(eq(cards.id, old.id));
    await db()
      .update(cards)
      .set({ completedAt: daysAgo(3) })
      .where(eq(cards.id, recent.id));
    await db()
      .update(cards)
      .set({ completedAt: daysAgo(400) })
      .where(eq(cards.id, never.id));

    expect(await runAutoarchive(db(), now)).toBeGreaterThanOrEqual(1);
    const archivedOf = async (id: string) =>
      (await json<{ card: CardDetail }>(await client.get(`/api/cards/${id}`), 200)).card;
    const archived = await archivedOf(old.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.activity.map((a) => a.kind)).toContain("autoarchived");
    expect((await archivedOf(recent.id)).archivedAt).toBeNull();
    expect((await archivedOf(never.id)).archivedAt).toBeNull();
  });
});

describe("permisos entre tableros (F4-12)", () => {
  it("las rutas de otro usuario responden 404 y no tocan nada", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const detail = await newBoard(alice.client);
    const column = detail.columns[0]?.id ?? "";
    const label = detail.labels[0]?.id ?? "";
    const card = await newCard(alice.client, column, "Privada");
    const { card: full } = await json<{ card: CardDetail }>(
      await alice.client.post(`/api/cards/${card.id}/checklist`, { text: "Paso" }),
      201,
    );
    await alice.client.post(`/api/cards/${card.id}/comments`, { body: "Nota" });
    const { card: withComment } = await json<{ card: CardDetail }>(
      await alice.client.get(`/api/cards/${card.id}`),
      200,
    );
    const item = full.checklistItems[0]?.id ?? "";
    const comment = withComment.commentList[0]?.id ?? "";
    const boardId = detail.board.id;

    const attempts: [string, string, unknown][] = [
      ["GET", `/api/boards/${boardId}`, undefined],
      ["PATCH", `/api/boards/${boardId}`, { name: "Mío" }],
      ["DELETE", `/api/boards/${boardId}`, {}],
      ["POST", `/api/boards/${boardId}/columns`, { name: "Intrusa" }],
      ["POST", `/api/boards/${boardId}/labels`, { name: "Intrusa", color: "#ff0000" }],
      ["GET", `/api/boards/${boardId}/archived`, undefined],
      ["PATCH", `/api/columns/${column}`, { name: "Mía" }],
      ["POST", `/api/columns/${column}/move`, { index: 0 }],
      ["DELETE", `/api/columns/${column}`, {}],
      ["POST", `/api/columns/${column}/cards`, { title: "Intrusa" }],
      ["PATCH", `/api/labels/${label}`, { name: "Mía" }],
      ["DELETE", `/api/labels/${label}`, {}],
      ["GET", `/api/cards/${card.id}`, undefined],
      ["PATCH", `/api/cards/${card.id}`, { title: "Mía" }],
      ["POST", `/api/cards/${card.id}/move`, { columnId: column, index: 0 }],
      ["POST", `/api/cards/${card.id}/archive`, {}],
      ["POST", `/api/cards/${card.id}/restore`, {}],
      ["DELETE", `/api/cards/${card.id}`, {}],
      ["POST", `/api/cards/${card.id}/checklist`, { text: "Intruso" }],
      ["POST", `/api/cards/${card.id}/comments`, { body: "Intruso" }],
      ["PATCH", `/api/checklist/${item}`, { done: true }],
      ["DELETE", `/api/checklist/${item}`, {}],
      ["PATCH", `/api/comments/${comment}`, { body: "Intruso" }],
      ["DELETE", `/api/comments/${comment}`, {}],
    ];
    for (const [method, path, body] of attempts) {
      const response = await bob.client.request(method, path, body);
      expect(`${method} ${path} → ${String(response.status)}`).toBe(`${method} ${path} → 404`);
    }

    // Bob no puede meter su tarjeta en la columna de Alice.
    const own = await newBoard(bob.client);
    const bobCard = await newCard(bob.client, own.columns[0]?.id ?? "", "De Bob");
    expect((await move(bob.client, bobCard.id, column, 0)).status).toBe(422);
    // Ni usar etiquetas de Alice.
    const stolen = await bob.client.request("PATCH", `/api/cards/${bobCard.id}`, {
      labelIds: [label],
    });
    expect(stolen.status).toBe(422);

    // Nada ha cambiado para Alice, y Bob no ve su tablero ni sus tareas.
    const intact = await board(alice.client, boardId);
    expect(intact.board.name).toBe("Mi tablero");
    expect(intact.columns).toHaveLength(3);
    expect(intact.cards.map((c) => c.title)).toEqual(["Privada"]);
    const { boards } = await json<{ boards: BoardSummary[] }>(
      await bob.client.get("/api/boards"),
      200,
    );
    expect(boards.map((b) => b.id)).toEqual([own.board.id]);
  });
});
