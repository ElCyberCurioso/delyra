import { newId } from "@delyra/shared";
import { desc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { auditLog } from "../db/schema";
import type { RequestMeta } from "../lib/request-meta";

/** Eventos de seguridad registrados (F1-16). `metadata` nunca lleva secretos ni contenido. */
export type AuditEvent =
  | "user.registered"
  | "login.success"
  | "login.failure"
  | "login.locked"
  | "second_factor.success"
  | "second_factor.failure"
  | "second_factor.recovery_code_used"
  | "totp.enrolled"
  | "recovery_codes.regenerated"
  | "password.reset_requested"
  | "password.reset"
  | "session.logout"
  | "session.revoked"
  | "invitation.created"
  | "invitation.resent"
  | "invitation.revoked"
  | "admin.user_disabled"
  | "admin.user_enabled"
  | "admin.totp_reset";

export async function audit(
  db: Database,
  meta: RequestMeta | null,
  event: AuditEvent,
  details: {
    userId?: string | null;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    userId: details.userId ?? null,
    actorId: details.actorId ?? null,
    event,
    country: meta?.country ?? null,
    userAgent: meta?.userAgent ?? null,
    metadata: details.metadata ?? null,
    createdAt: new Date(),
  });
}

export async function listUserAudit(db: Database, userId: string, limit = 50) {
  return db
    .select({
      id: auditLog.id,
      event: auditLog.event,
      country: auditLog.country,
      userAgent: auditLog.userAgent,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.userId, userId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
