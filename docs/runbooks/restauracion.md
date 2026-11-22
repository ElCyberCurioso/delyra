# Runbook · Restauración de la plataforma (F6-07)

Cómo recuperar la base de datos de producción (`delyra-prod`) entera. Para recuperar los datos de
**una persona**, basta con su copia de seguridad (_Ajustes → Copias de seguridad_, F6-04).

Hay dos vías:

| Vía                      | Cuándo                                                        | Pérdida máxima                      |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------- |
| **D1 Time Travel**       | Un error reciente (migración mala, borrado masivo): < 30 días | Hasta el minuto elegido             |
| **Volcado SQL desde R2** | La base no se puede usar o Time Travel no llega tan atrás     | Desde el último volcado (02:00 UTC) |

> **Antes de nada:** avisa a los usuarios, y si el problema sigue causando daño, para las
> escrituras desplegando una versión en mantenimiento o revocando el token de CI. Anota la hora
> exacta (UTC) del incidente.

Comandos desde `apps/api`, con sesión de Wrangler con permisos sobre D1 y R2.

## A. D1 Time Travel (restauración en el sitio)

1. Consulta el estado actual y guarda el bookmark de **ahora** (sirve para deshacer la
   restauración):

   ```sh
   pnpm exec wrangler d1 time-travel info DB --env production
   ```

2. Obtén el bookmark del momento al que volver (un minuto antes del incidente):

   ```sh
   pnpm exec wrangler d1 time-travel info DB --env production --timestamp "2026-11-22T09:15:00Z"
   ```

3. Restaura (sustituye **toda** la base; las escrituras posteriores se pierden):

   ```sh
   pnpm exec wrangler d1 time-travel restore DB --env production --bookmark <bookmark>
   ```

4. Comprueba: `/api/health` en verde, inicio de sesión, y un recuento de tablas:

   ```sh
   pnpm exec wrangler d1 execute DB --env production --remote --command \
     "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM cards) AS cards"
   ```

5. Si no era el momento correcto, repite el paso 3 con otro bookmark (incluido el guardado en
   el paso 1).

Las migraciones aplicadas después del bookmark desaparecen con la restauración: vuelve a
desplegar la versión que corresponda a ese esquema o aplica las migraciones de nuevo
(`pnpm db:migrate:prod`).

## B. Desde un volcado SQL de R2 (en una D1 nueva)

Los volcados están en `delyra-backups`: `system/daily/` (30 días), `system/weekly/` (12 semanas) y
`system/monthly/` (12 meses). El panel de admin los lista.

1. Descarga el volcado elegido (contiene todos los datos: bórralo al terminar):

   ```sh
   pnpm exec wrangler r2 object get delyra-backups/system/daily/2026-11-21.sql \
     --jurisdiction eu --remote --file ./restauracion.sql
   ```

2. Crea una base nueva en la UE (**confírmalo antes**: consume una de las bases D1 de la cuenta):

   ```sh
   pnpm exec wrangler d1 create delyra-prod-restaurada --jurisdiction eu
   ```

3. Reordena el volcado y cárgalo. El volcado de D1 crea e inserta tabla por tabla, de modo que
   inserta en tablas hijas antes de crear sus tablas padre y una base vacía lo rechaza («no such
   table: main.users»); el script pone primero todas las tablas, luego los datos y al final los
   índices:

   ```sh
   node ../../scripts/reorder-d1-dump.mjs ./restauracion.sql ./restauracion-ordenada.sql
   pnpm exec wrangler d1 execute delyra-prod-restaurada --remote --file ./restauracion-ordenada.sql
   pnpm exec wrangler d1 execute delyra-prod-restaurada --remote --command "SELECT count(*) FROM users"
   ```

4. Apunta `env.production.d1_databases[0].database_id` (y `vars.D1_DATABASE_ID`) de
   `apps/api/wrangler.jsonc` a la base nueva, aplica las migraciones que falten
   (`pnpm db:migrate:prod`) y despliega (docs/runbooks/despliegue.md).
5. Cuando todo funcione, conserva la base antigua unos días por si hiciera falta y luego bórrala.
   Borra `restauracion.sql` y `restauracion-ordenada.sql`.

## Simulacro (sin tocar producción)

Se hace en local: carga el último volcado en una D1 local vacía y compara los recuentos con
producción. No crea recursos en Cloudflare.

```sh
cd apps/api
pnpm exec wrangler r2 object get delyra-backups/system/daily/<fecha>.sql --jurisdiction eu --remote --file <tmp>/dump.sql
node ../../scripts/reorder-d1-dump.mjs <tmp>/dump.sql <tmp>/ordenado.sql
pnpm exec wrangler d1 execute DB --local --persist-to <tmp>/estado --file <tmp>/ordenado.sql
pnpm exec wrangler d1 execute DB --local --persist-to <tmp>/estado --command "PRAGMA foreign_key_check"
# … recuentos por tabla en local y en --remote, que deben cuadrar con la hora del volcado
pnpm exec wrangler d1 time-travel info DB --env production   # Time Travel disponible
```

Después, borra `<tmp>` entero.

### Registro de simulacros

| Fecha      | Volcado                                 | Resultado                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-22 | `system/daily/2026-11-22.sql` (23,9 KB) | Sin reordenar falla («no such table: main.users»): se añade `scripts/reorder-d1-dump.mjs`. Reordenado: 19 tablas, 52 inserciones y 23 índices cargados en una D1 local vacía, `foreign_key_check` sin errores y recuentos coherentes con producción (1 usuario, 3 calendarios). Time Travel disponible (bookmark actual consultado). |
