import { newId } from "@delyra/shared";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Database } from "../db/client";
import { type EventRow, events, type Reminder, reminders } from "../db/schema";

/**
 * Eventos y alertas de un usuario (F2-02). Como en todos los repositorios, cada consulta filtra
 * por `ownerId`; los eventos borrados (`deleted_at`) no existen para el resto de la aplicación.
 */

export type NewEvent = Omit<EventRow, "id" | "ownerId" | "createdAt" | "updatedAt" | "deletedAt">;

export interface RangeFilter {
  calendarIds?: readonly string[];
  type?: EventRow["type"];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function eventRepository(db: Database, ownerId: string) {
  const live = and(eq(events.ownerId, ownerId), isNull(events.deletedAt));
  const filters = (filter: RangeFilter): SQL[] => [
    ...(filter.calendarIds ? [inArray(events.calendarId, [...filter.calendarIds])] : []),
    ...(filter.type ? [eq(events.type, filter.type)] : []),
  ];

  return {
    async get(id: string): Promise<EventRow | null> {
      const [row] = await db
        .select()
        .from(events)
        .where(and(live, eq(events.id, id)))
        .limit(1);
      return row ?? null;
    },

    async insert(input: NewEvent): Promise<EventRow> {
      const now = new Date();
      const [row] = await db
        .insert(events)
        .values({ ...input, id: newId(), ownerId, createdAt: now, updatedAt: now })
        .returning();
      if (!row) throw new Error("No se pudo crear el evento");
      return row;
    },

    async update(id: string, patch: Partial<NewEvent>): Promise<EventRow | null> {
      const [row] = await db
        .update(events)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(live, eq(events.id, id)))
        .returning();
      return row ?? null;
    },

    /** Borra un evento y, si es una serie, sus excepciones. */
    async softDelete(id: string): Promise<void> {
      const now = new Date();
      await db
        .update(events)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(live, or(eq(events.id, id), eq(events.recurringEventId, id))));
    },

    // ── Excepciones de una serie ─────────────────────────────────────────────

    async overridesOf(seriesId: string): Promise<EventRow[]> {
      return db
        .select()
        .from(events)
        .where(and(live, eq(events.recurringEventId, seriesId)))
        .orderBy(asc(events.originalStart));
    },

    async findOverride(seriesId: string, originalStart: number): Promise<EventRow | null> {
      const [row] = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.ownerId, ownerId),
            eq(events.recurringEventId, seriesId),
            eq(events.originalStart, originalStart),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    /** Las excepciones se borran de verdad (la ocurrencia pasa a `exdates` o vuelve a la regla). */
    async deleteOverrides(seriesId: string, fromOriginalStart?: number): Promise<void> {
      await db
        .delete(events)
        .where(
          and(
            eq(events.ownerId, ownerId),
            eq(events.recurringEventId, seriesId),
            fromOriginalStart === undefined
              ? undefined
              : gte(events.originalStart, fromOriginalStart),
          ),
        );
    },

    async deleteOverride(id: string): Promise<void> {
      await db
        .delete(events)
        .where(
          and(eq(events.ownerId, ownerId), eq(events.id, id), isNotNull(events.recurringEventId)),
        );
    },

    // ── Importación (F5-02, F5-06) ────────────────────────────────────────────

    /**
     * Series y eventos sueltos con alguno de estos UID. Con `calendarId`, solo los de ese
     * calendario (suscripción); sin él, los de cualquier calendario del usuario que se pueda
     * escribir (una importación repetida actualiza el evento donde esté).
     */
    async findByUids(
      uids: readonly string[],
      scope: { calendarId: string } | { writableCalendarIds: readonly string[] },
    ): Promise<EventRow[]> {
      if (uids.length === 0) return [];
      const where =
        "calendarId" in scope
          ? eq(events.calendarId, scope.calendarId)
          : scope.writableCalendarIds.length > 0
            ? inArray(events.calendarId, [...scope.writableCalendarIds])
            : sql`0`;
      const rows: EventRow[] = [];
      // D1 admite como mucho 100 parámetros por consulta.
      for (let i = 0; i < uids.length; i += 80) {
        rows.push(
          ...(await db
            .select()
            .from(events)
            .where(
              and(
                live,
                isNull(events.recurringEventId),
                inArray(events.icalUid, uids.slice(i, i + 80)),
                where,
              ),
            )),
        );
      }
      return rows;
    },

    /** Series y eventos sueltos de un calendario con su UID (sincronización de suscripciones). */
    async uidsOfCalendar(calendarId: string): Promise<{ id: string; icalUid: string | null }[]> {
      return db
        .select({ id: events.id, icalUid: events.icalUid })
        .from(events)
        .where(and(live, eq(events.calendarId, calendarId), isNull(events.recurringEventId)));
    },

    /** Borra de verdad (una suscripción refleja el origen; no hay papelera que conservar). */
    async hardDelete(ids: readonly string[]): Promise<void> {
      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        await db.batch([
          db
            .delete(reminders)
            .where(
              and(
                eq(reminders.ownerId, ownerId),
                eq(reminders.targetType, "event"),
                inArray(reminders.targetId, chunk),
              ),
            ),
          db.delete(events).where(and(eq(events.ownerId, ownerId), inArray(events.id, chunk))),
        ]);
      }
    },

    async countInCalendar(calendarId: string): Promise<number> {
      const [row] = await db
        .select({ total: sql<number>`count(*)` })
        .from(events)
        .where(and(live, eq(events.calendarId, calendarId), isNull(events.recurringEventId)));
      return row?.total ?? 0;
    },

    // ── Consultas por rango y búsqueda ─────────────────────────────────────────

    /** Eventos sueltos y series que pueden tener ocurrencias en `[from, to)`. */
    async seriesAndSinglesInRange(
      from: number,
      to: number,
      filter: RangeFilter,
    ): Promise<EventRow[]> {
      const repeating = or(isNotNull(events.rrule), eq(events.type, "birthday"));
      return db
        .select()
        .from(events)
        .where(
          and(
            live,
            isNull(events.recurringEventId),
            lt(events.startAt, to),
            or(
              and(sql`NOT (${repeating})`, gt(events.endAt, from)),
              and(repeating, or(isNull(events.seriesEndAt), gt(events.seriesEndAt, from))),
            ),
            ...filters(filter),
          ),
        );
    },

    /** Excepciones de esas series y las que se movieron a `[from, to)` desde otra fecha. */
    async overridesInRange(
      seriesIds: readonly string[],
      from: number,
      to: number,
      filter: RangeFilter,
    ): Promise<EventRow[]> {
      return db
        .select()
        .from(events)
        .where(
          and(
            live,
            isNotNull(events.recurringEventId),
            or(
              seriesIds.length > 0 ? inArray(events.recurringEventId, [...seriesIds]) : undefined,
              and(lt(events.startAt, to), gt(events.endAt, from)),
            ),
            ...filters(filter),
          ),
        );
    },

    async search(query: string, filter: RangeFilter, limit = 50): Promise<EventRow[]> {
      const pattern = `%${escapeLike(query)}%`;
      return db
        .select()
        .from(events)
        .where(
          and(
            live,
            or(
              sql`${events.title} LIKE ${pattern} ESCAPE '\\'`,
              sql`${events.notes} LIKE ${pattern} ESCAPE '\\'`,
              sql`${events.location} LIKE ${pattern} ESCAPE '\\'`,
            ),
            ...filters(filter),
          ),
        )
        .orderBy(asc(events.startAt))
        .limit(limit);
    },

    /** Eventos de día completo (cambian de zona con las preferencias del usuario). */
    async allDayEvents(): Promise<EventRow[]> {
      return db
        .select()
        .from(events)
        .where(and(live, eq(events.allDay, true), isNull(events.recurringEventId)));
    },

    // ── Alertas ───────────────────────────────────────────────────────────────

    /** Antes de borrar un calendario: sus eventos se van en cascada, sus alertas no (sin FK). */
    async deleteRemindersOfCalendar(calendarId: string): Promise<void> {
      await db.delete(reminders).where(
        and(
          eq(reminders.ownerId, ownerId),
          eq(reminders.targetType, "event"),
          inArray(
            reminders.targetId,
            db
              .select({ id: events.id })
              .from(events)
              .where(and(eq(events.ownerId, ownerId), eq(events.calendarId, calendarId))),
          ),
        ),
      );
    },

    async remindersOf(eventId: string): Promise<Reminder[]> {
      return db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.ownerId, ownerId),
            eq(reminders.targetType, "event"),
            eq(reminders.targetId, eventId),
          ),
        )
        .orderBy(asc(reminders.offsetMinutes));
    },

    async replaceReminders(
      eventId: string,
      rows: readonly Pick<
        Reminder,
        "offsetMinutes" | "channel" | "nextFireAt" | "nextOccurrenceStart"
      >[],
    ): Promise<void> {
      const now = new Date();
      await db.batch([
        db
          .delete(reminders)
          .where(
            and(
              eq(reminders.ownerId, ownerId),
              eq(reminders.targetType, "event"),
              eq(reminders.targetId, eventId),
            ),
          ),
        ...rows.map((row) =>
          db.insert(reminders).values({
            id: newId(),
            ownerId,
            targetType: "event",
            targetId: eventId,
            offsetMinutes: row.offsetMinutes,
            channel: row.channel,
            nextFireAt: row.nextFireAt,
            nextOccurrenceStart: row.nextOccurrenceStart,
            status: row.nextFireAt === null ? "done" : "scheduled",
            createdAt: now,
          }),
        ),
      ]);
    },

    async setNextFire(
      reminderId: string,
      next: { fireAt: number; occurrenceStart: number } | null,
    ): Promise<void> {
      await db
        .update(reminders)
        .set({
          nextFireAt: next?.fireAt ?? null,
          nextOccurrenceStart: next?.occurrenceStart ?? null,
          status: next === null ? "done" : "scheduled",
          enqueuedAt: null,
        })
        .where(and(eq(reminders.ownerId, ownerId), eq(reminders.id, reminderId)));
    },

    async getReminder(reminderId: string): Promise<Reminder | null> {
      const [row] = await db
        .select()
        .from(reminders)
        .where(and(eq(reminders.ownerId, ownerId), eq(reminders.id, reminderId)))
        .limit(1);
      return row ?? null;
    },

    async updateReminder(
      reminderId: string,
      patch: Partial<Pick<Reminder, "snoozeUntil" | "snoozeOccurrenceStart" | "lastFiredAt">>,
    ): Promise<void> {
      await db
        .update(reminders)
        .set(patch)
        .where(and(eq(reminders.ownerId, ownerId), eq(reminders.id, reminderId)));
    },
  };
}

export type EventRepository = ReturnType<typeof eventRepository>;
