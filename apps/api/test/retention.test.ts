import { newId } from "@delyra/shared";
import { env } from "cloudflare:workers";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import {
  auditLog,
  authAttempts,
  boardInvitations,
  invitations,
  passwordResets,
  sessions,
} from "../src/db/schema";
import { purgeExpiredData } from "../src/services/retention";
import { registerUser } from "./helpers";

/** Plazos de conservación (política de privacidad): el cron diario borra lo caducado. */

const DAY = 86_400_000;

describe("conservación de datos técnicos", () => {
  it("borra lo que ha pasado su plazo y conserva lo reciente y lo que sigue en uso", async () => {
    const { client } = await registerUser();
    const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    const userId = me.user.id;
    const created = await client.post("/api/boards", { name: "Tablero", template: "empty" });
    const { board } = await created.json<{ board: { id: string } }>();
    const db = createDb(env.DB);
    const now = Date.now();
    const at = (days: number) => new Date(now - days * DAY);
    const ids = Object.fromEntries(
      [
        "sessionOld",
        "sessionRevoked",
        "sessionRecent",
        "attemptOld",
        "attemptRecent",
        "resetOld",
        "resetRecent",
        "inviteExpired",
        "inviteRevoked",
        "inviteAccepted",
        "invitePending",
        "boardInviteOld",
        "boardInviteRecent",
        "auditOld",
        "auditRecent",
      ].map((key) => [key, newId()]),
    );

    const session = (id: string, expiresDaysAgo: number, revokedDaysAgo: number | null) => ({
      id,
      userId,
      tokenHash: `hash-${id}`,
      state: "active" as const,
      createdAt: at(60),
      lastSeenAt: at(40),
      expiresAt: at(expiresDaysAgo),
      revokedAt: revokedDaysAgo === null ? null : at(revokedDaysAgo),
    });
    await db
      .insert(sessions)
      .values([
        session(ids.sessionOld ?? "", 31, null),
        session(ids.sessionRevoked ?? "", -20, 31),
        session(ids.sessionRecent ?? "", 10, null),
      ]);
    const attempt = (id: string, daysAgo: number) => ({
      id,
      kind: "login" as const,
      scope: "ip" as const,
      keyHash: `k-${id}`,
      success: false,
      createdAt: at(daysAgo),
    });
    await db
      .insert(authAttempts)
      .values([attempt(ids.attemptOld ?? "", 31), attempt(ids.attemptRecent ?? "", 1)]);
    const reset = (id: string, daysAgo: number) => ({
      id,
      userId,
      tokenHash: `r-${id}`,
      createdAt: at(daysAgo + 1),
      expiresAt: at(daysAgo),
    });
    await db
      .insert(passwordResets)
      .values([reset(ids.resetOld ?? "", 31), reset(ids.resetRecent ?? "", 2)]);
    const invite = (
      id: string,
      expiresDaysAgo: number,
      extra: { acceptedAt?: Date; revokedAt?: Date } = {},
    ) => ({
      id,
      email: `${id}@example.com`,
      role: "member" as const,
      tokenHash: `i-${id}`,
      createdAt: at(90),
      expiresAt: at(expiresDaysAgo),
      ...extra,
    });
    await db
      .insert(invitations)
      .values([
        invite(ids.inviteExpired ?? "", 31),
        invite(ids.inviteRevoked ?? "", -5, { revokedAt: at(31) }),
        invite(ids.inviteAccepted ?? "", 60, { acceptedAt: at(80) }),
        invite(ids.invitePending ?? "", -3),
      ]);
    const boardInvite = (id: string, expiresDaysAgo: number) => ({
      id,
      boardId: board.id,
      email: `${id}@example.com`,
      role: "editor" as const,
      createdAt: at(expiresDaysAgo + 7),
      expiresAt: at(expiresDaysAgo),
    });
    await db
      .insert(boardInvitations)
      .values([
        boardInvite(ids.boardInviteOld ?? "", 31),
        boardInvite(ids.boardInviteRecent ?? "", 3),
      ]);
    const audit = (id: string, daysAgo: number) => ({
      id,
      userId,
      event: "login.success",
      createdAt: at(daysAgo),
    });
    await db
      .insert(auditLog)
      .values([audit(ids.auditOld ?? "", 366), audit(ids.auditRecent ?? "", 300)]);

    const counts = await purgeExpiredData(db, now);
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
      expect(counts[key]).toBeGreaterThanOrEqual(1);
    }

    const left = async <T extends { id: string }>(rows: Promise<T[]>) =>
      new Set((await rows).map((r) => r.id));
    const all = Object.values(ids);
    const present = new Set([
      ...(await left(
        db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.id, all)),
      )),
      ...(await left(
        db.select({ id: authAttempts.id }).from(authAttempts).where(inArray(authAttempts.id, all)),
      )),
      ...(await left(
        db
          .select({ id: passwordResets.id })
          .from(passwordResets)
          .where(inArray(passwordResets.id, all)),
      )),
      ...(await left(
        db.select({ id: invitations.id }).from(invitations).where(inArray(invitations.id, all)),
      )),
      ...(await left(
        db
          .select({ id: boardInvitations.id })
          .from(boardInvitations)
          .where(inArray(boardInvitations.id, all)),
      )),
      ...(await left(
        db.select({ id: auditLog.id }).from(auditLog).where(inArray(auditLog.id, all)),
      )),
    ]);
    const kept = Object.entries(ids)
      .filter(([, id]) => present.has(id))
      .map(([key]) => key)
      .sort();
    expect(kept).toEqual(
      [
        "sessionRecent",
        "attemptRecent",
        "resetRecent",
        "inviteAccepted",
        "invitePending",
        "boardInviteRecent",
        "auditRecent",
      ].sort(),
    );

    // La sesión de la persona sigue funcionando.
    expect((await client.get("/api/auth/me")).status).toBe(200);
  });
});
