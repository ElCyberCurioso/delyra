import { and, asc, count, eq, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { calendarSubscriptions, type SubscriptionRow } from "../db/schema";

/** Suscripciones iCal de un usuario (F5-06). */

export type SubscriptionPatch = Partial<
  Pick<
    SubscriptionRow,
    | "etag"
    | "lastModified"
    | "status"
    | "lastError"
    | "failures"
    | "lastSyncedAt"
    | "nextSyncAt"
    | "urlEnc"
    | "urlHint"
  >
>;

export function subscriptionRepository(db: Database, ownerId: string) {
  const own = (id: string) =>
    and(eq(calendarSubscriptions.id, id), eq(calendarSubscriptions.ownerId, ownerId));
  return {
    ownerId,

    async insert(
      row: Omit<SubscriptionRow, "ownerId" | "createdAt" | "updatedAt">,
    ): Promise<SubscriptionRow> {
      const now = new Date();
      const [created] = await db
        .insert(calendarSubscriptions)
        .values({ ...row, ownerId, createdAt: now, updatedAt: now })
        .returning();
      if (!created) throw new Error("No se pudo crear la suscripción");
      return created;
    },

    async get(id: string): Promise<SubscriptionRow | null> {
      const [row] = await db.select().from(calendarSubscriptions).where(own(id)).limit(1);
      return row ?? null;
    },

    async list(): Promise<SubscriptionRow[]> {
      return db
        .select()
        .from(calendarSubscriptions)
        .where(eq(calendarSubscriptions.ownerId, ownerId))
        .orderBy(asc(calendarSubscriptions.createdAt));
    },

    async count(): Promise<number> {
      const [row] = await db
        .select({ total: count() })
        .from(calendarSubscriptions)
        .where(eq(calendarSubscriptions.ownerId, ownerId));
      return row?.total ?? 0;
    },

    async update(id: string, patch: SubscriptionPatch): Promise<SubscriptionRow | null> {
      const [row] = await db
        .update(calendarSubscriptions)
        .set({ ...patch, updatedAt: new Date() })
        .where(own(id))
        .returning();
      return row ?? null;
    },
  };
}

export type SubscriptionRepository = ReturnType<typeof subscriptionRepository>;

/** Suscripciones de cualquier usuario que toca sincronizar (planificador, F5-06). */
export async function dueSubscriptions(
  db: Database,
  now: number,
  limit: number,
): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(calendarSubscriptions)
    .where(lte(calendarSubscriptions.nextSyncAt, now))
    .orderBy(asc(calendarSubscriptions.nextSyncAt))
    .limit(limit);
}

/**
 * Reclama una suscripción para sincronizarla: adelanta `next_sync_at` solo si nadie lo ha hecho
 * ya, de modo que dos ejecuciones del planificador no la sincronicen a la vez.
 */
export async function claimSubscription(
  db: Database,
  row: SubscriptionRow,
  until: number,
): Promise<boolean> {
  const claimed = await db
    .update(calendarSubscriptions)
    .set({ nextSyncAt: until })
    .where(
      and(
        eq(calendarSubscriptions.id, row.id),
        eq(calendarSubscriptions.nextSyncAt, row.nextSyncAt),
      ),
    )
    .returning({ id: calendarSubscriptions.id });
  return claimed.length === 1;
}
