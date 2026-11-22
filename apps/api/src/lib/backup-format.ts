import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupCounts,
  type BackupDataV1,
  backupDataV1Schema,
  backupFileSchema,
} from "@delyra/shared";
import { sha256Hex } from "./crypto";

/**
 * Formato de copia v1 (F6-01, docs/formato-backup.md): `backup.json` con cabecera, checksum
 * SHA-256 de `JSON.stringify(data)` y los datos. Aquí se construye y se valida; la validación
 * rechaza antes de tocar nada cualquier copia manipulada (F6-09).
 */

/** Error que se enseña tal cual al usuario. */
export class BackupError extends Error {
  override name = "BackupError";
}

export async function buildBackupJson(
  data: BackupDataV1,
  options: { exportedAt: Date; appVersion: string | null },
): Promise<string> {
  const body = JSON.stringify(data);
  const checksum = await sha256Hex(body);
  // Se escribe a mano para que `data` quede exactamente como se calculó el checksum.
  const header = JSON.stringify({
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    exported_at: options.exportedAt.toISOString(),
    app_version: options.appVersion,
    checksum: { algorithm: "sha256", value: checksum },
  });
  return `${header.slice(0, -1)},"data":${body}}`;
}

/**
 * Migraciones de formato: cada versión anterior se convierte a la actual. Por ahora solo existe
 * la v1; una versión posterior (de una Delyra más nueva) no se puede interpretar.
 */
export function migrateBackupData(version: number, data: unknown): unknown {
  if (version > BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      `La copia es de una versión más nueva del formato (v${String(version)}) y no se puede leer`,
    );
  }
  return data;
}

export interface ParsedBackup {
  data: BackupDataV1;
  exportedAt: string;
  formatVersion: number;
}

export async function parseBackupJson(text: string): Promise<ParsedBackup> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("El fichero no es una copia de Delyra (JSON no válido)");
  }
  const file = backupFileSchema.safeParse(raw);
  if (!file.success) throw new BackupError("El fichero no es una copia de Delyra");
  // El checksum se comprueba sobre los datos tal cual vienen, antes de migrarlos.
  const checksum = await sha256Hex(JSON.stringify(file.data.data));
  if (checksum !== file.data.checksum.value) {
    throw new BackupError("La copia está dañada o se ha modificado (el checksum no coincide)");
  }
  const migrated = migrateBackupData(file.data.format_version, file.data.data);
  const data = backupDataV1Schema.safeParse(migrated);
  if (!data.success) {
    const issue = data.error.issues[0];
    throw new BackupError(
      `La copia tiene datos no válidos${issue ? ` (${issue.path.join(".")})` : ""}`,
    );
  }
  checkReferences(data.data);
  return {
    data: data.data,
    exportedAt: file.data.exported_at,
    formatVersion: file.data.format_version,
  };
}

function uniqueIds(name: string, rows: readonly { id: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new BackupError(`La copia tiene ${name} con el mismo id`);
    ids.add(row.id);
  }
  return ids;
}

/**
 * Integridad interna: toda referencia apunta a algo de la misma copia. Así un id ajeno
 * (de otro usuario, inyectado a mano) no puede colarse: no existe dentro de la copia.
 */
export function checkReferences(data: BackupDataV1): void {
  const fail = (what: string) => {
    throw new BackupError(`La copia tiene referencias rotas (${what})`);
  };
  const calendars = uniqueIds("calendarios", data.calendars);
  uniqueIds("eventos", data.events);
  const masters = new Set(data.events.filter((e) => e.recurringEventId === null).map((e) => e.id));
  for (const event of data.events) {
    if (!calendars.has(event.calendarId)) fail("evento sin su calendario");
    if (event.endAt <= event.startAt) fail("evento que termina antes de empezar");
    if ((event.recurringEventId === null) !== (event.originalStart === null)) {
      fail("excepción de serie incompleta");
    }
    if (event.recurringEventId !== null && !masters.has(event.recurringEventId)) {
      fail("excepción sin su serie");
    }
  }
  for (const reminder of data.eventReminders) {
    if (!masters.has(reminder.eventId)) fail("alerta sin su evento");
  }

  const boards = uniqueIds("tableros", data.boards);
  const columnBoard = new Map<string, string>();
  uniqueIds("columnas", data.columns);
  for (const column of data.columns) {
    if (!boards.has(column.boardId)) fail("columna sin su tablero");
    columnBoard.set(column.id, column.boardId);
  }
  const labelBoard = new Map<string, string>();
  uniqueIds("etiquetas", data.labels);
  for (const label of data.labels) {
    if (!boards.has(label.boardId)) fail("etiqueta sin su tablero");
    labelBoard.set(label.id, label.boardId);
  }
  const cardBoard = new Map<string, string>();
  uniqueIds("tarjetas", data.cards);
  for (const card of data.cards) {
    if (columnBoard.get(card.columnId) !== card.boardId) fail("tarjeta fuera de su tablero");
    cardBoard.set(card.id, card.boardId);
  }
  const seenLabels = new Set<string>();
  for (const link of data.cardLabels) {
    const board = cardBoard.get(link.cardId);
    if (!board || labelBoard.get(link.labelId) !== board) fail("etiqueta de otro tablero");
    const key = `${link.cardId}:${link.labelId}`;
    if (seenLabels.has(key)) fail("etiqueta repetida");
    seenLabels.add(key);
  }
  uniqueIds("elementos de checklist", data.checklist);
  uniqueIds("comentarios", data.comments);
  uniqueIds("actividad", data.activity);
  uniqueIds("adjuntos", data.attachments);
  for (const rows of [
    data.checklist,
    data.comments,
    data.activity,
    data.attachments,
    data.cardReminders,
  ]) {
    for (const row of rows) if (!cardBoard.has(row.cardId)) fail("dato sin su tarjeta");
  }
}

export function countsOf(data: BackupDataV1): BackupCounts {
  return {
    calendars: data.calendars.length,
    events: data.events.filter((e) => e.recurringEventId === null).length,
    boards: data.boards.length,
    cards: data.cards.length,
    attachments: data.attachments.length,
  };
}

/**
 * Identificador UUIDv7 determinista a partir de una semilla: reintentar un paso de la
 * restauración genera los mismos ids (y `ON CONFLICT DO NOTHING` evita duplicados).
 */
export async function deterministicId(timestampMs: number, seed: string): Promise<string> {
  const hex = await sha256Hex(seed);
  const ts = Math.floor(timestampMs).toString(16).padStart(12, "0").slice(-12);
  const variant = ((Number.parseInt(hex.slice(15, 16), 16) & 0x3) | 0x8).toString(16);
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${hex.slice(0, 3)}-${variant}${hex.slice(3, 6)}-${hex.slice(6, 18)}`;
}
