import { newId } from "@delyra/shared";
import { and, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { boards, cardActivity, cards } from "../db/schema";

/**
 * Autoarchivado diario (F4-07): las tarjetas terminadas hace más de los días que indica su
 * tablero pasan a archivadas (se pueden restaurar desde la vista de archivados).
 */

const DAY_MS = 86_400_000;
const BATCH = 500;

export async function runAutoarchive(db: Database, now: number): Promise<number> {
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const due = await db
      .select({ id: cards.id, ownerId: cards.ownerId })
      .from(cards)
      .innerJoin(boards, sql`${boards.id} = ${cards.boardId}`)
      .where(
        and(
          isNull(cards.archivedAt),
          isNotNull(cards.completedAt),
          gt(boards.autoarchiveDays, 0),
          lt(cards.completedAt, sql`${now} - ${boards.autoarchiveDays} * ${DAY_MS}`),
        ),
      )
      .limit(BATCH);
    if (due.length === 0) break;
    const at = new Date(now);
    await db.batch([
      db
        .update(cards)
        .set({ archivedAt: at, updatedAt: at })
        .where(
          inArray(
            cards.id,
            due.map((c) => c.id),
          ),
        ),
      db.insert(cardActivity).values(
        due.map((c) => ({
          id: newId(),
          ownerId: c.ownerId,
          cardId: c.id,
          kind: "autoarchived",
          data: "{}",
          createdAt: at,
        })),
      ),
    ]);
    total += due.length;
    if (due.length < BATCH) break;
  }
  return total;
}
