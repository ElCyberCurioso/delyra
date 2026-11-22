# Runbook · Importación desde Google Calendar (F5)

Tres vías (ADR-0008), todas desde **delyra.app/importar** (o «Importar desde Google» en la barra
lateral del calendario):

| Vía                             | Necesita configuración      | Qué hace                                       |
| ------------------------------- | --------------------------- | ---------------------------------------------- |
| Archivo `.zip`/`.ics` exportado | Nada                        | Importación puntual, sin duplicados al repetir |
| Cuenta de Google (OAuth)        | P-11 y dos secretos (abajo) | Importación puntual desde la API, con colores  |
| Dirección iCal secreta          | Nada                        | Calendario de solo lectura, al día cada hora   |

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
     de Google que vayan a importar (máximo 100). No hace falta publicarla ni verificarla: no se
     piden refresh tokens.
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

Logs útiles (Workers Logs del `api`): `import_phase_succeeded`, `import_phase_failed`,
`google_oauth_state_rejected`, `google_oauth_exchange_failed`, `subscription_synced`,
`subscription_sync_failed`. Ninguno incluye tokens, direcciones iCal ni contenido de eventos.

## Revocar el acceso

Cada usuario puede quitar el permiso de Delyra en
[myaccount.google.com/permissions](https://myaccount.google.com/permissions); como no se guarda
ningún token, no hay nada más que borrar en Delyra. Para retirar la vía OAuth a todos, borra los
dos secretos (`wrangler secret delete … --env production`).
