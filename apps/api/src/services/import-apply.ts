import { BIRTHDAY_DEFAULT_REMINDERS } from "@delyra/shared";
import type { EventRow } from "../db/schema";
import type { ImportedEvent } from "../lib/import-model";
import { isOccurrenceStart, seriesEnd } from "../lib/recurrence";
import type { NewEvent } from "../repositories/events";
import { type EventContext, saveReminders, toSeries } from "./events";

/**
 * Aplica eventos ya convertidos (`ImportedEvent`) a la base de datos (F5-02, F5-05, F5-06).
 *
 * - Sin duplicados: una serie o evento suelto se identifica por su UID. Si ya existe (en
 *   cualquier calendario del usuario, o en el de la suscripción), se actualiza; si no ha
 *   cambiado nada, no se toca.
 * - Las excepciones (`RECURRENCE-ID`) se guardan como las de F2-05: un evento con
 *   `recurring_event_id` y `original_start`.
 * - El calendario de destino se crea solo cuando hace falta insertar algo en él.
 */

export interface ApplyCounts {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export interface ApplyOptions {
  /** Calendario de destino para los eventos nuevos (se crea al primer uso). */
  target: () => Promise<string>;
  /** Dónde buscar los existentes por UID. */
  scope: { calendarId: string } | { writableCalendarIds: readonly string[] };
  /** Importar las alertas del origen como avisos de Telegram. */
  reminders: boolean;
  /**
   * Suscripción: el origen manda (los borrados locales se sustituyen por los del origen).
   * Importación: se respetan las ocurrencias que el usuario ya hubiera borrado.
   */
  mirror: boolean;
}

export const emptyCounts = (): ApplyCounts => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
});

function parseExdates(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

function seriesEndOf(fields: NewEvent): number | null {
  return seriesEnd(
    toSeries({
      ...fields,
      id: "",
      ownerId: "",
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }),
  );
}

function fieldsFrom(event: ImportedEvent, calendarId: string, uid: string | null): NewEvent {
  const birthday = event.type === "birthday";
  const fields: NewEvent = {
    calendarId,
    type: event.type,
    title: event.title,
    notes: event.notes,
    location: event.location,
    url: event.url,
    startAt: event.startAt,
    endAt: event.endAt,
    tz: event.tz,
    allDay: birthday ? true : event.allDay,
    rrule: birthday ? "FREQ=YEARLY" : event.rrule,
    exdates: JSON.stringify(event.exdates),
    seriesEndAt: null,
    recurringEventId: null,
    originalStart: null,
    birthYear: null,
    feb29Rule: birthday ? event.feb29Rule : null,
    icalUid: uid,
  };
  fields.seriesEndAt = seriesEndOf(fields);
  return fields;
}

const SAME_KEYS = [
  "type",
  "title",
  "notes",
  "location",
  "url",
  "startAt",
  "endAt",
  "tz",
  "allDay",
  "rrule",
  "exdates",
  "feb29Rule",
] as const satisfies readonly (keyof NewEvent)[];

function sameContent(row: EventRow, next: NewEvent): boolean {
  return SAME_KEYS.every((key) => row[key] === next[key]);
}

/** Merece la pena guardar alertas: la serie no ha terminado ya. */
function stillRelevant(fields: NewEvent, now: number): boolean {
  return fields.seriesEndAt === null || fields.seriesEndAt > now;
}

function reminderInputs(event: ImportedEvent, options: ApplyOptions) {
  if (!options.reminders) return [];
  const offsets =
    event.reminders.length > 0 || event.type !== "birthday"
      ? event.reminders
      : BIRTHDAY_DEFAULT_REMINDERS.map((r) => r.offsetMinutes);
  return offsets.map((offsetMinutes) => ({ offsetMinutes, channel: "telegram" as const }));
}

async function sameReminders(ctx: EventContext, row: EventRow, offsets: readonly number[]) {
  const current = (await ctx.events.remindersOf(row.id)).map((r) => r.offsetMinutes);
  return (
    current.length === offsets.length &&
    [...current].sort((a, b) => a - b).join() === [...offsets].sort((a, b) => a - b).join()
  );
}

export async function applyImportedEvents(
  ctx: EventContext,
  events: readonly ImportedEvent[],
  options: ApplyOptions,
): Promise<ApplyCounts> {
  const now = ctx.now ?? Date.now();
  const counts = emptyCounts();
  const uids = [...new Set(events.map((e) => e.uid))];
  const existing = new Map(
    (await ctx.events.findByUids(uids, options.scope)).map((row) => [row.icalUid ?? "", row]),
  );

  // 1. Series y eventos sueltos.
  for (const event of events) {
    if (event.recurrenceId !== null) continue;
    const found = existing.get(event.uid);
    if (found) {
      const next = fieldsFrom(event, found.calendarId, event.uid);
      if (!options.mirror) {
        // Las ocurrencias que el usuario borró siguen borradas.
        const merged = [...new Set([...parseExdates(found.exdates), ...event.exdates])].sort(
          (a, b) => a - b,
        );
        next.exdates = JSON.stringify(merged);
      }
      const inputs = reminderInputs(event, options);
      const remindersChanged =
        options.reminders &&
        stillRelevant(next, now) &&
        !(await sameReminders(
          ctx,
          found,
          inputs.map((i) => i.offsetMinutes),
        ));
      if (sameContent(found, next) && !remindersChanged) {
        counts.unchanged++;
        continue;
      }
      const updated = await ctx.events.update(found.id, next);
      if (!updated) {
        counts.skipped++;
        continue;
      }
      // Una ocurrencia borrada ya no puede tener excepción.
      for (const override of await ctx.events.overridesOf(found.id)) {
        if (parseExdates(updated.exdates).includes(override.originalStart ?? -1)) {
          await ctx.events.deleteOverride(override.id);
        }
      }
      await saveReminders(ctx, updated, remindersChanged ? inputs : undefined);
      existing.set(event.uid, updated);
      counts.updated++;
      continue;
    }
    const fields = fieldsFrom(event, await options.target(), event.uid);
    const row = await ctx.events.insert(fields);
    existing.set(event.uid, row);
    if (stillRelevant(fields, now)) {
      const inputs = reminderInputs(event, options);
      if (inputs.length > 0) await saveReminders(ctx, row, inputs);
    }
    counts.created++;
  }

  // 2. Excepciones de series (después: necesitan su serie).
  for (const event of events) {
    if (event.recurrenceId === null) continue;
    const master = existing.get(event.uid);
    const isSeries = master && (master.rrule !== null || master.type === "birthday");
    if (!master || !isSeries || !isOccurrenceStart(toSeries(master), event.recurrenceId)) {
      // Sin su serie (o la ocurrencia no existe en ella): se importa como evento suelto.
      const standalone = {
        ...event,
        uid: `${event.uid}#${String(event.recurrenceId)}`,
        recurrenceId: null,
      };
      const result = await applyImportedEvents(ctx, [standalone], options);
      counts.created += result.created;
      counts.updated += result.updated;
      counts.unchanged += result.unchanged;
      counts.skipped += result.skipped;
      continue;
    }
    if (parseExdates(master.exdates).includes(event.recurrenceId)) {
      counts.skipped++;
      continue;
    }
    const next: NewEvent = {
      ...fieldsFrom(event, master.calendarId, null),
      type: master.type,
      rrule: null,
      exdates: "[]",
      recurringEventId: master.id,
      originalStart: event.recurrenceId,
      seriesEndAt: event.endAt,
    };
    const override = await ctx.events.findOverride(master.id, event.recurrenceId);
    if (override && sameContent(override, next)) {
      counts.unchanged++;
      continue;
    }
    if (override) await ctx.events.update(override.id, next);
    else await ctx.events.insert(next);
    await saveReminders(ctx, master);
    if (override) counts.updated++;
    else counts.created++;
  }
  return counts;
}
