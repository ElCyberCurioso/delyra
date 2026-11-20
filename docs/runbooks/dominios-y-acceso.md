# Runbook · Dominios y acceso (F0-11, F1)

Solo hay producción (ADR-0003).

## Dominios de producción

Los declara cada `wrangler.jsonc` (`routes` con `custom_domain: true` en `env.production`) y se
crean al desplegar. Requieren que la zona `delyra.app` esté activa en la misma cuenta (P-01) y que
el token de CI tenga _Zone · Workers Routes · Edit_ sobre ella.

| Worker            | Dominio           |
| ----------------- | ----------------- |
| `delyra-calendar` | `delyra.app`      |
| `delyra-work`     | `work.delyra.app` |

Cloudflare crea los registros DNS y los certificados. El Worker `api` no tiene dominio.

Los mismos orígenes están en `packages/shared/src/app-origins.json` (lista blanca de `Origin` y de
`next`). La comprobación previa del despliegue falla si ese fichero y los `routes` no coinciden.

## Redirección `www.delyra.app` → `delyra.app` (301)

Static Assets solo ejecuta el Worker para `/api/*`, así que la redirección se hace en el borde con
una **Redirect Rule** de la zona `delyra.app` (no consume invocaciones del Worker):

1. DNS: registro `AAAA www → 100::`, **proxied** (naranja).
2. _Rules → Redirect Rules → Create rule_ (o la plantilla _Redirect from WWW to root_):
   - Si: `Hostname equals www.delyra.app`
   - Entonces: _Dynamic_, expresión `concat("https://delyra.app", http.request.uri.path)`,
     código **301**, _Preserve query string_ activado.
3. Comprueba: `curl -sI https://www.delyra.app/x?y=1` → `301` con `location: https://delyra.app/x?y=1`.

## Turnstile (P-08)

Protege login, registro y «olvidé mi contraseña». Sin él, en producción nadie puede entrar (la API
falla cerrada) y el despliegue se bloquea en la comprobación previa.

1. Panel de Cloudflare → _Turnstile → Add widget_.
   - Nombre: `delyra`. Hostnames: `delyra.app` y `work.delyra.app`.
   - Widget mode: _Managed_. Sin _pre-clearance_.
2. Copia la **Site Key** (pública) en `apps/api/wrangler.jsonc` →
   `env.production.vars.TURNSTILE_SITE_KEY` y haz commit.
3. Carga la **Secret Key** como secreto del Worker, escribiéndola en tu terminal (nunca en el
   repositorio ni en un chat):

   ```sh
   cd apps/api
   pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --env production
   ```

En local se usan las claves de prueba de Cloudflare (siempre pasan): no hay que configurar nada.

## Cifrado de las semillas TOTP

Las semillas del segundo factor se guardan cifradas con `FIELD_ENCRYPTION_KEY_V1` (32 bytes
aleatorios). Se genera y se envía directamente a Cloudflare, sin mostrarla:

```sh
cd apps/api
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | pnpm exec wrangler secret put FIELD_ENCRYPTION_KEY_V1 --env production
```

**No la regeneres** una vez haya usuarios: las semillas existentes dejarían de poder descifrarse y
habría que resetear el 2FA de todos (ADR-0004).

## Primer acceso: crear el administrador

El alta es solo por invitación. La primera se crea desde tu equipo, con tu sesión de `wrangler`
(`wrangler login`) o un `CLOUDFLARE_API_TOKEN` con permiso de D1:

```sh
pnpm invite --email tu@correo.com --role admin
```

1. El script imprime `https://delyra.app/registro#token=…` (caduca en 7 días; `--days` lo cambia).
   Es de un solo uso: no lo compartas ni lo pegues en ningún chat.
2. Ábrelo en el navegador: nombre, contraseña (mínimo 12 caracteres) y verificación anti-bots.
3. Escanea el QR con tu app autenticadora (1Password, Bitwarden, Aegis, Google Authenticator…) y
   escribe el código de 6 dígitos.
4. Guarda los 10 códigos de recuperación (descárgalos o cópialos a tu gestor de contraseñas). Cada
   uno sirve una vez si pierdes el móvil.

Desde ese momento entras en `https://delyra.app/login` (email + contraseña + código), y la sesión
vale también en `work.delyra.app`. Repetir el script para el mismo email revoca el enlace anterior.

En local es igual con `--local` (escribe en `.wrangler/state`; el enlace es
`http://localhost:5173/registro#token=…`). Antes, `pnpm db:migrate:local`.

## Cloudflare Access (P-09)

Solo protege el panel de administración, que llega en F1-17: una aplicación _Self-hosted_ para la
ruta `delyra.app/admin` con una política _Allow_ para tu email. El resto de la app es público y se
protege con su propia autenticación (Fase 1).

## HSTS

Las SPA (`_headers`) y la API envían `Strict-Transport-Security: max-age=63072000;
includeSubDomains`. En `.app` el navegador ya fuerza HTTPS por la precarga del TLD; la cabecera
cubre a los clientes que no usan la lista de precarga. No apuntes nunca un subdominio de
`delyra.app` a un servicio sin TLS.

## Comprobar las cabeceras

```sh
curl -sI https://delyra.app/ | grep -iE "strict-transport|content-security|x-frame|x-content"
curl -sI https://delyra.app/api/health | grep -iE "strict-transport|content-security|cache-control"
```

El e2e de humo comprueba las mismas cabeceras tras cada despliegue.
