import { newId } from "@delyra/shared";
import { and, eq, gt, max, min, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { type AuthAttemptKind, authAttempts } from "../db/schema";
import { hmacSha256Hex } from "../lib/crypto";

/**
 * Protección contra fuerza bruta (F1-10): contadores por cuenta y por IP. Se cuentan los fallos
 * de la ventana posteriores al último acierto de esa misma clave. Las claves se guardan como HMAC:
 * nunca el email ni la IP en claro.
 */

export const ATTEMPT_WINDOW_MS = 15 * 60_000;
export const ATTEMPT_LIMITS = { account: 5, ip: 30 } as const;

const DEV_PSEUDONYM_KEY = "delyra-dev-pseudonym-key";

export interface AttemptKeys {
  account?: string;
  ip: string;
}

type Scope = keyof typeof ATTEMPT_LIMITS;

function pseudonymKey(env: Pick<Env, "APP_ENV" | "LOG_PSEUDONYM_KEY">): string {
  if (env.LOG_PSEUDONYM_KEY) return env.LOG_PSEUDONYM_KEY;
  if (env.APP_ENV === "production") throw new Error("Falta el secreto LOG_PSEUDONYM_KEY");
  return DEV_PSEUDONYM_KEY;
}

async function hashedKeys(
  env: Pick<Env, "APP_ENV" | "LOG_PSEUDONYM_KEY">,
  keys: AttemptKeys,
): Promise<[Scope, string][]> {
  const key = pseudonymKey(env);
  const entries: [Scope, string][] = [["ip", await hmacSha256Hex(key, `attempt:ip:${keys.ip}`)]];
  if (keys.account) {
    entries.push(["account", await hmacSha256Hex(key, `attempt:account:${keys.account}`)]);
  }
  return entries;
}

export interface LockStatus {
  locked: boolean;
  retryAfterSeconds: number;
}

export async function checkLock(
  db: Database,
  env: Pick<Env, "APP_ENV" | "LOG_PSEUDONYM_KEY">,
  kind: AuthAttemptKind,
  keys: AttemptKeys,
  now = Date.now(),
): Promise<LockStatus> {
  const windowStart = new Date(now - ATTEMPT_WINDOW_MS);
  let retryAfter = 0;
  for (const [scope, keyHash] of await hashedKeys(env, keys)) {
    const base = and(
      eq(authAttempts.kind, kind),
      eq(authAttempts.scope, scope),
      eq(authAttempts.keyHash, keyHash),
      gt(authAttempts.createdAt, windowStart),
    );
    const [lastSuccess] = await db
      .select({ at: max(authAttempts.createdAt) })
      .from(authAttempts)
      .where(and(base, eq(authAttempts.success, true)));
    const since = lastSuccess?.at ?? windowStart;
    const [failures] = await db
      .select({ count: sql<number>`count(*)`, oldest: min(authAttempts.createdAt) })
      .from(authAttempts)
      .where(and(base, eq(authAttempts.success, false), gt(authAttempts.createdAt, since)));
    if ((failures?.count ?? 0) >= ATTEMPT_LIMITS[scope]) {
      const oldest = failures?.oldest?.getTime() ?? now;
      retryAfter = Math.max(retryAfter, Math.ceil((oldest + ATTEMPT_WINDOW_MS - now) / 1000));
    }
  }
  return { locked: retryAfter > 0, retryAfterSeconds: Math.max(retryAfter, 0) };
}

export async function recordAttempt(
  db: Database,
  env: Pick<Env, "APP_ENV" | "LOG_PSEUDONYM_KEY">,
  kind: AuthAttemptKind,
  keys: AttemptKeys,
  success: boolean,
  now = Date.now(),
): Promise<void> {
  const rows = (await hashedKeys(env, keys)).map(([scope, keyHash]) => ({
    id: newId(),
    kind,
    scope,
    keyHash,
    success,
    createdAt: new Date(now),
  }));
  await db.insert(authAttempts).values(rows);
}
