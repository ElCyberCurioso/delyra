# Runbook · Auditoría con Burp Suite (F7-08)

Guía para la auditoría manual de la versión 1.0. Cada apartado dice qué debería pasar; si pasa
otra cosa, es un hallazgo. El modelo de amenazas (`docs/modelo-amenazas.md`) explica cada defensa.

## Preparación

- **Dónde.** Las pruebas que solo leen (cabeceras, TLS, CSP) se hacen en producción. Las que
  escriben o fuerzan (Intruder, subidas, fuerza bruta) mejor en local con el build de producción
  (`.claude/launch.json` → `calendar-preview` y `work-preview`, `wrangler dev` sobre `dist`): así
  no se llenan las tablas de producción ni se disparan los bloqueos de tu cuenta real.
- **Cuentas.** Tres cuentas de prueba creadas con `pnpm invite`: un administrador y dos miembros
  (A y B). B sirve para comprobar que A no ve nada suyo. Guarda los ids de cada recurso de B
  (calendario, evento, tablero, tarjeta, adjunto, importación, copia, llave de acceso…).
- **Turnstile.** En producción bloquea el login automatizado: para Intruder usa local (en
  desarrollo acepta el token de prueba).
- **Burp.** Proxy con el navegador de Burp; en _Target → Scope_ añade `delyra.app`,
  `work.delyra.app` y `localhost:5173-5174`. Las peticiones al API van a `/api/*` en cada dominio.

## 1. Cabeceras, TLS y configuración

| Comprobar                                   | Esperado                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Content-Security-Policy` en las páginas    | En bloqueo, sin `unsafe-inline`/`unsafe-eval` en `script-src`; `frame-ancestors 'none'` |
| `Strict-Transport-Security`, `nosniff`      | Presentes en páginas y API                                                              |
| `Permissions-Policy`                        | Todo `()` salvo `microphone=(self)` en las SPA                                          |
| CORS                                        | Ninguna respuesta del API devuelve `Access-Control-Allow-Origin`                        |
| Cookie `__Secure-sid`                       | `HttpOnly; Secure; SameSite=Lax; Path=/; Domain=delyra.app` (vale en las dos apps)      |
| Respuestas con secretos (códigos, opciones) | `Cache-Control: no-store`                                                               |
| Errores                                     | `application/problem+json` sin trazas, rutas internas ni SQL                            |

## 2. Inicio de sesión y sesiones

- Email inexistente y contraseña mala dan **el mismo mensaje y tiempo parecido** (sin enumeración).
- Tras varios fallos en 15 minutos, `429` con `Retry-After`, por cuenta y por IP.
- Con la sesión a medias (`pending_2fa`/`pending_totp`) ninguna ruta de datos responde (`401`).
- **Fijación de sesión:** la cookie cambia al pasar el segundo factor; la anterior deja de valer.
- Cerrar sesión, cambiar la contraseña o el TOTP revocan las demás sesiones; reutilizar una cookie
  antigua da `401`.
- Restablecer contraseña: el enlace es de un solo uso, caduca y no dice si el email existe.

## 3. Segundo factor y llaves de acceso

- Un código TOTP ya usado no vale otra vez; cinco códigos malos revocan la sesión pendiente.
- Los códigos de recuperación son de un solo uso.
- Acciones sensibles (`/api/me/recovery-codes`, `/api/me/totp/reconfigure`,
  `/api/me/passkeys/options`) piden contraseña **y** código.
- Llaves (`/api/auth/login/passkey*`, `/api/me/passkeys*`): repetir una respuesta ya usada, usar
  la de otra sesión o la llave de B en la cuenta de A → `401`; registrar sin reautenticar → `400`.

## 4. CSRF

En cada `POST`/`PATCH`/`DELETE` del API prueba:

- sin cabecera `Origin`, con `Origin: https://evil.example` y con `Origin: https://delyra.app.evil.com`
  → `403`;
- con `Content-Type: text/plain` o `application/x-www-form-urlencoded` (formulario de otro sitio)
  → rechazada.

Las subidas (`/api/attachments`, `/api/imports`, `/api/restores`) exigen además `X-Filename` (`415`
sin ella). Solo están exentos el webhook de Telegram (secreto propio) y los informes CSP.

## 5. Acceso a datos de otros (IDOR) y papeles

- Con la sesión de A, repite cada petición con ids de B: calendarios, eventos, tableros, columnas,
  etiquetas, tarjetas, comentarios, checklist, adjuntos, importaciones, suscripciones,
  sincronización de Google, copias y restauraciones, llaves de acceso, sesiones y feeds. Todo debe
  responder **`404`** (no `403`, para no confirmar que existe) y no cambiar nada.
- Tableros compartidos: un **lector** no puede escribir (`403`), un **editor** no puede borrar el
  tablero ni gestionar miembros.
- Un miembro no ve `/api/admin/*` (`404`).
- Asignación masiva: añade campos de más en los cuerpos (`ownerId`, `role`, `readOnly`,
  `userId`…); deben ignorarse.

## 6. Tiempo real (WebSocket)

`GET /api/boards/<id>/live`: sin sesión, sin acceso al tablero o con `Origin` ajeno no conecta.
Al quitar a B del tablero, su conexión se cierra. Los mensajes solo dicen «ha cambiado».

## 7. Ficheros

- Adjuntos: sube HTML, SVG con script y un fichero con extensión engañosa. Al descargar:
  `Content-Disposition: attachment`, `nosniff`, sin ejecutarse.
- Importaciones: zip bomb, `.ics` enorme, HTML y caracteres de control en los textos (se guardan
  como texto plano).
- Restaurar una copia manipulada (checksum, referencias a ids de otros, otra versión): se rechaza.

## 8. Peticiones a terceros

- Suscripción iCal: solo `https://calendar.google.com/calendar/ical/…`. Prueba IPs internas,
  `http`, otros hosts, `@` en la URL, puertos y redirecciones → rechazadas (SSRF).
- OAuth de Google: manipula `state`, reutiliza la cookie `__Secure-delyra-google`, vuelve al
  callback con otra sesión o sin sesión → `google=state` o login, sin canjear nada.
- Feeds ICS (`/api/feeds/<token>.ics`): un token inventado o revocado da `404`.
- Webhook de Telegram (`/api/telegram/webhook`): sin el secreto correcto → `401`.

## 9. XSS

Títulos, notas y ubicaciones de eventos; nombres de tableros, columnas, etiquetas y tarjetas;
descripciones en Markdown y comentarios; nombre de perfil (también en correos e invitaciones).
Nada debe ejecutarse; el Markdown pasa por DOMPurify.

## Qué hacer con los hallazgos

Anota para cada uno: severidad (crítica, alta, media, baja), petición y respuesta de Burp, pasos
para reproducirlo y qué esperabas. Pásamelos y los corrijo con su prueba de regresión. El criterio
de la Fase 7 es no dejar abiertos hallazgos altos ni críticos.
