import type { CalendarInfo, EventDetail } from "@delyra/shared";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { reminders } from "../src/db/schema";
import { inQuietHours, runScheduler } from "../src/jobs/scheduler";
import { createLogger } from "../src/lib/logger";
import type { NotificationMessage } from "../src/services/notifications";
import { linkChat, updateLink } from "../src/services/telegram-links";
import { registerUser, type TestClient } from "./helpers";
import { newChatId } from "./telegram-fake";

const at = (value: string) => Date.parse(value);
const db = () => createDb(env.DB);

async function run(now: number) {
  const sent: NotificationMessage[] = [];
  const result = await runScheduler({
    db: db(),
    now,
    send: (messages) => {
      sent.push(...messages);
      return Promise.resolve();
    },
    logger: createLogger({ test: "scheduler" }),
  });
  return { sent, result };
}

async function userWithEvent(body: Record<string, unknown>) {
  const { client } = await registerUser();
  const { calendars } = await (
    await client.get("/api/calendars")
  ).json<{
    calendars: CalendarInfo[];
  }>();
  const response = await client.post("/api/events", {
    calendarId: calendars.find((c) => c.kind === "personal")?.id,
    title: "Reunión",
    tz: "Europe/Madrid",
    allDay: false,
    reminders: [{ offsetMinutes: 15 }],
    ...body,
  });
  const { event } = await response.json<{ event: EventDetail }>();
  const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
  return { client, event, reminderId: event.reminders[0]?.id ?? "", userId: me.user.id };
}

const mine = (sent: NotificationMessage[], reminderId: string) =>
  sent.filter((m) => m.type === "reminder" && m.reminderId === reminderId);

async function reminderRow(id: string) {
  const [row] = await db().select().from(reminders).where(eq(reminders.id, id));
  return row;
}

describe("planificador de alertas (F3-05)", () => {
  it("avisa una sola vez al vencer y pasa a la siguiente ocurrencia", async () => {
    const { reminderId } = await userWithEvent({
      start: "2027-03-01T09:00:00Z", // lunes 10:00 en Madrid
      end: "2027-03-01T10:00:00Z",
      rrule: "FREQ=WEEKLY",
    });
    expect(mine((await run(at("2027-03-01T08:44:00Z"))).sent, reminderId)).toHaveLength(0);

    const due = mine((await run(at("2027-03-01T08:45:00Z"))).sent, reminderId);
    expect(due).toEqual([
      expect.objectContaining({
        idempotencyKey: `r:${reminderId}:${String(at("2027-03-01T08:45:00Z"))}`,
        occurrenceStart: at("2027-03-01T09:00:00Z"),
        snoozed: false,
      }),
    ]);
    const row = await reminderRow(reminderId);
    expect(row?.nextFireAt).toBe(at("2027-03-08T08:45:00Z"));
    expect(row?.enqueuedAt).toBeNull();

    expect(mine((await run(at("2027-03-01T08:46:00Z"))).sent, reminderId)).toHaveLength(0);
  });

  it("tras el cambio de horario sigue avisando a la hora local", async () => {
    const { reminderId } = await userWithEvent({
      start: "2027-03-22T09:00:00Z", // lunes 10:00 CET
      end: "2027-03-22T10:00:00Z",
      rrule: "FREQ=WEEKLY",
    });
    await run(at("2027-03-22T08:45:00Z"));
    expect((await reminderRow(reminderId))?.nextFireAt).toBe(at("2027-03-29T07:45:00Z")); // 09:45 CEST
  });

  it("un evento suelto queda como hecho después de avisar", async () => {
    const { reminderId } = await userWithEvent({
      start: "2027-04-01T09:00:00Z",
      end: "2027-04-01T10:00:00Z",
    });
    await run(at("2027-04-01T08:45:00Z"));
    expect(await reminderRow(reminderId)).toMatchObject({ status: "done", nextFireAt: null });
  });

  it("recupera una alerta reclamada que no llegó a completarse, con la misma clave", async () => {
    const { reminderId } = await userWithEvent({
      start: "2027-05-03T09:00:00Z",
      end: "2027-05-03T10:00:00Z",
    });
    const fire = at("2027-05-03T08:45:00Z");
    // Simula una caída justo después de reclamarla.
    await db().update(reminders).set({ enqueuedAt: fire }).where(eq(reminders.id, reminderId));
    expect(mine((await run(fire + 60_000)).sent, reminderId)).toHaveLength(0);
    const retried = mine((await run(fire + 6 * 60_000)).sent, reminderId);
    expect(retried).toEqual([
      expect.objectContaining({ idempotencyKey: `r:${reminderId}:${String(fire)}` }),
    ]);
  });

  it("si el cron estuvo parado no repite las ocurrencias pasadas", async () => {
    const { reminderId } = await userWithEvent({
      start: "2027-06-01T09:00:00Z",
      end: "2027-06-01T10:00:00Z",
      rrule: "FREQ=DAILY",
    });
    const now = at("2027-06-04T12:00:00Z");
    expect(mine((await run(now)).sent, reminderId)).toHaveLength(1);
    expect((await reminderRow(reminderId))?.nextFireAt).toBe(at("2027-06-05T08:45:00Z"));
    expect(mine((await run(now + 60_000)).sent, reminderId)).toHaveLength(0);
  });

  it("envía las alertas pospuestas y las limpia", async () => {
    const { reminderId } = await userWithEvent({
      start: "2027-07-01T09:00:00Z",
      end: "2027-07-01T10:00:00Z",
    });
    const until = at("2027-07-01T09:10:00Z");
    await db()
      .update(reminders)
      .set({ snoozeUntil: until, snoozeOccurrenceStart: at("2027-07-01T09:00:00Z") })
      .where(eq(reminders.id, reminderId));
    const sent = mine((await run(until)).sent, reminderId).filter(
      (m) => m.type === "reminder" && m.snoozed,
    );
    expect(sent).toEqual([
      expect.objectContaining({
        idempotencyKey: `s:${reminderId}:${String(until)}`,
        occurrenceStart: at("2027-07-01T09:00:00Z"),
      }),
    ]);
    expect((await reminderRow(reminderId))?.snoozeUntil).toBeNull();
  });
});

describe("resumen diario (F3-09)", () => {
  async function linked(client: TestClient) {
    const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    await linkChat(db(), env, me.user.id, String(newChatId()));
    return me.user.id;
  }
  const digests = (sent: NotificationMessage[], userId: string) =>
    sent.filter((m) => m.type === "digest" && m.ownerId === userId);

  it("sale a la hora elegida, una vez al día", async () => {
    const { client } = await registerUser();
    const userId = await linked(client);
    await updateLink(db(), userId, { digestTime: "08:00" });
    expect(digests((await run(at("2027-03-01T06:59:00Z"))).sent, userId)).toHaveLength(0);
    expect(digests((await run(at("2027-03-01T07:00:00Z"))).sent, userId)).toEqual([
      expect.objectContaining({ date: "2027-03-01", idempotencyKey: `d:${userId}:2027-03-01` }),
    ]);
    expect(digests((await run(at("2027-03-01T07:01:00Z"))).sent, userId)).toHaveLength(0);
    expect(digests((await run(at("2027-03-02T07:00:00Z"))).sent, userId)).toHaveLength(1);
  });

  it("las horas de silencio lo retrasan hasta que terminan", async () => {
    const { client } = await registerUser();
    const userId = await linked(client);
    await updateLink(db(), userId, { digestTime: "08:00", quietStart: "22:00", quietEnd: "09:00" });
    expect(digests((await run(at("2027-03-01T07:00:00Z"))).sent, userId)).toHaveLength(0);
    expect(digests((await run(at("2027-03-01T08:00:00Z"))).sent, userId)).toHaveLength(1);
  });

  it("calcula bien las horas de silencio que cruzan la medianoche", () => {
    expect(inQuietHours("23:30", "23:00", "07:00")).toBe(true);
    expect(inQuietHours("06:59", "23:00", "07:00")).toBe(true);
    expect(inQuietHours("07:00", "23:00", "07:00")).toBe(false);
    expect(inQuietHours("13:00", "12:00", "14:00")).toBe(true);
    expect(inQuietHours("13:00", null, null)).toBe(false);
  });
});
