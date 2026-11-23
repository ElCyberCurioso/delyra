import { z } from "zod";
import { ROLES } from "../constants";

/** Esquemas de autenticación compartidos por la API y los formularios (F1). */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "Email no válido" }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: `Mínimo ${String(PASSWORD_MIN_LENGTH)} caracteres` })
  .max(PASSWORD_MAX_LENGTH, { error: `Máximo ${String(PASSWORD_MAX_LENGTH)} caracteres` });

export const nameSchema = z.string().trim().min(1, { error: "Indica tu nombre" }).max(80);

/** Token opaco (invitación, recuperación) en base64url. */
export const opaqueTokenSchema = z.string().regex(/^[\w-]{20,128}$/, { error: "Enlace no válido" });

export const totpCodeSchema = z.string().regex(/^\d{6}$/, { error: "Código de 6 dígitos" });

/** Código de recuperación: 10 caracteres base32 en dos grupos (`abcde-fghij`). */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z2-7]{5}-?[a-z2-7]{5}$/, { error: "Código de recuperación no válido" });

export const turnstileTokenSchema = z
  .string()
  .min(1, { error: "Completa la verificación" })
  .max(2048);

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  turnstileToken: turnstileTokenSchema,
});

export const secondFactorRequestSchema = z.object({
  code: z.string().trim().min(6).max(16),
});

export const registerRequestSchema = z.object({
  token: opaqueTokenSchema,
  name: nameSchema,
  password: passwordSchema,
  turnstileToken: turnstileTokenSchema,
});

export const invitationTokenRequestSchema = z.object({ token: opaqueTokenSchema });

export const totpConfirmRequestSchema = z.object({ code: totpCodeSchema });

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
  turnstileToken: turnstileTokenSchema,
});

export const resetPasswordRequestSchema = z.object({
  token: opaqueTokenSchema,
  password: passwordSchema,
});

export const createInvitationRequestSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES).default("member"),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const SESSION_STATES = ["pending_2fa", "pending_totp", "active"] as const;
export type SessionStateName = (typeof SESSION_STATES)[number];

export const meResponseSchema = z.object({
  state: z.enum(SESSION_STATES),
  /** Con la sesión pendiente del segundo factor: la cuenta tiene llaves de acceso (F7-09). */
  passkey: z.boolean().optional(),
  user: z
    .object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      role: z.enum(ROLES),
    })
    .nullable(),
  settings: z
    .object({
      timeZone: z.string(),
      locale: z.string(),
      weekStart: z.number(),
    })
    .nullable(),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

export const authConfigResponseSchema = z.object({
  turnstileSiteKey: z.string().nullable(),
});

export type AuthConfigResponse = z.infer<typeof authConfigResponseSchema>;

/** Siguiente paso del flujo que indica la API tras login o registro. */
export const authStepResponseSchema = z.object({
  next: z.enum(["2fa", "totp-setup", "done"]),
});

export type AuthStepResponse = z.infer<typeof authStepResponseSchema>;

export const secondFactorResponseSchema = z.object({
  next: z.literal("done"),
  remainingRecoveryCodes: z.number().int().min(0),
});

export const invitationInfoResponseSchema = z.object({
  email: z.string(),
  role: z.enum(ROLES),
  expiresAt: z.iso.datetime(),
});

export const totpSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string().startsWith("otpauth://totp/"),
});

export const totpConfirmResponseSchema = z.object({
  recoveryCodes: z.array(z.string()).min(1),
});
