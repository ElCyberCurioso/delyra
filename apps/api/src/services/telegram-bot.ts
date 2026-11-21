import {
  addDays,
  dateOnlyToUtc,
  instantToWall,
  parseQuickAdd,
  type QuickDraft,
  utcToDateOnly,
  wallToInstant,
} from "@delyra/shared";
import { z } from "zod";
import type { Database } from "../db/client";
import type { Logger } from "../lib/logger";
import type { RequestMeta } from "../lib/request-meta";
import { escapeHtml, type TelegramClient } from "../lib/telegram";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import { agendaFor, localToday } from "./agenda";
import { audit } from "./audit";
import { createEvent } from "./events";
import { agendaText, describeWhen, helpText, reminderText } from "./notification-text";
import { loadReminder, reminderContent, settingsUrl } from "./notifications";
import {
  consumeLinkToken,
  findLinkByChat,
  linkChat,
  unlinkUser,
  updateLink,
} from "./telegram-links";
import { getUserSettings } from "./users";

/** Bot de Telegram (F3-04, F3-07, F3-08): vinculación, comandos y botones de las alertas. */

const chatSchema = z.looseObject({ id: z.number(), type: z.string() });

export const telegramUpdateSchema = z.looseObject({
  update_id: z.number().int(),
  message: z
    .looseObject({ message_id: z.number(), chat: chatSchema, text: z.string().optional() })
    .optional(),
  callback_query: z
    .looseObject({
      id: z.string(),
      data: z.string().optional(),
      message: z.looseObject({ message_id: z.number(), chat: chatSchema }).optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface BotDeps {
  db: Database;
  env: Env;
  telegram: TelegramClient;
  logger: Logger;
  meta: RequestMeta | null;
  now: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

async function reply(deps: BotDeps, chatId: string, html: string) {
  try {
    await deps.telegram.sendMessage(chatId, html);
  } catch (error) {
    deps.logger.warn("telegram_reply_failed", { error });
  }
}

async function timeZoneOf(db: Database, userId: string): Promise<string> {
  return (await getUserSettings(db, userId))?.timeZone ?? "Europe/Madrid";
}

/** «Ahora» en la zona del usuario como fecha local (lo que espera chrono-node). */
function reference(now: number, timeZone: string): Date {
  const w = instantToWall(now, timeZone);
  return new Date(w.year, w.month - 1, w.day, w.hour, w.minute);
}

function draftTimes(draft: QuickDraft, timeZone: string) {
  if (draft.allDay) {
    return {
      allDay: true,
      start: draft.date,
      end: utcToDateOnly(addDays(dateOnlyToUtc(draft.date), 1)),
    };
  }
  const at = (hhmm: string) => {
    const [year, month, day] = draft.date.split("-").map(Number);
    const [hour, minute] = hhmm.split(":").map(Number);
    return new Date(
      wallToInstant(
        {
          year: year ?? 1970,
          month: month ?? 1,
          day: day ?? 1,
          hour: hour ?? 0,
          minute: minute ?? 0,
          second: 0,
        },
        timeZone,
      ),
    ).toISOString();
  };
  return {
    allDay: false,
    start: at(draft.startTime ?? "09:00"),
    end: at(draft.endTime ?? "10:00"),
  };
}

/** Hora local legible de un instante: «hoy a las 18:40», «mañana a las 09:00». */
function untilLabel(ms: number, now: number, timeZone: string): string {
  const w = instantToWall(ms, timeZone);
  const date = `${String(w.year)}-${pad(w.month)}-${pad(w.day)}`;
  const today = localToday(now, timeZone);
  const day =
    date === today
      ? "hoy"
      : date === utcToDateOnly(addDays(dateOnlyToUtc(today), 1))
        ? "mañana"
        : new Intl.DateTimeFormat("es-ES", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }).format(new Date(dateOnlyToUtc(date)));
  return `${day} a las ${pad(w.hour)}:${pad(w.minute)}`;
}

// ── Comandos ─────────────────────────────────────────────────────────────────

async function linkFromStart(deps: BotDeps, chatId: string, token: string) {
  const userId = await consumeLinkToken(deps.db, token, deps.now);
  if (!userId) {
    await reply(
      deps,
      chatId,
      "Ese enlace no es válido o ha caducado. Genera otro en Ajustes → Telegram.",
    );
    return;
  }
  await linkChat(deps.db, deps.env, userId, chatId, deps.now);
  await audit(deps.db, deps.meta, "telegram.linked", { userId });
  await reply(
    deps,
    chatId,
    `✅ <b>Cuenta vinculada.</b> Aquí te llegarán tus alertas.\n\n${helpText()}`,
  );
}

async function runCommand(
  deps: BotDeps,
  chatId: string,
  userId: string,
  command: string,
  args: string,
) {
  const timeZone = await timeZoneOf(deps.db, userId);
  const today = localToday(deps.now, timeZone);
  const agenda = async (heading: string, firstDay: string, days: number) => {
    const { occurrences, calendarNames } = await agendaFor(
      deps.db,
      userId,
      timeZone,
      firstDay,
      days,
    );
    await reply(
      deps,
      chatId,
      agendaText(heading, occurrences, calendarNames, timeZone, deps.now, days > 1),
    );
  };
  const tomorrow = utcToDateOnly(addDays(dateOnlyToUtc(today), 1));

  switch (command) {
    case "hoy":
      return agenda("📅 Hoy", today, 1);
    case "manana":
    case "mañana":
      return agenda("📅 Mañana", tomorrow, 1);
    case "semana":
      return agenda("📅 Próximos 7 días", today, 7);
    case "tareas":
      return reply(deps, chatId, "Las tareas llegarán con el tablero de Trabajo.");
    case "nuevo": {
      const draft = args ? parseQuickAdd(args, reference(deps.now, timeZone)) : null;
      if (!draft) {
        return reply(
          deps,
          chatId,
          "No he entendido cuándo. Prueba con: /nuevo Dentista mañana 17:30",
        );
      }
      const calendars = calendarRepository(deps.db, userId);
      await calendars.ensureDefaults();
      const calendar = (await calendars.list()).find((c) => c.kind === "personal");
      if (!calendar) return reply(deps, chatId, "No encuentro tu calendario Personal.");
      const times = draftTimes(draft, timeZone);
      const event = await createEvent(
        { events: eventRepository(deps.db, userId), calendars, now: deps.now },
        { type: "event", calendarId: calendar.id, title: draft.title, tz: timeZone, ...times },
      );
      const when = describeWhen(
        {
          start: event.startAt,
          end: event.endAt,
          allDay: event.allDay,
        },
        timeZone,
        deps.now,
      );
      return reply(
        deps,
        chatId,
        `✅ Creado: <b>${escapeHtml(event.title)}</b>\n${escapeHtml(when)} · ${escapeHtml(calendar.name)}`,
      );
    }
    case "silenciar": {
      if (/^(no|off|0)$/i.test(args)) {
        await updateLink(deps.db, userId, { mutedUntil: null });
        return reply(deps, chatId, "🔔 Alertas activadas de nuevo.");
      }
      const hours = args ? Number(args.replace(",", ".")) : 1;
      if (!Number.isFinite(hours) || hours <= 0 || hours > 72) {
        return reply(deps, chatId, "Indica las horas (de 1 a 72): /silenciar 2");
      }
      const until = deps.now + Math.round(hours * 3_600_000);
      await updateLink(deps.db, userId, { mutedUntil: until });
      return reply(
        deps,
        chatId,
        `🔕 Alertas silenciadas hasta ${escapeHtml(untilLabel(until, deps.now, timeZone))}. Los avisos de seguridad siguen llegando. /silenciar no para reactivarlas.`,
      );
    }
    case "desvincular":
      await unlinkUser(deps.db, userId);
      await audit(deps.db, deps.meta, "telegram.unlinked", { userId });
      return reply(deps, chatId, "Cuenta desvinculada. Ya no recibirás alertas aquí.");
    case "ayuda":
    case "help":
      return reply(deps, chatId, helpText());
    default:
      return reply(deps, chatId, "No conozco ese comando. Escribe /ayuda para ver la lista.");
  }
}

async function handleMessage(deps: BotDeps, message: NonNullable<TelegramUpdate["message"]>) {
  // Solo chats privados: en un grupo, cualquiera podría ver la agenda.
  if (message.chat.type !== "private") return;
  const chatId = String(message.chat.id);
  const match = /^\/([\p{L}\w]+)(?:@\w+)?(?:\s+([\s\S]*))?$/u.exec((message.text ?? "").trim());
  if (!match) {
    await reply(deps, chatId, "Escribe /ayuda para ver lo que puedo hacer.");
    return;
  }
  const command = (match[1] ?? "").toLowerCase();
  const args = (match[2] ?? "").trim().slice(0, 300);

  if (command === "start") {
    if (args) return linkFromStart(deps, chatId, args);
    const link = await findLinkByChat(deps.db, deps.env, chatId);
    return reply(
      deps,
      chatId,
      link
        ? helpText()
        : `Hola. Para recibir tus alertas, vincula tu cuenta desde Ajustes → Telegram: ${escapeHtml(settingsUrl(deps.env))}`,
    );
  }
  const link = await findLinkByChat(deps.db, deps.env, chatId);
  if (!link) {
    await reply(
      deps,
      chatId,
      `Primero vincula tu cuenta desde Ajustes → Telegram: ${escapeHtml(settingsUrl(deps.env))}`,
    );
    return;
  }
  await runCommand(deps, chatId, link.userId, command, args);
}

// ── Botones de las alertas (F3-07) ───────────────────────────────────────────

const CALLBACK = /^(s10|s60|stm|ok):([0-9a-f-]{36}):([0-9a-z]{1,12})$/;

async function handleCallback(deps: BotDeps, query: NonNullable<TelegramUpdate["callback_query"]>) {
  const answer = (text?: string) =>
    deps.telegram.answerCallbackQuery(query.id, text).catch((error: unknown) => {
      deps.logger.warn("telegram_answer_failed", { error });
    });
  const match = CALLBACK.exec(query.data ?? "");
  if (!match || !query.message) return answer();
  const [, action, reminderId = "", occurrence = ""] = match;
  const chatId = String(query.message.chat.id);

  // El botón solo vale en el chat vinculado al dueño de la alerta.
  const link = await findLinkByChat(deps.db, deps.env, chatId);
  const loaded = link ? await loadReminder(deps.db, link.userId, reminderId) : null;
  if (!link || !loaded) return answer("Esta alerta ya no está disponible.");

  const timeZone = await timeZoneOf(deps.db, link.userId);
  const occurrenceStart = Number.parseInt(occurrence, 36);
  const content = await reminderContent(deps.db, link.userId, loaded.event, occurrenceStart);
  const events = eventRepository(deps.db, link.userId);

  let footer: string;
  if (action === "ok") {
    await events.updateReminder(reminderId, { snoozeUntil: null, snoozeOccurrenceStart: null });
    footer = "✅ Hecho";
  } else {
    let until: number;
    if (action === "s10") until = deps.now + 10 * 60_000;
    else if (action === "s60") until = deps.now + 60 * 60_000;
    else {
      const tomorrow = utcToDateOnly(addDays(dateOnlyToUtc(localToday(deps.now, timeZone)), 1));
      const [year, month, day] = tomorrow.split("-").map(Number);
      until = wallToInstant(
        { year: year ?? 1970, month: month ?? 1, day: day ?? 1, hour: 9, minute: 0, second: 0 },
        timeZone,
      );
    }
    await events.updateReminder(reminderId, {
      snoozeUntil: until,
      snoozeOccurrenceStart: occurrenceStart,
    });
    footer = `⏰ Pospuesta hasta ${untilLabel(until, deps.now, timeZone)}`;
  }
  try {
    await deps.telegram.editMessageText(
      chatId,
      query.message.message_id,
      reminderText(content, timeZone, deps.now, escapeHtml(footer)),
    );
  } catch (error) {
    deps.logger.warn("telegram_edit_failed", { error });
  }
  await answer(footer.replace(/^\S+\s/, ""));
}

export async function handleUpdate(deps: BotDeps, update: TelegramUpdate): Promise<void> {
  if (update.message) await handleMessage(deps, update.message);
  else if (update.callback_query) await handleCallback(deps, update.callback_query);
}
