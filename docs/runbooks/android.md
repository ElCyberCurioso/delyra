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
| `./gradlew installQa`         | Release con R8 y la clave debug (`app.delyra.qa`) |
| `./gradlew bundleRelease`     | AAB de release (sin firmar salvo en el workflow)  |

CI ejecuta lint, tests, `assembleDebug` y `bundleRelease` en el job «App de Android».

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

## Probar sin conexión

Con `adb reverse` el tráfico a `localhost:5173` no pasa por la red del emulador: para simular que no
hay conexión hay que quitar el reenvío además de la red, y volver a ponerlos para recuperarla:

```sh
adb reverse --remove tcp:5173
adb shell svc wifi disable
adb shell svc data disable
```

La caché vive en `no_backup/api-cache` (`adb shell run-as app.delyra.debug ls no_backup/api-cache`).
Si el emulador se queda sin espacio (`INSTALL_FAILED_INSUFFICIENT_STORAGE`),
`adb shell pm trim-caches 3G` libera la caché de las apps del sistema.

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

## Llaves de acceso y App Links (F8-10)

- Las huellas de los certificados están en `packages/shared/src/android-app.ts`. Al cambiarlas, se
  regenera `apps/calendar/public/.well-known/assetlinks.json`:
  `pnpm --filter @delyra/shared exec vitest run android-app -u`. Las dos cosas (la API y el fichero)
  van juntas en el mismo despliegue.
- Huella del certificado debug: `keytool -list -v -keystore ~/.android/debug.keystore -alias
androiddebugkey -storepass android` (línea `SHA256`).
- En local las llaves de acceso no funcionan (el `rpId` es `localhost`): Credential Manager abre su
  hoja, pero sin cuenta de Google solo ofrece otro dispositivo. Se prueban en producción.
- App Links sin verificar (en local): `adb shell am start -a android.intent.action.VIEW -d
"https://delyra.app/registro#token=…" app.delyra.debug` abre la app igualmente. En producción,
  `adb shell pm get-app-links app.delyra.debug` dice si Android verificó el dominio.

## Probar R8 en local (build `qa`)

La build `qa` es la de release (R8 y recursos reducidos) firmada con la clave debug y con el
selector de entorno, para usarla contra `pnpm dev` como la de debug. Se instala aparte
(`app.delyra.qa`) y nunca se publica. Antes de cada versión: `./gradlew installQa` y repasar login
con Turnstile y segundo factor, calendario, alta rápida, un tablero (el canal en vivo responde 101
en el log de `pnpm dev`), una tarjeta con algún cambio, Ajustes («Añadir llave de acceso» abre la
hoja de Credential Manager) y administración. Si algo falla solo aquí, falta una regla en
`app/proguard-rules.pro`.

## Publicación en Google Play (F8-11)

Ficha, textos y respuestas de los formularios: [`docs/google-play.md`](../google-play.md).

1. **Web desplegada:** `delyra-calendar` con `mobile/turnstile.html` (sin él no se puede entrar
   desde la app), `.well-known/assetlinks.json` y la política de privacidad al día.
2. **Clave de subida** (una vez, la crea quien publica, nunca en el repositorio; `*.jks` y
   `*.keystore` están en `.gitignore`):
   `keytool -genkeypair -v -keystore delyra-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 9125`.
   El fichero y sus contraseñas, en el gestor de contraseñas. Si se pierde, Play deja cambiar la
   clave de subida (la de la app la guarda Google).
3. **Secretos:** GitHub → Settings → Environments → `android-release` (mejor con revisores
   obligatorios) con `ANDROID_UPLOAD_KEYSTORE_BASE64` (en PowerShell:
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("delyra-upload.jks"))`),
   `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS` (`upload`) y
   `ANDROID_UPLOAD_KEY_PASSWORD`.
4. **AAB:** Actions → «Android release» → Run workflow en main con la versión (`X.Y.Z`, mayor que
   la anterior). Comprueba CI, firma, verifica la firma e imprime la huella de la clave de subida.
   El artefacto `delyra-android-X.Y.Z` trae `app-release.aab` y `mapping.txt`.
5. **Play Console:** crear la app (datos de `docs/google-play.md`), dejar Play App Signing (viene
   activado), subir el AAB a «Pruebas internas» y el `mapping.txt` en el explorador de app bundles
   (para leer los fallos sin ofuscar).
6. **Huella de Play:** Play Console → Integridad de la app → Firma de apps → certificado de la
   clave de firma de apps, SHA-256. Se añade a `ANDROID_CERT_FINGERPRINTS` en
   `packages/shared/src/android-app.ts` y se quita la de debug (decisión de F8-11); se regenera
   `assetlinks.json` (ver arriba) y se despliegan web y API juntas. En un móvil con la app de
   Play, `adb shell pm get-app-links app.delyra` debe dar `delyra.app` como verificado.
7. **Probar en producción** con la app de la pista interna: login, llaves de acceso (añadir una y
   entrar con ella) y App Links de invitación y recuperación.
8. **Producción:** en «Seguridad de los datos», la URL de borrado de cuenta es
   `https://delyra.app/borrar-cuenta` (F8-12). Si la cuenta de desarrollador es personal y reciente, Google exige además una prueba cerrada con
   un mínimo de personas y días antes de abrir producción (las cifras, en Play Console). Para un
   servicio privado por invitación puede bastar la pista de pruebas internas (hasta 100 personas
   por email).
