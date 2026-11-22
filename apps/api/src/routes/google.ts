import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createDb } from "../db/client";
import { constantTimeEqual } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { keyringFromEnv } from "../lib/field-crypto";
import { safeErrorMessage } from "../lib/logger";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { importRepository } from "../repositories/imports";
import {
  authorizeUrl,
  exchangeCode,
  googleConfig,
  newOAuthState,
  OAUTH_COOKIE,
  OAUTH_TTL_MS,
  openOAuthState,
  sealOAuthState,
  sealToken,
} from "../services/google";
import type { AppEnv } from "../types";
import { assertCanStartImport, launchAnalysis } from "./imports";

/**
 * Conexión con Google (F5-04). El navegador pide la URL de autorización por `POST` (pasa por la
 * protección CSRF), va a Google y vuelve a `GET /api/google/callback`, que comprueba el `state`
 * contra la cookie cifrada, canjea el código (PKCE) y lanza el análisis de la cuenta.
 */

const COOKIE_PATH = "/api/google/callback";
const IMPORT_PAGE = "/importar";

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(100).optional(),
});

export const googleRoutes = new Hono<AppEnv>()
  .get("/status", requireActiveSession(), (c) => c.json({ enabled: googleConfig(c.env) !== null }))

  .post("/authorize", requireActiveSession(), async (c) => {
    const config = googleConfig(c.env);
    if (!config) {
      throw new AppError(409, { detail: "La conexión con Google no está configurada" });
    }
    await assertCanStartImport(c);
    const state = newOAuthState(currentAuth(c).user.id, Date.now());
    setCookie(c, OAUTH_COOKIE, await sealOAuthState(state, await keyringFromEnv(c.env)), {
      httpOnly: true,
      secure: true,
      // Lax: la vuelta desde accounts.google.com es una navegación GET de primer nivel.
      sameSite: "Lax",
      path: COOKIE_PATH,
      maxAge: Math.floor(OAUTH_TTL_MS / 1000),
    });
    return c.json({ url: await authorizeUrl(config, state) });
  })

  .get("/callback", async (c) => {
    const back = (query: string) => c.redirect(`${IMPORT_PAGE}?${query}`, 302);
    const auth = c.get("auth");
    if (auth?.session.state !== "active") {
      return c.redirect(`/login?next=${encodeURIComponent(IMPORT_PAGE)}`, 302);
    }
    const cookie = getCookie(c, OAUTH_COOKIE);
    // La cookie es de un solo uso: se borra pase lo que pase.
    deleteCookie(c, OAUTH_COOKIE, { path: COOKIE_PATH, secure: true });

    const query = callbackQuerySchema.safeParse(c.req.query());
    if (!query.success) return back("google=error");
    if (query.data.error)
      return back(query.data.error === "access_denied" ? "google=denied" : "google=error");

    const keyring = await keyringFromEnv(c.env);
    const saved = cookie ? await openOAuthState(cookie, keyring) : null;
    const logger = c.get("logger");
    if (
      !saved ||
      !query.data.state ||
      !query.data.code ||
      saved.expiresAt < Date.now() ||
      saved.userId !== auth.user.id ||
      !constantTimeEqual(saved.state, query.data.state)
    ) {
      // `state` manipulado, caducado, de otra cuenta o sin cookie: posible CSRF.
      logger.warn("google_oauth_state_rejected");
      return back("google=state");
    }
    const config = googleConfig(c.env);
    if (!config) return back("google=error");

    try {
      await assertCanStartImport(c);
    } catch {
      return back("google=busy");
    }
    let accessToken: string;
    try {
      ({ accessToken } = await exchangeCode(config, query.data.code, saved.verifier));
    } catch (error) {
      logger.warn("google_oauth_exchange_failed", { error: safeErrorMessage(error) });
      return back("google=error");
    }

    const repo = importRepository(createDb(c.env.DB), auth.user.id);
    const row = await repo.create({
      source: "google",
      status: "analyzing",
      filename: null,
      sizeBytes: null,
    });
    // El token solo vive cifrado en la fila mientras el Workflow descarga los calendarios.
    const withToken =
      (await repo.update(row.id, {
        googleTokenEnc: await sealToken(accessToken, keyring, auth.user.id, row.id),
      })) ?? row;
    const launched = await launchAnalysis(c, withToken);
    return back(`import=${encodeURIComponent(launched.id)}`);
  });
