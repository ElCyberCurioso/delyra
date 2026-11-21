import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Convenciones del esquema:
 * - Identificadores UUIDv7 en texto (`@delyra/shared` → `newId()`).
 * - Instantes en UTC como milisegundos desde epoch (`integer`, modo `timestamp_ms`).
 * - Nombres de tablas y columnas en snake_case.
 */

/** Pares clave/valor de la propia plataforma (versión de esquema, marcas de mantenimiento…). */
export const schemaMeta = sqliteTable("schema_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`),
});

export const SYSTEM_BACKUP_STATUSES = ["running", "succeeded", "failed"] as const;
export type SystemBackupStatus = (typeof SYSTEM_BACKUP_STATUSES)[number];

/** Resultado de cada ejecución del backup diario del sistema (F0-14). */
export const systemBackupRuns = sqliteTable(
  "system_backup_runs",
  {
    /** Id de la instancia del Workflow. */
    id: text("id").primaryKey(),
    trigger: text("trigger", { enum: ["schedule", "manual"] }).notNull(),
    status: text("status", { enum: SYSTEM_BACKUP_STATUSES }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    r2Key: text("r2_key"),
    sizeBytes: integer("size_bytes"),
    /** Mensaje de error saneado (sin tokens ni URLs firmadas). */
    error: text("error"),
  },
  (table) => [
    index("system_backup_runs_started_at_idx").on(table.startedAt),
    check("system_backup_runs_status_check", sql`"status" IN ('running', 'succeeded', 'failed')`),
    check("system_backup_runs_trigger_check", sql`"trigger" IN ('schedule', 'manual')`),
  ],
);

export type SystemBackupRun = typeof systemBackupRuns.$inferSelect;

export * from "./identity";
export * from "./calendar";
export * from "./telegram";
