import { APP_ORIGINS, appEnvironmentSchema, dateOnlyToUtc } from "@delyra/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { type EventRow, notificationDeliveries, type Reminder } from "../db/schema";
import type { Logger } from "../lib/logger";
import { TelegramError, type TelegramClient } from "../lib/telegram";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import { agendaFor, localToday } from "./agenda";
import { createMailer } from "./mailer";
import {
  agendaText,
  type ReminderContent,
  reminderKeyboard,
  reminderText,
  SECURITY_EVENTS,
  securityText,
} from "./notification-text";
import { chatIdOf, getLink, unlinkUser } from "./telegram-links";
import { findUserById, getUserSettings } from "./users";

/**
 * Mensajes de `delyra-notifications` y su entrega (F3-06, F3-09, F3-10). Cada mensaje lleva una
 * clave de idempotencia: un reintento de la cola no vuelve a enviar lo que ya salió.
 */

const key = z.string().min(1).max(200);

export const notificationMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noop"), idempotencyKey: key }),
  z.object({
    type: z.literal("reminder"),
    idempotencyKey: key,
    ownerId: z.string(),
    reminderId: z.string(),
    occurrenceStart: z.number(),
    fireAt: z.number(),
    snoozed: z.boolean(),
  }),
  z.object({
    type: z.literal("digest"),
    idempotencyKey: key,
    ownerId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    type: z.literal("security"),
    idempotencyKey: key,
    ownerId: z.string(),
    event: z.enum(SECURITY_EVENTS),
    country: z.string().nullable(),
    device: z.string().nullable(),
  }),
  z.object({ type: z.literal("test"), idempotencyKey: key, ownerId: z.string() }),
]);

export type NotificationMessage = z.infer<typeof notificationMessageSchema>;

export interface DeliveryDeps {
  db: Database;
  env: Env;
  /** null si Telegram no está configurado (P-10). */
  telegram: TelegramClient | null;
  logger: Logger;
  now: number;
}

export type DeliveryResult =
  { status: "sent" | "skipped" } | { status: "retry"; delaySeconds: number };

// ── Idempotencia ─────────────────────────────────────────────────────────────

async function claimDelivery(
  db: Database,
  message: Exclude<NotificationMessage, { type: "noop" }>,
  now: number,
): Promise<"new" | "pending" | "done"> {
  const inserted = await db
    .insert(notificationDeliveries)
    .values({
      key: message.idempotencyKey,
      ownerId: message.ownerId,
      kind: message.type,
      status: "sending",
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ key: notificationDeliveries.key });
  if (inserted.length === 1) return "new";
  const [row] = await db
    .select({ status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.key, message.idempotencyKey))
    .limit(1);
  // «sending» de un intento anterior que falló: se vuelve a intentar.
  return row?.status === "sending" ? "pending" : "done";
}

async function finishDelivery(
  db: Database,
  idempotencyKey: string,
  status: "sent" | "skipped",
  now: number,
) {
  await db
    .update(notificationDeliveries)
    .set({ status, sentAt: status === "sent" ? now : null })
    .where(eq(notificationDeliveries.key, idempotencyKey));
}

// ── Contenido ────────────────────────────────────────────────────────────────

export function openEventUrl(env: Pick<Env, "APP_ENV">, eventId: string): string | null {
  const environment = appEnvironmentSchema.safeParse(env.APP_ENV);
  // Telegram no acepta enlaces a localhost en los botones.
  if (!environment.success || environment.data !== "production") return null;
  return `${APP_ORIGINS.production.calendar}/?evento=${eventId}`;
}

export function settingsUrl(env: Pick<Env, "APP_ENV">): string {
  const environment = appEnvironmentSchema.safeParse(env.APP_ENV);
  return `${APP_ORIGINS[environment.success ? environment.data : "development"].calendar}/ajustes`;
}

/** Datos de la ocurrencia avisada: título, horario, calendario… */
export async function reminderContent(
  db: Database,
  ownerId: string,
  event: EventRow,
  occurrenceStart: number,
): Promise<ReminderContent> {
  const calendar = await calendarRepository(db, ownerId).get(event.calendarId);
  const year = new Date(occurrenceStart).getUTCFullYear();
  return {
    title: event.title,
    start: occurrenceStart,
    end: occurrenceStart + (event.endAt - event.startAt),
    allDay: event.allDay,
    calendarName: calendar?.name ?? null,
    location: event.location,
    url: event.url,
    age: event.type === "birthday" && event.birthYear ? year - event.birthYear : null,
  };
}

export async function loadReminder(
  db: Database,
  ownerId: string,
  reminderId: string,
): Promise<{ reminder: Reminder; event: EventRow } | null> {
  const events = eventRepository(db, ownerId);
  const reminder = await events.getReminder(reminderId);
  if (reminder?.targetType !== "event") return null;
  const event = await events.get(reminder.targetId);
  return event ? { reminder, event } : null;
}

// ── Entrega ──────────────────────────────────────────────────────────────────

function retryDelay(error: TelegramError, attempts: number): number {
  if (error.retryAfter !== null) return Math.min(Math.max(error.retryAfter, 1), 3600);
  return Math.min(30 * 2 ** Math.max(attempts - 1, 0), 900);
}

async function sendTelegram(
  deps: DeliveryDeps,
  ownerId: string,
  html: string,
  options: { respectMute: boolean; keyboard?: Parameters<TelegramClient["sendMessage"]>[2] },
): Promise<"sent" | "skipped"> {
  if (!deps.telegram) return "skipped";
  const link = await getLink(deps.db, ownerId);
  if (!link) return "skipped";
  if (options.respectMute && link.mutedUntil !== null && link.mutedUntil > deps.now)
    return "skipped";
  const chatId = await chatIdOf(deps.env, link);
  try {
    await deps.telegram.sendMessage(chatId, html, options.keyboard);
    return "sent";
  } catch (error) {
    if (error instanceof TelegramError && error.chatGone) {
      // El usuario bloqueó el bot: se desvincula para no seguir intentándolo.
      await unlinkUser(deps.db, ownerId);
      deps.logger.warn("telegram_chat_gone", { status: error.status });
      return "skipped";
    }
    throw error;
  }
}

async function deliverReminder(
  deps: DeliveryDeps,
  message: Extract<NotificationMessage, { type: "reminder" }>,
): Promise<"sent" | "skipped"> {
  const loaded = await loadReminder(deps.db, message.ownerId, message.reminderId);
  if (!loaded) return "skipped";
  const { reminder, event } = loaded;
  const settings = await getUserSettings(deps.db, message.ownerId);
  const timeZone = settings?.timeZone ?? event.tz;
  const content = await reminderContent(deps.db, message.ownerId, event, message.occurrenceStart);

  let result: "sent" | "skipped";
  if (reminder.channel === "email") {
    const mailer = createMailer(deps.env, deps.logger);
    if (!mailer.available) return "skipped";
    const user = await findUserById(deps.db, message.ownerId);
    if (!user) return "skipped";
    await mailer.send({
      to: user.email,
      subject: `Recordatorio: ${content.title}`,
      text: reminderText(content, timeZone, deps.now).replace(/<[^>]+>/g, ""),
      html: reminderText(content, timeZone, deps.now).replaceAll("\n", "<br>"),
    });
    result = "sent";
  } else {
    result = await sendTelegram(deps, message.ownerId, reminderText(content, timeZone, deps.now), {
      respectMute: true,
      keyboard: {
        replyMarkup: {
          inline_keyboard: reminderKeyboard(
            reminder.id,
            message.occurrenceStart,
            openEventUrl(deps.env, event.recurringEventId ?? event.id),
          ),
        },
      },
    });
  }
  if (result === "sent") {
    await eventRepository(deps.db, message.ownerId).updateReminder(reminder.id, {
      lastFiredAt: deps.now,
    });
  }
  return result;
}

async function deliverDigest(
  deps: DeliveryDeps,
  message: Extract<NotificationMessage, { type: "digest" }>,
) {
  const settings = await getUserSettings(deps.db, message.ownerId);
  const timeZone = settings?.timeZone ?? "Europe/Madrid";
  const { occurrences, calendarNames } = await agendaFor(
    deps.db,
    message.ownerId,
    timeZone,
    message.date,
    1,
  );
  const heading =
    message.date === localToday(deps.now, timeZone)
      ? "☀️ Tu agenda de hoy"
      : `☀️ Tu agenda del ${new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeZone: "UTC" }).format(new Date(dateOnlyToUtc(message.date)))}`;
  return sendTelegram(
    deps,
    message.ownerId,
    agendaText(heading, occurrences, calendarNames, timeZone, deps.now, false),
    { respectMute: true },
  );
}

/** Entrega un mensaje de la cola. Lanza los errores reintentables para que la cola reintente. */
export async function deliver(
  deps: DeliveryDeps,
  message: NotificationMessage,
  attempts = 1,
): Promise<DeliveryResult> {
  if (message.type === "noop") return { status: "skipped" };
  const claim = await claimDelivery(deps.db, message, deps.now);
  if (claim === "done") return { status: "skipped" };

  let status: "sent" | "skipped";
  try {
    switch (message.type) {
      case "reminder":
        status = await deliverReminder(deps, message);
        break;
      case "digest":
        status = await deliverDigest(deps, message);
        break;
      case "security":
        status = await sendTelegram(
          deps,
          message.ownerId,
          securityText(message.event, message, settingsUrl(deps.env)),
          { respectMute: false },
        );
        break;
      case "test":
        status = await sendTelegram(
          deps,
          message.ownerId,
          "✅ <b>Delyra está conectado.</b>\nAquí te llegarán las alertas de tus eventos.",
          { respectMute: false },
        );
        break;
    }
  } catch (error) {
    if (error instanceof TelegramError && !error.permanent) {
      return { status: "retry", delaySeconds: retryDelay(error, attempts) };
    }
    if (error instanceof TelegramError) {
      deps.logger.warn("telegram_send_failed", { status: error.status, type: message.type });
      status = "skipped";
    } else {
      throw error;
    }
  }
  await finishDelivery(deps.db, message.idempotencyKey, status, deps.now);
  return { status };
}
