import {
  BIRTHDAY_DEFAULT_REMINDERS,
  type CreateEventRequest,
  dateOnlyToUtc,
  type EditScope,
  type EventDetail,
  type Occurrence,
  type ReminderInput,
  type UpdateEventRequest,
  utcToDateOnly,
} from "@delyra/shared";
import type { EventRow } from "../db/schema";
import { AppError } from "../lib/errors";
import { invalidField } from "../lib/http";
import {
  checkRrule,
  expandSeries,
  floatingDelta,
  isOccurrenceStart,
  type Series,
  seriesEnd,
  shiftInSeries,
  splitRule,
} from "../lib/recurrence";
import type { CalendarRepository } from "../repositories/calendars";
import type { EventRepository, NewEvent, RangeFilter } from "../repositories/events";
import { nextFire, type ScheduleOverride } from "./reminder-schedule";

/**
 * Lógica de eventos (F2-04, F2-05, F2-06): validación, series con excepciones, cumpleaños y
 * alertas. Recibe repositorios ya ligados al usuario, así que nunca ve datos de otro.
 */

const DAY_MS = 86_400_000;
const YEARLY = "FREQ=YEARLY";

export interface EventContext {
  events: EventRepository;
  calendars: CalendarRepository;
  now?: number;
}

// ── Conversión ───────────────────────────────────────────────────────────────

export function formatTime(ms: number, allDay: boolean): string {
  return allDay ? utcToDateOnly(ms) : new Date(ms).toISOString();
}

function parseTime(value: string, allDay: boolean, path: string): number {
  try {
    const ms = allDay ? dateOnlyToUtc(value) : Date.parse(value);
    if (Number.isNaN(ms)) throw new RangeError();
    return ms;
  } catch {
    throw invalidField(path, allDay ? "Fecha no válida" : "Fecha y hora no válidas");
  }
}

function parseExdates(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

const isSeries = (row: Pick<EventRow, "type" | "rrule">) =>
  row.type === "birthday" || row.rrule !== null;

export function toSeries(row: EventRow): Series {
  return {
    startAt: row.startAt,
    endAt: row.endAt,
    tz: row.tz,
    allDay: row.allDay,
    type: row.type,
    rrule: row.type === "birthday" ? YEARLY : row.rrule,
    exdates: parseExdates(row.exdates),
    birthYear: row.birthYear,
    feb29Rule: row.feb29Rule,
  };
}

function normalizeRrule(value: string | null | undefined): string | null {
  if (!value) return null;
  const result = checkRrule(value);
  if (!result.ok) throw invalidField("rrule", result.message);
  return result.rrule;
}

async function requireCalendar(ctx: EventContext, calendarId: string) {
  // Un calendario ajeno responde igual que uno inexistente.
  if (!(await ctx.calendars.get(calendarId))) {
    throw invalidField("calendarId", "Calendario no encontrado");
  }
}

function birthdayFields(
  startAt: number,
  input: { birthYear?: number | null; feb29Rule?: EventRow["feb29Rule"] },
) {
  const date = new Date(startAt);
  const isFeb29 = date.getUTCMonth() === 1 && date.getUTCDate() === 29;
  const birthYear = input.birthYear ?? null;
  if (birthYear !== null && birthYear > date.getUTCFullYear()) {
    throw invalidField("birthYear", "El año de nacimiento no puede ser posterior a la fecha");
  }
  return {
    endAt: startAt + DAY_MS,
    allDay: true,
    rrule: YEARLY,
    birthYear,
    feb29Rule: isFeb29 ? (input.feb29Rule ?? "feb28") : null,
  };
}

// ── Lectura ──────────────────────────────────────────────────────────────────

function occurrenceDto(
  row: EventRow,
  occurrence: { start: number; end: number; originalStart: number; age: number | null } | null,
  series: EventRow | null,
): Occurrence {
  const base = {
    calendarId: row.calendarId,
    type: row.type,
    title: row.title,
    notes: row.notes,
    location: row.location,
    url: row.url,
    allDay: row.allDay,
    tz: row.tz,
  };
  if (row.recurringEventId !== null && row.originalStart !== null) {
    const master = series ?? row;
    const year = new Date(row.originalStart).getUTCFullYear();
    return {
      ...base,
      id: `${row.recurringEventId}:${String(row.originalStart)}`,
      eventId: row.recurringEventId,
      start: formatTime(row.startAt, row.allDay),
      end: formatTime(row.endAt, row.allDay),
      recurring: true,
      originalStart: formatTime(row.originalStart, master.allDay),
      age: master.type === "birthday" && master.birthYear ? year - master.birthYear : null,
    };
  }
  if (occurrence && isSeries(row)) {
    return {
      ...base,
      id: `${row.id}:${String(occurrence.originalStart)}`,
      eventId: row.id,
      start: formatTime(occurrence.start, row.allDay),
      end: formatTime(occurrence.end, row.allDay),
      recurring: true,
      originalStart: formatTime(occurrence.originalStart, row.allDay),
      age: occurrence.age,
    };
  }
  return {
    ...base,
    id: row.id,
    eventId: row.id,
    start: formatTime(row.startAt, row.allDay),
    end: formatTime(row.endAt, row.allDay),
    recurring: false,
    originalStart: null,
    age: null,
  };
}

/** Ocurrencias que se solapan con `[from, to)`, ya con excepciones y borrados aplicados. */
export async function listOccurrences(
  ctx: EventContext,
  from: number,
  to: number,
  filter: RangeFilter,
): Promise<Occurrence[]> {
  const rows = await ctx.events.seriesAndSinglesInRange(from, to, filter);
  const masters = new Map(rows.filter(isSeries).map((row) => [row.id, row]));
  const overrides = await ctx.events.overridesInRange([...masters.keys()], from, to, filter);
  const overridden = new Set(
    overrides.map((o) => `${o.recurringEventId ?? ""}:${String(o.originalStart)}`),
  );

  const result: Occurrence[] = [];
  for (const row of rows) {
    if (!isSeries(row)) {
      result.push(occurrenceDto(row, null, null));
      continue;
    }
    for (const occurrence of expandSeries(toSeries(row), from, to)) {
      if (!overridden.has(`${row.id}:${String(occurrence.originalStart)}`)) {
        result.push(occurrenceDto(row, occurrence, null));
      }
    }
  }
  for (const override of overrides) {
    if (override.startAt < to && override.endAt > from) {
      result.push(
        occurrenceDto(override, null, masters.get(override.recurringEventId ?? "") ?? null),
      );
    }
  }
  return result.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export async function searchEvents(
  ctx: EventContext,
  query: string,
  filter: RangeFilter,
): Promise<Occurrence[]> {
  const rows = await ctx.events.search(query, filter);
  return rows.map((row) => occurrenceDto(row, null, null));
}

export async function eventDetail(ctx: EventContext, row: EventRow): Promise<EventDetail> {
  const reminders = await ctx.events.remindersOf(row.recurringEventId ?? row.id);
  return {
    id: row.id,
    calendarId: row.calendarId,
    type: row.type,
    title: row.title,
    notes: row.notes,
    location: row.location,
    url: row.url,
    allDay: row.allDay,
    start: formatTime(row.startAt, row.allDay),
    end: formatTime(row.endAt, row.allDay),
    tz: row.tz,
    rrule: row.type === "birthday" ? null : row.rrule,
    recurringEventId: row.recurringEventId,
    birthYear: row.birthYear,
    feb29Rule: row.feb29Rule,
    reminders: reminders.map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      channel: r.channel,
      nextFireAt: r.nextFireAt === null ? null : new Date(r.nextFireAt).toISOString(),
    })),
  };
}

// ── Alertas (F2-07) ──────────────────────────────────────────────────────────

/** Recalcula `next_fire_at` de las alertas de un evento suelto o de una serie. */
export async function saveReminders(
  ctx: EventContext,
  row: EventRow,
  inputs?: readonly ReminderInput[],
): Promise<void> {
  const now = ctx.now ?? Date.now();
  const series = toSeries(row);
  const overrides: ScheduleOverride[] = isSeries(row)
    ? (await ctx.events.overridesOf(row.id)).map((o) => ({
        originalStart: o.originalStart ?? o.startAt,
        startAt: o.startAt,
        allDay: o.allDay,
      }))
    : [];
  const fire = (offsetMinutes: number) => nextFire(series, overrides, offsetMinutes, now);

  if (inputs) {
    const unique = new Map(inputs.map((i) => [`${String(i.offsetMinutes)}:${i.channel}`, i]));
    await ctx.events.replaceReminders(
      row.id,
      [...unique.values()].map((i) => {
        const next = fire(i.offsetMinutes);
        return {
          offsetMinutes: i.offsetMinutes,
          channel: i.channel,
          nextFireAt: next?.fireAt ?? null,
          nextOccurrenceStart: next?.occurrenceStart ?? null,
        };
      }),
    );
    return;
  }
  for (const reminder of await ctx.events.remindersOf(row.id)) {
    await ctx.events.setNextFire(reminder.id, fire(reminder.offsetMinutes));
  }
}

// ── Alta ─────────────────────────────────────────────────────────────────────

export async function createEvent(ctx: EventContext, input: CreateEventRequest): Promise<EventRow> {
  await requireCalendar(ctx, input.calendarId);
  const birthday = input.type === "birthday";
  const allDay = birthday ? true : input.allDay;
  const startAt = parseTime(input.start, allDay, "start");
  const fields: NewEvent = {
    calendarId: input.calendarId,
    type: input.type,
    title: input.title,
    notes: input.notes ?? null,
    location: input.location ?? null,
    url: input.url ?? null,
    startAt,
    endAt: parseTime(input.end, allDay, "end"),
    tz: input.tz,
    allDay,
    rrule: normalizeRrule(input.rrule),
    exdates: "[]",
    seriesEndAt: null,
    recurringEventId: null,
    originalStart: null,
    birthYear: null,
    feb29Rule: null,
    ...(birthday ? birthdayFields(startAt, input) : {}),
  };
  fields.seriesEndAt = seriesEnd(seriesOf(fields));
  const row = await ctx.events.insert(fields);
  await saveReminders(ctx, row, input.reminders ?? (birthday ? BIRTHDAY_DEFAULT_REMINDERS : []));
  return row;
}

function seriesOf(fields: NewEvent): Series {
  return toSeries({
    ...fields,
    id: "",
    ownerId: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
}

// ── Edición ──────────────────────────────────────────────────────────────────

/** Aplica los campos del cambio sobre una base (evento, serie u ocurrencia). */
function applyPatch(base: NewEvent, input: UpdateEventRequest): NewEvent {
  const next: NewEvent = { ...base };
  if (input.calendarId !== undefined) next.calendarId = input.calendarId;
  if (input.title !== undefined) next.title = input.title;
  if (input.notes !== undefined) next.notes = input.notes;
  if (input.location !== undefined) next.location = input.location;
  if (input.url !== undefined) next.url = input.url;
  if (input.tz !== undefined) next.tz = input.tz;
  if (input.allDay !== undefined && input.start === undefined) {
    throw invalidField("start", "Indica el inicio y el fin al cambiar el tipo de horario");
  }
  if (input.start !== undefined && input.end !== undefined) {
    const allDay = base.type === "birthday" ? true : (input.allDay ?? base.allDay);
    next.allDay = allDay;
    next.startAt = parseTime(input.start, allDay, "start");
    next.endAt = parseTime(input.end, allDay, "end");
  }
  if (base.type === "birthday") {
    Object.assign(
      next,
      birthdayFields(next.startAt, {
        birthYear: input.birthYear !== undefined ? input.birthYear : base.birthYear,
        feb29Rule: input.feb29Rule ?? base.feb29Rule,
      }),
    );
  }
  return next;
}

function fieldsOf(row: EventRow): NewEvent {
  const { id: _id, ownerId: _o, createdAt: _c, updatedAt: _u, deletedAt: _d, ...fields } = row;
  return fields;
}

async function loadTarget(ctx: EventContext, id: string) {
  const row = await ctx.events.get(id);
  if (!row) throw new AppError(404);
  if (row.recurringEventId === null) return { master: row, occurrenceStart: null };
  // Una excepción se edita siempre a través de su serie.
  const master = await ctx.events.get(row.recurringEventId);
  if (!master) throw new AppError(404);
  return { master, occurrenceStart: row.originalStart };
}

async function resolveOccurrence(
  ctx: EventContext,
  master: EventRow,
  value: string | undefined,
  fallback: number | null,
): Promise<number> {
  if (value === undefined && fallback !== null) return fallback;
  if (value === undefined) throw invalidField("occurrenceStart", "Indica qué ocurrencia");
  const start = parseTime(value, master.allDay, "occurrenceStart");
  const series = toSeries(master);
  const valid =
    (isOccurrenceStart(series, start) && !series.exdates.includes(start)) ||
    (await ctx.events.findOverride(master.id, start)) !== null;
  if (!valid) throw invalidField("occurrenceStart", "Esa ocurrencia no existe");
  return start;
}

async function updateAll(ctx: EventContext, master: EventRow, input: UpdateEventRequest) {
  const next = applyPatch(fieldsOf(master), input);
  if (input.rrule !== undefined && master.type !== "birthday")
    next.rrule = normalizeRrule(input.rrule);

  const oldSeries = toSeries(master);
  let exdates = oldSeries.exdates;
  const overrides = isSeries(master) ? await ctx.events.overridesOf(master.id) : [];

  if (!isSeries(next)) {
    // Deja de repetirse: queda solo la primera ocurrencia.
    exdates = [];
    await ctx.events.deleteOverrides(master.id);
  } else {
    const newSeries = { ...seriesOf(next), exdates: [] };
    const sameFrame = next.tz === master.tz && next.allDay === master.allDay;
    const delta = sameFrame ? floatingDelta(newSeries, master) : 0;
    const shift = (instant: number) =>
      delta === 0 ? instant : shiftInSeries(newSeries, instant, delta);
    if (!sameFrame) {
      exdates = [];
      await ctx.events.deleteOverrides(master.id);
    } else {
      // Las ocurrencias borradas o movidas siguen apuntando a la suya, si la regla aún la genera.
      exdates = exdates.map(shift).filter((instant) => isOccurrenceStart(newSeries, instant));
      for (const override of overrides) {
        const original = shift(override.originalStart ?? override.startAt);
        if (isOccurrenceStart(newSeries, original)) {
          if (original !== override.originalStart) {
            await ctx.events.update(override.id, { originalStart: original });
          }
        } else {
          await ctx.events.deleteOverride(override.id);
        }
      }
    }
  }
  next.exdates = JSON.stringify(exdates);
  next.seriesEndAt = seriesEnd(seriesOf(next));
  const updated = await ctx.events.update(master.id, next);
  if (!updated) throw new AppError(404);
  await saveReminders(ctx, updated, input.reminders);
  return updated;
}

async function updateThis(
  ctx: EventContext,
  master: EventRow,
  occurrenceStart: number,
  input: UpdateEventRequest,
) {
  if (input.rrule !== undefined) {
    throw invalidField(
      "rrule",
      "La repetición se cambia para toda la serie o desde una ocurrencia",
    );
  }
  const existing = await ctx.events.findOverride(master.id, occurrenceStart);
  const base: NewEvent = existing
    ? fieldsOf(existing)
    : {
        ...fieldsOf(master),
        startAt: occurrenceStart,
        endAt: occurrenceStart + (master.endAt - master.startAt),
        rrule: null,
        exdates: "[]",
        recurringEventId: master.id,
        originalStart: occurrenceStart,
      };
  const next = applyPatch(base, input);
  // Una excepción no se repite: es una ocurrencia suelta que sustituye a la original.
  Object.assign(next, { rrule: null, exdates: "[]", seriesEndAt: next.endAt });
  const saved = existing
    ? await ctx.events.update(existing.id, next)
    : await ctx.events.insert(next);
  if (!saved) throw new AppError(404);
  await saveReminders(ctx, master);
  return saved;
}

async function updateFollowing(
  ctx: EventContext,
  master: EventRow,
  occurrenceStart: number,
  input: UpdateEventRequest,
) {
  const series = toSeries(master);
  const split = splitRule(series, occurrenceStart);
  const base: NewEvent = {
    ...fieldsOf(master),
    startAt: occurrenceStart,
    endAt: occurrenceStart + (master.endAt - master.startAt),
  };
  const next = applyPatch(base, input);
  next.rrule = input.rrule !== undefined ? normalizeRrule(input.rrule) : split.after;

  // Los borrados posteriores pasan a la serie nueva (desplazados si cambia la hora).
  const later = series.exdates.filter((instant) => instant >= occurrenceStart);
  const newSeries = { ...seriesOf(next), exdates: [] };
  const sameFrame = next.tz === master.tz && next.allDay === master.allDay && next.rrule !== null;
  const delta = sameFrame ? floatingDelta(newSeries, { ...master, startAt: occurrenceStart }) : 0;
  next.exdates = JSON.stringify(
    sameFrame
      ? later
          .map((instant) => (delta === 0 ? instant : shiftInSeries(newSeries, instant, delta)))
          .filter((instant) => isOccurrenceStart(newSeries, instant))
      : [],
  );
  next.seriesEndAt = seriesEnd(seriesOf(next));

  const previousReminders = await ctx.events.remindersOf(master.id);
  const beforeFields: Partial<NewEvent> = {
    rrule: split.before,
    exdates: JSON.stringify(series.exdates.filter((instant) => instant < occurrenceStart)),
  };
  beforeFields.seriesEndAt = seriesEnd(seriesOf({ ...fieldsOf(master), ...beforeFields }));
  await ctx.events.deleteOverrides(master.id, occurrenceStart);
  const truncated = await ctx.events.update(master.id, beforeFields);
  const created = await ctx.events.insert(next);
  if (truncated) await saveReminders(ctx, truncated);
  await saveReminders(
    ctx,
    created,
    input.reminders ??
      previousReminders.map((r) => ({ offsetMinutes: r.offsetMinutes, channel: r.channel })),
  );
  return created;
}

/** Edita un evento. En una serie, `scope` decide si afecta a una, a las siguientes o a todas. */
export async function updateEvent(
  ctx: EventContext,
  id: string,
  input: UpdateEventRequest,
): Promise<EventRow> {
  const { master, occurrenceStart } = await loadTarget(ctx, id);
  if (input.calendarId !== undefined) await requireCalendar(ctx, input.calendarId);

  const scope: EditScope = master.type === "birthday" ? "all" : (input.scope ?? "all");
  if (!isSeries(master) || scope === "all") return updateAll(ctx, master, input);

  const start = await resolveOccurrence(ctx, master, input.occurrenceStart, occurrenceStart);
  if (scope === "this") return updateThis(ctx, master, start, input);
  return start <= master.startAt
    ? updateAll(ctx, master, input)
    : updateFollowing(ctx, master, start, input);
}

// ── Borrado ──────────────────────────────────────────────────────────────────

export async function deleteEvent(
  ctx: EventContext,
  id: string,
  requestedScope: EditScope,
  occurrenceValue: string | undefined,
): Promise<void> {
  const { master, occurrenceStart } = await loadTarget(ctx, id);
  // Un cumpleaños se puede quitar un año («solo este») o entero; no tiene «los siguientes».
  const scope: EditScope =
    master.type === "birthday" && requestedScope === "following" ? "all" : requestedScope;
  const deleteAll = async () => {
    await ctx.events.softDelete(master.id);
    await ctx.events.replaceReminders(master.id, []);
  };
  if (!isSeries(master) || scope === "all") return deleteAll();

  const start = await resolveOccurrence(ctx, master, occurrenceValue, occurrenceStart);
  const series = toSeries(master);

  if (scope === "this") {
    const override = await ctx.events.findOverride(master.id, start);
    if (override) await ctx.events.deleteOverride(override.id);
    const updated = await ctx.events.update(master.id, {
      exdates: JSON.stringify([...new Set([...series.exdates, start])].sort((a, b) => a - b)),
    });
    if (updated) await saveReminders(ctx, updated);
    return;
  }

  if (start <= master.startAt) return deleteAll();
  const split = splitRule(series, start);
  const patch: Partial<NewEvent> = {
    rrule: split.before,
    exdates: JSON.stringify(series.exdates.filter((instant) => instant < start)),
  };
  patch.seriesEndAt = seriesEnd(seriesOf({ ...fieldsOf(master), ...patch }));
  await ctx.events.deleteOverrides(master.id, start);
  const updated = await ctx.events.update(master.id, patch);
  if (updated) await saveReminders(ctx, updated);
}

/** Las alertas de día completo dependen de la zona del usuario: se recalculan si la cambia. */
export async function onTimeZoneChanged(ctx: EventContext, timeZone: string): Promise<void> {
  for (const row of await ctx.events.allDayEvents()) {
    if (row.tz === timeZone) continue;
    const updated = await ctx.events.update(row.id, { tz: timeZone });
    if (updated) await saveReminders(ctx, updated);
  }
}
