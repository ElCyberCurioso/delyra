import type { BoardDetail, CardDetail } from "@delyra/shared";
import { env } from "cloudflare:workers";
import { inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { cards, events } from "../src/db/schema";
import { runAutoarchive } from "../src/jobs/autoarchive";
import { registerUser } from "./helpers";

/**
 * D1 admite como mucho 100 parámetros por consulta. Estas pruebas usan volúmenes que lo superan
 * (como tras importar Google Calendar) en los sitios donde una lista de ids va a un `IN (…)`.
 */

vi.setConfig({ testTimeout: 90_000 });

const WEEK = 7 * 86_400_000;
const db = () => createDb(env.DB);

async function me(client: { get: (path: string) => Promise<Response> }) {
  return (await (await client.get("/api/auth/me")).json<{ user: { id: string } }>()).user.id;
}

describe("límite de parámetros de D1", () => {
  it("la agenda de una semana con 150 series y sus excepciones", async () => {
    const { client } = await registerUser();
    const { calendars } = await (
      await client.get("/api/calendars")
    ).json<{ calendars: { id: string }[] }>();
    const calendarId = calendars[0]?.id ?? "";
    const ownerId = await me(client);

    // Directo en D1 (como la importación), de 5 en 5: cada fila lleva unos 16 parámetros.
    const start = Date.parse("2026-11-02T09:00:00.000Z");
    const rows = Array.from({ length: 150 }, (_, i) => ({
      id: crypto.randomUUID(),
      ownerId,
      calendarId,
      type: "event" as const,
      title: `Serie ${String(i)}`,
      allDay: false,
      startAt: start + i * 60_000,
      endAt: start + i * 60_000 + 3_600_000,
      tz: "Europe/Madrid",
      rrule: "FREQ=WEEKLY",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    for (let i = 0; i < rows.length; i += 5) {
      await db()
        .insert(events)
        .values(rows.slice(i, i + 5));
    }
    // Una excepción de la última serie (la del bloque final de ids), movida una hora esa semana.
    const last = rows.at(-1);
    if (!last) throw new Error("sin series");
    await db()
      .insert(events)
      .values({
        ...last,
        id: crypto.randomUUID(),
        title: "Movida",
        rrule: null,
        recurringEventId: last.id,
        originalStart: last.startAt + 3 * WEEK,
        startAt: last.startAt + 3 * WEEK + 3_600_000,
        endAt: last.startAt + 3 * WEEK + 7_200_000,
      });

    const response = await client.get(
      "/api/events?from=2026-11-22T23:00:00.000Z&to=2026-11-29T23:00:00.000Z",
    );
    expect(response.status).toBe(200);
    const { events: list } = await response.json<{ events: { title: string }[] }>();
    expect(list).toHaveLength(150);
    expect(list.filter((e) => e.title === "Movida")).toHaveLength(1);
    expect(list.filter((e) => e.title === "Serie 149")).toHaveLength(0);
  });

  it("autoarchiva 40 tarjetas a la vez y borra un tablero con 120", async () => {
    const { client } = await registerUser();
    const board = await (
      await client.post("/api/boards", { name: "Grande", template: "personal" })
    ).json<BoardDetail>();
    const columnId = board.columns[0]?.id ?? "";
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      const { card } = await (
        await client.post(`/api/columns/${columnId}/cards`, { title: `Tarjeta ${String(i)}` })
      ).json<{ card: CardDetail }>();
      ids.push(card.id);
    }

    // 40 terminadas hace 20 días: el tablero archiva a los 14 (plantilla personal).
    const old = new Date(Date.now() - 20 * 86_400_000);
    for (let i = 0; i < 40; i += 20) {
      await db()
        .update(cards)
        .set({ completedAt: old })
        .where(inArray(cards.id, ids.slice(i, i + 20)));
    }
    expect(await runAutoarchive(db(), Date.now())).toBe(40);

    expect((await client.request("DELETE", `/api/boards/${board.board.id}`)).status).toBe(204);
    expect((await client.get(`/api/boards/${board.board.id}`)).status).toBe(404);
  });
});
