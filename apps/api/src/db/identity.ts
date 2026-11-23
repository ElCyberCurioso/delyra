import { BACKUP_FREQUENCIES } from "@delyra/shared";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Identidad, sesiones y auditoría (F1-01). Mismas convenciones que `schema.ts`: UUIDv7 en
 * texto, instantes en milisegundos UTC y snake_case.
 *
 * Nunca se guardan secretos en claro: contraseñas con scrypt (ADR-0004), tokens (sesión, invitación,
 * recuperación) como SHA-256 y la semilla TOTP cifrada con AES-256-GCM.
 */

export const ROLES = ["admin", "member"] as const;
export const USER_STATUSES = ["active", "disabled"] as const;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    /** Siempre en minúsculas y sin espacios. */
    email: text("email").notNull(),
    emailVerifiedAt: integer("email_verified_at", { mode: "timestamp_ms" }),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    status: text("status", { enum: USER_STATUSES }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
    passwordChangedAt: integer("password_changed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    check("users_role_check", sql`"role" IN ('admin', 'member')`),
    check("users_status_check", sql`"status" IN ('active', 'disabled')`),
  ],
);

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timeZone: text("time_zone").notNull().default("Europe/Madrid"),
  locale: text("locale").notNull().default("es"),
  /** 0 = domingo … 6 = sábado. */
  weekStart: integer("week_start").notNull().default(1),
  /** Gama de color de la interfaz (null = la de por defecto). */
  palette: text("palette"),
  /** Copia automática de los datos del usuario (F6-03): `off`, `daily`, `weekly`, `monthly`. */
  backupFrequency: text("backup_frequency", { enum: BACKUP_FREQUENCIES })
    .notNull()
    .default("weekly"),
  /** Copias automáticas que se conservan. */
  backupKeep: integer("backup_keep").notNull().default(4),
  /** Festivos que se muestran (F7-03): `off`, `ES` (nacionales) o una comunidad (`ES-MD`). */
  holidayRegion: text("holiday_region").notNull().default("ES-MD"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const userTotp = sqliteTable("user_totp", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Semilla base32 cifrada (`v1:iv.ciphertext`). */
  secretEnc: text("secret_enc").notNull(),
  /** Null mientras el alta no se ha confirmado con un código válido. */
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
  /** Último paso de 30 s aceptado: impide reutilizar un código (anti-replay). */
  lastUsedCounter: integer("last_used_counter").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /**
   * Semilla nueva durante una reconfiguración (F1-15). La actual sigue valiendo hasta que la
   * nueva se confirma con un código; caduca a los 10 minutos.
   */
  pendingSecretEnc: text("pending_secret_enc"),
  pendingCreatedAt: integer("pending_created_at", { mode: "timestamp_ms" }),
});

export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("recovery_codes_user_idx").on(t.userId)],
);

/**
 * Llaves de acceso (WebAuthn, F7-09): segundo factor alternativo al TOTP. Solo se guarda la clave
 * pública; la privada nunca sale del dispositivo o del gestor de contraseñas.
 */
export const passkeys = sqliteTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Identificador de la credencial (base64url), único en todo el sistema. */
    credentialId: text("credential_id").notNull(),
    /** Clave pública COSE (base64url). */
    publicKey: text("public_key").notNull(),
    /** Contador de firmas: si baja, la llave podría estar clonada y se rechaza. */
    counter: integer("counter").notNull().default(0),
    /** Transportes que anunció el autenticador (`internal`, `hybrid`, `usb`…), en JSON. */
    transports: text("transports"),
    /** Nombre que le da la persona («Portátil», «iPhone»…). */
    name: text("name").notNull(),
    /** La llave se sincroniza entre dispositivos (gestor de contraseñas). */
    backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("passkeys_credential_idx").on(t.credentialId),
    index("passkeys_user_idx").on(t.userId),
  ],
);

export const WEBAUTHN_PURPOSES = ["register", "login"] as const;
export type WebAuthnPurpose = (typeof WEBAUTHN_PURPOSES)[number];

/**
 * Reto pendiente de una ceremonia WebAuthn: uno por sesión, de un solo uso y con caducidad de
 * 5 minutos. Va ligado a la sesión, así que no sirve desde otro navegador.
 */
export const webauthnChallenges = sqliteTable(
  "webauthn_challenges",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: WEBAUTHN_PURPOSES }).notNull(),
    challenge: text("challenge").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  () => [check("webauthn_challenges_purpose_check", sql`"purpose" IN ('register', 'login')`)],
);

export const SESSION_STATES = ["pending_2fa", "pending_totp", "active"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    state: text("state", { enum: SESSION_STATES }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    /** Caducidad absoluta: 30 días (activa) o 5 minutos (pendiente de 2FA). */
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    /** Intentos fallidos de segundo factor sobre esta sesión pendiente. */
    failedAttempts: integer("failed_attempts").notNull().default(0),
    userAgent: text("user_agent"),
    country: text("country"),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    check("sessions_state_check", sql`"state" IN ('pending_2fa', 'pending_totp', 'active')`),
  ],
);

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    tokenHash: text("token_hash").notNull(),
    /** Null cuando la crea el script de arranque (primer administrador). */
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedUserId: text("accepted_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_idx").on(t.tokenHash),
    index("invitations_email_idx").on(t.email),
    check("invitations_role_check", sql`"role" IN ('admin', 'member')`),
  ],
);

export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("password_resets_token_hash_idx").on(t.tokenHash),
    index("password_resets_user_idx").on(t.userId),
  ],
);

/** `reauth`: contraseña y código que piden las acciones sensibles de los ajustes. */
export const AUTH_ATTEMPT_KINDS = ["login", "second_factor", "password_reset", "reauth"] as const;
export type AuthAttemptKind = (typeof AUTH_ATTEMPT_KINDS)[number];

/** Intentos de autenticación para limitar la fuerza bruta por cuenta y por IP (F1-10). */
export const authAttempts = sqliteTable(
  "auth_attempts",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: AUTH_ATTEMPT_KINDS }).notNull(),
    /** `account` (hash del email) o `ip` (hash de la IP). Nunca el valor en claro. */
    scope: text("scope", { enum: ["account", "ip"] }).notNull(),
    keyHash: text("key_hash").notNull(),
    success: integer("success", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("auth_attempts_lookup_idx").on(t.scope, t.keyHash, t.createdAt)],
);

/** Registro de eventos de seguridad (F1-16). `metadata` nunca lleva secretos. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    /** Usuario afectado. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Quién hizo la acción, si no es el propio usuario (p. ej. un administrador). */
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    event: text("event").notNull(),
    country: text("country"),
    userAgent: text("user_agent"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("audit_log_user_idx").on(t.userId, t.createdAt),
    index("audit_log_created_idx").on(t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
