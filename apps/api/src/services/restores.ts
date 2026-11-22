import {
  BACKUP_LIMITS,
  type BackupCounts,
  type BackupDataV1,
  KANBAN_LIMITS,
  newId,
  type RestoreInfo,
  type RestoreMode,
} from "@delyra/shared";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "../db/client";
import {
  boardColumns,
  boards,
  calendars,
  cardActivity,
  cardAttachments,
  cardComments,
  cardLabels,
  cards,
  checklistItems,
  events,
  labels,
  reminders,
  type UserRestoreRow,
  userRestores,
  userSettings,
} from "../db/schema";
import { BackupError, countsOf, deterministicId, parseBackupJson } from "../lib/backup-format";
import { sha256Hex } from "../lib/crypto";
import { readZip, ZipFormatError, ZipLimitError } from "../lib/zip-stream";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import { kanbanRepository } from "../repositories/kanban";
import { attachmentKey, contentDisposition, deletePrefix } from "./attachments";
import { seriesEnd } from "../lib/recurrence";
import { saveReminders, toSeries } from "./events";
import { saveCardReminders } from "./kanban";
import { backupKey } from "./user-backups";

/**
 * Restauración de copias (F6-04). Tres fases, cada una en pasos del Workflow `BackupWorkflow`:
 *
 * 1. Validar: versión, checksum, esquema, límites, referencias internas y SHA-256 de cada adjunto.
 *    Nada de la copia se usa como id: los datos se trocean en R2 y la fila queda en `ready`.
 * 2. Restaurar: copia previa (para deshacer), vaciado (si se reemplaza) y luego calendarios,
 *    eventos y tableros por trozos. Los ids nuevos son deterministas (restauración + id de la
 *    copia) y se insertan con `ON CONFLICT DO NOTHING`: reintentar un paso no duplica nada.
 * 3. Deshacer: otra restauración, en modo reemplazar, de la copia previa.
 */

const HOUR_MS = 3_600_000;
export const RESTORE_READY_TTL_MS = 6 * 24 * HOUR_MS;
export const RESTORE_STALE_MS = 2 * HOUR_MS;
const EVENTS_PER_CHUNK = 400;
const CARDS_PER_CHUNK = 250;

export const restorePrefix = (ownerId: string, id: string) => `restores/${ownerId}/${id}/`;
export const restoreSourceKey = (ownerId: string, id: string) =>
  `${restorePrefix(ownerId, id)}source`;
const chunkKey = (row: Pick<UserRestoreRow, "ownerId" | "id">, name: string) =>
  `${restorePrefix(row.ownerId, row.id)}data/${name}.json`;
async function attachmentTempKey(row: Pick<UserRestoreRow, "ownerId" | "id">, oldId: string) {
  // El id viene del fichero: no se usa tal cual en la clave.
  return `${restorePrefix(row.ownerId, row.id)}att/${(await sha256Hex(oldId)).slice(0, 40)}`;
}

// ── Plan guardado en la fila ─────────────────────────────────────────────────

export interface RestorePlan {
  exportedAt: string;
  formatVersion: number;
  counts: BackupCounts;
  warnings: string[];
  profile: BackupDataV1["profile"];
  eventChunks: number;
  boards: { index: number; cardChunks: number }[];
  /** Destino de cada calendario de la copia (se rellena al restaurar). */
  calendarMap?: Record<string, string>;
}

export function readPlan(row: UserRestoreRow): RestorePlan | null {
  if (!row.preview) return null;
  try {
    return JSON.parse(row.preview) as RestorePlan;
  } catch {
    return null;
  }
}

export function restoreDto(row: UserRestoreRow): RestoreInfo {
  const plan = readPlan(row);
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    filename: row.filename,
    backupId: row.backupId,
    preBackupId: row.preBackupId,
    undoOf: row.undoOf,
    exportedAt: plan?.exportedAt ?? null,
    counts: plan?.counts ?? null,
    warnings: plan?.warnings ?? [],
    progress: { done: row.progressDone, total: row.progressTotal },
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function restoreRepository(db: Database, ownerId: string) {
  const own = (id: string) => and(eq(userRestores.id, id), eq(userRestores.ownerId, ownerId));
  return {
    ownerId,
    async create(
      input: Pick<UserRestoreRow, "filename" | "backupId" | "undoOf"> &
        Partial<Pick<UserRestoreRow, "mode">>,
    ): Promise<UserRestoreRow> {
      const now = new Date();
      const [row] = await db
        .insert(userRestores)
        .values({
          ...input,
          id: newId(),
          ownerId,
          status: "validating",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("No se pudo crear la restauración");
      return row;
    },
    async get(id: string): Promise<UserRestoreRow | null> {
      const [row] = await db.select().from(userRestores).where(own(id)).limit(1);
      return row ?? null;
    },
    async list(limit = 5): Promise<UserRestoreRow[]> {
      return db
        .select()
        .from(userRestores)
        .where(eq(userRestores.ownerId, ownerId))
        .orderBy(desc(userRestores.createdAt))
        .limit(limit);
    },
    async active(): Promise<UserRestoreRow[]> {
      return db
        .select()
        .from(userRestores)
        .where(
          and(
            eq(userRestores.ownerId, ownerId),
            inArray(userRestores.status, ["validating", "restoring"]),
          ),
        );
    },
    async update(
      id: string,
      patch: Partial<Omit<UserRestoreRow, "id" | "ownerId" | "createdAt">>,
    ): Promise<UserRestoreRow | null> {
      const [row] = await db
        .update(userRestores)
        .set({ ...patch, updatedAt: new Date() })
        .where(own(id))
        .returning();
      return row ?? null;
    },
    async transition(
      id: string,
      from: UserRestoreRow["status"],
      patch: Partial<Omit<UserRestoreRow, "id" | "ownerId" | "createdAt">>,
    ): Promise<UserRestoreRow | null> {
      const [row] = await db
        .update(userRestores)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(own(id), eq(userRestores.status, from)))
        .returning();
      return row ?? null;
    },
    async remove(id: string) {
      await db.delete(userRestores).where(own(id));
    },
  };
}

export type RestoreRepository = ReturnType<typeof restoreRepository>;

export async function refreshRestore(repo: RestoreRepository, row: UserRestoreRow, now: number) {
  if (row.status === "ready" && row.createdAt.getTime() < now - RESTORE_READY_TTL_MS) {
    return (await repo.transition(row.id, "ready", { status: "expired" })) ?? row;
  }
  if (
    (row.status === "validating" || row.status === "restoring") &&
    row.updatedAt.getTime() < now - RESTORE_STALE_MS
  ) {
    return (
      (await repo.transition(row.id, row.status, {
        status: "failed",
        error: "La restauración se interrumpió.",
        finishedAt: new Date(now),
      })) ?? row
    );
  }
  return row;
}

export function restoreMessage(error: unknown): string {
  if (
    error instanceof BackupError ||
    error instanceof ZipLimitError ||
    error instanceof ZipFormatError
  ) {
    return error.message;
  }
  return "No se ha podido completar. Vuelve a intentarlo más tarde.";
}

// ── 1. Validar ───────────────────────────────────────────────────────────────

interface EventChunk {
  events: BackupDataV1["events"];
  reminders: BackupDataV1["eventReminders"];
}

interface BoardMeta {
  board: BackupDataV1["boards"][number];
  columns: BackupDataV1["columns"];
  labels: BackupDataV1["labels"];
}

interface CardChunk {
  boardId: string;
  cards: BackupDataV1["cards"];
  cardLabels: BackupDataV1["cardLabels"];
  cardReminders: BackupDataV1["cardReminders"];
  checklist: BackupDataV1["checklist"];
  comments: BackupDataV1["comments"];
  activity: BackupDataV1["activity"];
  attachments: BackupDataV1["attachments"];
}

async function putJson(bucket: R2Bucket, key: string, value: unknown) {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function getJson<T>(bucket: R2Bucket, key: string): Promise<T> {
  const object = await bucket.get(key);
  if (!object) throw new BackupError("Los datos de la restauración ya no están disponibles");
  return object.json<T>();
}

/** Lee la copia (zip o json), la valida entera y la deja troceada en R2. */
export async function validateRestore(
  env: { IMPORTS: R2Bucket; BACKUPS: R2Bucket },
  repo: RestoreRepository,
  row: UserRestoreRow,
): Promise<RestorePlan> {
  const object = row.backupId
    ? await env.BACKUPS.get(backupKey(row.ownerId, row.backupId))
    : await env.IMPORTS.get(restoreSourceKey(row.ownerId, row.id));
  if (!object) throw new BackupError("La copia ya no está disponible");
  if (object.size > BACKUP_LIMITS.uploadBytes) {
    await object.body.cancel();
    throw new BackupError("La copia es demasiado grande");
  }

  const bytes = object.body as ReadableStream<Uint8Array>;
  const [probe, body] = bytes.tee();
  const firstChunk = (await probe.getReader().read()).value ?? new Uint8Array(0);
  await probe.cancel().catch(() => undefined);
  const isZip = firstChunk[0] === 0x50 && firstChunk[1] === 0x4b;

  let json: string | null = null;
  const files = new Map<string, { sha256: string; size: number }>();
  if (isZip) {
    await readZip(
      body,
      (name) =>
        name === "backup.json"
          ? BACKUP_LIMITS.jsonBytes
          : name.startsWith("attachments/")
            ? KANBAN_LIMITS.attachmentBytes
            : 0,
      BACKUP_LIMITS.uploadBytes + BACKUP_LIMITS.jsonBytes,
      async (name, data) => {
        if (name === "backup.json") {
          json = new TextDecoder().decode(data);
          return;
        }
        const oldId = name.slice("attachments/".length);
        if (!oldId || files.has(oldId) || files.size >= BACKUP_LIMITS.attachments) return;
        files.set(oldId, { sha256: await sha256Hex(data), size: data.byteLength });
        await env.IMPORTS.put(await attachmentTempKey(row, oldId), data);
      },
    );
  } else {
    if (object.size > BACKUP_LIMITS.jsonBytes) {
      await body.cancel();
      throw new BackupError("La copia es demasiado grande");
    }
    json = await new Response(body).text();
  }
  if (json === null) throw new BackupError("El zip no contiene backup.json");

  const parsed = await parseBackupJson(json);
  const data = parsed.data;
  const warnings: string[] = [];
  // Un adjunto que falta o cuyo contenido no coincide con su SHA-256 no se restaura.
  const attachments = data.attachments.filter((a) => {
    const file = files.get(a.id);
    return file?.sha256 === a.sha256 && file.size === a.size;
  });
  if (attachments.length < data.attachments.length) {
    warnings.push(
      `${String(data.attachments.length - attachments.length)} adjuntos faltan o no coinciden con la copia y no se restaurarán`,
    );
  }

  // Eventos: cada serie con sus excepciones y sus alertas, en el mismo trozo.
  const overridesOf = new Map<string, BackupDataV1["events"]>();
  for (const event of data.events) {
    if (event.recurringEventId === null) continue;
    const list = overridesOf.get(event.recurringEventId) ?? [];
    list.push(event);
    overridesOf.set(event.recurringEventId, list);
  }
  const remindersOf = new Map<string, BackupDataV1["eventReminders"]>();
  for (const reminder of data.eventReminders) {
    const list = remindersOf.get(reminder.eventId) ?? [];
    list.push(reminder);
    remindersOf.set(reminder.eventId, list);
  }
  let eventChunks = 0;
  let current: EventChunk = { events: [], reminders: [] };
  const flushEvents = async () => {
    if (current.events.length === 0) return;
    await putJson(env.IMPORTS, chunkKey(row, `events/${String(eventChunks)}`), current);
    eventChunks++;
    current = { events: [], reminders: [] };
  };
  for (const master of data.events) {
    if (master.recurringEventId !== null) continue;
    current.events.push(master, ...(overridesOf.get(master.id) ?? []));
    current.reminders.push(...(remindersOf.get(master.id) ?? []));
    if (current.events.length >= EVENTS_PER_CHUNK) await flushEvents();
  }
  await flushEvents();
  await putJson(env.IMPORTS, chunkKey(row, "calendars"), data.calendars);

  const byCard = <T extends { cardId: string }>(rows: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(r.cardId, [...(map.get(r.cardId) ?? []), r]);
    return map;
  };
  const labelsOf = byCard(data.cardLabels);
  const cardRemindersOf = byCard(data.cardReminders);
  const checklistOf = byCard(data.checklist);
  const commentsOf = byCard(data.comments);
  const activityOf = byCard(data.activity);
  const attachmentsOf = byCard(attachments);
  const boardsPlan: RestorePlan["boards"] = [];
  for (const [index, board] of data.boards.entries()) {
    const meta: BoardMeta = {
      board,
      columns: data.columns.filter((c) => c.boardId === board.id),
      labels: data.labels.filter((l) => l.boardId === board.id),
    };
    await putJson(env.IMPORTS, chunkKey(row, `boards/${String(index)}/meta`), meta);
    const boardCards = data.cards.filter((c) => c.boardId === board.id);
    let cardChunks = 0;
    for (let i = 0; i < boardCards.length; i += CARDS_PER_CHUNK) {
      const slice = boardCards.slice(i, i + CARDS_PER_CHUNK);
      const pick = <T>(map: Map<string, T[]>) => slice.flatMap((c) => map.get(c.id) ?? []);
      const chunk: CardChunk = {
        boardId: board.id,
        cards: slice,
        cardLabels: pick(labelsOf),
        cardReminders: pick(cardRemindersOf),
        checklist: pick(checklistOf),
        comments: pick(commentsOf),
        activity: pick(activityOf),
        attachments: pick(attachmentsOf),
      };
      await putJson(
        env.IMPORTS,
        chunkKey(row, `boards/${String(index)}/cards-${String(cardChunks)}`),
        chunk,
      );
      cardChunks++;
    }
    boardsPlan.push({ index, cardChunks });
  }

  const plan: RestorePlan = {
    exportedAt: parsed.exportedAt,
    formatVersion: parsed.formatVersion,
    counts: countsOf({ ...data, attachments }),
    warnings,
    profile: data.profile,
    eventChunks,
    boards: boardsPlan,
  };
  await repo.update(row.id, {
    preview: JSON.stringify(plan),
    progressDone: 0,
    progressTotal: eventChunks + 1 + boardsPlan.reduce((sum, b) => sum + 1 + b.cardChunks, 0),
  });
  return plan;
}

// ── 2. Restaurar ─────────────────────────────────────────────────────────────

async function runInBatches(db: Database, statements: BatchItem<"sqlite">[]) {
  for (let i = 0; i < statements.length; i += 50) {
    const [first, ...rest] = statements.slice(i, i + 50);
    if (first) await db.batch([first, ...rest]);
  }
}

export interface RestoreContext {
  db: Database;
  env: { IMPORTS: R2Bucket; ATTACHMENTS: R2Bucket };
  row: UserRestoreRow;
  plan: RestorePlan;
  mode: RestoreMode;
  now: number;
}

const idFor = (ctx: RestoreContext, kind: string, oldId: string) =>
  deterministicId(ctx.row.createdAt.getTime(), `${ctx.row.id}:${kind}:${oldId}`);

/** Reemplazar: borra lo que hay ahora (salvo las suscripciones iCal). */
export async function wipeUserData(
  db: Database,
  attachmentsBucket: R2Bucket,
  ownerId: string,
): Promise<void> {
  await db.delete(reminders).where(eq(reminders.ownerId, ownerId));
  await db
    .delete(calendars)
    .where(and(eq(calendars.ownerId, ownerId), eq(calendars.readOnly, false)));
  await db.delete(boards).where(eq(boards.ownerId, ownerId));
  await deletePrefix(attachmentsBucket, `boards/${ownerId}/`);
}

export async function restoreProfile(ctx: RestoreContext) {
  await ctx.db
    .update(userSettings)
    .set({
      timeZone: ctx.plan.profile.timeZone,
      locale: ctx.plan.profile.locale,
      weekStart: ctx.plan.profile.weekStart,
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userId, ctx.row.ownerId));
}

/**
 * Calendarios. Al fusionar, uno con el mismo nombre que uno propio se junta con él; si no, se
 * crea. Devuelve el destino de cada calendario de la copia.
 */
export async function restoreCalendars(ctx: RestoreContext): Promise<Record<string, string>> {
  const list = await getJson<BackupDataV1["calendars"]>(
    ctx.env.IMPORTS,
    chunkKey(ctx.row, "calendars"),
  );
  const own = await ctx.db
    .select()
    .from(calendars)
    .where(and(eq(calendars.ownerId, ctx.row.ownerId), eq(calendars.readOnly, false)));
  const byName = new Map(own.map((c) => [c.name.trim().toLocaleLowerCase("es"), c.id]));
  const map: Record<string, string> = {};
  const statements: BatchItem<"sqlite">[] = [];
  const now = new Date(ctx.now);
  for (const calendar of list) {
    const existing =
      ctx.mode === "merge" ? byName.get(calendar.name.trim().toLocaleLowerCase("es")) : undefined;
    if (existing) {
      map[calendar.id] = existing;
      continue;
    }
    const id = await idFor(ctx, "calendar", calendar.id);
    map[calendar.id] = id;
    statements.push(
      ctx.db
        .insert(calendars)
        .values({
          id,
          ownerId: ctx.row.ownerId,
          name: calendar.name,
          color: calendar.color,
          kind: calendar.kind,
          visible: calendar.visible,
          position: calendar.position,
          readOnly: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
    );
  }
  await runInBatches(ctx.db, statements);
  return map;
}

const signature = (e: {
  calendarId: string;
  type: string;
  title: string;
  startAt: number;
  endAt: number;
  rrule: string | null;
  allDay: boolean;
}) => [e.calendarId, e.type, e.title, e.startAt, e.endAt, e.rrule ?? "", e.allDay].join("|");

export async function restoreEventChunk(ctx: RestoreContext, index: number) {
  const chunk = await getJson<EventChunk>(
    ctx.env.IMPORTS,
    chunkKey(ctx.row, `events/${String(index)}`),
  );
  const calendarMap = ctx.plan.calendarMap ?? {};
  const ownerId = ctx.row.ownerId;
  const idMap = new Map<string, string>();
  const deduped = new Set<string>();

  // Al fusionar, un evento idéntico ya existente no se duplica.
  if (ctx.mode === "merge") {
    const masters = chunk.events.filter((e) => e.recurringEventId === null);
    const starts = [...new Set(masters.map((e) => e.startAt))];
    const existing = new Map<string, string>();
    for (let i = 0; i < starts.length; i += 80) {
      const rows = await ctx.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.ownerId, ownerId),
            isNull(events.deletedAt),
            isNull(events.recurringEventId),
            inArray(events.startAt, starts.slice(i, i + 80)),
          ),
        );
      for (const r of rows) existing.set(signature(r), r.id);
    }
    for (const master of masters) {
      const found = existing.get(
        signature({ ...master, calendarId: calendarMap[master.calendarId] ?? "" }),
      );
      if (found) {
        idMap.set(master.id, found);
        deduped.add(master.id);
      }
    }
  }
  for (const event of chunk.events) {
    if (!idMap.has(event.id)) idMap.set(event.id, await idFor(ctx, "event", event.id));
  }

  const statements: BatchItem<"sqlite">[] = [];
  for (const event of chunk.events) {
    if (deduped.has(event.id)) continue;
    const calendarId = calendarMap[event.calendarId];
    if (!calendarId) continue;
    const id = idMap.get(event.id) ?? "";
    statements.push(
      ctx.db
        .insert(events)
        .values({
          id,
          ownerId,
          calendarId,
          type: event.type,
          title: event.title,
          notes: event.notes,
          location: event.location,
          url: event.url,
          startAt: event.startAt,
          endAt: event.endAt,
          tz: event.tz,
          allDay: event.allDay,
          rrule: event.rrule,
          exdates: JSON.stringify(event.exdates),
          seriesEndAt: null,
          recurringEventId:
            event.recurringEventId === null ? null : (idMap.get(event.recurringEventId) ?? null),
          originalStart: event.originalStart,
          birthYear: event.birthYear,
          feb29Rule: event.feb29Rule,
          icalUid: event.recurringEventId === null ? event.icalUid : null,
          createdAt: new Date(event.createdAt),
          updatedAt: new Date(event.updatedAt),
        })
        .onConflictDoNothing(),
    );
  }
  await runInBatches(ctx.db, statements);

  // Fin de serie y alertas, con el mismo cálculo que al crear un evento (F2-07).
  const repo = eventRepository(ctx.db, ownerId);
  const context = { events: repo, calendars: calendarRepository(ctx.db, ownerId), now: ctx.now };
  const remindersOf = new Map<string, { offsetMinutes: number; channel: "telegram" | "email" }[]>();
  for (const r of chunk.reminders) {
    remindersOf.set(r.eventId, [
      ...(remindersOf.get(r.eventId) ?? []),
      { offsetMinutes: r.offsetMinutes, channel: r.channel },
    ]);
  }
  for (const event of chunk.events) {
    if (event.recurringEventId !== null || deduped.has(event.id)) continue;
    const row = await repo.get(idMap.get(event.id) ?? "");
    if (!row) continue;
    const end = row.rrule || row.type === "birthday" ? seriesEnd(toSeries(row)) : row.endAt;
    const updated =
      end !== row.seriesEndAt ? ((await repo.update(row.id, { seriesEndAt: end })) ?? row) : row;
    const inputs = remindersOf.get(event.id);
    if (inputs && inputs.length > 0) await saveReminders(context, updated, inputs);
  }
}

export async function restoreBoardMeta(ctx: RestoreContext, index: number) {
  const meta = await getJson<BoardMeta>(
    ctx.env.IMPORTS,
    chunkKey(ctx.row, `boards/${String(index)}/meta`),
  );
  const ownerId = ctx.row.ownerId;
  const boardId = await idFor(ctx, "board", meta.board.id);
  let name = meta.board.name;
  if (ctx.mode === "merge") {
    const taken = new Set(
      (
        await ctx.db
          .select({ name: boards.name })
          .from(boards)
          .where(and(eq(boards.ownerId, ownerId), ne(boards.id, boardId)))
      ).map((b) => b.name),
    );
    if (taken.has(name)) name = `${name.slice(0, 66)} (restaurado)`;
  }
  const statements: BatchItem<"sqlite">[] = [
    ctx.db
      .insert(boards)
      .values({
        id: boardId,
        ownerId,
        name,
        template: meta.board.template,
        autoarchiveDays: meta.board.autoarchiveDays,
        createdAt: new Date(meta.board.createdAt),
        updatedAt: new Date(meta.board.updatedAt),
      })
      .onConflictDoNothing(),
  ];
  for (const column of meta.columns) {
    statements.push(
      ctx.db
        .insert(boardColumns)
        .values({
          id: await idFor(ctx, "column", column.id),
          ownerId,
          boardId,
          name: column.name,
          position: column.position,
          wipLimit: column.wipLimit,
          isDone: column.isDone,
          createdAt: new Date(column.createdAt),
          updatedAt: new Date(column.updatedAt),
        })
        .onConflictDoNothing(),
    );
  }
  for (const label of meta.labels) {
    statements.push(
      ctx.db
        .insert(labels)
        .values({
          id: await idFor(ctx, "label", label.id),
          ownerId,
          boardId,
          name: label.name,
          color: label.color,
          createdAt: new Date(label.createdAt),
        })
        .onConflictDoNothing(),
    );
  }
  await runInBatches(ctx.db, statements);
}

export async function restoreCardChunk(ctx: RestoreContext, boardIndex: number, index: number) {
  const chunk = await getJson<CardChunk>(
    ctx.env.IMPORTS,
    chunkKey(ctx.row, `boards/${String(boardIndex)}/cards-${String(index)}`),
  );
  const ownerId = ctx.row.ownerId;
  const boardId = await idFor(ctx, "board", chunk.boardId);
  const cardIds = new Map<string, string>();
  for (const card of chunk.cards) cardIds.set(card.id, await idFor(ctx, "card", card.id));
  const card = (oldId: string) => cardIds.get(oldId) ?? "";
  const date = (value: number | null) => (value === null ? null : new Date(value));

  const statements: BatchItem<"sqlite">[] = [];
  for (const c of chunk.cards) {
    statements.push(
      ctx.db
        .insert(cards)
        .values({
          id: card(c.id),
          ownerId,
          boardId,
          columnId: await idFor(ctx, "column", c.columnId),
          title: c.title,
          description: c.description,
          position: c.position,
          priority: c.priority,
          dueAt: c.dueAt,
          dueAllDay: c.dueAllDay,
          dueTz: c.dueTz,
          completedAt: date(c.completedAt),
          archivedAt: date(c.archivedAt),
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
        })
        .onConflictDoNothing(),
    );
  }
  for (const link of chunk.cardLabels) {
    statements.push(
      ctx.db
        .insert(cardLabels)
        .values({ cardId: card(link.cardId), labelId: await idFor(ctx, "label", link.labelId) })
        .onConflictDoNothing(),
    );
  }
  for (const item of chunk.checklist) {
    statements.push(
      ctx.db
        .insert(checklistItems)
        .values({
          id: await idFor(ctx, "checklist", item.id),
          ownerId,
          cardId: card(item.cardId),
          text: item.text,
          done: item.done,
          position: item.position,
          createdAt: new Date(item.createdAt),
        })
        .onConflictDoNothing(),
    );
  }
  for (const comment of chunk.comments) {
    statements.push(
      ctx.db
        .insert(cardComments)
        .values({
          id: await idFor(ctx, "comment", comment.id),
          ownerId,
          cardId: card(comment.cardId),
          body: comment.body,
          createdAt: new Date(comment.createdAt),
          updatedAt: new Date(comment.updatedAt),
        })
        .onConflictDoNothing(),
    );
  }
  for (const entry of chunk.activity) {
    statements.push(
      ctx.db
        .insert(cardActivity)
        .values({
          id: await idFor(ctx, "activity", entry.id),
          ownerId,
          cardId: card(entry.cardId),
          kind: entry.kind,
          data: entry.data,
          createdAt: new Date(entry.createdAt),
        })
        .onConflictDoNothing(),
    );
  }
  for (const attachment of chunk.attachments) {
    const id = await idFor(ctx, "attachment", attachment.id);
    const r2Key = attachmentKey(ownerId, boardId, card(attachment.cardId), id);
    const source = await ctx.env.IMPORTS.get(await attachmentTempKey(ctx.row, attachment.id));
    if (!source) continue;
    await ctx.env.ATTACHMENTS.put(r2Key, await source.arrayBuffer(), {
      httpMetadata: {
        contentType: attachment.contentType,
        contentDisposition: contentDisposition(attachment.filename),
      },
    });
    statements.push(
      ctx.db
        .insert(cardAttachments)
        .values({
          id,
          ownerId,
          cardId: card(attachment.cardId),
          r2Key,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          createdAt: new Date(attachment.createdAt),
        })
        .onConflictDoNothing(),
    );
  }
  await runInBatches(ctx.db, statements);

  // Alertas de fechas límite (F4-07).
  const repo = kanbanRepository(ctx.db, ownerId);
  const inputs = new Map<string, { offsetMinutes: number; channel: "telegram" | "email" }[]>();
  for (const r of chunk.cardReminders) {
    inputs.set(r.cardId, [
      ...(inputs.get(r.cardId) ?? []),
      { offsetMinutes: r.offsetMinutes, channel: r.channel },
    ]);
  }
  for (const [oldId, list] of inputs) {
    const [row] = await ctx.db
      .select()
      .from(cards)
      .where(and(eq(cards.ownerId, ownerId), eq(cards.id, card(oldId))))
      .limit(1);
    if (row) await saveCardReminders(repo, row, list, ctx.now);
  }
}

export async function deleteRestoreData(bucket: R2Bucket, ownerId: string, id: string) {
  await deletePrefix(bucket, restorePrefix(ownerId, id));
}
