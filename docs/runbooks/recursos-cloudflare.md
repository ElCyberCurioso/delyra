# Runbook · Recursos de Cloudflare (F0-06)

Crea D1, R2 y Queues de producción y conecta sus identificadores con el código. No hay staging
(ADR-0003).

**Requisitos:** P-01 y P-03 hechos (zona `delyra.app` activa, cuenta en Workers Paid) y sesión de
Wrangler (`pnpm --filter @delyra/api exec wrangler login`) o `CLOUDFLARE_API_TOKEN` con permisos de
edición. En el plan Workers Free el número de bases D1 por cuenta es limitado; si `wrangler d1
create` responde «maximum number of D1 databases», hace falta Workers Paid o liberar una base.

## 1. Crear los recursos

```sh
./scripts/provision-cloudflare.sh
```

| Recurso                | Nombre                                 |
| ---------------------- | -------------------------------------- |
| D1 (jurisdicción `eu`) | `delyra-prod`                          |
| R2 (jurisdicción `eu`) | `delyra-{backups,attachments,imports}` |
| Queues                 | `delyra-notifications` + `-dlq`        |

Reglas de ciclo de vida que crea el script:

| Bucket               | Regla                | Efecto                                       |
| -------------------- | -------------------- | -------------------------------------------- |
| `delyra-backups`     | `system-daily-30d`   | Borra `system/daily/*` a los 30 días (F0-14) |
| `delyra-imports`     | `imports-7d`         | Borra todo a los 7 días (F5-02)              |
| `delyra-attachments` | `abort-multipart-1d` | Aborta subidas multiparte abandonadas        |

Las reglas de `weekly/` y `monthly/` llegan con F6-08.

Los Workflows (`delyra-system-backup` y, desde F5-02, `delyra-import`) no se crean a mano: los
crea `wrangler deploy` a partir de `apps/api/wrangler.jsonc`.

## 2. Conectar los identificadores

En `apps/api/wrangler.jsonc`, dentro de `env.production`:

1. `d1_databases[0].database_id` ← el UUID que imprime `wrangler d1 create`.
2. `vars.D1_DATABASE_ID` ← el mismo UUID (lo usa el backup para la API REST).
3. `vars.CF_ACCOUNT_ID` ← el Account ID (`pnpm --filter @delyra/api exec wrangler whoami`).

Ninguno de los tres es secreto. Después:

```sh
pnpm cf-typegen
pnpm db:migrate:prod
```

## 3. Secretos de GitHub

En _Settings → Secrets and variables → Actions → **Secrets**_ (no _Variables_), a nivel de
repositorio o en el Environment `production`:

| Secreto                 | Origen             |
| ----------------------- | ------------------ |
| `CLOUDFLARE_API_TOKEN`  | Token de CI (P-05) |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID (P-05)  |

Conviene que el Environment `production` tenga **revisores obligatorios** (P-04). El despliegue solo
se lanza a mano (_Actions → Deploy → Run workflow_, docs/runbooks/despliegue.md).

El workflow empieza con `scripts/check-deploy-config.mjs`, que falla con la lista de lo que falta
(secretos, identificadores de relleno o dominios que no coinciden) sin imprimir ningún valor. Puedes
ejecutarlo en local:

```sh
node scripts/check-deploy-config.mjs
```

## 4. Secretos del Worker (tras el primer despliegue)

```sh
cd apps/api
pnpm exec wrangler secret put D1_EXPORT_API_TOKEN --env production   # token de P-06
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | pnpm exec wrangler secret put LOG_PSEUDONYM_KEY --env production
```

La Fase 1 añade `FIELD_ENCRYPTION_KEY_V1` y `TURNSTILE_SECRET_KEY` (ver
`docs/runbooks/dominios-y-acceso.md`). La comprobación previa del despliegue lista los que falten.

Los valores se escriben en el terminal (o se generan y se envían directamente), nunca en el
repositorio ni en el chat. Hasta que estén cargados, el backup diario falla y lo registra.

## 5. Comprobar

- Panel → D1: la base aparece con _Jurisdiction: EU_ y la tabla `system_backup_runs`.
- Panel → R2: los tres buckets en _EU_, con sus reglas en _Settings → Object lifecycle rules_.
- Tras el primer despliegue: `https://delyra.app/api/health` responde `"status": "ok"`.
