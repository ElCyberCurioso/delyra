// Secretos: no están en wrangler.jsonc, así que `wrangler types` no los conoce.
// Se cargan con `wrangler secret put <NOMBRE> --env <entorno>` y, en local, desde `.dev.vars`.
// Se declaran en las dos interfaces que genera `wrangler types` (global y `Cloudflare.Env`).

interface Env {
  /** Token de la API de Cloudflare con permiso solo sobre D1 (P-06). */
  D1_EXPORT_API_TOKEN?: string;
  /** Clave HMAC para seudonimizar identificadores de usuario en los logs. */
  LOG_PSEUDONYM_KEY?: string;
}

declare namespace Cloudflare {
  interface Env {
    D1_EXPORT_API_TOKEN?: string;
    LOG_PSEUDONYM_KEY?: string;
  }
}
