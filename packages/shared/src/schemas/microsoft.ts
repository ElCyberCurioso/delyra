import { z } from "zod";
import { idSchema } from "../ids";
import { SUBSCRIPTION_STATUSES } from "./imports";

/**
 * Reuniones de Teams en un tablero (docs/plan-teams.md): conexión con Microsoft 365 y volcado de
 * los eventos del calendario como tarjetas.
 */

export const MICROSOFT_CONNECTION_STATUSES = ["ok", "revoked"] as const;

/** Días por delante que se vuelcan. */
export const MICROSOFT_DAYS_AHEAD = [7, 14, 30] as const;

export const microsoftAuthorizeRequestSchema = z.object({ boardId: idSchema });

export const microsoftBoardSyncRequestSchema = z.object({
  columnId: idSchema,
  /** Solo reuniones de Teams (con enlace para unirse) o todos los eventos del calendario. */
  onlyTeams: z.boolean().default(true),
  daysAhead: z
    .number()
    .int()
    .refine((n) => (MICROSOFT_DAYS_AHEAD as readonly number[]).includes(n), {
      error: "Elige 7, 14 o 30 días",
    })
    .default(14),
});
export type MicrosoftBoardSyncRequest = z.infer<typeof microsoftBoardSyncRequestSchema>;

export const microsoftBoardInfoSchema = z.object({
  /** Falso si el servidor no tiene configurada la app de Microsoft (P-12). */
  enabled: z.boolean(),
  /** Tu conexión con Microsoft 365 (la de quien mira). */
  connection: z
    .object({
      email: z.string().nullable(),
      status: z.enum(MICROSOFT_CONNECTION_STATUSES),
    })
    .nullable(),
  /** Volcado de este tablero, lo haya configurado quien mira u otra persona. */
  sync: z
    .object({
      mine: z.boolean(),
      columnId: z.string(),
      onlyTeams: z.boolean(),
      daysAhead: z.number(),
      status: z.enum(SUBSCRIPTION_STATUSES),
      error: z.string().nullable(),
      cards: z.number(),
      lastSyncedAt: z.string().nullable(),
      nextSyncAt: z.string().nullable(),
    })
    .nullable(),
});
export type MicrosoftBoardInfo = z.infer<typeof microsoftBoardInfoSchema>;
