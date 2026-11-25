# Runbook · App de Android

App nativa en `apps/android` (ADR-0016, plan en `docs/plan-android.md`).

## Requisitos

- JDK 21 (sirve el de Android Studio: `C:\Program Files\Android\Android Studio\jbr`).
- Android SDK con la plataforma 37 (`sdkmanager "platforms;android-37.0" "build-tools;37.0.0"`).
- `apps/android/local.properties` con `sdk.dir=…` (no se sube; Android Studio lo crea solo).

## Comandos (desde `apps/android`)

| Comando                       | Qué hace                                          |
| ----------------------------- | ------------------------------------------------- |
| `./gradlew assembleDebug`     | APK de debug (`app.delyra.debug`)                 |
| `./gradlew installDebug`      | Lo instala en el dispositivo o emulador conectado |
| `./gradlew testDebugUnitTest` | Tests JVM (cookies, CSRF, fechas, RRULE…)         |
| `./gradlew lintDebug`         | Android Lint (falla con errores)                  |

CI ejecuta los tres últimos en el job «App de Android».

## Probar contra `pnpm dev`

La build de debug permite elegir el entorno en la pantalla de acceso (y en Ajustes): producción o
local (`http://localhost:5173`, el mismo `Origin` que la SPA, con la clave de prueba de Turnstile).

1. `pnpm dev` (o solo `pnpm dev:calendar`).
2. Reenvía el puerto al dispositivo: `adb reverse tcp:5173 tcp:5173`.
3. En la app, elige «local». Cambiar de entorno cierra la sesión.
4. Para una cuenta de prueba: `pnpm invite --email prueba@delyra.test --role admin --local` y pega
   el enlace en «Tengo una invitación».

Notas:

- **Windows:** Vite escucha solo en `::1` y `adb reverse` conecta por `127.0.0.1`. Arranca el
  calendario con `pnpm --filter @delyra/calendar dev --host 127.0.0.1` o pon un proxy TCP de
  `127.0.0.1` a `[::1]:5173` y usa `adb reverse tcp:5173 tcp:<puerto del proxy>`.
- Si el emulador se reinicia o se desconecta, el `adb reverse` se pierde: vuelve a ejecutarlo
  (`adb reverse --list` para comprobarlo).
- Las cookies `Secure` viajan a `http://localhost` solo en debug; en release solo hay HTTPS
  (`network_security_config`).
- **Canal en vivo con dos personas en local:** cada servidor de Vite (calendario en 5173, tareas en 5174) arranca su propia API con su propio Durable Object, así que la presencia y los avisos no
  pasan de uno a otro. Para probar la app frente a la web de tareas, reenvía la app al servidor de
  tareas: `adb reverse tcp:5173 tcp:5174` (o el proxy apuntando a `[::1]:5174`). La app sigue
  enviando `Origin: http://localhost:5173`, que también está permitido. En producción hay una sola
  API y no pasa.

- **Telegram en local:** sin el bot configurado, Ajustes muestra «aún no disponible»; para
  probar la vinculación hace falta un bot de pruebas (`pnpm telegram:setup`, ver
  `docs/runbooks/telegram.md`).
- **Copias en local:** los Workflows de copia y restauración corren en el propio `wrangler dev`;
  la descarga se guarda con el selector de documentos del sistema.

## Importaciones e integraciones en local

Sin `GOOGLE_CLIENT_ID` ni las variables de Microsoft en `apps/api/.dev.vars`, la app muestra
«no disponible» en la conexión con Google y en las reuniones de Teams (como la web). La importación
de un .zip o .ics sí funciona: copia el fichero al emulador con
`MSYS_NO_PATHCONV=1 adb push prueba.ics /sdcard/Download/` (en Git Bash, sin esa variable la ruta
se convierte en una de Windows) y elígelo en «Importar y sincronizar».

## Alta rápida: corpus compartido con la web

`QuickAddTest` comprueba que el analizador de la app da lo mismo que el de la web en
`app/src/test/resources/quick-add-cases.json`. Si cambia `packages/shared/src/quick-add.ts`, la
prueba `quick-add.android.test.ts` falla hasta regenerar el corpus, y después la de Android dirá
qué frases ya no coinciden:

```sh
pnpm --filter @delyra/shared exec vitest run quick-add.android -u
```

En el emulador, el dictado arranca y pide el micrófono, pero sin audio del ordenador termina en «No
se ha oído nada»; para probar frases, `adb shell input text` no admite la «ñ».

## Mensajes de la API en inglés

La API responde en español y la app traduce con `app/src/main/assets/server-messages.en.json`, que
se genera desde `packages/ui/src/i18n/server-messages.en.ts`. Si cambia un mensaje, la prueba
`server-messages.android.test.ts` de `@delyra/ui` falla en CI hasta regenerar el fichero:

```sh
pnpm --filter @delyra/ui exec vitest run server-messages.android -u
```

## Antes de publicar (F8-11)

1. Desplegar `delyra-calendar` con `apps/calendar/public/mobile/turnstile.html` y comprobar
   `https://delyra.app/mobile/turnstile.html` (sin él no se puede entrar desde la app).
2. Clave de firma de subida en un almacén seguro, nunca en el repositorio (`*.jks` y `*.keystore`
   están en `.gitignore`); la firma se hace en CI con secretos.
3. `./gradlew bundleRelease` (R8 activado) y prueba de la build de release contra producción.
4. Ficha de Google Play: datos en la UE, sin anuncios ni rastreo, política de privacidad
   (`/privacidad`).
