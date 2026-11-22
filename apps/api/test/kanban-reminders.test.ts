import type { BoardDetail, CardDetail } from "@delyra/shared";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { reminders } from "../src/db/schema";
import { runScheduler } from "../src/jobs/scheduler";
import { createLogger } from "../src/lib/logger";
import { localToday } from "../src/services/agenda";
import { deliver, type NotificationMessage } from "../src/services/notifications";
import { linkChat } from "../src/services/telegram-links";
import { registerUser, type TestClient } from "./helpers";
import { fakeClient, interceptTelegram, newChatId, postUpdate, textUpdate } from "./telegram-fake";

/** Alertas de fechas límite (F4-07) y tareas en Telegram (F4-11). */

const db = () => createDb(env.DB);
const logger = createLogger({ test: "kanban-reminders" });
const at = (value: string) => Date.parse(value);

async function run(now: number) {
  const sent: NotificationMessage[] = [];
  await runScheduler({
    db: db(),
    now,
    send: (messages) => {
      sent.push(...messages);
      return Promise.resolve();
    },
    logger,
  });
  return sent;
}

async function setup(boardName = "Casa") {
  const { client } = await registerUser();
  const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
  const created = await client.post("/api/boards", { name: boardName, template: "personal" });
  const board = await created.json<BoardDetail>();
  return { client, userId: me.user.id, board };
}

async function cardWithDue(
  client: TestClient,
  board: BoardDetail,
  title: string,
  due: Record<string, unknown> | null,
  columnIndex = 0,
) {
  const created = await client.post(`/api/columns/${board.columns[columnIndex]?.id ?? ""}/cards`, {
    title,
  });
  const { card } = await created.json<{ card: CardDetail }>();
  if (!due) return card;
  const patched = await client.request("PATCH", `/api/cards/${card.id}`, {
    due: { tz: "Europe/Madrid", ...due },
  });
  return (await patched.json<{ card: CardDetail }>()).card;
}

async function reminderRow(id: string) {
  const [row] = await db().select().from(reminders).where(eq(reminders.id, id));
  return row;
}

describe("alertas de fechas límite (F4-07)", () => {
  it("avisa una vez y no vuelve a programarse", async () => {
    const { client, board } = await setup();
    const card = await cardWithDue(client, board, "Entregar informe", {
      allDay: false,
      at: "2027-05-10T15:00:00Z",
    });
    const reminderId = card.reminders[0]?.id ?? "";
    expect(await run(at("2027-05-10T13:59:00Z"))).not.toContainEqual(
      expect.objectContaining({ reminderId }),
    );
    const due = (await run(at("2027-05-10T14:00:00Z"))).filter(
      (m) => m.type === "reminder" && m.reminderId === reminderId,
    );
    expect(due).toEqual([
      expect.objectContaining({
        occurrenceStart: at("2027-05-10T15:00:00Z"),
        fireAt: at("2027-05-10T14:00:00Z"),
      }),
    ]);
    expect(await reminderRow(reminderId)).toMatchObject({ status: "done", nextFireAt: null });
  });

  it("terminar la tarjeta cancela la alerta y reabrirla la vuelve a programar", async () => {
    const { client, board } = await setup();
    const card = await cardWithDue(client, board, "Llamar al banco", {
      allDay: true,
      at: "2099-05-12",
    });
    const done = board.columns.find((c) => c.isDone)?.id ?? "";
    const moved = await client.post(`/api/cards/${card.id}/move`, { columnId: done, index: 0 });
    const { card: finished } = await moved.json<{ card: CardDetail }>();
    expect(finished.reminders).toEqual([
      expect.objectContaining({ offsetMinutes: -540, nextFireAt: null }),
    ]);
    const back = await client.post(`/api/cards/${card.id}/move`, {
      columnId: board.columns[0]?.id,
      index: 0,
    });
    const { card: reopened } = await back.json<{ card: CardDetail }>();
    // Todo el día: a las 9:00 de Madrid (07:00 UTC en verano).
    expect(reopened.reminders[0]?.nextFireAt).toBe("2099-05-12T07:00:00.000Z");
  });

  it("el aviso dice cuándo vence, el tablero y abre la tarjeta", async () => {
    const { client, userId, board } = await setup("Trabajo <equipo>");
    await linkChat(db(), env, userId, String(newChatId()));
    const card = await cardWithDue(client, board, "Revisar <contrato>", {
      allDay: false,
      at: "2027-05-10T15:00:00Z",
    });
    const reminderId = card.reminders[0]?.id ?? "";
    const { client: telegram, calls } = fakeClient();
    const message: NotificationMessage = {
      type: "reminder",
      idempotencyKey: `r:${reminderId}:${String(at("2027-05-10T14:00:00Z"))}`,
      ownerId: userId,
      reminderId,
      occurrenceStart: at("2027-05-10T15:00:00Z"),
      fireAt: at("2027-05-10T14:00:00Z"),
      snoozed: false,
    };
    const result = await deliver(
      { db: db(), env, telegram, logger, now: at("2027-05-10T14:00:00Z") },
      message,
    );
    expect(result).toEqual({ status: "sent" });
    expect(calls[0]?.body.text).toBe(
      "📌 <b>Revisar &lt;contrato&gt;</b>\nvence hoy a las 17:00 · Trabajo &lt;equipo&gt;",
    );

    // Archivada, ya no se avisa.
    await client.post(`/api/cards/${card.id}/archive`);
    const again = await deliver(
      { db: db(), env, telegram, logger, now: at("2027-05-10T14:00:00Z") },
      { ...message, idempotencyKey: `${message.idempotencyKey}:2` },
    );
    expect(again.status).not.toBe("sent");
  });
});

describe("tareas en Telegram (F4-11)", () => {
  let telegram: ReturnType<typeof interceptTelegram>;
  beforeEach(() => {
    telegram = interceptTelegram();
  });
  afterEach(() => telegram.restore());

  it("/tareas muestra las vencidas y las de los próximos 7 días, sin las terminadas", async () => {
    const user = await registerUser();
    const response = await user.client.post("/api/me/telegram/link");
    const { url } = await response.json<{ url: string }>();
    const chatId = newChatId();
    await postUpdate(textUpdate(chatId, `/start ${url.split("start=")[1] ?? ""}`));
    const board = await (
      await user.client.post("/api/boards", { name: "Casa", template: "personal" })
    ).json<BoardDetail>();

    const today = localToday(Date.now(), "Europe/Madrid");
    const plus = (days: number) =>
      new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
    await cardWithDue(user.client, board, "Pagar <luz>", { allDay: true, at: plus(-2) });
    await cardWithDue(user.client, board, "Comprar regalo", { allDay: true, at: plus(1) });
    await cardWithDue(user.client, board, "Muy lejos", { allDay: true, at: plus(30) });
    await cardWithDue(user.client, board, "Ya hecha", { allDay: true, at: plus(1) }, 2);
    await cardWithDue(user.client, board, "Sin fecha", null);

    await postUpdate(textUpdate(chatId, "/tareas"));
    const text = telegram.lastText();
    expect(text).toContain("Vencidas");
    expect(text).toContain("Pagar &lt;luz&gt;");
    expect(text).toContain("mañana");
    expect(text).toContain("Comprar regalo <i>· Casa</i>");
    expect(text).not.toContain("Muy lejos");
    expect(text).not.toContain("Ya hecha");
    expect(text).not.toContain("Sin fecha");
    expect(text.indexOf("Pagar")).toBeLessThan(text.indexOf("Comprar"));
  });
});
