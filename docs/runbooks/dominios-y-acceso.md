# Runbook · Dominios y acceso (F0-11)

## Dominios personalizados

Los declara cada `wrangler.jsonc` (`routes` con `custom_domain: true`) y se crean al desplegar.
Requieren que la zona esté activa en la misma cuenta (P-01, P-02).

| Worker                    | Dominio               |
| ------------------------- | --------------------- |
| `delyra-calendar`         | `delyra.app`          |
| `delyra-work`             | `work.delyra.app`     |
| `delyra-calendar-staging` | `delyra-stg.app`      |
| `delyra-work-staging`     | `work.delyra-stg.app` |

Cloudflare crea los registros DNS y los certificados. El Worker `api` no tiene dominio.

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

1. **Staging completo.** _Zero Trust → Access → Applications → Self-hosted_, dominios
   `delyra-stg.app` y `work.delyra-stg.app`. Política _Allow_ para tu email (o tu grupo).
2. **Token de servicio para CI.** _Access → Service Auth → Create Service Token_ («delyra-ci»).
   Añade a la aplicación de staging una política _Service Auth_ que lo incluya. Guarda el
   _Client ID_ y el _Client Secret_ como secretos del Environment `staging` en GitHub:
   `CF_ACCESS_CLIENT_ID` y `CF_ACCESS_CLIENT_SECRET`. Playwright los envía en cada petición.
3. **Admin de producción.** Otra aplicación para la ruta `delyra.app/admin` (llega en F1-17).

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
