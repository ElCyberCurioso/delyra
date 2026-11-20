# Runbook · Dominios y acceso (F0-11)

## Dominios de producción

Los declara cada `wrangler.jsonc` (`routes` con `custom_domain: true` en `env.production`) y se
crean al desplegar. Requieren que la zona `delyra.app` esté activa en la misma cuenta (P-01) y que
el token de CI tenga _Zone · Workers Routes · Edit_ sobre ella.

| Worker            | Dominio           |
| ----------------- | ----------------- |
| `delyra-calendar` | `delyra.app`      |
| `delyra-work`     | `work.delyra.app` |

Cloudflare crea los registros DNS y los certificados. El Worker `api` no tiene dominio.

## Staging en workers.dev (ADR-0003)

Staging no tiene dominio propio. Las dos SPA se sirven en el subdominio `workers.dev` de la cuenta
(`workers_dev: true` en `env.staging`):

| Worker                    | URL                                                        |
| ------------------------- | ---------------------------------------------------------- |
| `delyra-calendar-staging` | `https://delyra-calendar-staging.<subdominio>.workers.dev` |
| `delyra-work-staging`     | `https://delyra-work-staging.<subdominio>.workers.dev`     |

1. Mira tu subdominio en _Workers & Pages_ → **Your subdomain** (por ejemplo `ana-lopez`).
2. Sustituye `tu-subdominio` en `packages/shared/src/app-origins.json`. Es la lista blanca de
   orígenes y la fuente de las URL del workflow de despliegue.
3. Si lo cambias en el panel, cambia también ese fichero. La comprobación previa del deploy
   consulta el subdominio real por la API y falla si no coinciden (y te dice cuál es).

## Redirección `www.delyra.app` → `delyra.app` (301)

Static Assets solo ejecuta el Worker para `/api/*`, así que la redirección se hace en el borde con
una **Redirect Rule** de la zona `delyra.app` (no consume invocaciones del Worker):

1. DNS: registro `AAAA www → 100::`, **proxied** (naranja).
2. _Rules → Redirect Rules → Create rule_ (o la plantilla _Redirect from WWW to root_):
   - Si: `Hostname equals www.delyra.app`
   - Entonces: _Dynamic_, expresión `concat("https://delyra.app", http.request.uri.path)`,
     código **301**, _Preserve query string_ activado.
3. Comprueba: `curl -sI https://www.delyra.app/x?y=1` → `301` con `location: https://delyra.app/x?y=1`.

## Cloudflare Access (P-09)

1. **Staging (tras el primer despliegue).** Para cada Worker de staging (`delyra-calendar-staging`
   y `delyra-work-staging`): _Workers & Pages_ → el Worker → _Settings → Domains & Routes_ →
   en `workers.dev`, **Enable Cloudflare Access**. Cloudflare crea una aplicación y una política
   reutilizable `<worker> - Production`; con **Manage Cloudflare Access** deja en ella solo tu
   email (o tu grupo).
2. **Token de servicio para CI.** _Zero Trust → Access controls → Service credentials → Service
   Tokens → Create Service Token_ («delyra-ci»). Copia el _Client ID_ y el _Client Secret_ (solo se
   muestra una vez) y guárdalos como secretos del Environment `staging` en GitHub:
   `CF_ACCESS_CLIENT_ID` y `CF_ACCESS_CLIENT_SECRET`.
3. **Dejar pasar a CI.** En la aplicación de Access de cada Worker de staging, añade una política
   con _Action: Service Auth_ e _Include: Service Token = delyra-ci_. Playwright envía el token en
   cada petición.
4. **Admin de producción.** Otra aplicación para la ruta `delyra.app/admin` (llega en F1-17).

El primer despliegue de staging deja las URL `workers.dev` abiertas unos minutos, hasta que
actives Access. En ese momento solo sirven la página provisional y `/api/health`.

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

El e2e de humo de CI comprueba las mismas cabeceras tras cada despliegue.
