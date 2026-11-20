# Runbook · Dominios y acceso (F0-11)

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
