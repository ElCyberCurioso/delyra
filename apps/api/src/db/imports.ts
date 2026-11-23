import {
  GOOGLE_CONNECTION_STATUSES,
  IMPORT_SOURCES,
  IMPORT_STATUSES,
  SUBSCRIPTION_STATUSES,
} from "@delyra/shared";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { calendars } from "./calendar";
import { users } from "./identity";

/**
 * Importaciones (F5-02, F5-05) y suscripciones iCal (F5-06).
 *
 * Los datos de una importación (fichero original y eventos ya convertidos) viven en el bucket
 * `delyra-imports`, que los borra a los 7 días. Aquí solo queda el estado, la vista previa y el
 * informe.
 */

const quoted = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const imports = sqliteTable(
  "imports",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source", { enum: IMPORT_SOURCES }).notNull(),
    status: text("status", { enum: IMPORT_STATUSES }).notNull(),
    /** Nombre saneado del fichero subido (null si viene de Google). */
    filename: text("filename"),
    sizeBytes: integer("size_bytes"),
    /** JSON: calendarios encontrados (`ImportCalendarPreview[]`) y avisos del análisis. */
    preview: text("preview"),
    /** JSON: lo que eligió el usuario (`StartImportRequest`). */
    options: text("options"),
    progressDone: integer("progress_done").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    /** JSON: `ImportReport`. */
    report: text("report"),
    /** Mensaje de error para el usuario (sin detalles internos). */
    error: text("error"),
    /**
     * Token de acceso de Google (`access_type=online`, ~1 h), cifrado. Solo existe mientras se
     * descargan los calendarios y se borra al terminar el análisis. Nunca hay refresh token.
     */
    googleTokenEnc: text("google_token_enc"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("imports_owner_idx").on(t.ownerId, t.createdAt),
    check("imports_status_check", sql`"status" IN (${quoted(IMPORT_STATUSES)})`),
    check("imports_source_check", sql`"source" IN (${quoted(IMPORT_SOURCES)})`),
  ],
);

export const calendarSubscriptions = sqliteTable(
  "calendar_subscriptions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Calendario de solo lectura en el que se reflejan los eventos (se borra con él). */
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    /** Dirección secreta cifrada (AAD `subscription:<ownerId>:<id>`). */
    urlEnc: text("url_enc").notNull(),
    /** Versión enmascarada para mostrarla (`calendar.google.com/…/basic.ics`). */
    urlHint: text("url_hint").notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("pending"),
    lastError: text("last_error"),
    failures: integer("failures").notNull().default(0),
    lastSyncedAt: integer("last_synced_at"),
    nextSyncAt: integer("next_sync_at").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("calendar_subscriptions_calendar_idx").on(t.calendarId),
    index("calendar_subscriptions_owner_idx").on(t.ownerId),
    index("calendar_subscriptions_due_idx").on(t.nextSyncAt),
    check(
      "calendar_subscriptions_status_check",
      sql`"status" IN (${quoted(SUBSCRIPTION_STATUSES)})`,
    ),
  ],
);

export type ImportRow = typeof imports.$inferSelect;
export type SubscriptionRow = typeof calendarSubscriptions.$inferSelect;

/**
 * Sincronización continua con Google (F7-09, ADR-0014): una conexión por persona con el token de
 * actualización cifrado, y los calendarios de Google que se reflejan en calendarios de solo
 * lectura de Delyra.
 */
export const googleConnections = sqliteTable(
  "google_connections",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Token de actualización cifrado (AAD `google-refresh:<ownerId>:<id>`). Nunca sale del servidor. */
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    /** Último token de acceso (~1 h), cifrado, para no pedir uno nuevo en cada calendario. */
    accessTokenEnc: text("access_token_enc"),
    accessExpiresAt: integer("access_expires_at"),
    /** Cuenta de Google conectada (id del calendario principal), para mostrarla. */
    accountEmail: text("account_email"),
    status: text("status", { enum: GOOGLE_CONNECTION_STATUSES }).notNull().default("ok"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("google_connections_owner_idx").on(t.ownerId),
    check(
      "google_connections_status_check",
      sql`"status" IN (${quoted(GOOGLE_CONNECTION_STATUSES)})`,
    ),
  ],
);

export const googleSyncedCalendars = sqliteTable(
  "google_synced_calendars",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => googleConnections.id, { onDelete: "cascade" }),
    /** Calendario de solo lectura donde se refleja (se borra con él). */
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    /** Convertir sus recordatorios en alertas. */
    reminders: integer("reminders", { mode: "boolean" }).notNull().default(true),
    /** Token de sincronización incremental de Google (`nextSyncToken`). */
    syncToken: text("sync_token"),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("pending"),
    lastError: text("last_error"),
    failures: integer("failures").notNull().default(0),
    lastSyncedAt: integer("last_synced_at"),
    nextSyncAt: integer("next_sync_at").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("google_synced_calendars_calendar_idx").on(t.calendarId),
    uniqueIndex("google_synced_calendars_google_idx").on(t.connectionId, t.googleCalendarId),
    index("google_synced_calendars_owner_idx").on(t.ownerId),
    index("google_synced_calendars_due_idx").on(t.nextSyncAt),
    check(
      "google_synced_calendars_status_check",
      sql`"status" IN (${quoted(SUBSCRIPTION_STATUSES)})`,
    ),
  ],
);

export type GoogleConnectionRow = typeof googleConnections.$inferSelect;
export type GoogleSyncedCalendarRow = typeof googleSyncedCalendars.$inferSelect;
