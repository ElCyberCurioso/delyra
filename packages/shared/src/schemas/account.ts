import { z } from "zod";
import { localeSchema, paletteSchema, ROLES, timeZoneSchema } from "../constants";
import { nameSchema, PASSWORD_MAX_LENGTH, passwordSchema } from "./auth";

/** Ajustes de cuenta (F1-15), historial (F1-16) y administración (F1-17). */

const isoDate = z.iso.datetime();

// ── Peticiones ─────────────────────────────────────────────────────────────────

export const updateProfileRequestSchema = z.object({ name: nameSchema });

export const updateSettingsRequestSchema = z.object({
  timeZone: timeZoneSchema,
  locale: localeSchema,
  weekStart: z.number().int().min(0).max(6),
  /** Gama de color: sigue a la cuenta en las dos apps y en todos los dispositivos. */
  palette: paletteSchema.optional(),
});

/** Confirmación de identidad para acciones sensibles: contraseña y código actual. */
export const reauthRequestSchema = z.object({
  password: z.string().min(1, { error: "Escribe tu contraseña" }).max(PASSWORD_MAX_LENGTH),
  code: z.string().trim().min(6, { error: "Escribe el código" }).max(16),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z
    .string()
    .min(1, { error: "Escribe tu contraseña actual" })
    .max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

// ── Respuestas ─────────────────────────────────────────────────────────────────

export const securityOverviewResponseSchema = z.object({
  totpConfirmedAt: isoDate.nullable(),
  remainingRecoveryCodes: z.number().int().min(0),
  passwordChangedAt: isoDate.nullable(),
});
export type SecurityOverview = z.infer<typeof securityOverviewResponseSchema>;

export const sessionsResponseSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      createdAt: isoDate,
      lastSeenAt: isoDate,
      userAgent: z.string().nullable(),
      country: z.string().nullable(),
      current: z.boolean(),
    }),
  ),
});
export type ActiveSessionInfo = z.infer<typeof sessionsResponseSchema>["sessions"][number];

export const auditResponseSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      event: z.string(),
      country: z.string().nullable(),
      userAgent: z.string().nullable(),
      createdAt: isoDate,
    }),
  ),
});
export type AuditEntry = z.infer<typeof auditResponseSchema>["events"][number];

export const recoveryCodesResponseSchema = z.object({
  recoveryCodes: z.array(z.string()).min(1),
});

export const adminUsersResponseSchema = z.object({
  users: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      role: z.enum(ROLES),
      status: z.enum(["active", "disabled"]),
      hasTotp: z.boolean(),
      createdAt: isoDate,
      lastLoginAt: isoDate.nullable(),
    }),
  ),
});
export type AdminUser = z.infer<typeof adminUsersResponseSchema>["users"][number];

export const adminInvitationsResponseSchema = z.object({
  invitations: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      role: z.enum(ROLES),
      createdAt: isoDate,
      expiresAt: isoDate,
      acceptedAt: isoDate.nullable(),
      revokedAt: isoDate.nullable(),
    }),
  ),
});
export type AdminInvitation = z.infer<typeof adminInvitationsResponseSchema>["invitations"][number];

/** El enlace solo se muestra una vez, al crear o reenviar: en D1 solo queda su hash. */
export const invitationDeliveryResponseSchema = z.object({
  expiresAt: isoDate,
  link: z.string(),
  emailed: z.boolean(),
});
