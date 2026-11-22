# Modelo de amenazas de Delyra (F7-08)

Revisión del 22 de noviembre de 2026, con las Fases 0 a 6 en producción y el bloque 1 de la Fase 7
(PWA, feeds ICS, festivos y CSP en bloqueo). Formato STRIDE por superficie; cada amenaza enlaza
con su mitigación en el código o en un runbook.

## Activos

| Activo                                     | Dónde vive                                        |
| ------------------------------------------ | ------------------------------------------------- |
| Cuentas (email, hash de contraseña, TOTP)  | D1 `users`, `user_totp` (semilla cifrada AES-GCM) |
| Calendarios, eventos, tableros, adjuntos   | D1 y R2 `delyra-attachments`                      |
| Sesiones                                   | Cookie `__Secure-sid` (HttpOnly) + hash en D1     |
| Chat de Telegram                           | D1 cifrado + HMAC                                 |
| Direcciones iCal secretas y tokens de feed | D1 cifrados (AES-GCM, AAD por fila)               |
| Copias de usuario y volcados del sistema   | R2 `delyra-backups`                               |
| Secretos de la plataforma                  | `wrangler secret` y GitHub Secrets                |

## Fronteras de confianza

1. Navegador ↔ SPA (`delyra.app`, `work.delyra.app`): HTTPS obligatorio (TLD `.app` en la precarga
   HSTS), CSP en bloqueo, cookie `SameSite=Lax`.
2. SPA ↔ Worker `api`: Service Binding (sin exposición pública propia).
3. `api` ↔ terceros: Telegram, Google (OAuth y Calendar), `calendar.google.com` (iCal),
   `date.nager.at` (festivos), API de Cloudflare (export D1).
4. Ficheros que sube el usuario: adjuntos, `.ics`/`.zip` de Google y copias de seguridad.
5. Service worker y Cache Storage del dispositivo (PWA).

## Amenazas y mitigaciones

| Superficie / STRIDE     | Amenaza                                                 | Mitigación                                                                                                                                 |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Autenticación (S)       | Robo de credenciales, fuerza bruta                      | scrypt, 2FA obligatorio, Turnstile, límites estrictos y bloqueos (ADR-0004)                                                                |
| Sesión (S, E)           | Robo o fijación de sesión                               | Token opaco de 256 bits, solo su hash en D1, HttpOnly + Secure + Lax, rotación al pasar el 2FA                                             |
| API (T)                 | CSRF                                                    | `Origin` en lista blanca + `Content-Type: application/json`; subidas con `X-Filename` (middleware `csrf.ts`)                               |
| Datos de usuario (I, E) | IDOR: leer o escribir datos de otro                     | Repositorios con `ownerId` obligatorio; recurso ajeno = 404; pruebas de permisos cruzados en cada endpoint                                 |
| Frontend (T)            | XSS                                                     | React escapa; Markdown con DOMPurify; textos importados en texto plano; **CSP en bloqueo** sin `unsafe-inline` ni `unsafe-eval` en scripts |
| Frontend (I)            | Exfiltración por CSS inyectado                          | `img-src`, `font-src` y `connect-src` sin orígenes externos (el `unsafe-inline` de estilos no permite sacar datos)                         |
| Framing (T)             | Clickjacking                                            | `frame-ancestors 'none'` y `X-Frame-Options: DENY`                                                                                         |
| Adjuntos (T, I)         | Ficheros activos (HTML/SVG), polyglots                  | Tipo por contenido, `Content-Disposition: attachment`, `nosniff`, CSP `sandbox` en la API                                                  |
| Importaciones (D, T)    | Zip bomb, ICS gigantes, HTML en textos                  | Límites contados en bytes reales, textos saneados, Workflow por lotes (ADR-0008)                                                           |
| Copias (T, E)           | Copia manipulada para escribir en otra cuenta           | Checksum, esquema, referencias solo internas, ids regenerados, propietario reescrito (ADR-0009)                                            |
| Suscripciones iCal (I)  | SSRF                                                    | Solo `https://calendar.google.com/calendar/ical/…`, sin redirecciones, tiempo y tamaño máximos                                             |
| OAuth Google (S, I)     | CSRF de login, robo de código, tokens de larga duración | PKCE S256, `state` en cookie cifrada de un solo uso, `access_type=online`, token borrado tras el análisis                                  |
| Feeds ICS (I)           | Fuga de la URL del feed                                 | Token de 256 bits por calendario, revocable y regenerable; solo su hash para buscar; `noindex`; nunca en logs (solo patrón de ruta)        |
| Festivos (T)            | Respuesta manipulada del servicio                       | Validación estricta (fechas, códigos de región, tamaño), texto plano; sin datos del usuario en la petición                                 |
| PWA (I)                 | Datos en caché vistos por otra persona del dispositivo  | Solo GET de lectura concretos en caché; se vacía al cerrar sesión y al entrar otra cuenta; navegaciones `/api/*` fuera del SW              |
| Telegram (S)            | Webhook falso                                           | Secreto en `X-Telegram-Bot-Api-Secret-Token`, comparación en tiempo constante, idempotencia por `update_id`                                |
| Notificaciones (R)      | Repudio de acciones                                     | Historial de seguridad (`audit_log`) con eventos de cuenta, admin y restauraciones                                                         |
| Disponibilidad (D)      | Abuso de la API                                         | Rate limiting general y estricto en auth; cuotas diarias de importación, copias y restauraciones                                           |
| Plataforma (E)          | Token de Cloudflare filtrado                            | Permisos mínimos (abajo), gitleaks en CI, secretos solo en Wrangler/GitHub                                                                 |
| Datos (D)               | Pérdida o corrupción                                    | Backups diario/semanal/mensual, Time Travel 30 días, simulacro documentado (docs/runbooks/restauracion.md)                                 |

## Revisión de permisos de los tokens

Comprueba en _Cloudflare → My Profile → API Tokens_ y en GitHub que cada token tiene solo esto:

| Token                                | Dónde                     | Permisos necesarios                                                                                                                    | Notas                                                      |
| ------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| CI (`CLOUDFLARE_API_TOKEN`)          | GitHub Secrets            | Workers Scripts, Workers Routes, Workflows, D1, R2, Queues: _Edit_; Account Settings: _Read_; zona `delyra.app`: Workers Routes _Edit_ | Limitar a la cuenta y a la zona de Delyra; caducidad anual |
| Export de D1 (`D1_EXPORT_API_TOKEN`) | Secreto del Worker `api`  | D1: _Edit_ (la exportación lo exige) sobre la cuenta                                                                                   | Ningún otro permiso                                        |
| Bot de Telegram                      | Secreto del Worker `api`  | —                                                                                                                                      | Rotación: `pnpm telegram:setup`                            |
| Cliente OAuth de Google              | Secretos del Worker `api` | Scope `calendar.readonly`                                                                                                              | Sin refresh tokens                                         |

Si alguno tiene más permisos, edítalo o crea otro y revoca el anterior. Rotación de secretos:
`wrangler secret put <NOMBRE> --env production` y despliegue.

## Pendiente de la auditoría manual (Burp)

La auditoría con Burp Suite la hace el propietario contra producción con una cuenta de prueba. Puntos
mínimos: IDOR cambiando ids en todos los endpoints (eventos, tableros, tarjetas, adjuntos, copias,
restauraciones, feeds, suscripciones, importaciones), manipulación de `state` en `/api/google/callback`,
copias manipuladas (ids ajenos, checksum, tamaño), URL de suscripción con otros hosts y redirecciones,
subida de adjuntos con tipos falsos, CSRF sin `Origin` o con otro `Content-Type`, y fuerza bruta en el
login y el 2FA. Los hallazgos altos o críticos bloquean la versión 1.0.
