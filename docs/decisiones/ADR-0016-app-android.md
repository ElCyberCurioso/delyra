# ADR-0016 · App nativa de Android

- **Estado:** aceptada
- **Fecha:** 2026-11-23
- **Tareas:** F8-01 a F8-12 (plan en [`docs/plan-android.md`](../plan-android.md))

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
- TOTP, códigos de recuperación y llaves de acceso nativas (F8-10, Credential Manager). La API
  acepta el origen `android:apk-key-hash:<hash>` en WebAuthn y delyra.app publica
  `/.well-known/assetlinks.json`; ambos salen de `packages/shared/src/android-app.ts`.
- Certificados de confianza (F8-10, decisión del usuario del 2026-11-25): de momento solo el
  certificado debug del ordenador de desarrollo, para probar llaves de acceso y App Links en
  producción con la build debug. Riesgo acotado: solo quien tenga ese `debug.keystore` podría
  firmar una app en la que confíe delyra.app. Al añadir la huella de Play App Signing se quita la
  de debug (decisión del usuario en F8-11): producción solo confiará en la app de Google Play.
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

### Publicación (F8-11)

- Play App Signing: Google firma lo que se instala con la clave de la app; nosotros solo tenemos la
  clave de subida. Esa clave vive en los secretos del Environment `android-release` de GitHub y en
  el gestor de contraseñas de quien publica, nunca en el repositorio.
- El workflow manual `android-release.yml` construye y firma el AAB desde main, con CI en verde y
  sin caché de Gradle, y lo deja como artefacto junto al mapping de R8. La subida a Play Console es
  manual (decisión del usuario): la primera tiene que serlo de todos modos, y así no hace falta una
  cuenta de servicio de Google Cloud con más secretos.
- La versión entra como `-Pdelyra.versionName=X.Y.Z` y el versionCode sale de ella
  (X·10000 + Y·100 + Z), así que crece siempre que sube la versión.
- R8 y recursos reducidos en release. Una build `qa` (release con la clave debug, `app.delyra.qa`,
  con `pnpm dev`) sirve para probar en local que R8 no rompe nada; CI compila el AAB de release sin
  firmar en cada PR.
- El AAB no se divide por idioma: el idioma se cambia dentro de la app y los dos tienen que estar
  instalados.
- Ajustes enlaza la política de privacidad y las condiciones (Google Play exige la política dentro
  de la app), y la política explica qué guarda la app en el móvil.
- Google Play exige poder pedir el borrado de la cuenta desde la app y desde una web, y Delyra no
  lo tiene: va en una tarea propia, F8-12 (decisión del usuario), antes de salir a producción.

## Consecuencias

- La página `/mobile/turnstile.html` tiene que estar desplegada en producción antes de publicar la
  app (sale con el siguiente despliegue de `delyra-calendar`). El service worker de la PWA no la
  intercepta (`navigateFallbackDenylist`).
- Los mensajes de la API se traducen al inglés con la tabla de la web (F8-06).
- Para conectar Google o Microsoft 365 hay que iniciar sesión también en la web la primera vez.
- Sin conexión (F8-09) se ven las últimas lecturas de agenda y tableros, como en la PWA, desde la
  caché HTTP de OkHttp en `noBackupFilesDir`; no hay escrituras sin conexión (ni cola de cambios).
- Las llaves de acceso nativas no se pueden probar con `pnpm dev`: Android exige que el `rpId` sea
  un dominio con `assetlinks.json` en HTTPS. Se prueban en producción (tras desplegar web y API)
  con un móvil con bloqueo de pantalla y gestor de contraseñas.
- Para salir a producción en Google Play faltan F8-12 (borrado de cuenta) y la huella de Play App
  Signing en `packages/shared/src/android-app.ts` (se conoce al crear la app en Play Console).
- No hay notificaciones push: las alertas siguen por Telegram o email.
