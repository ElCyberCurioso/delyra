# Runbook · Importación desde Google Calendar (F5)

Tres vías (ADR-0008), todas desde **delyra.app/importar** (o «Importar desde Google» en la barra
lateral del calendario):

| Vía                             | Necesita configuración        | Qué hace                                                   |
| ------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| Archivo `.zip`/`.ics` exportado | Nada                          | Importación puntual, sin duplicados al repetir             |
| Cuenta de Google (OAuth)        | P-11 y dos secretos (abajo)   | Importación puntual desde la API, con colores              |
| Dirección iCal secreta          | Nada                          | Calendario de solo lectura, al día cada hora               |
| Sincronización con Google       | P-11, secretos y verificación | Calendarios de solo lectura, al día cada 15 min (ADR-0014) |

## P-11 · Proyecto de Google Cloud (solo para la vía OAuth)

1. En [console.cloud.google.com](https://console.cloud.google.com) crea un proyecto (p. ej.
   «Delyra») y, en _APIs y servicios → Biblioteca_, habilita **Google Calendar API**.
2. _APIs y servicios → Pantalla de consentimiento de OAuth_ (Google Auth Platform):
   - Tipo **Externo**, nombre **Delyra**, email de asistencia y de contacto tuyos.
   - Dominio autorizado: `delyra.app`.
   - Página principal `https://delyra.app`, política de privacidad
     `https://delyra.app/privacidad` y condiciones `https://delyra.app/terminos`.
   - _Acceso a datos_ → añade el scope `https://www.googleapis.com/auth/calendar.readonly`.
   - _Público_: mientras la app esté «en pruebas», añade como **usuarios de prueba** las cuentas
     de Google que vayan a importar (máximo 100). Para importar no hace falta publicarla ni
     verificarla. Para la **sincronización continua** sí (abajo): en pruebas, Google caduca los
     tokens de actualización a los 7 días.
3. _Clientes → Crear cliente_ → **Aplicación web**:
   - Orígenes autorizados de JavaScript: no hacen falta.
   - URI de redirección autorizados: `https://delyra.app/api/google/callback` (y, para probar en
     local, `http://localhost:5173/api/google/callback`).
4. Copia el **ID de cliente** y el **secreto del cliente**. No los pegues en el chat ni en el
   repositorio: cárgalos como secretos del Worker `api`:

```sh
pnpm --filter @delyra/api exec wrangler secret put GOOGLE_CLIENT_ID --env production
pnpm --filter @delyra/api exec wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

En cuanto estén los dos, el botón «Conectar con Google» aparece (no hace falta desplegar). En
local, ponlos en `apps/api/.dev.vars` (no se sube al repositorio).

## Sincronización continua (F7-09)

Desde _Importar → Sincronizar con Google_: «Conectar para sincronizar» pide el mismo scope con
acceso permanente; luego se eligen los calendarios uno a uno. El planificador (cada minuto)
consulta cada calendario cada 15 minutos con el `syncToken` de Google y solo lo descarga entero si
hay cambios.

**Publicar y verificar la app** (para que la conexión no caduque cada semana):

1. _Google Auth Platform → Público_ → **Publicar app** (pasa a «En producción»).
2. _Centro de verificación_ → enviar a verificación. Google pide:
   - el dominio `delyra.app` verificado en Search Console con la misma cuenta;
   - página principal, política de privacidad (`/privacidad`, ya explica la sincronización y la
     revocación) y condiciones accesibles sin iniciar sesión;
   - justificación del scope `calendar.readonly`: «Importar y mantener sincronizada una copia de
     solo lectura de los calendarios que elija la persona»;
   - un vídeo corto: conectar desde `delyra.app/importar`, la pantalla de consentimiento con el
     ID de cliente visible en la URL, elegir un calendario y verlo en Delyra.
3. Mientras se revisa, la sincronización funciona para los usuarios de prueba (reconectando cada
   7 días).

No se usan notificaciones push de Google, así que no hace falta registrar webhooks.

## Cómo funciona una importación

1. Subida (o vuelta de Google) → fila en `imports` con estado `analyzing` y una instancia del
   Workflow `delyra-import` (`<id>-analyze`).
2. Vista previa (`ready`): calendarios, número de eventos, series, alertas y avisos. El usuario
   elige destino (nuevo, existente o no importar) y si convierte los recordatorios en alertas de
   Telegram.
3. Importación (`importing` → `succeeded`/`failed`), instancia `<id>-import`, por trozos de 250
   eventos. Informe: nuevos, actualizados, sin cambios y descartados.

Los datos temporales viven en `delyra-imports` bajo `imports/<usuario>/<id>/` y se borran al
terminar (o a los 7 días por la regla del bucket). Una vista previa caduca a los 6 días.

## Problemas habituales

| Síntoma                                           | Causa / solución                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| «La conexión directa con Google aún no está…»     | Faltan `GOOGLE_CLIENT_ID` o `GOOGLE_CLIENT_SECRET` en el Worker `api`.                        |
| Google muestra «Acceso bloqueado»/`403`           | La cuenta no está en los usuarios de prueba, o el URI de redirección no coincide exactamente. |
| Vuelve con «la respuesta de Google no era válida» | Cookie caducada (más de 10 min) o bloqueada, o se abrió el enlace en otro navegador: repetir. |
| Importación «interrumpida»                        | Sin avances en 2 h: ver la instancia en _Workers → Workflows → delyra-import_ y repetir.      |
| Suscripción en error «no reconoce la dirección»   | Se restableció la dirección secreta en Google: quitar la suscripción y añadir la nueva.       |
| Sincronización «Google ha retirado el permiso»    | Token caducado (app en pruebas, 7 días) o permiso quitado en Google: «Volver a conectar».     |
| Vuelve con «no ha dado permiso permanente»        | Google no entregó token de actualización: reconectar y aceptar todos los permisos.            |

Logs útiles (Workers Logs del `api`): `import_phase_succeeded`, `import_phase_failed`,
`google_oauth_state_rejected`, `google_oauth_exchange_failed`, `subscription_synced`,
`subscription_sync_failed`, `google_calendar_synced`, `google_calendar_sync_failed`. Ninguno
incluye tokens, direcciones iCal ni contenido de eventos.

## Revocar el acceso

Cada usuario puede quitar el permiso de Delyra en
[myaccount.google.com/permissions](https://myaccount.google.com/permissions). Si tenía la
sincronización conectada, Delyra lo detecta en la siguiente consulta, borra el token de acceso y
deja la conexión «revocada»; «Desconectar Google» en Delyra revoca el permiso y borra la conexión.
Para retirar la vía OAuth a todos, borra los dos secretos
(`wrangler secret delete … --env production`): la sincronización se detiene (sin cliente OAuth el
planificador no la ejecuta).
