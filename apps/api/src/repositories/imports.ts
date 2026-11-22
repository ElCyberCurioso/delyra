import { newId } from "@delyra/shared";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { type ImportRow, imports } from "../db/schema";

/** Importaciones de un usuario (F5-02). Como todo repositorio, siempre filtra por `ownerId`. */

export type NewImport = Pick<ImportRow, "source" | "status" | "filename" | "sizeBytes"> &
  Partial<Pick<ImportRow, "googleTokenEnc">>;

export type ImportPatch = Partial<
  Pick<
    ImportRow,
    | "status"
    | "preview"
    | "options"
    | "progressDone"
    | "progressTotal"
    | "report"
    | "error"
    | "googleTokenEnc"
    | "finishedAt"
  >
>;

export function importRepository(db: Database, ownerId: string) {
  const own = (id: string) => and(eq(imports.id, id), eq(imports.ownerId, ownerId));
  return {
    ownerId,

    async create(input: NewImport): Promise<ImportRow> {
      const now = new Date();
      const [row] = await db
        .insert(imports)
        .values({ ...input, id: newId(), ownerId, createdAt: now, updatedAt: now })
        .returning();
      if (!row) throw new Error("No se pudo crear la importación");
      return row;
    },

    async get(id: string): Promise<ImportRow | null> {
      const [row] = await db.select().from(imports).where(own(id)).limit(1);
      return row ?? null;
    },

    async list(limit = 10): Promise<ImportRow[]> {
      return db
        .select()
        .from(imports)
        .where(eq(imports.ownerId, ownerId))
        .orderBy(desc(imports.createdAt))
        .limit(limit);
    },

    async update(id: string, patch: ImportPatch): Promise<ImportRow | null> {
      const [row] = await db
        .update(imports)
        .set({ ...patch, updatedAt: new Date() })
        .where(own(id))
        .returning();
      return row ?? null;
    },

    /** Cambia el estado solo si sigue en el esperado (evita dos arranques a la vez). */
    async transition(
      id: string,
      from: ImportRow["status"],
      patch: ImportPatch & { status: ImportRow["status"] },
    ): Promise<ImportRow | null> {
      const [row] = await db
        .update(imports)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(own(id), eq(imports.status, from)))
        .returning();
      return row ?? null;
    },

    async remove(id: string): Promise<void> {
      await db.delete(imports).where(own(id));
    },

    /** Importaciones en marcha (analizando o importando). */
    async active(): Promise<ImportRow[]> {
      return db
        .select()
        .from(imports)
        .where(
          and(eq(imports.ownerId, ownerId), inArray(imports.status, ["analyzing", "importing"])),
        );
    },

    async createdSince(since: number): Promise<number> {
      const [row] = await db
        .select({ total: count() })
        .from(imports)
        .where(and(eq(imports.ownerId, ownerId), gt(imports.createdAt, new Date(since))));
      return row?.total ?? 0;
    },
  };
}

export type ImportRepository = ReturnType<typeof importRepository>;
