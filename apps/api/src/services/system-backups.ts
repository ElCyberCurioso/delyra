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

// ── Retención por niveles (F6-08) ────────────────────────────────────────────

export const SYSTEM_TIER_PREFIXES = {
  daily: "system/daily/",
  weekly: "system/weekly/",
  monthly: "system/monthly/",
} as const;

/**
 * A qué niveles más se copia el volcado de un día: el domingo, a `weekly/`; el día 1, a
 * `monthly/`. El ciclo de vida del bucket borra cada nivel a su plazo (30 días, 12 semanas y
 * 12 meses; docs/runbooks/recursos-cloudflare.md).
 */
export function tierKeys(utcDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDate)) throw new RangeError("Fecha de backup no válida");
  const date = new Date(`${utcDate}T00:00:00Z`);
  const keys: string[] = [];
  if (date.getUTCDay() === 0) keys.push(`${SYSTEM_TIER_PREFIXES.weekly}${utcDate}.sql`);
  if (date.getUTCDate() === 1)
    keys.push(`${SYSTEM_TIER_PREFIXES.monthly}${utcDate.slice(0, 7)}.sql`);
  return keys;
}

export async function copyToTiers(bucket: R2Bucket, dailyKey: string, utcDate: string) {
  const copied: string[] = [];
  for (const key of tierKeys(utcDate)) {
    const object = await bucket.get(dailyKey);
    if (!object) throw new Error("No se encuentra el volcado diario para copiarlo");
    const fixed = new FixedLengthStream(object.size);
    const piping = object.body.pipeTo(fixed.writable);
    await bucket.put(key, fixed.readable, {
      httpMetadata: object.httpMetadata,
      customMetadata: { ...object.customMetadata, copiedFrom: dailyKey },
    });
    await piping;
    copied.push(key);
  }
  return copied;
}

/** Ficheros de backup del sistema en R2 (panel de admin, F6-06). */
export async function listSystemBackupObjects(bucket: R2Bucket) {
  const result: {
    key: string;
    tier: keyof typeof SYSTEM_TIER_PREFIXES;
    sizeBytes: number;
    uploadedAt: string;
  }[] = [];
  for (const [tier, prefix] of Object.entries(SYSTEM_TIER_PREFIXES) as [
    keyof typeof SYSTEM_TIER_PREFIXES,
    string,
  ][]) {
    let cursor: string | undefined;
    do {
      const listing = await bucket.list({ prefix, cursor, limit: 1000 });
      for (const object of listing.objects) {
        result.push({
          key: object.key,
          tier,
          sizeBytes: object.size,
          uploadedAt: object.uploaded.toISOString(),
        });
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);
  }
  return result.sort((a, b) => b.key.localeCompare(a.key));
}
