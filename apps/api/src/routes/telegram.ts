import { newId, updateTelegramRequestSchema } from "@delyra/shared";
import { Hono } from "hono";
import { createDb } from "../db/client";
import type { TelegramLink } from "../db/schema";
import { telegramUpdates } from "../db/schema";
import { constantTimeEqual } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { readBody } from "../lib/http";
import { telegramClient } from "../lib/telegram";
import { currentAuth, requireActiveSession } from "../middleware/session";
import { audit } from "../services/audit";
import type { NotificationMessage } from "../services/notifications";
import { handleUpdate, telegramUpdateSchema } from "../services/telegram-bot";
import {
  createLinkToken,
  getLink,
  telegramConfig,
  unlinkUser,
  updateLink,
} from "../services/telegram-links";
import type { AppEnv } from "../types";

/**
 * Webhook de Telegram (F3-03). Sin sesión ni CSRF (lo llama Telegram, no un navegador): se
 * autentica con el secreto de `setWebhook`, comparado en tiempo constante. Responde 200 aunque
 * algo falle al procesar, para que Telegram no reintente sin fin; los duplicados se descartan
 * por `update_id`.
 */
export const telegramWebhookRoutes = new Hono<AppEnv>().post("/webhook", async (c) => {
  const config = telegramConfig(c.env);
  if (!config) throw new AppError(404);
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!constantTimeEqual(secret, config.webhookSecret)) throw new AppError(401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: true });
  }
  const update = telegramUpdateSchema.safeParse(body);
  if (!update.success) return c.json({ ok: true });

  const db = createDb(c.env.DB);
  const now = Date.now();
  const fresh = await db
    .insert(telegramUpdates)
    .values({ updateId: update.data.update_id, receivedAt: now })
    .onConflictDoNothing()
    .returning({ updateId: telegramUpdates.updateId });
  if (fresh.length === 0) return c.json({ ok: true });

  try {
    await handleUpdate(
      {
        db,
        env: c.env,
        telegram: telegramClient(config.token),
        logger: c.get("logger"),
        meta: c.get("meta"),
        now,
      },
      update.data,
    );
  } catch (error) {
    c.get("logger").error("telegram_update_failed", { error });
  }
  return c.json({ ok: true });
});

function status(env: Env, link: TelegramLink | null) {
  const config = telegramConfig(env);
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  return {
    available: config !== null,
    botUsername: config?.username ?? null,
    linked: link !== null,
    linkedAt: link ? link.linkedAt.toISOString() : null,
    mutedUntil: link?.mutedUntil && link.mutedUntil > Date.now() ? iso(link.mutedUntil) : null,
    digestTime: link?.digestTime ?? null,
    quietStart: link?.quietStart ?? null,
    quietEnd: link?.quietEnd ?? null,
  };
}

/** Telegram en Ajustes (F3-04, F3-09): `/api/me/telegram`. */
export const telegramSettingsRoutes = new Hono<AppEnv>()
  .use("*", requireActiveSession())

  .get("/", async (c) => {
    const { user } = currentAuth(c);
    return c.json(status(c.env, await getLink(createDb(c.env.DB), user.id)));
  })

  .post("/link", async (c) => {
    const config = telegramConfig(c.env);
    if (!config) throw new AppError(409, { detail: "Telegram aún no está configurado" });
    const { user } = currentAuth(c);
    const link = await createLinkToken(createDb(c.env.DB), config, user.id);
    c.header("Cache-Control", "no-store");
    return c.json({ url: link.url, expiresAt: link.expiresAt.toISOString() });
  })

  .patch("/", async (c) => {
    const body = await readBody(c, updateTelegramRequestSchema);
    const { user } = currentAuth(c);
    const db = createDb(c.env.DB);
    const link = await updateLink(db, user.id, {
      ...(body.digestTime !== undefined ? { digestTime: body.digestTime } : {}),
      ...(body.quietStart !== undefined ? { quietStart: body.quietStart } : {}),
      ...(body.quietEnd !== undefined ? { quietEnd: body.quietEnd } : {}),
      ...(body.muted === false ? { mutedUntil: null } : {}),
    });
    if (!link) throw new AppError(409, { detail: "Primero vincula tu cuenta de Telegram" });
    return c.json(status(c.env, link));
  })

  .delete("/", async (c) => {
    const { user } = currentAuth(c);
    const db = createDb(c.env.DB);
    if (await unlinkUser(db, user.id)) {
      await audit(db, c.get("meta"), "telegram.unlinked", { userId: user.id });
    }
    return c.body(null, 204);
  })

  .post("/test", async (c) => {
    const { user } = currentAuth(c);
    if (!(await getLink(createDb(c.env.DB), user.id))) {
      throw new AppError(409, { detail: "Primero vincula tu cuenta de Telegram" });
    }
    const message: NotificationMessage = {
      type: "test",
      idempotencyKey: `test:${newId()}`,
      ownerId: user.id,
    };
    await c.env.NOTIFICATIONS.send(message);
    return c.body(null, 202);
  });
