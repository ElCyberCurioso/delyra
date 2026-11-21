import {
  appEnvironmentSchema,
  forgotPasswordRequestSchema,
  invitationTokenRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  secondFactorRequestSchema,
  totpConfirmRequestSchema,
} from "@delyra/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import {
  enforcePasswordPolicy,
  rejectPwned,
  requireTurnstile,
  tooManyAttempts,
} from "../lib/auth-guards";
import { AppError } from "../lib/errors";
import { keyringFromEnv } from "../lib/field-crypto";
import { readBody } from "../lib/http";
import { equalizeTiming, hashPassword, needsRehash, verifyPassword } from "../lib/password";
import {
  currentAuth,
  clearSessionCookie,
  requireSessionState,
  setSessionCookie,
} from "../middleware/session";
import { checkLock, recordAttempt } from "../services/attempts";
import { audit } from "../services/audit";
import { newLoginEmail, passwordResetEmail } from "../services/email-templates";
import {
  claimInvitation,
  findValidInvitation,
  linkInvitationUser,
  releaseInvitation,
} from "../services/invitations";
import { createMailer } from "../services/mailer";
import {
  consumePasswordReset,
  createPasswordReset,
  passwordResetLink,
} from "../services/password-resets";
import {
  confirmTotpEnrollment,
  remainingRecoveryCodes,
  startTotpEnrollment,
  verifySecondFactor,
} from "../services/second-factor";
import {
  createSession,
  registerSecondFactorFailure,
  revokeSession,
  revokeUserSessions,
  rotateSession,
} from "../services/sessions";
import {
  createUser,
  findUserByEmail,
  getUserSettings,
  hasConfirmedTotp,
  publicUser,
} from "../services/users";
import { calendarRepository } from "../repositories/calendars";
import type { AppEnv } from "../types";

/** Rutas de autenticación (F1-07, F1-08, F1-09, F1-11, F1-13). */

const GENERIC_LOGIN_ERROR = "Email o contraseña incorrectos";
const INVALID_INVITATION = "La invitación no es válida o ha caducado";

export const authRoutes = new Hono<AppEnv>()
  .get("/config", (c) => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null }))

  .get("/me", async (c) => {
    const auth = c.get("auth");
    if (!auth) throw new AppError(401);
    const { session, user } = auth;
    if (session.state !== "active") {
      return c.json({
        state: session.state,
        user: session.state === "pending_totp" ? publicUser(user) : null,
        settings: null,
      });
    }
    const settings = await getUserSettings(createDb(c.env.DB), user.id);
    return c.json({ state: "active", user: publicUser(user), settings });
  })

  .post("/invitation", async (c) => {
    const { token } = await readBody(c, invitationTokenRequestSchema);
    const invitation = await findValidInvitation(createDb(c.env.DB), token);
    if (!invitation) throw new AppError(404, { detail: INVALID_INVITATION });
    return c.json({
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
    });
  })

  .post("/register", async (c) => {
    const body = await readBody(c, registerRequestSchema);
    await requireTurnstile(c, body.turnstileToken);
    const db = createDb(c.env.DB);
    const meta = c.get("meta");

    const invitation = await findValidInvitation(db, body.token);
    if (!invitation) throw new AppError(400, { detail: INVALID_INVITATION });
    await enforcePasswordPolicy(c, body.password, invitation.email);

    // Se reserva la invitación antes de crear el usuario: dos registros simultáneos con el mismo
    // enlace no pueden prosperar los dos.
    if (!(await claimInvitation(db, invitation.id))) {
      throw new AppError(400, { detail: INVALID_INVITATION });
    }
    let user;
    try {
      user = await createUser(db, {
        email: invitation.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        role: invitation.role,
        // El enlace llegó a ese email (o lo entregó un administrador): queda verificado.
        emailVerified: true,
      });
    } catch (error) {
      await releaseInvitation(db, invitation.id);
      c.get("logger").warn("register_failed", { error });
      throw new AppError(400, { detail: INVALID_INVITATION });
    }
    // Calendarios Personal, Trabajo y Cumpleaños (F2-03).
    await calendarRepository(db, user.id).ensureDefaults();

    await linkInvitationUser(db, invitation.id, user.id);
    await audit(db, meta, "user.registered", {
      userId: user.id,
      actorId: invitation.createdBy,
      metadata: { role: user.role },
    });
    const { token } = await createSession(db, user.id, "pending_totp", meta);
    setSessionCookie(c, token, "pending_totp");
    return c.json({ next: "totp-setup" }, 201);
  })

  .post("/login", async (c) => {
    const body = await readBody(c, loginRequestSchema);
    const db = createDb(c.env.DB);
    const meta = c.get("meta");
    const keys = { account: body.email, ip: meta.ip };

    const lock = await checkLock(db, c.env, "login", keys);
    if (lock.locked) {
      const user = await findUserByEmail(db, body.email);
      if (user) await audit(db, meta, "login.locked", { userId: user.id });
      tooManyAttempts(c, lock.retryAfterSeconds);
    }
    await requireTurnstile(c, body.turnstileToken);

    const user = await findUserByEmail(db, body.email);
    if (!user) {
      await equalizeTiming(body.password);
      await recordAttempt(db, c.env, "login", keys, false);
      throw new AppError(401, { detail: GENERIC_LOGIN_ERROR });
    }
    const passwordOk = await verifyPassword(body.password, user.passwordHash);
    if (!passwordOk || user.status !== "active") {
      await recordAttempt(db, c.env, "login", keys, false);
      await audit(db, meta, "login.failure", { userId: user.id, metadata: { stage: "password" } });
      throw new AppError(401, { detail: GENERIC_LOGIN_ERROR });
    }
    await recordAttempt(db, c.env, "login", keys, true);
    if (needsRehash(user.passwordHash)) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(body.password), updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    const hasTotp = await hasConfirmedTotp(db, user.id);
    const state = hasTotp ? "pending_2fa" : "pending_totp";
    const { token } = await createSession(db, user.id, state, meta);
    setSessionCookie(c, token, state);
    return c.json({ next: hasTotp ? "2fa" : "totp-setup" });
  })

  .post("/login/second-factor", requireSessionState("pending_2fa"), async (c) => {
    const { code } = await readBody(c, secondFactorRequestSchema);
    const { session, user } = currentAuth(c);
    const db = createDb(c.env.DB);
    const meta = c.get("meta");
    const keys = { account: user.email, ip: meta.ip };

    const lock = await checkLock(db, c.env, "second_factor", keys);
    if (lock.locked) tooManyAttempts(c, lock.retryAfterSeconds);

    const keyring = await keyringFromEnv(c.env);
    const method = await verifySecondFactor(db, keyring, user.id, code);
    if (!method) {
      await recordAttempt(db, c.env, "second_factor", keys, false);
      await audit(db, meta, "second_factor.failure", { userId: user.id });
      const { revoked } = await registerSecondFactorFailure(db, session.id);
      if (revoked) clearSessionCookie(c);
      throw new AppError(401, {
        detail: revoked
          ? "Demasiados códigos incorrectos. Vuelve a iniciar sesión."
          : "El código no es válido",
      });
    }

    await recordAttempt(db, c.env, "second_factor", keys, true);
    const token = await rotateSession(db, session.id, "active");
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await audit(db, meta, "login.success", { userId: user.id, metadata: { method } });
    let remaining: number | undefined;
    if (method === "recovery_code") {
      remaining = await remainingRecoveryCodes(db, user.id);
      await audit(db, meta, "second_factor.recovery_code_used", {
        userId: user.id,
        metadata: { remaining },
      });
    }
    setSessionCookie(c, token, "active");

    const mailer = createMailer(c.env, c.get("logger"));
    if (c.env.APP_ENV === "production" && mailer.available) {
      const settings = await getUserSettings(db, user.id);
      const locale = settings?.locale === "en" ? "en" : "es";
      c.executionCtx.waitUntil(
        mailer
          .send(newLoginEmail(user.email, { at: new Date(), ...meta }, locale))
          .catch(() => undefined),
      );
    }
    return c.json({ next: "done", remainingRecoveryCodes: remaining ?? null });
  })

  .post("/totp/setup", requireSessionState("pending_totp"), async (c) => {
    const { user } = currentAuth(c);
    const keyring = await keyringFromEnv(c.env);
    const enrollment = await startTotpEnrollment(createDb(c.env.DB), keyring, user);
    c.header("Cache-Control", "no-store");
    return c.json(enrollment);
  })

  .post("/totp/confirm", requireSessionState("pending_totp"), async (c) => {
    const { code } = await readBody(c, totpConfirmRequestSchema);
    const { session, user } = currentAuth(c);
    const db = createDb(c.env.DB);
    const meta = c.get("meta");
    const keyring = await keyringFromEnv(c.env);
    const codes = await confirmTotpEnrollment(db, keyring, user.id, code);
    if (!codes) {
      const { revoked } = await registerSecondFactorFailure(db, session.id);
      if (revoked) clearSessionCookie(c);
      throw new AppError(400, { detail: "El código no es válido. Revisa la hora del móvil." });
    }
    const token = await rotateSession(db, session.id, "active");
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await audit(db, meta, "totp.enrolled", { userId: user.id });
    await audit(db, meta, "login.success", { userId: user.id, metadata: { method: "totp" } });
    setSessionCookie(c, token, "active");
    c.header("Cache-Control", "no-store");
    return c.json({ recoveryCodes: codes });
  })

  .post("/logout", async (c) => {
    const auth = c.get("auth");
    if (auth) {
      const db = createDb(c.env.DB);
      await revokeSession(db, auth.session.id, "logout");
      await audit(db, c.get("meta"), "session.logout", { userId: auth.user.id });
    }
    clearSessionCookie(c);
    return c.body(null, 204);
  })

  .post("/password/forgot", async (c) => {
    const body = await readBody(c, forgotPasswordRequestSchema);
    const db = createDb(c.env.DB);
    const meta = c.get("meta");
    const keys = { account: body.email, ip: meta.ip };
    await requireTurnstile(c, body.turnstileToken);

    // Siempre la misma respuesta, exista o no la cuenta (sin enumeración).
    const lock = await checkLock(db, c.env, "password_reset", keys);
    if (!lock.locked) {
      await recordAttempt(db, c.env, "password_reset", keys, false);
      const user = await findUserByEmail(db, body.email);
      if (user?.status === "active") {
        const token = await createPasswordReset(db, user.id);
        const environment = appEnvironmentSchema.parse(c.env.APP_ENV);
        const settings = await getUserSettings(db, user.id);
        const mailer = createMailer(c.env, c.get("logger"));
        await audit(db, meta, "password.reset_requested", { userId: user.id });
        if (mailer.available) {
          await mailer.send(
            passwordResetEmail(
              user.email,
              passwordResetLink(environment, token),
              settings?.locale === "en" ? "en" : "es",
            ),
          );
        } else {
          c.get("logger").warn("password_reset_email_unavailable");
        }
      }
    }
    return c.json({ ok: true }, 202);
  })

  .post("/password/reset", async (c) => {
    const body = await readBody(c, resetPasswordRequestSchema);
    await rejectPwned(c, body.password);
    const db = createDb(c.env.DB);
    const userId = await consumePasswordReset(db, body.token);
    if (!userId) throw new AppError(400, { detail: "El enlace no es válido o ha caducado" });
    const now = new Date();
    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(body.password),
        passwordChangedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
    await revokeUserSessions(db, userId, "password_reset");
    await audit(db, c.get("meta"), "password.reset", { userId });
    clearSessionCookie(c);
    return c.body(null, 204);
  });
