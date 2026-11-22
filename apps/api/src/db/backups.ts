import { BACKUP_KINDS, BACKUP_STATUSES, RESTORE_MODES, RESTORE_STATUSES } from "@delyra/shared";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./identity";

/**
 * Copias de seguridad de usuario y restauraciones (Fase 6). Los ficheros viven en R2:
 * - copias: `delyra-backups` → `users/<ownerId>/<backupId>.zip`;
 * - restauraciones (fichero subido y datos ya validados): `delyra-imports` →
 *   `restores/<ownerId>/<restoreId>/…`, que el ciclo de vida borra a los 7 días.
 */

const quoted = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const userBackups = sqliteTable(
  "user_backups",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: BACKUP_KINDS }).notNull(),
    status: text("status", { enum: BACKUP_STATUSES }).notNull(),
    r2Key: text("r2_key").notNull(),
    sizeBytes: integer("size_bytes"),
    /** JSON: `BackupCounts`. */
    counts: text("counts"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("user_backups_owner_idx").on(t.ownerId, t.createdAt),
    check("user_backups_kind_check", sql`"kind" IN (${quoted(BACKUP_KINDS)})`),
    check("user_backups_status_check", sql`"status" IN (${quoted(BACKUP_STATUSES)})`),
  ],
);

export const userRestores = sqliteTable(
  "user_restores",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: RESTORE_STATUSES }).notNull(),
    mode: text("mode", { enum: RESTORE_MODES }),
    /** Nombre saneado del fichero subido, o null si se restaura una copia guardada. */
    filename: text("filename"),
    /** Copia guardada de la que se restaura (sin FK: la copia puede borrarse después). */
    backupId: text("backup_id"),
    /** Copia previa (para deshacer). */
    preBackupId: text("pre_backup_id"),
    /** Restauración que esta deshace. */
    undoOf: text("undo_of"),
    /** JSON: fecha de la copia, recuentos, avisos y número de trozos por tipo. */
    preview: text("preview"),
    progressDone: integer("progress_done").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("user_restores_owner_idx").on(t.ownerId, t.createdAt),
    check("user_restores_status_check", sql`"status" IN (${quoted(RESTORE_STATUSES)})`),
  ],
);

export type UserBackupRow = typeof userBackups.$inferSelect;
export type UserRestoreRow = typeof userRestores.$inferSelect;
