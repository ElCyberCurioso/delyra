import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./identity";

/**
 * Telegram (F3-01). El `chat_id` es un dato personal: se guarda cifrado (AES-256-GCM, AAD
 * `telegram:<userId>`) y, para encontrar al usuario cuando escribe al bot, como HMAC.
 */

export const telegramLinks = sqliteTable(
  "telegram_links",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    chatIdEnc: text("chat_id_enc").notNull(),
    /** HMAC del chat: un chat de Telegram solo puede estar vinculado a una cuenta. */
    chatHash: text("chat_hash").notNull(),
    linkedAt: integer("linked_at", { mode: "timestamp_ms" }).notNull(),
    /** `/silenciar`: sin alertas hasta este instante (los avisos de seguridad sí llegan). */
    mutedUntil: integer("muted_until"),
    /** Resumen diario (F3-09): hora local `HH:MM`, o null si está desactivado. */
    digestTime: text("digest_time"),
    /** Horas de silencio del resumen (`HH:MM`), en la zona del usuario. */
    quietStart: text("quiet_start"),
    quietEnd: text("quiet_end"),
    /** Último día (local, `AAAA-MM-DD`) en que se envió el resumen. */
    lastDigestOn: text("last_digest_on"),
  },
  (t) => [uniqueIndex("telegram_links_chat_idx").on(t.chatHash)],
);

/** Enlaces `t.me/<bot>?start=<token>`: 10 minutos y un solo uso (F3-04). */
export const telegramLinkTokens = sqliteTable(
  "telegram_link_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("telegram_link_tokens_hash_idx").on(t.tokenHash)],
);

/** `update_id` ya procesados: Telegram reintenta y el webhook descarta duplicados (F3-03). */
export const telegramUpdates = sqliteTable("telegram_updates", {
  updateId: integer("update_id").primaryKey(),
  receivedAt: integer("received_at").notNull(),
});

export const DELIVERY_STATUSES = ["sending", "sent", "skipped"] as const;

/**
 * Entregas de notificaciones por clave de idempotencia (F3-06): un reintento de la cola no
 * envía dos veces el mismo mensaje.
 */
export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    key: text("key").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull(),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (t) => [
    index("notification_deliveries_created_idx").on(t.createdAt),
    check("notification_deliveries_status_check", sql`"status" IN ('sending', 'sent', 'skipped')`),
  ],
);

export type TelegramLink = typeof telegramLinks.$inferSelect;
