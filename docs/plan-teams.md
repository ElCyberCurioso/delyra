# Plan · Reuniones de Teams en un tablero (noviembre de 2026)

> **Estado:** bloques 1 a 4 implementados (ADR-0015, runbook `docs/runbooks/microsoft-teams.md`).
> Falta el bloque 5, a tu cargo: registrar la app en Entra ID y cargar sus secretos.

Objetivo: que las reuniones y eventos del calendario de Microsoft 365 (donde viven las reuniones de
Teams) aparezcan solos, como tarjetas, en un tablero de Delyra, y se mantengan al día.

## ¿Es posible?

Sí. Las reuniones de Teams son eventos del calendario de Outlook/Exchange con
`isOnlineMeeting = true` y su enlace en `onlineMeeting.joinUrl`. **Microsoft Graph** los da con
`GET /me/calendarView` (expande las repeticiones en ocurrencias sueltas), con permiso delegado
`Calendars.Read` (solo lectura) y `offline_access` para seguir leyendo sin que la persona esté
delante. Es el mismo esquema que la sincronización con Google (ADR-0014).

**Condiciones que no dependen del código:**

| Tipo de cuenta                                       | Qué hace falta                                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft 365 de una organización que tú administras | Registrar la app en Microsoft Entra ID de esa organización (un solo inquilino). Como administrador, puedes dar el consentimiento.                                                           |
| Microsoft 365 de una empresa que no administras      | Lo mismo, pero en el inquilino de la empresa lo tiene que aprobar su administrador (muchas empresas no dejan que cada persona autorice apps de terceros). Sin esa aprobación no es posible. |
| Cuenta personal (Teams gratuito, Outlook.com)        | App multiinquilino («cuentas de cualquier organización y personales»). Funciona sin verificación, con el aviso de «editor no verificado».                                                   |

Alternativa sin OAuth: publicar el calendario de Outlook como ICS y suscribirse (como la suscripción
de Google). Muchas empresas lo tienen desactivado y no da el enlace de Teams de forma fiable, así
que no se elige como vía principal.

## Decisiones

- **Conexión con Microsoft 365 por persona** (`/api/microsoft/*`): OAuth 2.0 con PKCE contra
  `login.microsoftonline.com/<inquilino>` (por defecto `common`), permisos `offline_access`,
  `User.Read` y `Calendars.Read`. El token de actualización se guarda cifrado (AES-GCM, AAD por
  persona y conexión) y **se sustituye en cada renovación** (Microsoft los rota). No se descarga
  nunca el cuerpo de las reuniones: solo asunto, horario, lugar, organizador y enlace de Teams.
- **Volcado por tablero**: en los ajustes del tablero se elige la columna de destino, cuántos días
  por delante (7, 14 o 30) y si solo reuniones de Teams o todos los eventos. Un tablero recibe las
  reuniones de una sola persona (quien lo configura, con permiso de edición).
- **Cada reunión, una tarjeta**: título = asunto; fecha límite = inicio; descripción con horario,
  organizador, lugar y «Unirse a la reunión» (solo enlaces `https://teams.microsoft.com` o
  `teams.live.com`); etiqueta «Teams». Sin alertas por defecto (Outlook y Teams ya avisan).
- **Cambios**: si la reunión cambia, se actualizan título, fecha y descripción **salvo lo que la
  persona haya editado** en la tarjeta (se compara con lo último que escribió Delyra). Si se
  cancela o se borra, la tarjeta se archiva. Lo que la persona añada (notas, checklist,
  comentarios, adjuntos) nunca se toca.
- **Cada 15 minutos** desde el planificador de cada minuto, como Google. Errores con reintentos
  espaciados; permiso retirado (`invalid_grant`) → conexión revocada hasta reconectar.
- **Desconectar** borra los tokens y deja de volcar; las tarjetas se quedan (ya son del tablero).
  Microsoft no ofrece revocar el token desde la app: la pantalla enlaza a la página de permisos de
  la cuenta.

## Bloques

1. **Conexión con Microsoft 365** — tablas `microsoft_connections`, OAuth (autorizar, callback,
   desconectar), cliente de Graph, rotación de tokens. Tests con Microsoft simulado.
2. **Volcado al tablero** — tablas `microsoft_board_syncs` y `microsoft_synced_cards`, motor de
   reconciliación (crear, actualizar respetando ediciones, archivar canceladas), planificador,
   aviso en vivo al tablero. Tests de cada caso.
3. **Interfaz** — sección «Reuniones de Teams» en los ajustes del tablero: conectar, columna y
   opciones, estado, «Actualizar ahora», dejar de volcar y desconectar. Español e inglés.
4. **Documentación y privacidad** — ADR-0015, runbook de Microsoft (registro de la app en Entra
   ID, secretos, consentimiento del administrador), política de privacidad y modelo de amenazas.
5. **A tu cargo (P-12)** — registrar la app en Entra ID y cargar `MICROSOFT_CLIENT_ID`,
   `MICROSOFT_CLIENT_SECRET` y, si es de un solo inquilino, `MICROSOFT_TENANT_ID`.
