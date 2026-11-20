import { z } from "zod";
import { createLogger } from "../lib/logger";

/**
 * Consumidor de `delyra-notifications`. En F0 solo existe la infraestructura (cola, DLQ y
 * reintentos); los tipos de mensaje reales (alertas de Telegram) llegan en F3-06.
 * Un mensaje desconocido se reintenta y, agotados los reintentos, acaba en la DLQ para
 * poder inspeccionarlo: nunca se descarta en silencio.
 */
export const notificationMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noop"), idempotencyKey: z.string().min(1).max(200) }),
]);

export type NotificationMessage = z.infer<typeof notificationMessageSchema>;

export function handleNotificationBatch(batch: MessageBatch): void {
  const logger = createLogger({ queue: batch.queue });
  for (const message of batch.messages) {
    const parsed = notificationMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      logger.warn("queue_message_invalid", { messageId: message.id, attempts: message.attempts });
      message.retry();
      continue;
    }
    logger.debug("queue_message_processed", {
      messageId: message.id,
      type: parsed.data.type,
      attempts: message.attempts,
    });
    message.ack();
  }
}
