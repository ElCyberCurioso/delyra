# Google Play · Ficha y formularios (F8-11)

Textos y respuestas para Play Console. Los pasos (clave de subida, workflow, subida, huella de Play
App Signing) están en el [runbook de Android](runbooks/android.md#publicación-en-google-play-f8-11).
Si cambia lo que la app guarda o envía, se actualiza a la vez este documento, la
[política de privacidad](../apps/calendar/src/legal/legal-pages.tsx) y el formulario de Play.

## Datos de la app

| Campo                   | Valor                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Nombre                  | Delyra                                                                |
| Paquete                 | `app.delyra`                                                          |
| Idioma predeterminado   | Español (España) – es-ES; traducción: inglés (Estados Unidos) – en-US |
| Tipo                    | App, gratuita                                                         |
| Categoría               | Productividad                                                         |
| Política de privacidad  | `https://delyra.app/privacidad` (también en la app: Ajustes)          |
| Anuncios                | No                                                                    |
| Público objetivo        | 18 años o más; no está dirigida a menores                             |
| Borrado de cuenta (URL) | `https://delyra.app/borrar-cuenta` (F8-12)                            |

## Ficha en español (es-ES)

**Descripción breve** (máx. 80):

> Calendario y tableros de tareas en una sola cuenta, con alertas y sin conexión.

**Descripción completa:**

> Delyra junta tu calendario y tus tableros de tareas en una sola cuenta, la misma que usas en
> delyra.app y work.delyra.app.
>
> Calendario
> • Vistas de día, 3 días, semana, mes, año y agenda, adaptadas al móvil, al plegable y a la
> tablet.
> • Eventos con repetición, zona horaria, alertas y cumpleaños, y los festivos de tu región.
> • Alta rápida escrita o dictada: «cena el viernes a las 9».
> • Importa un .ics o tu copia de Google Calendar, y sincroniza con Google.
>
> Tareas
> • Tableros kanban con columnas, límites de trabajo en curso, etiquetas, listas, comentarios y
> adjuntos.
> • Comparte tableros y ve los cambios de los demás en vivo.
> • Las tarjetas con fecha aparecen en tu calendario.
>
> Seguridad
> • Acceso solo por invitación y verificación en dos pasos obligatoria (app autenticadora o llave
> de acceso).
> • Sin anuncios, sin analítica y sin rastreo. Datos en la Unión Europea.
>
> Sin conexión: abre lo último que has visto aunque no tengas red.
>
> Delyra es un servicio privado: necesitas una invitación para crear la cuenta.

## Ficha en inglés (en-US)

**Short description:**

> Calendar and task boards in one account, with alerts and offline access.

**Full description:**

> Delyra brings your calendar and your task boards together in one account, the same one you use
> on delyra.app and work.delyra.app.
>
> Calendar
> • Day, 3-day, week, month, year and agenda views, made for phones, foldables and tablets.
> • Events with repeats, time zones, alerts and birthdays, plus your region's holidays.
> • Quick add by typing or dictation: "dinner Friday at 9pm".
> • Import an .ics file or your Google Calendar export, and sync with Google.
>
> Tasks
> • Kanban boards with columns, work-in-progress limits, labels, checklists, comments and
> attachments.
> • Share boards and see other people's changes live.
> • Cards with a due date show up in your calendar.
>
> Security
> • Invitation-only access and mandatory two-step verification (authenticator app or passkey).
> • No ads, no analytics, no tracking. Data stored in the European Union.
>
> Offline: open what you last viewed even without a connection.
>
> Delyra is a private service: you need an invitation to create an account.

## Recursos gráficos

Todo está en [`docs/google-play/`](google-play/), listo para subir:

| Recurso                | Fichero                                          | Tamaño               |
| ---------------------- | ------------------------------------------------ | -------------------- |
| Icono                  | `icono-512.png` (a sangre: Play pone la máscara) | 512 × 512, 32 bits   |
| Gráfico de funciones   | `grafico-funciones-es.png` y `-en.png`           | 1024 × 500, sin alfa |
| Capturas de teléfono   | `movil/` (6)                                     | 1080 × 1920 (9:16)   |
| Capturas de tablet 7″  | `tablet-7/` (3)                                  | 1440 × 2560 (9:16)   |
| Capturas de tablet 10″ | `tablet-10/` (3)                                 | 2560 × 1440 (16:9)   |

- Las capturas son de la app en español, con la cuenta de demo `demo-play@delyra.test` («Lucía
  Romero») contra `pnpm dev` y datos de ejemplo (calendarios, eventos de la semana del 23 de
  noviembre de 2026 y dos tableros). Nunca con datos reales.
- Se hicieron en el emulador de teléfono cambiando la pantalla (`adb shell wm size` y
  `wm density`: 1080×1920 a 420 ppp; 1440×2560 a 320; 2560×1440 a 320) y con la barra de estado
  en modo demo (`com.android.systemui.demo`: 9:41, wifi y batería llenos, sin notificaciones).
- Para la ficha en inglés valen las mismas capturas; si se quieren en inglés, se repiten con la app
  en inglés (`adb shell cmd locale set-app-locales app.delyra.debug --locales en-US`).
- El gráfico y el icono se regeneran con `python docs/google-play/fuentes/render.py` (Chrome sin
  interfaz y Pillow), a partir de `feature.html` e `icon.html`.

## Acceso a la app (para la revisión de Google)

Toda la app está detrás del login. Se crea una cuenta de revisión con una invitación normal y datos
de ejemplo, y en Play Console («Acceso a la app») se dan el email, la contraseña y códigos de
recuperación (cada uno vale una vez; la verificación en dos pasos es obligatoria). Esas credenciales
solo se escriben en Play Console, nunca en el repositorio. Al terminar la revisión se puede
desactivar la cuenta desde la administración.

## Clasificación del contenido

Cuestionario IARC, categoría «Todas las demás apps»: sin violencia, sexo, lenguaje soez, drogas ni
apuestas. Interacción entre usuarios: sí, pero solo con personas invitadas a un tablero compartido
(no hay contenido público ni chat abierto). Comparte la ubicación: no. Compras digitales: no.

## Seguridad de los datos

- **¿Recoge o comparte datos?** Recoge; no comparte. Cloudflare es el proveedor que aloja el
  servicio (no cuenta como compartir). Lo que va a Google, Microsoft o Telegram lo inicia la persona
  usuaria al conectarlos (transferencia iniciada por el usuario).
- **Cifrado en tránsito:** sí (solo HTTPS).
- **Borrado:** la persona usuaria puede eliminar su cuenta y sus datos desde Ajustes, en la app o
  en la web (F8-12); `https://delyra.app/borrar-cuenta` explica cómo. Se borra al momento; solo
  quedan en las copias del sistema hasta que caducan (como mucho, un año).

| Tipo de dato (Play)                  | Qué es en Delyra                                           | Para qué                            | Opcional |
| ------------------------------------ | ---------------------------------------------------------- | ----------------------------------- | -------- |
| Información personal · Nombre        | Nombre de la cuenta                                        | Funcionalidad, gestión de la cuenta | No       |
| Información personal · Email         | Email de la cuenta                                         | Funcionalidad, gestión de la cuenta | No       |
| Calendario · Eventos del calendario  | Calendarios y eventos                                      | Funcionalidad                       | No       |
| Archivos y documentos                | Adjuntos de tarjetas, ficheros importados y copias         | Funcionalidad                       | Sí       |
| Actividad en la app · Otro contenido | Tableros, tarjetas, listas y comentarios                   | Funcionalidad                       | No       |
| Ubicación · Aproximada               | País de cada inicio de sesión (de la IP, que no se guarda) | Seguridad y prevención del fraude   | No       |

No se recogen: audio (el dictado lo hace el reconocimiento de voz del móvil y a Delyra solo llega
el texto), contactos, fotos, ubicación precisa, identificadores de publicidad, datos de uso o de
diagnóstico de la app (no hay analítica ni informes de fallos propios).
