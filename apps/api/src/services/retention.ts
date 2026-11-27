import { and, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database } from "../db/client";
import {
  auditLog,
  authAttempts,
  boardInvitations,
  invitations,
  passwordResets,
  sessions,
} from "../db/schema";

/**
 * Plazos de conservación de los datos técnicos (política de privacidad, «Cuánto tiempo»). El
 * cron diario borra lo que ha pasado su plazo; el resto de los datos de la cuenta se conservan
 * mientras exista.
 */

const DAY_MS = 86_400_000;

const RETENTION_DAYS = {
  /** Sesiones caducadas o cerradas. */
  sessions: 30,
  /** Intentos de inicio de sesión y de segundo factor (los bloqueos miran 15 minutos). */
  authAttempts: 30,
  /** Enlaces de restablecimiento de contraseña, usados o caducados. */
  passwordResets: 30,
  /** Invitaciones (a Delyra o a un tablero) que caducaron o se revocaron sin aceptarse. */
  invitations: 30,
  /** Historial de seguridad de la cuenta. */
  auditLog: 365,
} as const;

/** Por tandas, para no bloquear D1 con un borrado enorme. */
const BATCH = 500;
const MAX_BATCHES = 40;

async function deleteInBatches(
  db: Database,
  table: SQLiteTable,
  id: SQLiteColumn,
  where: SQL | undefined,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const deleted = await db
      .delete(table)
      .where(inArray(id, db.select({ id }).from(table).where(where).limit(BATCH)))
      .returning({ id });
    total += deleted.length;
    if (deleted.length < BATCH) break;
  }
  return total;
}

export type PurgeCounts = Record<keyof typeof RETENTION_DAYS | "boardInvitations", number>;

export async function purgeExpiredData(db: Database, now = Date.now()): Promise<PurgeCounts> {
  const before = (days: number) => new Date(now - days * DAY_MS);
  const sessionsCutoff = before(RETENTION_DAYS.sessions);
  const invitationsCutoff = before(RETENTION_DAYS.invitations);
  return {
    sessions: await deleteInBatches(
      db,
      sessions,
      sessions.id,
      or(
        lt(sessions.expiresAt, sessionsCutoff),
        and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, sessionsCutoff)),
      ),
    ),
    authAttempts: await deleteInBatches(
      db,
      authAttempts,
      authAttempts.id,
      lt(authAttempts.createdAt, before(RETENTION_DAYS.authAttempts)),
    ),
    passwordResets: await deleteInBatches(
      db,
      passwordResets,
      passwordResets.id,
      lt(passwordResets.expiresAt, before(RETENTION_DAYS.passwordResets)),
    ),
    // Las aceptadas se conservan: dicen quién invitó a quién.
    invitations: await deleteInBatches(
      db,
      invitations,
      invitations.id,
      and(
        isNull(invitations.acceptedAt),
        or(
          lt(invitations.expiresAt, invitationsCutoff),
          and(isNotNull(invitations.revokedAt), lt(invitations.revokedAt, invitationsCutoff)),
        ),
      ),
    ),
    boardInvitations: await deleteInBatches(
      db,
      boardInvitations,
      boardInvitations.id,
      lt(boardInvitations.expiresAt, invitationsCutoff),
    ),
    auditLog: await deleteInBatches(
      db,
      auditLog,
      auditLog.id,
      lt(auditLog.createdAt, before(RETENTION_DAYS.auditLog)),
    ),
  };
}
