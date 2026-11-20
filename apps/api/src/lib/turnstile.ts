import { allowedOrigins } from "@delyra/shared";
import { z } from "zod";
import { AppError } from "./errors";

/**
 * Verificación de Turnstile en el servidor (F1-07). Falla cerrada: sin secreto configurado en
 * producción, login, registro y recuperación responden 503.
 *
 * En desarrollo y tests se usan las claves de prueba documentadas por Cloudflare. Con ellas la
 * verificación se resuelve en local, sin red: solo vale el token ficticio de prueba.
 */

export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const siteverifySchema = z.looseObject({
  success: z.boolean(),
  hostname: z.string().optional(),
});

const PRODUCTION_HOSTS = new Set(allowedOrigins("production").map((o) => new URL(o).host));

export async function verifyTurnstile(
  env: Pick<Env, "APP_ENV" | "TURNSTILE_SECRET_KEY">,
  token: string,
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const secret =
    env.TURNSTILE_SECRET_KEY ?? (env.APP_ENV === "development" ? TURNSTILE_TEST_SECRET : undefined);
  if (!secret) {
    throw new AppError(503, { detail: "La verificación antibots no está configurada" });
  }
  if (env.APP_ENV !== "production" && secret === TURNSTILE_TEST_SECRET) {
    return token === TURNSTILE_DUMMY_TOKEN;
  }

  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: ip,
        idempotency_key: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const result = siteverifySchema.safeParse(await response.json());
    if (!result.success || !result.data.success) return false;
    return env.APP_ENV !== "production" || PRODUCTION_HOSTS.has(result.data.hostname ?? "");
  } catch {
    return false;
  }
}
