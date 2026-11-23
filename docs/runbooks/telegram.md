# Runbook · Alertas por Telegram (Fase 3)

Solo hay producción (ADR-0003), así que hay un único bot. En local Telegram aparece como «no
disponible» y los tests simulan la Bot API.

## Poner en marcha el bot (P-10)

1. En Telegram, abre **@BotFather** → `/newbot`. Nombre visible: `Delyra`. Usuario: el que esté
   libre terminado en `bot` (por ejemplo `DelyraAppBot`). Guarda el token en tu gestor de
   contraseñas: **no lo pegues en ningún chat ni en el repositorio**.
2. Opcional en @BotFather: `/setdescription`, `/setuserpic` y `/setjoingroups` → _Disable_ (el
   bot solo atiende chats privados).
3. En tu terminal, desde la raíz del repositorio y con tu sesión de `wrangler`:

   ```sh
   pnpm telegram:setup
   ```

   Pide el token sin mostrarlo, lo comprueba, genera el secreto del webhook, carga los dos
   secretos en `delyra-api` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) y registra el
   webhook `https://delyra.app/api/telegram/webhook` y los comandos.

4. Pon el usuario del bot (sin `@`) en `apps/api/wrangler.jsonc` → `env.production.vars` →
   `TELEGRAM_BOT_USERNAME`, haz commit y despliega. Desde ese momento la comprobación previa del
   despliegue exige los dos secretos.
5. En `https://delyra.app/ajustes#telegram` → **Vincular con Telegram** → **Iniciar** en el bot.

Para cambiar el token (por ejemplo, si se filtra: `/revoke` en @BotFather), vuelve a ejecutar
`pnpm telegram:setup`: rota también el secreto del webhook.

## Cómo funciona

| Pieza        | Dónde                           | Qué hace                                                                 |
| ------------ | ------------------------------- | ------------------------------------------------------------------------ |
| Webhook      | `POST /api/telegram/webhook`    | Valida el secreto, descarta `update_id` repetidos, comandos y botones    |
| Planificador | Cron `* * * * *`                | Reclama alertas vencidas, pospuestas y resúmenes y los encola            |
| Cola         | `delyra-notifications` (+ DLQ)  | Mensajes con clave de idempotencia                                       |
| Consumidor   | `queue()` del Worker `api`      | Envía por Telegram; 429 → espera `retry_after`; 5xx → espera exponencial |
| Entregas     | Tabla `notification_deliveries` | Evita duplicados aunque la cola reintente (30 días)                      |

- Si el usuario bloquea el bot, el primer envío fallido (403) lo desvincula.
- `/silenciar` detiene alertas y resumen; los avisos de seguridad llegan siempre.
- Las horas de silencio solo retrasan el resumen diario.

## Pruebas manuales (F3-11)

1. Vincular la cuenta desde Ajustes; «Enviar mensaje de prueba» llega al momento.
2. Crear un evento dentro de 3 minutos con alerta 1 minuto antes: llega con un minuto de margen,
   con hora local, calendario, ubicación y enlace.
3. Pulsar **10 min**: el mensaje se edita («Pospuesta hasta…») y el aviso vuelve a llegar.
   **Hecho** cierra el mensaje. **Abrir** abre el evento en `delyra.app`.
4. `/hoy`, `/manana`, `/semana`; `/nuevo Dentista mañana 17:30` crea el evento en Personal.
5. `/silenciar 1`: una alerta durante esa hora no llega; `/silenciar no` las reactiva.
6. Resumen diario a una hora cercana: llega una sola vez ese día.
7. Iniciar sesión en otro navegador: llega el aviso de seguridad.
8. Con la cuenta en inglés (F7-06): `/today`, `/new Dentist tomorrow 5:30pm`; las alertas, el
   resumen y los avisos llegan en inglés. Los comandos en español siguen valiendo. Tras desplegar
   la F7-06 hay que volver a ejecutar `pnpm telegram:setup` una vez para registrar la lista de
   comandos en inglés (si no, Telegram solo sugiere los españoles).
9. Sin la cabecera del secreto el webhook responde 401:

   ```sh
   curl -i -X POST https://delyra.app/api/telegram/webhook -H "Content-Type: application/json" -d '{}'
   ```

## Problemas

- **No llegan alertas:** Workers Logs del Worker `api` (`scheduler_run`, `queue_message_failed`,
  `telegram_send_failed`) y la DLQ `delyra-notifications-dlq` en el panel de Queues.
- **El bot no responde:** `getWebhookInfo` del bot (`last_error_message`). Un 404 indica que falta
  `TELEGRAM_BOT_USERNAME` en producción; un 401, que el secreto del Worker no coincide con el del
  webhook (vuelve a ejecutar `pnpm telegram:setup`).
