import { MICROSOFT_CONNECTION_STATUSES, SUBSCRIPTION_STATUSES } from "@delyra/shared";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./identity";
import { boardColumns, boards, cards, labels } from "./kanban";

/**
 * Reuniones de Teams en un tablero (docs/plan-teams.md, ADR-0015): conexión con Microsoft 365,
 * tableros que reciben las reuniones y qué tarjeta corresponde a cada evento.
 */

const quoted = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const microsoftConnections = sqliteTable(
  "microsoft_connections",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Token de actualización cifrado (AAD `microsoft-refresh:<ownerId>:<id>`); rota en cada uso. */
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    /** Último token de acceso (~1 h), cifrado. */
    accessTokenEnc: text("access_token_enc"),
    accessExpiresAt: integer("access_expires_at"),
    /** Cuenta conectada (`mail` o `userPrincipalName`), solo para mostrarla. */
    accountEmail: text("account_email"),
    status: text("status", { enum: MICROSOFT_CONNECTION_STATUSES }).notNull().default("ok"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("microsoft_connections_owner_idx").on(t.ownerId),
    check(
      "microsoft_connections_status_check",
      sql`"status" IN (${quoted(MICROSOFT_CONNECTION_STATUSES)})`,
    ),
  ],
);

/** Un tablero recibe las reuniones del calendario de una persona (quien lo configura). */
export const microsoftBoardSyncs = sqliteTable(
  "microsoft_board_syncs",
  {
    id: text("id").primaryKey(),
    /** Quien lo configuró: sus reuniones y su permiso de edición en el tablero. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => microsoftConnections.id, { onDelete: "cascade" }),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    /** Columna donde aparecen las tarjetas nuevas (si se borra, se deja de volcar). */
    columnId: text("column_id")
      .notNull()
      .references(() => boardColumns.id, { onDelete: "cascade" }),
    onlyTeams: integer("only_teams", { mode: "boolean" }).notNull().default(true),
    daysAhead: integer("days_ahead").notNull().default(14),
    /** Etiqueta «Teams» del tablero. */
    labelId: text("label_id").references(() => labels.id, { onDelete: "set null" }),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull().default("pending"),
    lastError: text("last_error"),
    failures: integer("failures").notNull().default(0),
    lastSyncedAt: integer("last_synced_at"),
    nextSyncAt: integer("next_sync_at").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("microsoft_board_syncs_board_idx").on(t.boardId),
    index("microsoft_board_syncs_owner_idx").on(t.ownerId),
    index("microsoft_board_syncs_due_idx").on(t.nextSyncAt),
    check(
      "microsoft_board_syncs_status_check",
      sql`"status" IN (${quoted(SUBSCRIPTION_STATUSES)})`,
    ),
  ],
);

/**
 * Tarjeta que corresponde a cada evento, con lo último que escribió Delyra: si la tarjeta ya no
 * coincide con eso, la persona la ha editado y ese campo deja de actualizarse.
 */
export const microsoftSyncedCards = sqliteTable(
  "microsoft_synced_cards",
  {
    id: text("id").primaryKey(),
    syncId: text("sync_id")
      .notNull()
      .references(() => microsoftBoardSyncs.id, { onDelete: "cascade" }),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    title: text("title").notNull(),
    startAt: integer("start_at").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    descriptionHash: text("description_hash").notNull(),
    cancelled: integer("cancelled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("microsoft_synced_cards_card_idx").on(t.cardId),
    uniqueIndex("microsoft_synced_cards_event_idx").on(t.syncId, t.eventId),
  ],
);

export type MicrosoftConnectionRow = typeof microsoftConnections.$inferSelect;
export type MicrosoftBoardSyncRow = typeof microsoftBoardSyncs.$inferSelect;
export type MicrosoftSyncedCardRow = typeof microsoftSyncedCards.$inferSelect;
