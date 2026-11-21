import { createApp } from "./app";
import { createDb } from "./db/client";
import { handleNotificationBatch } from "./jobs/notifications-consumer";
import { runScheduler } from "./jobs/scheduler";
import { createLogger } from "./lib/logger";

export { SystemBackupWorkflow } from "./jobs/system-backup";

const app = createApp();

export default {
  fetch: app.fetch,
  queue: (batch, env) => handleNotificationBatch(batch, env),
  // F3-05: alertas y resumen diario, cada minuto.
  scheduled: (controller, env, ctx) => {
    const logger = createLogger({ cron: controller.cron });
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
