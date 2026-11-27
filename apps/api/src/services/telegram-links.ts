import { newId } from "@delyra/shared";
import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import type { Database } from "../db/client";
import { type TelegramLink, telegramLinks, telegramLinkTokens } from "../db/schema";
import { randomToken, sha256Hex } from "../lib/crypto";
import { decryptField, encryptField, keyringFromEnv } from "../lib/field-crypto";
import { pseudonym } from "../lib/pseudonym";

/** Vinculación de cuentas con Telegram (F3-04). */

const LINK_TOKEN_TTL_MS = 10 * 60_000;

type TelegramEnv = Pick<
  Env,
  | "APP_ENV"
  | "LOG_PSEUDONYM_KEY"
  | "FIELD_ENCRYPTION_KEY_V1"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_WEBHOOK_SECRET"
  | "TELEGRAM_BOT_USERNAME"
>;

export interface TelegramConfig {
  token: string;
  username: string;
  webhookSecret: string;
}

/** Telegram solo está activo con el bot creado (P-10): token, secreto del webhook y nombre. */
export function telegramConfig(env: TelegramEnv): TelegramConfig | null {
  const username = String(env.TELEGRAM_BOT_USERNAME).replace(/^@/, "");
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !username) return null;
  return { token: env.TELEGRAM_BOT_TOKEN, username, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET };
}

const chatHash = (env: TelegramEnv, chatId: string) => pseudonym(env, "telegram:chat", chatId);

/** Enlace `t.me/<bot>?start=<token>` de un solo uso. Invalida los anteriores del usuario. */
export async function createLinkToken(
  db: Database,
  config: TelegramConfig,
  userId: string,
  now = Date.now(),
) {
  const token = randomToken();
  const expiresAt = new Date(now + LINK_TOKEN_TTL_MS);
  await db.batch([
    db
      .update(telegramLinkTokens)
      .set({ usedAt: new Date(now) })
      .where(and(eq(telegramLinkTokens.userId, userId), isNull(telegramLinkTokens.usedAt))),
    db.insert(telegramLinkTokens).values({
      id: newId(),
      userId,
      tokenHash: await sha256Hex(token),
      expiresAt,
      createdAt: new Date(now),
    }),
  ]);
  return { url: `https://t.me/${config.username}?start=${token}`, expiresAt };
}

/** Marca el token como usado (solo una vez y antes de caducar) y devuelve su usuario. */
export async function consumeLinkToken(
  db: Database,
  token: string,
  now = Date.now(),
): Promise<string | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const [row] = await db
    .update(telegramLinkTokens)
    .set({ usedAt: new Date(now) })
    .where(
      and(
        eq(telegramLinkTokens.tokenHash, await sha256Hex(token)),
        isNull(telegramLinkTokens.usedAt),
        gt(telegramLinkTokens.expiresAt, new Date(now)),
      ),
    )
    .returning({ userId: telegramLinkTokens.userId });
  return row?.userId ?? null;
}

/** Vincula el chat a la cuenta. Un chat solo puede estar en una cuenta: se quita de la otra. */
export async function linkChat(
  db: Database,
  env: TelegramEnv,
  userId: string,
  chatId: string,
  now = Date.now(),
): Promise<void> {
  const hash = await chatHash(env, chatId);
  const chatIdEnc = await encryptField(chatId, await keyringFromEnv(env), `telegram:${userId}`);
  await db.batch([
    db
      .delete(telegramLinks)
      .where(and(eq(telegramLinks.chatHash, hash), ne(telegramLinks.userId, userId))),
    db
      .insert(telegramLinks)
      .values({ userId, chatIdEnc, chatHash: hash, linkedAt: new Date(now) })
      .onConflictDoUpdate({
        target: telegramLinks.userId,
        set: { chatIdEnc, chatHash: hash, linkedAt: new Date(now), mutedUntil: null },
      }),
  ]);
}

export async function findLinkByChat(
  db: Database,
  env: TelegramEnv,
  chatId: string,
): Promise<TelegramLink | null> {
  const [row] = await db
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.chatHash, await chatHash(env, chatId)))
    .limit(1);
  return row ?? null;
}

export async function getLink(db: Database, userId: string): Promise<TelegramLink | null> {
  const [row] = await db
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function chatIdOf(env: TelegramEnv, link: TelegramLink): Promise<string> {
  return decryptField(link.chatIdEnc, await keyringFromEnv(env), `telegram:${link.userId}`);
}

export async function unlinkUser(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .delete(telegramLinks)
    .where(eq(telegramLinks.userId, userId))
    .returning({ userId: telegramLinks.userId });
  return rows.length === 1;
}

export async function updateLink(
  db: Database,
  userId: string,
  patch: Partial<
    Pick<TelegramLink, "mutedUntil" | "digestTime" | "quietStart" | "quietEnd" | "lastDigestOn">
  >,
): Promise<TelegramLink | null> {
  const [row] = await db
    .update(telegramLinks)
    .set(patch)
    .where(eq(telegramLinks.userId, userId))
    .returning();
  return row ?? null;
}

/** Tokens caducados o usados hace más de un día (limpieza del planificador). */
export async function purgeLinkTokens(db: Database, now = Date.now()): Promise<void> {
  const dayAgo = new Date(now - 86_400_000);
  await db
    .delete(telegramLinkTokens)
    .where(or(lt(telegramLinkTokens.expiresAt, dayAgo), lt(telegramLinkTokens.usedAt, dayAgo)));
}
