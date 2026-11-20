import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { type SystemBackupRun, systemBackupRuns } from "../db/schema";

export const SYSTEM_BACKUP_PREFIX = "system/daily/";

/** Clave en R2 del volcado diario: `system/daily/AAAA-MM-DD.sql`. */
export function systemBackupKey(utcDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDate)) throw new RangeError("Fecha de backup no válida");
  return `${SYSTEM_BACKUP_PREFIX}${utcDate}.sql`;
}

export interface StoredDump {
  sizeBytes: number;
  etag: string;
}

/**
 * Guarda el volcado en R2. Si la descarga trae longitud conocida se envía en streaming;
 * si no, se lee completa (R2 necesita conocer el tamaño de un stream).
 */
export async function storeDump(
  bucket: R2Bucket,
  key: string,
  dump: Response,
  customMetadata: Record<string, string>,
): Promise<StoredDump> {
  if (!dump.ok || !dump.body) {
    throw new Error(`Descarga del volcado fallida (HTTP ${String(dump.status)})`);
  }
  const body = dump.headers.has("content-length") ? dump.body : await dump.arrayBuffer();
  const object = await bucket.put(key, body, {
    httpMetadata: { contentType: "application/sql; charset=utf-8" },
    customMetadata,
  });
  return { sizeBytes: object.size, etag: object.etag };
}

export async function recordBackupStart(
  db: Database,
  run: { id: string; trigger: SystemBackupRun["trigger"]; startedAt: Date },
): Promise<void> {
  await db
    .insert(systemBackupRuns)
    .values({ ...run, status: "running" })
    .onConflictDoUpdate({
      target: systemBackupRuns.id,
      set: { status: "running", finishedAt: null, error: null },
    });
}

export async function recordBackupSuccess(
  db: Database,
  id: string,
  result: { r2Key: string; sizeBytes: number; finishedAt: Date },
): Promise<void> {
  await db
    .update(systemBackupRuns)
    .set({ status: "succeeded", error: null, ...result })
    .where(eq(systemBackupRuns.id, id));
}

export async function recordBackupFailure(
  db: Database,
  id: string,
  failure: { error: string; finishedAt: Date },
): Promise<void> {
  await db
    .update(systemBackupRuns)
    .set({ status: "failed", ...failure })
    .where(eq(systemBackupRuns.id, id));
}

export async function listBackupRuns(db: Database, limit = 30): Promise<SystemBackupRun[]> {
  return db.select().from(systemBackupRuns).orderBy(desc(systemBackupRuns.startedAt)).limit(limit);
}
