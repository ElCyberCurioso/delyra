import { formatUtcDate } from "@delyra/shared";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { createDb } from "../db/client";
import { createLogger, safeErrorMessage } from "../lib/logger";
import {
  recordBackupFailure,
  recordBackupStart,
  recordBackupSuccess,
  storeDump,
  systemBackupKey,
} from "../services/system-backups";
import { D1ExportClient, D1ExportFailedError } from "./d1-export";

export interface SystemBackupParams {
  /** Fecha UTC (`AAAA-MM-DD`) del volcado. Por defecto, la de la ejecución. */
  date?: string;
}

export interface SystemBackupResult {
  r2Key: string;
  sizeBytes: number;
}

/**
 * Backup diario del sistema (F0-14). Lo lanza el `schedules` del binding `SYSTEM_BACKUP`
 * (wrangler.jsonc) o, de forma manual, `SYSTEM_BACKUP.create()` (F6-06).
 *
 * 1. Inicia la exportación de D1 por la API REST.
 * 2. Espera a que el volcado esté listo y lo copia a `delyra-backups` → `system/daily/AAAA-MM-DD.sql`.
 * 3. Registra el resultado en `system_backup_runs`. Si falla, lo registra y deja la instancia
 *    en error (visible en el panel de Workflows). El aviso por email se conecta en F1-12.
 *
 * El ciclo de vida de 30 días del prefijo `system/daily/` se configura en el bucket
 * (docs/runbooks/recursos-cloudflare.md).
 */
export class SystemBackupWorkflow extends WorkflowEntrypoint<Env, SystemBackupParams> {
  override async run(
    event: Readonly<WorkflowEvent<SystemBackupParams>>,
    step: WorkflowStep,
  ): Promise<SystemBackupResult> {
    const instanceId = event.instanceId;
    const logger = createLogger({ job: "system_backup", instanceId });
    const db = createDb(this.env.DB);
    const trigger = event.schedule ? "schedule" : "manual";
    const runAt = event.schedule?.scheduledTime ?? event.timestamp;
    const r2Key = systemBackupKey(event.payload?.date ?? formatUtcDate(runAt));

    await step.do("registrar inicio", async () => {
      await recordBackupStart(db, {
        id: instanceId,
        trigger,
        startedAt: new Date(event.timestamp),
      });
    });

    try {
      const client = this.#exportClient();

      const bookmark = await step.do(
        "iniciar exportación de D1",
        {
          retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
          timeout: "2 minutes",
        },
        () => client.start(),
      );

      const stored = await step.do(
        "esperar volcado y guardarlo en R2",
        { retries: { limit: 40, delay: "15 seconds", backoff: "constant" }, timeout: "10 minutes" },
        async () => {
          const ready = await this.#nonRetryable(() => client.poll(bookmark));
          const dump = await fetch(ready.signedUrl);
          return storeDump(this.env.BACKUPS, r2Key, dump, {
            workflowInstanceId: instanceId,
            d1Bookmark: bookmark,
            trigger,
          });
        },
      );

      await step.do("registrar resultado", async () => {
        await recordBackupSuccess(db, instanceId, {
          r2Key,
          sizeBytes: stored.sizeBytes,
          finishedAt: new Date(),
        });
      });

      logger.info("system_backup_succeeded", { r2Key, sizeBytes: stored.sizeBytes });
      return { r2Key, sizeBytes: stored.sizeBytes };
    } catch (error) {
      const message = safeErrorMessage(error);
      await step.do("registrar fallo", async () => {
        await recordBackupFailure(db, instanceId, { error: message, finishedAt: new Date() });
      });
      logger.error("system_backup_failed", { r2Key, error: message });
      // TODO(F1-12): enviar aviso por email al administrador.
      throw error;
    }
  }

  #exportClient(): D1ExportClient {
    try {
      return new D1ExportClient({
        accountId: this.env.CF_ACCOUNT_ID,
        databaseId: this.env.D1_DATABASE_ID,
        apiToken: this.env.D1_EXPORT_API_TOKEN ?? "",
      });
    } catch (error) {
      throw new NonRetryableError(safeErrorMessage(error));
    }
  }

  /** Convierte los errores definitivos de la API en `NonRetryableError` para no agotar reintentos. */
  async #nonRetryable<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof D1ExportFailedError) throw new NonRetryableError(error.message);
      throw error;
    }
  }
}
