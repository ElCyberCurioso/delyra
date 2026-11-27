import { APP_ORIGINS, type AppEnvironment, newId, type Role } from "@delyra/shared";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { type Invitation, invitations } from "../db/schema";
import { randomToken, sha256Hex } from "../lib/crypto";

/** Invitaciones de un solo uso (F1-06). El token solo existe en el enlace; aquí, su SHA-256. */

const DAY_MS = 24 * 60 * 60_000;

/** La invitación `invitationId`, si nadie la ha usado ni revocado. */
const unused = (invitationId: string) =>
  and(
    eq(invitations.id, invitationId),
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
  );

/** El token va en el fragmento (`#`): el navegador no lo envía al servidor ni en el Referer. */
export function invitationLink(environment: AppEnvironment, token: string): string {
  return `${APP_ORIGINS[environment].calendar}/registro#token=${token}`;
}

export async function createInvitation(
  db: Database,
  input: { email: string; role: Role; createdBy: string | null; expiresInDays: number },
  now = Date.now(),
): Promise<{ invitation: Invitation; token: string }> {
  const token = randomToken();
  const [invitation] = await db
    .insert(invitations)
    .values({
      id: newId(),
      email: input.email,
      role: input.role,
      tokenHash: await sha256Hex(token),
      createdBy: input.createdBy,
      createdAt: new Date(now),
      expiresAt: new Date(now + input.expiresInDays * DAY_MS),
    })
    .returning();
  if (!invitation) throw new Error("No se pudo crear la invitación");
  return { invitation, token };
}

/** Invitación vigente (sin usar, sin revocar y sin caducar) para el token dado. */
export async function findValidInvitation(
  db: Database,
  token: string,
  now = Date.now(),
): Promise<Invitation | undefined> {
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tokenHash, await sha256Hex(token)),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date(now)),
      ),
    )
    .limit(1);
  return invitation;
}

/**
 * Reserva la invitación solo si nadie la usó antes (evita dos registros a la vez). El usuario
 * aún no existe en este punto, así que `acceptedUserId` se enlaza después con `linkInvitationUser`.
 */
export async function claimInvitation(
  db: Database,
  invitationId: string,
  now = Date.now(),
): Promise<boolean> {
  const rows = await db
    .update(invitations)
    .set({ acceptedAt: new Date(now) })
    .where(unused(invitationId))
    .returning({ id: invitations.id });
  return rows.length === 1;
}

export async function linkInvitationUser(db: Database, invitationId: string, userId: string) {
  await db
    .update(invitations)
    .set({ acceptedUserId: userId })
    .where(eq(invitations.id, invitationId));
}

/** Deshace una reserva cuando el alta del usuario falla. */
export async function releaseInvitation(db: Database, invitationId: string) {
  await db
    .update(invitations)
    .set({ acceptedAt: null, acceptedUserId: null })
    .where(eq(invitations.id, invitationId));
}

/** Genera un enlace nuevo y amplía la caducidad. El enlace anterior deja de valer. */
export async function resendInvitation(
  db: Database,
  invitationId: string,
  expiresInDays: number,
  now = Date.now(),
): Promise<{ invitation: Invitation; token: string } | null> {
  const token = randomToken();
  const [invitation] = await db
    .update(invitations)
    .set({ tokenHash: await sha256Hex(token), expiresAt: new Date(now + expiresInDays * DAY_MS) })
    .where(unused(invitationId))
    .returning();
  return invitation ? { invitation, token } : null;
}

export async function revokeInvitation(db: Database, invitationId: string, now = Date.now()) {
  const rows = await db
    .update(invitations)
    .set({ revokedAt: new Date(now) })
    .where(unused(invitationId))
    .returning({ id: invitations.id });
  return rows.length === 1;
}

export async function listInvitations(db: Database) {
  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    .orderBy(desc(invitations.createdAt))
    .limit(200);
}
