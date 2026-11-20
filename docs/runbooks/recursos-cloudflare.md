# Runbook · Recursos de Cloudflare (F0-06)

Crea D1, R2 y Queues de un entorno y conecta sus identificadores con el código.

**Requisitos:** P-01 a P-03 hechos (zonas activas, cuenta en Workers Paid) y sesión de Wrangler
(`pnpm --filter @delyra/api exec wrangler login`) o `CLOUDFLARE_API_TOKEN` con permisos de edición.

## 1. Crear los recursos

```sh
./scripts/provision-cloudflare.sh staging
./scripts/provision-cloudflare.sh production
```

| Recurso                | Staging                                         | Producción                             |
| ---------------------- | ----------------------------------------------- | -------------------------------------- |
| D1 (jurisdicción `eu`) | `delyra-staging`                                | `delyra-prod`                          |
| R2 (jurisdicción `eu`) | `delyra-{backups,attachments,imports}-staging`  | `delyra-{backups,attachments,imports}` |
| Queues                 | `delyra-notifications-staging` + `-dlq-staging` | `delyra-notifications` + `-dlq`        |

Reglas de ciclo de vida que crea el script:

| Bucket                | Regla                | Efecto                                       |
| --------------------- | -------------------- | -------------------------------------------- |
| `delyra-backups*`     | `system-daily-30d`   | Borra `system/daily/*` a los 30 días (F0-14) |
| `delyra-imports*`     | `imports-7d`         | Borra todo a los 7 días (F5-02)              |
| `delyra-attachments*` | `abort-multipart-1d` | Aborta subidas multiparte abandonadas        |

Las reglas de `weekly/` y `monthly/` llegan con F6-08.

## 2. Conectar los identificadores

En `apps/api/wrangler.jsonc`, dentro de `env.staging` (y luego `env.production`):

1. `d1_databases[0].database_id` ← el UUID que imprime `wrangler d1 create`.
2. `vars.D1_DATABASE_ID` ← el mismo UUID (lo usa el backup para la API REST).
3. `vars.CF_ACCOUNT_ID` ← el Account ID (panel de Cloudflare → Workers & Pages → Account details).

Ninguno de los tres es secreto. Después:

```sh
pnpm cf-typegen
pnpm db:migrate:staging
```

## 3. Secretos

```sh
cd apps/api
pnpm exec wrangler secret put D1_EXPORT_API_TOKEN --env staging   # token de P-06
pnpm exec wrangler secret put LOG_PSEUDONYM_KEY --env staging     # p. ej. `openssl rand -base64 32`
```

Repite con `--env production`. Los valores se escriben en el terminal, nunca en el repositorio ni
en el chat.

## 4. Comprobar

- Panel → D1: la base aparece con _Jurisdiction: EU_ y la tabla `system_backup_runs`.
- Panel → R2: los tres buckets en _EU_, con sus reglas en _Settings → Object lifecycle rules_.
- Tras el primer despliegue: `https://delyra-stg.app/api/health` responde `"status": "ok"`.
