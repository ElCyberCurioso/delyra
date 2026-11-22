# ADR-0007 · Kanban: orden fraccionario, adjuntos en streaming y alertas de tarjetas

- **Estado:** aceptada (2026-11-22)
- **Fecha:** 2026-11-22
- **Tareas afectadas:** F4-01 a F4-12

## Contexto

El tablero de work.delyra.app necesita reordenar tarjetas y columnas sin reescribir toda la
columna, subir adjuntos sin cargarlos en memoria del Worker ni exponerlos como páginas, y avisar
de las fechas límite con el mismo planificador que los eventos del calendario.

## Decisión

- **Orden con índices fraccionarios** (`fractional-indexing`, columna `position` de texto). Mover
  una tarjeta cambia solo su clave, calculada entre sus vecinas. Si una clave supera 50
  caracteres (muchas inserciones en el mismo hueco) se reequilibra la columna entera con claves
  uniformes, en un único `batch` de D1. El cliente calcula la misma clave para la actualización
  optimista y la sustituye por la del servidor al responder.
- **Movimientos en lote.** `POST /api/cards/:id/move { columnId, index }` actualiza la tarjeta, la
  actividad y `completed_at` (al entrar o salir de una columna «hecha») en un solo `batch`. El
  límite WIP **avisa** (`wipExceeded`), no bloquea.
- **Propiedad.** Todas las tablas llevan `owner_id` y el repositorio filtra siempre por él: un id
  de otro usuario responde 404 y una referencia ajena en el cuerpo (columna de otro tablero,
  etiqueta de otro tablero) responde 422.
- **Adjuntos.** Cuerpo binario (no multipart) con `Content-Length` (máx. 10 MB, se comprueba antes
  de leer) y el nombre en `X-Filename`. Se leen los primeros 512 bytes para decidir el tipo **por
  su contenido** (PNG, JPEG, GIF, WebP, PDF, ZIP/Office; texto y CSV solo si son UTF-8 sin NUL y no
  empiezan como HTML/SVG/XML) y el resto pasa a R2 en streaming con `FixedLengthStream`. El nombre
  se limpia (sin rutas, controles ni reservados, 120 caracteres). La CSRF sigue exigiendo `Origin`
  y, solo en esa ruta, admite un `Content-Type` no JSON si llega `X-Filename`.
- **Descarga** autenticada y siempre como fichero: `Content-Disposition: attachment` (RFC 6266),
  `nosniff`, `Cache-Control: private, no-store` y la CSP de la API, que ahora incluye `sandbox`.
  Borrar adjunto, tarjeta, columna o tablero borra también sus objetos de R2 (prefijo
  `boards/<usuario>/<tablero>/<tarjeta>/`).
- **Alertas de tarjetas.** Misma tabla `reminders` con `target_type = 'card'`: una fecha límite es
  una serie de una sola ocurrencia, de modo que el planificador, la cola, la idempotencia y los
  botones de Telegram son los de ADR-0006. Al terminar o archivar la tarjeta la alerta se apaga;
  al reabrirla se vuelve a programar. Por defecto: 1 hora antes (con hora) o a las 9:00 del día
  (todo el día).
- **Autoarchivado** con un segundo Cron Trigger (`0 3 * * *`): archiva las terminadas hace más de
  `autoarchive_days` días (14 por defecto, 0 = nunca), en lotes de 500, con actividad
  `autoarchived`. Se pueden restaurar desde la vista de archivadas.
- **Markdown** de las descripciones con markdown-it (`html: false`) y DOMPurify con una lista
  cerrada de etiquetas y solo enlaces `http(s)`/`mailto`, que se abren con
  `rel="noopener noreferrer nofollow"`.
- **Arrastrar y soltar** con dnd-kit: ratón (6 px de umbral, para no confundirlo con un clic),
  táctil (200 ms de pulsación) y teclado (espacio coge y suelta, flechas mueven —izquierda y
  derecha saltan de columna—, Escape cancela, Intro abre la tarjeta), con anuncios en español.
  Con filtros activos, el índice visible se traduce al de la columna completa.

## Consecuencias

- El reequilibrado es raro y acotado (una columna), pero reescribe todas sus claves.
- Un fichero que el detector no reconoce se rechaza (415) aunque sea legítimo; la lista se amplía
  añadiendo su firma en `services/attachments.ts`.
- Las alertas de tarjeta se recrean al cambiar la fecha: un aviso pospuesto de la fecha anterior
  se pierde, lo que es lo esperado.
