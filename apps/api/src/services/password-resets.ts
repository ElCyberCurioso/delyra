import { APP_ORIGINS, type AppEnvironment, newId } from "@delyra/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { passwordResets } from "../db/schema";
import { randomToken, sha256Hex } from "../lib/crypto";

/** Recuperación de contraseña (F1-11): token de un solo uso válido 30 minutos. */

export const PASSWORD_RESET_TTL_MS = 30 * 60_000;

export function passwordResetLink(environment: AppEnvironment, token: string): string {
  return `${APP_ORIGINS[environment].calendar}/restablecer#token=${token}`;
}

/** Crea un token nuevo e invalida los anteriores sin usar del mismo usuario. */
export async function createPasswordReset(
  db: Database,
  userId: string,
  now = Date.now(),
): Promise<string> {
  const token = randomToken();
  await db.batch([
    db
      .update(passwordResets)
      .set({ usedAt: new Date(now) })
      .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt))),
    db.insert(passwordResets).values({
      id: newId(),
      userId,
      tokenHash: await sha256Hex(token),
      createdAt: new Date(now),
      expiresAt: new Date(now + PASSWORD_RESET_TTL_MS),
    }),
  ]);
  return token;
}

/** Consume el token de forma atómica y devuelve el usuario, o `null` si no vale. */
export async function consumePasswordReset(
  db: Database,
  token: string,
  now = Date.now(),
): Promise<string | null> {
  const [row] = await db
    .update(passwordResets)
    .set({ usedAt: new Date(now) })
    .where(
      and(
        eq(passwordResets.tokenHash, await sha256Hex(token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date(now)),
      ),
    )
    .returning({ userId: passwordResets.userId });
  return row?.userId ?? null;
}
