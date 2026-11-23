# Runbook · Reuniones de Teams en un tablero (P-12)

Las reuniones del calendario de Microsoft 365 llegan como tarjetas a los tableros que lo tengan
activado (ADR-0015). Sin la app registrada y sus secretos, la sección «Reuniones de Teams» de los
ajustes del tablero no aparece.

## P-12 · Registrar la app en Microsoft Entra ID

1. En [entra.microsoft.com](https://entra.microsoft.com): _Identidad → Aplicaciones → Registros de
   aplicaciones → Nuevo registro_.
   - Nombre: **Delyra**.
   - **Tipos de cuenta admitidos:**
     - _Solo cuentas de este directorio organizativo_ si solo la vas a usar con tu organización
       (lo más sencillo: tú das el consentimiento). Apunta el **Id. de directorio (inquilino)**.
     - _Cuentas de cualquier directorio organizativo y cuentas personales de Microsoft_ si hay
       personas de otras organizaciones o con Teams gratuito.
   - URI de redirección, tipo **Web**: `https://work.delyra.app/api/microsoft/callback` (y, para
     probar en local, `http://localhost:5174/api/microsoft/callback`).
2. _Certificados y secretos → Nuevo secreto de cliente_. Copia el **valor** (solo se ve una vez) y
   anota cuándo caduca (24 meses como mucho): al caducar, las conexiones dejan de renovarse.
3. _Permisos de API → Agregar un permiso → Microsoft Graph → Permisos delegados_: `Calendars.Read`,
   `offline_access` y `User.Read` (este suele estar ya). Si administras la organización, pulsa
   **Conceder consentimiento de administrador**.
4. _Personalización de marca_: página principal `https://delyra.app`, condiciones
   `https://delyra.app/terminos` y privacidad `https://delyra.app/privacidad`.
5. Carga los secretos en el Worker `api` (no los pegues en el chat ni en el repositorio):

```sh
pnpm --filter @delyra/api exec wrangler secret put MICROSOFT_CLIENT_ID --env production
pnpm --filter @delyra/api exec wrangler secret put MICROSOFT_CLIENT_SECRET --env production
# Solo si la app es de un único inquilino:
pnpm --filter @delyra/api exec wrangler secret put MICROSOFT_TENANT_ID --env production
```

En local van en `apps/api/.dev.vars`.

## Cómo se usa

En un tablero: _Ajustes → Reuniones de Teams → Conectar con Microsoft 365_. Al volver se elige la
columna, los días por delante (7, 14 o 30) y si solo reuniones de Teams. Cada 15 minutos:

- reunión nueva → tarjeta con fecha, organizador, lugar, enlace «Unirse a la reunión» y etiqueta
  «Teams»;
- reunión cambiada → se actualizan título, fecha y descripción salvo lo que se haya editado en la
  tarjeta;
- reunión cancelada o borrada → la tarjeta se archiva.

## Problemas habituales

| Síntoma                                                      | Causa / solución                                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| La sección no aparece en los ajustes del tablero             | Faltan `MICROSOFT_CLIENT_ID` o `MICROSOFT_CLIENT_SECRET`, o la persona solo puede leer el tablero.                |
| Microsoft dice «Se necesita la aprobación del administrador» | La organización no deja autorizar apps de terceros: su administrador debe conceder el consentimiento a Delyra.    |
| `AADSTS50011` (redirect URI)                                 | La URI de redirección no coincide exactamente con la registrada (esquema, dominio y ruta).                        |
| «Microsoft ha retirado el permiso»                           | Permiso quitado, contraseña cambiada con revocación de sesiones o secreto de cliente caducado: volver a conectar. |
| Vuelve con «la respuesta de Microsoft no era válida»         | Cookie caducada (más de 10 minutos) o el enlace se abrió en otro navegador: repetir.                              |

Logs (Workers Logs del `api`): `microsoft_board_synced`, `microsoft_board_sync_failed`,
`microsoft_oauth_state_rejected`, `microsoft_oauth_exchange_failed`. Ninguno lleva tokens ni
contenido de las reuniones.

## Revocar el acceso

«Desconectar Microsoft 365» borra los tokens en Delyra. Para retirar también el permiso en
Microsoft: [myapps.microsoft.com](https://myapps.microsoft.com) (cuentas de organización) o
[account.live.com/consent/Manage](https://account.live.com/consent/Manage) (cuentas personales).
Para retirarlo a todos, borra los secretos del Worker.
