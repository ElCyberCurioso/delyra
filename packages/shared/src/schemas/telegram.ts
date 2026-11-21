import { z } from "zod";

/** Telegram en Ajustes (F3-04, F3-09). */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Hora no válida (HH:MM)" });

export const telegramStatusSchema = z.object({
  /** El bot está configurado en el servidor (P-10). */
  available: z.boolean(),
  botUsername: z.string().nullable(),
  linked: z.boolean(),
  linkedAt: z.iso.datetime().nullable(),
  mutedUntil: z.iso.datetime().nullable(),
  digestTime: hhmm.nullable(),
  quietStart: hhmm.nullable(),
  quietEnd: hhmm.nullable(),
});
export type TelegramStatus = z.infer<typeof telegramStatusSchema>;

export const telegramLinkResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});

export const updateTelegramRequestSchema = z
  .object({
    digestTime: hhmm.nullable(),
    quietStart: hhmm.nullable(),
    quietEnd: hhmm.nullable(),
    /** Solo se puede quitar el silencio desde Ajustes; se silencia con /silenciar. */
    muted: z.literal(false),
  })
  .partial()
  .refine((v) => (v.quietStart === undefined) === (v.quietEnd === undefined), {
    error: "Indica el inicio y el fin de las horas de silencio",
    path: ["quietEnd"],
  })
  .refine((v) => (v.quietStart === null) === (v.quietEnd === null), {
    error: "Indica el inicio y el fin de las horas de silencio",
    path: ["quietEnd"],
  });
