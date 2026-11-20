import { idSchema } from "@delyra/shared";
import { Hono } from "hono";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { audit, listUserAudit } from "../services/audit";
import { listActiveSessions, revokeSession, revokeUserSessions } from "../services/sessions";
import type { AppEnv } from "../types";

/** Cuenta del usuario: sesiones activas e historial de seguridad (F1-15, F1-16). */
export const accountRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

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
