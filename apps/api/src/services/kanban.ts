import {
  type BoardDetail,
  type BoardSummary,
  type BoardTemplate,
  type Locale,
  type CardDetail,
  type CardSummary,
  dateOnlyToUtc,
  KANBAN_LIMITS,
  newId,
  type ReminderInput,
  utcToDateOnly,
} from "@delyra/shared";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  type Board,
  boardColumns,
  boards,
  cardLabels,
  type CardRow,
  cards,
  checklistItems,
  labels,
  reminders,
} from "../db/schema";
import { AppError } from "../lib/errors";
import { invalidField } from "../lib/http";
import { evenKeys, keyAt, placeAt } from "../lib/positions";
import type { Series } from "../lib/recurrence";
import type { KanbanRepository } from "../repositories/kanban";
import { nextFire } from "./reminder-schedule";

/** Tableros, columnas y tarjetas (F4-03 a F4-05, F4-07). */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** `db.batch` con una lista construida en tiempo de ejecución (D1 lo ejecuta en transacción). */
async function runBatch(repo: KanbanRepository, statements: BatchItem<"sqlite">[]) {
  const [first, ...rest] = statements;
  if (first) await repo.db.batch([first, ...rest]);
}

// ── Plantillas (F4-03) ───────────────────────────────────────────────────────

/** Columnas y etiquetas de las plantillas en inglés (F7-06): se crean en el idioma de la petición. */
const TEMPLATE_NAMES_EN: Readonly<Record<string, string>> = {
  "Por hacer": "To do",
  Haciendo: "Doing",
  Hecho: "Done",
  Casa: "Home",
  Recados: "Errands",
  Importante: "Important",
  Backlog: "Backlog",
  "En curso": "In progress",
  "En revisión": "In review",
  Bug: "Bug",
  Mejora: "Improvement",
  "Deuda técnica": "Tech debt",
  Pendiente: "Pending",
  "En análisis": "Analysing",
  Hallazgos: "Findings",
  Informe: "Report",
  Cerrado: "Closed",
  Crítica: "Critical",
  Alta: "High",
  Media: "Medium",
  Baja: "Low",
  Informativa: "Informational",
};

interface TemplateColumn {
  name: string;
  wipLimit?: number;
  isDone?: boolean;
}

const TEMPLATES: Record<BoardTemplate, { columns: TemplateColumn[]; labels: [string, string][] }> =
  {
    personal: {
      columns: [
        { name: "Por hacer" },
        { name: "Haciendo", wipLimit: 3 },
        { name: "Hecho", isDone: true },
      ],
      labels: [
        ["Casa", "#27ae60"],
        ["Recados", "#2f80ed"],
        ["Importante", "#eb5757"],
      ],
    },
    sprint: {
      columns: [
        { name: "Backlog" },
        { name: "Por hacer" },
        { name: "En curso", wipLimit: 3 },
        { name: "En revisión", wipLimit: 2 },
        { name: "Hecho", isDone: true },
      ],
      labels: [
        ["Bug", "#eb5757"],
        ["Mejora", "#2f80ed"],
        ["Deuda técnica", "#8d6e63"],
      ],
    },
    audit: {
      columns: [
        { name: "Pendiente" },
        { name: "En análisis", wipLimit: 5 },
        { name: "Hallazgos" },
        { name: "Informe" },
        { name: "Cerrado", isDone: true },
      ],
      labels: [
        ["Crítica", "#eb5757"],
        ["Alta", "#f2994a"],
        ["Media", "#f2c94c"],
        ["Baja", "#27ae60"],
        ["Informativa", "#2f80ed"],
      ],
    },
    empty: { columns: [], labels: [] },
  };

// ── Conversión ───────────────────────────────────────────────────────────────

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function dueOf(card: CardRow) {
  if (card.dueAt === null) return null;
  return {
    allDay: card.dueAllDay,
    at: card.dueAllDay ? utcToDateOnly(card.dueAt) : new Date(card.dueAt).toISOString(),
    tz: card.dueTz ?? "Europe/Madrid",
  };
}

function summary(
  card: CardRow,
  extra: {
    labelIds: string[];
    checklist: { done: number; total: number };
    comments: number;
    attachments: number;
  },
): CardSummary {
  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    position: card.position,
    priority: card.priority,
    kind: card.kind,
    assignee: card.assignee,
    color: card.color,
    due: dueOf(card),
    completedAt: iso(card.completedAt),
    archivedAt: iso(card.archivedAt),
    hasDescription: card.description.trim() !== "",
    ...extra,
  };
}

export function boardSummary(
  board: Board,
  openCards: number,
  sharing: Pick<BoardSummary, "role" | "ownerName" | "members"> = {
    role: "owner",
    ownerName: null,
    members: 0,
  },
): BoardSummary {
  return {
    id: board.id,
    name: board.name,
    template: board.template,
    autoarchiveDays: board.autoarchiveDays,
    openCards,
    createdAt: board.createdAt.toISOString(),
    ...sharing,
  };
}

// ── Tableros y columnas ──────────────────────────────────────────────────────

/** Los tableros propios (los compartidos contigo los añade `services/board-access.ts`). */
export async function listBoards(repo: KanbanRepository): Promise<BoardSummary[]> {
  const [rows, members] = await Promise.all([repo.listBoards(), repo.memberCounts()]);
  return rows.map((r) =>
    boardSummary(r.board, Number(r.openCards), {
      role: "owner",
      ownerName: null,
      members: members.get(r.board.id) ?? 0,
    }),
  );
}

export async function createBoard(
  repo: KanbanRepository,
  input: { name: string; template: BoardTemplate },
  locale: Locale = "es",
): Promise<Board> {
  const named = (name: string) => (locale === "en" ? (TEMPLATE_NAMES_EN[name] ?? name) : name);
  if ((await repo.countBoards()) >= 100) {
    throw new AppError(409, { detail: "Has llegado al máximo de 100 tableros" });
  }
  const template = TEMPLATES[input.template];
  const board = repo.insertBoard({
    name: input.name,
    template: input.template,
    autoarchiveDays: 14,
  });
  const keys = evenKeys(template.columns.length);
  const { db } = repo;
  await runBatch(repo, [
    db.insert(boards).values(board),
    ...template.columns.map((column, i) =>
      db.insert(boardColumns).values(
        repo.newColumn({
          boardId: board.id,
          name: named(column.name),
          position: keys[i] ?? "a0",
          wipLimit: column.wipLimit ?? null,
          isDone: column.isDone ?? false,
        }),
      ),
    ),
    ...template.labels.map(([name, color]) =>
      db.insert(labels).values({
        id: newId(),
        ownerId: repo.ownerId,
        boardId: board.id,
        name: named(name),
        color,
        createdAt: new Date(),
      }),
    ),
  ]);
  return requireBoard(repo, board.id);
}

export async function requireBoard(repo: KanbanRepository, id: string): Promise<Board> {
  const board = await repo.getBoard(id);
  if (!board) throw new AppError(404);
  return board;
}

export async function boardDetail(repo: KanbanRepository, board: Board): Promise<BoardDetail> {
  const [columns, cardRows, labelRows, labelIds, checklist, counts, members, owner] =
    await Promise.all([
      repo.columnsOf(board.id),
      repo.cardsOfBoard(board.id, false),
      repo.labelsOf(board.id),
      repo.labelIdsOfBoard(board.id),
      repo.checklistStats(board.id),
      repo.countsOfBoard(board.id),
      repo.memberCount(board.id),
      repo.role === "owner" ? Promise.resolve(null) : repo.namesOf([board.ownerId]),
    ]);
  const open = cardRows.filter((c) => c.completedAt === null).length;
  return {
    board: boardSummary(board, open, {
      role: repo.role,
      ownerName: owner?.get(board.ownerId) ?? null,
      members,
    }),
    columns: columns.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      wipLimit: c.wipLimit,
      isDone: c.isDone,
      delegated: c.delegated,
    })),
    cards: cardRows.map((card) =>
      summary(card, {
        labelIds: labelIds.get(card.id) ?? [],
        checklist: checklist.get(card.id) ?? { done: 0, total: 0 },
        comments: counts.comments.get(card.id) ?? 0,
        attachments: counts.attachments.get(card.id) ?? 0,
      }),
    ),
    labels: labelRows.map((l) => ({ id: l.id, name: l.name, color: l.color })),
  };
}

export async function addColumn(
  repo: KanbanRepository,
  board: Board,
  input: { name: string; wipLimit: number | null; isDone: boolean; delegated: boolean },
) {
  const columns = await repo.columnsOf(board.id);
  if (columns.length >= KANBAN_LIMITS.columnsPerBoard) {
    throw new AppError(409, {
      detail: `Como máximo ${String(KANBAN_LIMITS.columnsPerBoard)} columnas`,
    });
  }
  const column = repo.newColumn({
    boardId: board.id,
    ...input,
    position: keyAt(
      columns.map((c) => c.position),
      columns.length,
    ),
  });
  await repo.db.insert(boardColumns).values(column);
  return column;
}

export async function moveColumn(repo: KanbanRepository, columnId: string, index: number) {
  const column = await repo.getColumn(columnId);
  if (!column) throw new AppError(404);
  const columns = await repo.columnsOf(column.boardId);
  const changes = placeAt(columns, column.id, index);
  await runBatch(
    repo,
    [...changes].map(([id, position]) =>
      repo.db
        .update(boardColumns)
        .set({ position })
        .where(and(eq(boardColumns.ownerId, repo.ownerId), eq(boardColumns.id, id))),
    ),
  );
}

// ── Tarjetas (F4-04) ─────────────────────────────────────────────────────────

export async function requireCard(repo: KanbanRepository, id: string): Promise<CardRow> {
  const card = await repo.getCard(id);
  if (!card) throw new AppError(404);
  return card;
}

export async function createCard(
  repo: KanbanRepository,
  columnId: string,
  title: string,
  kind: CardRow["kind"] = "task",
) {
  const column = await repo.getColumn(columnId);
  if (!column) throw new AppError(404);
  if ((await repo.countCards(column.boardId)) >= KANBAN_LIMITS.cardsPerBoard) {
    throw new AppError(409, {
      detail: `Como máximo ${String(KANBAN_LIMITS.cardsPerBoard)} tarjetas por tablero`,
    });
  }
  const siblings = await repo.cardsInColumn(column.id);
  const card = repo.newCard({
    boardId: column.boardId,
    columnId: column.id,
    title,
    kind,
    position: keyAt(
      siblings.map((c) => c.position),
      siblings.length,
    ),
    completedAt: column.isDone ? new Date() : null,
  });
  await runBatch(repo, [
    repo.db.insert(cards).values(card),
    repo.activity(card.id, "created", { column: column.name }),
  ]);
  return requireCard(repo, card.id);
}

/**
 * Mueve una tarjeta (misma columna u otra del mismo tablero) en un único `batch`. Al entrar en
 * una columna de terminado se marca `completed_at`; al salir, se quita. Superar el límite WIP
 * se permite, pero se avisa.
 */
export async function moveCard(
  repo: KanbanRepository,
  cardId: string,
  target: { columnId: string; index: number; assignee?: string | null },
  now = Date.now(),
) {
  const card = await requireCard(repo, cardId);
  const [from, to] = await Promise.all([
    repo.getColumn(card.columnId),
    repo.getColumn(target.columnId),
  ]);
  if (to?.boardId !== card.boardId) throw invalidField("columnId", "Columna no válida");

  const siblings = await repo.cardsInColumn(to.id);
  const changes = placeAt(siblings, card.id, target.index);
  const completedAt = to.isDone ? (card.completedAt ?? new Date(now)) : null;
  const { db } = repo;
  const mineCard = (id: string) => and(eq(cards.ownerId, repo.ownerId), eq(cards.id, id));
  await runBatch(repo, [
    db
      .update(cards)
      .set({
        columnId: to.id,
        position: changes.get(card.id) ?? card.position,
        completedAt,
        // Al pasarla a una columna delegada, a quién se le ha pasado.
        ...(target.assignee !== undefined ? { assignee: target.assignee } : {}),
        updatedAt: new Date(now),
      })
      .where(mineCard(card.id)),
    ...[...changes]
      .filter(([id]) => id !== card.id)
      .map(([id, position]) => db.update(cards).set({ position }).where(mineCard(id))),
    ...(from?.id !== to.id
      ? [repo.activity(card.id, "moved", { from: from?.name ?? null, to: to.name })]
      : []),
    ...(target.assignee !== undefined && target.assignee !== card.assignee
      ? [repo.activity(card.id, "assigned", { to: target.assignee })]
      : []),
    ...(to.isDone && !card.completedAt ? [repo.activity(card.id, "completed")] : []),
    ...(!to.isDone && card.completedAt ? [repo.activity(card.id, "reopened")] : []),
  ]);
  const count = siblings.filter((c) => c.id !== card.id).length + 1;
  const updated = await requireCard(repo, card.id);
  if (to.isDone !== Boolean(card.completedAt))
    await saveCardReminders(repo, updated, undefined, now);
  return { card: updated, wipExceeded: to.wipLimit !== null && count > to.wipLimit };
}

export interface CardPatch {
  title?: string;
  description?: string;
  priority?: CardRow["priority"];
  color?: string | null;
  kind?: CardRow["kind"];
  assignee?: string | null;
  due?: { allDay: boolean; at: string; tz: string } | null;
  labelIds?: string[];
  reminders?: ReminderInput[];
}

export async function updateCard(repo: KanbanRepository, cardId: string, patch: CardPatch) {
  const card = await requireCard(repo, cardId);
  const set: Partial<CardRow> = {};
  const changes: [string, Record<string, unknown>][] = [];

  if (patch.title !== undefined && patch.title !== card.title) {
    set.title = patch.title;
    changes.push(["renamed", { from: card.title, to: patch.title }]);
  }
  if (patch.description !== undefined && patch.description !== card.description) {
    set.description = patch.description;
    changes.push(["described", {}]);
  }
  if (patch.priority !== undefined && patch.priority !== card.priority) {
    set.priority = patch.priority;
    changes.push(["priority", { to: patch.priority }]);
  }
  if (patch.color !== undefined && patch.color?.toLowerCase() !== card.color) {
    set.color = patch.color?.toLowerCase() ?? null;
  }
  if (patch.kind !== undefined && patch.kind !== card.kind) {
    set.kind = patch.kind;
    changes.push(["kind", { to: patch.kind }]);
  }
  if (patch.assignee !== undefined && patch.assignee !== card.assignee) {
    set.assignee = patch.assignee;
    changes.push(["assigned", { to: patch.assignee }]);
  }
  let dueChanged = false;
  if (patch.due !== undefined) {
    const dueAt = patch.due
      ? patch.due.allDay
        ? dateOnlyToUtc(patch.due.at)
        : Date.parse(patch.due.at)
      : null;
    if (dueAt !== card.dueAt || (patch.due?.allDay ?? false) !== card.dueAllDay) {
      set.dueAt = dueAt;
      set.dueAllDay = patch.due?.allDay ?? false;
      set.dueTz = patch.due?.tz ?? null;
      dueChanged = true;
      changes.push(["due", { to: patch.due ? patch.due.at : null }]);
    }
  }

  const { db } = repo;
  const statements: BatchItem<"sqlite">[] = [
    ...(Object.keys(set).length > 0
      ? [
          db
            .update(cards)
            .set({ ...set, updatedAt: new Date() })
            .where(and(eq(cards.ownerId, repo.ownerId), eq(cards.id, card.id))),
        ]
      : []),
    ...changes.map(([kind, data]) => repo.activity(card.id, kind, data)),
  ];

  if (patch.labelIds !== undefined) {
    // Solo etiquetas de este mismo tablero (y, por tanto, del usuario).
    const allowed = new Set((await repo.labelsOf(card.boardId)).map((l) => l.id));
    const ids = [...new Set(patch.labelIds)];
    if (!ids.every((id) => allowed.has(id))) throw invalidField("labelIds", "Etiqueta no válida");
    statements.push(
      db.delete(cardLabels).where(eq(cardLabels.cardId, card.id)),
      ...ids.map((labelId) => db.insert(cardLabels).values({ cardId: card.id, labelId })),
    );
  }
  await runBatch(repo, statements);

  const updated = await requireCard(repo, card.id);
  if (patch.reminders !== undefined || dueChanged) {
    const existing = await repo.remindersOfCard(card.id);
    // Al poner fecha por primera vez sin indicar alertas, una por defecto.
    const defaults: ReminderInput[] = updated.dueAllDay
      ? [{ offsetMinutes: -540, channel: "telegram" }]
      : [{ offsetMinutes: 60, channel: "telegram" }];
    const inputs =
      patch.reminders ??
      (existing.length > 0
        ? existing.map((r) => ({ offsetMinutes: r.offsetMinutes, channel: r.channel }))
        : updated.dueAt !== null && card.dueAt === null
          ? defaults
          : []);
    await saveCardReminders(repo, updated, inputs);
  }
  return updated;
}

export async function setArchived(repo: KanbanRepository, cardId: string, archived: boolean) {
  const card = await requireCard(repo, cardId);
  let columnId = card.columnId;
  let position = card.position;
  if (!archived) {
    // Al restaurar vuelve al final de su columna.
    const siblings = await repo.cardsInColumn(card.columnId);
    position = keyAt(
      siblings.map((c) => c.position),
      siblings.length,
    );
    columnId = card.columnId;
  }
  await runBatch(repo, [
    repo.db
      .update(cards)
      .set({ archivedAt: archived ? new Date() : null, columnId, position, updatedAt: new Date() })
      .where(and(eq(cards.ownerId, repo.ownerId), eq(cards.id, card.id))),
    repo.activity(card.id, archived ? "archived" : "restored"),
  ]);
  const updated = await requireCard(repo, card.id);
  await saveCardReminders(repo, updated);
  return updated;
}

// ── Detalle de tarjeta ───────────────────────────────────────────────────────

export async function cardDetail(repo: KanbanRepository, card: CardRow): Promise<CardDetail> {
  const [labelIds, checklist, comments, attachments, activity, cardReminders] = await Promise.all([
    repo.labelIdsOfBoard(card.boardId),
    repo.checklistOf(card.id),
    repo.commentsOf(card.id),
    repo.attachmentsOf(card.id),
    repo.activityOf(card.id),
    repo.remindersOfCard(card.id),
  ]);
  const names = await repo.namesOf(
    [...comments.map((c) => c.authorId), ...activity.map((a) => a.actorId)].filter(
      (id): id is string => id !== null,
    ),
  );
  const parse = (data: string) => {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  return {
    ...summary(card, {
      labelIds: labelIds.get(card.id) ?? [],
      checklist: {
        done: checklist.filter((i) => i.done).length,
        total: checklist.length,
      },
      comments: comments.length,
      attachments: attachments.length,
    }),
    boardId: card.boardId,
    description: card.description,
    checklistItems: checklist.map((i) => ({ id: i.id, text: i.text, done: i.done })),
    commentList: comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      // Sin autor: cuenta borrada, u otra persona en una copia restaurada (migración 0010).
      authorName: c.authorId ? (names.get(c.authorId) ?? null) : null,
      mine: c.authorId !== null && c.authorId === repo.actorId,
    })),
    attachmentList: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      createdAt: a.createdAt.toISOString(),
    })),
    activity: activity.map((a) => ({
      id: a.id,
      kind: a.kind,
      data: parse(a.data),
      createdAt: a.createdAt.toISOString(),
      actorName: a.actorId ? (names.get(a.actorId) ?? null) : null,
    })),
    reminders: cardReminders.map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      nextFireAt: r.nextFireAt === null ? null : new Date(r.nextFireAt).toISOString(),
    })),
  };
}

// ── Checklist ────────────────────────────────────────────────────────────────

export async function addChecklistItem(repo: KanbanRepository, card: CardRow, text: string) {
  const items = await repo.checklistOf(card.id);
  if (items.length >= KANBAN_LIMITS.checklistPerCard) {
    throw new AppError(409, { detail: "La checklist está llena" });
  }
  await repo.db.insert(checklistItems).values({
    id: newId(),
    ownerId: repo.ownerId,
    cardId: card.id,
    text,
    position: keyAt(
      items.map((i) => i.position),
      items.length,
    ),
    createdAt: new Date(),
  });
}

// ── Alertas de tarjetas (F4-07) ──────────────────────────────────────────────

/** Una fecha límite es una «serie» de una sola ocurrencia para el cálculo común de alertas. */
export function cardSeries(card: CardRow): Series | null {
  if (card.dueAt === null) return null;
  return {
    startAt: card.dueAt,
    endAt: card.dueAt + (card.dueAllDay ? DAY_MS : HOUR_MS),
    tz: card.dueTz ?? "Europe/Madrid",
    allDay: card.dueAllDay,
    type: "event",
    rrule: null,
    exdates: [],
  };
}

/** Recalcula (o sustituye) las alertas de una tarjeta. Terminada o archivada: sin alertas. */
export async function saveCardReminders(
  repo: KanbanRepository,
  card: CardRow,
  inputs?: readonly ReminderInput[],
  now = Date.now(),
) {
  const series = cardSeries(card);
  const active = series !== null && card.completedAt === null && card.archivedAt === null;
  const fire = (offset: number) => (active && series ? nextFire(series, [], offset, now) : null);
  const { db } = repo;
  const rows =
    inputs ??
    (await repo.remindersOfCard(card.id)).map((r) => ({
      offsetMinutes: r.offsetMinutes,
      channel: r.channel,
    }));
  const unique = new Map(rows.map((r) => [`${String(r.offsetMinutes)}:${r.channel}`, r]));
  await runBatch(repo, [
    db
      .delete(reminders)
      .where(
        and(
          eq(reminders.ownerId, repo.ownerId),
          eq(reminders.targetType, "card"),
          eq(reminders.targetId, card.id),
        ),
      ),
    ...(card.dueAt === null
      ? []
      : [...unique.values()].map((r) => {
          const next = fire(r.offsetMinutes);
          return db.insert(reminders).values({
            id: newId(),
            ownerId: repo.ownerId,
            targetType: "card",
            targetId: card.id,
            offsetMinutes: r.offsetMinutes,
            channel: r.channel,
            nextFireAt: next?.fireAt ?? null,
            nextOccurrenceStart: next?.occurrenceStart ?? null,
            status: next ? "scheduled" : "done",
            createdAt: new Date(),
          });
        })),
  ]);
}
