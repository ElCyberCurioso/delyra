## Tarea

<!-- Identificador del plan, p. ej. F1-08, y enlace a la tarea si existe. -->

## Qué cambia

## Cómo probarlo

<!-- Pasos para validarlo en local y qué comprobar en producción tras desplegar. -->

## Definition of Done (§3.4)

- [ ] Cumple el detalle y los criterios de aceptación de la tarea
- [ ] Tests unitarios y, si hay endpoints, de integración con autorización (usuario ajeno → 404)
- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` en verde
- [ ] Sin secretos en código ni en logs; gitleaks y Semgrep sin hallazgos nuevos
- [ ] Migraciones (si las hay) aplicadas desde cero y sobre la versión anterior
- [ ] Probado en local (`pnpm dev`, `pnpm e2e`); qué comprobar en producción tras desplegar
- [ ] Documentación actualizada (README, ADR o runbook)
