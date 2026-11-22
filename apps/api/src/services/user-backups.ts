import {
  BACKUP_LIMITS,
  type BackupCounts,
  type BackupDataV1,
  type BackupFrequency,
  type BackupKind,
  type BackupSettings,
  newId,
  type UserBackupInfo,
} from "@delyra/shared";
import { and, asc, desc, eq, inArray, isNull, max, ne } from "drizzle-orm";
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
  type UserBackupRow,
  userBackups,
  users,
  userSettings,
} from "../db/schema";
import { buildBackupJson, countsOf } from "../lib/backup-format";
import { sha256Hex } from "../lib/crypto";
import { R2StreamWriter, writeZip, type ZipEntryInput } from "../lib/zip-stream";

/**
 * Copias de seguridad de un usuario (F6-02, F6-03). Una copia es un `.zip` en
 * `delyra-backups/users/<ownerId>/<backupId>.zip` con `backup.json` (formato v1) y los adjuntos.
 *
 * Qué NO entra: contraseña, segundo factor, códigos de recuperación, sesiones, tokens, el chat de
 * Telegram, las suscripciones iCal (su dirección es secreta; sus calendarios son una copia de
 * Google) ni el historial de seguridad.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const backupKey = (ownerId: string, id: string) => `users/${ownerId}/${id}.zip`;

const ms = (value: Date | null) => (value === null ? null : value.getTime());

function parseExdates(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

/** En lotes: D1 admite como mucho 100 parámetros por consulta. */
async function inChunks<T>(ids: readonly string[], query: (chunk: string[]) => Promise<T[]>) {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += 90) rows.push(...(await query(ids.slice(i, i + 90))));
  return rows;
}

/** Todos los datos del usuario en el formato v1 (los `sha256` de los adjuntos, sin rellenar). */
export async function collectBackupData(db: Database, ownerId: string): Promise<BackupDataV1> {
  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, ownerId))
    .limit(1);
  const ownCalendars = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.ownerId, ownerId), eq(calendars.readOnly, false)))
    .orderBy(asc(calendars.position), asc(calendars.createdAt));
  const calendarIds = ownCalendars.map((c) => c.id);
  const eventRows = await inChunks(calendarIds, (chunk) =>
    db
      .select()
      .from(events)
      .where(
        and(
          eq(events.ownerId, ownerId),
          isNull(events.deletedAt),
          inArray(events.calendarId, chunk),
        ),
      ),
  );
  const eventIds = new Set(eventRows.map((e) => e.id));
  const reminderRows = await db.select().from(reminders).where(eq(reminders.ownerId, ownerId));
  const boardRows = await db.select().from(boards).where(eq(boards.ownerId, ownerId));
  const columnRows = await db.select().from(boardColumns).where(eq(boardColumns.ownerId, ownerId));
  const labelRows = await db.select().from(labels).where(eq(labels.ownerId, ownerId));
  const cardRows = await db.select().from(cards).where(eq(cards.ownerId, ownerId));
  const cardIds = new Set(cardRows.map((c) => c.id));
  const cardLabelRows = await inChunks([...cardIds], (chunk) =>
    db.select().from(cardLabels).where(inArray(cardLabels.cardId, chunk)),
  );

  return {
    profile: {
      timeZone: settings?.timeZone ?? "Europe/Madrid",
      locale: settings?.locale === "en" ? "en" : "es",
      weekStart: settings?.weekStart ?? 1,
    },
    calendars: ownCalendars.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      kind: c.kind,
      visible: c.visible,
      position: c.position,
    })),
    // Primero las series: las excepciones dependen de ellas.
    events: eventRows
      .sort((a, b) => Number(a.recurringEventId !== null) - Number(b.recurringEventId !== null))
      .map((e) => ({
        id: e.id,
        calendarId: e.calendarId,
        type: e.type,
        title: e.title,
        notes: e.notes,
        location: e.location,
        url: e.url,
        startAt: e.startAt,
        endAt: e.endAt,
        tz: e.tz,
        allDay: e.allDay,
        rrule: e.rrule,
        exdates: parseExdates(e.exdates),
        recurringEventId: e.recurringEventId,
        originalStart: e.originalStart,
        birthYear: e.birthYear,
        feb29Rule: e.feb29Rule,
        icalUid: e.icalUid,
        createdAt: e.createdAt.getTime(),
        updatedAt: e.updatedAt.getTime(),
      })),
    eventReminders: reminderRows
      .filter((r) => r.targetType === "event" && eventIds.has(r.targetId))
      .map((r) => ({ eventId: r.targetId, offsetMinutes: r.offsetMinutes, channel: r.channel })),
    boards: boardRows.map((b) => ({
      id: b.id,
      name: b.name,
      template: b.template,
      autoarchiveDays: b.autoarchiveDays,
      createdAt: b.createdAt.getTime(),
      updatedAt: b.updatedAt.getTime(),
    })),
    columns: columnRows.map((c) => ({
      id: c.id,
      boardId: c.boardId,
      name: c.name,
      position: c.position,
      wipLimit: c.wipLimit,
      isDone: c.isDone,
      createdAt: c.createdAt.getTime(),
      updatedAt: c.updatedAt.getTime(),
    })),
    labels: labelRows.map((l) => ({
      id: l.id,
      boardId: l.boardId,
      name: l.name,
      color: l.color,
      createdAt: l.createdAt.getTime(),
    })),
    cards: cardRows.map((c) => ({
      id: c.id,
      boardId: c.boardId,
      columnId: c.columnId,
      title: c.title,
      description: c.description,
      position: c.position,
      priority: c.priority,
      dueAt: c.dueAt,
      dueAllDay: c.dueAllDay,
      dueTz: c.dueTz,
      completedAt: ms(c.completedAt),
      archivedAt: ms(c.archivedAt),
      createdAt: c.createdAt.getTime(),
      updatedAt: c.updatedAt.getTime(),
    })),
    cardLabels: cardLabelRows.map((l) => ({ cardId: l.cardId, labelId: l.labelId })),
    cardReminders: reminderRows
      .filter((r) => r.targetType === "card" && cardIds.has(r.targetId))
      .map((r) => ({ cardId: r.targetId, offsetMinutes: r.offsetMinutes, channel: r.channel })),
    checklist: (
      await db.select().from(checklistItems).where(eq(checklistItems.ownerId, ownerId))
    ).map((i) => ({
      id: i.id,
      cardId: i.cardId,
      text: i.text,
      done: i.done,
      position: i.position,
      createdAt: i.createdAt.getTime(),
    })),
    comments: (await db.select().from(cardComments).where(eq(cardComments.ownerId, ownerId))).map(
      (c) => ({
        id: c.id,
        cardId: c.cardId,
        body: c.body,
        createdAt: c.createdAt.getTime(),
        updatedAt: c.updatedAt.getTime(),
      }),
    ),
    activity: (await db.select().from(cardActivity).where(eq(cardActivity.ownerId, ownerId))).map(
      (a) => ({
        id: a.id,
        cardId: a.cardId,
        kind: a.kind,
        data: a.data.slice(0, 4_000),
        createdAt: a.createdAt.getTime(),
      }),
    ),
    attachments: (
      await db.select().from(cardAttachments).where(eq(cardAttachments.ownerId, ownerId))
    ).map((a) => ({
      id: a.id,
      cardId: a.cardId,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      sha256: "",
      createdAt: a.createdAt.getTime(),
      // Solo para leerlo de R2; no sale en la copia.
      r2Key: a.r2Key,
    })),
  };
}

export interface ExportEnv {
  DB: D1Database;
  BACKUPS: R2Bucket;
  ATTACHMENTS: R2Bucket;
  CF_VERSION_METADATA?: { id?: string };
}

/** Genera la copia en R2. Devuelve su tamaño y los recuentos. */
export async function writeBackup(
  db: Database,
  env: ExportEnv,
  ownerId: string,
  backupId: string,
  kind: BackupKind,
  now = new Date(),
): Promise<{ sizeBytes: number; counts: BackupCounts }> {
  const data = await collectBackupData(db, ownerId);
  const writer = new R2StreamWriter(env.BACKUPS, backupKey(ownerId, backupId), {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: { ownerId, kind, format: "delyra-backup-v1" },
  });
  const attachments = data.attachments as (BackupDataV1["attachments"][number] & {
    r2Key?: string;
  })[];
  const included: BackupDataV1["attachments"] = [];

  async function* entries(): AsyncGenerator<ZipEntryInput> {
    // Primero los adjuntos (para conocer su SHA-256) y al final `backup.json`.
    for (const attachment of attachments) {
      const object = attachment.r2Key ? await env.ATTACHMENTS.get(attachment.r2Key) : null;
      if (!object) continue;
      const bytes = new Uint8Array(await object.arrayBuffer());
      const { r2Key: _key, ...meta } = attachment;
      included.push({ ...meta, size: bytes.byteLength, sha256: await sha256Hex(bytes) });
      yield { name: `attachments/${attachment.id}`, data: bytes, level: 0 };
    }
    const final: BackupDataV1 = { ...data, attachments: included };
    const json = await buildBackupJson(final, {
      exportedAt: now,
      appVersion: env.CF_VERSION_METADATA?.id ?? null,
    });
    yield { name: "backup.json", data: new TextEncoder().encode(json), level: 6 };
  }

  try {
    await writeZip(writer, entries());
    const object = await writer.finish();
    return {
      sizeBytes: object?.size ?? writer.size,
      counts: countsOf({ ...data, attachments: included }),
    };
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

// ── Registro de copias ───────────────────────────────────────────────────────

export function backupRepository(db: Database, ownerId: string) {
  const own = (id: string) => and(eq(userBackups.id, id), eq(userBackups.ownerId, ownerId));
  return {
    ownerId,
    async create(kind: BackupKind, now = new Date()): Promise<UserBackupRow> {
      const id = newId();
      const [row] = await db
        .insert(userBackups)
        .values({
          id,
          ownerId,
          kind,
          status: "running",
          r2Key: backupKey(ownerId, id),
          createdAt: now,
        })
        .returning();
      if (!row) throw new Error("No se pudo registrar la copia");
      return row;
    },
    async get(id: string): Promise<UserBackupRow | null> {
      const [row] = await db.select().from(userBackups).where(own(id)).limit(1);
      return row ?? null;
    },
    async list(limit = 50): Promise<UserBackupRow[]> {
      return db
        .select()
        .from(userBackups)
        .where(eq(userBackups.ownerId, ownerId))
        .orderBy(desc(userBackups.createdAt))
        .limit(limit);
    },
    async running(): Promise<UserBackupRow[]> {
      return db
        .select()
        .from(userBackups)
        .where(and(eq(userBackups.ownerId, ownerId), eq(userBackups.status, "running")));
    },
    async update(
      id: string,
      patch: Partial<
        Pick<UserBackupRow, "status" | "sizeBytes" | "counts" | "error" | "finishedAt">
      >,
    ) {
      await db.update(userBackups).set(patch).where(own(id));
    },
    async remove(id: string) {
      await db.delete(userBackups).where(own(id));
    },
  };
}

export type BackupRepository = ReturnType<typeof backupRepository>;

export function backupDto(row: UserBackupRow): UserBackupInfo {
  let counts: BackupCounts | null;
  try {
    counts = row.counts ? (JSON.parse(row.counts) as BackupCounts) : null;
  } catch {
    counts = null;
  }
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    sizeBytes: row.sizeBytes,
    counts,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** Un registro «running» que lleva horas así se da por fallido (el Workflow se perdió). */
export const BACKUP_STALE_MS = 2 * HOUR_MS;

export async function refreshBackup(repo: BackupRepository, row: UserBackupRow, now: number) {
  if (row.status === "running" && row.createdAt.getTime() < now - BACKUP_STALE_MS) {
    await repo.update(row.id, {
      status: "failed",
      error: "La copia se interrumpió",
      finishedAt: new Date(now),
    });
    return { ...row, status: "failed" as const, error: "La copia se interrumpió" };
  }
  return row;
}

// ── Ajustes y retención (F6-03) ──────────────────────────────────────────────

export async function getBackupSettings(db: Database, ownerId: string): Promise<BackupSettings> {
  const [row] = await db
    .select({ frequency: userSettings.backupFrequency, keep: userSettings.backupKeep })
    .from(userSettings)
    .where(eq(userSettings.userId, ownerId))
    .limit(1);
  return {
    frequency: row?.frequency ?? "weekly",
    keep: Math.min(Math.max(row?.keep ?? 4, 1), BACKUP_LIMITS.keepAutoMax),
  };
}

export async function updateBackupSettings(
  db: Database,
  ownerId: string,
  settings: BackupSettings,
) {
  await db
    .update(userSettings)
    .set({ backupFrequency: settings.frequency, backupKeep: settings.keep, updatedAt: new Date() })
    .where(eq(userSettings.userId, ownerId));
}

/** Borra las copias que sobran de un tipo (las más antiguas), con su fichero. */
export async function pruneBackups(
  db: Database,
  bucket: R2Bucket,
  ownerId: string,
  kind: BackupKind,
  keep: number,
): Promise<number> {
  const rows = await db
    .select()
    .from(userBackups)
    .where(
      and(
        eq(userBackups.ownerId, ownerId),
        eq(userBackups.kind, kind),
        ne(userBackups.status, "running"),
      ),
    )
    .orderBy(desc(userBackups.createdAt));
  const ready = rows.filter((r) => r.status === "ready");
  const failed = rows.filter((r) => r.status === "failed");
  // Se conservan las `keep` buenas más recientes y, como mucho, los 3 últimos fallos.
  const extra = [...ready.slice(keep), ...failed.slice(3)];
  for (const row of extra) {
    await bucket.delete(row.r2Key);
    await db.delete(userBackups).where(eq(userBackups.id, row.id));
  }
  return extra.length;
}

export function keepFor(kind: BackupKind, settings: BackupSettings): number {
  if (kind === "auto") return settings.keep;
  if (kind === "manual") return BACKUP_LIMITS.keepManual;
  return BACKUP_LIMITS.keepPreRestore;
}

const INTERVAL: Record<Exclude<BackupFrequency, "off">, number> = {
  // Algo menos que el periodo, para que el cron diario no se salte un día por minutos.
  daily: 20 * HOUR_MS,
  weekly: 7 * DAY_MS - 4 * HOUR_MS,
  monthly: 30 * DAY_MS - 4 * HOUR_MS,
};

/** Usuarios activos a los que les toca copia automática (cron diario, F6-03). */
export async function dueAutoBackups(db: Database, now: number, limit = 200): Promise<string[]> {
  const rows = await db
    .select({
      userId: users.id,
      frequency: userSettings.backupFrequency,
      last: max(userBackups.createdAt),
    })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .leftJoin(userBackups, and(eq(userBackups.ownerId, users.id), eq(userBackups.kind, "auto")))
    .where(and(eq(users.status, "active"), ne(userSettings.backupFrequency, "off")))
    .groupBy(users.id, userSettings.backupFrequency);
  return rows
    .filter((row) => {
      if (row.frequency === "off") return false;
      const last = row.last instanceof Date ? row.last.getTime() : Number(row.last ?? 0);
      return now - last >= INTERVAL[row.frequency];
    })
    .slice(0, limit)
    .map((row) => row.userId);
}
