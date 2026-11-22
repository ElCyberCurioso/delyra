import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { createDb } from "../db/client";
import { keyringFromEnv } from "../lib/field-crypto";
import { IMPORT_LIMITS, ImportFormatError, ImportLimitError } from "../lib/import-model";
import { createLogger, safeErrorMessage } from "../lib/logger";
import { importRepository } from "../repositories/imports";
import {
  calendarMeta,
  type CalendarMeta,
  downloadCalendar,
  GoogleCalendarClient,
  openToken,
} from "../services/google";
import {
  analyzeIcsFile,
  buildReport,
  type ChunkResult,
  deleteImportData,
  failImport,
  finishAnalysis,
  importChunk,
  splitUpload,
  type StoredCalendar,
  storedOptions,
  storedPreview,
  summarize,
  userTimeZone,
  writeChunks,
} from "../services/imports";

export interface ImportParams {
  importId: string;
  ownerId: string;
  phase: "analyze" | "import";
}

/**
 * Importación por lotes (F5-02, F5-05). Una instancia analiza (fichero o cuenta de Google) y
 * deja la vista previa; otra, cuando el usuario elige los destinos, importa trozo a trozo.
 * Cada paso es idempotente: reintentarlo no duplica eventos (se identifican por UID).
 */
export class ImportWorkflow extends WorkflowEntrypoint<Env, ImportParams> {
  override async run(event: Readonly<WorkflowEvent<ImportParams>>, step: WorkflowStep) {
    const { importId, ownerId, phase } = event.payload;
    const logger = createLogger({ job: "import", phase, importId });
    const repo = importRepository(createDb(this.env.DB), ownerId);
    try {
      if (phase === "analyze") await this.#analyze(step, importId, ownerId);
      else await this.#import(step, importId, ownerId);
      logger.info("import_phase_succeeded");
    } catch (error) {
      const definitive = await step.do("registrar fallo", async () => {
        const row = await repo.get(importId);
        // Un error de formato o de límites ya se registró con su mensaje para el usuario.
        if (row?.status === "failed") return true;
        await failImport(repo, importId, error);
        return false;
      });
      logger.warn("import_phase_failed", { definitive, error: safeErrorMessage(error) });
      if (!definitive) throw error;
    }
  }

  /**
   * Errores que no se arreglan reintentando (formato, límites): se registran con su mensaje y
   * se corta el paso sin más reintentos.
   */
  #definitive(importId: string, ownerId: string) {
    const repo = importRepository(createDb(this.env.DB), ownerId);
    return async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof ImportFormatError || error instanceof ImportLimitError) {
          await failImport(repo, importId, error);
          throw new NonRetryableError(error.message);
        }
        throw error;
      }
    };
  }

  async #analyze(step: WorkflowStep, importId: string, ownerId: string) {
    const db = createDb(this.env.DB);
    const repo = importRepository(db, ownerId);
    const retries = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } } as const;
    const definitive = this.#definitive(importId, ownerId);

    const source = await step.do("leer importación", async () => {
      const row = await repo.get(importId);
      if (!row) throw new NonRetryableError("La importación no existe");
      return { source: row.source, timeZone: await userTimeZone(db, ownerId) };
    });

    const calendars: StoredCalendar[] = [];
    const warnings: string[] = [];
    let total = 0;

    if (source.source === "file") {
      const files = await step.do("descomprimir", retries, () =>
        definitive(async () => {
          const row = await repo.get(importId);
          if (!row) throw new NonRetryableError("La importación no existe");
          return splitUpload(this.env.IMPORTS, row);
        }),
      );
      for (const [index, file] of files.entries()) {
        const result = await step.do(`analizar calendario ${String(index)}`, retries, () =>
          definitive(async () => {
            const row = await repo.get(importId);
            if (!row) throw new NonRetryableError("La importación no existe");
            return analyzeIcsFile(this.env.IMPORTS, row, file, index, {
              timeZone: source.timeZone,
              remainingEvents: IMPORT_LIMITS.events - total,
            });
          }),
        );
        calendars.push(result.calendar);
        warnings.push(...result.warnings);
        total += result.calendar.events;
      }
    } else {
      const metas = await step.do("listar calendarios de Google", retries, () =>
        definitive(async () => {
          const client = await this.#googleClient(repo, importId, ownerId);
          return (await client.calendarList()).map(calendarMeta);
        }),
      );
      for (const [index, meta] of metas.entries()) {
        const result = await step.do(`descargar calendario ${String(index)}`, retries, () =>
          definitive(() =>
            this.#downloadGoogle(repo, importId, ownerId, meta, index, {
              timeZone: source.timeZone,
              remainingEvents: IMPORT_LIMITS.events - total,
            }),
          ),
        );
        calendars.push(result.calendar);
        warnings.push(...result.warnings);
        total += result.calendar.events;
      }
    }

    await step.do("preparar vista previa", async () => {
      const row = await repo.get(importId);
      if (!row) throw new NonRetryableError("La importación no existe");
      await finishAnalysis(db, repo, row, calendars, warnings);
    });
  }

  async #googleClient(
    repo: ReturnType<typeof importRepository>,
    importId: string,
    ownerId: string,
  ) {
    const row = await repo.get(importId);
    if (!row) throw new NonRetryableError("La importación no existe");
    const keyring = await keyringFromEnv(this.env);
    const token = await openToken(row.googleTokenEnc, keyring, ownerId, importId);
    return new GoogleCalendarClient(token);
  }

  async #downloadGoogle(
    repo: ReturnType<typeof importRepository>,
    importId: string,
    ownerId: string,
    meta: CalendarMeta,
    index: number,
    options: { timeZone: string; remainingEvents: number },
  ): Promise<{ calendar: StoredCalendar; warnings: string[] }> {
    const client = await this.#googleClient(repo, importId, ownerId);
    const { events, warnings } = await downloadCalendar(client, meta, {
      defaultTimeZone: options.timeZone,
      maxEvents: options.remainingEvents,
    });
    const key = String(index);
    const chunks = await writeChunks(this.env.IMPORTS, { ownerId, id: importId }, key, events);
    return {
      calendar: {
        key,
        name: meta.name,
        color: meta.color,
        timeZone: meta.timeZone,
        ...summarize(events),
        suggestedCalendarId: null,
        suggestSkip: meta.suggestSkip || events.length === 0,
        chunks,
      },
      warnings: warnings.list,
    };
  }

  async #import(step: WorkflowStep, importId: string, ownerId: string) {
    const db = createDb(this.env.DB);
    const repo = importRepository(db, ownerId);
    const definitive = this.#definitive(importId, ownerId);

    const plan = await step.do("preparar importación", async () => {
      const row = await repo.get(importId);
      const options = row ? storedOptions(row) : null;
      if (!row || !options) throw new NonRetryableError("La importación no está lista");
      return storedPreview(row)
        .calendars.filter((c) =>
          options.calendars.some((o) => o.key === c.key && o.target !== "skip"),
        )
        .map((c) => ({ key: c.key, chunks: c.chunks }));
    });

    const results = new Map<string, ChunkResult[]>();
    for (const calendar of plan) {
      const list: ChunkResult[] = [];
      for (let index = 0; index < calendar.chunks; index++) {
        const result = await step.do(
          `importar calendario ${calendar.key} parte ${String(index)}`,
          {
            retries: { limit: 5, delay: "5 seconds", backoff: "exponential" },
            timeout: "10 minutes",
          },
          () =>
            definitive(() =>
              importChunk(db, this.env.IMPORTS, repo, importId, calendar.key, index, Date.now()),
            ),
        );
        list.push(result);
      }
      results.set(calendar.key, list);
    }

    await step.do("terminar importación", async () => {
      const row = await repo.get(importId);
      if (!row) return;
      await repo.update(importId, {
        status: "succeeded",
        report: JSON.stringify(buildReport(row, results)),
        progressDone: row.progressTotal,
        finishedAt: new Date(),
      });
      // Los datos temporales ya no hacen falta (el ciclo de vida del bucket es solo la red).
      await deleteImportData(this.env.IMPORTS, ownerId, importId);
    });
  }
}
