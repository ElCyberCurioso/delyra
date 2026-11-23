import { and, asc, count, eq, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  type GoogleConnectionRow,
  googleConnections,
  type GoogleSyncedCalendarRow,
  googleSyncedCalendars,
} from "../db/schema";

/** Conexión con Google y calendarios sincronizados de un usuario (F7-09). */

export type GoogleConnectionPatch = Partial<
  Pick<
    GoogleConnectionRow,
    "refreshTokenEnc" | "accessTokenEnc" | "accessExpiresAt" | "accountEmail" | "status"
  >
>;

export type GoogleSyncedPatch = Partial<
  Pick<
    GoogleSyncedCalendarRow,
    "syncToken" | "status" | "lastError" | "failures" | "lastSyncedAt" | "nextSyncAt"
  >
>;

export function googleSyncRepository(db: Database, ownerId: string) {
  const ownCalendar = (id: string) =>
    and(eq(googleSyncedCalendars.id, id), eq(googleSyncedCalendars.ownerId, ownerId));
  return {
    ownerId,

    async connection(): Promise<GoogleConnectionRow | null> {
      const [row] = await db
        .select()
        .from(googleConnections)
        .where(eq(googleConnections.ownerId, ownerId))
        .limit(1);
      return row ?? null;
    },

    async saveConnection(
      row: Omit<GoogleConnectionRow, "ownerId" | "createdAt" | "updatedAt">,
    ): Promise<GoogleConnectionRow> {
      const now = new Date();
      const [saved] = await db
        .insert(googleConnections)
        .values({ ...row, ownerId, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: googleConnections.ownerId,
          set: {
            refreshTokenEnc: row.refreshTokenEnc,
            accessTokenEnc: row.accessTokenEnc,
            accessExpiresAt: row.accessExpiresAt,
            accountEmail: row.accountEmail,
            status: row.status,
            updatedAt: now,
          },
        })
        .returning();
      if (!saved) throw new Error("No se pudo guardar la conexión con Google");
      return saved;
    },

    async updateConnection(patch: GoogleConnectionPatch): Promise<void> {
      await db
        .update(googleConnections)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(googleConnections.ownerId, ownerId));
    },

    async deleteConnection(): Promise<void> {
      await db.delete(googleConnections).where(eq(googleConnections.ownerId, ownerId));
    },

    async calendars(): Promise<GoogleSyncedCalendarRow[]> {
      return db
        .select()
        .from(googleSyncedCalendars)
        .where(eq(googleSyncedCalendars.ownerId, ownerId))
        .orderBy(asc(googleSyncedCalendars.createdAt));
    },

    async calendar(id: string): Promise<GoogleSyncedCalendarRow | null> {
      const [row] = await db.select().from(googleSyncedCalendars).where(ownCalendar(id)).limit(1);
      return row ?? null;
    },

    async countCalendars(): Promise<number> {
      const [row] = await db
        .select({ total: count() })
        .from(googleSyncedCalendars)
        .where(eq(googleSyncedCalendars.ownerId, ownerId));
      return row?.total ?? 0;
    },

    async insertCalendar(
      row: Omit<GoogleSyncedCalendarRow, "ownerId" | "createdAt" | "updatedAt">,
    ): Promise<GoogleSyncedCalendarRow> {
      const now = new Date();
      const [created] = await db
        .insert(googleSyncedCalendars)
        .values({ ...row, ownerId, createdAt: now, updatedAt: now })
        .returning();
      if (!created) throw new Error("No se pudo crear la sincronización");
      return created;
    },

    async updateCalendar(id: string, patch: GoogleSyncedPatch): Promise<void> {
      await db
        .update(googleSyncedCalendars)
        .set({ ...patch, updatedAt: new Date() })
        .where(ownCalendar(id));
    },

    /** Mismo cambio en todos los calendarios de la conexión (revocada o reconectada). */
    async updateAllCalendars(patch: GoogleSyncedPatch): Promise<void> {
      await db
        .update(googleSyncedCalendars)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(googleSyncedCalendars.ownerId, ownerId));
    },
  };
}

export type GoogleSyncRepository = ReturnType<typeof googleSyncRepository>;

/** Calendarios de cualquier usuario que toca sincronizar (planificador). */
export async function dueGoogleCalendars(
  db: Database,
  now: number,
  limit: number,
): Promise<GoogleSyncedCalendarRow[]> {
  return db
    .select()
    .from(googleSyncedCalendars)
    .where(lte(googleSyncedCalendars.nextSyncAt, now))
    .orderBy(asc(googleSyncedCalendars.nextSyncAt))
    .limit(limit);
}

/** Reclama un calendario para que dos pasadas del planificador no lo sincronicen a la vez. */
export async function claimGoogleCalendar(
  db: Database,
  row: GoogleSyncedCalendarRow,
  until: number,
): Promise<boolean> {
  const claimed = await db
    .update(googleSyncedCalendars)
    .set({ nextSyncAt: until })
    .where(
      and(
        eq(googleSyncedCalendars.id, row.id),
        eq(googleSyncedCalendars.nextSyncAt, row.nextSyncAt),
      ),
    )
    .returning({ id: googleSyncedCalendars.id });
  return claimed.length === 1;
}
