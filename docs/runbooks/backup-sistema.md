# Runbook · Backup diario del sistema (F0-14)

## Cómo funciona

- El binding `SYSTEM_BACKUP` (Workflow `SystemBackupWorkflow`, `apps/api/src/jobs/system-backup.ts`)
  tiene un `schedules` en `wrangler.jsonc`: **02:30 UTC** en staging y **02:00 UTC** en producción.
- Cada ejecución:
  1. Registra el inicio en la tabla `system_backup_runs`.
  2. Pide una exportación de D1 por la API REST (`output_format: "polling"`) con el secreto
     `D1_EXPORT_API_TOKEN` (permiso solo sobre D1, P-06).
  3. Espera a que el volcado esté listo (reintentos cada 15 s, hasta 10 min) y lo copia en
     `delyra-backups[-staging]` → `system/daily/AAAA-MM-DD.sql`.
  4. Registra el resultado (`succeeded` con clave y tamaño, o `failed` con el error saneado).
- La regla de ciclo de vida `system-daily-30d` borra los volcados con más de 30 días.
- Los errores definitivos (credenciales, permisos, exportación fallida) no se reintentan; los
  transitorios (429, 5xx) sí.

## Comprobar que funciona

```sh
cd apps/api
# Últimas ejecuciones
pnpm exec wrangler d1 execute DB --env staging --remote \
  --command "SELECT id, status, r2_key, size_bytes, error, datetime(started_at/1000,'unixepoch') AS inicio FROM system_backup_runs ORDER BY started_at DESC LIMIT 5"
# Descargar el volcado de un día (la clave sale de la consulta anterior)
pnpm exec wrangler r2 object get delyra-backups-staging/system/daily/2026-11-20.sql \
  --jurisdiction eu --remote --file ./backup-2026-11-20.sql
```

La lista completa de volcados está en el panel: _R2 → delyra-backups-staging → system/daily/_.
Borra la copia descargada cuando termines: contiene todos los datos del entorno.

En el panel: _Workers & Pages → Workflows → delyra-system-backup-staging_ muestra cada instancia
y el resultado de cada paso. Los logs llevan `event: "system_backup_succeeded"` o
`"system_backup_failed"`.

## Lanzarlo a mano

```sh
cd apps/api
pnpm exec wrangler workflows trigger delyra-system-backup-staging
```

Un lanzamiento manual del mismo día sobrescribe el volcado de ese día.

## Si falla

1. Mira el error en `system_backup_runs.error` o en el paso fallido del Workflow.
2. `La API de D1 rechazó la exportación (HTTP 401/403)`: token caducado o sin permiso sobre esa
   base de datos. Crea uno nuevo (P-06) y cárgalo con `wrangler secret put D1_EXPORT_API_TOKEN`.
3. `Exportación de D1 no configurada`: faltan `CF_ACCOUNT_ID` o `D1_DATABASE_ID` en
   `wrangler.jsonc` del entorno, o el secreto.
4. Relánzalo a mano y comprueba el objeto en R2.

El aviso por email al administrador se conecta en F1-12. Mientras tanto, revisa la tabla o el
panel de Workflows. La restauración (Time Travel o desde un volcado) se documenta en F6-07.
