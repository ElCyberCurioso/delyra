# ADR-0016 · App nativa de Android

- **Estado:** aceptada
- **Fecha:** 2026-11-23
- **Tareas:** F8-01 a F8-04 (plan en [`docs/plan-android.md`](../plan-android.md))

## Contexto

Se quiere una app de Android con lo mismo que las dos SPA (calendario y planificador de tareas),
adaptada a cualquier tamaño de pantalla, sin cambiar el modelo de seguridad de la API: sesión por
cookie común, CSRF por `Origin`, Turnstile en los formularios públicos y 2FA obligatorio
(ADR-0004).

## Decisión

### Proyecto

- `apps/android`, un proyecto Gradle independiente dentro del monorepo (pnpm, ESLint y Prettier lo
  ignoran). Un solo módulo `app` con paquetes por funcionalidad (`core`, `feature/auth`,
  `feature/calendar`, `feature/kanban`, `feature/settings`).
- Kotlin 2.4 + Jetpack Compose + Material 3 adaptativo. AGP 9.5 (Kotlin integrado), Gradle 9.8,
  `compileSdk 37`, `targetSdk 36`, `minSdk 26`. Versiones fijadas en `gradle/libs.versions.toml`,
  todas con más de dos semanas publicadas (criterio de ADR-0001).
- Sin Hilt, Room ni KSP: contenedor de dependencias manual (`AppGraph`) y la API como fuente de
  verdad, como la PWA.

### Red y sesión

- URL base `https://delyra.app/api/`: la API no tiene dominio propio (ADR-0002) y la cookie
  `Domain=delyra.app` vale también para lo que la web pide en `work.delyra.app`.
- Un interceptor añade a toda petición `Origin` del entorno, `User-Agent` legible
  (`Delyra-Android/<versión> (Android <n>; <modelo>)`, para el historial de sesiones) y
  `Accept-Language`; a las mutaciones sin cuerpo les pone `Content-Type: application/json` (el
  CSRF lo exige también en `DELETE` y en los `POST` sin cuerpo).
- Las cookies persistentes se guardan cifradas con AES-256-GCM y una clave del Android Keystore.
  `allowBackup=false` y reglas de extracción que excluyen todo: la sesión no sale del dispositivo.
- Un 401 fuera de `/api/auth/` devuelve al login. Sin _pinning_ de certificados (Cloudflare rota los
  suyos).

### Acceso

- Formularios nativos para login, segundo factor, alta TOTP, registro por invitación y
  recuperación. El widget de Turnstile solo funciona en un origen de Delyra (la API comprueba el
  `hostname` de `siteverify`), así que la app carga en un WebView la página estática
  `apps/calendar/public/mobile/turnstile.html`, que entrega el token por un `WebMessageListener`
  limitado al origen exacto de Delyra. Se descartó cargar el login web entero en un WebView.
- TOTP y códigos de recuperación. Llaves de acceso nativas y App Links quedan para F8-10: exigen
  publicar `/.well-known/assetlinks.json` y que la API acepte el origen
  `android:apk-key-hash:<hash>` en WebAuthn.
- `FLAG_SECURE` en las pantallas con la semilla TOTP o los códigos de recuperación.
- Conectar Google o Microsoft 365 (F8-08) se hace en la web, en una Custom Tab: el _callback_
  OAuth comprueba la cookie de sesión web y la cookie cifrada con el `state`, que el navegador no
  tiene si la sesión es la de la app. Se descartó cambiar la API (un `state` sin cookie con un
  «handoff» que la app completa con su sesión): toca la seguridad de producción y en local no hay
  credenciales para probarlo de punta a punta. La app gestiona todo lo demás y recarga al volver.

### Interfaz adaptativa

- Clases de tamaño de ventana de Material 3 (ancho 600/840 dp y alto 480 dp), recalculadas en cada
  cambio; la actividad no se recrea al girar, plegar o redimensionar.
- `NavigationSuiteScaffold`: barra inferior en compacto, carril en mediano, expandido u horizontal.
- Calendario: agenda, día, 3 días (estrecho) o semana (ancho), mes y año; panel lateral fijo en
  expandido y hojas inferiores en el resto; detalle del evento en hoja o en panel.
- Tablero: en estrecho, una columna por página con pestañas y «Mover a…» en una hoja; en ancho,
  columnas lado a lado con arrastrar y soltar; detalle de la tarjeta en un panel en expandido.
  Mover tarjetas también está como acción de accesibilidad (TalkBack).

### Consistencia de datos

- Los cambios avisan entre pantallas (`DataChanges`): el tablero y el calendario vuelven a pedir lo
  suyo. Cada rango del calendario y cada tablero descartan las respuestas que empezaron antes del
  último cambio (el fallo que corrigió F4-08 en la web).
- Canal en vivo del tablero por WebSocket (con `Origin` y la cookie), solo mientras el tablero está
  en pantalla, con `ping` cada 30 s, reconexión con espera creciente (más hasta 0,5 s al azar, como
  la web) y cierre 4403 o 403/404 en el saludo = sin acceso. Al volver a un tablero se pide de
  nuevo (pudo cambiar con el canal cerrado).
- Un cambio ajeno llega a todo lo que lo pinta por `DataChanges.remoteBoard`: el tablero, la tarjeta
  abierta en su panel, la lista de tableros y la capa de tareas del calendario. En el teléfono la
  tarjeta va en pantalla completa con el tablero detrás (y su canal cerrado), así que abre su propio
  canal mientras está visible (F8-05).

## Consecuencias

- La página `/mobile/turnstile.html` tiene que estar desplegada en producción antes de publicar la
  app (sale con el siguiente despliegue de `delyra-calendar`). El service worker de la PWA no la
  intercepta (`navigateFallbackDenylist`).
- Los mensajes de la API se traducen al inglés con la tabla de la web (F8-06).
- Para conectar Google o Microsoft 365 hay que iniciar sesión también en la web la primera vez.
- Quedan pendientes (plan, tareas F8-09 a F8-11): caché sin conexión, llaves de acceso y App
  Links, y publicación en Google Play.
- No hay notificaciones push: las alertas siguen por Telegram o email.
