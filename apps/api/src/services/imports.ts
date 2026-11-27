import {
  type ImportCalendarPreview,
  type ImportInfo,
  type ImportReport,
  importReportSchema,
  type StartImportRequest,
  startImportRequestSchema,
} from "@delyra/shared";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { Database } from "../db/client";
import { type ImportRow, imports, userSettings } from "../db/schema";
import { parseIcs } from "../lib/ics";
import {
  IMPORT_LIMITS,
  type ImportedEvent,
  ImportFormatError,
  ImportLimitError,
} from "../lib/import-model";
import { unzipCalendars } from "../lib/unzip";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import type { ImportRepository } from "../repositories/imports";
import { deletePrefix } from "./attachments";
import { type ApplyCounts, applyImportedEvents, emptyCounts } from "./import-apply";

/**
 * Importaciones (F5-02, F5-03, F5-05). Dos fases, cada una en su instancia del Workflow
 * `ImportWorkflow`:
 *
 * 1. Análisis: el fichero (o la cuenta de Google) se convierte a `ImportedEvent` y se guarda en
 *    trozos de `IMPORT_LIMITS.chunk` eventos en `delyra-imports`; la fila queda en `ready` con la
 *    vista previa (calendarios y número de eventos).
 * 2. Importación: con los destinos que eligió el usuario, cada trozo es un paso del Workflow
 *    (reintentable: aplicar dos veces el mismo trozo no duplica nada).
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** El bucket borra los datos a los 7 días; una vista previa vale 6. */
const IMPORT_READY_TTL_MS = 6 * DAY_MS;
/** Un análisis o importación sin avances en este tiempo se da por interrumpido. */
const IMPORT_STALE_MS = 2 * HOUR_MS;
/** Importaciones que se pueden empezar al día. */
export const IMPORTS_PER_DAY = 20;

// ── Claves en R2 ─────────────────────────────────────────────────────────────

const importPrefix = (ownerId: string, id: string) => `imports/${ownerId}/${id}/`;
export const sourceKey = (ownerId: string, id: string) => `${importPrefix(ownerId, id)}source`;
const icsKey = (ownerId: string, id: string, n: number) =>
  `${importPrefix(ownerId, id)}ics/${String(n)}.ics`;
const chunkKey = (ownerId: string, id: string, key: string, index: number) =>
  `${importPrefix(ownerId, id)}cal-${key}/${String(index)}.json`;

export async function deleteImportData(bucket: R2Bucket, ownerId: string, id: string) {
  await deletePrefix(bucket, importPrefix(ownerId, id));
}

// ── Vista previa y opciones guardadas ────────────────────────────────────────

export interface StoredCalendar extends ImportCalendarPreview {
  chunks: number;
}

interface StoredPreview {
  calendars: StoredCalendar[];
  warnings: string[];
}

export interface StoredOptions extends StartImportRequest {
  /** Calendarios creados durante la importación (clave → id), para reutilizarlos al reintentar. */
  created?: Record<string, string>;
}

function readJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function storedPreview(row: ImportRow): StoredPreview {
  return readJson<StoredPreview>(row.preview) ?? { calendars: [], warnings: [] };
}

export function storedOptions(row: ImportRow): StoredOptions | null {
  const raw = readJson<StoredOptions>(row.options);
  if (!raw) return null;
  const parsed = startImportRequestSchema.safeParse(raw);
  return parsed.success ? { ...parsed.data, created: raw.created ?? {} } : null;
}

export function importDto(row: ImportRow): ImportInfo {
  const preview = storedPreview(row);
  const report = importReportSchema.safeParse(readJson(row.report));
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    filename: row.filename,
    calendars: preview.calendars.map(({ chunks: _chunks, ...calendar }) => calendar),
    warnings: preview.warnings,
    progress: { done: row.progressDone, total: row.progressTotal },
    report: report.success ? report.data : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** Caduca las vistas previas antiguas y da por fallidas las que se quedaron a medias. */
export async function refreshStatus(
  repo: ImportRepository,
  row: ImportRow,
  now: number,
): Promise<ImportRow> {
  if (row.status === "ready" && row.createdAt.getTime() < now - IMPORT_READY_TTL_MS) {
    return (await repo.transition(row.id, "ready", { status: "expired" })) ?? row;
  }
  if (
    (row.status === "analyzing" || row.status === "importing") &&
    row.updatedAt.getTime() < now - IMPORT_STALE_MS
  ) {
    return (
      (await repo.transition(row.id, row.status, {
        status: "failed",
        error: "La importación se interrumpió. Vuelve a intentarlo.",
        googleTokenEnc: null,
        finishedAt: new Date(now),
      })) ?? row
    );
  }
  return row;
}

/** Mensaje para el usuario: los errores de formato y de límites se explican; el resto no. */
function userMessage(error: unknown): string {
  if (error instanceof ImportFormatError || error instanceof ImportLimitError) {
    return error.message;
  }
  return "No se ha podido completar. Vuelve a intentarlo más tarde.";
}

// ── Análisis de ficheros (F5-01, F5-02) ──────────────────────────────────────

export interface SourceFile {
  name: string;
  key: string;
}

/** Separa el fichero subido en sus calendarios: un `.ics` suelto o los `.ics` de un `.zip`. */
export async function splitUpload(bucket: R2Bucket, row: ImportRow): Promise<SourceFile[]> {
  const key = sourceKey(row.ownerId, row.id);
  const missing = () => new ImportFormatError("El fichero ya no está disponible. Súbelo de nuevo.");
  const head = await bucket.get(key, { range: { offset: 0, length: 4 } });
  if (!head) throw missing();
  const bytes = new Uint8Array(await head.arrayBuffer());
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return [{ name: row.filename ?? "calendario.ics", key }];
  }
  const object = await bucket.get(key);
  if (!object) throw missing();
  const entries = await unzipCalendars(object.body as ReadableStream<Uint8Array>);
  const files: SourceFile[] = [];
  for (const [n, entry] of entries.entries()) {
    const key = icsKey(row.ownerId, row.id, n);
    await bucket.put(key, entry.text, { httpMetadata: { contentType: "text/calendar" } });
    files.push({ name: entry.name, key });
  }
  return files;
}

export function summarize(events: readonly ImportedEvent[]) {
  let first: number | null = null;
  let last: number | null = null;
  let recurring = 0;
  let withReminders = 0;
  let birthdays = 0;
  for (const event of events) {
    if (event.recurrenceId === null) {
      if (event.rrule) recurring++;
      if (event.type === "birthday") birthdays++;
      if (event.reminders.length > 0) withReminders++;
    }
    first = first === null ? event.startAt : Math.min(first, event.startAt);
    last = last === null ? event.startAt : Math.max(last, event.startAt);
  }
  return {
    events: events.length,
    recurring,
    withReminders,
    birthdays,
    firstStart: first === null ? null : new Date(first).toISOString(),
    lastStart: last === null ? null : new Date(last).toISOString(),
  };
}

export async function writeChunks(
  bucket: R2Bucket,
  row: Pick<ImportRow, "ownerId" | "id">,
  key: string,
  events: readonly ImportedEvent[],
): Promise<number> {
  let chunks = 0;
  for (let i = 0; i < events.length; i += IMPORT_LIMITS.chunk) {
    await bucket.put(
      chunkKey(row.ownerId, row.id, key, chunks),
      JSON.stringify(events.slice(i, i + IMPORT_LIMITS.chunk)),
      { httpMetadata: { contentType: "application/json" } },
    );
    chunks++;
  }
  return chunks;
}

async function readChunk(
  bucket: R2Bucket,
  row: Pick<ImportRow, "ownerId" | "id">,
  key: string,
  index: number,
): Promise<ImportedEvent[]> {
  const object = await bucket.get(chunkKey(row.ownerId, row.id, key, index));
  if (!object) throw new ImportFormatError("Los datos de la importación ya no están disponibles");
  return object.json<ImportedEvent[]>();
}

export async function userTimeZone(db: Database, ownerId: string): Promise<string> {
  const [row] = await db
    .select({ timeZone: userSettings.timeZone })
    .from(userSettings)
    .where(eq(userSettings.userId, ownerId))
    .limit(1);
  return row?.timeZone ?? "Europe/Madrid";
}

/** Analiza un `.ics` (suelto o del zip) y lo deja troceado en R2. */
export async function analyzeIcsFile(
  bucket: R2Bucket,
  row: ImportRow,
  file: SourceFile,
  index: number,
  options: { timeZone: string; remainingEvents: number },
): Promise<{ calendar: StoredCalendar; warnings: string[] }> {
  const object = await bucket.get(file.key);
  if (!object) throw new ImportFormatError("El fichero ya no está disponible. Súbelo de nuevo.");
  if (object.size > IMPORT_LIMITS.icsBytes) {
    await object.body.cancel();
    throw new ImportLimitError("El calendario es demasiado grande");
  }
  const parsed = parseIcs(await object.text(), {
    defaultTimeZone: options.timeZone,
    maxEvents: options.remainingEvents,
  });
  const key = String(index);
  const chunks = await writeChunks(bucket, row, key, parsed.events);
  const fallbackName = file.name
    .replace(/\.ics$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return {
    calendar: {
      key,
      name: parsed.name ?? (fallbackName || `Calendario ${String(index + 1)}`),
      color: parsed.color,
      timeZone: parsed.timeZone,
      ...summarize(parsed.events),
      suggestedCalendarId: null,
      suggestSkip: parsed.events.length === 0,
      chunks,
    },
    warnings:
      parsed.skipped > 0
        ? [...parsed.warnings.list, `Se han descartado ${String(parsed.skipped)} eventos`]
        : parsed.warnings.list,
  };
}

/** Cierra el análisis: sugiere destinos por nombre y deja la importación lista. */
export async function finishAnalysis(
  db: Database,
  repo: ImportRepository,
  row: ImportRow,
  calendars: StoredCalendar[],
  warnings: string[],
): Promise<void> {
  const own = (await calendarRepository(db, row.ownerId).list()).filter((c) => !c.readOnly);
  const byName = new Map(own.map((c) => [c.name.trim().toLocaleLowerCase("es"), c.id]));
  const withSuggestions = calendars.map((calendar) => ({
    ...calendar,
    suggestedCalendarId: byName.get(calendar.name.trim().toLocaleLowerCase("es")) ?? null,
  }));
  const unique = [...new Set(warnings)].slice(0, IMPORT_LIMITS.warnings);
  await repo.update(row.id, {
    status: "ready",
    preview: JSON.stringify({
      calendars: withSuggestions,
      warnings: unique,
    } satisfies StoredPreview),
    progressDone: 0,
    progressTotal: calendars.reduce((sum, c) => sum + c.events, 0),
    googleTokenEnc: null,
  });
}

export async function failImport(repo: ImportRepository, id: string, error: unknown) {
  await repo.update(id, {
    status: "failed",
    error: userMessage(error),
    googleTokenEnc: null,
    finishedAt: new Date(),
  });
}

// ── Importación (F5-02) ──────────────────────────────────────────────────────

export interface ChunkResult extends ApplyCounts {
  calendarId: string | null;
}

/** Aplica un trozo de un calendario según el destino elegido. */
export async function importChunk(
  db: Database,
  bucket: R2Bucket,
  repo: ImportRepository,
  importId: string,
  key: string,
  index: number,
  now: number,
): Promise<ChunkResult> {
  const row = await repo.get(importId);
  const options = row ? storedOptions(row) : null;
  const choice = options?.calendars.find((c) => c.key === key);
  if (!row || !options || !choice || choice.target === "skip") {
    return { ...emptyCounts(), calendarId: null };
  }
  const events = await readChunk(bucket, row, key, index);
  const calendars = calendarRepository(db, row.ownerId);
  const writable = (await calendars.list()).filter((c) => !c.readOnly);
  let calendarId: string | null =
    choice.target === "existing" ? choice.calendarId : (options.created?.[key] ?? null);
  if (calendarId !== null && !writable.some((c) => c.id === calendarId)) {
    if (choice.target === "existing") {
      throw new ImportFormatError("Uno de los calendarios de destino ya no existe");
    }
    calendarId = null;
  }

  const target = async () => {
    if (calendarId) return calendarId;
    if (choice.target !== "new") throw new Error("Destino no válido");
    if ((await calendars.count()) >= 50) {
      throw new ImportLimitError("Has llegado al máximo de 50 calendarios");
    }
    const created = await calendars.create({ name: choice.name, color: choice.color });
    calendarId = created.id;
    // Se guarda enseguida: si el paso se reintenta, se reutiliza el mismo calendario.
    await repo.update(importId, {
      options: JSON.stringify({ ...options, created: { ...options.created, [key]: created.id } }),
    });
    return created.id;
  };

  const counts = await applyImportedEvents(
    { events: eventRepository(db, row.ownerId), calendars, now },
    events,
    {
      target,
      scope: { writableCalendarIds: writable.map((c) => c.id) },
      reminders: options.reminders,
      mirror: false,
    },
  );
  const current = await repo.get(importId);
  await repo.update(importId, { progressDone: (current?.progressDone ?? 0) + events.length });
  return { ...counts, calendarId };
}

export function buildReport(
  row: ImportRow,
  results: ReadonlyMap<string, ChunkResult[]>,
): ImportReport {
  const preview = storedPreview(row);
  const options = storedOptions(row);
  const totals = emptyCounts();
  const calendars = preview.calendars
    .filter((c) => options?.calendars.some((o) => o.key === c.key && o.target !== "skip"))
    .map((calendar) => {
      const chunks = results.get(calendar.key) ?? [];
      const sum = chunks.reduce(
        (acc, r) => ({
          created: acc.created + r.created,
          updated: acc.updated + r.updated,
          unchanged: acc.unchanged + r.unchanged,
          skipped: acc.skipped + r.skipped,
        }),
        emptyCounts(),
      );
      totals.created += sum.created;
      totals.updated += sum.updated;
      totals.unchanged += sum.unchanged;
      totals.skipped += sum.skipped;
      const choice = options?.calendars.find((o) => o.key === calendar.key);
      return {
        key: calendar.key,
        name: choice?.target === "new" ? choice.name : calendar.name,
        calendarId: chunks.find((r) => r.calendarId)?.calendarId ?? null,
        ...sum,
      };
    });
  return { ...totals, calendars, warnings: preview.warnings };
}

/**
 * Red de seguridad (cron diario): ningún token de Google sobrevive más de una hora aunque un
 * análisis se haya quedado a medias.
 */
export async function purgeStaleGoogleTokens(db: Database, now: number): Promise<void> {
  await db
    .update(imports)
    .set({ googleTokenEnc: null })
    .where(and(isNotNull(imports.googleTokenEnc), lt(imports.updatedAt, new Date(now - HOUR_MS))));
}
