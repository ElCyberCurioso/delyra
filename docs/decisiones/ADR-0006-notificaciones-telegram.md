# ADR-0006 · Alertas por Telegram: planificador, cola e idempotencia

- **Estado:** aceptada (2026-11-22)
- **Fecha:** 2026-11-22
- **Tareas afectadas:** F3-01 a F3-11

## Contexto

Las alertas deben llegar con un minuto de margen, sin duplicados aunque haya reintentos, y los
botones del mensaje (posponer, «Hecho») deben actuar sobre la alerta correcta y solo para su
dueño.

## Decisión

- **Planificador (cron cada minuto).** Reclama las alertas vencidas con un único
  `UPDATE … SET enqueued_at = ahora … RETURNING` (con la condición repetida para que dos
  ejecuciones no reclamen la misma), las encola y calcula la siguiente ocurrencia. En lugar del
  estado `enqueued` del plan se usa la columna `enqueued_at`: evita reconstruir la tabla para
  cambiar su `CHECK` y permite recuperar las reclamaciones de más de 5 minutos (caída entre
  reclamar y avanzar).
- **Sin avalancha tras una caída.** La siguiente ocurrencia se calcula desde «ahora»: si el cron
  estuvo parado, se avisa una vez y no de cada ocurrencia perdida.
- **Idempotencia.** Cada mensaje lleva una clave (`r:<alerta>:<instante>`, `s:` para las
  pospuestas, `d:<usuario>:<día>` para el resumen). El consumidor la registra en
  `notification_deliveries` antes de enviar y la marca al terminar: un reintento de la cola no
  reenvía lo ya entregado. Solo una caída justo entre el envío y la marca podría duplicar.
- **Errores de Telegram.** 429 → reintento con `retry_after`; 5xx o red → espera exponencial;
  403 o chat inexistente → se desvincula al usuario; agotados los reintentos → DLQ.
- **Posponer.** Columnas `snooze_until` y `snooze_occurrence_start` en `reminders`: un aviso extra
  de la misma ocurrencia, sin tocar el calendario de la alerta. «Mañana 9:00» se calcula en la
  zona del usuario (la cola no admite retrasos tan largos).
- **Privacidad.** El `chat_id` se guarda cifrado (AES-256-GCM, AAD `telegram:<usuario>`) y, para
  encontrar al usuario cuando escribe, como HMAC. Un chat solo puede estar en una cuenta.
- **Webhook.** Sin sesión ni CSRF; autenticado con `X-Telegram-Bot-Api-Secret-Token` comparado en
  tiempo constante. Responde 200 aunque falle el procesado (Telegram no reintenta sin fin) y
  descarta `update_id` repetidos. Solo atiende chats privados.
- **Botones.** `callback_data` = `acción:alerta:inicio-de-la-ocurrencia(base36)`. Se comprueba que
  el chat que pulsa está vinculado al dueño de la alerta.
- **Un solo bot.** Sin staging (ADR-0003); el token y el secreto del webhook los carga
  `pnpm telegram:setup` desde el terminal de quien administra, sin pasar por el chat.

## Consecuencias

- `/nuevo` reutiliza el analizador del alta rápida, ahora en `@delyra/shared` (con
  `chrono-node/es`).
- La tabla `telegram_updates` y las entregas se purgan una vez por hora (2 y 30 días).
