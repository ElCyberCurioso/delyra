#!/usr/bin/env bash
# F0-06 · Crea los recursos de Cloudflare de un entorno (D1, R2, Queues) y sus reglas de ciclo de vida.
#
# Uso:   ./scripts/provision-cloudflare.sh staging|production
# Antes: `pnpm exec wrangler login` (o CLOUDFLARE_API_TOKEN con permisos de edición).
#
# Es idempotente en la práctica: si un recurso ya existe, Wrangler lo indica y el script sigue.
# Al terminar, copia el `database_id` que imprime Wrangler en apps/api/wrangler.jsonc
# (env.<entorno>.d1_databases[0].database_id y vars.D1_DATABASE_ID). Ver docs/runbooks/recursos-cloudflare.md.
set -uo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  staging) SUFFIX="-staging"; D1_NAME="delyra-staging" ;;
  production) SUFFIX=""; D1_NAME="delyra-prod" ;;
  *) echo "Uso: $0 staging|production" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
wrangler() { (cd "$ROOT/apps/api" && pnpm exec wrangler "$@"); }

step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

step "D1 ${D1_NAME} (jurisdicción eu)"
wrangler d1 create "$D1_NAME" --jurisdiction eu || true

for bucket in backups attachments imports; do
  step "R2 delyra-${bucket}${SUFFIX} (jurisdicción eu)"
  wrangler r2 bucket create "delyra-${bucket}${SUFFIX}" --jurisdiction eu || true
done

step "Ciclo de vida: backups diarios del sistema, 30 días (F0-14)"
wrangler r2 bucket lifecycle add "delyra-backups${SUFFIX}" system-daily-30d "system/daily/" \
  --expire-days 30 --jurisdiction eu --force || true

step "Ciclo de vida: importaciones temporales, 7 días (F5-02)"
wrangler r2 bucket lifecycle add "delyra-imports${SUFFIX}" imports-7d "" \
  --expire-days 7 --abort-multipart-days 1 --jurisdiction eu --force || true

step "Ciclo de vida: subidas multiparte abandonadas en adjuntos, 1 día"
wrangler r2 bucket lifecycle add "delyra-attachments${SUFFIX}" abort-multipart-1d "" \
  --abort-multipart-days 1 --jurisdiction eu --force || true

for queue in "delyra-notifications${SUFFIX}" "delyra-notifications-dlq${SUFFIX}"; do
  step "Queue ${queue}"
  wrangler queues create "$queue" || true
done

cat <<EOF

Hecho. Pasos siguientes (docs/runbooks/recursos-cloudflare.md):
  1. Copia el database_id de ${D1_NAME} en apps/api/wrangler.jsonc (env.${ENVIRONMENT}).
  2. Rellena vars.CF_ACCOUNT_ID y vars.D1_DATABASE_ID de env.${ENVIRONMENT}.
  3. Carga los secretos:
       cd apps/api
       pnpm exec wrangler secret put D1_EXPORT_API_TOKEN --env ${ENVIRONMENT}
       pnpm exec wrangler secret put LOG_PSEUDONYM_KEY --env ${ENVIRONMENT}
  4. pnpm cf-typegen && pnpm db:migrate:$([ "$ENVIRONMENT" = production ] && echo prod || echo staging)
EOF
