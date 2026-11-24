# Plan · App de Android (noviembre de 2026)

> **Estado:** v2 (revisada). F8-01 a F8-06 construidas y probadas contra `pnpm dev` (registro,
> alta TOTP, calendario, tableros, tarjetas, compartir y canal en vivo con dos personas, app y web,
> ajustes y copias de seguridad); F8-07 a F8-11, pendientes. Decisiones
> en [ADR-0016](decisiones/ADR-0016-app-android.md) y uso en el
> [runbook](runbooks/android.md).

Objetivo: una app nativa de Android que haga lo mismo que `delyra.app` (calendario) y
`work.delyra.app` (planificador de tareas / kanban) contra la misma API, y que se adapte a
cualquier tamaño de pantalla: teléfono en vertical u horizontal, plegables, tablets, ventanas
redimensionables (multiventana, escritorio) y tamaños de letra grandes.

## Restricciones que impone la API

| Hecho de la API                                                                 | Consecuencia en la app                                                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| El Worker `api` no tiene entrada pública: se llega por `https://delyra.app/api` | URL base única `https://delyra.app/api/` (también para lo del kanban: la sesión vale en los dos dominios)             |
| Sesión por cookie `__Secure-sid` (`HttpOnly`, `Secure`, `Domain=delyra.app`)    | Almacén de cookies propio y persistente, cifrado con el Android Keystore                                              |
| CSRF: toda mutación exige `Origin` de la lista blanca y `application/json`      | Cabecera `Origin` fija (el origen web del entorno) en todas las peticiones; las subidas llevan además `X-Filename`    |
| Turnstile en login, registro y recuperación; `siteverify` exige `delyra.app`    | Página mínima `https://delyra.app/mobile/turnstile.html` en un WebView que solo entrega el token                      |
| 2FA obligatorio: TOTP, códigos de recuperación y llaves de acceso               | TOTP y códigos de recuperación nativos; llaves de acceso en una fase posterior (ver abajo)                            |
| Sesión activa: 7 días de inactividad, 30 absolutos                              | Al recibir 401 se vuelve al login conservando la pantalla de destino                                                  |
| Errores RFC 9457 (`application/problem+json`), `detail` en español              | Mapeo de errores por campo a los formularios; traducción al inglés de los mensajes conocidos (como `server-messages`) |
| 429 con `Retry-After` (fuerza bruta, rate limit)                                | Mensaje con el tiempo de espera; nunca reintentos automáticos de mutaciones                                           |
| Canal en vivo del tablero: WebSocket `/api/boards/:id/live`, exige `Origin`     | WebSocket de OkHttp con `Origin`, solo mientras el tablero está en pantalla                                           |
| La API localiza por `Accept-Language` (calendarios por defecto, festivos)       | `Accept-Language` con el idioma de la app                                                                             |
| El historial de sesiones muestra el `User-Agent`                                | `User-Agent: Delyra-Android/<versión> (Android <n>; <modelo>)`                                                        |

### Cambios mínimos fuera de la app

1. **`apps/calendar/public/mobile/turnstile.html` + `turnstile.js`** (F8-02): pide la site key a
   `/api/auth/config`, pinta el widget y entrega el token a la app con `postMessage` sobre un
   `WebMessageListener` limitado al origen de Delyra. Cumple la CSP actual (scripts de `'self'` y de
   Turnstile, sin `inline`). Se excluye del `navigateFallback` del service worker.
2. **Más adelante (F8-10):** `/.well-known/assetlinks.json` para App Links (invitaciones y enlaces
   de recuperación que abren la app) y llaves de acceso nativas; la API tendrá que aceptar el origen
   `android:apk-key-hash:<hash>` en WebAuthn. Hasta entonces: TOTP o código de recuperación, y el
   enlace de invitación se pega en la app.

## Decisiones

- **Kotlin + Jetpack Compose + Material 3**, con la gama «Bosque» (esmeralda y lima sobre arena,
  `#007145`) en claro y oscuro, y color dinámico desactivado para mantener la marca.
- **Sin Hilt ni Room ni KSP en esta etapa.** Un contenedor de dependencias manual (`AppGraph`) y
  la API como fuente de verdad, igual que la PWA. Menos plugins = menos incompatibilidades con AGP 9
  (Kotlin integrado) y builds más rápidos. Si hace falta caché sin conexión (F8-09) se hará con el
  mismo alcance que la PWA: las últimas lecturas de agenda y tableros, borradas al cerrar sesión.
- **Retrofit 3 + kotlinx.serialization + OkHttp 5.** DTO a mano a partir de los esquemas Zod de
  `@delyra/shared`, con `ignoreUnknownKeys` para que añadir campos en la API no rompa la app.
- **Login nativo.** Formularios propios; el WebView solo resuelve Turnstile. Se descartó cargar el
  login web entero en un WebView: depende de rutas y redirecciones de la SPA, mete el service worker
  en medio, obliga a sacar una cookie `HttpOnly` del `CookieManager` y no se integra con la app.
- **Sesión cifrada.** El valor de `__Secure-sid` se guarda cifrado (AES-GCM con clave del
  Keystore) en DataStore. `allowBackup=false` y reglas de extracción que excluyen todo: la sesión
  no viaja en copias ni a otro dispositivo. `FLAG_SECURE` en las pantallas con la semilla TOTP o
  los códigos de recuperación. Sin _pinning_ de certificados (Cloudflare los rota).
- **Red:** HTTPS obligatorio en `release`; en `debug`, texto plano solo para `localhost` y
  `10.0.2.2`. El log HTTP solo existe en `debug` y redacta `Cookie` y `Set-Cookie`.
- **Entorno local:** `adb reverse tcp:5173 tcp:5173` y la app de `debug` apunta a
  `http://localhost:5173` (mismo `Origin` que la SPA local y clave de prueba de Turnstile). El
  almacén de cookies trata `localhost` como seguro solo en `debug` (OkHttp no envía cookies `Secure`
  por `http`). La build de `debug` permite cambiar entre producción y local.
- **Zona horaria y semana** de la cuenta (`settings.timeZone`, `weekStart`), no las del móvil,
  como la web. `java.time` (nativo desde la API 26).
- **Idiomas:** español (por defecto) e inglés, con idioma por app (Android 13+) sincronizado con
  `settings.locale`.
- **Carreras:** cada pantalla con datos que se mutan (tablero, calendario) numera sus peticiones y
  descarta las respuestas viejas que llegan tarde (lo que corrigió la web en F4-08).
- **Notificaciones push: fuera de alcance.** Las alertas siguen por Telegram o email. Un push
  propio exigiría FCM y cambios en la API (cola de notificaciones); se valorará aparte.
- `applicationId` `app.delyra`, `minSdk 26`, `compileSdk 37` (lo exigen core-ktx 1.19 y OkHttp
  5.5) y `targetSdk 36`.

## Versiones (fijadas en `gradle/libs.versions.toml`, todas con más de dos semanas publicadas)

| Área     | Versión                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Build    | Gradle 9.8.2, Android Gradle Plugin 9.5.1 (Kotlin integrado), JDK 21                                                             |
| Kotlin   | 2.4.21 (plugins `compose` y `serialization`), coroutines 1.11.0                                                                  |
| Compose  | BOM 2026.09.00, material3-adaptive 1.3.0, navigation-compose 2.10.2                                                              |
| AndroidX | core 1.19.1, activity 1.13.0, lifecycle 2.11.0, datastore 1.3.0, webkit 1.18.0, browser 1.10.0, window 1.5.1, splashscreen 1.2.0 |
| Red      | OkHttp 5.5.1, Retrofit 3.0.0, kotlinx-serialization-json 1.12.0                                                                  |
| Tests    | JUnit 4.13.2, mockwebserver3 5.5.1, kotlinx-coroutines-test 1.11.0                                                               |

## Arquitectura

```
apps/android/
  settings.gradle.kts · build.gradle.kts · gradle/libs.versions.toml · gradlew
  app/src/main/java/app/delyra/
    DelyraApp.kt          Application: crea el AppGraph
    MainActivity.kt       edge-to-edge, tema, raíz de navegación
    core/
      config/             entornos (producción / local) y constantes
      network/            OkHttp, cookies cifradas, cabeceras, problem+json, WebSocket
      session/            estado de sesión (/auth/me) y cierre por 401
      model/              DTO compartidos
      time/               conversión de fechas con la zona de la cuenta
      ui/                 tema Bosque, componentes, tamaños de ventana, errores
    feature/
      auth/               login, Turnstile, 2FA, alta TOTP, registro, recuperación
      calendar/           agenda, día, 3 días / semana, mes, año, editor, calendarios
      kanban/             tableros, tablero, tarjeta, columnas, etiquetas, compartir
      settings/           perfil, preferencias, seguridad, sesiones, Telegram, copias…
      admin/              invitaciones, usuarios, copias del sistema
    navigation/           rutas con tipos (kotlinx.serialization) y andamiaje adaptativo
```

Cada pantalla: `ViewModel` con `StateFlow<UiState>` inmutable + composable sin estado. Los
repositorios devuelven `Result` con un `ApiError` tipado (red, 401, 403, 404, 409, 413, 422 con
campos, 429 con espera, 5xx).

## Interfaz adaptativa

Clases de tamaño de ventana de Material 3 (`currentWindowAdaptiveInfo()`), recalculadas en cada
cambio de configuración (giro, plegado, multiventana). Nada depende de la orientación: solo del
ancho y del alto disponibles.

| Ventana                                | Navegación                | Calendario                                                                    | Planificador                                                                                           | Detalle                        |
| -------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Compacta (< 600 dp de ancho)           | Barra inferior            | Agenda, día y **3 días** por defecto; mes y año; calendarios en hoja inferior | Columnas como páginas deslizables con pestañas; «Mover a…» en una hoja; arrastrar dentro de la columna | Pantalla completa              |
| Mediana (600–839 dp)                   | Carril lateral            | Semana; panel de calendarios plegable                                         | Columnas lado a lado con scroll horizontal y arrastrar entre columnas                                  | Panel o diálogo según el ancho |
| Expandida (≥ 840 dp)                   | Carril / cajón permanente | Semana con panel lateral fijo (minimes, calendarios, capas)                   | Todas las columnas visibles; tarjeta en panel de detalle (lista-detalle)                               | Panel junto a la lista         |
| Alto compacto (teléfono en horizontal) | Carril en lugar de barra  | Rejilla horaria más baja; cabeceras compactas                                 | Igual que su ancho                                                                                     | Igual que su ancho             |
| Plegable en postura de mesa            | —                         | Calendario arriba, agenda del día abajo                                       | —                                                                                                      | —                              |

Reglas transversales: `NavigationSuiteScaffold` para la navegación, `ListDetailPaneScaffold` para
lista-detalle (tableros → tarjeta, ajustes → sección), _edge-to-edge_ con `WindowInsets`, sin
alturas fijas que rompan con letra al 200 %, objetivos táctiles de 48 dp, acciones de
accesibilidad para mover tarjetas sin arrastrar (TalkBack), modo oscuro y «reducir animaciones».

## Paridad con la web

| Web                                                                                                                                                                                  | App                                           | Tarea |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ----- |
| Login, 2FA (TOTP / recuperación), alta TOTP, registro por invitación, recuperar contraseña                                                                                           | Nativo + Turnstile en WebView                 | F8-02 |
| Llaves de acceso, App Links                                                                                                                                                          | Credential Manager + assetlinks               | F8-10 |
| Calendario: vistas, calendarios (crear, color, visible, borrar), eventos, recurrencias con alcance, cumpleaños, alertas, búsqueda                                                    | Nativo                                        | F8-03 |
| Capas: festivos y tareas con fecha límite; feed ICS privado                                                                                                                          | Nativo                                        | F8-03 |
| Alta rápida en lenguaje natural y dictado                                                                                                                                            | Puerto de `quick-add.ts` + `SpeechRecognizer` | F8-07 |
| Tableros (plantillas), columnas (WIP, hecho, delegada), etiquetas, tarjetas (tipo, prioridad, color, fecha, alertas, asignado), checklist, comentarios, adjuntos, actividad, archivo | Nativo                                        | F8-04 |
| Tableros compartidos, invitaciones, roles, presencia y cambios en vivo                                                                                                               | Nativo                                        | F8-05 |
| Ajustes: perfil, preferencias, contraseña, códigos, cambiar TOTP, sesiones, historial, Telegram                                                                                      | Nativo                                        | F8-06 |
| Copias de usuario (crear, descargar, restaurar, deshacer), exportaciones (ICS, JSON/CSV)                                                                                             | SAF (crear/abrir documento)                   | F8-06 |
| Importaciones ICS, suscripciones iCal, Google Calendar, Teams en tableros                                                                                                            | Custom Tabs para OAuth                        | F8-08 |
| Panel de administración                                                                                                                                                              | Nativo (solo rol admin)                       | F8-08 |
| PWA sin conexión (lecturas)                                                                                                                                                          | Caché de lecturas                             | F8-09 |

## Tareas

- **F8-01 · Base.** Proyecto Gradle en `apps/android`, catálogo de versiones, tema Bosque, idiomas,
  andamiaje adaptativo, cliente HTTP (cookies cifradas, `Origin`, `User-Agent`, problem+json),
  integración en el monorepo (ignorados de ESLint/Prettier/git) y job de CI.
- **F8-02 · Acceso.** Página de Turnstile, login, segundo factor, alta TOTP con códigos, registro
  por invitación, «olvidé mi contraseña», restaurar sesión al abrir, cierre de sesión, 401 global.
- **F8-03 · Calendario.** Calendarios, vistas, editor completo (día completo, zona, repetición con
  presets y regla avanzada, alertas, cumpleaños), alcance «este / siguientes / todos», borrar,
  búsqueda, festivos, capa de tareas, feed ICS.
- **F8-04 · Planificador.** Lista de tableros y creación con plantilla, tablero adaptativo, mover
  tarjetas (arrastrar / «Mover a…» / acciones de accesibilidad), columnas delegadas con asignado,
  aviso de WIP, detalle de tarjeta completo, adjuntos (subir y abrir), archivo y restauración.
- **F8-05 · Compartir y en vivo.** Hecho. Hoja «Compartir» / «Personas» como `share-dialog.tsx`
  (invitar con permiso, cambiar permisos, quitar, anular invitaciones, salir, límites y caducidad);
  aceptar o rechazar invitaciones; papel de lectura sin controles de edición; ajustes del tablero
  para quien edita (borrarlo, solo el dueño); cabecera con papel, dueño y presencia. Canal en vivo
  con reconexión con espera creciente y azar, refresco al volver al tablero, y avisos a la tarjeta
  abierta, a la lista y al calendario. En el teléfono, la pantalla de una tarjeta abre su propio
  canal (el tablero queda detrás, cerrado) y se cierra con aviso si la borran o te quitan el
  acceso.
- **F8-06 · Ajustes y copias.** Hecho. Seguridad con confirmación de identidad (contraseña y
  código de la app o de recuperación) para generar códigos nuevos y cambiar de app autenticadora;
  lista de llaves de acceso y quitarlas (añadirlas, en F8-10); Telegram (vincular con espera al
  bot, resumen diario, horas de silencio, prueba, reactivar y desvincular); historial de seguridad
  con los eventos sospechosos destacados; sesiones con dispositivo y país legibles. Copias de
  seguridad: crear, descargar al documento elegido (SAF), borrar, copias automáticas, restaurar de
  una copia guardada o de un fichero (fusionar o reemplazar), progreso y deshacer. Exportar un
  calendario a ICS y elegir la región de los festivos. Los mensajes de la API se traducen al inglés
  con la misma tabla que la web (`assets/server-messages.en.json`, exportada y vigilada por una
  prueba de `@delyra/ui`).
- **F8-07 · Alta rápida y dictado.**
- **F8-08 · Integraciones y administración.** Verificar antes si los _callbacks_ OAuth de Google y
  Microsoft funcionan sin la cookie del navegador (Custom Tab); si no, cambio en la API.
- **F8-09 · Sin conexión.**
- **F8-10 · Llaves de acceso y App Links.**
- **F8-11 · Publicación.** Firma con secretos de CI (nunca en el repositorio), R8, Play Console.

## Pruebas

- JVM: presets de repetición ↔ RRULE, fechas con zona y DST, mapeo de problem+json, almacén de
  cookies, cliente con MockWebServer (cabeceras `Origin`, `Content-Type`, 401 → login).
- Compose: pantallas clave en anchos de 360, 600, 840 y 1280 dp, letra al 200 % y modo oscuro.
- Manual: teléfono vertical/horizontal, plegable, tablet, TalkBack, contra `pnpm dev` y producción.
- CI: `./gradlew lintDebug testDebugUnitTest assembleDebug` en un job propio.

## Revisión del plan (v1 → v2)

| v1                                                          | Problema                                                                                                | v2                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Login web entero en un WebView y copiar la cookie           | Frágil (rutas de la SPA, service worker), cookie `HttpOnly` en `CookieManager`, experiencia no nativa   | Login nativo; el WebView solo da el token de Turnstile, desde una página propia        |
| `addJavascriptInterface` implícito                          | Expone el puente a cualquier página que cargue el WebView                                               | `WebMessageListener` limitado al origen de Delyra                                      |
| Hilt + Room desde el principio                              | KSP y plugins frente a AGP 9 con Kotlin integrado; la web tampoco guarda datos salvo la caché de la PWA | Contenedor manual; caché de lecturas en F8-09                                          |
| Dos tamaños (teléfono / tablet)                             | Ignora el alto (horizontal), plegables, multiventana y letra grande                                     | Clases de ancho y alto + postura, sin depender de la orientación                       |
| Vista semana en el teléfono                                 | Ilegible a 360 dp; la web usa 3 días en estrecho                                                        | 3 días / día / agenda en compacto                                                      |
| Arrastrar y soltar como única forma de mover tarjetas       | Entre columnas que no caben es torpe e inaccesible                                                      | Hoja «Mover a…» y acciones de TalkBack; arrastrar entre columnas solo con ancho        |
| Sin almacenamiento seguro ni entorno local                  | La cookie en claro; `Secure` no viaja por `http://localhost`                                            | Keystore + DataStore, sin copias; almacén que trata `localhost` como seguro en `debug` |
| Sin `Origin` ni `User-Agent` ni `Accept-Language` definidos | CSRF devolvería 403; historial de sesiones ilegible; nombres por defecto en otro idioma                 | Cabeceras fijas en un interceptor                                                      |
| Sin control de carreras ni canal en vivo                    | Respuestas viejas pisan cambios recientes (el fallo de F4-08 en la web)                                 | Peticiones numeradas; WebSocket con ciclo de vida y reconexión                         |
| Llaves de acceso «las resuelve la web»                      | En nativo exigen assetlinks y que la API acepte el origen de la app                                     | Fase propia (F8-10)                                                                    |
| Sin integración en el monorepo                              | `pnpm lint`/`format:check` recorrerían `build/`; CI no compilaría la app                                | Ignorados y job de CI en F8-01                                                         |
| Fases sin identificador                                     | No encajan con la convención de commits del repositorio                                                 | Tareas F8-xx                                                                           |
