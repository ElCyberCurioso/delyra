# Cómo contribuir

Resumen operativo del §3 del plan de trabajo.

## Ramas y PR

- _Trunk-based_: `main` siempre desplegable y protegida; un merge a `main` despliega en staging.
- Una rama y un PR por tarea, con el identificador del plan: `feat/F1-08-login-2fa`,
  `fix/F2-04-dst-semana`.
- El PR enlaza la tarea y explica cómo probarla (la plantilla incluye la Definition of Done).

## Commits

Conventional Commits con el identificador de la tarea al final del asunto. `commitlint` lo
comprueba en el hook `commit-msg` (el identificador es un aviso, no un bloqueo):

```
feat(auth): flujo de login con sesión parcial pendiente de 2FA [F1-08]
fix(calendar): expansión de RRULE en el cambio de horario de octubre [F2-04]
```

El hook `pre-commit` ejecuta ESLint y Prettier sobre los ficheros preparados (`lint-staged`).

## Definition of Done

1. Cumple el detalle de la tarea y sus criterios de aceptación.
2. Tiene tests: unitarios y, si hay endpoints, de integración con autorización (usuario ajeno → 404).
3. `pnpm lint`, `pnpm typecheck` y `pnpm test` pasan en CI.
4. Sin secretos en el código ni en los logs; gitleaks y Semgrep sin hallazgos nuevos.
5. Las migraciones de D1 se aplican desde cero y sobre la versión anterior.
6. Desplegada en staging y probada manualmente.
7. Documentación actualizada (README, ADR o runbook).

## Reglas de seguridad permanentes

- **Datos de cada usuario.** Toda consulta pasa por la capa de repositorios con `ownerId`
  obligatorio; el cliente nunca envía `owner_id`. Un recurso ajeno responde **404**, no 403.
- **Validación.** Toda entrada se valida con Zod (`parseInput` en `apps/api/src/lib/errors.ts`
  responde 422 con la lista de errores).
- **Errores.** Siempre `application/problem+json` sin trazas (`AppError` / `problemResponse`).
- **Logs.** Nunca contraseñas, tokens, semillas TOTP, `chat_id` ni contenido de eventos. El logger
  redacta las claves sensibles (ver [docs/observabilidad.md](docs/observabilidad.md)), pero no
  confíes en ello: no pases esos datos al logger.
- **Cambios de estado.** Toda mutación exige `Content-Type: application/json` y un `Origin` de la
  lista blanca (`isAllowedOrigin` en `@delyra/shared`; middleware en F1-05).

## Tareas habituales

### Cambiar el esquema de D1

1. Edita `apps/api/src/db/schema.ts`.
2. `pnpm db:generate` crea `apps/api/migrations/NNNN_*.sql`. Revisa el SQL.
3. `pnpm db:migrate:local` y `pnpm test` (los tests aplican todas las migraciones desde cero).
4. Las migraciones deben ser compatibles con el código anterior (expand/contract): CI las aplica
   antes de desplegar el nuevo Worker.

### Cambiar `wrangler.jsonc`

Tras añadir o cambiar bindings, ejecuta `pnpm cf-typegen` y sube el `worker-configuration.d.ts`
regenerado. Los bindings no se heredan entre entornos: decláralos en local, `staging` y
`production`.

### Añadir un secreto

1. Decláralo en `apps/api/src/env.d.ts` (Wrangler no conoce los secretos).
2. Añádelo vacío a `apps/api/.dev.vars.example`.
3. Cárgalo en cada entorno: `pnpm exec wrangler secret put NOMBRE --env staging`.
   Nunca lo pegues en el chat, en un issue ni en el repositorio.
