import { APP_ORIGINS, appEnvironmentSchema, newId } from "@delyra/shared";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { type CalendarFeed, calendarFeeds, calendars } from "../db/schema";
import { randomToken, sha256Hex } from "../lib/crypto";
import { decryptField, encryptField, type Keyring } from "../lib/field-crypto";

/**
 * Feeds ICS privados (F7-02). La URL lleva un token de 256 bits: quien la tenga puede leer ese
 * calendario (como la «dirección secreta» de Google), así que se puede regenerar o revocar.
 */

const aad = (ownerId: string, calendarId: string) => `feed:${ownerId}:${calendarId}`;

export function feedUrl(appEnv: string, token: string): string {
  const origin = APP_ORIGINS[appEnvironmentSchema.parse(appEnv)].calendar;
  return `${origin}/api/feeds/${token}.ics`;
}

export function feedRepository(db: Database, ownerId: string) {
  const own = (calendarId: string) =>
    and(eq(calendarFeeds.ownerId, ownerId), eq(calendarFeeds.calendarId, calendarId));
  return {
    async get(calendarId: string): Promise<CalendarFeed | null> {
      const [row] = await db.select().from(calendarFeeds).where(own(calendarId)).limit(1);
      return row ?? null;
    },

    /** Crea el feed o lo regenera (el token anterior deja de funcionar). Devuelve el token. */
    async rotate(calendarId: string, keyring: Keyring): Promise<string> {
      const token = randomToken(32);
      const values = {
        tokenHash: await sha256Hex(token),
        tokenEnc: await encryptField(token, keyring, aad(ownerId, calendarId)),
        createdAt: new Date(),
        lastAccessedAt: null,
      };
      await db
        .insert(calendarFeeds)
        .values({ id: newId(), ownerId, calendarId, ...values })
        .onConflictDoUpdate({ target: calendarFeeds.calendarId, set: values });
      return token;
    },

    async token(row: CalendarFeed, keyring: Keyring): Promise<string> {
      return decryptField(row.tokenEnc, keyring, aad(ownerId, row.calendarId));
    },

    async revoke(calendarId: string): Promise<void> {
      await db.delete(calendarFeeds).where(own(calendarId));
    },
  };
}

/** Busca el feed por el token de la URL (sin sesión). Null si no existe o el formato no vale. */
export async function resolveFeed(db: Database, token: string) {
  if (!/^[\w-]{43}$/.test(token)) return null;
  const [row] = await db
    .select({ feed: calendarFeeds, calendar: calendars })
    .from(calendarFeeds)
    .innerJoin(calendars, eq(calendars.id, calendarFeeds.calendarId))
    .where(eq(calendarFeeds.tokenHash, await sha256Hex(token)))
    .limit(1);
  return row ?? null;
}

export async function touchFeed(db: Database, id: string, now: number) {
  await db.update(calendarFeeds).set({ lastAccessedAt: now }).where(eq(calendarFeeds.id, id));
}
