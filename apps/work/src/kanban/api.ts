import {
  acceptedBoardInvitationSchema,
  archivedCardsResponseSchema,
  type BoardDetail,
  boardDetailSchema,
  type BoardMemberRole,
  boardMembersResponseSchema,
  boardsResponseSchema,
  type CardDetail,
  type CardKind,
  cardResponseSchema,
  labelResponseSchema,
  moveCardResponseSchema,
  pendingBoardInvitationsResponseSchema,
  problemDetailsSchema,
} from "@delyra/shared";
import { ApiError, apiFetch } from "@delyra/ui";
import { type QueryClient, useQuery } from "@tanstack/react-query";

/** Acceso a la API del kanban (F4-03 a F4-06) desde work.delyra.app. */

export const BOARDS_KEY = ["boards"] as const;
export const boardKey = (id: string) => ["board", id] as const;
const cardKey = (id: string) => ["card", id] as const;
export const archivedKey = (id: string) => ["board", id, "archived"] as const;
export const membersKey = (id: string) => ["board", id, "members"] as const;
export const INVITATIONS_KEY = ["board-invitations"] as const;

export function useBoards() {
  return useQuery({
    queryKey: BOARDS_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/boards", { schema: boardsResponseSchema, signal }).then((r) => r.boards),
  });
}

export function useBoard(id: string) {
  return useQuery({
    queryKey: boardKey(id),
    queryFn: ({ signal }) => apiFetch(`/api/boards/${id}`, { schema: boardDetailSchema, signal }),
  });
}

export function useCard(id: string | null) {
  return useQuery({
    queryKey: cardKey(id ?? ""),
    enabled: id !== null,
    queryFn: ({ signal }) =>
      apiFetch(`/api/cards/${id ?? ""}`, { schema: cardResponseSchema, signal }).then(
        (r) => r.card,
      ),
  });
}

export function useArchived(boardId: string, enabled: boolean) {
  return useQuery({
    queryKey: archivedKey(boardId),
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`/api/boards/${boardId}/archived`, {
        schema: archivedCardsResponseSchema,
        signal,
      }).then((r) => r.cards),
  });
}

// ── Compartir (F7-04) ────────────────────────────────────────────────────────

export function useBoardMembers(boardId: string, enabled: boolean) {
  return useQuery({
    queryKey: membersKey(boardId),
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`/api/boards/${boardId}/members`, { schema: boardMembersResponseSchema, signal }),
  });
}

/** Invitaciones a tableros que esperan respuesta de quien ha entrado. */
export function usePendingInvitations() {
  return useQuery({
    queryKey: INVITATIONS_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/board-invitations", {
        schema: pendingBoardInvitationsResponseSchema,
        signal,
      }).then((r) => r.invitations),
  });
}

export const inviteToBoard = (boardId: string, body: { email: string; role: BoardMemberRole }) =>
  apiFetch(`/api/boards/${boardId}/invitations`, {
    method: "POST",
    body,
    schema: boardMembersResponseSchema,
  });

export const revokeBoardInvitation = (boardId: string, invitationId: string) =>
  apiFetch(`/api/boards/${boardId}/invitations/${invitationId}`, { method: "DELETE" });

export const setBoardMemberRole = (boardId: string, userId: string, role: BoardMemberRole) =>
  apiFetch(`/api/boards/${boardId}/members/${userId}`, {
    method: "PATCH",
    body: { role },
    schema: boardMembersResponseSchema,
  });

/** Quita a alguien del tablero; con el id propio, salir de él. */
export const removeBoardMember = (boardId: string, userId: string) =>
  apiFetch(`/api/boards/${boardId}/members/${userId}`, { method: "DELETE" });

export const acceptBoardInvitation = (id: string) =>
  apiFetch(`/api/board-invitations/${id}/accept`, {
    method: "POST",
    schema: acceptedBoardInvitationSchema,
  });

export const declineBoardInvitation = (id: string) =>
  apiFetch(`/api/board-invitations/${id}/decline`, { method: "POST" });

// ── Tableros y columnas ──────────────────────────────────────────────────────

export const createBoard = (body: { name: string; template: string }) =>
  apiFetch("/api/boards", { method: "POST", body, schema: boardDetailSchema });

export const updateBoard = (id: string, body: { name?: string; autoarchiveDays?: number }) =>
  apiFetch(`/api/boards/${id}`, { method: "PATCH", body, schema: boardDetailSchema });

export const deleteBoard = (id: string) => apiFetch(`/api/boards/${id}`, { method: "DELETE" });

export const addColumn = (
  boardId: string,
  body: { name: string; wipLimit: number | null; isDone: boolean; delegated: boolean },
) =>
  apiFetch(`/api/boards/${boardId}/columns`, {
    method: "POST",
    body,
    schema: boardDetailSchema,
  });

export const updateColumn = (
  id: string,
  body: { name?: string; wipLimit?: number | null; isDone?: boolean; delegated?: boolean },
) => apiFetch(`/api/columns/${id}`, { method: "PATCH", body, schema: boardDetailSchema });

export const moveColumn = (id: string, index: number) =>
  apiFetch(`/api/columns/${id}/move`, {
    method: "POST",
    body: { index },
    schema: boardDetailSchema,
  });

export const deleteColumn = (id: string) => apiFetch(`/api/columns/${id}`, { method: "DELETE" });

export const addLabel = (boardId: string, body: { name: string; color: string }) =>
  apiFetch(`/api/boards/${boardId}/labels`, {
    method: "POST",
    body,
    schema: labelResponseSchema,
  }).then((r) => r.label);

export const deleteLabel = (id: string) => apiFetch(`/api/labels/${id}`, { method: "DELETE" });

// ── Tarjetas ─────────────────────────────────────────────────────────────────

export const createCard = (columnId: string, title: string, kind: CardKind = "task") =>
  apiFetch(`/api/columns/${columnId}/cards`, {
    method: "POST",
    body: { title, kind },
    schema: cardResponseSchema,
  }).then((r) => r.card);

export const updateCard = (id: string, body: Record<string, unknown>) =>
  apiFetch(`/api/cards/${id}`, { method: "PATCH", body, schema: cardResponseSchema }).then(
    (r) => r.card,
  );

/** `assignee`: a quién se le pasa al llevarla a una columna delegada. */
export const moveCard = (id: string, columnId: string, index: number, assignee?: string) =>
  apiFetch(`/api/cards/${id}/move`, {
    method: "POST",
    body: { columnId, index, ...(assignee !== undefined ? { assignee } : {}) },
    schema: moveCardResponseSchema,
  });

export const archiveCard = (id: string, archived: boolean) =>
  apiFetch(`/api/cards/${id}/${archived ? "archive" : "restore"}`, {
    method: "POST",
    schema: cardResponseSchema,
  }).then((r) => r.card);

export const deleteCard = (id: string) => apiFetch(`/api/cards/${id}`, { method: "DELETE" });

const cardCall = (path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) =>
  apiFetch(path, { method, body, schema: cardResponseSchema }).then((r) => r.card);

export const addChecklistItem = (cardId: string, text: string) =>
  cardCall(`/api/cards/${cardId}/checklist`, "POST", { text });
export const updateChecklistItem = (id: string, body: { text?: string; done?: boolean }) =>
  cardCall(`/api/checklist/${id}`, "PATCH", body);
export const deleteChecklistItem = (id: string) => cardCall(`/api/checklist/${id}`, "DELETE");

export const addComment = (cardId: string, body: string) =>
  cardCall(`/api/cards/${cardId}/comments`, "POST", { body });
export const updateComment = (id: string, body: string) =>
  cardCall(`/api/comments/${id}`, "PATCH", { body });
export const deleteComment = (id: string) => cardCall(`/api/comments/${id}`, "DELETE");

export const deleteAttachment = (id: string) => cardCall(`/api/attachments/${id}`, "DELETE");

/**
 * Sube un adjunto como cuerpo binario (no multipart): la API lo pasa a R2 en streaming. El
 * navegador pone `Content-Length`; el nombre va codificado en `X-Filename`.
 */
export async function uploadAttachment(cardId: string, file: File): Promise<CardDetail> {
  const response = await fetch(
    new URL(`/api/cards/${cardId}/attachments`, window.location.origin),
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name),
      },
      body: file,
    },
  );
  if (!response.ok) {
    let problem = null;
    try {
      problem = problemDetailsSchema.parse(await response.json());
    } catch {
      // Sin problem+json: basta con el código.
    }
    throw new ApiError(response.status, problem);
  }
  return cardResponseSchema.parse(await response.json()).card;
}

export const attachmentUrl = (id: string) => `/api/attachments/${id}`;

/**
 * Tras cambiar una tarjeta: su detalle y el tablero (contadores, etiquetas…) se actualizan al
 * momento y el tablero se vuelve a pedir. Invalidar cancela cualquier petición del tablero que
 * ya estuviera en curso: si no, una respuesta anterior al cambio podría llegar después y pisarlo.
 */
export function applyCard(queryClient: QueryClient, card: CardDetail) {
  queryClient.setQueryData(cardKey(card.id), card);
  queryClient.setQueryData<BoardDetail>(boardKey(card.boardId), (board) => {
    if (!board) return board;
    const rest = board.cards.filter((c) => c.id !== card.id);
    // Las archivadas salen del tablero.
    return { ...board, cards: card.archivedAt ? rest : [...rest, card] };
  });
  void queryClient.invalidateQueries({ queryKey: boardKey(card.boardId), exact: true });
  void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
}
