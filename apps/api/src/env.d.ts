// Secretos y bindings opcionales que `wrangler types` no conoce. Los secretos se cargan con
// `wrangler secret put <NOMBRE> --env production` y, en local, desde `.dev.vars`.
// Se declaran en las dos interfaces que genera `wrangler types` (global y `Cloudflare.Env`).

interface Env {
  /** Token de la API de Cloudflare con permiso solo sobre D1 (P-06). */
  D1_EXPORT_API_TOKEN?: string;
  /** Clave HMAC para seudonimizar identificadores en logs y contadores de intentos. */
  LOG_PSEUDONYM_KEY?: string;
  /** Clave AES-256 (32 bytes en base64url) para cifrar campos como la semilla TOTP. */
  FIELD_ENCRYPTION_KEY_V1?: string;
  /** Secret del widget de Turnstile (P-08). */
  TURNSTILE_SECRET_KEY?: string;
  /** Binding de Email Service (P-07); ausente hasta dar de alta el dominio. */
  EMAIL?: SendEmail;
  /** Token del bot de Telegram de @BotFather (P-10). */
  TELEGRAM_BOT_TOKEN?: string;
  /** Secreto que Telegram envía en `X-Telegram-Bot-Api-Secret-Token` (F3-03). */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Cliente OAuth web de Google (P-11). Sin los dos, la conexión con Google no aparece. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

declare namespace Cloudflare {
  interface Env {
    D1_EXPORT_API_TOKEN?: string;
    LOG_PSEUDONYM_KEY?: string;
    FIELD_ENCRYPTION_KEY_V1?: string;
    TURNSTILE_SECRET_KEY?: string;
    EMAIL?: SendEmail;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_WEBHOOK_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  }
}
