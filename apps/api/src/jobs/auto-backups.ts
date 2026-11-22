import { createDb } from "../db/client";
import type { Logger } from "../lib/logger";
import { backupRepository, dueAutoBackups } from "../services/user-backups";

/**
 * Copias automáticas de usuario (F6-03): el cron diario busca a quién le toca según su
 * frecuencia y lanza una instancia del Workflow por usuario (en lotes de 100).
 */
export async function scheduleAutoBackups(
  env: Pick<Env, "DB" | "BACKUP_WORKFLOW">,
  now: number,
  logger: Logger,
): Promise<number> {
  const db = createDb(env.DB);
  const instances: { id: string; params: { op: "export"; ownerId: string; backupId: string } }[] =
    [];
  for (const ownerId of await dueAutoBackups(db, now)) {
    const repo = backupRepository(db, ownerId);
    if ((await repo.running()).length > 0) continue;
    const row = await repo.create("auto", new Date(now));
    instances.push({ id: `backup-${row.id}`, params: { op: "export", ownerId, backupId: row.id } });
  }
  for (let i = 0; i < instances.length; i += 100) {
    await env.BACKUP_WORKFLOW.createBatch(instances.slice(i, i + 100));
  }
  if (instances.length > 0) logger.info("auto_backups_scheduled", { count: instances.length });
  return instances.length;
}
