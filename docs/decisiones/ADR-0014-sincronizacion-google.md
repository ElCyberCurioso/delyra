# ADR-0014 · Sincronización continua de Google a Delyra

- **Estado:** aceptada (2026-11-23)
- **Fecha:** 2026-11-23
- **Tareas afectadas:** F7-09 (segunda parte)
- **Modifica:** ADR-0008 (que no guardaba ningún token de Google)

## Contexto

La importación (ADR-0008) es puntual y la suscripción a la dirección iCal secreta se pone al día
cada hora, pero hay que copiar a mano una dirección secreta por calendario. El plan pide
«sincronización continua con Google». Se eligió el alcance **solo de Google a Delyra**: en Delyra
los calendarios sincronizados son de solo lectura y se editan en Google.

## Decisión

- **Permiso permanente solo para sincronizar.** Una conexión aparte
  (`POST /api/google/sync/authorize`) pide `access_type=offline` y `prompt=consent`; la importación
  puntual sigue con `access_type=online` y sin guardar nada. El `state` de OAuth lleva el
  propósito (`import`/`sync`) dentro de la cookie cifrada. Mismo scope, `calendar.readonly`.
- **Tokens cifrados** en `google_connections` (migración 0015): el de actualización con AES-GCM y
  AAD `google-refresh:<persona>:<conexión>`, y el último de acceso (~1 h) con su caducidad para no
  pedir uno nuevo en cada calendario. Nunca vuelven al cliente ni a los logs. Se guarda el email
  de la cuenta (id del calendario principal) solo para mostrar cuál está conectada.
- **Calendarios elegidos uno a uno** (`google_synced_calendars`, máximo 10): cada uno se refleja
  en un calendario de Delyra de solo lectura con el nombre y el color de Google. Sus recordatorios
  se convierten en alertas si la persona lo marca.
- **Cada 15 minutos**, desde el planificador de cada minuto (unos pocos por pasada, reclamándolos
  para no duplicar): consulta incremental con el `syncToken` de Google. Sin cambios, no se toca la
  base de datos. Con cambios, o si el token caducó (`410`), se descarga el calendario entero y se
  refleja igual que la suscripción iCal (`mirrorCalendar`, extraída de ella): crea, actualiza y
  borra lo que ya no está. La primera descarga va en segundo plano (`waitUntil`) y la pantalla
  consulta el estado mientras tanto. Errores con reintentos espaciados hasta un día; un calendario
  que ya no está en la cuenta (`404`) se reintenta una vez al día.
- **Permiso retirado o caducado** (`invalid_grant`): la conexión queda `revoked`, se borra el token
  de acceso y no se vuelve a llamar a Google hasta que la persona reconecte; al reconectar, todo se
  pone al día enseguida.
- **Desconectar** revoca el token en Google (`/revoke`), borra la conexión y los calendarios
  sincronizados de Delyra (siguen en Google). Dejar de sincronizar uno borra su copia. Las
  copias de usuario no incluyen tokens ni conexiones.
- **Sin notificaciones push de Google** (canales `watch`): exigen un webhook verificado y renovar
  canales; con consultas incrementales cada 15 minutos el coste es pequeño.

## Requisito en Google Cloud

Mientras la app esté «en pruebas», Google caduca los tokens de actualización **a los 7 días**: la
conexión pasa a «revocada» y hay que reconectar cada semana. Para que dure, hay que publicar la app
y pasar la verificación de Google para el scope `calendar.readonly` (sensible, no restringido: no
pide auditoría de seguridad externa). Pasos en `docs/runbooks/google-calendar.md`.

## Alternativas descartadas

- **En los dos sentidos** (escribir en Google lo que cambia en Delyra): necesita
  `calendar.events`, resolver conflictos y traducir el modelo de repeticiones en sentido contrario;
  mucho más riesgo para el uso que se espera.
- **Reutilizar la suscripción iCal con más frecuencia:** sigue exigiendo copiar direcciones
  secretas y no trae recordatorios ni el color del calendario.

## Consecuencias

- El modelo de amenazas añade un secreto de larga duración por persona (mitigaciones arriba).
- La política de privacidad explica qué se guarda, durante cuánto tiempo y cómo revocarlo.
