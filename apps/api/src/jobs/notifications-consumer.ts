import { createDb } from "../db/client";
import { createLogger } from "../lib/logger";
import { telegramClient } from "../lib/telegram";
import { deliver, notificationMessageSchema } from "../services/notifications";
import { telegramConfig } from "../services/telegram-links";

export { notificationMessageSchema };
export type { NotificationMessage } from "../services/notifications";

/**
 * Consumidor de `delyra-notifications` (F3-06). Cada mensaje se entrega una vez (clave de
 * idempotencia en D1); los errores pasajeros de Telegram (429, 5xx, red) se reintentan con la
 * espera que pide Telegram o con espera exponencial, y agotados los reintentos el mensaje
 * acaba en la dead-letter queue. Un mensaje con formato desconocido nunca se descarta en
 * silencio: se reintenta y termina en la DLQ para poder inspeccionarlo.
 */
export async function handleNotificationBatch(batch: MessageBatch, env: Env): Promise<void> {
  const logger = createLogger({ queue: batch.queue });
  const db = createDb(env.DB);
  const config = telegramConfig(env);
  const telegram = config ? telegramClient(config.token) : null;

  for (const message of batch.messages) {
    const parsed = notificationMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      logger.warn("queue_message_invalid", { messageId: message.id, attempts: message.attempts });
      message.retry();
      continue;
    }
    try {
      const result = await deliver(
        { db, env, telegram, logger, now: Date.now() },
        parsed.data,
        message.attempts,
      );
      if (result.status === "retry") {
        message.retry({ delaySeconds: result.delaySeconds });
      } else {
        message.ack();
      }
    } catch (error) {
      logger.error("queue_message_failed", {
        messageId: message.id,
        type: parsed.data.type,
        attempts: message.attempts,
        error,
      });
      message.retry({ delaySeconds: Math.min(30 * 2 ** message.attempts, 900) });
    }
  }
}
