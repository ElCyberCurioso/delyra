import {
  idSchema,
  microsoftAuthorizeRequestSchema,
  microsoftBoardSyncRequestSchema,
} from "@delyra/shared";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createDb } from "../db/client";
import { constantTimeEqual } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { keyringFromEnv } from "../lib/field-crypto";
import { idParam, readBody } from "../lib/http";
import { safeErrorMessage } from "../lib/logger";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { audit } from "../services/audit";
import { boardAccess } from "../services/board-access";
import { notifyBoard } from "../services/board-live";
import {
  exchangeMicrosoftCode,
  microsoftAuthorizeUrl,
  microsoftConfig,
  MICROSOFT_OAUTH_COOKIE,
  MICROSOFT_OAUTH_TTL_MS,
  newMicrosoftState,
  openMicrosoftState,
  sealMicrosoftState,
} from "../services/microsoft";
import {
  boardSyncInfo,
  boardSyncRow,
  claimBoardSync,
  configureBoardSync,
  disconnectMicrosoft,
  MANUAL_MICROSOFT_SYNC_MIN_MS,
  saveMicrosoftConnection,
  stopBoardSync,
  syncBoard,
} from "../services/microsoft-sync";
import type { AppEnv } from "../types";

/**
 * Reuniones de Teams en un tablero (docs/plan-teams.md, ADR-0015). La conexión se pide desde los
 * ajustes de un tablero en work.delyra.app: `POST /authorize` deja el `state` y el verificador
 * PKCE en una cookie cifrada, Microsoft vuelve a `GET /callback` y se regresa al tablero.
 */

const COOKIE_PATH = "/api/microsoft/callback";

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(100).optional(),
});

function requireConfig(c: Context<AppEnv>) {
  const config = microsoftConfig(c.env);
  if (!config) {
    throw new AppError(409, { detail: "La conexión con Microsoft 365 no está configurada" });
  }
  return config;
}

function notifier(c: Context<AppEnv>) {
  return (boardId: string, by: string) => notifyBoard(c.env, boardId, by, c.get("logger"));
}

async function info(c: Context<AppEnv>, boardId: string) {
  return boardSyncInfo(
    createDb(c.env.DB),
    currentAuth(c).user.id,
    boardId,
    microsoftConfig(c.env) !== null,
  );
}

export const microsoftRoutes = new Hono<AppEnv>()
  .post("/authorize", requireActiveSession(), async (c) => {
    const { boardId } = await readBody(c, microsoftAuthorizeRequestSchema);
    const config = requireConfig(c);
    const userId = currentAuth(c).user.id;
    await boardAccess(createDb(c.env.DB), userId, { board: boardId }, "write");
    const state = newMicrosoftState(userId, boardId, Date.now());
    setCookie(
      c,
      MICROSOFT_OAUTH_COOKIE,
      await sealMicrosoftState(state, await keyringFromEnv(c.env)),
      {
        httpOnly: true,
        secure: true,
        // Lax: la vuelta desde login.microsoftonline.com es una navegación GET de primer nivel.
        sameSite: "Lax",
        path: COOKIE_PATH,
        maxAge: Math.floor(MICROSOFT_OAUTH_TTL_MS / 1000),
      },
    );
    return c.json({ url: await microsoftAuthorizeUrl(config, state) });
  })

  .get("/callback", async (c) => {
    const auth = c.get("auth");
    if (auth?.session.state !== "active") return c.redirect("/", 302);
    const cookie = getCookie(c, MICROSOFT_OAUTH_COOKIE);
    // La cookie es de un solo uso: se borra pase lo que pase.
    deleteCookie(c, MICROSOFT_OAUTH_COOKIE, { path: COOKIE_PATH, secure: true });

    const keyring = await keyringFromEnv(c.env);
    const saved = cookie ? await openMicrosoftState(cookie, keyring) : null;
    const logger = c.get("logger");
    const query = callbackQuerySchema.safeParse(c.req.query());
    const board = saved && idSchema.safeParse(saved.boardId).success ? saved.boardId : null;
    const back = (result: string) =>
      c.redirect(board ? `/tableros/${board}?microsoft=${result}` : `/?microsoft=${result}`, 302);
    if (!query.success) return back("error");
    if (query.data.error) return back(query.data.error === "access_denied" ? "denied" : "error");
    if (
      !saved ||
      !query.data.state ||
      !query.data.code ||
      saved.expiresAt < Date.now() ||
      saved.userId !== auth.user.id ||
      !constantTimeEqual(saved.state, query.data.state)
    ) {
      // `state` manipulado, caducado, de otra cuenta o sin cookie: posible CSRF.
      logger.warn("microsoft_oauth_state_rejected");
      return back("state");
    }
    const config = microsoftConfig(c.env);
    if (!config) return back("error");
    try {
      const tokens = await exchangeMicrosoftCode(config, query.data.code, saved.verifier);
      const db = createDb(c.env.DB);
      await saveMicrosoftConnection(db, keyring, auth.user.id, tokens, Date.now());
      await audit(db, c.get("meta"), "microsoft.connected", { userId: auth.user.id });
      return back("conectada");
    } catch (error) {
      logger.warn("microsoft_oauth_exchange_failed", { error: safeErrorMessage(error) });
      return back("error");
    }
  })

  .delete("/connection", requireActiveSession(), async (c) => {
    const db = createDb(c.env.DB);
    const userId = currentAuth(c).user.id;
    if (!(await disconnectMicrosoft(db, userId))) throw new AppError(404);
    await audit(db, c.get("meta"), "microsoft.disconnected", { userId });
    return c.body(null, 204);
  })

  .get("/boards/:boardId", requireActiveSession(), async (c) =>
    c.json(await info(c, idParam(c, "boardId"))),
  )

  .put("/boards/:boardId", requireActiveSession(), async (c) => {
    const boardId = idParam(c, "boardId");
    const body = await readBody(c, microsoftBoardSyncRequestSchema);
    const config = requireConfig(c);
    const db = createDb(c.env.DB);
    const now = Date.now();
    const row = await configureBoardSync(db, currentAuth(c).user.id, boardId, body, now);
    // La primera pasada va aparte; mientras, el planificador no la toca.
    const claimed = { ...row, nextSyncAt: now + 10 * 60_000 };
    await claimBoardSync(db, row.id, claimed.nextSyncAt);
    const keyring = await keyringFromEnv(c.env);
    c.executionCtx.waitUntil(
      syncBoard(db, keyring, config, claimed, now, notifier(c)).catch((error: unknown) => {
        c.get("logger").warn("microsoft_board_first_sync_failed", {
          syncId: row.id,
          error: safeErrorMessage(error),
        });
      }),
    );
    return c.json(await info(c, boardId));
  })

  .post("/boards/:boardId/sync", requireActiveSession(), async (c) => {
    const boardId = idParam(c, "boardId");
    const config = requireConfig(c);
    const db = createDb(c.env.DB);
    const userId = currentAuth(c).user.id;
    await boardAccess(db, userId, { board: boardId }, "write");
    const row = await boardSyncRow(db, boardId);
    if (row?.ownerId !== userId) throw new AppError(404);
    const now = Date.now();
    if (row.lastSyncedAt !== null && now - row.lastSyncedAt < MANUAL_MICROSOFT_SYNC_MIN_MS) {
      throw new AppError(429, { detail: "Se acaba de actualizar. Espera unos minutos." });
    }
    // El error, si lo hay, queda en la fila (estado y mensaje).
    await syncBoard(db, await keyringFromEnv(c.env), config, row, now, notifier(c)).catch(
      () => null,
    );
    return c.json(await info(c, boardId));
  })

  .delete("/boards/:boardId", requireActiveSession(), async (c) => {
    const boardId = idParam(c, "boardId");
    const db = createDb(c.env.DB);
    if (!(await stopBoardSync(db, currentAuth(c).user.id, boardId))) throw new AppError(404);
    return c.body(null, 204);
  });
