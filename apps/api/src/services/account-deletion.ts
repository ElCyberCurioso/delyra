import type { AccountDeletionSummary } from "@delyra/shared";
import { and, countDistinct, eq, ne } from "drizzle-orm";
import type { Database } from "../db/client";
import { boardMembers, boards, invitations, users } from "../db/schema";
import type { Keyring } from "../lib/field-crypto";
import type { Logger } from "../lib/logger";
import { deletePrefix } from "./attachments";
import { kickFromBoard, notifyBoard } from "./board-live";
import { disconnectGoogle } from "./google-sync";

/**
 * Borrado de la cuenta (F8-12). Lo pide la propia persona desde Ajustes, en la web o en la app
 * (Google Play lo exige y es el derecho de supresión del RGPD), y se borra al momento:
 *
 * - Google: se revoca el permiso antes de borrar el token.
 * - R2: adjuntos de sus tableros, sus copias de seguridad y lo que quede de importaciones y
 *   restauraciones (todo cuelga de prefijos con su id).
 * - D1: la fila de `users`; el resto cae en cascada (sesiones, 2FA, llaves, calendarios,
 *   eventos, tableros con todo lo suyo, conexiones, Telegram, historial de seguridad…). Los
 *   comentarios y la actividad que dejó en tableros ajenos se quedan sin autor (`set null`).
 * - La invitación con la que entró se borra (guarda su email).
 * - Sus tableros se borran también para quien los compartía con él (decisión del usuario,
 *   ADR-0016): el canal en vivo les avisa. De los tableros ajenos sale del canal.
 *
 * Lo único que queda son las copias del sistema, que caducan solas (política de privacidad).
 */

/** Lo que hay que avisar antes de borrar: tableros compartidos y si es la última admin. */
export async function accountDeletionSummary(
  db: Database,
  user: { id: string; role: string },
): Promise<AccountDeletionSummary> {
  const [shared] = await db
    .select({
      boards: countDistinct(boardMembers.boardId),
      people: countDistinct(boardMembers.userId),
    })
    .from(boardMembers)
    .innerJoin(boards, eq(boards.id, boardMembers.boardId))
    .where(and(eq(boards.ownerId, user.id), ne(boardMembers.userId, user.id)));
  let lastAdmin = false;
  if (user.role === "admin") {
    const others = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, user.id)))
      .limit(1);
    lastAdmin = others.length === 0;
  }
  return {
    sharedBoards: shared?.boards ?? 0,
    sharedWith: shared?.people ?? 0,
    lastAdmin,
  };
}

export interface AccountDeletionEnv {
  ATTACHMENTS: R2Bucket;
  BACKUPS: R2Bucket;
  IMPORTS: R2Bucket;
  BOARD_ROOM: Env["BOARD_ROOM"];
}

export async function deleteAccount(
  db: Database,
  env: AccountDeletionEnv,
  keyring: Keyring,
  userId: string,
  logger?: Logger,
): Promise<{ boards: number; memberOf: number; googleRevoked: boolean }> {
  const owned = (
    await db.select({ id: boards.id }).from(boards).where(eq(boards.ownerId, userId))
  ).map((row) => row.id);
  const memberOf = (
    await db
      .select({ id: boardMembers.boardId })
      .from(boardMembers)
      .where(eq(boardMembers.userId, userId))
  ).map((row) => row.id);

  // Primero lo de fuera de D1: si algo falla, la cuenta sigue y se puede volver a intentar.
  const google = await disconnectGoogle(db, keyring, userId);
  // Mismos prefijos que `attachmentKey`, `backupKey`, `importPrefix` y `restorePrefix`.
  await deletePrefix(env.ATTACHMENTS, `boards/${userId}/`);
  await deletePrefix(env.BACKUPS, `users/${userId}/`);
  await deletePrefix(env.IMPORTS, `imports/${userId}/`);
  await deletePrefix(env.IMPORTS, `restores/${userId}/`);

  await db.delete(invitations).where(eq(invitations.acceptedUserId, userId));
  await db.delete(users).where(eq(users.id, userId));

  // Avisos en vivo: sus tableros ya no existen; en los ajenos, deja de estar conectado.
  for (const boardId of owned) await notifyBoard(env, boardId, userId, logger);
  for (const boardId of memberOf) {
    await kickFromBoard(env, boardId, userId);
    await notifyBoard(env, boardId, userId, logger);
  }
  return {
    boards: owned.length,
    memberOf: memberOf.length,
    googleRevoked: google?.revoked ?? false,
  };
}
