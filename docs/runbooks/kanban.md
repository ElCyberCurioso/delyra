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

## Alertas de tarjetas

Usan el mismo planificador que los eventos (ADR-0006). Si una alerta no llega, comprobar en
`reminders` la fila con `target_type = 'card'` y su `next_fire_at`; una tarjeta terminada o
archivada queda con `status = 'done'`.
