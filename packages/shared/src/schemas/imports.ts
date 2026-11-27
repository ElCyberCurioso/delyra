import { z } from "zod";
import { idSchema } from "../ids";

/** Importación desde Google Calendar y suscripciones iCal (Fase 5). */

export const IMPORT_SOURCES = ["file", "google"] as const;

/**
 * - `analyzing`: el Workflow lee el fichero (o descarga Google) y prepara la vista previa.
 * - `ready`: vista previa lista; falta que el usuario elija los calendarios de destino.
 * - `importing` → `succeeded` | `failed`.
 * - `expired`: no se empezó a tiempo y los datos temporales ya se borraron (7 días).
 */
export const IMPORT_STATUSES = [
  "analyzing",
  "ready",
  "importing",
  "succeeded",
  "failed",
  "expired",
] as const;

export const SUBSCRIPTION_STATUSES = ["pending", "ok", "error"] as const;

/** Un calendario encontrado en el fichero o en la cuenta de Google. */
const importCalendarPreviewSchema = z.object({
  /** Clave del calendario dentro de la importación (`0`, `1`…). */
  key: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  timeZone: z.string().nullable(),
  events: z.number(),
  recurring: z.number(),
  withReminders: z.number(),
  birthdays: z.number(),
  /** Primer y último inicio (ISO), para que el usuario reconozca el calendario. */
  firstStart: z.string().nullable(),
  lastStart: z.string().nullable(),
  /** Destino sugerido: un calendario propio con el mismo nombre, si existe. */
  suggestedCalendarId: z.string().nullable(),
  /** Google: festivos, números de semana… se proponen sin importar. */
  suggestSkip: z.boolean(),
});
export type ImportCalendarPreview = z.infer<typeof importCalendarPreviewSchema>;

export const importReportSchema = z.object({
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  skipped: z.number(),
  calendars: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      calendarId: z.string().nullable(),
      created: z.number(),
      updated: z.number(),
      unchanged: z.number(),
      skipped: z.number(),
    }),
  ),
  warnings: z.array(z.string()),
});
export type ImportReport = z.infer<typeof importReportSchema>;

const importSchema = z.object({
  id: z.string(),
  source: z.enum(IMPORT_SOURCES),
  status: z.enum(IMPORT_STATUSES),
  filename: z.string().nullable(),
  calendars: z.array(importCalendarPreviewSchema),
  warnings: z.array(z.string()),
  progress: z.object({ done: z.number(), total: z.number() }),
  report: importReportSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ImportInfo = z.infer<typeof importSchema>;

export const importResponseSchema = z.object({ import: importSchema });
export const importsResponseSchema = z.object({ imports: z.array(importSchema) });

const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, { error: "Color no válido" });

/** Qué hacer con cada calendario de la vista previa (F5-03). */
export const startImportRequestSchema = z.object({
  calendars: z
    .array(
      z.discriminatedUnion("target", [
        z.object({ key: z.string().max(10), target: z.literal("skip") }),
        z.object({
          key: z.string().max(10),
          target: z.literal("new"),
          name: z
            .string()
            .trim()
            .min(1, { error: "Ponle un nombre" })
            .max(60, { error: "Máximo 60 caracteres" }),
          color: colorSchema,
        }),
        z.object({ key: z.string().max(10), target: z.literal("existing"), calendarId: idSchema }),
      ]),
    )
    .min(1)
    .max(50),
  /** Convertir las alertas del origen en avisos de Telegram. */
  reminders: z.boolean().default(true),
});
export type StartImportRequest = z.infer<typeof startImportRequestSchema>;

export const googleStatusResponseSchema = z.object({
  /** Falso si el servidor no tiene configurado el cliente OAuth (P-11). */
  enabled: z.boolean(),
});

export const googleAuthorizeResponseSchema = z.object({ url: z.string() });

// ── Suscripciones iCal (F5-06) ───────────────────────────────────────────────

const GOOGLE_ICAL_HOST = "calendar.google.com";

/**
 * Dirección secreta en formato iCal de Google Calendar. Solo `https://calendar.google.com/
 * calendar/ical/….ics`: es lo que mitiga el SSRF (la API nunca pide otro host).
 */
export function isGoogleIcalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === GOOGLE_ICAL_HOST &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.startsWith("/calendar/ical/") &&
    url.pathname.endsWith(".ics") &&
    !url.pathname.includes("..") &&
    raw.length <= 1_000
  );
}

export const createSubscriptionRequestSchema = z.object({
  url: z.string().trim().max(1_000).refine(isGoogleIcalUrl, {
    error:
      "Pega la «Dirección secreta en formato iCal» de Google Calendar (https://calendar.google.com/calendar/ical/…/basic.ics)",
  }),
  name: z.string().trim().max(60).optional(),
  color: colorSchema.optional(),
});

const subscriptionSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  name: z.string(),
  color: z.string(),
  /** Dirección enmascarada: la completa es secreta y no vuelve a salir del servidor. */
  urlHint: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  error: z.string().nullable(),
  events: z.number(),
  lastSyncedAt: z.string().nullable(),
  nextSyncAt: z.string().nullable(),
});
export type SubscriptionInfo = z.infer<typeof subscriptionSchema>;

export const subscriptionResponseSchema = z.object({ subscription: subscriptionSchema });
export const subscriptionsResponseSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
});

// ── Sincronización continua con Google (F7-09) ───────────────────────────────

export const GOOGLE_CONNECTION_STATUSES = ["ok", "revoked"] as const;

/** Un calendario de Google que se refleja (solo lectura) en un calendario de Delyra. */
const googleSyncedCalendarSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  name: z.string(),
  color: z.string(),
  /** Sus recordatorios se convierten en alertas. */
  reminders: z.boolean(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  error: z.string().nullable(),
  events: z.number(),
  lastSyncedAt: z.string().nullable(),
  nextSyncAt: z.string().nullable(),
});
export type GoogleSyncedCalendar = z.infer<typeof googleSyncedCalendarSchema>;

export const googleSyncResponseSchema = z.object({
  /** Falso si el servidor no tiene configurado el cliente OAuth (P-11). */
  enabled: z.boolean(),
  connection: z
    .object({
      /** Cuenta de Google conectada (el id de su calendario principal). */
      email: z.string().nullable(),
      /** `revoked`: Google retiró el permiso o caducó; hay que volver a conectar. */
      status: z.enum(GOOGLE_CONNECTION_STATUSES),
      connectedAt: z.string(),
    })
    .nullable(),
  calendars: z.array(googleSyncedCalendarSchema),
});
export type GoogleSyncInfo = z.infer<typeof googleSyncResponseSchema>;

/** Calendarios de la cuenta de Google que se pueden sincronizar. */
export const googleAccountCalendarsResponseSchema = z.object({
  calendars: z.array(
    z.object({
      googleCalendarId: z.string(),
      name: z.string(),
      color: z.string().nullable(),
      /** Festivos y números de semana de Google: mejor no sincronizarlos (Delyra trae los suyos). */
      suggestSkip: z.boolean(),
      synced: z.boolean(),
    }),
  ),
});

export const addGoogleSyncRequestSchema = z.object({
  googleCalendarId: z.string().trim().min(1).max(300),
  reminders: z.boolean().default(true),
});
