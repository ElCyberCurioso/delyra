import type { CalendarInfo, EventDetail } from "@delyra/shared";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { reminders } from "../src/db/schema";
import { handleNotificationBatch } from "../src/jobs/notifications-consumer";
import { createLogger } from "../src/lib/logger";
import { TelegramError } from "../src/lib/telegram";
import { deliver, type NotificationMessage } from "../src/services/notifications";
import { getLink, linkChat, updateLink } from "../src/services/telegram-links";
import { registerUser } from "./helpers";
import { fakeClient, interceptTelegram, newChatId } from "./telegram-fake";

const db = () => createDb(env.DB);
const logger = createLogger({ test: "notifications" });

async function setup() {
  const { client } = await registerUser();
  const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
  const userId = me.user.id;
  const chatId = String(newChatId());
  await linkChat(db(), env, userId, chatId);
  const { calendars } = await (
    await client.get("/api/calendars")
  ).json<{
    calendars: CalendarInfo[];
  }>();
  const response = await client.post("/api/events", {
    calendarId: calendars.find((c) => c.kind === "personal")?.id,
    title: "Dentista <revisión>",
    location: "Calle Mayor 1",
    tz: "Europe/Madrid",
    allDay: false,
    start: "2027-03-01T16:30:00Z",
    end: "2027-03-01T17:30:00Z",
    reminders: [{ offsetMinutes: 30 }],
  });
  const { event } = await response.json<{ event: EventDetail }>();
  const reminderId = event.reminders[0]?.id ?? "";
  const message: NotificationMessage = {
    type: "reminder",
    idempotencyKey: `r:${reminderId}:${String(Date.parse("2027-03-01T16:00:00Z"))}`,
    ownerId: userId,
    reminderId,
    occurrenceStart: Date.parse("2027-03-01T16:30:00Z"),
    fireAt: Date.parse("2027-03-01T16:00:00Z"),
    snoozed: false,
  };
  return { userId, chatId, reminderId, message };
}

const deps = (
  telegram: ReturnType<typeof fakeClient>["client"],
  now = Date.parse("2027-03-01T16:00:00Z"),
) => ({
  db: db(),
  env,
  telegram,
  logger,
  now,
});

describe("entrega de alertas (F3-06)", () => {
  it("envía el mensaje en español con la hora local, ubicación y botones", async () => {
    const { chatId, reminderId, message } = await setup();
    const { client, calls } = fakeClient();
    expect(await deliver(deps(client), message)).toEqual({ status: "sent" });
    const [call] = calls;
    expect(call?.body.chatId).toBe(chatId);
    expect(call?.body.text).toBe(
      "🔔 <b>Dentista &lt;revisión&gt;</b>\nhoy, 17:30–18:30 · Personal\n📍 Calle Mayor 1",
    );
    const keyboard = (
      call?.body.options as { replyMarkup: { inline_keyboard: { callback_data?: string }[][] } }
    ).replyMarkup.inline_keyboard.flat();
    expect(keyboard.map((b) => b.callback_data?.split(":")[0])).toEqual([
      "s10",
      "s60",
      "stm",
      "ok",
    ]);
    const [row] = await db().select().from(reminders).where(eq(reminders.id, reminderId));
    expect(row?.lastFiredAt).not.toBeNull();
  });

  it("no envía dos veces la misma clave aunque la cola la repita", async () => {
    const { message } = await setup();
    const { client, calls } = fakeClient();
    await deliver(deps(client), message);
    expect(await deliver(deps(client), message)).toEqual({ status: "skipped" });
    expect(calls).toHaveLength(1);
  });

  it("ante un 429 pide reintentar tras retry_after y después entrega una vez", async () => {
    const { message } = await setup();
    let first = true;
    const { client, calls } = fakeClient(() => {
      if (first) {
        first = false;
        return new TelegramError(429, "Too Many Requests: retry after 7", 7);
      }
      return { message_id: 2 };
    });
    expect(await deliver(deps(client), message, 1)).toEqual({ status: "retry", delaySeconds: 7 });
    expect(await deliver(deps(client), message, 2)).toEqual({ status: "sent" });
    expect(await deliver(deps(client), message, 3)).toEqual({ status: "skipped" });
    expect(calls).toHaveLength(2);
  });

  it("los errores de Telegram 5xx se reintentan con espera creciente", async () => {
    const { message } = await setup();
    const { client } = fakeClient(() => new TelegramError(502, "Bad Gateway"));
    expect(await deliver(deps(client), message, 1)).toEqual({ status: "retry", delaySeconds: 30 });
    expect(await deliver(deps(client), message, 3)).toEqual({ status: "retry", delaySeconds: 120 });
  });

  it("si el usuario bloqueó el bot, se desvincula y no se reintenta", async () => {
    const { userId, message } = await setup();
    const { client } = fakeClient(
      () => new TelegramError(403, "Forbidden: bot was blocked by the user"),
    );
    expect(await deliver(deps(client), message)).toEqual({ status: "skipped" });
    expect(await getLink(db(), userId)).toBeNull();
  });

  it("/silenciar detiene las alertas pero no los avisos de seguridad", async () => {
    const { userId, message } = await setup();
    const now = Date.parse("2027-03-01T16:00:00Z");
    await updateLink(db(), userId, { mutedUntil: now + 3_600_000 });
    const { client, calls } = fakeClient();
    expect(await deliver(deps(client, now), message)).toEqual({ status: "skipped" });
    const security: NotificationMessage = {
      type: "security",
      idempotencyKey: `sec:${userId}:1`,
      ownerId: userId,
      event: "login",
      country: "ES",
      device: "Firefox en Linux",
    };
    expect(await deliver(deps(client, now), security)).toEqual({ status: "sent" });
    expect(String(calls[0]?.body.text)).toContain("Nuevo inicio de sesión");
  });

  it("sin Telegram vinculado no se envía nada", async () => {
    const { userId, message } = await setup();
    await db()
      .delete((await import("../src/db/schema")).telegramLinks)
      .where(eq((await import("../src/db/schema")).telegramLinks.userId, userId));
    const { client, calls } = fakeClient();
    expect(await deliver(deps(client), message)).toEqual({ status: "skipped" });
    expect(calls).toHaveLength(0);
  });
});

describe("consumidor de la cola (F3-06)", () => {
  function batchOf(body: unknown) {
    const message = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      attempts: 1,
      body,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch = {
      queue: "delyra-notifications-local",
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch;
    return { batch, message };
  }

  it("confirma lo entregado y reintenta con la espera de Telegram", async () => {
    const { message: body } = await setup();
    const telegram = interceptTelegram();
    try {
      const ok = batchOf(body);
      await handleNotificationBatch(ok.batch, env);
      expect(ok.message.ack).toHaveBeenCalledOnce();
      expect(telegram.sent()).toHaveLength(1);
    } finally {
      telegram.restore();
    }
  });
});
