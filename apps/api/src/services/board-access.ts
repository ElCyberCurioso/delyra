import {
  BOARD_SHARING_LIMITS,
  type BoardMemberRole,
  type BoardMembers,
  type BoardRole,
  type BoardSummary,
  newId,
  type PendingBoardInvitation,
} from "@delyra/shared";
import { and, asc, count, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  boardColumns,
  boardInvitations,
  boardMembers,
  boards,
  cardAttachments,
  cardComments,
  cards,
  checklistItems,
  labels,
  users,
} from "../db/schema";
import { AppError } from "../lib/errors";
import { type KanbanRepository, kanbanRepository } from "../repositories/kanban";
import { boardSummary } from "./kanban";

/**
 * Tableros compartidos (F7-04). Toda ruta del kanban pasa por `boardAccess`: localiza el tablero
 * del recurso (sea cual sea su dueño), comprueba el papel de quien pide y devuelve el repositorio
 * del dueño con ese contexto. Sin acceso → 404 (como si no existiera); con acceso de lectura y
 * una petición que escribe → 403.
 */

export type BoardRef =
  | { board: string }
  | { column: string }
  | { card: string }
  | { label: string }
  | { checklist: string }
  | { comment: string }
  | { attachment: string };

export type Need = "read" | "write" | "owner";

interface Located {
  boardId: string;
  ownerId: string;
}

async function viaCard(db: Database, cardId: string | undefined): Promise<Located | null> {
  if (!cardId) return null;
  const [row] = await db
    .select({ boardId: cards.boardId, ownerId: cards.ownerId })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  return row ?? null;
}

/** Tablero y dueño de un recurso, sin filtrar por usuario (la comprobación viene después). */
export async function locate(db: Database, ref: BoardRef): Promise<Located | null> {
  if ("board" in ref) {
    const [row] = await db
      .select({ boardId: boards.id, ownerId: boards.ownerId })
      .from(boards)
      .where(eq(boards.id, ref.board))
      .limit(1);
    return row ?? null;
  }
  if ("column" in ref) {
    const [row] = await db
      .select({ boardId: boardColumns.boardId, ownerId: boardColumns.ownerId })
      .from(boardColumns)
      .where(eq(boardColumns.id, ref.column))
      .limit(1);
    return row ?? null;
  }
  if ("label" in ref) {
    const [row] = await db
      .select({ boardId: labels.boardId, ownerId: labels.ownerId })
      .from(labels)
      .where(eq(labels.id, ref.label))
      .limit(1);
    return row ?? null;
  }
  if ("card" in ref) return viaCard(db, ref.card);
  const table =
    "checklist" in ref ? checklistItems : "comment" in ref ? cardComments : cardAttachments;
  const id = "checklist" in ref ? ref.checklist : "comment" in ref ? ref.comment : ref.attachment;
  const [row] = await db
    .select({ cardId: table.cardId })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return viaCard(db, row?.cardId);
}

export async function roleOn(
  db: Database,
  userId: string,
  located: Located,
): Promise<BoardRole | null> {
  if (located.ownerId === userId) return "owner";
  const [row] = await db
    .select({ role: boardMembers.role })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, located.boardId), eq(boardMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

export interface BoardAccess {
  repo: KanbanRepository;
  role: BoardRole;
  boardId: string;
  ownerId: string;
}

export async function boardAccess(
  db: Database,
  userId: string,
  ref: BoardRef,
  need: Need,
): Promise<BoardAccess> {
  const located = await locate(db, ref);
  const role = located ? await roleOn(db, userId, located) : null;
  if (!located || !role) throw new AppError(404);
  if (need === "write" && role === "reader") {
    throw new AppError(403, { detail: "Tienes este tablero en modo de solo lectura" });
  }
  if (need === "owner" && role !== "owner") {
    throw new AppError(403, { detail: "Solo puede hacerlo quien creó el tablero" });
  }
  return {
    repo: kanbanRepository(db, located.ownerId, userId, role),
    role,
    boardId: located.boardId,
    ownerId: located.ownerId,
  };
}

// ── Tableros compartidos contigo ─────────────────────────────────────────────

export async function sharedBoards(db: Database, userId: string): Promise<BoardSummary[]> {
  const open = db
    .select({ boardId: cards.boardId, total: count().as("total") })
    .from(cards)
    .where(and(isNull(cards.archivedAt), isNull(cards.completedAt)))
    .groupBy(cards.boardId)
    .as("open");
  const memberCount = db
    .select({ boardId: boardMembers.boardId, total: count().as("members") })
    .from(boardMembers)
    .groupBy(boardMembers.boardId)
    .as("member_count");
  const rows = await db
    .select({
      board: boards,
      role: boardMembers.role,
      ownerName: users.name,
      openCards: sql<number>`coalesce(${open.total}, 0)`,
      members: sql<number>`coalesce(${memberCount.total}, 0)`,
    })
    .from(boardMembers)
    .innerJoin(boards, eq(boards.id, boardMembers.boardId))
    .innerJoin(users, eq(users.id, boards.ownerId))
    .leftJoin(open, eq(open.boardId, boards.id))
    .leftJoin(memberCount, eq(memberCount.boardId, boards.id))
    .where(eq(boardMembers.userId, userId))
    .orderBy(asc(boards.name));
  return rows.map((r) =>
    boardSummary(r.board, Number(r.openCards), {
      role: r.role,
      ownerName: r.ownerName,
      members: Number(r.members),
    }),
  );
}

// ── Miembros e invitaciones ──────────────────────────────────────────────────

export async function boardMembersOf(
  db: Database,
  access: BoardAccess,
  viewerId: string,
): Promise<BoardMembers> {
  const owner = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, access.ownerId))
    .limit(1);
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: boardMembers.role })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, access.boardId))
    .orderBy(asc(users.name));
  const isOwner = access.role === "owner";
  const invitations = isOwner
    ? await db
        .select()
        .from(boardInvitations)
        .where(
          and(
            eq(boardInvitations.boardId, access.boardId),
            gt(boardInvitations.expiresAt, new Date()),
          ),
        )
        .orderBy(asc(boardInvitations.createdAt))
    : [];
  return {
    role: access.role,
    members: [
      ...owner.map((o) => ({
        userId: o.id,
        name: o.name,
        role: "owner" as const,
        email: isOwner ? o.email : null,
        you: o.id === viewerId,
      })),
      ...rows.map((m) => ({
        userId: m.id,
        name: m.name,
        role: m.role,
        // Los emails solo los ve el dueño (a quien invitó).
        email: isOwner ? m.email : null,
        you: m.id === viewerId,
      })),
    ],
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt.toISOString(),
    })),
  };
}

/** Invita por email. No dice si la dirección tiene cuenta (no se puede sondear quién existe). */
export async function inviteToBoard(
  db: Database,
  access: BoardAccess,
  input: { email: string; role: BoardMemberRole },
  invitedBy: string,
  now = Date.now(),
): Promise<void> {
  const [member] = await db
    .select({ id: users.id })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(and(eq(boardMembers.boardId, access.boardId), eq(users.email, input.email)))
    .limit(1);
  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, access.ownerId))
    .limit(1);
  if (member || owner?.email === input.email) {
    throw new AppError(409, { detail: "Esa persona ya tiene acceso al tablero" });
  }
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(boardMembers)
    .where(eq(boardMembers.boardId, access.boardId));
  if (total >= BOARD_SHARING_LIMITS.members) {
    throw new AppError(409, {
      detail: `Un tablero se puede compartir con ${String(BOARD_SHARING_LIMITS.members)} personas como mucho`,
    });
  }
  const values = {
    role: input.role,
    invitedBy,
    createdAt: new Date(now),
    expiresAt: new Date(now + BOARD_SHARING_LIMITS.invitationDays * 86_400_000),
  };
  await db
    .insert(boardInvitations)
    .values({ id: newId(), boardId: access.boardId, email: input.email, ...values })
    .onConflictDoUpdate({
      target: [boardInvitations.boardId, boardInvitations.email],
      set: values,
    });
}

export async function pendingInvitations(
  db: Database,
  email: string,
  now = Date.now(),
): Promise<PendingBoardInvitation[]> {
  const inviter = db.select({ id: users.id, name: users.name }).from(users).as("inviter");
  const rows = await db
    .select({ invitation: boardInvitations, boardName: boards.name, inviterName: inviter.name })
    .from(boardInvitations)
    .innerJoin(boards, eq(boards.id, boardInvitations.boardId))
    .leftJoin(inviter, eq(inviter.id, boardInvitations.invitedBy))
    .where(and(eq(boardInvitations.email, email), gt(boardInvitations.expiresAt, new Date(now))))
    .orderBy(asc(boardInvitations.createdAt));
  return rows.map((r) => ({
    id: r.invitation.id,
    boardName: r.boardName,
    invitedBy: r.inviterName,
    role: r.invitation.role,
    expiresAt: r.invitation.expiresAt.toISOString(),
  }));
}

/** Acepta (o rechaza) una invitación dirigida al email de quien la pide. */
export async function answerInvitation(
  db: Database,
  user: { id: string; email: string },
  invitationId: string,
  accept: boolean,
  now = Date.now(),
): Promise<string | null> {
  const [invitation] = await db
    .select()
    .from(boardInvitations)
    .where(
      and(
        eq(boardInvitations.id, invitationId),
        eq(boardInvitations.email, user.email),
        gt(boardInvitations.expiresAt, new Date(now)),
      ),
    )
    .limit(1);
  // Una invitación para otra dirección responde igual que una que no existe.
  if (!invitation) throw new AppError(404);
  const statements = [
    db.delete(boardInvitations).where(eq(boardInvitations.id, invitation.id)),
    ...(accept
      ? [
          db
            .insert(boardMembers)
            .values({
              boardId: invitation.boardId,
              userId: user.id,
              role: invitation.role,
              addedAt: new Date(now),
            })
            .onConflictDoNothing(),
        ]
      : []),
  ];
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
  return accept ? invitation.boardId : null;
}

export async function setMemberRole(
  db: Database,
  boardId: string,
  userId: string,
  role: BoardMemberRole,
): Promise<boolean> {
  const rows = await db
    .update(boardMembers)
    .set({ role })
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)))
    .returning({ userId: boardMembers.userId });
  return rows.length === 1;
}

export async function removeMember(db: Database, boardId: string, userId: string) {
  const rows = await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)))
    .returning({ userId: boardMembers.userId });
  return rows.length === 1;
}

export async function revokeInvitation(db: Database, boardId: string, invitationId: string) {
  const rows = await db
    .delete(boardInvitations)
    .where(and(eq(boardInvitations.boardId, boardId), eq(boardInvitations.id, invitationId)))
    .returning({ id: boardInvitations.id });
  return rows.length === 1;
}
