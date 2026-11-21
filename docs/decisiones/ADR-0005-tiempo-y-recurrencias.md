# ADR-0005 · Modelo de tiempo, recurrencias y alertas

- **Estado:** aceptada (2026-11-21)
- **Fecha:** 2026-11-21
- **Tareas afectadas:** F2-01, F2-04, F2-05, F2-06, F2-07 (y las alertas de tarjetas de la Fase 4)

## Contexto

El calendario debe mostrar bien eventos con hora, de día completo y recurrentes en la zona del
usuario, también al cruzar los cambios de horario (último domingo de marzo y de octubre en
`Europe/Madrid`), y calcular cuándo avisar de cada uno.

## Decisión

### Cómo se guarda el tiempo

- **Con hora:** `start_at`/`end_at` son instantes UTC (ms) y `tz` es la zona en la que se creó el
  evento. La API recibe y devuelve instantes ISO 8601.
- **Día completo:** fechas sin hora guardadas como medianoche UTC; `end_at` es exclusivo (un evento
  de un día termina al día siguiente). La API usa `AAAA-MM-DD`. No dependen de la zona.

### Recurrencias

- Regla RFC 5545 sin `DTSTART` (`FREQ=WEEKLY;BYDAY=MO`), validada con `rrule`: solo frecuencias
  diaria, semanal, mensual o anual, sin `BYHOUR`/`BYMINUTE`, `COUNT` ≤ 1000.
- Se expande **en el servidor** y en **hora local flotante** de la zona del evento: la regla se
  aplica a la hora de pared (sin cambios de horario) y cada ocurrencia se convierte a instante con
  `packages/shared/src/time.ts` (solo `Intl`, sin depender de la zona del sistema). «Los lunes a las 10:00» sigue a las 10:00 todo el año; la duración real se
  conserva. Hora inexistente (marzo): se adelanta; hora duplicada (octubre): la primera.
- `GET /api/events?from&to` devuelve ocurrencias de un rango de 400 días como máximo.
  `series_end_at` permite descartar en SQL las series ya terminadas.

### Excepciones

- **Borrar una ocurrencia:** su inicio original va a `exdates`.
- **Editar «solo este»:** una fila de excepción con `recurring_event_id` y `original_start` que
  sustituye a la ocurrencia (única por serie e inicio). Se borra de verdad, no con `deleted_at`.
- **«Este y los siguientes»:** la serie se parte. La anterior termina con `UNTIL` justo antes (o
  reparte `COUNT`) y se crea una serie nueva; las excepciones posteriores se descartan y los
  borrados posteriores pasan a la nueva (desplazados si cambia la hora).
- **«Todos» con otra hora:** borrados y excepciones se desplazan en hora local para seguir
  apuntando a su ocurrencia; los que la nueva regla ya no genera se descartan.

### Cumpleaños

Tipo `birthday`: día completo, anual, con `birth_year` opcional (la ocurrencia trae `age`) y
`feb29_rule` (`feb28` o `mar1`) para los nacidos un 29 de febrero. Alertas por defecto: el día
anterior y el mismo día a las 9:00.

### Alertas (`next_fire_at`)

- `offset_minutes` antes del inicio; en día completo, respecto a las 00:00 en la zona del usuario
  (negativo = ese mismo día). Al cambiar la zona en Ajustes se recalculan.
- El cálculo es común (`services/reminder-schedule.ts`): recorre las ocurrencias futuras de la
  serie, salta las borradas y usa el nuevo inicio de las movidas. Servirá igual para las tarjetas.
- `reminders` es polimórfica (`target_type` + `target_id`, sin clave foránea): al borrar un evento
  o un calendario se borran explícitamente sus alertas.

### Permisos

Repositorios ligados al usuario (`calendarRepository(db, ownerId)`, `eventRepository(db, ownerId)`):
no existe forma de consultar sin `owner_id`. Ids ajenos en la ruta → 404; un `calendarId` ajeno en
el cuerpo → 422, igual que uno inexistente.

### Interfaz (FullCalendar)

- FullCalendar trabaja en `timeZone: "UTC"` y recibe la hora de pared de la zona del usuario
  (10:00 en Madrid se le pasa como `…T10:00:00Z`); al arrastrar o seleccionar, la fecha vuelve a
  instante real con las mismas funciones. Así no hace falta el plugin de zonas con nombre, y la línea de
  «ahora» usa la misma conversión.
- Cada vista pide su rango visible a la API (TanStack Query, con los datos anteriores mientras
  carga); visibilidad de calendarios y filtro de tipo se aplican en el cliente.
- Arrastrar o redimensionar es optimista: se pinta al momento y se deshace si la API falla. En una
  serie se pregunta el alcance; «todos» desplaza la serie lo mismo que la ocurrencia movida.

## Consecuencias

- Cambiar la zona de un evento con hora no mueve los instantes ya guardados; solo cambia cómo se
  repite a partir de ahí.
- La expansión en el servidor limita el rango por petición; la vista anual pide un año entero.
