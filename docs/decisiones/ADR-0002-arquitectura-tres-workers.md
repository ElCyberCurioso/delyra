# ADR-0002 · Arquitectura de tres Workers

- **Estado:** aceptada
- **Fecha:** 2026-11-20
- **Tareas:** F0-03, F0-04, F0-06

## Contexto

Delyra tiene dos aplicaciones en dominios distintos (`delyra.app` y `work.delyra.app`) que
comparten cuentas, sesión y datos. Hay que decidir cómo se reparten frontend y API en Workers.

## Decisión

Tres Workers por entorno:

| Worker            | Dominio           | Contenido                                           |
| ----------------- | ----------------- | --------------------------------------------------- |
| `delyra-calendar` | `delyra.app`      | SPA del calendario (Static Assets) + proxy `/api/*` |
| `delyra-work`     | `work.delyra.app` | SPA del kanban (Static Assets) + proxy `/api/*`     |
| `delyra-api`      | ninguno           | API Hono, consumidor de Queues, Workflows, D1, R2   |

1. **Las SPA reenvían `/api/*` al `api` por Service Binding**
   (`assets.run_worker_first: ["/api/*"]`). La petición conserva URL, método, cabeceras y cookie,
   así que la API es _same-origin_ para el navegador: sin CORS y con cookie `SameSite=Lax`.
2. **El `api` no tiene ninguna entrada pública**: `workers_dev: false`, `preview_urls: false` y sin
   rutas. Solo se llega a él a través de las SPA (y, en staging, tras Cloudflare Access).
3. **El resto de rutas no ejecuta código**: Static Assets sirve la SPA con
   `not_found_handling: "single-page-application"` y las cabeceras de `_headers`, generadas desde
   `@delyra/shared` para que coincidan con las de la API.
4. **Datos en la UE.** D1 se crea con `--jurisdiction eu` (plan §2.1). Por coherencia, los buckets
   de R2 también (`jurisdiction: "eu"`): contienen volcados completos de D1 y adjuntos de usuario.
5. **Las colas solo transportan identificadores.** Los mensajes de `delyra-notifications` llevarán
   ids (alerta, usuario) y una clave de idempotencia; el consumidor lee el resto de D1. Así no hay
   contenido de usuario fuera de D1/R2 y la cola no necesita jurisdicción propia.
6. **Entornos de Wrangler.** El entorno por defecto de cada `wrangler.jsonc` es el local; `staging`
   y `production` declaran sus propios nombres y bindings (no se heredan).

## Alternativas descartadas

- **Un solo Worker con las dos SPA**: obliga a enrutar por host dentro del Worker y mezcla los
  despliegues de ambas apps.
- **API en su propio subdominio (`api.delyra.app`)**: requiere CORS con credenciales y cookies
  `SameSite=None`, y expone otra superficie pública.

## Consecuencias

- En local, cada SPA ejecuta el `api` como _auxiliary worker_ de `@cloudflare/vite-plugin`, con el
  estado compartido en `.wrangler/state`.
- El orden de despliegue es: migraciones → `api` → SPA (las SPA enlazan el `api`).
- Cualquier ruta nueva de la API cuelga de `/api`.
