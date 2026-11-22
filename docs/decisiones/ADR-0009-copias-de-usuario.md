# ADR-0009 · Copias de seguridad de usuario, restauración con deshacer y retención por niveles

- **Estado:** aceptada (2026-11-22)
- **Fecha:** 2026-11-22
- **Tareas afectadas:** F6-01 a F6-09

## Contexto

Cada persona tiene que poder llevarse sus datos y recuperarlos (también por error propio), y la
plataforma tiene que poder volver a un punto anterior. Una copia la puede manipular quien la sube,
así que restaurarla no puede servir para escribir en datos ajenos ni para colar ids.

## Decisión

- **Formato v1** (`docs/formato-backup.md`): un `.zip` con `backup.json` (cabecera, SHA-256 de
  `JSON.stringify(data)` y los datos) y los adjuntos en `attachments/<id>`. Se excluyen secretos
  (contraseña, TOTP, tokens, chat de Telegram) y las suscripciones iCal.
- **Exportación en streaming**: fflate genera el zip a trozos y se sube a R2 con multipart (partes
  iguales de 8 MiB), así que la memoria no depende del tamaño. Los adjuntos van primero (para
  conocer su SHA-256) y `backup.json` al final. Siempre deflate (nivel 0 para adjuntos): una
  entrada «stored» de tamaño desconocido no se puede leer luego en streaming.
- **Workflow `BackupWorkflow`** con tres operaciones: exportar, validar y restaurar.
  - Validar comprueba tamaño, versión (con hueco para migraciones), checksum, esquema Zod con los
    límites de la API, unicidad e integridad de **todas** las referencias dentro de la copia y el
    SHA-256 de cada adjunto, y deja los datos troceados en `delyra-imports` (7 días).
  - Restaurar hace primero una copia `pre_restore` de lo que hay (para deshacer), vacía los datos
    si se reemplaza y después restaura por trozos. Los ids nuevos son **deterministas**
    (UUIDv7 a partir de restauración + id de la copia) y todo se inserta con
    `ON CONFLICT DO NOTHING`: un paso reintentado no duplica nada. El propietario es siempre
    quien restaura.
  - **Fusionar**: los calendarios con el mismo nombre se juntan, los eventos idénticos
    (calendario, tipo, título, inicio, fin, regla) no se duplican y los tableros se añaden (con
    «(restaurado)» si el nombre ya existe). **Reemplazar**: borra calendarios propios, eventos,
    alertas, tableros y adjuntos (no las suscripciones) y aplica también el perfil.
  - **Deshacer** = restaurar en modo reemplazar la copia `pre_restore`, sin pedir confirmación.
- **Copias automáticas** desde el cron diario (03:00 UTC): a quien le toca según su frecuencia
  (diaria, semanal —por defecto— o mensual) se le lanza una instancia del Workflow
  (`createBatch`). Se conservan N automáticas (4 por defecto, hasta 12), 10 manuales y 3 previas a
  restaurar; la aplicación borra las sobrantes (fila y fichero).
- **Una operación a la vez** por usuario (copia o restauración) y cuotas diarias.
- **Exportaciones sueltas**: un calendario en ICS (TZID IANA, `UNTIL` en UTC, `EXDATE`,
  `RECURRENCE-ID` y `VALARM`; se vuelve a leer igual con el parser de F5) y un tablero en CSV
  (protegido contra inyección de fórmulas) o JSON legible.
- **Sistema** (F6-06, F6-08): el backup diario se copia a `weekly/` los domingos y a `monthly/` el
  día 1; reglas de ciclo de vida de 30 días, 12 semanas y 12 meses; aviso por email a los
  administradores si falla; panel de admin con estado, ficheros y botón manual. Restauración por
  Time Travel o desde un volcado en `docs/runbooks/restauracion.md`.

## Consecuencias

- Restaurar cambia los ids: los enlaces antiguos (p. ej. «Abrir» de una alerta de Telegram ya
  enviada) dejan de apuntar al evento.
- Deshacer vuelve a como estaba todo justo antes de restaurar: lo cambiado después se pierde.
- Fusionar la misma copia dos veces no duplica eventos, pero sí añade los tableros otra vez.
- Las copias crecen con los adjuntos; el límite de subida para restaurar es de 200 MB.
