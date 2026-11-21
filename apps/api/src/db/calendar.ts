import {
  CALENDAR_KINDS,
  EVENT_TYPES,
  FEB29_RULES,
  REMINDER_CHANNELS,
  REMINDER_STATUSES,
  REMINDER_TARGETS,
} from "@delyra/shared";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./identity";

/**
 * Calendario (F2-01). Todas las tablas llevan `owner_id`: la capa de repositorios filtra siempre
 * por él (§3.5).
 *
 * Tiempo:
 * - Eventos con hora: `start_at`/`end_at` son instantes UTC en milisegundos y `tz` es la zona en
 *   la que se definió el evento (las recurrencias se calculan en esa hora local).
 * - Eventos de día completo: `start_at`/`end_at` son medianoches UTC (fecha sin hora) y `end_at`
 *   es exclusivo (un evento de un día termina a la medianoche siguiente).
 */

const quoted = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const calendars = sqliteTable(
  "calendars",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** `#rrggbb` */
    color: text("color").notNull(),
    kind: text("kind", { enum: CALENDAR_KINDS }).notNull().default("custom"),
    visible: integer("visible", { mode: "boolean" }).notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("calendars_owner_idx").on(t.ownerId, t.position),
    check("calendars_kind_check", sql`"kind" IN (${quoted(CALENDAR_KINDS)})`),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    type: text("type", { enum: EVENT_TYPES }).notNull().default("event"),
    title: text("title").notNull(),
    notes: text("notes"),
    location: text("location"),
    url: text("url"),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at").notNull(),
    tz: text("tz").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    /** Regla RFC 5545 sin `DTSTART` (p. ej. `FREQ=WEEKLY;BYDAY=MO`). Null si no se repite. */
    rrule: text("rrule"),
    /** JSON con los inicios originales (ms) de las ocurrencias borradas. */
    exdates: text("exdates").notNull().default("[]"),
    /** Fin de la serie (ms) para descartarla en las consultas por rango; null = sin fin. */
    seriesEndAt: integer("series_end_at"),
    /** Excepción de una serie: evento que sustituye a la ocurrencia de `original_start`. */
    recurringEventId: text("recurring_event_id").references((): AnySQLiteColumn => events.id, {
      onDelete: "cascade",
    }),
    originalStart: integer("original_start"),
    /** Cumpleaños: año de nacimiento (opcional) y qué día se celebra en años no bisiestos. */
    birthYear: integer("birth_year"),
    feb29Rule: text("feb29_rule", { enum: FEB29_RULES }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("events_owner_start_idx").on(t.ownerId, t.startAt),
    index("events_calendar_idx").on(t.calendarId),
    uniqueIndex("events_override_idx").on(t.recurringEventId, t.originalStart),
    check("events_type_check", sql`"type" IN (${quoted(EVENT_TYPES)})`),
    check("events_range_check", sql`"end_at" > "start_at"`),
  ],
);

/** Alertas de eventos (y, desde la Fase 4, de tarjetas). `next_fire_at` lo calcula F2-07. */
export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type", { enum: REMINDER_TARGETS }).notNull(),
    targetId: text("target_id").notNull(),
    /** Minutos antes del inicio. En día completo, respecto a las 00:00 (negativo = después). */
    offsetMinutes: integer("offset_minutes").notNull(),
    channel: text("channel", { enum: REMINDER_CHANNELS }).notNull().default("telegram"),
    nextFireAt: integer("next_fire_at"),
    /** Inicio de la ocurrencia a la que corresponde `next_fire_at`. */
    nextOccurrenceStart: integer("next_occurrence_start"),
    status: text("status", { enum: REMINDER_STATUSES }).notNull().default("scheduled"),
    lastFiredAt: integer("last_fired_at"),
    /**
     * Reclamada por el planificador (F3-05). Si sigue puesta pasados unos minutos, el envío se
     * interrumpió y se vuelve a reclamar (la clave de idempotencia evita duplicados).
     */
    enqueuedAt: integer("enqueued_at"),
    /** «Posponer» (F3-07): un aviso extra de la misma ocurrencia. */
    snoozeUntil: integer("snooze_until"),
    snoozeOccurrenceStart: integer("snooze_occurrence_start"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("reminders_due_idx").on(t.status, t.nextFireAt),
    index("reminders_snooze_idx").on(t.snoozeUntil),
    index("reminders_target_idx").on(t.targetType, t.targetId),
    check("reminders_status_check", sql`"status" IN (${quoted(REMINDER_STATUSES)})`),
  ],
);

export type Calendar = typeof calendars.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
