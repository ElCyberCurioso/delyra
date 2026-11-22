import { newId } from "@delyra/shared";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Database } from "../db/client";
import {
  boardColumns,
  boards,
  cardActivity,
  cardAttachments,
  cardComments,
  cardLabels,
  cards,
  checklistItems,
  labels,
  reminders,
} from "../db/schema";

/**
 * Kanban de un usuario (F4-03 a F4-06). Cada consulta lleva `owner_id`: no hay forma de leer
 * ni tocar el tablero de otra persona desde aquí (§3.5).
 */

type Insert<T extends { $inferInsert: unknown }> = Omit<
  T["$inferInsert"],
  "id" | "ownerId" | "createdAt" | "updatedAt"
>;

export function kanbanRepository(db: Database, ownerId: string) {
  const now = () => new Date();
  const mine = (table: { ownerId: AnySQLiteColumn; id: AnySQLiteColumn }, id: string) =>
    and(eq(table.ownerId, ownerId), eq(table.id, id));

  return {
    db,
    ownerId,

    // ── Tableros ─────────────────────────────────────────────────────────────

    async listBoards() {
      const open = db
        .select({ boardId: cards.boardId, total: count().as("total") })
        .from(cards)
        .where(and(eq(cards.ownerId, ownerId), isNull(cards.archivedAt), isNull(cards.completedAt)))
        .groupBy(cards.boardId)
        .as("open");
      return db
        .select({ board: boards, openCards: sql<number>`coalesce(${open.total}, 0)` })
        .from(boards)
        .leftJoin(open, eq(open.boardId, boards.id))
        .where(eq(boards.ownerId, ownerId))
        .orderBy(asc(boards.createdAt));
    },

    async getBoard(id: string) {
      const [row] = await db.select().from(boards).where(mine(boards, id)).limit(1);
      return row ?? null;
    },

    async countBoards() {
      const [row] = await db
        .select({ total: count() })
        .from(boards)
        .where(eq(boards.ownerId, ownerId));
      return row?.total ?? 0;
    },

    insertBoard(input: Insert<typeof boards>) {
      const at = now();
      return { id: newId(), ownerId, ...input, createdAt: at, updatedAt: at };
    },

    async updateBoard(id: string, patch: Partial<Insert<typeof boards>>) {
      const [row] = await db
        .update(boards)
        .set({ ...patch, updatedAt: now() })
        .where(mine(boards, id))
        .returning();
      return row ?? null;
    },

    async deleteBoard(id: string) {
      await db.delete(boards).where(mine(boards, id));
    },

    // ── Columnas ─────────────────────────────────────────────────────────────

    columnsOf(boardId: string) {
      return db
        .select()
        .from(boardColumns)
        .where(and(eq(boardColumns.ownerId, ownerId), eq(boardColumns.boardId, boardId)))
        .orderBy(asc(boardColumns.position));
    },

    async getColumn(id: string) {
      const [row] = await db.select().from(boardColumns).where(mine(boardColumns, id)).limit(1);
      return row ?? null;
    },

    newColumn(input: Insert<typeof boardColumns>) {
      const at = now();
      return { id: newId(), ownerId, ...input, createdAt: at, updatedAt: at };
    },

    async updateColumn(id: string, patch: Partial<Insert<typeof boardColumns>>) {
      const [row] = await db
        .update(boardColumns)
        .set({ ...patch, updatedAt: now() })
        .where(mine(boardColumns, id))
        .returning();
      return row ?? null;
    },

    async deleteColumn(id: string) {
      await db.delete(boardColumns).where(mine(boardColumns, id));
    },

    // ── Tarjetas ─────────────────────────────────────────────────────────────

    cardsOfBoard(boardId: string, archived: boolean) {
      return db
        .select()
        .from(cards)
        .where(
          and(
            eq(cards.ownerId, ownerId),
            eq(cards.boardId, boardId),
            archived ? isNotNull(cards.archivedAt) : isNull(cards.archivedAt),
          ),
        )
        .orderBy(archived ? desc(cards.archivedAt) : asc(cards.position));
    },

    cardsInColumn(columnId: string) {
      return db
        .select({ id: cards.id, position: cards.position })
        .from(cards)
        .where(
          and(eq(cards.ownerId, ownerId), eq(cards.columnId, columnId), isNull(cards.archivedAt)),
        )
        .orderBy(asc(cards.position));
    },

    async countCards(boardId: string) {
      const [row] = await db
        .select({ total: count() })
        .from(cards)
        .where(and(eq(cards.ownerId, ownerId), eq(cards.boardId, boardId)));
      return row?.total ?? 0;
    },

    async getCard(id: string) {
      const [row] = await db.select().from(cards).where(mine(cards, id)).limit(1);
      return row ?? null;
    },

    newCard(input: Insert<typeof cards>) {
      const at = now();
      return { id: newId(), ownerId, ...input, createdAt: at, updatedAt: at };
    },

    async updateCard(id: string, patch: Partial<Insert<typeof cards>>) {
      const [row] = await db
        .update(cards)
        .set({ ...patch, updatedAt: now() })
        .where(mine(cards, id))
        .returning();
      return row ?? null;
    },

    async deleteCard(id: string) {
      await db.delete(cards).where(mine(cards, id));
    },

    /** Tarjetas abiertas con fecha límite en `[from, to)` (capa del calendario, /tareas). */
    dueCards(from: number, to: number) {
      return db
        .select({ card: cards, boardName: boards.name })
        .from(cards)
        .innerJoin(boards, eq(boards.id, cards.boardId))
        .where(
          and(
            eq(cards.ownerId, ownerId),
            isNull(cards.archivedAt),
            gte(cards.dueAt, from),
            lt(cards.dueAt, to),
          ),
        )
        .orderBy(asc(cards.dueAt))
        .limit(500);
    },

    /** Tareas abiertas con fecha límite anterior a `before` (incluidas las vencidas). */
    openTasks(before: number, limit = 200) {
      return db
        .select({ card: cards, boardName: boards.name, isDone: boardColumns.isDone })
        .from(cards)
        .innerJoin(boards, eq(boards.id, cards.boardId))
        .innerJoin(boardColumns, eq(boardColumns.id, cards.columnId))
        .where(
          and(
            eq(cards.ownerId, ownerId),
            isNull(cards.archivedAt),
            isNull(cards.completedAt),
            isNotNull(cards.dueAt),
            lt(cards.dueAt, before),
          ),
        )
        .orderBy(asc(cards.dueAt))
        .limit(limit);
    },

    // ── Etiquetas ────────────────────────────────────────────────────────────

    labelsOf(boardId: string) {
      return db
        .select()
        .from(labels)
        .where(and(eq(labels.ownerId, ownerId), eq(labels.boardId, boardId)))
        .orderBy(asc(labels.createdAt));
    },

    async getLabel(id: string) {
      const [row] = await db.select().from(labels).where(mine(labels, id)).limit(1);
      return row ?? null;
    },

    async updateLabel(id: string, patch: { name?: string; color?: string }) {
      if (patch.name === undefined && patch.color === undefined) {
        const [row] = await db.select().from(labels).where(mine(labels, id)).limit(1);
        return row ?? null;
      }
      const [row] = await db.update(labels).set(patch).where(mine(labels, id)).returning();
      return row ?? null;
    },

    async deleteLabel(id: string) {
      await db.delete(labels).where(mine(labels, id));
    },

    /** `card_labels` no tiene `owner_id`: se filtra por las tarjetas del usuario. */
    async labelIdsOfBoard(boardId: string) {
      const rows = await db
        .select({ cardId: cardLabels.cardId, labelId: cardLabels.labelId })
        .from(cardLabels)
        .innerJoin(cards, eq(cards.id, cardLabels.cardId))
        .where(and(eq(cards.ownerId, ownerId), eq(cards.boardId, boardId)));
      const map = new Map<string, string[]>();
      for (const row of rows) map.set(row.cardId, [...(map.get(row.cardId) ?? []), row.labelId]);
      return map;
    },

    // ── Checklist, comentarios, adjuntos y actividad ─────────────────────────

    checklistOf(cardId: string) {
      return db
        .select()
        .from(checklistItems)
        .where(and(eq(checklistItems.ownerId, ownerId), eq(checklistItems.cardId, cardId)))
        .orderBy(asc(checklistItems.position));
    },

    async getChecklistItem(id: string) {
      const [row] = await db.select().from(checklistItems).where(mine(checklistItems, id)).limit(1);
      return row ?? null;
    },

    async checklistStats(boardId: string) {
      const rows = await db
        .select({
          cardId: checklistItems.cardId,
          total: count(),
          done: sql<number>`sum(case when ${checklistItems.done} then 1 else 0 end)`,
        })
        .from(checklistItems)
        .innerJoin(cards, eq(cards.id, checklistItems.cardId))
        .where(and(eq(checklistItems.ownerId, ownerId), eq(cards.boardId, boardId)))
        .groupBy(checklistItems.cardId);
      return new Map(rows.map((r) => [r.cardId, { total: r.total, done: Number(r.done) }]));
    },

    commentsOf(cardId: string) {
      return db
        .select()
        .from(cardComments)
        .where(and(eq(cardComments.ownerId, ownerId), eq(cardComments.cardId, cardId)))
        .orderBy(asc(cardComments.createdAt));
    },

    async getComment(id: string) {
      const [row] = await db.select().from(cardComments).where(mine(cardComments, id)).limit(1);
      return row ?? null;
    },

    attachmentsOf(cardId: string) {
      return db
        .select()
        .from(cardAttachments)
        .where(and(eq(cardAttachments.ownerId, ownerId), eq(cardAttachments.cardId, cardId)))
        .orderBy(asc(cardAttachments.createdAt));
    },

    async getAttachment(id: string) {
      const [row] = await db
        .select()
        .from(cardAttachments)
        .where(mine(cardAttachments, id))
        .limit(1);
      return row ?? null;
    },

    /** Cuántos comentarios y adjuntos tiene cada tarjeta del tablero. */
    async countsOfBoard(boardId: string) {
      const perCard = async (table: typeof cardComments | typeof cardAttachments) => {
        const rows = await db
          .select({ cardId: table.cardId, total: count() })
          .from(table)
          .innerJoin(cards, eq(cards.id, table.cardId))
          .where(and(eq(table.ownerId, ownerId), eq(cards.boardId, boardId)))
          .groupBy(table.cardId);
        return new Map(rows.map((r) => [r.cardId, r.total]));
      };
      return { comments: await perCard(cardComments), attachments: await perCard(cardAttachments) };
    },

    activityOf(cardId: string) {
      return db
        .select()
        .from(cardActivity)
        .where(and(eq(cardActivity.ownerId, ownerId), eq(cardActivity.cardId, cardId)))
        .orderBy(desc(cardActivity.createdAt))
        .limit(50);
    },

    activity(cardId: string, kind: string, data: Record<string, unknown> = {}) {
      return db.insert(cardActivity).values({
        id: newId(),
        ownerId,
        cardId,
        kind,
        data: JSON.stringify(data),
        createdAt: now(),
      });
    },

    // ── Alertas de tarjetas (F4-07) ─────────────────────────────────────────

    remindersOfCard(cardId: string) {
      return db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.ownerId, ownerId),
            eq(reminders.targetType, "card"),
            eq(reminders.targetId, cardId),
          ),
        )
        .orderBy(asc(reminders.offsetMinutes));
    },

    async deleteRemindersOfCards(cardIds: readonly string[]) {
      if (cardIds.length === 0) return;
      await db
        .delete(reminders)
        .where(
          and(
            eq(reminders.ownerId, ownerId),
            eq(reminders.targetType, "card"),
            inArray(reminders.targetId, [...cardIds]),
          ),
        );
    },
  };
}

export type KanbanRepository = ReturnType<typeof kanbanRepository>;
