import { createApp } from "./app";
import { createDb } from "./db/client";
import { scheduleAutoBackups } from "./jobs/auto-backups";
import { runAutoarchive } from "./jobs/autoarchive";
import { handleNotificationBatch } from "./jobs/notifications-consumer";
import { runScheduler } from "./jobs/scheduler";
import { keyringFromEnv } from "./lib/field-crypto";
import { createLogger } from "./lib/logger";
import { ensureHolidays } from "./services/holidays";
import { purgeStaleGoogleTokens } from "./services/imports";
import { syncDueSubscriptions } from "./services/subscriptions";

export { BackupWorkflow } from "./jobs/backup-workflow";
export { ImportWorkflow } from "./jobs/import-workflow";
export { SystemBackupWorkflow } from "./jobs/system-backup";

const app = createApp();

/** F4-07: autoarchivado de tarjetas terminadas, una vez al día (03:00 UTC). */
const AUTOARCHIVE_CRON = "0 3 * * *";

export default {
  fetch: app.fetch,
  queue: (batch, env) => handleNotificationBatch(batch, env),
  // F3-05: alertas y resumen diario, cada minuto.
  scheduled: (controller, env, ctx) => {
    const logger = createLogger({ cron: controller.cron });
    if (controller.cron === AUTOARCHIVE_CRON) {
      ctx.waitUntil(
        runAutoarchive(createDb(env.DB), Date.now())
          .then((archived) => {
            logger.info("autoarchive_run", { archived });
          })
          .catch((error: unknown) => {
            logger.error("autoarchive_failed", { error });
          }),
      );
      ctx.waitUntil(
        purgeStaleGoogleTokens(createDb(env.DB), Date.now()).catch((error: unknown) => {
          logger.error("google_token_purge_failed", { error });
        }),
      );
      // F7-03: festivos del año en curso y del siguiente (se refrescan cada mes).
      const year = new Date().getUTCFullYear();
      ctx.waitUntil(ensureHolidays(createDb(env.DB), [year, year + 1], Date.now(), logger));
      // F6-03: copias automáticas de los usuarios a los que les toca.
      ctx.waitUntil(
        scheduleAutoBackups(env, Date.now(), logger).catch((error: unknown) => {
          logger.error("auto_backups_failed", { error });
        }),
      );
      return;
    }
    // F5-06: suscripciones iCal, cada hora cada una (unas pocas por minuto).
    ctx.waitUntil(
      keyringFromEnv(env)
        .then((keyring) => syncDueSubscriptions(createDb(env.DB), keyring, Date.now(), logger))
        .catch((error: unknown) => {
          logger.error("subscriptions_sync_failed", { error });
        }),
    );
    ctx.waitUntil(
      runScheduler({
        db: createDb(env.DB),
        now: Math.max(Date.now(), controller.scheduledTime),
        send: async (messages) => {
          await env.NOTIFICATIONS.sendBatch(messages.map((body) => ({ body })));
        },
        logger,
      })
        .then((result) => {
          if (result.reminders + result.snoozes + result.digests > 0) {
            logger.info("scheduler_run", result);
          }
        })
        .catch((error: unknown) => {
          logger.error("scheduler_failed", { error });
        }),
    );
  },
} satisfies ExportedHandler<Env>;
