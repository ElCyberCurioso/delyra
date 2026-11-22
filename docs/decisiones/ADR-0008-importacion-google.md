# ADR-0008 · Importación desde Google Calendar sin tokens de larga duración

- **Estado:** aceptada (2026-11-22)
- **Fecha:** 2026-11-22
- **Tareas afectadas:** F5-01 a F5-07

## Contexto

Hay que traer a Delyra los calendarios de Google (eventos, repeticiones, excepciones, colores y
recordatorios) sin quedarse con acceso permanente a la cuenta: la verificación de Google para
guardar refresh tokens y el tope de 100 usuarios de las apps sin verificar lo hacen poco práctico,
y un token de larga duración es un riesgo que no compensa en un calendario personal. Además, los
ficheros que se importan los controla quien los sube: pueden estar mal formados o ser hostiles
(zip bomb, ICS gigantes, HTML en los textos).

## Decisión

- **Tres vías, un único formato intermedio.** El `.zip`/`.ics` de «Exportar», la API de Google
  (OAuth) y la dirección iCal secreta se convierten primero a `ImportedEvent` (`lib/import-model.ts`),
  ya validado y saneado, y solo ese formato llega a la base de datos (`services/import-apply.ts`).
- **Parser ICS propio sobre ical.js.** El texto se recorre buscando los bloques `VEVENT` y
  `VTIMEZONE`, e ical.js procesa cada bloque por separado (no el árbol entero de un fichero
  grande). Zonas: IANA, prefijos de Mozilla, nombres de Windows habituales y, si no, el
  `VTIMEZONE` del propio fichero. `UNTIL` en UTC pasa a la hora flotante de la zona del evento
  (como guarda las reglas ADR-0005); frecuencias por horas o minutos, `RDATE` y partes
  desconocidas se ignoran con un aviso. Las ocurrencias canceladas pasan a `EXDATE` y las
  movidas, a excepciones (`recurring_event_id` + `original_start`).
- **Sin duplicados.** Cada serie o evento suelto guarda su `UID` en `events.ical_uid` (índice
  único parcial por calendario). Repetir una importación actualiza en su sitio (en cualquier
  calendario propio) lo que haya cambiado y no toca lo demás; las ocurrencias que el usuario
  borró siguen borradas. Un calendario de destino «nuevo» solo se crea si llega a insertarse algo.
- **Workflow por lotes** (`ImportWorkflow`, binding `IMPORT_WORKFLOW`). Fase de análisis: el
  fichero (subido en streaming a `delyra-imports`, como los adjuntos) se descomprime y cada
  calendario se convierte y se trocea en R2 (`imports/<usuario>/<id>/cal-<n>/<k>.json`, 250
  eventos); la fila `imports` queda en `ready` con la vista previa. Fase de importación: cada
  trozo es un paso reintentable e idempotente. Los errores de formato o de límites se registran
  con su mensaje y se cortan con `NonRetryableError` (sin cambiarle el nombre: el motor lo
  reconoce por él). Al terminar se borran los datos temporales; el ciclo de vida del bucket (7
  días) es la red de seguridad.
- **Límites** (F5-07): 25 MB de subida, 60 MB descomprimidos contados byte a byte al salir del
  descompresor (no se confía en los tamaños que declara el zip), 50 calendarios, 30 000 eventos,
  textos recortados a los límites de los eventos, una importación en marcha por usuario y 20 al
  día. El tipo del fichero se decide por su contenido (`PK\x03\x04` o `BEGIN:VCALENDAR`).
- **Textos.** Todo se guarda como texto plano: se quitan las etiquetas HTML (Google manda las
  notas en HTML), los caracteres de control y de dirección del texto; las URL solo si son
  `http(s)`. La interfaz pinta estos campos siempre como texto.
- **OAuth** (`/api/google/*`): `POST /authorize` (pasa por la CSRF) devuelve la URL de Google con
  PKCE S256 y deja `state` + `code_verifier` en una cookie `__Secure-delyra-google` cifrada con
  AES-GCM, ligada al usuario, `HttpOnly`, `SameSite=Lax`, `Path=/api/google/callback`, 10 minutos y
  de un solo uso. El callback exige sesión, compara el `state` en tiempo constante y canjea el
  código. Scope `calendar.readonly` y `access_type=online`: no hay refresh token (si llegara, se
  descarta). El token de acceso (~1 h) se guarda cifrado en la fila solo mientras el Workflow
  descarga los calendarios; se borra al acabar el análisis y, como red de seguridad, el cron diario
  borra cualquiera de más de una hora.
- **Suscripción iCal** (`/api/subscriptions`): solo `https://calendar.google.com/calendar/ical/….ics`
  (sin credenciales, puertos ni `..`), validado al crearla y antes de cada descarga, sin seguir
  redirecciones, con 20 s y 25 MB como máximo. La dirección se guarda cifrada y nunca vuelve al
  cliente ni a los logs (solo una versión enmascarada). Se sincroniza cada hora desde el
  planificador de cada minuto (unas pocas por pasada, reclamándolas para no duplicar) con
  `If-None-Match`/`If-Modified-Since`; ante errores, reintentos espaciados hasta un día. Su
  calendario es de solo lectura (`calendars.read_only`): la API rechaza crear, mover, editar o
  borrar sus eventos y la sincronización refleja el origen (lo que desaparece se borra).
- **Páginas públicas** `/privacidad` y `/terminos` en el calendario, que exige la pantalla de
  consentimiento de Google.

## Consecuencias

- Un evento movido a otro calendario tras importarlo se sigue actualizando en su nuevo sitio.
- Si una persona tiene el mismo calendario importado y suscrito, son dos copias independientes
  (la suscripción solo mira su propio calendario).
- Lo que no admite el modelo (repeticiones por horas, `RDATE`, colores por evento) se pierde con
  un aviso visible en la vista previa y en el informe.
- Sin `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` la conexión directa no aparece; las vías por
  archivo y por iCal funcionan igual (docs/runbooks/google-calendar.md).
