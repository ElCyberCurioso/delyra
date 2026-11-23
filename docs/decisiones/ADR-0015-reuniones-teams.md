# ADR-0015 · Reuniones de Teams en un tablero

- **Estado:** aceptada (2026-11-23)
- **Fecha:** 2026-11-23
- **Plan:** docs/plan-teams.md

## Contexto

Se quiere que las reuniones de Teams (y, si se elige, el resto de eventos del calendario de
Microsoft 365) aparezcan solas como tarjetas en un tablero y se mantengan al día. Las reuniones de
Teams son eventos de Exchange con `isOnlineMeeting` y su enlace en `onlineMeeting.joinUrl`.

## Decisión

- **Microsoft Graph con OAuth 2.0 + PKCE** (`login.microsoftonline.com/<inquilino>`), permisos
  delegados `offline_access`, `User.Read` y `Calendars.Read`. La conexión se pide desde los ajustes
  de un tablero en work.delyra.app (`/api/microsoft/authorize` → `/api/microsoft/callback`, con
  `state` y verificador en una cookie cifrada de un solo uso, ligada a la persona y al tablero).
- **Tokens** en `microsoft_connections` (migración 0017), cifrados con AES-GCM y AAD por persona y
  conexión. Microsoft **rota el token de actualización**: cada renovación guarda el nuevo.
  `invalid_grant` deja la conexión revocada hasta reconectar. Desconectar borra los tokens (Microsoft
  no ofrece revocarlos desde la app; la pantalla remite a la página de permisos de la cuenta).
- **Datos mínimos**: de cada evento solo se pide id, asunto, horario, lugar, organizador, si está
  cancelado y el enlace de Teams (`$select`), nunca el cuerpo ni los asistentes. Horas en UTC
  (`Prefer: outlook.timezone="UTC"`). Los enlaces de paginación solo se siguen si son de
  `graph.microsoft.com`, y el de Teams solo se usa si es `https://teams.microsoft.com` o
  `teams.live.com`.
- **Un tablero, las reuniones de una persona** (`microsoft_board_syncs`): quien lo configura (con
  permiso de edición) elige columna, días por delante (7/14/30) y si solo Teams o todo. Otra
  persona no puede pisarlo; quitarlo, quien lo configuró o el dueño del tablero.
- **Reconciliación cada 15 minutos** (planificador de cada minuto, unos pocos tableros por pasada):
  `calendarView` de hace 12 horas a N días, con las repeticiones ya expandidas. Cada evento tiene su
  tarjeta (`microsoft_synced_cards`) con lo último que escribió Delyra (título, inicio y hash de la
  descripción). Nuevo → tarjeta con fecha, descripción en Markdown escapado, etiqueta «Teams» y sin
  alertas (Outlook y Teams ya avisan). Cambiado → se actualiza cada campo **solo si la tarjeta lo
  conserva tal como lo dejó Delyra**. Cancelado, borrado (404 al consultarlo) o, con «solo Teams»,
  sin enlace → la tarjeta se archiva. Lo que la persona añade (notas, checklist, comentarios,
  adjuntos) no se toca nunca. Cada cambio avisa al canal en vivo del tablero.
- **Sin notificaciones push de Graph**: exigen un webhook validado y renovar la suscripción cada
  pocos días; cada 15 minutos basta.

## Requisitos fuera del código (P-12)

Registrar la app en Microsoft Entra ID (docs/runbooks/microsoft-teams.md). En una organización que
no deja a cada persona autorizar apps de terceros, hace falta el consentimiento de su administrador;
para que personas de otras organizaciones puedan consentir sin él, Microsoft pide además la
verificación del editor. Con una app de un solo inquilino (la propia organización) no hace falta.

## Alternativas descartadas

- **Suscribirse al calendario publicado de Outlook (ICS)**: muchas organizaciones lo desactivan y no
  da de forma fiable el enlace de Teams.
- **API de Teams (`onlineMeetings`)**: solo da reuniones creadas por la propia app; las del
  calendario están en Exchange.
- **Escribir en el calendario desde el tablero**: fuera del alcance pedido y exigiría
  `Calendars.ReadWrite`.
