import { createApp } from "./app";
import { createDb } from "./db/client";
import { runAutoarchive } from "./jobs/autoarchive";
import { handleNotificationBatch } from "./jobs/notifications-consumer";
import { runScheduler } from "./jobs/scheduler";
import { createLogger } from "./lib/logger";

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
      return;
    }
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
