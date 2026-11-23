import { z } from "zod";
import { timeZoneSchema } from "../constants";
import { idSchema } from "../ids";
import { isValidDateOnly } from "../time";

/** Calendarios, eventos y alertas (Fase 2). */

export const CALENDAR_KINDS = ["personal", "work", "birthdays", "custom"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const EVENT_TYPES = ["event", "birthday"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Qué día se celebra un cumpleaños del 29 de febrero en los años no bisiestos. */
export const FEB29_RULES = ["feb28", "mar1"] as const;
export type Feb29Rule = (typeof FEB29_RULES)[number];

export const REMINDER_TARGETS = ["event", "card"] as const;
export const REMINDER_CHANNELS = ["telegram", "email"] as const;
export const REMINDER_STATUSES = ["scheduled", "done"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const CALENDAR_COLORS = [
  "#7c5cff",
  "#2f80ed",
  "#00a3a3",
  "#27ae60",
  "#f2994a",
  "#eb5757",
  "#d6409f",
  "#8d6e63",
] as const;

/** Calendarios que se crean al dar de alta a cada usuario (F2-03). */
export const DEFAULT_CALENDARS: readonly { kind: CalendarKind; name: string; color: string }[] = [
  { kind: "personal", name: "Personal", color: "#7c5cff" },
  { kind: "work", name: "Trabajo", color: "#2f80ed" },
  { kind: "birthdays", name: "Cumpleaños", color: "#d6409f" },
];

/** Nombre de un calendario por defecto en el idioma de la cuenta (F7-06). */
export const DEFAULT_CALENDAR_NAMES: Readonly<
  Record<"es" | "en", Readonly<Record<string, string>>>
> = {
  es: { personal: "Personal", work: "Trabajo", birthdays: "Cumpleaños" },
  en: { personal: "Personal", work: "Work", birthdays: "Birthdays" },
};

/** Alertas por defecto de un cumpleaños: el día anterior y el mismo día, a las 9:00. */
export const BIRTHDAY_DEFAULT_REMINDERS = [
  { offsetMinutes: 15 * 60, channel: "telegram" },
  { offsetMinutes: -9 * 60, channel: "telegram" },
] as const satisfies readonly { offsetMinutes: number; channel: ReminderChannel }[];

/** Límites (F2-04): rangos de consulta acotados y textos con longitud máxima. */
export const EVENT_LIMITS = {
  title: 200,
  notes: 10_000,
  location: 300,
  url: 2_000,
  rrule: 300,
  reminders: 10,
  /** Rango máximo de `GET /api/events` (la vista anual necesita algo más de un año). */
  rangeDays: 400,
  /** Duración máxima de un evento. */
  durationDays: 366,
} as const;

// ── Calendarios ────────────────────────────────────────────────────────────────

const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, { error: "Color no válido" });
const calendarNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Ponle un nombre" })
  .max(60, { error: "Máximo 60 caracteres" });

export const createCalendarRequestSchema = z.object({
  name: calendarNameSchema,
  color: colorSchema,
});

export const updateCalendarRequestSchema = z
  .object({
    name: calendarNameSchema,
    color: colorSchema,
    visible: z.boolean(),
    position: z.number().int().min(0).max(1000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: "No hay nada que cambiar" });

export const calendarSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  kind: z.enum(CALENDAR_KINDS),
  visible: z.boolean(),
  position: z.number(),
  /** Suscripción iCal (F5-06): sus eventos no se pueden crear, mover ni editar. */
  readOnly: z.boolean(),
});
export type CalendarInfo = z.infer<typeof calendarSchema>;

export const calendarsResponseSchema = z.object({ calendars: z.array(calendarSchema) });

// ── Eventos ────────────────────────────────────────────────────────────────────

/** `AAAA-MM-DD` (día completo). */
export const dateOnlySchema = z.string().refine(isValidDateOnly, { error: "Fecha no válida" });
/** Instante ISO 8601 con zona (`2026-11-21T10:00:00Z` o `…+01:00`). */
export const instantSchema = z.iso.datetime({ offset: true, error: "Fecha y hora no válidas" });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Máximo ${String(max)} caracteres` })
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

const urlSchema = z
  .string()
  .trim()
  .max(EVENT_LIMITS.url)
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value === null || /^https?:\/\/[^\s]+$/i.test(value), {
    error: "Solo enlaces http(s)",
  })
  .nullable()
  .optional();

/** Formato básico; la API comprueba además que la regla sea válida y razonable. */
export const rruleSchema = z
  .string()
  .trim()
  .max(EVENT_LIMITS.rrule)
  .regex(/^[A-Z0-9=;,+-]+$/, { error: "Regla de repetición no válida" })
  .nullable()
  .optional();

export const reminderInputSchema = z.object({
  /** Minutos antes del inicio; en día completo, respecto a las 00:00 (negativo = ese mismo día). */
  offsetMinutes: z
    .number()
    .int()
    .min(-24 * 60)
    .max(28 * 24 * 60),
  channel: z.enum(REMINDER_CHANNELS).default("telegram"),
});
export type ReminderInput = z.infer<typeof reminderInputSchema>;

const eventFields = {
  calendarId: idSchema,
  title: z
    .string()
    .trim()
    .min(1, { error: "Ponle un título" })
    .max(EVENT_LIMITS.title, { error: `Máximo ${String(EVENT_LIMITS.title)} caracteres` }),
  notes: optionalText(EVENT_LIMITS.notes),
  location: optionalText(EVENT_LIMITS.location),
  url: urlSchema,
  allDay: z.boolean(),
  /** `AAAA-MM-DD` si `allDay`; instante ISO si no. */
  start: z.string().max(40),
  /** Exclusivo en día completo (un evento de un día termina el día siguiente). */
  end: z.string().max(40),
  tz: timeZoneSchema,
  rrule: rruleSchema,
  reminders: z.array(reminderInputSchema).max(EVENT_LIMITS.reminders).optional(),
  birthYear: z.number().int().min(1900).max(2200).nullable().optional(),
  feb29Rule: z.enum(FEB29_RULES).nullable().optional(),
};

function checkTimes(
  value: { allDay?: boolean; start?: string; end?: string },
  ctx: z.RefinementCtx,
) {
  if (value.allDay === undefined || value.start === undefined || value.end === undefined) return;
  const parse = value.allDay ? dateOnlySchema : instantSchema;
  for (const key of ["start", "end"] as const) {
    if (!parse.safeParse(value[key]).success) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: value.allDay ? "Fecha no válida" : "Fecha y hora no válidas",
      });
      return;
    }
  }
  const start = Date.parse(value.start);
  const end = Date.parse(value.end);
  if (!(end > start)) {
    ctx.addIssue({ code: "custom", path: ["end"], message: "El fin debe ser posterior al inicio" });
  } else if (end - start > EVENT_LIMITS.durationDays * 86_400_000) {
    ctx.addIssue({
      code: "custom",
      path: ["end"],
      message: "Un evento no puede durar más de un año",
    });
  }
}

export const createEventRequestSchema = z
  .object({ type: z.enum(EVENT_TYPES).default("event"), ...eventFields })
  .superRefine(checkTimes);
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

/** Alcance de un cambio en un evento que se repite (F2-05). */
export const EDIT_SCOPES = ["this", "following", "all"] as const;
export type EditScope = (typeof EDIT_SCOPES)[number];

export const updateEventRequestSchema = z
  .object({
    ...eventFields,
    scope: z.enum(EDIT_SCOPES).default("all"),
    /** Inicio original de la ocurrencia (mismo formato que `start`) para «this» y «following». */
    occurrenceStart: z.string().max(40).optional(),
  })
  .partial()
  .superRefine((value, ctx) => {
    checkTimes(value, ctx);
    if ((value.start === undefined) !== (value.end === undefined)) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "Indica inicio y fin juntos" });
    }
    if ((value.start !== undefined || value.end !== undefined) && value.allDay === undefined) {
      ctx.addIssue({ code: "custom", path: ["allDay"], message: "Indica si es de día completo" });
    }
  });
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;

export const eventsQuerySchema = z.object({
  from: instantSchema,
  to: instantSchema,
  /** Ids separados por comas; si falta, todos los calendarios visibles y ocultos. */
  calendars: z.string().max(4000).optional(),
  type: z.enum(EVENT_TYPES).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, { error: "Escribe al menos 2 caracteres" }).max(100),
  calendars: z.string().max(4000).optional(),
  type: z.enum(EVENT_TYPES).optional(),
});

/** Una ocurrencia lista para pintar (las series se expanden en el servidor). */
export const occurrenceSchema = z.object({
  /** Clave única de la ocurrencia (`eventId` o `eventId:inicioOriginal`). */
  id: z.string(),
  eventId: z.string(),
  calendarId: z.string(),
  type: z.enum(EVENT_TYPES),
  title: z.string(),
  notes: z.string().nullable(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  allDay: z.boolean(),
  start: z.string(),
  end: z.string(),
  tz: z.string(),
  /** Pertenece a una serie (es una ocurrencia o una excepción de ella). */
  recurring: z.boolean(),
  /** Inicio original dentro de la serie (para editar «solo este» o «este y los siguientes»). */
  originalStart: z.string().nullable(),
  /** Edad que se cumple (solo cumpleaños con año de nacimiento). */
  age: z.number().nullable(),
});
export type Occurrence = z.infer<typeof occurrenceSchema>;

export const occurrencesResponseSchema = z.object({ events: z.array(occurrenceSchema) });

export const eventDetailSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  type: z.enum(EVENT_TYPES),
  title: z.string(),
  notes: z.string().nullable(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  allDay: z.boolean(),
  start: z.string(),
  end: z.string(),
  tz: z.string(),
  rrule: z.string().nullable(),
  recurringEventId: z.string().nullable(),
  birthYear: z.number().nullable(),
  feb29Rule: z.enum(FEB29_RULES).nullable(),
  reminders: z.array(
    z.object({
      id: z.string(),
      offsetMinutes: z.number(),
      channel: z.enum(REMINDER_CHANNELS),
      nextFireAt: z.string().nullable(),
    }),
  ),
});
export type EventDetail = z.infer<typeof eventDetailSchema>;

export const eventResponseSchema = z.object({ event: eventDetailSchema });
export const calendarResponseSchema = z.object({ calendar: calendarSchema });

/** Feed ICS privado de un calendario (F7-02). */
export const calendarFeedResponseSchema = z.object({
  feed: z.object({ url: z.string(), createdAt: z.string() }).nullable(),
});
