import { instantToWall } from "@delyra/shared";
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, ne, or } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  notificationDeliveries,
  type Reminder,
  reminders,
  telegramLinks,
  telegramUpdates,
  userSettings,
} from "../db/schema";
import type { Logger } from "../lib/logger";
import { eventRepository } from "../repositories/events";
import { kanbanRepository } from "../repositories/kanban";
import { toSeries } from "../services/events";
import { cardSeries } from "../services/kanban";
import type { NotificationMessage } from "../services/notifications";
import { nextFire } from "../services/reminder-schedule";
import { purgeLinkTokens } from "../services/telegram-links";

/**
 * Planificador de alertas (F3-05) y del resumen diario (F3-09). Lo lanza el Cron Trigger cada
 * minuto.
 *
 * 1. Reclama las alertas vencidas de forma atómica (`UPDATE … RETURNING` sobre `enqueued_at`).
 * 2. Las envía a la cola con clave de idempotencia (`r:<alerta>:<instante>`).
 * 3. Calcula la siguiente ocurrencia y libera la alerta.
 * Si algo falla entre 1 y 3, la alerta queda reclamada y se recupera pasados unos minutos; la
 * clave de idempotencia evita que llegue dos veces.
 */

export const BATCH_SIZE = 100;
export const STALE_CLAIM_MS = 5 * 60_000;

export interface SchedulerDeps {
  db: Database;
  now: number;
  send: (messages: NotificationMessage[]) => Promise<void>;
  logger: Logger;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ¿`time` cae en las horas de silencio? Admite rangos que pasan la medianoche (23:00–07:00). */
export function inQuietHours(time: string, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  return start < end ? time >= start && time < end : time >= start || time < end;
}

async function sendAll(deps: SchedulerDeps, messages: NotificationMessage[]) {
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    await deps.send(messages.slice(i, i + BATCH_SIZE));
  }
}

async function claimDueReminders(deps: SchedulerDeps): Promise<Reminder[]> {
  const { db, now } = deps;
  const claimable = and(
    eq(reminders.status, "scheduled"),
    lte(reminders.nextFireAt, now),
    or(isNull(reminders.enqueuedAt), lt(reminders.enqueuedAt, now - STALE_CLAIM_MS)),
  );
  const due = db
    .select({ id: reminders.id })
    .from(reminders)
    .where(claimable)
    .orderBy(asc(reminders.nextFireAt))
    .limit(BATCH_SIZE);
  // La condición se repite en el UPDATE: dos ejecuciones simultáneas no reclaman la misma.
  return db
    .update(reminders)
    .set({ enqueuedAt: now })
    .where(and(inArray(reminders.id, due), claimable))
    .returning();
}

async function advance(deps: SchedulerDeps, reminder: Reminder) {
  const events = eventRepository(deps.db, reminder.ownerId);
  if (reminder.targetType === "card") {
    // Una fecha límite avisa una vez; terminada o archivada, ya no.
    const card = await kanbanRepository(deps.db, reminder.ownerId).getCard(reminder.targetId);
    const series = card && !card.completedAt && !card.archivedAt ? cardSeries(card) : null;
    const after = Math.max(deps.now, reminder.nextFireAt ?? deps.now);
    await events.setNextFire(
      reminder.id,
      series ? nextFire(series, [], reminder.offsetMinutes, after) : null,
    );
    return;
  }
  const event = reminder.targetType === "event" ? await events.get(reminder.targetId) : null;
  if (!event) {
    await events.setNextFire(reminder.id, null);
    return;
  }
  const overrides = (await events.overridesOf(event.id)).map((o) => ({
    originalStart: o.originalStart ?? o.startAt,
    startAt: o.startAt,
    allDay: o.allDay,
  }));
  // Si el cron estuvo parado, no se recuperan las ocurrencias pasadas: se sigue desde ahora.
  const after = Math.max(deps.now, reminder.nextFireAt ?? deps.now);
  await events.setNextFire(
    reminder.id,
    nextFire(toSeries(event), overrides, reminder.offsetMinutes, after),
  );
}

async function processReminders(deps: SchedulerDeps): Promise<number> {
  const claimed = await claimDueReminders(deps);
  const messages: NotificationMessage[] = claimed
    .filter((r) => r.nextFireAt !== null)
    .map((r) => ({
      type: "reminder",
      idempotencyKey: `r:${r.id}:${String(r.nextFireAt)}`,
      ownerId: r.ownerId,
      reminderId: r.id,
      occurrenceStart: r.nextOccurrenceStart ?? (r.nextFireAt ?? 0) + r.offsetMinutes * 60_000,
      fireAt: r.nextFireAt ?? deps.now,
      snoozed: false,
    }));
  await sendAll(deps, messages);
  for (const reminder of claimed) {
    try {
      await advance(deps, reminder);
    } catch (error) {
      deps.logger.error("reminder_advance_failed", { error });
    }
  }
  return messages.length;
}

async function processSnoozes(deps: SchedulerDeps): Promise<number> {
  const { db, now } = deps;
  const due = await db
    .select()
    .from(reminders)
    .where(and(isNotNull(reminders.snoozeUntil), lte(reminders.snoozeUntil, now)))
    .limit(BATCH_SIZE);
  const messages: NotificationMessage[] = due.map((r) => ({
    type: "reminder",
    idempotencyKey: `s:${r.id}:${String(r.snoozeUntil)}`,
    ownerId: r.ownerId,
    reminderId: r.id,
    occurrenceStart: r.snoozeOccurrenceStart ?? r.nextOccurrenceStart ?? now,
    fireAt: r.snoozeUntil ?? now,
    snoozed: true,
  }));
  // Primero se envía y después se limpia: un fallo entre medias repite la clave, no el aviso.
  await sendAll(deps, messages);
  for (const r of due) {
    await db
      .update(reminders)
      .set({ snoozeUntil: null, snoozeOccurrenceStart: null })
      .where(and(eq(reminders.id, r.id), eq(reminders.snoozeUntil, r.snoozeUntil ?? 0)));
  }
  return messages.length;
}

async function processDigests(deps: SchedulerDeps): Promise<number> {
  const { db, now } = deps;
  const rows = await db
    .select({ link: telegramLinks, timeZone: userSettings.timeZone })
    .from(telegramLinks)
    .innerJoin(userSettings, eq(userSettings.userId, telegramLinks.userId))
    .where(isNotNull(telegramLinks.digestTime));
  const messages: NotificationMessage[] = [];
  for (const { link, timeZone } of rows) {
    const wall = instantToWall(now, timeZone);
    const today = `${String(wall.year)}-${pad(wall.month)}-${pad(wall.day)}`;
    const time = `${pad(wall.hour)}:${pad(wall.minute)}`;
    const due =
      link.digestTime !== null &&
      time >= link.digestTime &&
      link.lastDigestOn !== today &&
      // Las horas de silencio retrasan el resumen hasta que terminan.
      !inQuietHours(time, link.quietStart, link.quietEnd) &&
      !(link.mutedUntil !== null && link.mutedUntil > now);
    if (!due) continue;
    const claimed = await db
      .update(telegramLinks)
      .set({ lastDigestOn: today })
      .where(
        and(
          eq(telegramLinks.userId, link.userId),
          or(isNull(telegramLinks.lastDigestOn), ne(telegramLinks.lastDigestOn, today)),
        ),
      )
      .returning({ userId: telegramLinks.userId });
    if (claimed.length === 1) {
      messages.push({
        type: "digest",
        idempotencyKey: `d:${link.userId}:${today}`,
        ownerId: link.userId,
        date: today,
      });
    }
  }
  await sendAll(deps, messages);
  return messages.length;
}

async function housekeeping(deps: SchedulerDeps) {
  const { db, now } = deps;
  await db.delete(telegramUpdates).where(lt(telegramUpdates.receivedAt, now - 2 * 86_400_000));
  await db
    .delete(notificationDeliveries)
    .where(lt(notificationDeliveries.createdAt, now - 30 * 86_400_000));
  await purgeLinkTokens(db, now);
}

export async function runScheduler(deps: SchedulerDeps) {
  const result = {
    reminders: await processReminders(deps),
    snoozes: await processSnoozes(deps),
    digests: await processDigests(deps),
  };
  // Limpieza una vez por hora.
  if (new Date(deps.now).getUTCMinutes() === 0) await housekeeping(deps);
  return result;
}
