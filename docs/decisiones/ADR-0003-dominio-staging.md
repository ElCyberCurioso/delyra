# ADR-0003 · Staging fuera del dominio de producción (workers.dev)

- **Estado:** aceptada (revisada el 2026-11-20: staging en `workers.dev` en lugar de un segundo dominio)
- **Fecha:** 2026-11-20
- **Tareas:** P-02, F0-11, F1-04

## Contexto

La sesión es común a las dos apps, así que la cookie de producción se emite con
`Domain=delyra.app`. El navegador la envía a **cualquier** subdominio de `delyra.app`. Si staging
viviera en `staging.delyra.app`, las sesiones reales de producción llegarían a un entorno con
código no publicado, otra base de datos y controles más laxos. Staging tiene que vivir en otro
dominio registrable.

El plan proponía registrar un segundo dominio (P-02, p. ej. `delyra-stg.app`). Se ha decidido no
comprarlo por ahora.

## Decisión

Staging se sirve en el subdominio `workers.dev` de la cuenta:

| Elemento         | Producción                        | Staging                                                         |
| ---------------- | --------------------------------- | --------------------------------------------------------------- |
| Calendario       | `https://delyra.app`              | `https://delyra-calendar-staging.<subdominio>.workers.dev`      |
| Kanban           | `https://work.delyra.app`         | `https://delyra-work-staging.<subdominio>.workers.dev`          |
| Cookie de sesión | `__Secure-sid; Domain=delyra.app` | `__Secure-sid; Domain=<subdominio>.workers.dev`                 |
| Acceso           | Público (salvo `/admin`)          | Cloudflare Access en el `workers.dev` de cada Worker de staging |

- `workers.dev` está en la _Public Suffix List_: `<subdominio>.workers.dev` es un dominio
  registrable propio, así que la cookie de producción nunca llega a staging, y la de staging se
  puede compartir entre sus dos SPA con `Domain=<subdominio>.workers.dev`.
- Solo los Workers de las SPA de staging tienen `workers_dev: true`. El `api` de staging sigue sin
  ninguna entrada pública (ADR-0002).
- Los orígenes están en `packages/shared/src/app-origins.json` (lista blanca de `Origin` y de
  `next`). El workflow de despliegue y `scripts/check-deploy-config.mjs` leen el mismo fichero; la
  comprobación previa verifica contra la API que el subdominio coincide con el de la cuenta.

## Consecuencias

- **Email (F1-12, P-07).** Email Service solo envía desde dominios de la cuenta, y `workers.dev`
  no lo es. En staging habrá que usar el dominio de producción con un remitente propio
  (p. ej. `no-reply-staging@delyra.app`) o un `Mailer` que solo registre el envío. Se decide en F1-12.
- **Google OAuth (F5-04, P-11).** `workers.dev` no se puede verificar como dominio propio en
  Google. Hay que comprobar en F5-04 si Google acepta la `redirect_uri` de staging; si no, la
  importación por OAuth solo se probará en producción (las vías ICS e iCal no dependen de esto).
- **Webhook de Telegram (F3-03).** Access bloquea cualquier petición sin identidad, incluida la de
  Telegram. Habrá que añadir una aplicación de Access con política _Bypass_ solo para
  `/api/telegram/webhook` (el webhook ya se protege con su cabecera secreta).
- **Cookie compartida.** Cualquier otro Worker de la cuenta en `workers.dev` recibiría la cookie de
  staging. Mientras la cuenta solo aloje Delyra, el riesgo es bajo.
- `workers.dev` se trata como sitio del plan Free y no admite reglas de zona (WAF, redirecciones).
  Para staging es suficiente.
- **Salida.** Si más adelante se registra un dominio para staging, basta con cambiar
  `app-origins.json`, poner `routes` en `env.staging` de los dos `wrangler.jsonc` y quitar
  `workers_dev: true`.
