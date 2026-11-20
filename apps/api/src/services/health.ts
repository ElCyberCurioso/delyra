import {
  appEnvironmentSchema,
  type HealthComponent,
  type HealthComponentName,
  type HealthResponse,
} from "@delyra/shared";
import type { Logger } from "../lib/logger";

const CHECK_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tiempo de espera agotado (${String(ms)} ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function runCheck(
  name: HealthComponentName,
  check: () => Promise<unknown>,
  logger: Logger,
): Promise<HealthComponent> {
  const startedAt = performance.now();
  try {
    await withTimeout(check(), CHECK_TIMEOUT_MS);
    return { status: "ok", latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    logger.warn("health_check_failed", {
      component: name,
      errorName: error instanceof Error ? error.name : "NonError",
    });
    return { status: "error", latencyMs: Math.round(performance.now() - startedAt) };
  }
}

type HealthBindings = Pick<Env, "DB" | "BACKUPS" | "NOTIFICATIONS" | "APP_ENV"> & {
  CF_VERSION_METADATA?: { id: string };
};

/** Comprueba D1, R2 y Queues sin escribir nada. */
export async function runHealthChecks(
  env: HealthBindings,
  logger: Logger,
): Promise<HealthResponse> {
  const [d1, r2, queues] = await Promise.all([
    runCheck("d1", () => env.DB.prepare("SELECT 1 AS ok").first(), logger),
    // `head` de una clave que no existe: confirma acceso al bucket sin leer datos.
    runCheck("r2", () => env.BACKUPS.head("health/probe"), logger),
    // `metrics()` lee el backlog en tiempo real sin encolar nada.
    runCheck("queues", () => env.NOTIFICATIONS.metrics(), logger),
  ]);

  const checks = { d1, r2, queues };
  const healthy = Object.values(checks).every((check) => check.status === "ok");

  return {
    status: healthy ? "ok" : "degraded",
    environment: appEnvironmentSchema.parse(env.APP_ENV),
    version: env.CF_VERSION_METADATA?.id ?? null,
    time: new Date().toISOString(),
    checks,
  };
}
