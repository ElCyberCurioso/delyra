# Delyra

Calendario (`delyra.app`) y kanban (`work.delyra.app`) multiusuario sobre Cloudflare Workers, con
sesión común, 2FA obligatorio (con llaves de acceso como alternativa al código), alertas por
Telegram, sincronización con Google Calendar, reuniones de Teams en los tableros y backups.

Las decisiones de arquitectura están en [`docs/decisiones/`](docs/decisiones/) y los planes de las
fases más recientes en `docs/plan-android.md` y `docs/plan-teams.md`.

## Arquitectura

```
navegador ──► delyra.app       ─► Worker delyra-calendar ─┐  Static Assets (SPA + _headers)
          └─► work.delyra.app  ─► Worker delyra-work     ─┤  /api/* por Service Binding
                                                          ▼
                                            Worker delyra-api (Hono)
                                     D1 · R2 · Queues · Workflows · Cron
```

Tres Workers (ADR-0002). Solo las SPA tienen dominio; el `api` no es accesible desde Internet
(`workers_dev: false`) y recibe las peticiones `/api/*` de las SPA por Service Binding.

| Ruta              | Contenido                                                          |
| ----------------- | ------------------------------------------------------------------ |
| `apps/api`        | Worker `api`: rutas Hono, consumidor de Queues, Workflows, Drizzle |
| `apps/calendar`   | Worker `web-calendar`: SPA del calendario (login, ajustes, admin)  |
| `apps/work`       | Worker `web-work`: SPA del kanban                                  |
| `apps/android`    | App nativa de Android (Gradle, Kotlin y Compose), ADR-0016         |
| `packages/shared` | `@delyra/shared`: esquemas Zod, tipos, constantes, utilidades      |
| `packages/ui`     | `@delyra/ui`: componentes, tema y layout comunes (shadcn/ui)       |
| `docs/`           | ADRs, runbooks, observabilidad                                     |
| `e2e/`            | Tests Playwright                                                   |
| `scripts/`        | Aprovisionamiento de Cloudflare                                    |

## Requisitos

- Node.js **26 LTS** (`.nvmrc`; funciona desde 22.12).
- pnpm **12**, activado con Corepack: `corepack enable pnpm`.
- Para desplegar o crear recursos: cuenta de Cloudflare en Workers Paid y `wrangler login`.

## Arranque local

```sh
corepack enable pnpm
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # opcional en F0
pnpm db:migrate:local                              # D1 local en .wrangler/state
pnpm invite --email tu@correo.com --role admin --local   # enlace de registro local
pnpm dev                                           # calendario :5173 y trabajo :5174
```

Abre el enlace que imprime `pnpm invite`, crea la cuenta y configura el TOTP: después ya puedes
entrar en las dos apps. El primer administrador de producción se crea igual, sin `--local`
(`docs/runbooks/dominios-y-acceso.md`).

`pnpm dev` arranca las dos SPA con Vite y `@cloudflare/vite-plugin`. Cada una ejecuta el Worker
`api` como auxiliar, con D1, R2 y Queues locales (Miniflare) compartidos en `.wrangler/state`.
Abre <http://localhost:5173> y <http://localhost:5174>: la tarjeta «Estado de la plataforma»
consulta `/api/health`.

También puedes arrancar solo una app (`pnpm dev:calendar`, `pnpm dev:work`) o solo la API
(`pnpm --filter @delyra/api dev`, en <http://localhost:8787/api/health>).

## Scripts

| Script                  | Qué hace                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| `pnpm dev`              | Las dos SPA con la API local                                       |
| `pnpm build`            | Build de las SPA y bundle de la API (`wrangler --dry-run`)         |
| `pnpm lint`             | ESLint (con tipos) en todo el repositorio                          |
| `pnpm typecheck`        | TypeScript en todos los paquetes y en `e2e/`                       |
| `pnpm test`             | Vitest: API en el runtime real de Workers, UI con jsdom + MSW      |
| `pnpm e2e`              | Playwright (arranca las dos SPA si no hay URL de entorno)          |
| `pnpm format`           | Prettier                                                           |
| `pnpm cf-typegen`       | Regenera `worker-configuration.d.ts` tras cambiar `wrangler.jsonc` |
| `pnpm db:generate`      | Genera una migración SQL desde `apps/api/src/db/schema.ts`         |
| `pnpm db:migrate:local` | Aplica las migraciones a la D1 local                               |
| `pnpm db:migrate:prod`  | Aplica las migraciones a la D1 de producción                       |
| `pnpm invite`           | Crea una invitación en D1 (`--local` para la local)                |
| `pnpm telegram:setup`   | Configura el bot de Telegram de producción (secretos y webhook)    |
| `pnpm ci:status`        | Estado del CI y del despliegue de un commit (`--wait` espera)      |

## Entornos

| Entorno    | Calendario              | Trabajo                   | Cómo se despliega                                  |
| ---------- | ----------------------- | ------------------------- | -------------------------------------------------- |
| local      | `http://localhost:5173` | `http://localhost:5174`   | `pnpm dev`                                         |
| producción | `https://delyra.app`    | `https://work.delyra.app` | Automático tras cada push a `main` con CI en verde |

No hay entorno de staging (ADR-0003): lo que se valida en local y en CI se despliega directamente
en producción, solo y en cuanto el CI de `main` termina en verde (docs/runbooks/despliegue.md). Las URL exactas de cada
entorno están en `packages/shared/src/app-origins.json`.

## Documentación

- [Contribuir](CONTRIBUTING.md): ramas, commits, Definition of Done y reglas de seguridad.
- [ADR-0001 · Stack y versiones](docs/decisiones/ADR-0001-stack-y-versiones.md)
- [ADR-0002 · Arquitectura de tres Workers](docs/decisiones/ADR-0002-arquitectura-tres-workers.md)
- [ADR-0003 · Sin entorno de staging](docs/decisiones/ADR-0003-sin-staging.md)
- [Runbook · Despliegue y vuelta atrás](docs/runbooks/despliegue.md)
- [Runbook · Recursos de Cloudflare](docs/runbooks/recursos-cloudflare.md)
- [Runbook · Dominios y acceso](docs/runbooks/dominios-y-acceso.md)
- [Runbook · Backup diario del sistema](docs/runbooks/backup-sistema.md)
- [ADR-0016 · App de Android](docs/decisiones/ADR-0016-app-android.md)
- [Runbook · App de Android](docs/runbooks/android.md)
- [Observabilidad y logs](docs/observabilidad.md)
