import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createDb } from "../db/client";
import type { SessionState } from "../db/schema";
import { AppError } from "../lib/errors";
import { requestMeta } from "../lib/request-meta";
import { resolveSession, SESSION_TTL, touchSession } from "../services/sessions";
import type { AppEnv } from "../types";

/**
 * Cookie de sesión común a las dos apps (F1-04, F1-13): `__Secure-sid`, HttpOnly, Secure,
 * SameSite=Lax y, en producción, `Domain=delyra.app` para que valga en `work.delyra.app`.
 */
const SESSION_COOKIE = "__Secure-sid";

function cookieDomain(c: Context<AppEnv>): string | undefined {
  return c.env.SESSION_COOKIE_DOMAIN || undefined;
}

export function setSessionCookie(c: Context<AppEnv>, token: string, state: SessionState) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    domain: cookieDomain(c),
    maxAge: Math.floor(
      (state === "active" ? SESSION_TTL.activeAbsolute : SESSION_TTL.pending) / 1000,
    ),
  });
}

export function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, domain: cookieDomain(c) });
}

/** Resuelve la sesión de la cookie (si la hay) y la deja en `c.var.auth`. */
export function loadSession(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("meta", requestMeta(c));
    c.set("auth", null);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const db = createDb(c.env.DB);
      const resolved = await resolveSession(db, token);
      if (resolved) {
        c.set("auth", resolved);
        if (resolved.session.state === "active") {
          c.executionCtx.waitUntil(touchSession(db, resolved.session));
        }
      } else {
        clearSessionCookie(c);
      }
    }
    await next();
  };
}

/** Exige una sesión completa (contraseña + segundo factor). */
export function requireActiveSession(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (auth?.session.state !== "active") throw new AppError(401);
    await next();
  };
}

/** Exige una sesión en un estado intermedio concreto (p. ej. pendiente de 2FA). */
export function requireSessionState(...states: SessionState[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth || !states.includes(auth.session.state)) throw new AppError(401);
    await next();
  };
}

/** Rutas de administración: a quien no es admin se le responde 404, como si no existieran. */
export function requireAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (auth?.session.state !== "active") throw new AppError(401);
    if (auth.user.role !== "admin") throw new AppError(404);
    await next();
  };
}

/** Sesión garantizada por el middleware anterior (en el estado que este exija). */
export function currentAuth(c: Context<AppEnv>) {
  const auth = c.get("auth");
  if (!auth) throw new AppError(401);
  return auth;
}
