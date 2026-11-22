import {
  appEnvironmentSchema,
  createInvitationRequestSchema,
  idSchema,
  newId,
} from "@delyra/shared";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import { AppError } from "../lib/errors";
import { readBody } from "../lib/http";
import { currentAuth, requireAdmin } from "../middleware/session";
import { audit } from "../services/audit";
import { invitationEmail } from "../services/email-templates";
import {
  createInvitation,
  invitationLink,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "../services/invitations";
import { createMailer } from "../services/mailer";
import { resetSecondFactor } from "../services/second-factor";
import { revokeUserSessions } from "../services/sessions";
import { listBackupRuns, listSystemBackupObjects } from "../services/system-backups";
import { findUserByEmail, findUserById, listUsers } from "../services/users";
import type { AppEnv } from "../types";

/** Administración mínima (F1-06, F1-17). Todo responde 404 a quien no es administrador. */

function idParam(c: Context<AppEnv>): string {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(404);
  return id.data;
}

/** Envía la invitación por correo si se puede; el enlace se devuelve siempre al administrador. */
async function deliverInvitation(
  c: Context<AppEnv>,
  email: string,
  token: string,
  expiresAt: Date,
) {
  const link = invitationLink(appEnvironmentSchema.parse(c.env.APP_ENV), token);
  const mailer = createMailer(c.env, c.get("logger"));
  let emailed = false;
  if (mailer.available) {
    try {
      await mailer.send(invitationEmail(email, link, expiresAt));
      emailed = true;
    } catch {
      emailed = false;
    }
  }
  return { link, emailed };
}

export const adminRoutes = new Hono<AppEnv>()
  .use("*", requireAdmin())

  .get("/invitations", async (c) =>
    c.json({ invitations: await listInvitations(createDb(c.env.DB)) }),
  )

  .post("/invitations", async (c) => {
    const body = await readBody(c, createInvitationRequestSchema);
    const { user } = currentAuth(c);
    const db = createDb(c.env.DB);
    if (await findUserByEmail(db, body.email)) {
      throw new AppError(409, { detail: "Ya existe una cuenta con ese email" });
    }
    const { invitation, token } = await createInvitation(db, {
      email: body.email,
      role: body.role,
      createdBy: user.id,
      expiresInDays: body.expiresInDays,
    });
    await audit(db, c.get("meta"), "invitation.created", {
      actorId: user.id,
      metadata: { invitationId: invitation.id, role: invitation.role },
    });
    const delivery = await deliverInvitation(c, invitation.email, token, invitation.expiresAt);
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
        ...delivery,
      },
      201,
    );
  })

  .post("/invitations/:id/resend", async (c) => {
    const { user } = currentAuth(c);
    const db = createDb(c.env.DB);
    const result = await resendInvitation(db, idParam(c), 7);
    if (!result) throw new AppError(404);
    await audit(db, c.get("meta"), "invitation.resent", {
      actorId: user.id,
      metadata: { invitationId: result.invitation.id },
    });
    const delivery = await deliverInvitation(
      c,
      result.invitation.email,
      result.token,
      result.invitation.expiresAt,
    );
    c.header("Cache-Control", "no-store");
    return c.json({ expiresAt: result.invitation.expiresAt.toISOString(), ...delivery });
  })

  .delete("/invitations/:id", async (c) => {
    const { user } = currentAuth(c);
    const db = createDb(c.env.DB);
    const id = idParam(c);
    if (!(await revokeInvitation(db, id))) throw new AppError(404);
    await audit(db, c.get("meta"), "invitation.revoked", {
      actorId: user.id,
      metadata: { invitationId: id },
    });
    return c.body(null, 204);
  })

  .get("/users", async (c) => c.json({ users: await listUsers(createDb(c.env.DB)) }))

  // ── Backups del sistema (F6-06) ────────────────────────────────────────────

  .get("/backups", async (c) => {
    const runs = await listBackupRuns(createDb(c.env.DB), 30);
    return c.json({
      runs: runs.map((run) => ({
        id: run.id,
        trigger: run.trigger,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        r2Key: run.r2Key,
        sizeBytes: run.sizeBytes,
        error: run.error,
      })),
      objects: await listSystemBackupObjects(c.env.BACKUPS),
    });
  })

  .post("/backups", async (c) => {
    const db = createDb(c.env.DB);
    const admin = currentAuth(c).user;
    const running = (await listBackupRuns(db, 5)).find(
      (run) => run.status === "running" && run.startedAt.getTime() > Date.now() - 30 * 60_000,
    );
    if (running) throw new AppError(409, { detail: "Ya hay un backup en marcha" });
    const instance = await c.env.SYSTEM_BACKUP.create({ id: `manual-${newId()}` });
    await audit(db, c.get("meta"), "admin.system_backup", { actorId: admin.id });
    return c.json({ id: instance.id }, 202);
  })

  .post("/users/:id/disable", async (c) => {
    const { user: admin } = currentAuth(c);
    const id = idParam(c);
    if (id === admin.id)
      throw new AppError(409, { detail: "No puedes desactivar tu propia cuenta" });
    const db = createDb(c.env.DB);
    if (!(await findUserById(db, id))) throw new AppError(404);
    await db
      .update(users)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(users.id, id));
    await revokeUserSessions(db, id, "user_disabled");
    await audit(db, c.get("meta"), "admin.user_disabled", { userId: id, actorId: admin.id });
    return c.body(null, 204);
  })

  .post("/users/:id/enable", async (c) => {
    const { user: admin } = currentAuth(c);
    const id = idParam(c);
    const db = createDb(c.env.DB);
    if (!(await findUserById(db, id))) throw new AppError(404);
    await db.update(users).set({ status: "active", updatedAt: new Date() }).where(eq(users.id, id));
    await audit(db, c.get("meta"), "admin.user_enabled", { userId: id, actorId: admin.id });
    return c.body(null, 204);
  })

  .post("/users/:id/reset-2fa", async (c) => {
    const { user: admin } = currentAuth(c);
    const id = idParam(c);
    if (id === admin.id) {
      throw new AppError(409, { detail: "Tu propio 2FA se cambia en Ajustes → Seguridad" });
    }
    const db = createDb(c.env.DB);
    if (!(await findUserById(db, id))) throw new AppError(404);
    await resetSecondFactor(db, id);
    await revokeUserSessions(db, id, "totp_reset");
    await audit(db, c.get("meta"), "admin.totp_reset", { userId: id, actorId: admin.id });
    return c.body(null, 204);
  });
