import { boardLiveMessageSchema } from "@delyra/shared";
import { toast } from "@delyra/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BOARDS_KEY, boardKey } from "./api";

/**
 * Canal en vivo del tablero (F7-05). El servidor solo avisa de que algo ha cambiado (y de quién
 * está mirando); los datos se vuelven a pedir a la API, que sigue siendo la fuente de verdad. Si
 * se corta, se reconecta con espera creciente y, al volver, se refresca por si se perdió algo.
 */

export interface LivePerson {
  id: string;
  name: string;
}

export interface BoardLive {
  online: boolean;
  /** Otras personas con el tablero abierto ahora (sin repetir). */
  others: LivePerson[];
}

const PING_MS = 30_000;
const MAX_RETRY_MS = 30_000;
/** Cierre que manda el servidor al quitar el acceso a alguien. */
const REVOKED = 4403;

export function useBoardLive(boardId: string, userId: string): BoardLive {
  const queryClient = useQueryClient();
  const [state, setState] = useState<BoardLive>({ online: false, others: [] });

  useEffect(() => {
    if (typeof WebSocket === "undefined") return;
    let socket: WebSocket | null = null;
    let retries = 0;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    let stopped = false;

    const refresh = () => {
      // El prefijo incluye las archivadas y los miembros; solo se vuelve a pedir lo que está en uso.
      void queryClient.invalidateQueries({ queryKey: boardKey(boardId) });
      void queryClient.invalidateQueries({ queryKey: ["card"] });
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
    };

    /** Sin acceso: se deja de reconectar y el tablero, al pedirse de nuevo, ya no carga. */
    const revoked = () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(retryTimer);
      socket?.close(1000);
      toast.error("Ya no tienes acceso a este tablero.");
      refresh();
    };

    const connect = () => {
      const url = new URL(`/api/boards/${boardId}/live`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket = ws;
      ws.addEventListener("open", () => {
        if (retries > 0) refresh();
        retries = 0;
        setState((current) => ({ ...current, online: true }));
        // Mantiene viva la conexión a través de proxies; el servidor responde sin despertarse.
        pingTimer = window.setInterval(() => ws.send("ping"), PING_MS);
      });
      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || event.data === "pong") return;
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = boardLiveMessageSchema.safeParse(data);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === "revoked") {
          revoked();
        } else if (message.type === "presence") {
          const others = new Map(
            message.users.filter((u) => u.id !== userId).map((u) => [u.id, u] as const),
          );
          setState({ online: true, others: [...others.values()] });
        } else if (message.by !== userId) {
          // Los cambios propios ya los aplica la mutación que los hizo.
          refresh();
        }
      });
      ws.addEventListener("close", (event) => {
        window.clearInterval(pingTimer);
        setState({ online: false, others: [] });
        if (event.code === REVOKED) revoked();
        if (stopped) return;
        // Con algo de azar, para que no reconecten todas las pestañas a la vez.
        const jitter = (crypto.getRandomValues(new Uint16Array(1))[0] ?? 0) % 500;
        const delay = Math.min(MAX_RETRY_MS, 1_000 * 2 ** retries) + jitter;
        retries += 1;
        retryTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(pingTimer);
      socket?.close(1000);
    };
  }, [boardId, userId, queryClient]);

  return state;
}
