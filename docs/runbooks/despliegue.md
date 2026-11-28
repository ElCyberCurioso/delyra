# Runbook · Despliegue y vuelta atrás (F0-10)

Solo hay producción (ADR-0003). El despliegue es automático: cada push a `main` se despliega en
cuanto su CI termina en verde. Se trabaja directamente sobre `main`, sin PR (CONTRIBUTING.md).

## Desplegar

1. `git push origin main`. El CI (`ci.yml`) se lanza con el push.
2. Si el CI termina en verde, el workflow **Deploy** se lanza solo (`workflow_run`) y despliega ese
   commit. Si el CI falla, no se despliega nada: se corrige con otro push.
3. Desde la terminal, sin navegador: `pnpm ci:status --wait` espera al CI y al despliegue del
   último commit y sale con error si algo falla (`pnpm ci:status <commit>` para otro).

Solo se despliega el último commit de `main`. Si llega otro push mientras el CI de uno sigue en
marcha, ese CI se cancela; y si un CI en verde ya no es el último de `main`, su despliegue se salta
(el commit nuevo, que lo incluye, se despliega con su propio CI). Un despliegue a medias nunca se
corta: el siguiente espera a que termine.

Para volver a desplegar sin cambios (por ejemplo, tras arreglar un secreto): _Actions → Deploy →
Run workflow_, o `gh workflow run deploy.yml` con la CLI de GitHub. No pongas revisores obligatorios
en el Environment `production`: el despliegue automático se quedaría esperando la aprobación.

El job hace, en este orden:

1. Comprueba que CI está en verde para ese commit. A mano, si aún está en marcha, espera hasta 20
   min (2 min si todavía no ha aparecido ninguna ejecución); si termina en otro estado, se para sin
   tocar nada.
2. `scripts/check-deploy-config.mjs`: secretos, IDs de `wrangler.jsonc` y dominios.
3. Migraciones de D1 (`wrangler d1 migrations apply DB --env production --remote`).
4. Despliega `delyra-api`, y después `delyra-calendar` y `delyra-work`.
5. Ejecuta los e2e `@smoke` contra `https://delyra.app` y `https://work.delyra.app`.

## Si algo falla

| Dónde falla              | Estado de producción                         | Qué hacer                                                           |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------- |
| CI o comprobación previa | Sin cambios                                  | Corrige lo que indica el error y haz otro push                      |
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
