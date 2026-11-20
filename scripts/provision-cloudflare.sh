#!/usr/bin/env bash
# F0-06 · Crea los recursos de Cloudflare de producción (D1, R2, Queues) y sus reglas de ciclo de
# vida. No hay staging (ADR-0003).
#
# Uso:   ./scripts/provision-cloudflare.sh
# Antes: `pnpm --filter @delyra/api exec wrangler login` (o CLOUDFLARE_API_TOKEN con permisos de edición).
#
# Es idempotente en la práctica: si un recurso ya existe, Wrangler lo indica y el script sigue.
# Al terminar, copia el `database_id` que imprime Wrangler en apps/api/wrangler.jsonc
# (env.production.d1_databases[0].database_id y vars.D1_DATABASE_ID). Ver docs/runbooks/recursos-cloudflare.md.
set -uo pipefail

D1_NAME="delyra-prod"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
wrangler() { (cd "$ROOT/apps/api" && pnpm exec wrangler "$@"); }

step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

step "D1 ${D1_NAME} (jurisdicción eu)"
wrangler d1 create "$D1_NAME" --jurisdiction eu || true

for bucket in backups attachments imports; do
  step "R2 delyra-${bucket} (jurisdicción eu)"
  wrangler r2 bucket create "delyra-${bucket}" --jurisdiction eu || true
done

step "Ciclo de vida: backups diarios del sistema, 30 días (F0-14)"
wrangler r2 bucket lifecycle add "delyra-backups" system-daily-30d "system/daily/" \
  --expire-days 30 --jurisdiction eu --force || true

step "Ciclo de vida: importaciones temporales, 7 días (F5-02)"
wrangler r2 bucket lifecycle add "delyra-imports" imports-7d "" \
  --expire-days 7 --abort-multipart-days 1 --jurisdiction eu --force || true

step "Ciclo de vida: subidas multiparte abandonadas en adjuntos, 1 día"
wrangler r2 bucket lifecycle add "delyra-attachments" abort-multipart-1d "" \
  --abort-multipart-days 1 --jurisdiction eu --force || true

for queue in "delyra-notifications" "delyra-notifications-dlq"; do
  step "Queue ${queue}"
  wrangler queues create "$queue" || true
done

cat <<EOF

Hecho. Pasos siguientes (docs/runbooks/recursos-cloudflare.md):
  1. Copia el database_id de ${D1_NAME} en apps/api/wrangler.jsonc (env.production).
  2. Rellena vars.CF_ACCOUNT_ID y vars.D1_DATABASE_ID de env.production.
  3. pnpm cf-typegen && pnpm db:migrate:prod
  4. Tras el primer despliegue, carga los secretos del Worker:
       cd apps/api
       pnpm exec wrangler secret put D1_EXPORT_API_TOKEN --env production
       pnpm exec wrangler secret put LOG_PSEUDONYM_KEY --env production
EOF
