import { hmacSha256Hex } from "./crypto";

/**
 * Seudónimos estables (HMAC con `LOG_PSEUDONYM_KEY`) para buscar o contar por un dato personal
 * sin guardarlo en claro: IP y email en los contadores de intentos, `chat_id` de Telegram…
 */

const DEV_PSEUDONYM_KEY = "delyra-dev-pseudonym-key";

export type PseudonymEnv = Pick<Env, "APP_ENV" | "LOG_PSEUDONYM_KEY">;

function pseudonymKey(env: PseudonymEnv): string {
  if (env.LOG_PSEUDONYM_KEY) return env.LOG_PSEUDONYM_KEY;
  if (env.APP_ENV === "production") throw new Error("Falta el secreto LOG_PSEUDONYM_KEY");
  return DEV_PSEUDONYM_KEY;
}

/** `label` separa los dominios (`attempt:ip`, `telegram:chat`…) para que no se crucen. */
export function pseudonym(env: PseudonymEnv, label: string, value: string): Promise<string> {
  return hmacSha256Hex(pseudonymKey(env), `${label}:${value}`);
}
