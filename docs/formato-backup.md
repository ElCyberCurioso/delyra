# Formato de copia de seguridad de Delyra (v1)

Especificación del fichero que genera _Ajustes → Copias de seguridad_ (F6-01). Lo produce
`apps/api/src/services/user-backups.ts` y lo valida `apps/api/src/lib/backup-format.ts` con el
esquema Zod `backupDataV1Schema` de `packages/shared/src/schemas/backups.ts`.

## Contenedor

Un `.zip` con:

| Entrada            | Contenido                                              |
| ------------------ | ------------------------------------------------------ |
| `backup.json`      | Cabecera, checksum y datos (abajo). Siempre presente.  |
| `attachments/<id>` | Los bytes de cada adjunto del kanban, uno por fichero. |

Las entradas van comprimidas con deflate (nivel 0 para los adjuntos). Para restaurar también se
acepta un `backup.json` suelto, sin adjuntos.

## `backup.json`

```json
{
  "format": "delyra-backup",
  "format_version": 1,
  "exported_at": "2026-11-22T13:00:00.000Z",
  "app_version": "6f6e5f0c-…",
  "checksum": { "algorithm": "sha256", "value": "<64 hex>" },
  "data": { … }
}
```

- `checksum.value` es el SHA-256 (hexadecimal) de `JSON.stringify(data)`: el texto exacto de
  `data` tal como lo serializa JavaScript. Al leer se vuelve a serializar el `data` recibido y se
  compara; cualquier cambio lo invalida.
- `app_version` es la versión del Worker que la generó (informativa).
- Una `format_version` mayor que la que entiende el servidor se rechaza. Las versiones anteriores
  se migran a la actual antes de validar (`migrateBackupData`).

## `data`

Todos los instantes son milisegundos desde epoch (UTC). Los `id` son referencias **internas** a la
copia (cadenas de hasta 64 caracteres): al restaurar se generan ids nuevos y el propietario es
siempre la persona que restaura.

| Clave            | Filas                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `profile`        | `timeZone`, `locale`, `weekStart`                                                                 |
| `calendars`      | `id`, `name`, `color`, `kind`, `visible`, `position`                                              |
| `events`         | Campos del evento (ver `events` en ADR-0005), con `exdates` como lista y las excepciones al final |
| `eventReminders` | `eventId`, `offsetMinutes`, `channel` (la próxima alerta se recalcula al restaurar)               |
| `boards`         | `id`, `name`, `template`, `autoarchiveDays`, fechas                                               |
| `columns`        | `id`, `boardId`, `name`, `position`, `wipLimit`, `isDone`, fechas                                 |
| `labels`         | `id`, `boardId`, `name`, `color`                                                                  |
| `cards`          | Campos de la tarjeta (fecha límite, terminada, archivada…)                                        |
| `cardLabels`     | `cardId`, `labelId`                                                                               |
| `cardReminders`  | `cardId`, `offsetMinutes`, `channel`                                                              |
| `checklist`      | `id`, `cardId`, `text`, `done`, `position`                                                        |
| `comments`       | `id`, `cardId`, `body`, fechas, `byOwner` (opcional, F7-04: `false` si lo escribió otra persona)  |
| `activity`       | `id`, `cardId`, `kind`, `data` (JSON en texto), `byOwner` (opcional, igual que en `comments`)     |
| `attachments`    | `id`, `cardId`, `filename`, `contentType`, `size`, `sha256` del contenido                         |

## Qué no se incluye

Contraseña (ni su hash), segundo factor, códigos de recuperación, sesiones, tokens, el chat de
Telegram, el historial de seguridad, las importaciones y las **suscripciones iCal** (su dirección
es secreta; sus calendarios son una copia de Google). Los eventos borrados tampoco.

## Validación al restaurar (F6-09)

Antes de tocar ningún dato se comprueba, por este orden: tamaño (200 MB el zip, 40 MB el JSON),
formato y versión, checksum, esquema y límites de cada campo, que todos los ids sean únicos, que
toda referencia apunte a algo **de la misma copia** (un evento a uno de sus calendarios, una
tarjeta a una columna de su tablero, una etiqueta al mismo tablero…) y el SHA-256 y tamaño de cada
adjunto. Un id de otra cuenta inyectado a mano no existe dentro de la copia, así que se rechaza.
Un adjunto que falta o no coincide se descarta con un aviso; lo demás se restaura.
