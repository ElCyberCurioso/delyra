import {
  changePasswordRequestSchema,
  idSchema,
  PROBLEM_TYPES,
  reauthRequestSchema,
  totpConfirmRequestSchema,
  updateProfileRequestSchema,
  updateSettingsRequestSchema,
} from "@delyra/shared";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import { enforcePasswordPolicy, tooManyAttempts } from "../lib/auth-guards";
import { AppError } from "../lib/errors";
import { keyringFromEnv } from "../lib/field-crypto";
import { readBody } from "../lib/http";
import { hashPassword, verifyPassword } from "../lib/password";
import { currentAuth, requireActiveSession, setSessionCookie } from "../middleware/session";
import { checkLock, recordAttempt } from "../services/attempts";
import { audit, listUserAudit } from "../services/audit";
import {
  confirmTotpReconfiguration,
  regenerateRecoveryCodes,
  remainingRecoveryCodes,
  startTotpReconfiguration,
  totpConfirmedAt,
  verifySecondFactor,
} from "../services/second-factor";
import {
  listActiveSessions,
  revokeSession,
  revokeUserSessions,
  rotateSession,
} from "../services/sessions";
import { getUserSettings, publicUser, updateUserName, updateUserSettings } from "../services/users";
import type { AppEnv } from "../types";

/**
 * Cuenta del usuario (F1-15, F1-16): perfil, preferencias, seguridad, sesiones e historial.
 * Las acciones sensibles piden de nuevo la contraseña (y el código actual cuando tocan el 2FA),
 * con su propio contador de intentos.
 */

const REAUTH_FAILED = "La contraseña o el código no son correctos";

function attemptKeys(c: Context<AppEnv>) {
  return { account: `user:${currentAuth(c).user.id}`, ip: c.get("meta").ip };
}

/** Confirma que quien usa la sesión conoce la contraseña (y, si se pide, el segundo factor). */
async function reauthenticate(
  c: Context<AppEnv>,
  input: { password: string; code?: string },
): Promise<void> {
  const { user } = currentAuth(c);
  const db = createDb(c.env.DB);
  const keys = attemptKeys(c);
  const lock = await checkLock(db, c.env, "reauth", keys);
  if (lock.locked) tooManyAttempts(c, lock.retryAfterSeconds);

  let ok = await verifyPassword(input.password, user.passwordHash);
  // Con la contraseña mal no se mira el código: así no se gasta un código de recuperación.
  if (ok && input.code !== undefined) {
    ok = (await verifySecondFactor(db, await keyringFromEnv(c.env), user.id, input.code)) !== null;
  }
  await recordAttempt(db, c.env, "reauth", keys, ok);
  if (!ok) {
    await audit(db, c.get("meta"), "reauth.failure", { userId: user.id });
    throw new AppError(400, { detail: REAUTH_FAILED });
  }
}

export const accountRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .patch("/profile", async (c) => {
    const { name } = await readBody(c, updateProfileRequestSchema);
    const { user } = currentAuth(c);
    const db = createDb(c.env.DB);
    await updateUserName(db, user.id, name);
    await audit(db, c.get("meta"), "profile.updated", { userId: user.id });
    return c.json({ user: publicUser({ ...user, name }) });
  })

  .patch("/settings", async (c) => {
    const settings = await readBody(c, updateSettingsRequestSchema);
    const { user } = currentAuth(c);
    const db = createDb(c.env.DB);
    await updateUserSettings(db, user.id, settings);
    await audit(db, c.get("meta"), "settings.updated", { userId: user.id });
    return c.json({ settings: await getUserSettings(db, user.id) });
  })

  .get("/security", async (c) => {
    const { user } = currentAuth(c);
    const db = createDb(c.env.DB);
    const [confirmedAt, remaining] = await Promise.all([
      totpConfirmedAt(db, user.id),
      remainingRecoveryCodes(db, user.id),
    ]);
    return c.json({
      totpConfirmedAt: confirmedAt?.toISOString() ?? null,
      remainingRecoveryCodes: remaining,
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
    });
  })

  .post("/password", async (c) => {
    const body = await readBody(c, changePasswordRequestSchema);
    await reauthenticate(c, { password: body.currentPassword });
    const { session, user } = currentAuth(c);
    if (await verifyPassword(body.newPassword, user.passwordHash)) {
      throw new AppError(422, {
        type: PROBLEM_TYPES.validation,
        errors: [{ path: "newPassword", message: "Debe ser distinta de la actual" }],
      });
    }
    await enforcePasswordPolicy(c, body.newPassword, user.email, "newPassword");

    const db = createDb(c.env.DB);
    const now = new Date();
    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(body.newPassword),
        passwordChangedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));
    // Las demás sesiones se cierran; esta sigue, pero con un token nuevo.
    const revokedSessions = await revokeUserSessions(db, user.id, "password_changed", session.id);
    setSessionCookie(c, await rotateSession(db, session.id, "active"), "active");
    await audit(db, c.get("meta"), "password.changed", {
      userId: user.id,
      metadata: { revokedSessions },
    });
    return c.json({ revokedSessions });
  })

  .post("/recovery-codes", async (c) => {
    const body = await readBody(c, reauthRequestSchema);
    await reauthenticate(c, body);
    const { user } = currentAuth(c);
    const db = createDb(c.env.DB);
    const codes = await regenerateRecoveryCodes(db, user.id);
    await audit(db, c.get("meta"), "recovery_codes.regenerated", { userId: user.id });
    c.header("Cache-Control", "no-store");
    return c.json({ recoveryCodes: codes });
  })

  .post("/totp/reconfigure", async (c) => {
    const body = await readBody(c, reauthRequestSchema);
    await reauthenticate(c, body);
    const { user } = currentAuth(c);
    const enrollment = await startTotpReconfiguration(
      createDb(c.env.DB),
      await keyringFromEnv(c.env),
      user,
    );
    if (!enrollment) throw new AppError(409, { detail: "La cuenta no tiene TOTP activo" });
    c.header("Cache-Control", "no-store");
    return c.json(enrollment);
  })

  .post("/totp/reconfigure/confirm", async (c) => {
    const { code } = await readBody(c, totpConfirmRequestSchema);
    const { session, user } = currentAuth(c);
    const db = createDb(c.env.DB);
    const keys = attemptKeys(c);
    const lock = await checkLock(db, c.env, "reauth", keys);
    if (lock.locked) tooManyAttempts(c, lock.retryAfterSeconds);

    const ok = await confirmTotpReconfiguration(db, await keyringFromEnv(c.env), user.id, code);
    await recordAttempt(db, c.env, "reauth", keys, ok);
    if (!ok) {
      throw new AppError(400, {
        detail: "El código no es correcto o han pasado más de 10 minutos. Vuelve a empezar.",
      });
    }
    // Con el segundo factor cambiado, el resto de sesiones dejan de valer.
    const revokedSessions = await revokeUserSessions(db, user.id, "totp_changed", session.id);
    await audit(db, c.get("meta"), "totp.reconfigured", {
      userId: user.id,
      metadata: { revokedSessions },
    });
    return c.json({ revokedSessions });
  })

  .get("/sessions", async (c) => {
    const { session, user } = currentAuth(c);
    const rows = await listActiveSessions(createDb(c.env.DB), user.id);
    return c.json({
      sessions: rows.map((row) => ({ ...row, current: row.id === session.id })),
    });
  })

  .delete("/sessions/:id", async (c) => {
    const { user } = currentAuth(c);
    const id = idSchema.safeParse(c.req.param("id"));
    if (!id.success) throw new AppError(404);
    const db = createDb(c.env.DB);
    const owned = (await listActiveSessions(db, user.id)).some((s) => s.id === id.data);
    // Una sesión de otro usuario responde igual que una inexistente (§3.5).
    if (!owned) throw new AppError(404);
    await revokeSession(db, id.data, "revoked_by_user");
    await audit(db, c.get("meta"), "session.revoked", { userId: user.id });
    return c.body(null, 204);
  })

  .post("/sessions/revoke-others", async (c) => {
    const { session, user } = currentAuth(c);
    const db = createDb(c.env.DB);
    const count = await revokeUserSessions(db, user.id, "revoked_by_user", session.id);
    await audit(db, c.get("meta"), "session.revoked", { userId: user.id, metadata: { count } });
    return c.json({ revoked: count });
  })

  .get("/audit", async (c) => {
    const { user } = currentAuth(c);
    return c.json({ events: await listUserAudit(createDb(c.env.DB), user.id) });
  });
