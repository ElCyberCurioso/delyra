# ADR-0010 · PWA, CSP en bloqueo, feeds ICS privados y festivos

- **Estado:** aceptada (2026-11-22)
- **Fecha:** 2026-11-22
- **Tareas afectadas:** F7-01, F7-02, F7-03, F7-07, F7-08

## Decisión

- **PWA** con `vite-plugin-pwa` 2.0 (`generateSW`, compatible con Vite 8) en las dos SPA:
  manifiesto, iconos PNG (normal, maskable y Apple), precarga de la app y, para usar la agenda sin
  conexión, caché **NetworkFirst** (4 s) solo de los GET de lectura imprescindibles
  (`/api/auth/me`, calendarios, eventos, tareas con fecha, festivos y tableros). La caché se borra
  al cerrar sesión y cuando entra otra cuenta en el mismo navegador. Las navegaciones a `/api/*`
  (callback de Google, descargas) no pasan por el service worker. Registro desde el código
  (`virtual:pwa-register`, sin script inline) y aviso «Hay una versión nueva» con botón.
- **CSP en bloqueo**. Tras el periodo en modo informe, las violaciones reales eran tres:
  estilos insertados por FullCalendar y sonner, la fuente de iconos de FullCalendar en `data:` y la
  sonda JIT de Zod 4 (`new Function`). Se permiten `style-src 'unsafe-inline'` y `font-src data:`,
  y Zod se configura `jitless`. Los scripts siguen solo desde `'self'` y Turnstile, sin
  `unsafe-inline` ni `unsafe-eval`; como `img-src`, `font-src` y `connect-src` no admiten otros
  orígenes, una inyección de CSS no puede sacar datos. Se mantiene `report-uri` para seguir
  detectando violaciones.
- **Feeds ICS privados**: una URL por calendario con un token de 256 bits
  (`/api/feeds/<token>.ics`, sin sesión). En D1 solo el SHA-256 (para buscar) y el token cifrado
  (para volver a mostrarlo); regenerar invalida el anterior. Reutiliza el generador ICS de F6-02.
- **Festivos** desde `date.nager.at` (datos abiertos, la petición no lleva datos del usuario),
  guardados por año en `public_holidays` y refrescados cada mes desde el cron diario. Región por
  usuario (Madrid por defecto). Si el servicio falla y no hay datos de un año, se calculan los
  nacionales fijos y el Viernes Santo. Se muestran como capa de solo lectura.
- **Rendimiento**: presupuesto del bundle inicial por SPA en CI (`scripts/check-bundle-size.mjs`)
  y comprobación de LCP (< 2,5 s) e interacción (< 200 ms, Event Timing API) en los e2e de humo
  contra producción. Atajos de teclado (`?` muestra la ayuda) que no se disparan al escribir.

## Consecuencias

- Una versión nueva no se aplica hasta que el usuario pulsa «Actualizar»: si tarda, sigue con la
  anterior (la API es compatible hacia atrás dentro de una misma fase).
- Sin conexión solo se ve lo que se cargó antes; crear o editar sin red falla con un aviso.
- Los festivos autonómicos dependen de la calidad de los datos de Nager.Date.
