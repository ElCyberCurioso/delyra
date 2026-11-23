import { addGoogleSyncRequestSchema, idSchema } from "@delyra/shared";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createDb } from "../db/client";
import { constantTimeEqual } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { keyringFromEnv } from "../lib/field-crypto";
import { readBody } from "../lib/http";
import { safeErrorMessage } from "../lib/logger";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { googleSyncRepository } from "../repositories/google-sync";
import { importRepository } from "../repositories/imports";
import { audit } from "../services/audit";
import {
  authorizeUrl,
  exchangeCode,
  googleConfig,
  newOAuthState,
  OAUTH_COOKIE,
  type OAuthPurpose,
  OAUTH_TTL_MS,
  openOAuthState,
  sealOAuthState,
  sealToken,
} from "../services/google";
import {
  addGoogleCalendar,
  disconnectGoogle,
  googleSyncDto,
  listAccountCalendars,
  MANUAL_GOOGLE_SYNC_MIN_MS,
  removeGoogleCalendar,
  saveGoogleConnection,
  syncGoogleCalendar,
} from "../services/google-sync";
import type { AppEnv } from "../types";
import { assertCanStartImport, launchAnalysis } from "./imports";

/**
 * Conexión con Google (F5-04). El navegador pide la URL de autorización por `POST` (pasa por la
 * protección CSRF), va a Google y vuelve a `GET /api/google/callback`, que comprueba el `state`
 * contra la cookie cifrada, canjea el código (PKCE) y lanza el análisis de la cuenta.
 */

const COOKIE_PATH = "/api/google/callback";
const IMPORT_PAGE = "/importar";

function requireConfig(c: Context<AppEnv>) {
  const config = googleConfig(c.env);
  if (!config) {
    throw new AppError(409, { detail: "La conexión con Google no está configurada" });
  }
  return config;
}

/** Deja la cookie con el `state` y devuelve la URL de Google para el propósito pedido. */
async function startAuthorization(c: Context<AppEnv>, purpose: OAuthPurpose) {
  const config = requireConfig(c);
  const state = newOAuthState(currentAuth(c).user.id, Date.now(), purpose);
  setCookie(c, OAUTH_COOKIE, await sealOAuthState(state, await keyringFromEnv(c.env)), {
    httpOnly: true,
    secure: true,
    // Lax: la vuelta desde accounts.google.com es una navegación GET de primer nivel.
    sameSite: "Lax",
    path: COOKIE_PATH,
    maxAge: Math.floor(OAUTH_TTL_MS / 1000),
  });
  return c.json({ url: await authorizeUrl(config, state) });
}

function syncedId(c: Context<AppEnv>): string {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(404);
  return id.data;
}

async function syncInfo(c: Context<AppEnv>) {
  return googleSyncDto(createDb(c.env.DB), currentAuth(c).user.id, googleConfig(c.env) !== null);
}

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(100).optional(),
});

export const googleRoutes = new Hono<AppEnv>()
  .get("/status", requireActiveSession(), (c) => c.json({ enabled: googleConfig(c.env) !== null }))

  .post("/authorize", requireActiveSession(), async (c) => {
    requireConfig(c);
    await assertCanStartImport(c);
    return startAuthorization(c, "import");
  })

  // ── Sincronización continua (F7-09) ──
  .get("/sync", requireActiveSession(), async (c) => c.json(await syncInfo(c)))

  .post("/sync/authorize", requireActiveSession(), (c) => startAuthorization(c, "sync"))

  .get("/sync/available", requireActiveSession(), async (c) => {
    const calendars = await listAccountCalendars(
      createDb(c.env.DB),
      await keyringFromEnv(c.env),
      requireConfig(c),
      currentAuth(c).user.id,
      Date.now(),
    );
    c.header("Cache-Control", "no-store");
    return c.json({ calendars });
  })

  .post("/sync/calendars", requireActiveSession(), async (c) => {
    const body = await readBody(c, addGoogleSyncRequestSchema);
    const config = requireConfig(c);
    const db = createDb(c.env.DB);
    const keyring = await keyringFromEnv(c.env);
    const now = Date.now();
    const row = await addGoogleCalendar(db, keyring, config, currentAuth(c).user.id, body, now);
    // La primera descarga va aparte (puede tardar); mientras, el planificador no la toca.
    const claimed = { ...row, nextSyncAt: now + 10 * 60_000 };
    await googleSyncRepository(db, row.ownerId).updateCalendar(row.id, {
      nextSyncAt: claimed.nextSyncAt,
    });
    c.executionCtx.waitUntil(
      syncGoogleCalendar(db, keyring, config, claimed, now).catch((error: unknown) => {
        c.get("logger").warn("google_calendar_first_sync_failed", {
          syncId: row.id,
          error: safeErrorMessage(error),
        });
      }),
    );
    return c.json(await syncInfo(c), 201);
  })

  .post("/sync/calendars/:id/sync", requireActiveSession(), async (c) => {
    const config = requireConfig(c);
    const db = createDb(c.env.DB);
    const row = await googleSyncRepository(db, currentAuth(c).user.id).calendar(syncedId(c));
    if (!row) throw new AppError(404);
    const now = Date.now();
    if (row.lastSyncedAt !== null && now - row.lastSyncedAt < MANUAL_GOOGLE_SYNC_MIN_MS) {
      throw new AppError(429, { detail: "Se acaba de sincronizar. Espera unos minutos." });
    }
    // El error, si lo hay, queda en la fila (estado y mensaje).
    await syncGoogleCalendar(db, await keyringFromEnv(c.env), config, row, now).catch(() => null);
    return c.json(await syncInfo(c));
  })

  .delete("/sync/calendars/:id", requireActiveSession(), async (c) => {
    const db = createDb(c.env.DB);
    if (!(await removeGoogleCalendar(db, currentAuth(c).user.id, syncedId(c)))) {
      throw new AppError(404);
    }
    return c.body(null, 204);
  })

  .delete("/sync", requireActiveSession(), async (c) => {
    const db = createDb(c.env.DB);
    const { user } = currentAuth(c);
    const result = await disconnectGoogle(db, await keyringFromEnv(c.env), user.id);
    if (!result) throw new AppError(404);
    await audit(db, c.get("meta"), "google.disconnected", {
      userId: user.id,
      metadata: { calendars: result.calendars, revoked: result.revoked },
    });
    return c.body(null, 204);
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

    if (saved.purpose === "sync") {
      const sync = (query: string) => c.redirect(`${IMPORT_PAGE}?${query}#sincronizar`, 302);
      try {
        const tokens = await exchangeCode(config, query.data.code, saved.verifier);
        // Sin token de actualización no hay sincronización continua posible.
        if (!tokens.refreshToken) return sync("google=offline-denied");
        const db = createDb(c.env.DB);
        await saveGoogleConnection(
          db,
          keyring,
          auth.user.id,
          { ...tokens, refreshToken: tokens.refreshToken },
          Date.now(),
        );
        await audit(db, c.get("meta"), "google.connected", { userId: auth.user.id });
        return sync("google=conectada");
      } catch (error) {
        logger.warn("google_oauth_exchange_failed", { error: safeErrorMessage(error) });
        return sync("google=error");
      }
    }

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
