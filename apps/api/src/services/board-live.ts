import type { Logger } from "../lib/logger";

/**
 * Avisos al canal en vivo de un tablero (F7-05). Nunca hacen fallar la petición que los causa:
 * si el aviso no llega, los clientes se ponen al día en la siguiente recarga del tablero.
 */

function room(env: Pick<Env, "BOARD_ROOM">, boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

export async function notifyBoard(
  env: Pick<Env, "BOARD_ROOM">,
  boardId: string,
  by: string,
  logger?: Logger,
): Promise<void> {
  try {
    await room(env, boardId).notify(by);
  } catch (error) {
    logger?.warn("board_live_notify_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function kickFromBoard(
  env: Pick<Env, "BOARD_ROOM">,
  boardId: string,
  userId: string,
): Promise<void> {
  try {
    await room(env, boardId).kick(userId);
  } catch {
    // Sin conexiones abiertas no hay nada que cerrar.
  }
}

export function connectToBoard(
  env: Pick<Env, "BOARD_ROOM">,
  boardId: string,
  viewer: { id: string; name: string },
  request: Request,
): Promise<Response> {
  return room(env, boardId).fetch(
    new Request("https://board-room/connect", {
      headers: {
        Upgrade: "websocket",
        "x-delyra-user": viewer.id,
        "x-delyra-name": encodeURIComponent(viewer.name),
        // El protocolo de WebSocket necesita las cabeceras del handshake original.
        ...Object.fromEntries(
          [...request.headers].filter(([key]) => key.toLowerCase().startsWith("sec-websocket")),
        ),
      },
    }),
  );
}
