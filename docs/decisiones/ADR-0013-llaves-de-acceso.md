# ADR-0013 · Llaves de acceso (WebAuthn) como segundo factor

- **Estado:** aceptada (2026-11-23)
- **Fecha:** 2026-11-23
- **Tareas afectadas:** F7-09 (primera parte; la sincronización continua con Google va aparte)

## Contexto

El plan pide WebAuthn «como factor alternativo al TOTP». El 2FA es obligatorio desde la Fase 1
(ADR-0004): contraseña y después un código de la app autenticadora o de recuperación. Escribir el
código cada vez es lo más incómodo del acceso, sobre todo en el móvil.

## Decisión

- **Alternativa al código, no sustituto de la contraseña.** En el segundo paso del login, si la
  cuenta tiene llaves, se ofrece «Usar una llave de acceso» antes que el código. La contraseña se
  sigue pidiendo y el TOTP sigue siendo obligatorio: es el que se pide para los cambios de
  seguridad (reautenticación) y el respaldo si se pierde el dispositivo. Así no cambian la
  recuperación de cuenta ni el modelo de amenazas de ADR-0004.
- **Relying Party:** el dominio del calendario (`delyra.app`; `localhost` en desarrollo), donde
  están el login y los ajustes. Solo se acepta el origen exacto del calendario.
- **Ceremonias con @simplewebauthn/server 14** en el Worker `api` (verificación de firma, origen,
  RP, banderas y contador) y **@simplewebauthn/browser** en la SPA, cargada solo al usarla (no
  cuenta en el presupuesto de la carga inicial). No se escribe verificación criptográfica propia.
- **Retos de un solo uso ligados a la sesión:** tabla `webauthn_challenges` (uno por sesión, borrado
  al leerlo, 5 minutos). Una firma capturada no sirve en otra sesión ni dos veces.
- **Sin atestación (`none`)** y verificación de usuario **preferida, no exigida**: la llave es el
  segundo factor tras la contraseña, así que vale una llave física sin PIN. No se guardan datos
  que identifiquen el modelo del autenticador.
- **Datos guardados** (`passkeys`, migración 0014): id de la credencial, clave pública COSE,
  contador, transportes, nombre que pone la persona y si está sincronizada. Nunca datos
  biométricos (no salen del dispositivo). El contador no puede retroceder (posible clon) y se
  actualiza de forma condicional para que dos usos simultáneos no pasen los dos.
- **Alta:** desde Ajustes → Verificación en dos pasos, con contraseña y código actual; máximo 10
  llaves por cuenta; se excluyen las ya registradas. **Baja:** sin reautenticar (quitar una llave
  no da acceso a nada). Las dos avisan por Telegram y quedan en el historial (`passkey.added`,
  `passkey.removed`). Los fallos cuentan como intentos de segundo factor (bloqueo y revocación de
  la sesión pendiente al quinto). El reseteo de 2FA por un administrador también las borra.
- **Copias de usuario:** no incluyen llaves (como no incluyen el TOTP); al restaurar en otra cuenta
  no se trasladan credenciales.

## Alternativas descartadas

- **Entrar solo con la llave (sin contraseña).** Es lo más cómodo, pero cambia la recuperación de
  cuenta y el reparto de factores; se puede añadir más adelante con credenciales detectables
  (`residentKey: preferred` ya las crea así cuando el dispositivo puede).
- **Verificación propia con WebCrypto** para no añadir dependencias: más código criptográfico que
  auditar y mantener; la librería está muy revisada y funciona en Workers.
- **RP en `work.delyra.app` también:** no hace falta, el login es siempre en el calendario.

## Consecuencias

- Las pruebas de la API usan un autenticador por software (`apps/api/test/webauthn.ts`, P-256 y
  CBOR mínimo) y el e2e `e2e/passkeys.spec.ts` el autenticador virtual de Chromium.
- El Worker `api` crece unos cientos de KB por la librería (lejos del límite de 10 MB).
