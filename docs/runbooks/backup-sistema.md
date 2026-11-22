# Runbook · Backup diario del sistema (F0-14)

## Cómo funciona

- El binding `SYSTEM_BACKUP` (Workflow `SystemBackupWorkflow`, `apps/api/src/jobs/system-backup.ts`)
  tiene un `schedules` en `wrangler.jsonc`: **02:00 UTC** todos los días (solo producción).
- Cada ejecución:
  1. Registra el inicio en la tabla `system_backup_runs`.
  2. Pide una exportación de D1 por la API REST (`output_format: "polling"`) con el secreto
     `D1_EXPORT_API_TOKEN` (permiso solo sobre D1, P-06).
  3. Espera a que el volcado esté listo (reintentos cada 15 s, hasta 10 min) y lo copia en
     `delyra-backups` → `system/daily/AAAA-MM-DD.sql`.
  4. Los domingos lo copia también a `system/weekly/AAAA-MM-DD.sql` y el día 1 de cada mes a
     `system/monthly/AAAA-MM.sql` (F6-08).
  5. Registra el resultado (`succeeded` con clave y tamaño, o `failed` con el error saneado). Si
     falla, avisa por email a los administradores (si Email Service está configurado).
- Las reglas de ciclo de vida borran los diarios a los 30 días, los semanales a las 12 semanas y
  los mensuales a los 12 meses.
- El panel de admin (_delyra.app/admin → Backups del sistema_) muestra el último resultado, los
  ficheros de cada nivel y un botón para lanzarlo a mano.
- Los errores definitivos (credenciales, permisos, exportación fallida) no se reintentan; los
  transitorios (429, 5xx) sí.

## Comprobar que funciona

```sh
cd apps/api
# Últimas ejecuciones
pnpm exec wrangler d1 execute DB --env production --remote \
  --command "SELECT id, status, r2_key, size_bytes, error, datetime(started_at/1000,'unixepoch') AS inicio FROM system_backup_runs ORDER BY started_at DESC LIMIT 5"
# Descargar el volcado de un día (la clave sale de la consulta anterior)
pnpm exec wrangler r2 object get delyra-backups/system/daily/2026-11-20.sql \
  --jurisdiction eu --remote --file ./backup-2026-11-20.sql
```

La lista completa de volcados está en el panel: _R2 → delyra-backups → system/daily/_.
Borra la copia descargada cuando termines: contiene todos los datos del entorno.

En el panel: _Workers & Pages → Workflows → delyra-system-backup_ muestra cada instancia
y el resultado de cada paso. Los logs llevan `event: "system_backup_succeeded"` o
`"system_backup_failed"`.

## Lanzarlo a mano

```sh
cd apps/api
pnpm exec wrangler workflows trigger delyra-system-backup
```

Un lanzamiento manual del mismo día sobrescribe el volcado de ese día.

## Si falla

1. Mira el error en `system_backup_runs.error` o en el paso fallido del Workflow.
2. `La API de D1 rechazó la exportación (HTTP 401/403)`: token caducado o sin permiso sobre esa
   base de datos. Crea uno nuevo (P-06) y cárgalo con `wrangler secret put D1_EXPORT_API_TOKEN`.
3. `Exportación de D1 no configurada`: faltan `CF_ACCOUNT_ID` o `D1_DATABASE_ID` en
   `wrangler.jsonc` del entorno, o el secreto.
4. Relánzalo a mano y comprueba el objeto en R2.

La restauración (Time Travel o desde un volcado) está en docs/runbooks/restauracion.md.
