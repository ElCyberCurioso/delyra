# ADR-0003 · Dominio separado para staging

- **Estado:** aceptada (el nombre definitivo depende de P-02)
- **Fecha:** 2026-11-20
- **Tareas:** P-02, F0-11, F1-04

## Contexto

La sesión es común a las dos apps, así que la cookie de producción se emite con
`Domain=delyra.app`. El navegador la envía a **cualquier** subdominio de `delyra.app`. Si staging
viviera en `staging.delyra.app`, las sesiones reales de producción llegarían a un entorno con
código no publicado, otra base de datos y controles más laxos.

## Decisión

Staging usa un **dominio registrable distinto**: `delyra-stg.app` (provisional hasta P-02).

| Elemento         | Producción                        | Staging                               |
| ---------------- | --------------------------------- | ------------------------------------- |
| Calendario       | `https://delyra.app`              | `https://delyra-stg.app`              |
| Kanban           | `https://work.delyra.app`         | `https://work.delyra-stg.app`         |
| Cookie de sesión | `__Secure-sid; Domain=delyra.app` | `__Secure-sid; Domain=delyra-stg.app` |
| Acceso           | Público (salvo `/admin`)          | Todo tras Cloudflare Access           |

Los orígenes de cada entorno están en `APP_ORIGINS` (`packages/shared/src/environments.ts`), que es
también la lista blanca de `Origin` y de `next`. Si el dominio definitivo cambia, se actualiza ahí,
en los `wrangler.jsonc` (`routes`), en `.github/workflows/deploy.yml` y en este ADR.

## Consecuencias

- Hay que registrar y mantener un segundo dominio (P-02) y darlo de alta en Email Service (P-07).
- Las cookies, el almacenamiento local y los service workers de staging y producción quedan
  aislados por completo.
- Como `.app` está en la lista de precarga HSTS, ambos dominios solo funcionan por HTTPS.
