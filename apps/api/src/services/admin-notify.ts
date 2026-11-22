import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { users } from "../db/schema";
import type { EmailMessage, Mailer } from "./mailer";

/**
 * Avisos a los administradores (F6-06). Si Email Service no está configurado no se envía nada
 * (el fallo ya queda en los logs y en el panel de admin). Nunca hace fallar a quien llama.
 */
export async function notifyAdmins(
  db: Database,
  mailer: Mailer,
  build: (to: string) => EmailMessage,
): Promise<number> {
  if (!mailer.available) return 0;
  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  let sent = 0;
  for (const admin of admins) {
    try {
      await mailer.send(build(admin.email));
      sent++;
    } catch {
      // Ya registrado por el mailer; se sigue con el resto.
    }
  }
  return sent;
}
