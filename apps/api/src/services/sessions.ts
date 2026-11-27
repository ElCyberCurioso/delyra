import { newId } from "@delyra/shared";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { type Session, type SessionState, sessions, type User, users } from "../db/schema";
import { randomToken, sha256Hex } from "../lib/crypto";
import type { RequestMeta } from "../lib/request-meta";

/**
 * Sesiones (F1-04). El cliente solo tiene un token opaco de 256 bits en una cookie HttpOnly;
 * en D1 se guarda su SHA-256. Estados:
 * - `pending_2fa`: contraseña correcta, falta el segundo factor (5 minutos, 5 intentos).
 * - `pending_totp`: contraseña correcta pero sin TOTP: solo puede darlo de alta.
 * - `active`: sesión completa (7 días de inactividad, 30 días como máximo).
 * Cada cambio de estado rota el token, para que nadie pueda fijar una sesión de antemano.
 */

export const SESSION_TTL = {
  pending: 5 * 60_000,
  activeIdle: 7 * 24 * 60 * 60_000,
  activeAbsolute: 30 * 24 * 60 * 60_000,
} as const;
const MAX_SECOND_FACTOR_ATTEMPTS = 5;
const TOUCH_INTERVAL_MS = 5 * 60_000;

function expiryFor(state: SessionState, now: number): Date {
  return new Date(now + (state === "active" ? SESSION_TTL.activeAbsolute : SESSION_TTL.pending));
}

export async function createSession(
  db: Database,
  userId: string,
  state: SessionState,
  meta: RequestMeta,
  now = Date.now(),
): Promise<{ token: string; session: Session }> {
  const token = randomToken();
  const [session] = await db
    .insert(sessions)
    .values({
      id: newId(),
      userId,
      tokenHash: await sha256Hex(token),
      state,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: expiryFor(state, now),
      userAgent: meta.userAgent,
      country: meta.country,
    })
    .returning();
  if (!session) throw new Error("No se pudo crear la sesión");
  return { token, session };
}

export interface ResolvedSession {
  session: Session;
  user: User;
}

/** Devuelve la sesión del token si sigue siendo válida (y su usuario activo). */
export async function resolveSession(
  db: Database,
  token: string,
  now = Date.now(),
): Promise<ResolvedSession | null> {
  if (!/^[\w-]{43}$/.test(token)) return null;
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, await sha256Hex(token)), isNull(sessions.revokedAt)))
    .limit(1);
  if (!row) return null;
  const { session, user } = row;
  if (user.status !== "active") return null;
  if (session.expiresAt.getTime() <= now) return null;
  if (session.state === "active" && now - session.lastSeenAt.getTime() > SESSION_TTL.activeIdle) {
    return null;
  }
  return { session, user };
}

/** Actualiza la última actividad como mucho cada 5 minutos para no escribir en cada petición. */
export async function touchSession(db: Database, session: Session, now = Date.now()) {
  if (now - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date(now) })
    .where(eq(sessions.id, session.id));
}

/** Cambia de estado con un token nuevo: el anterior deja de valer (anti fijación de sesión). */
export async function rotateSession(
  db: Database,
  sessionId: string,
  state: SessionState,
  now = Date.now(),
): Promise<string> {
  const token = randomToken();
  await db
    .update(sessions)
    .set({
      tokenHash: await sha256Hex(token),
      state,
      lastSeenAt: new Date(now),
      expiresAt: expiryFor(state, now),
      failedAttempts: 0,
    })
    .where(eq(sessions.id, sessionId));
  return token;
}

/** Suma un fallo de segundo factor y revoca la sesión pendiente al llegar al límite. */
export async function registerSecondFactorFailure(
  db: Database,
  sessionId: string,
  now = Date.now(),
) {
  const [row] = await db
    .update(sessions)
    .set({ failedAttempts: sql`${sessions.failedAttempts} + 1` })
    .where(eq(sessions.id, sessionId))
    .returning({ failedAttempts: sessions.failedAttempts });
  const attempts = row?.failedAttempts ?? MAX_SECOND_FACTOR_ATTEMPTS;
  if (attempts >= MAX_SECOND_FACTOR_ATTEMPTS) {
    await revokeSession(db, sessionId, "too_many_attempts", now);
    return { attempts, revoked: true };
  }
  return { attempts, revoked: false };
}

export async function revokeSession(
  db: Database,
  sessionId: string,
  reason: string,
  now = Date.now(),
) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(now), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** Revoca todas las sesiones del usuario (opcionalmente salvo una). Devuelve cuántas. */
export async function revokeUserSessions(
  db: Database,
  userId: string,
  reason: string,
  exceptSessionId?: string,
  now = Date.now(),
): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date(now), revokedReason: reason })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
      ),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

export async function listActiveSessions(db: Database, userId: string, now = Date.now()) {
  return db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      userAgent: sessions.userAgent,
      country: sessions.country,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.state, "active"),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date(now)),
      ),
    )
    .orderBy(desc(sessions.lastSeenAt));
}
