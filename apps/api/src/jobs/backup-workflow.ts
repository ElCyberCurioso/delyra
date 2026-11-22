import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { createDb } from "../db/client";
import { BackupError } from "../lib/backup-format";
import { createLogger, safeErrorMessage } from "../lib/logger";
import { ZipFormatError, ZipLimitError } from "../lib/zip-stream";
import {
  deleteRestoreData,
  readPlan,
  type RestoreContext,
  restoreBoardMeta,
  restoreCalendars,
  restoreCardChunk,
  restoreEventChunk,
  restoreMessage,
  restoreProfile,
  restoreRepository,
  validateRestore,
  wipeUserData,
} from "../services/restores";
import {
  backupRepository,
  getBackupSettings,
  keepFor,
  pruneBackups,
  writeBackup,
} from "../services/user-backups";

export type BackupParams =
  | { op: "export"; ownerId: string; backupId: string }
  | { op: "validate"; ownerId: string; restoreId: string }
  | { op: "restore"; ownerId: string; restoreId: string };

const isDefinitive = (error: unknown) =>
  error instanceof BackupError || error instanceof ZipLimitError || error instanceof ZipFormatError;

/**
 * Copias de usuario (F6-02, F6-03) y restauraciones (F6-04). Cada restauración guarda antes una
 * copia de lo que había (`pre_restore`), que es lo que usa «Deshacer».
 */
export class BackupWorkflow extends WorkflowEntrypoint<Env, BackupParams> {
  override async run(event: Readonly<WorkflowEvent<BackupParams>>, step: WorkflowStep) {
    const params = event.payload;
    const logger = createLogger({ job: "user_backup", op: params.op });
    try {
      if (params.op === "export") await this.#export(step, params.ownerId, params.backupId);
      else if (params.op === "validate")
        await this.#validate(step, params.ownerId, params.restoreId);
      else await this.#restore(step, params.ownerId, params.restoreId);
      logger.info("user_backup_op_succeeded");
    } catch (error) {
      const definitive = await step.do("registrar fallo", async () => {
        const db = createDb(this.env.DB);
        if (params.op === "export") {
          await backupRepository(db, params.ownerId).update(params.backupId, {
            status: "failed",
            error: "No se ha podido generar la copia",
            finishedAt: new Date(),
          });
          return false;
        }
        const repo = restoreRepository(db, params.ownerId);
        const row = await repo.get(params.restoreId);
        if (row?.status === "failed") return true;
        await repo.update(params.restoreId, {
          status: "failed",
          error: restoreMessage(error),
          finishedAt: new Date(),
        });
        return false;
      });
      logger.warn("user_backup_op_failed", { definitive, error: safeErrorMessage(error) });
      if (!definitive) throw error;
    }
  }

  /** Errores de la copia (formato, checksum, límites): se registran y no se reintentan. */
  #definitive(ownerId: string, restoreId: string) {
    const repo = restoreRepository(createDb(this.env.DB), ownerId);
    return async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        if (isDefinitive(error)) {
          await repo.update(restoreId, {
            status: "failed",
            error: restoreMessage(error),
            finishedAt: new Date(),
          });
          throw new NonRetryableError(error instanceof Error ? error.message : "Copia no válida");
        }
        throw error;
      }
    };
  }

  async #export(step: WorkflowStep, ownerId: string, backupId: string) {
    const db = createDb(this.env.DB);
    const repo = backupRepository(db, ownerId);
    const kind = await step.do(
      "generar copia",
      { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" }, timeout: "30 minutes" },
      async () => {
        const row = await repo.get(backupId);
        if (!row) throw new NonRetryableError("La copia no existe");
        const result = await writeBackup(db, this.env, ownerId, backupId, row.kind);
        await repo.update(backupId, {
          status: "ready",
          sizeBytes: result.sizeBytes,
          counts: JSON.stringify(result.counts),
          error: null,
          finishedAt: new Date(),
        });
        return row.kind;
      },
    );
    await step.do("borrar copias antiguas", async () => {
      const settings = await getBackupSettings(db, ownerId);
      await pruneBackups(db, this.env.BACKUPS, ownerId, kind, keepFor(kind, settings));
    });
  }

  async #validate(step: WorkflowStep, ownerId: string, restoreId: string) {
    const db = createDb(this.env.DB);
    const repo = restoreRepository(db, ownerId);
    const definitive = this.#definitive(ownerId, restoreId);
    const undo = await step.do(
      "validar copia",
      { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "20 minutes" },
      () =>
        definitive(async () => {
          const row = await repo.get(restoreId);
          if (!row) throw new NonRetryableError("La restauración no existe");
          await validateRestore(this.env, repo, row);
          // Deshacer no pide confirmación: reemplaza directamente con la copia previa.
          if (row.undoOf) {
            await repo.update(restoreId, { status: "restoring", mode: "replace" });
            return true;
          }
          await repo.update(restoreId, { status: "ready" });
          return false;
        }),
    );
    if (undo) await this.#restore(step, ownerId, restoreId);
  }

  async #restore(step: WorkflowStep, ownerId: string, restoreId: string) {
    const db = createDb(this.env.DB);
    const repo = restoreRepository(db, ownerId);
    const definitive = this.#definitive(ownerId, restoreId);
    const retries = {
      retries: { limit: 4, delay: "5 seconds", backoff: "exponential" },
      timeout: "15 minutes",
    } as const;

    const context = async (): Promise<RestoreContext> => {
      const row = await repo.get(restoreId);
      const plan = row ? readPlan(row) : null;
      if (!row || !plan || !row.mode) throw new NonRetryableError("La restauración no está lista");
      return { db, env: this.env, row, plan, mode: row.mode, now: Date.now() };
    };
    const advance = async () => {
      const row = await repo.get(restoreId);
      if (row) await repo.update(restoreId, { progressDone: row.progressDone + 1 });
    };

    const shape = await step.do("preparar", async () => {
      const ctx = await context();
      return {
        mode: ctx.mode,
        undo: ctx.row.undoOf !== null,
        eventChunks: ctx.plan.eventChunks,
        boards: ctx.plan.boards,
      };
    });

    if (!shape.undo) {
      await step.do(
        "copia previa",
        {
          retries: { limit: 3, delay: "15 seconds", backoff: "exponential" },
          timeout: "30 minutes",
        },
        async () => {
          const row = await repo.get(restoreId);
          if (!row) throw new NonRetryableError("La restauración no existe");
          const backups = backupRepository(db, ownerId);
          const existing = row.preBackupId ? await backups.get(row.preBackupId) : null;
          if (existing?.status === "ready") return;
          const backup = existing ?? (await backups.create("pre_restore"));
          await repo.update(restoreId, { preBackupId: backup.id });
          const result = await writeBackup(db, this.env, ownerId, backup.id, "pre_restore");
          await backups.update(backup.id, {
            status: "ready",
            sizeBytes: result.sizeBytes,
            counts: JSON.stringify(result.counts),
            finishedAt: new Date(),
          });
          const settings = await getBackupSettings(db, ownerId);
          await pruneBackups(
            db,
            this.env.BACKUPS,
            ownerId,
            "pre_restore",
            keepFor("pre_restore", settings),
          );
        },
      );
    }

    if (shape.mode === "replace") {
      await step.do("vaciar datos actuales", retries, async () => {
        await wipeUserData(db, this.env.ATTACHMENTS, ownerId);
        await restoreProfile(await context());
      });
    }

    await step.do("calendarios", retries, () =>
      definitive(async () => {
        const ctx = await context();
        const calendarMap = await restoreCalendars(ctx);
        await repo.update(restoreId, {
          preview: JSON.stringify({ ...ctx.plan, calendarMap }),
          progressDone: 1,
        });
      }),
    );
    for (let i = 0; i < shape.eventChunks; i++) {
      await step.do(`eventos ${String(i)}`, retries, () =>
        definitive(async () => {
          await restoreEventChunk(await context(), i);
          await advance();
        }),
      );
    }
    for (const board of shape.boards) {
      await step.do(`tablero ${String(board.index)}`, retries, () =>
        definitive(async () => {
          await restoreBoardMeta(await context(), board.index);
          await advance();
        }),
      );
      for (let k = 0; k < board.cardChunks; k++) {
        await step.do(`tablero ${String(board.index)} tarjetas ${String(k)}`, retries, () =>
          definitive(async () => {
            await restoreCardChunk(await context(), board.index, k);
            await advance();
          }),
        );
      }
    }

    await step.do("terminar", async () => {
      const row = await repo.get(restoreId);
      if (!row) return;
      await repo.update(restoreId, {
        status: "succeeded",
        progressDone: row.progressTotal,
        error: null,
        finishedAt: new Date(),
      });
      if (row.undoOf) await repo.update(row.undoOf, { status: "undone" });
      await deleteRestoreData(this.env.IMPORTS, ownerId, restoreId);
    });
  }
}
