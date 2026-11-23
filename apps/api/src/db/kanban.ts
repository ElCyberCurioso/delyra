import { BOARD_MEMBER_ROLES, BOARD_TEMPLATES, CARD_PRIORITIES } from "@delyra/shared";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./identity";

/**
 * Kanban (F4-01). Todas las tablas llevan `owner_id` (§3.5). Las posiciones son índices
 * fraccionales en texto (F4-02): se ordenan comparando bytes, que es lo que hace SQLite.
 */

const quoted = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const owner = () =>
  text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });
const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
};

export const boards = sqliteTable(
  "boards",
  {
    id: text("id").primaryKey(),
    ownerId: owner(),
    name: text("name").notNull(),
    template: text("template", { enum: BOARD_TEMPLATES }).notNull().default("empty"),
    /** Días tras los que se archivan las tarjetas terminadas (0 = nunca). */
    autoarchiveDays: integer("autoarchive_days").notNull().default(14),
    ...timestamps,
  },
  (t) => [
    index("boards_owner_idx").on(t.ownerId),
    check("boards_template_check", sql`"template" IN (${quoted(BOARD_TEMPLATES)})`),
  ],
);

export const boardColumns = sqliteTable(
  "board_columns",
  {
    id: text("id").primaryKey(),
    ownerId: owner(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: text("position").notNull(),
    wipLimit: integer("wip_limit"),
    isDone: integer("is_done", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index("board_columns_board_idx").on(t.boardId, t.position)],
);

export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    ownerId: owner(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => boardColumns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Markdown; se sanea al mostrarlo. */
    description: text("description").notNull().default(""),
    position: text("position").notNull(),
    priority: text("priority", { enum: CARD_PRIORITIES }).notNull().default("none"),
    /** Color de la tarjeta (`#rrggbb`), opcional (F7: más colores). */
    color: text("color"),
    /** Fecha límite: instante UTC, o medianoche UTC si `due_all_day`. */
    dueAt: integer("due_at"),
    dueAllDay: integer("due_all_day", { mode: "boolean" }).notNull().default(false),
    dueTz: text("due_tz"),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [
    index("cards_column_idx").on(t.columnId, t.position),
    index("cards_owner_due_idx").on(t.ownerId, t.dueAt),
    index("cards_board_idx").on(t.boardId),
    check("cards_priority_check", sql`"priority" IN (${quoted(CARD_PRIORITIES)})`),
  ],
);

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    ownerId: owner(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("labels_board_idx").on(t.boardId)],
);

export const cardLabels = sqliteTable(
  "card_labels",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.labelId] }),
    index("card_labels_label_idx").on(t.labelId),
  ],
);

export const checklistItems = sqliteTable(
  "checklist_items",
  {
    id: text("id").primaryKey(),
    ownerId: owner(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
    position: text("position").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("checklist_items_card_idx").on(t.cardId, t.position)],
);

export const cardComments = sqliteTable(
  "card_comments",
  {
    id: text("id").primaryKey(),
    ownerId: owner(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** Quién lo escribió (F7-04, tableros compartidos). Null = el dueño del tablero. */
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("card_comments_card_idx").on(t.cardId, t.createdAt)],
);

export const cardAttachments = sqliteTable(
  "card_attachments",
  {
    id: text("id").primaryKey(),
    ownerId: owner(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** `boards/<usuario>/<tablero>/<tarjeta>/<adjunto>`: se borran por prefijo. */
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("card_attachments_card_idx").on(t.cardId)],
);

export const cardActivity = sqliteTable(
  "card_activity",
  {
    id: text("id").primaryKey(),
    ownerId: owner(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** JSON con el detalle (nombres de columnas, campos cambiados…). */
    data: text("data").notNull().default("{}"),
    /** Quién hizo el cambio (F7-04). Null = el dueño del tablero. */
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("card_activity_card_idx").on(t.cardId, t.createdAt)],
);

/**
 * Tableros compartidos (F7-04). El tablero y todo lo que cuelga de él siguen siendo del dueño
 * (`owner_id`); los miembros tienen un papel: `editor` (cambia tarjetas, columnas y etiquetas)
 * o `reader` (solo lectura).
 */
export const boardMembers = sqliteTable(
  "board_members",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: BOARD_MEMBER_ROLES }).notNull(),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    index("board_members_user_idx").on(t.userId),
    check("board_members_role_check", sql`"role" IN (${quoted(BOARD_MEMBER_ROLES)})`),
  ],
);

/**
 * Invitaciones a un tablero por email. Se guardan por email (normalizado), no por usuario: así
 * invitar no revela si esa dirección tiene cuenta, y la invitación aparece si la crea después.
 */
export const boardInvitations = sqliteTable(
  "board_invitations",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: BOARD_MEMBER_ROLES }).notNull(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("board_invitations_board_email_idx").on(t.boardId, t.email),
    index("board_invitations_email_idx").on(t.email),
    check("board_invitations_role_check", sql`"role" IN (${quoted(BOARD_MEMBER_ROLES)})`),
  ],
);

export type Board = typeof boards.$inferSelect;
export type BoardMemberRow = typeof boardMembers.$inferSelect;
export type BoardInvitationRow = typeof boardInvitations.$inferSelect;
export type BoardColumnRow = typeof boardColumns.$inferSelect;
export type CardRow = typeof cards.$inferSelect;
export type LabelRow = typeof labels.$inferSelect;
