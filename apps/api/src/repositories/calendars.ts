import { DEFAULT_CALENDAR_NAMES, DEFAULT_CALENDARS, type Locale, newId } from "@delyra/shared";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { type Calendar, calendars } from "../db/schema";

/**
 * Calendarios de un usuario (F2-02). Toda consulta lleva `ownerId`: no hay forma de leer ni
 * tocar un calendario ajeno desde aquí (§3.5).
 */
export function calendarRepository(db: Database, ownerId: string) {
  const own = (id: string) => and(eq(calendars.id, id), eq(calendars.ownerId, ownerId));

  return {
    async list(): Promise<Calendar[]> {
      return db
        .select()
        .from(calendars)
        .where(eq(calendars.ownerId, ownerId))
        .orderBy(asc(calendars.position), asc(calendars.createdAt));
    },

    async get(id: string): Promise<Calendar | null> {
      const [row] = await db.select().from(calendars).where(own(id)).limit(1);
      return row ?? null;
    },

    async count(): Promise<number> {
      const [row] = await db
        .select({ total: count() })
        .from(calendars)
        .where(eq(calendars.ownerId, ownerId));
      return row?.total ?? 0;
    },

    async create(input: {
      name: string;
      color: string;
      kind?: Calendar["kind"];
      position?: number;
      readOnly?: boolean;
    }): Promise<Calendar> {
      const now = new Date();
      const [row] = await db
        .insert(calendars)
        .values({
          id: newId(),
          ownerId,
          name: input.name,
          color: input.color,
          kind: input.kind ?? "custom",
          position: input.position ?? (await this.count()),
          readOnly: input.readOnly ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("No se pudo crear el calendario");
      return row;
    },

    async update(
      id: string,
      patch: Partial<Pick<Calendar, "name" | "color" | "visible" | "position">>,
    ): Promise<Calendar | null> {
      const [row] = await db
        .update(calendars)
        .set({ ...patch, updatedAt: new Date() })
        .where(own(id))
        .returning();
      return row ?? null;
    },

    /** Borra el calendario y, en cascada, sus eventos. */
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(calendars).where(own(id)).returning({ id: calendars.id });
      return rows.length === 1;
    },

    /** Personal, Trabajo y Cumpleaños, si el usuario aún no tiene ningún calendario (F2-03). */
    async ensureDefaults(locale: Locale = "es"): Promise<void> {
      if ((await this.count()) > 0) return;
      const now = new Date();
      await db.insert(calendars).values(
        DEFAULT_CALENDARS.map((calendar, position) => ({
          id: newId(),
          ownerId,
          name: DEFAULT_CALENDAR_NAMES[locale][calendar.kind] ?? calendar.name,
          color: calendar.color,
          kind: calendar.kind,
          position,
          createdAt: now,
          updatedAt: now,
        })),
      );
    },
  };
}

export type CalendarRepository = ReturnType<typeof calendarRepository>;
