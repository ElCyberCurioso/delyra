# ADR-0001 · Stack y versiones

- **Estado:** aceptada
- **Fecha:** 2026-11-20
- **Tarea:** F0-01

## Contexto

El plan (§2) fija las tecnologías y pide usar la última versión estable de cada paquete en el
momento de F0-01, documentándola aquí. Todas las dependencias se fijan con versión exacta en
`package.json` (más `pnpm-lock.yaml`); Renovate propone las actualizaciones.

## Decisión

### Versiones fijadas

| Área             | Paquete                                    | Versión                 |
| ---------------- | ------------------------------------------ | ----------------------- |
| Runtime local/CI | Node.js (`.nvmrc`)                         | 26.13.1 (LTS)           |
| Monorepo         | pnpm (Corepack, `packageManager`)          | 12.21.0                 |
|                  | Turborepo                                  | 2.11.13                 |
| Lenguaje         | TypeScript                                 | 6.0.3                   |
| Cloudflare       | Wrangler                                   | 4.165.0                 |
|                  | `@cloudflare/vite-plugin`                  | 1.70.1                  |
|                  | `@cloudflare/vitest-plugin`                | 1.8.5                   |
|                  | `compatibility_date` de los Workers        | 2026-11-17              |
| Backend          | Hono                                       | 4.13.19                 |
|                  | `@hono/zod-validator`                      | 0.9.1                   |
|                  | Zod                                        | 4.6.7                   |
|                  | Drizzle ORM / drizzle-kit                  | 0.45.4 / 0.31.11        |
|                  | uuidv7                                     | 1.2.1                   |
| Frontend         | React / React DOM                          | 19.3.1                  |
|                  | Vite / `@vitejs/plugin-react`              | 8.3.8 / 6.3.0           |
|                  | Tailwind CSS (+ `@tailwindcss/vite`)       | 4.3.5                   |
|                  | `radix-ui` (primitivas de shadcn/ui)       | 1.8.1                   |
|                  | lucide-react                               | 1.77.0                  |
|                  | sonner                                     | 2.0.8                   |
|                  | TanStack Query                             | 5.108.1                 |
| Calendario (F2)  | FullCalendar (core, react y plugins)       | 6.1.22                  |
|                  | chrono-node (solo `chrono-node/es`)        | 2.10.3                  |
|                  | rrule                                      | 2.8.1                   |
| Kanban (F4)      | `@dnd-kit/core` / `sortable` / `utilities` | 6.3.1 / 10.0.0 / 3.2.2  |
|                  | fractional-indexing                        | 4.0.0                   |
|                  | markdown-it (trae sus tipos)               | 15.0.3                  |
|                  | DOMPurify                                  | 3.4.17                  |
| Google (F5)      | ical.js                                    | 2.2.1                   |
|                  | fflate                                     | 0.8.3                   |
| PWA (F7)         | vite-plugin-pwa / workbox                  | 2.0.0 / 7.4.1           |
| Calidad          | Vitest                                     | 5.1.1                   |
|                  | Testing Library (react / dom / jest-dom)   | 16.3.3 / 10.4.2 / 8.0.0 |
|                  | MSW                                        | 3.0.7                   |
|                  | jsdom                                      | 31.0.1                  |
|                  | Playwright                                 | 1.65.1                  |
|                  | ESLint / typescript-eslint                 | 10.15.0 / 8.73.0        |
|                  | Prettier                                   | 3.10.1                  |
|                  | Husky / lint-staged / commitlint           | 9.1.7 / 17.6.1 / 21.2.4 |
| CI               | gitleaks / Semgrep                         | 8.30.1 / 1.186.0        |

Las librerías de fases posteriores (dnd-kit, ical.js…) se fijan en la tarea que las introduce,
con el mismo criterio.

### Desviaciones respecto a «la última versión»

- **Sin date-fns ni `@date-fns/tz`.** El plan los preveía para las zonas horarias, pero al
  construir una fecha desde la hora local `@date-fns/tz` desempata las horas duplicadas según la
  zona del sistema (UTC en los Workers, la del usuario en el navegador). La conversión está en
  `packages/shared/src/time.ts` solo con `Intl`, con el mismo resultado en todas partes (ADR-0005).
- **FullCalendar 6.1 y no 7.1.** La 7 se publicó el 12 de noviembre de 2026 con otra arquitectura
  (paquete `@full-ui/headless-calendar` y `temporal-polyfill` como dependencias). La 6.1 es estable
  y admite React 19. La zona horaria se resuelve sin su plugin (ADR-0005).

- **DOMPurify 3.4.17 y no 3.4.18.** La 3.4.18 tenía 8 días al introducirla (F4-09); se usa la
  anterior, con más de dos semanas publicada. markdown-it 15 incluye sus tipos: no hace falta
  `@types/markdown-it` (que es de la 14).
- **dnd-kit 6 (`@dnd-kit/core`) y no `@dnd-kit/react`.** La API nueva sigue en 0.x; la 6.3 es la
  estable, con sensores de ratón, táctil y teclado.

- **TypeScript 6.0 y no 7.0.** TypeScript 7 (compilador nativo) ya es estable, pero
  typescript-eslint 8.73 solo admite `>=4.8.4 <6.1.0`. Se revisará cuando typescript-eslint lo
  admita; Renovate tiene una regla que bloquea `>=6.1` hasta entonces.
- **`@cloudflare/vitest-plugin` en lugar de `@cloudflare/vitest-pool-workers`.** Es el mismo
  proyecto renombrado en su versión 1 (agosto de 2026), con soporte de Vitest 5.
- **Wrangler y `wrangler.jsonc`, no el CLI `cf` ni el plugin de Vite 2.x.** El plan fija Wrangler
  v4. El plugin de Vite 2 (que solo lee `cloudflare.config.ts`) sigue en _release candidate_.
- **`vite --configLoader runner`.** Los `vite.config.ts` importan un plugin de `@delyra/ui` escrito
  en TypeScript; el cargador por defecto lo trataría como dependencia externa.

### Notas de configuración

- TypeScript 6 cambia valores por defecto (`types: []`, `strict`…). `tsconfig.base.json` los
  declara de forma explícita, con `strict`, `noUncheckedIndexedAccess` y `verbatimModuleSyntax`.
- Los paquetes internos (`@delyra/shared`, `@delyra/ui`) se consumen como código fuente TypeScript
  (sin paso de build); los empaquetan Vite y Wrangler.
- pnpm 12 bloquea los scripts de instalación salvo los aprobados en `pnpm-workspace.yaml`
  (`allowBuilds`: `esbuild` y `workerd`).

## Consecuencias

- Actualizar cualquier herramienta de la tabla requiere actualizar este ADR.
- La versión local de Node puede ser 22.12+ (`engines`), pero CI usa la de `.nvmrc`.
