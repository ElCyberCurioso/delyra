import { allowedOrigins } from "@delyra/shared";
import { z } from "zod";
import { constantTimeEqual } from "./crypto";
import { AppError } from "./errors";

/**
 * Verificación de Turnstile en el servidor (F1-07). Falla cerrada: sin secreto configurado en
 * producción, login, registro y recuperación responden 503.
 *
 * En desarrollo y tests (sin `TURNSTILE_SECRET_KEY`) la SPA usa la site key de prueba de
 * Cloudflare, que siempre entrega el token ficticio de abajo: se acepta ese token y solo ese, sin
 * llamar a la red. Si se configura un secreto en local, se verifica contra Cloudflare como en
 * producción.
 */

/** Token que emite el widget con la site key de prueba `1x00000000000000000000AA`. */
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
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (env.APP_ENV === "development") return constantTimeEqual(token, TURNSTILE_DUMMY_TOKEN);
    throw new AppError(503, { detail: "La verificación antibots no está configurada" });
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
