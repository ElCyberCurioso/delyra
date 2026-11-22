import type { BoardLiveMessage } from "@delyra/shared";
import { DurableObject } from "cloudflare:workers";

/**
 * Sala en vivo de un tablero (F7-05): un Durable Object por tablero con WebSocket Hibernation.
 *
 * - La API autoriza la conexión (sesión, papel en el tablero y `Origin`) antes de pasarla aquí;
 *   el objeto solo acepta conexiones que vienen de la propia API.
 * - Por el canal no viaja ningún dato del tablero: solo «ha cambiado» y quién está mirando. Los
 *   clientes vuelven a pedir el tablero por la API, que es quien decide qué puede ver cada uno.
 *   Así, el servidor es la única fuente de verdad: dos cambios a la vez se resuelven con el
 *   último que llega (y los dos clientes acaban viendo el mismo estado).
 * - Mientras nadie escribe, el objeto hiberna; `ping` lo responde el runtime sin despertarlo.
 */

const MAX_CONNECTIONS = 100;

interface Viewer {
  userId: string;
  name: string;
}

export class BoardRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override fetch(request: Request): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Se esperaba un WebSocket", { status: 426 });
    }
    const userId = request.headers.get("x-delyra-user") ?? "";
    const name = decodeURIComponent(request.headers.get("x-delyra-name") ?? "");
    if (!userId) return new Response("Sin usuario", { status: 400 });
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
      return new Response("Demasiadas conexiones", { status: 429 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, name: name.slice(0, 80) } satisfies Viewer);
    this.#presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(): void {
    // Los clientes no envían nada más que `ping` (que contesta el runtime): se ignora el resto.
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Ya estaba cerrado.
    }
    this.#presence(new Set([ws]));
  }

  override webSocketError(ws: WebSocket): void {
    this.#presence(new Set([ws]));
  }

  /** La API avisa de un cambio en el tablero (RPC). */
  notify(by: string): void {
    this.#broadcast({ type: "changed", by });
  }

  /**
   * Se le quitó el acceso a alguien: se le avisa y se cierran sus conexiones (RPC). El aviso va
   * también como mensaje porque algún proxy no reenvía el código de cierre.
   */
  kick(userId: string): void {
    const kicked = new Set(this.ctx.getWebSockets(userId));
    const revoked = JSON.stringify({ type: "revoked" } satisfies BoardLiveMessage);
    for (const ws of kicked) {
      try {
        ws.send(revoked);
        ws.close(4403, "Ya no tienes acceso a este tablero");
      } catch {
        // Ya estaba cerrado.
      }
    }
    this.#presence(kicked);
  }

  /** Conexiones abiertas (para las pruebas y el diagnóstico). */
  connections(): number {
    return this.ctx.getWebSockets().length;
  }

  #broadcast(message: BoardLiveMessage, except: ReadonlySet<WebSocket> = new Set()): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (except.has(ws)) continue;
      try {
        ws.send(text);
      } catch {
        // Conexión rota: el runtime la cerrará.
      }
    }
  }

  /** Quién mira ahora, sin las conexiones que se están cerrando. */
  #presence(closing: ReadonlySet<WebSocket> = new Set()): void {
    const users = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (closing.has(ws)) continue;
      const viewer = ws.deserializeAttachment() as Viewer | null;
      if (viewer) users.set(viewer.userId, viewer.name);
    }
    this.#broadcast(
      { type: "presence", users: [...users].map(([id, name]) => ({ id, name })) },
      closing,
    );
  }
}
