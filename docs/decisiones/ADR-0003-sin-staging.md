# ADR-0003 · Sin entorno de staging: solo producción

- **Estado:** aceptada (2026-11-20). Sustituye a la versión anterior de este ADR (staging en un
  dominio propio y, después, en `workers.dev`).
- **Fecha:** 2026-11-20
- **Tareas afectadas:** P-02, P-09, F0-06, F0-10, F0-11, F1-04, §3.4 (DoD), §3.6 y los cierres de fase

## Contexto

El plan preveía staging en un dominio registrable distinto (P-02) para que la cookie de sesión de
producción (`Domain=delyra.app`) nunca llegara a staging. Ese dominio no se ha registrado, la
alternativa en `workers.dev` complicaba email, OAuth y el webhook de Telegram, y la cuenta tiene
un límite de bases de datos D1. Para un proyecto personal, mantener dos entornos remotos cuesta más
de lo que aporta.

## Decisión

Solo hay dos entornos:

| Entorno    | Dónde                                             | Cómo                                               |
| ---------- | ------------------------------------------------- | -------------------------------------------------- |
| Local      | `http://localhost:5173` y `http://localhost:5174` | `pnpm dev`, con D1/R2/Queues de Miniflare          |
| Producción | `https://delyra.app` y `https://work.delyra.app`  | Workflow `Deploy`, tras cada CI en verde de `main` |

- Cada `wrangler.jsonc` tiene el entorno local en el nivel superior, con nombres terminados en
  `-local`, y un único entorno remoto, `production`. Un `wrangler deploy` sin `--env production`
  (o un build sin `CLOUDFLARE_ENV=production`) nunca sobrescribe los Workers de producción.
- `packages/shared/src/app-origins.json` solo tiene `production` y `development`.
- El despliegue es automático: cada push a `main` se despliega cuando su CI termina en verde
  (`workflow_run`), y solo el último commit de `main`. Se puede volver a lanzar a mano. Hasta el
  2026-11-28 era manual (_Actions → Deploy → Run workflow_) y el Environment `production` podía
  pedir aprobación (P-04); ahora no lleva revisores, porque bloquearían el automático.

## Cómo se compensa la falta de staging

1. **CI completo antes de desplegar.** Lint, tipos, tests de la API en el runtime real de Workers
   (D1, R2 y Queues locales) y e2e con Playwright contra las dos SPA arrancadas en local.
2. **Migraciones expand/contract.** Cada migración debe funcionar con el código anterior, porque
   se aplica antes de desplegar el nuevo Worker. Los tests aplican todas las migraciones desde cero.
3. **Humo tras desplegar.** Los e2e `@smoke` (solo lectura) se ejecutan contra producción.
4. **Vuelta atrás rápida.** `wrangler rollback` para los Workers y D1 Time Travel para los datos
   (docs/runbooks/despliegue.md y F6-07).
5. **Backups.** El backup diario del sistema (F0-14) y los de usuario (F6) siguen igual.

## Consecuencias

- Desaparecen P-02 (dominio de staging) y la parte de staging de P-09. Cloudflare Access solo
  protegerá `delyra.app/admin` (F1-17).
- Los bots de Telegram (P-10), los widgets de Turnstile (P-08), el remitente de email (P-07) y el
  cliente OAuth de Google (P-11) solo hacen falta para producción. Para probar en local se usan
  claves de prueba (Turnstile), un `Mailer` que solo registra y túneles o pruebas simuladas.
- La Definition of Done (§3.4, punto 6) pasa a «probada en local y, tras desplegar, comprobada en
  producción». Los cierres de fase despliegan y validan en producción.
- El simulacro de restauración (F6-07) se hace sobre una D1 temporal creada para la prueba, no
  sobre la de producción.
- Las pruebas de seguridad con Burp (F7-08 y cierres de fase) se hacen contra local o contra
  producción con cuentas de prueba, nunca con datos reales de otros usuarios.
- Si más adelante se necesita staging, la vía recomendada es un dominio registrable propio (no un
  subdominio de `delyra.app`, que recibiría la cookie de producción): un entorno `staging` en los
  `wrangler.jsonc`, su entrada en `app-origins.json` y un job más en el workflow.
