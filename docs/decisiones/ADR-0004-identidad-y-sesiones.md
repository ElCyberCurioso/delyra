# ADR-0004 · Identidad, sesiones y segundo factor

- **Estado:** aceptada (2026-11-20)
- **Fecha:** 2026-11-20
- **Tareas afectadas:** F1-01 a F1-14 (Fase 1)

## Contexto

Las dos apps (`delyra.app` y `work.delyra.app`) comparten usuarios y sesión. El plan exige 2FA
obligatorio, alta solo por invitación, Turnstile en los formularios públicos y que nada sensible
quede en claro en D1 ni en los logs.

## Decisión

### Contraseñas: scrypt (no Argon2id)

- `scrypt` de `node:crypto` (con `nodejs_compat`), N = 2^15, r = 8, p = 3 (32 MiB, ~200 ms en
  workerd), sal de 16 bytes y formato `$scrypt$ln=15,r=8,p=3$<sal>$<hash>`.
- Argon2id (la opción del plan) solo existe como WebAssembly, y workerd no permite compilar Wasm en
  tiempo de ejecución (_"Wasm code generation disallowed by embedder"_). scrypt es memory-hard y
  está en las recomendaciones de OWASP con estos parámetros.
- `needsRehash` recalcula el hash al entrar si cambian los parámetros. Contraseñas de 12 a 128
  caracteres, normalizadas NFKC; en producción se rechazan las filtradas (HIBP, k-anonimato).

### Sesiones

- Cookie `__Secure-sid`: `HttpOnly; Secure; SameSite=Lax; Path=/`, con `Domain=delyra.app` en
  producción (compartida por las dos apps) y sin `Domain` en local.
- En D1 solo se guarda el SHA-256 del token (32 bytes aleatorios).
- Estados: `pending_2fa` (contraseña correcta, falta el código; 5 min, 5 intentos),
  `pending_totp` (cuenta sin TOTP; solo puede darlo de alta) y `active` (7 días de inactividad,
  30 absolutos). El token se **rota** en cada cambio de estado: un token robado antes del segundo
  factor no sirve después (fijación de sesión).
- Cambiar o restablecer la contraseña y resetear el 2FA cierran todas las sesiones.

### Segundo factor

- TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s, ventana ±1). La semilla se guarda cifrada con
  AES-256-GCM (`FIELD_ENCRYPTION_KEY_V1`, AAD `totp:<userId>`); el último contador aceptado impide
  reutilizar un código (anti-replay con `UPDATE` condicional).
- 10 códigos de recuperación de un solo uso (`xxxxx-xxxxx`, base32), guardados como SHA-256.
- Sin TOTP confirmado no hay sesión `active`: el alta es obligatoria tras el registro.

### Alta de usuarios

- Solo por invitación (token de 32 bytes en el fragmento `#token=`, nunca en la query; en D1 solo
  su SHA-256; caduca en 1–30 días). La invitación se reserva antes de crear el usuario, de modo que
  dos registros simultáneos con el mismo enlace no pueden prosperar.
- El email queda verificado al registrarse: el enlace solo llega a ese buzón (o lo entrega un
  administrador).
- El primer administrador se crea con `pnpm invite --email … --role admin`
  (`scripts/create-invitation.mjs`), que escribe la invitación directamente en D1 con las
  credenciales de `wrangler` de quien lo ejecuta.

### Defensas

- **CSRF:** toda mutación exige `Origin` en la lista de orígenes del entorno y
  `Content-Type: application/json` (los formularios HTML de otro sitio no pueden enviarlo).
- **Fuerza bruta:** contadores por cuenta (5 fallos / 15 min) y por IP (30 / 15 min) guardados como
  HMAC (`LOG_PSEUDONYM_KEY`), más Rate Limiting de Workers (30/min en `/api/auth/*`, 300/min en
  el resto).
- **Enumeración:** mismo mensaje y tiempo (hash ficticio) para email inexistente y contraseña
  mala; «olvidé mi contraseña» responde siempre 202.
- **Turnstile** en login, registro y recuperación. En producción, sin secreto configurado, se
  falla cerrado (503). En local se usan las claves de prueba de Cloudflare.
- **Recursos ajenos:** 404, nunca 403 (no se revela que existen). Las rutas de admin también
  devuelven 404 a los miembros.
- **`next`:** tras el login solo se vuelve a rutas propias o a los orígenes exactos de Delyra.

## Consecuencias

- Hasta que el envío de email esté configurado (P-07), en producción no se envían invitaciones ni
  enlaces de recuperación: el administrador comparte a mano el enlace de invitación que le muestra
  la API, y «olvidé mi contraseña» no llega a ningún buzón. Se resuelve al cerrar P-07.
- Rotar `FIELD_ENCRYPTION_KEY_V1` exige una `V2` y recifrar las semillas (el formato `v1:` lo
  permite); perder la clave obliga a resetear el 2FA de todos.
- Cada login cuesta ~200 ms de CPU por el hash: aceptable con los límites de Workers Paid.
