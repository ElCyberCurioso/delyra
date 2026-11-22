import { idSchema } from "@delyra/shared";
import { Hono } from "hono";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { audit } from "../services/audit";
import { answerInvitation, pendingInvitations } from "../services/board-access";
import { notifyBoard } from "../services/board-live";
import type { AppEnv } from "../types";

/** Invitaciones a tableros que ha recibido quien pide (por su email), F7-04. */
export const boardInvitationRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .get("/", async (c) => {
    const { user } = currentAuth(c);
    return c.json({ invitations: await pendingInvitations(createDb(c.env.DB), user.email) });
  })

  .post("/:id/:answer", async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    const answer = c.req.param("answer");
    if (!id.success || (answer !== "accept" && answer !== "decline")) throw new AppError(404);
    const db = createDb(c.env.DB);
    const { user } = currentAuth(c);
    const boardId = await answerInvitation(db, user, id.data, answer === "accept");
    if (boardId) {
      await audit(db, c.get("meta"), "board.invitation_accepted", {
        userId: user.id,
        metadata: { boardId },
      });
      c.executionCtx.waitUntil(notifyBoard(c.env, boardId, user.id, c.get("logger")));
      return c.json({ boardId });
    }
    return c.body(null, 204);
  });
