import {
  checklistItemRequestSchema,
  columnRequestSchema,
  commentRequestSchema,
  createBoardRequestSchema,
  createCardRequestSchema,
  idSchema,
  KANBAN_LIMITS,
  labelRequestSchema,
  moveCardRequestSchema,
  moveRequestSchema,
  newId,
  updateBoardRequestSchema,
  updateCardRequestSchema,
  updateChecklistItemRequestSchema,
  updateColumnRequestSchema,
  updateLabelRequestSchema,
} from "@delyra/shared";
import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { createDb } from "../db/client";
import { cardAttachments, cardComments, checklistItems, labels } from "../db/schema";
import { AppError } from "../lib/errors";
import { invalidField, readBody, readQuery } from "../lib/http";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { kanbanRepository } from "../repositories/kanban";
import {
  attachmentKey,
  contentDisposition,
  deletePrefix,
  peekStream,
  sanitizeFilename,
  sniffType,
} from "../services/attachments";
import {
  addChecklistItem,
  addColumn,
  boardDetail,
  cardDetail,
  createBoard,
  createCard,
  dueOf,
  listBoards,
  moveCard,
  moveColumn,
  requireBoard,
  requireCard,
  setArchived,
  updateCard,
} from "../services/kanban";
import type { AppEnv } from "../types";

/**
 * Kanban (F4-03 a F4-06, F4-11). Toda ruta usa el repositorio del usuario: un id de otro
 * usuario responde 404, igual que uno inexistente.
 */

function repo(c: Context<AppEnv>) {
  return kanbanRepository(createDb(c.env.DB), currentAuth(c).user.id);
}

function idParam(c: Context<AppEnv>): string {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(404);
  return id.data;
}

async function detailOf(c: Context<AppEnv>, cardId: string) {
  const r = repo(c);
  return cardDetail(r, await requireCard(r, cardId));
}

// ── Tableros ─────────────────────────────────────────────────────────────────

export const boardRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .get("/", async (c) => c.json({ boards: await listBoards(repo(c)) }))

  .post("/", async (c) => {
    const body = await readBody(c, createBoardRequestSchema);
    const r = repo(c);
    const board = await createBoard(r, body);
    return c.json(await boardDetail(r, board), 201);
  })

  .get("/:id", async (c) => {
    const r = repo(c);
    return c.json(await boardDetail(r, await requireBoard(r, idParam(c))));
  })

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateBoardRequestSchema);
    const r = repo(c);
    await requireBoard(r, id);
    const board = await r.updateBoard(id, body);
    if (!board) throw new AppError(404);
    return c.json(await boardDetail(r, board));
  })

  .delete("/:id", async (c) => {
    const r = repo(c);
    const board = await requireBoard(r, idParam(c));
    const cardIds = (await r.cardsOfBoard(board.id, false))
      .concat(await r.cardsOfBoard(board.id, true))
      .map((card) => card.id);
    await r.deleteRemindersOfCards(cardIds);
    await deletePrefix(c.env.ATTACHMENTS, `boards/${r.ownerId}/${board.id}/`);
    await r.deleteBoard(board.id);
    return c.body(null, 204);
  })

  .post("/:id/columns", async (c) => {
    const body = await readBody(c, columnRequestSchema);
    const r = repo(c);
    const board = await requireBoard(r, idParam(c));
    await addColumn(r, board, body);
    return c.json(await boardDetail(r, board), 201);
  })

  .post("/:id/labels", async (c) => {
    const body = await readBody(c, labelRequestSchema);
    const r = repo(c);
    const board = await requireBoard(r, idParam(c));
    if ((await r.labelsOf(board.id)).length >= KANBAN_LIMITS.labelsPerBoard) {
      throw new AppError(409, { detail: "Demasiadas etiquetas en este tablero" });
    }
    const label = {
      id: newId(),
      ownerId: r.ownerId,
      boardId: board.id,
      ...body,
      createdAt: new Date(),
    };
    await r.db.insert(labels).values(label);
    return c.json({ label: { id: label.id, name: label.name, color: label.color } }, 201);
  })

  .get("/:id/archived", async (c) => {
    const r = repo(c);
    const board = await requireBoard(r, idParam(c));
    const archived = await r.cardsOfBoard(board.id, true);
    return c.json({
      cards: archived.map((card) => ({
        id: card.id,
        title: card.title,
        columnId: card.columnId,
        archivedAt: card.archivedAt?.toISOString() ?? null,
        completedAt: card.completedAt?.toISOString() ?? null,
      })),
    });
  });

// ── Columnas y etiquetas ─────────────────────────────────────────────────────

export const columnRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateColumnRequestSchema);
    const r = repo(c);
    const column = await r.updateColumn(id, body);
    if (!column) throw new AppError(404);
    return c.json(await boardDetail(r, await requireBoard(r, column.boardId)));
  })

  .post("/:id/move", async (c) => {
    const id = idParam(c);
    const { index } = await readBody(c, moveRequestSchema);
    const r = repo(c);
    await moveColumn(r, id, index);
    const column = await r.getColumn(id);
    return c.json(await boardDetail(r, await requireBoard(r, column?.boardId ?? "")));
  })

  .delete("/:id", async (c) => {
    const r = repo(c);
    const column = await r.getColumn(idParam(c));
    if (!column) throw new AppError(404);
    const all = (await r.cardsOfBoard(column.boardId, false)).concat(
      await r.cardsOfBoard(column.boardId, true),
    );
    const inColumn = all.filter((card) => card.columnId === column.id);
    await r.deleteRemindersOfCards(inColumn.map((card) => card.id));
    for (const card of inColumn) {
      await deletePrefix(c.env.ATTACHMENTS, `boards/${r.ownerId}/${card.boardId}/${card.id}/`);
    }
    await r.deleteColumn(column.id);
    return c.body(null, 204);
  })

  .post("/:id/cards", async (c) => {
    const { title } = await readBody(c, createCardRequestSchema);
    const r = repo(c);
    const card = await createCard(r, idParam(c), title);
    return c.json({ card: await cardDetail(r, card) }, 201);
  });

export const labelRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateLabelRequestSchema);
    const label = await repo(c).updateLabel(id, body);
    if (!label) throw new AppError(404);
    return c.json({ label: { id: label.id, name: label.name, color: label.color } });
  })

  .delete("/:id", async (c) => {
    const r = repo(c);
    const id = idParam(c);
    if (!(await r.getLabel(id))) throw new AppError(404);
    await r.deleteLabel(id);
    return c.body(null, 204);
  });

// ── Tarjetas ─────────────────────────────────────────────────────────────────

const dueQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

export const cardRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  /** Capa «Tareas» del calendario (F4-11): tarjetas con fecha límite en el rango. */
  .get("/due", async (c) => {
    const query = readQuery(c, dueQuerySchema);
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    if (!(to > from) || to - from > 400 * 86_400_000) throw invalidField("to", "Rango no válido");
    // Las de día completo se guardan a medianoche UTC: se amplía un día por cada lado.
    const rows = await repo(c).dueCards(from - 86_400_000, to + 86_400_000);
    const cards = rows
      .filter(({ card }) => {
        const at = card.dueAt ?? 0;
        if (!card.dueAllDay) return at >= from && at < to;
        return at + 86_400_000 > from - 14 * 3_600_000 && at < to + 14 * 3_600_000;
      })
      .map(({ card, boardName }) => {
        const due = dueOf(card);
        return due
          ? {
              id: card.id,
              boardId: card.boardId,
              boardName,
              title: card.title,
              priority: card.priority,
              due,
              completed: card.completedAt !== null,
            }
          : null;
      })
      .filter((card) => card !== null);
    return c.json({ cards });
  })

  .get("/:id", async (c) => c.json({ card: await detailOf(c, idParam(c)) }))

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateCardRequestSchema);
    const r = repo(c);
    const card = await updateCard(r, id, body);
    return c.json({ card: await cardDetail(r, card) });
  })

  .post("/:id/move", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, moveCardRequestSchema);
    const r = repo(c);
    const { card, wipExceeded } = await moveCard(r, id, body);
    return c.json({ card: await cardDetail(r, card), wipExceeded });
  })

  .post("/:id/archive", async (c) => {
    const r = repo(c);
    return c.json({ card: await cardDetail(r, await setArchived(r, idParam(c), true)) });
  })

  .post("/:id/restore", async (c) => {
    const r = repo(c);
    return c.json({ card: await cardDetail(r, await setArchived(r, idParam(c), false)) });
  })

  .delete("/:id", async (c) => {
    const r = repo(c);
    const card = await requireCard(r, idParam(c));
    await r.deleteRemindersOfCards([card.id]);
    await deletePrefix(c.env.ATTACHMENTS, `boards/${r.ownerId}/${card.boardId}/${card.id}/`);
    await r.deleteCard(card.id);
    return c.body(null, 204);
  })

  .post("/:id/checklist", async (c) => {
    const { text } = await readBody(c, checklistItemRequestSchema);
    const r = repo(c);
    const card = await requireCard(r, idParam(c));
    await addChecklistItem(r, card, text);
    return c.json({ card: await cardDetail(r, card) }, 201);
  })

  .post("/:id/comments", async (c) => {
    const { body } = await readBody(c, commentRequestSchema);
    const r = repo(c);
    const card = await requireCard(r, idParam(c));
    const at = new Date();
    await r.db.batch([
      r.db.insert(cardComments).values({
        id: newId(),
        ownerId: r.ownerId,
        cardId: card.id,
        body,
        createdAt: at,
        updatedAt: at,
      }),
      r.activity(card.id, "commented"),
    ]);
    return c.json({ card: await cardDetail(r, card) }, 201);
  })

  /**
   * Subida de un adjunto en streaming (F4-06). Cabeceras: `Content-Type`, `Content-Length` y
   * `X-Filename` (codificado con encodeURIComponent).
   */
  .post("/:id/attachments", async (c) => {
    const r = repo(c);
    const card = await requireCard(r, idParam(c));
    if ((await r.attachmentsOf(card.id)).length >= KANBAN_LIMITS.attachmentsPerCard) {
      throw new AppError(409, { detail: "Esta tarjeta ya tiene demasiados adjuntos" });
    }
    const length = Number(c.req.header("content-length"));
    if (!Number.isInteger(length) || length <= 0) {
      throw new AppError(411, { detail: "Falta el tamaño del fichero" });
    }
    if (length > KANBAN_LIMITS.attachmentBytes) {
      throw new AppError(413, { detail: "El fichero supera los 10 MB" });
    }
    let rawName: string;
    try {
      rawName = decodeURIComponent(c.req.header("x-filename") ?? "");
    } catch {
      throw invalidField("filename", "Nombre de fichero no válido");
    }
    const body = c.req.raw.body as ReadableStream<Uint8Array> | null;
    if (!body) throw new AppError(400, { detail: "Falta el fichero" });

    const { head, stream } = await peekStream(body);
    const contentType = sniffType(head, c.req.header("content-type") ?? "");
    if (!contentType) {
      await stream.cancel();
      throw new AppError(415, { detail: "Ese tipo de fichero no está permitido" });
    }
    const filename = sanitizeFilename(rawName);
    const id = newId();
    const key = attachmentKey(r.ownerId, card.boardId, card.id, id);
    // FixedLengthStream: R2 recibe el tamaño exacto y falla si el cuerpo no coincide.
    const fixed = new FixedLengthStream(length);
    const piping = stream.pipeTo(fixed.writable);
    try {
      await c.env.ATTACHMENTS.put(key, fixed.readable, {
        httpMetadata: { contentType, contentDisposition: contentDisposition(filename) },
      });
      await piping;
    } catch {
      await c.env.ATTACHMENTS.delete(key);
      throw new AppError(400, { detail: "El fichero no coincide con su tamaño" });
    }
    await r.db.batch([
      r.db.insert(cardAttachments).values({
        id,
        ownerId: r.ownerId,
        cardId: card.id,
        r2Key: key,
        filename,
        contentType,
        size: length,
        createdAt: new Date(),
      }),
      r.activity(card.id, "attached", { filename }),
    ]);
    return c.json({ card: await cardDetail(r, card) }, 201);
  });

// ── Checklist, comentarios y adjuntos por id ─────────────────────────────────

export const checklistRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateChecklistItemRequestSchema);
    const r = repo(c);
    const item = await r.getChecklistItem(id);
    if (!item) throw new AppError(404);
    if (body.text !== undefined || body.done !== undefined) {
      await r.db
        .update(checklistItems)
        .set(body)
        .where(and(eq(checklistItems.ownerId, r.ownerId), eq(checklistItems.id, id)));
    }
    return c.json({ card: await detailOf(c, item.cardId) });
  })

  .delete("/:id", async (c) => {
    const r = repo(c);
    const item = await r.getChecklistItem(idParam(c));
    if (!item) throw new AppError(404);
    await r.db
      .delete(checklistItems)
      .where(and(eq(checklistItems.ownerId, r.ownerId), eq(checklistItems.id, item.id)));
    return c.json({ card: await detailOf(c, item.cardId) });
  });

export const commentRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const { body } = await readBody(c, commentRequestSchema);
    const r = repo(c);
    const comment = await r.getComment(id);
    if (!comment) throw new AppError(404);
    await r.db
      .update(cardComments)
      .set({ body, updatedAt: new Date() })
      .where(and(eq(cardComments.ownerId, r.ownerId), eq(cardComments.id, id)));
    return c.json({ card: await detailOf(c, comment.cardId) });
  })

  .delete("/:id", async (c) => {
    const r = repo(c);
    const comment = await r.getComment(idParam(c));
    if (!comment) throw new AppError(404);
    await r.db
      .delete(cardComments)
      .where(and(eq(cardComments.ownerId, r.ownerId), eq(cardComments.id, comment.id)));
    return c.json({ card: await detailOf(c, comment.cardId) });
  });

export const attachmentRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  /** Descarga autenticada: solo el dueño, siempre como fichero (nunca se abre en la página). */
  .get("/:id", async (c) => {
    const r = repo(c);
    const attachment = await r.getAttachment(idParam(c));
    if (!attachment) throw new AppError(404);
    const object = await c.env.ATTACHMENTS.get(attachment.r2Key);
    if (!object) throw new AppError(404);
    return new Response(object.body, {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Length": String(object.size),
        "Content-Disposition": contentDisposition(attachment.filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })

  .delete("/:id", async (c) => {
    const r = repo(c);
    const attachment = await r.getAttachment(idParam(c));
    if (!attachment) throw new AppError(404);
    await c.env.ATTACHMENTS.delete(attachment.r2Key);
    await r.db.batch([
      r.db
        .delete(cardAttachments)
        .where(and(eq(cardAttachments.ownerId, r.ownerId), eq(cardAttachments.id, attachment.id))),
      r.activity(attachment.cardId, "detached", { filename: attachment.filename }),
    ]);
    return c.json({ card: await detailOf(c, attachment.cardId) });
  });
