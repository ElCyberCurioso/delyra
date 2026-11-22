import {
  appEnvironmentSchema,
  checklistItemRequestSchema,
  columnRequestSchema,
  commentRequestSchema,
  createBoardRequestSchema,
  createCardRequestSchema,
  idSchema,
  inviteToBoardRequestSchema,
  isAllowedOrigin,
  KANBAN_LIMITS,
  labelRequestSchema,
  moveCardRequestSchema,
  moveRequestSchema,
  newId,
  updateBoardMemberRequestSchema,
  updateBoardRequestSchema,
  updateCardRequestSchema,
  updateChecklistItemRequestSchema,
  updateColumnRequestSchema,
  updateLabelRequestSchema,
} from "@delyra/shared";
import { and, eq } from "drizzle-orm";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { createDb } from "../db/client";
import { cardAttachments, cardComments, checklistItems, labels } from "../db/schema";
import { AppError } from "../lib/errors";
import { invalidField, readBody, readQuery } from "../lib/http";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { type KanbanRepository, kanbanRepository } from "../repositories/kanban";
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
import { boardCsv, boardExport } from "../services/exports";
import { collectBackupData } from "../services/user-backups";
import { audit } from "../services/audit";
import {
  boardAccess,
  boardMembersOf,
  type BoardRef,
  inviteToBoard,
  type Need,
  removeMember,
  revokeInvitation,
  setMemberRole,
  sharedBoards,
} from "../services/board-access";
import { connectToBoard, kickFromBoard, notifyBoard } from "../services/board-live";
import type { AppEnv } from "../types";

/**
 * Kanban (F4-03 a F4-06, F4-11) y tableros compartidos (F7-04). Toda ruta sobre un tablero o algo
 * suyo pasa por `access`: sin acceso responde 404 (igual que si no existiera) y, en modo de solo
 * lectura, una petición que escribe responde 403. Las que cambian algo avisan a la sala en vivo
 * del tablero al terminar (F7-05).
 */

/** Repositorio de los tableros propios (listar, crear y la capa de tareas del calendario). */
function repo(c: Context<AppEnv>) {
  return kanbanRepository(createDb(c.env.DB), currentAuth(c).user.id);
}

async function access(c: Context<AppEnv>, ref: BoardRef, need: Need) {
  const result = await boardAccess(createDb(c.env.DB), currentAuth(c).user.id, ref, need);
  if (need !== "read") c.set("touchedBoard", result.boardId);
  return Object.assign(result.repo, { access: result });
}

/** Tras una petición que cambia un tablero, aviso a su sala en vivo (sin bloquear la respuesta). */
const live: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const boardId = c.get("touchedBoard");
  if (!boardId || c.res.status >= 400) return;
  c.executionCtx.waitUntil(notifyBoard(c.env, boardId, currentAuth(c).user.id, c.get("logger")));
};

function idParam(c: Context<AppEnv>): string {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(404);
  return id.data;
}

async function detailOf(r: KanbanRepository, cardId: string) {
  return cardDetail(r, await requireCard(r, cardId));
}

// ── Tableros ─────────────────────────────────────────────────────────────────

export const boardRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())
  .use("*", live)

  // Los propios y, después, los compartidos contigo (F7-04).
  .get("/", async (c) => {
    const own = await listBoards(repo(c));
    const shared = await sharedBoards(createDb(c.env.DB), currentAuth(c).user.id);
    return c.json({ boards: [...own, ...shared] });
  })

  .post("/", async (c) => {
    const body = await readBody(c, createBoardRequestSchema);
    const r = repo(c);
    const board = await createBoard(r, body);
    return c.json(await boardDetail(r, board), 201);
  })

  .get("/:id", async (c) => {
    const id = idParam(c);
    const r = await access(c, { board: id }, "read");
    return c.json(await boardDetail(r, await requireBoard(r, id)));
  })

  // F6-02: el tablero en JSON o CSV (hoja de cálculo).
  .get("/:id/export", async (c) => {
    const id = idParam(c);
    const r = await access(c, { board: id }, "read");
    const board = await requireBoard(r, id);
    const format = c.req.query("format") === "csv" ? "csv" : "json";
    const data = boardExport(await collectBackupData(r.db, r.ownerId), board.id);
    if (!data) throw new AppError(404);
    const base = board.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "tablero";
    const headers = {
      "Content-Disposition": contentDisposition(`${base}.${format}`),
      "Cache-Control": "private, no-store",
    };
    return format === "csv"
      ? new Response(boardCsv(data), {
          headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
        })
      : new Response(JSON.stringify(data, null, 2), {
          headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
        });
  })

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateBoardRequestSchema);
    const r = await access(c, { board: id }, "write");
    await requireBoard(r, id);
    const board = await r.updateBoard(id, body);
    if (!board) throw new AppError(404);
    return c.json(await boardDetail(r, board));
  })

  .delete("/:id", async (c) => {
    const id = idParam(c);
    const r = await access(c, { board: id }, "owner");
    const board = await requireBoard(r, id);
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
    const id = idParam(c);
    const r = await access(c, { board: id }, "write");
    const board = await requireBoard(r, id);
    await addColumn(r, board, body);
    return c.json(await boardDetail(r, board), 201);
  })

  .post("/:id/labels", async (c) => {
    const body = await readBody(c, labelRequestSchema);
    const id = idParam(c);
    const r = await access(c, { board: id }, "write");
    const board = await requireBoard(r, id);
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
    const id = idParam(c);
    const r = await access(c, { board: id }, "read");
    const board = await requireBoard(r, id);
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
  })

  // ── Compartir (F7-04) ──────────────────────────────────────────────────────

  .get("/:id/members", async (c) => {
    const id = idParam(c);
    const result = await boardAccess(
      createDb(c.env.DB),
      currentAuth(c).user.id,
      { board: id },
      "read",
    );
    return c.json(await boardMembersOf(createDb(c.env.DB), result, currentAuth(c).user.id));
  })

  .post("/:id/invitations", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, inviteToBoardRequestSchema);
    const db = createDb(c.env.DB);
    const user = currentAuth(c).user;
    const result = await boardAccess(db, user.id, { board: id }, "owner");
    await inviteToBoard(db, result, body, user.id);
    await audit(db, c.get("meta"), "board.invitation_created", {
      userId: user.id,
      metadata: { boardId: id, role: body.role },
    });
    return c.json(await boardMembersOf(db, result, user.id), 201);
  })

  .delete("/:id/invitations/:invitationId", async (c) => {
    const id = idParam(c);
    const invitationId = idSchema.safeParse(c.req.param("invitationId"));
    if (!invitationId.success) throw new AppError(404);
    const db = createDb(c.env.DB);
    await boardAccess(db, currentAuth(c).user.id, { board: id }, "owner");
    if (!(await revokeInvitation(db, id, invitationId.data))) throw new AppError(404);
    return c.body(null, 204);
  })

  .patch("/:id/members/:userId", async (c) => {
    const id = idParam(c);
    const userId = idSchema.safeParse(c.req.param("userId"));
    if (!userId.success) throw new AppError(404);
    const { role } = await readBody(c, updateBoardMemberRequestSchema);
    const db = createDb(c.env.DB);
    const result = await access(c, { board: id }, "owner");
    if (!(await setMemberRole(db, id, userId.data, role))) throw new AppError(404);
    return c.json(await boardMembersOf(db, { ...result.access }, currentAuth(c).user.id));
  })

  // El dueño quita a alguien, o un miembro se va del tablero.
  .delete("/:id/members/:userId", async (c) => {
    const id = idParam(c);
    const userId = idSchema.safeParse(c.req.param("userId"));
    if (!userId.success) throw new AppError(404);
    const db = createDb(c.env.DB);
    const me = currentAuth(c).user.id;
    await access(c, { board: id }, userId.data === me ? "read" : "owner");
    c.set("touchedBoard", id);
    if (!(await removeMember(db, id, userId.data))) throw new AppError(404);
    c.executionCtx.waitUntil(kickFromBoard(c.env, id, userId.data));
    return c.body(null, 204);
  })

  /**
   * Canal en vivo del tablero (F7-05): WebSocket hacia su Durable Object. Solo desde los orígenes
   * de la aplicación (evita el secuestro del WebSocket desde otro sitio con la cookie).
   */
  .get("/:id/live", async (c) => {
    const id = idParam(c);
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      throw new AppError(426, { detail: "Se esperaba un WebSocket" });
    }
    if (!isAllowedOrigin(appEnvironmentSchema.parse(c.env.APP_ENV), c.req.header("origin"))) {
      throw new AppError(403, { detail: "Origen no permitido" });
    }
    const user = currentAuth(c).user;
    await boardAccess(createDb(c.env.DB), user.id, { board: id }, "read");
    const upstream = await connectToBoard(c.env, id, { id: user.id, name: user.name }, c.req.raw);
    // Respuesta nueva (cabeceras modificables) para que los middlewares puedan añadir las suyas.
    return new Response(null, {
      status: upstream.status,
      webSocket: upstream.webSocket,
      headers: new Headers(upstream.headers),
    });
  });

// ── Columnas y etiquetas ─────────────────────────────────────────────────────

export const columnRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())
  .use("*", live)

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateColumnRequestSchema);
    const r = await access(c, { column: id }, "write");
    const column = await r.updateColumn(id, body);
    if (!column) throw new AppError(404);
    return c.json(await boardDetail(r, await requireBoard(r, column.boardId)));
  })

  .post("/:id/move", async (c) => {
    const id = idParam(c);
    const { index } = await readBody(c, moveRequestSchema);
    const r = await access(c, { column: id }, "write");
    await moveColumn(r, id, index);
    const column = await r.getColumn(id);
    return c.json(await boardDetail(r, await requireBoard(r, column?.boardId ?? "")));
  })

  .delete("/:id", async (c) => {
    const id = idParam(c);
    const r = await access(c, { column: id }, "write");
    const column = await r.getColumn(id);
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
    const id = idParam(c);
    const r = await access(c, { column: id }, "write");
    const card = await createCard(r, id, title);
    return c.json({ card: await cardDetail(r, card) }, 201);
  });

export const labelRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())
  .use("*", live)

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateLabelRequestSchema);
    const r = await access(c, { label: id }, "write");
    const label = await r.updateLabel(id, body);
    if (!label) throw new AppError(404);
    return c.json({ label: { id: label.id, name: label.name, color: label.color } });
  })

  .delete("/:id", async (c) => {
    const id = idParam(c);
    const r = await access(c, { label: id }, "write");
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
  .use("*", live)

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

  .get("/:id", async (c) => {
    const id = idParam(c);
    const r = await access(c, { card: id }, "read");
    return c.json({ card: await detailOf(r, id) });
  })

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateCardRequestSchema);
    const r = await access(c, { card: id }, "write");
    // Los avisos por Telegram le llegan a quien creó el tablero: solo esa persona los elige.
    if (body.reminders !== undefined && r.role !== "owner") {
      throw new AppError(403, { detail: "Solo quien creó el tablero elige los avisos" });
    }
    const card = await updateCard(r, id, body);
    return c.json({ card: await cardDetail(r, card) });
  })

  .post("/:id/move", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, moveCardRequestSchema);
    const r = await access(c, { card: id }, "write");
    const { card, wipExceeded } = await moveCard(r, id, body);
    return c.json({ card: await cardDetail(r, card), wipExceeded });
  })

  .post("/:id/archive", async (c) => {
    const id = idParam(c);
    const r = await access(c, { card: id }, "write");
    return c.json({ card: await cardDetail(r, await setArchived(r, id, true)) });
  })

  .post("/:id/restore", async (c) => {
    const id = idParam(c);
    const r = await access(c, { card: id }, "write");
    return c.json({ card: await cardDetail(r, await setArchived(r, id, false)) });
  })

  .delete("/:id", async (c) => {
    const id = idParam(c);
    const r = await access(c, { card: id }, "write");
    const card = await requireCard(r, id);
    await r.deleteRemindersOfCards([card.id]);
    await deletePrefix(c.env.ATTACHMENTS, `boards/${r.ownerId}/${card.boardId}/${card.id}/`);
    await r.deleteCard(card.id);
    return c.body(null, 204);
  })

  .post("/:id/checklist", async (c) => {
    const { text } = await readBody(c, checklistItemRequestSchema);
    const id = idParam(c);
    const r = await access(c, { card: id }, "write");
    const card = await requireCard(r, id);
    await addChecklistItem(r, card, text);
    return c.json({ card: await cardDetail(r, card) }, 201);
  })

  .post("/:id/comments", async (c) => {
    const { body } = await readBody(c, commentRequestSchema);
    const id = idParam(c);
    const r = await access(c, { card: id }, "write");
    const card = await requireCard(r, id);
    const at = new Date();
    await r.db.batch([
      r.db.insert(cardComments).values({
        id: newId(),
        ownerId: r.ownerId,
        cardId: card.id,
        body,
        authorId: r.actorId,
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
    const id = idParam(c);
    const r = await access(c, { card: id }, "write");
    const card = await requireCard(r, id);
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
    const attachmentId = newId();
    const key = attachmentKey(r.ownerId, card.boardId, card.id, attachmentId);
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
        id: attachmentId,
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
  .use("*", live)

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const body = await readBody(c, updateChecklistItemRequestSchema);
    const r = await access(c, { checklist: id }, "write");
    const item = await r.getChecklistItem(id);
    if (!item) throw new AppError(404);
    if (body.text !== undefined || body.done !== undefined) {
      await r.db
        .update(checklistItems)
        .set(body)
        .where(and(eq(checklistItems.ownerId, r.ownerId), eq(checklistItems.id, id)));
    }
    return c.json({ card: await detailOf(r, item.cardId) });
  })

  .delete("/:id", async (c) => {
    const id = idParam(c);
    const r = await access(c, { checklist: id }, "write");
    const item = await r.getChecklistItem(id);
    if (!item) throw new AppError(404);
    await r.db
      .delete(checklistItems)
      .where(and(eq(checklistItems.ownerId, r.ownerId), eq(checklistItems.id, item.id)));
    return c.json({ card: await detailOf(r, item.cardId) });
  });

export const commentRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())
  .use("*", live)

  .patch("/:id", async (c) => {
    const id = idParam(c);
    const { body } = await readBody(c, commentRequestSchema);
    const r = await access(c, { comment: id }, "write");
    const comment = await r.getComment(id);
    if (!comment) throw new AppError(404);
    // Solo quien lo escribió puede cambiarlo (F7-04).
    if (comment.authorId !== r.actorId) {
      throw new AppError(403, { detail: "Solo puedes editar tus comentarios" });
    }
    await r.db
      .update(cardComments)
      .set({ body, updatedAt: new Date() })
      .where(and(eq(cardComments.ownerId, r.ownerId), eq(cardComments.id, id)));
    return c.json({ card: await detailOf(r, comment.cardId) });
  })

  .delete("/:id", async (c) => {
    const id = idParam(c);
    const r = await access(c, { comment: id }, "write");
    const comment = await r.getComment(id);
    if (!comment) throw new AppError(404);
    // Quien lo escribió, o el dueño del tablero (para moderar).
    if (comment.authorId !== r.actorId && r.role !== "owner") {
      throw new AppError(403, { detail: "Solo puedes borrar tus comentarios" });
    }
    await r.db
      .delete(cardComments)
      .where(and(eq(cardComments.ownerId, r.ownerId), eq(cardComments.id, comment.id)));
    return c.json({ card: await detailOf(r, comment.cardId) });
  });

export const attachmentRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())
  .use("*", live)

  /** Descarga autenticada (quien tenga acceso al tablero), siempre como fichero. */
  .get("/:id", async (c) => {
    const id = idParam(c);
    const r = await access(c, { attachment: id }, "read");
    const attachment = await r.getAttachment(id);
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
    const id = idParam(c);
    const r = await access(c, { attachment: id }, "write");
    const attachment = await r.getAttachment(id);
    if (!attachment) throw new AppError(404);
    await c.env.ATTACHMENTS.delete(attachment.r2Key);
    await r.db.batch([
      r.db
        .delete(cardAttachments)
        .where(and(eq(cardAttachments.ownerId, r.ownerId), eq(cardAttachments.id, attachment.id))),
      r.activity(attachment.cardId, "detached", { filename: attachment.filename }),
    ]);
    return c.json({ card: await detailOf(r, attachment.cardId) });
  });
