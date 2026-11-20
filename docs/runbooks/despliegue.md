# Runbook · Despliegue y vuelta atrás (F0-10)

Solo hay producción (ADR-0003). El despliegue es manual.

## Desplegar

1. Comprueba que el workflow **CI** está en verde para el último commit de `main`.
2. _Actions → Deploy → Run workflow_ (rama `main`).
3. Si el Environment `production` tiene revisores, aprueba el despliegue.

El job hace, en este orden:

1. Comprueba que CI está en verde para ese commit.
2. `scripts/check-deploy-config.mjs`: secretos, IDs de `wrangler.jsonc` y dominios.
3. Migraciones de D1 (`wrangler d1 migrations apply DB --env production --remote`).
4. Despliega `delyra-api`, y después `delyra-calendar` y `delyra-work`.
5. Ejecuta los e2e `@smoke` contra `https://delyra.app` y `https://work.delyra.app`.

## Si algo falla

| Dónde falla              | Estado de producción                         | Qué hacer                                                           |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------- |
| CI o comprobación previa | Sin cambios                                  | Corrige lo que indica el error y vuelve a lanzar                    |
| Migraciones              | Sin cambios de código; migración a medias    | Revisa la tabla `d1_migrations` y el SQL; Time Travel si hace falta |
| Despliegue de un Worker  | Mezcla de versiones (api nueva, SPA antigua) | Vuelve a lanzar; si persiste, rollback del api                      |
| E2E de humo              | Versión nueva desplegada                     | Rollback de los Workers afectados (abajo)                           |

## Vuelta atrás de los Workers

```sh
cd apps/api
pnpm exec wrangler rollback --name delyra-api          # vuelve a la versión anterior
cd ../calendar && pnpm exec wrangler rollback --name delyra-calendar
cd ../work && pnpm exec wrangler rollback --name delyra-work
```

`wrangler deployments list --name <worker>` muestra el historial. El rollback no deshace las
migraciones de D1: por eso deben ser compatibles con la versión anterior del código.

## Vuelta atrás de los datos (D1 Time Travel)

```sh
cd apps/api
pnpm exec wrangler d1 time-travel info DB --env production                   # bookmark actual
pnpm exec wrangler d1 time-travel restore DB --env production --timestamp=<unix>
```

Restaurar sobrescribe la base de datos completa; apunta antes el bookmark actual para poder
deshacerlo. El procedimiento completo y el simulacro llegan con F6-07.
