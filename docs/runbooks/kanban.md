# Runbook · Kanban (work.delyra.app)

## Migración

La Fase 4 añade `0005_kanban.sql` (solo tablas nuevas). En producción:

```sh
pnpm db:migrate:prod
```

El workflow de despliegue (`deploy.yml`) ya la aplica antes de publicar el Worker `api`; a mano,
hay que hacerlo antes de desplegar.

## Adjuntos en R2

- Bucket `delyra-attachments` (UE), binding `ATTACHMENTS`. Claves:
  `boards/<usuario>/<tablero>/<tarjeta>/<adjunto>`.
- Para ver lo que ocupa un usuario: `wrangler r2 object list delyra-attachments --prefix boards/<usuario>/`
  (sin `--remote` lista el bucket local).
- Un 415 al subir significa que el contenido no coincide con ningún tipo admitido (ADR-0007); un
  413, que supera 10 MB.

## Autoarchivado

- Cron `0 3 * * *` en el Worker `api` (además del de cada minuto). En los logs: evento
  `autoarchive_run` con el número de tarjetas archivadas, o `autoarchive_failed`.
- Para lanzarlo a mano en local: `wrangler dev --test-scheduled` (en `apps/api`) y
  `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+3+*+*+*"`.

## Tableros compartidos y en vivo (F7-04, F7-05)

- Migraciones `0009_board_sharing.sql` (miembros, invitaciones y autoría) y
  `0010_backfill_authors.sql` (atribuye al dueño los comentarios y la actividad anteriores). El
  despliegue las aplica con `pnpm db:migrate:prod` antes de publicar el Worker `api`.
- El Durable Object `BoardRoom` (uno por tablero) lo crea `wrangler deploy` a partir de la
  migración `v1` de `apps/api/wrangler.jsonc`; no hay nada que crear a mano.
- Para ver los miembros de un tablero:
  `wrangler d1 execute DB --env production --remote --command "SELECT user_id, role FROM board_members WHERE board_id = '<tablero>'"`.
- Si el tiempo real no llega: en los logs, `GET /api/boards/:id/live` debe responder 101 (403 =
  `Origin` no permitido; 404 = sin acceso; 426 = no era un WebSocket) y `board_live_notify_failed`
  indica que no se pudo avisar a la sala. Sin canal la app sigue funcionando: refresca al volver a
  la pestaña.
- Quitar el acceso a alguien cierra al momento sus pestañas abiertas en ese tablero.

## Alertas de tarjetas

Usan el mismo planificador que los eventos (ADR-0006). Si una alerta no llega, comprobar en
`reminders` la fila con `target_type = 'card'` y su `next_fire_at`; una tarjeta terminada o
archivada queda con `status = 'done'`.

## Tipos de tarjeta y tareas que dependen de otra persona

- Cada tarjeta tiene un **tipo** (tarea, reunión, llamada, correo, gestión o nota) que se elige al
  crearla o en su detalle, y se ve con su icono en la tarjeta. Las reuniones de Teams entran como
  «reunión».
- Una columna puede marcarse como **«Tareas que dependen de otra persona»** (ajustes de la
  columna). Al llevar una tarjeta a ella —arrastrando, con el teclado o desde el detalle— se pide
  a quién se le pasa (un nombre libre, no tiene que usar Delyra) y la tarjeta muestra «Depende de
  …». El nombre se puede cambiar o quitar desde el detalle.
- Migración 0018: `cards.kind`, `cards.assignee` y `board_columns.delegated`, solo columnas nuevas
  (sin reconstruir `cards`, cuyo borrado arrastraría en cascada checklists, comentarios y
  adjuntos).
