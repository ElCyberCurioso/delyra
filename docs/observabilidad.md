# Observabilidad y logs (F0-13)

## Qué está activado

Los tres Workers declaran en `wrangler.jsonc`:

```jsonc
"observability": {
  "enabled": true,
  "head_sampling_rate": 1,
  "logs": { "enabled": true, "invocation_logs": true },
  "traces": { "enabled": true, "head_sampling_rate": 1 }
}
```

Los logs y las trazas se consultan en _Workers & Pages → (Worker) → Observability_. Si el volumen
crece, baja `head_sampling_rate` (por ejemplo a `0.2`) en producción.

## Formato

Cada línea es un objeto JSON (`apps/api/src/lib/logger.ts`); Workers Logs indexa cada campo.

| Campo                     | Contenido                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `event`                   | Nombre en snake_case: `http_request`, `health_check_failed`, `csp_violation`…        |
| `level`                   | `debug`, `info`, `warn` o `error`                                                    |
| `time`                    | ISO 8601 UTC                                                                         |
| `requestId`               | UUIDv7 generado por la API (también en la cabecera `X-Request-Id` y en los errores)  |
| `userId`                  | **Seudonimizado** con HMAC-SHA256 (`LOG_PSEUDONYM_KEY`), nunca el id real (desde F1) |
| `route`                   | Patrón de la ruta (`/api/events/:id`), nunca la URL real ni la query                 |
| `status`                  | Código HTTP                                                                          |
| `durationMs`              | Duración de la petición                                                              |
| `method`, `colo`, `cfRay` | Método HTTP, centro de datos y Ray ID de Cloudflare                                  |

Ejemplo:

```json
{
  "requestId": "01a1f8d0-b233-7c87-b8a2-39146f2a7b1d",
  "method": "GET",
  "route": "/api/health",
  "status": 200,
  "durationMs": 58,
  "colo": "MAD",
  "level": "info",
  "event": "http_request",
  "time": "2026-11-20T11:56:29.166Z"
}
```

## Campos prohibidos

Nunca se registran contraseñas, tokens, semillas TOTP, `chat_id` ni contenido de usuario (§3.5).
El logger sustituye por `"[REDACTED]"`, a cualquier profundidad:

- Claves que **contienen**: `password`, `passwd`, `secret`, `token`, `authorization`, `cookie`,
  `totp`, `apikey`, `chatid`, `recoverycode`, `signedurl`, `privatekey`, `credential`, `session`.
- Claves **exactas**: `otp`, `seed`, `email`, `phone`, `ip`, `title`, `notes`, `description`,
  `location`, `body`, `content`, `summary`, `text`, `comment`, `filename`.

La comparación ignora mayúsculas, guiones y guiones bajos (`chat_id` = `chatId`). Además:

- Los mensajes de error pasan por `safeErrorMessage`, que elimina URLs (pueden llevar firmas).
- Los errores se registran como `{ name, message }`; la traza solo en `unhandled_error`.
- El `requestId` lo genera siempre la API: se ignora el `X-Request-Id` del cliente.

La redacción es una red de seguridad, no una licencia: no pases esos datos al logger.

## Consultas útiles

En _Observability → Logs_ (Query Builder):

- Errores de la API: `event = "http_request" AND status >= 500`
- Fallos del backup: `event = "system_backup_failed"`
- Violaciones de CSP (antes de pasar a bloqueo en F7-08): `event = "csp_violation"`, agrupado por
  `directive` y `blocked`.
