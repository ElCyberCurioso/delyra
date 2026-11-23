import type { CalendarInfo, EventDetail, Occurrence, TelegramStatus } from "@delyra/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { reminders, telegramLinks } from "../src/db/schema";
import { localToday } from "../src/services/agenda";
import { registerUser, type TestClient } from "./helpers";
import { env, interceptTelegram, newChatId, postUpdate, textUpdate } from "./telegram-fake";

let telegram: ReturnType<typeof interceptTelegram>;
beforeEach(() => {
  telegram = interceptTelegram();
});
afterEach(() => telegram.restore());

const db = () => createDb(env.DB);

async function linkedUser() {
  const user = await registerUser();
  const response = await user.client.post("/api/me/telegram/link");
  const { url } = await response.json<{ url: string }>();
  const token = url.split("start=")[1] ?? "";
  const chatId = newChatId();
  await postUpdate(textUpdate(chatId, `/start ${token}`));
  const me = await (await user.client.get("/api/auth/me")).json<{ user: { id: string } }>();
  return { ...user, chatId, token, userId: me.user.id };
}

async function personalCalendar(client: TestClient) {
  const { calendars } = await (
    await client.get("/api/calendars")
  ).json<{
    calendars: CalendarInfo[];
  }>();
  return calendars.find((c) => c.kind === "personal")?.id ?? "";
}

describe("webhook (F3-03)", () => {
  it("rechaza las peticiones sin el secreto o con uno equivocado", async () => {
    expect((await postUpdate(textUpdate(1, "/ayuda"), null)).status).toBe(401);
    expect((await postUpdate(textUpdate(1, "/ayuda"), "otro-secreto")).status).toBe(401);
    expect((await postUpdate(textUpdate(1, "/ayuda"))).status).toBe(200);
    expect(telegram.sent()).toHaveLength(1);
  });

  it("descarta los update_id repetidos", async () => {
    const update = { update_id: 555_000, ...textUpdate(newChatId(), "/ayuda") };
    await postUpdate(update);
    await postUpdate(update);
    expect(telegram.sent()).toHaveLength(1);
  });

  it("ignora los grupos: la agenda solo se consulta en privado", async () => {
    await postUpdate(textUpdate(-100123, "/hoy", "group"));
    expect(telegram.sent()).toHaveLength(0);
  });
});

describe("vinculación (F3-04)", () => {
  it("el enlace vincula la cuenta una sola vez y la app muestra el estado", async () => {
    const { client, chatId, token } = await linkedUser();
    expect(telegram.lastText()).toContain("Cuenta vinculada");
    const status = await (await client.get("/api/me/telegram")).json<TelegramStatus>();
    expect(status).toMatchObject({
      available: true,
      linked: true,
      botUsername: "DelyraPruebasBot",
    });

    // El chat cifrado no es el chat_id en claro.
    const [row] = await db()
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.chatHash, telegramLinks.chatHash))
      .limit(50);
    expect(JSON.stringify(row)).not.toContain(String(chatId));

    await postUpdate(textUpdate(newChatId(), `/start ${token}`));
    expect(telegram.lastText()).toContain("no es válido");
  });

  it("sin vincular, los comandos piden vincular la cuenta", async () => {
    await postUpdate(textUpdate(newChatId(), "/hoy"));
    expect(telegram.lastText()).toContain("Primero vincula tu cuenta");
  });

  it("desvincular desde la app o desde el bot", async () => {
    const a = await linkedUser();
    expect((await a.client.delete("/api/me/telegram")).status).toBe(204);
    expect((await (await a.client.get("/api/me/telegram")).json<TelegramStatus>()).linked).toBe(
      false,
    );

    const b = await linkedUser();
    await postUpdate(textUpdate(b.chatId, "/desvincular"));
    expect((await (await b.client.get("/api/me/telegram")).json<TelegramStatus>()).linked).toBe(
      false,
    );
  });

  it("ajustes del resumen diario y de las horas de silencio", async () => {
    const { client } = await linkedUser();
    const patched = await client.request("PATCH", "/api/me/telegram", {
      digestTime: "08:00",
      quietStart: "23:00",
      quietEnd: "07:30",
    });
    expect(await patched.json()).toMatchObject({
      digestTime: "08:00",
      quietStart: "23:00",
      quietEnd: "07:30",
    });
    const invalid = await client.request("PATCH", "/api/me/telegram", { digestTime: "25:00" });
    expect(invalid.status).toBe(422);
    const half = await client.request("PATCH", "/api/me/telegram", { quietStart: "22:00" });
    expect(half.status).toBe(422);
  });

  it("el mensaje de prueba exige tener Telegram vinculado", async () => {
    const { client } = await registerUser();
    expect((await client.post("/api/me/telegram/test")).status).toBe(409);
  });
});

describe("comandos (F3-08)", () => {
  it("/hoy lista los eventos del día en la zona del usuario", async () => {
    const { client, chatId } = await linkedUser();
    const today = localToday(Date.now(), "Europe/Madrid");
    const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10);
    await client.post("/api/events", {
      calendarId: await personalCalendar(client),
      title: "Revisión <importante>",
      tz: "Europe/Madrid",
      allDay: true,
      start: today,
      end: tomorrow,
    });
    await postUpdate(textUpdate(chatId, "/hoy"));
    const text = telegram.lastText();
    expect(text).toContain("Revisión &lt;importante&gt;");
    expect(text).toContain("Todo el día");
  });

  it("/nuevo crea el evento en el calendario Personal", async () => {
    const { client, chatId } = await linkedUser();
    await postUpdate(textUpdate(chatId, "/nuevo Dentista mañana 17:30"));
    expect(telegram.lastText()).toContain("Creado: <b>Dentista</b>");
    const found = await (
      await client.get("/api/events/search?q=Dentista")
    ).json<{
      events: Occurrence[];
    }>();
    expect(found.events).toHaveLength(1);
  });

  it("/silenciar silencia y /silenciar no reactiva", async () => {
    const { client, chatId } = await linkedUser();
    await postUpdate(textUpdate(chatId, "/silenciar 2"));
    expect(telegram.lastText()).toContain("silenciadas");
    expect(
      (await (await client.get("/api/me/telegram")).json<TelegramStatus>()).mutedUntil,
    ).not.toBeNull();
    await postUpdate(textUpdate(chatId, "/silenciar no"));
    expect(
      (await (await client.get("/api/me/telegram")).json<TelegramStatus>()).mutedUntil,
    ).toBeNull();
  });
});

describe("en inglés (F7-06)", () => {
  it("con la cuenta en inglés, el bot contesta en inglés y entiende /today y /new", async () => {
    const { client, chatId } = await linkedUser();
    await client.request("PATCH", "/api/me/settings", {
      timeZone: "Europe/Madrid",
      locale: "en",
      weekStart: 1,
    });
    await postUpdate(textUpdate(chatId, "/today"));
    expect(telegram.lastText()).toContain("📅 Today");
    await postUpdate(textUpdate(chatId, "/new Dentist tomorrow 5:30pm"));
    expect(telegram.lastText()).toContain("Created: <b>Dentist</b>");
    expect(telegram.lastText()).toContain("tomorrow, 17:30–18:30");
    // Los comandos en español siguen valiendo.
    await postUpdate(textUpdate(chatId, "/ayuda"));
    expect(telegram.lastText()).toContain("/today — Today's agenda");
  });

  it("sin cuenta vinculada, usa el idioma de Telegram", async () => {
    const chatId = newChatId();
    await postUpdate({
      message: {
        message_id: 1,
        chat: { id: chatId, type: "private" },
        from: { language_code: "en" },
        text: "/today",
      },
    });
    expect(telegram.lastText()).toContain("First link your account");
  });
});

describe("botones de las alertas (F3-07)", () => {
  async function reminderFor(user: Awaited<ReturnType<typeof linkedUser>>) {
    const response = await user.client.post("/api/events", {
      calendarId: await personalCalendar(user.client),
      title: "Médico",
      tz: "Europe/Madrid",
      allDay: false,
      start: "2027-03-01T09:00:00Z",
      end: "2027-03-01T10:00:00Z",
      reminders: [{ offsetMinutes: 15 }],
    });
    const { event } = await response.json<{ event: EventDetail }>();
    return { reminderId: event.reminders[0]?.id ?? "", start: Date.parse(event.start) };
  }

  const callback = (chatId: number, data: string) => ({
    callback_query: {
      id: `cb-${String(newChatId())}`,
      data,
      message: { message_id: 42, chat: { id: chatId, type: "private" } },
    },
  });

  it("«10 min» pospone y edita el mensaje; «Hecho» lo cierra", async () => {
    const user = await linkedUser();
    const { reminderId, start } = await reminderFor(user);
    const before = Date.now();
    await postUpdate(callback(user.chatId, `s10:${reminderId}:${start.toString(36)}`));
    const [row] = await db().select().from(reminders).where(eq(reminders.id, reminderId));
    expect(row?.snoozeUntil).toBeGreaterThanOrEqual(before + 10 * 60_000);
    expect(row?.snoozeOccurrenceStart).toBe(start);
    const edit = telegram.calls.find((c) => c.method === "editMessageText");
    expect(String(edit?.body.text)).toContain("Pospuesta hasta");
    expect(edit?.body.message_id).toBe(42);

    await postUpdate(callback(user.chatId, `ok:${reminderId}:${start.toString(36)}`));
    const [done] = await db().select().from(reminders).where(eq(reminders.id, reminderId));
    expect(done?.snoozeUntil).toBeNull();
    expect(
      String(telegram.calls.filter((c) => c.method === "editMessageText").at(-1)?.body.text),
    ).toContain("Hecho");
  });

  it("un chat que no es el del dueño no puede usar los botones", async () => {
    const owner = await linkedUser();
    const intruder = await linkedUser();
    const { reminderId, start } = await reminderFor(owner);
    await postUpdate(callback(intruder.chatId, `s60:${reminderId}:${start.toString(36)}`));
    const [row] = await db().select().from(reminders).where(eq(reminders.id, reminderId));
    expect(row?.snoozeUntil).toBeNull();
    const answer = telegram.calls.filter((c) => c.method === "answerCallbackQuery").at(-1);
    expect(String(answer?.body.text)).toContain("ya no está disponible");
  });
});

describe("avisos de seguridad (F3-10)", () => {
  it("un nuevo inicio de sesión y el cambio de contraseña se encolan como aviso", async () => {
    const { vi } = await import("vitest");
    const { PASSWORD, TestClient, nextTotp, TURNSTILE } = await import("./helpers");
    const user = await linkedUser();
    const send = vi.spyOn(env.NOTIFICATIONS, "send");
    try {
      const other = new TestClient();
      await other.post("/api/auth/login", {
        email: user.email,
        password: PASSWORD,
        turnstileToken: TURNSTILE,
      });
      await other.post("/api/auth/login/second-factor", { code: await nextTotp(user.secret) });
      await user.client.post("/api/me/password", {
        currentPassword: PASSWORD,
        newPassword: "otra frase larga y segura",
      });
      const events = send.mock.calls.map(([body]) => (body as { event?: string }).event);
      expect(events).toEqual(expect.arrayContaining(["login", "password_changed"]));
      expect(
        send.mock.calls.every(([body]) => (body as { ownerId: string }).ownerId === user.userId),
      ).toBe(true);
    } finally {
      send.mockRestore();
    }
  });
});
