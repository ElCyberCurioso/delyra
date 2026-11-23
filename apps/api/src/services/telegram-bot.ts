import {
  addDays,
  dateOnlyToUtc,
  instantToWall,
  type Locale,
  parseQuickAdd,
  type QuickDraft,
  utcToDateOnly,
  wallToInstant,
} from "@delyra/shared";
import { parseEnglish } from "@delyra/shared/quick-add-en";
import { z } from "zod";
import type { Database } from "../db/client";
import { accountLocale, requestLocale } from "../lib/locale";
import type { Logger } from "../lib/logger";
import type { RequestMeta } from "../lib/request-meta";
import { escapeHtml, type TelegramClient } from "../lib/telegram";
import { calendarRepository } from "../repositories/calendars";
import { eventRepository } from "../repositories/events";
import { agendaFor, localToday, tasksUntil } from "./agenda";
import { audit } from "./audit";
import { botText, COMMAND_ALIASES } from "./bot-text";
import { createEvent } from "./events";
import { agendaText, describeWhen, helpText, reminderText, tasksText } from "./notification-text";
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
    .looseObject({
      message_id: z.number(),
      chat: chatSchema,
      text: z.string().optional(),
      from: z.looseObject({ language_code: z.string().optional() }).optional(),
    })
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

/** Zona horaria e idioma de la cuenta (F7-06). */
async function prefsOf(
  db: Database,
  userId: string,
): Promise<{ timeZone: string; locale: Locale }> {
  const settings = await getUserSettings(db, userId);
  return {
    timeZone: settings?.timeZone ?? "Europe/Madrid",
    locale: accountLocale(settings?.locale),
  };
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
function untilLabel(ms: number, now: number, timeZone: string, locale: Locale): string {
  const t = botText(locale);
  const w = instantToWall(ms, timeZone);
  const date = `${String(w.year)}-${pad(w.month)}-${pad(w.day)}`;
  const today = localToday(now, timeZone);
  const day =
    date === today
      ? t.today
      : date === utcToDateOnly(addDays(dateOnlyToUtc(today), 1))
        ? t.tomorrow
        : new Intl.DateTimeFormat(t.intl, {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }).format(new Date(dateOnlyToUtc(date)));
  return t.at(day, `${pad(w.hour)}:${pad(w.minute)}`);
}

// ── Comandos ─────────────────────────────────────────────────────────────────

async function linkFromStart(deps: BotDeps, chatId: string, token: string, fallback: Locale) {
  const userId = await consumeLinkToken(deps.db, token, deps.now);
  if (!userId) {
    await reply(deps, chatId, botText(fallback).linkInvalid);
    return;
  }
  await linkChat(deps.db, deps.env, userId, chatId, deps.now);
  await audit(deps.db, deps.meta, "telegram.linked", { userId });
  const { locale } = await prefsOf(deps.db, userId);
  await reply(deps, chatId, `${botText(locale).linked}\n\n${helpText(locale)}`);
}

async function runCommand(
  deps: BotDeps,
  chatId: string,
  userId: string,
  command: string,
  args: string,
) {
  const { timeZone, locale } = await prefsOf(deps.db, userId);
  const t = botText(locale);
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
      agendaText(heading, occurrences, calendarNames, timeZone, deps.now, days > 1, locale),
    );
  };
  const tomorrow = utcToDateOnly(addDays(dateOnlyToUtc(today), 1));

  switch (COMMAND_ALIASES[command] ?? "unknown") {
    case "today":
      return agenda(t.agendaToday, today, 1);
    case "tomorrow":
      return agenda(t.agendaTomorrow, tomorrow, 1);
    case "week":
      return agenda(t.agendaWeek, today, 7);
    case "tasks": {
      const lastDay = utcToDateOnly(addDays(dateOnlyToUtc(today), 6));
      const tasks = await tasksUntil(deps.db, userId, timeZone, lastDay, deps.now);
      return reply(deps, chatId, tasksText(t.tasksWeek, tasks, timeZone, deps.now, locale));
    }
    case "new": {
      // En inglés se usa el analizador inglés de chrono-node; el español entiende igual las horas.
      const draft = args
        ? parseQuickAdd(args, reference(deps.now, timeZone), {
            locale,
            parse: locale === "en" ? parseEnglish : undefined,
          })
        : null;
      if (!draft) return reply(deps, chatId, t.newNotUnderstood);
      const calendars = calendarRepository(deps.db, userId);
      await calendars.ensureDefaults(locale);
      const calendar = (await calendars.list()).find((c) => c.kind === "personal");
      if (!calendar) return reply(deps, chatId, t.noPersonal);
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
        locale,
      );
      return reply(
        deps,
        chatId,
        `${t.created} <b>${escapeHtml(event.title)}</b>\n${escapeHtml(when)} · ${escapeHtml(calendar.name)}`,
      );
    }
    case "mute": {
      if (/^(no|off|0)$/i.test(args)) {
        await updateLink(deps.db, userId, { mutedUntil: null });
        return reply(deps, chatId, t.unmuted);
      }
      const hours = args ? Number(args.replace(",", ".")) : 1;
      if (!Number.isFinite(hours) || hours <= 0 || hours > 72) {
        return reply(deps, chatId, t.muteHours);
      }
      const until = deps.now + Math.round(hours * 3_600_000);
      await updateLink(deps.db, userId, { mutedUntil: until });
      return reply(
        deps,
        chatId,
        t.muted(escapeHtml(untilLabel(until, deps.now, timeZone, locale))),
      );
    }
    case "unlink":
      await unlinkUser(deps.db, userId);
      await audit(deps.db, deps.meta, "telegram.unlinked", { userId });
      return reply(deps, chatId, t.unlinked);
    case "help":
      return reply(deps, chatId, helpText(locale));
    case "unknown":
      return reply(deps, chatId, t.unknownCommand);
  }
}

async function handleMessage(deps: BotDeps, message: NonNullable<TelegramUpdate["message"]>) {
  // Solo chats privados: en un grupo, cualquiera podría ver la agenda.
  if (message.chat.type !== "private") return;
  const chatId = String(message.chat.id);
  // Sin cuenta vinculada, el idioma del propio Telegram.
  const fallback = requestLocale(message.from?.language_code);
  const linked = await findLinkByChat(deps.db, deps.env, chatId);
  const locale = linked ? (await prefsOf(deps.db, linked.userId)).locale : fallback;
  const match = /^\/([\p{L}\w]+)(?:@\w+)?(?:\s+([\s\S]*))?$/u.exec((message.text ?? "").trim());
  if (!match) {
    await reply(deps, chatId, botText(locale).typeHelp);
    return;
  }
  const command = (match[1] ?? "").toLowerCase();
  const args = (match[2] ?? "").trim().slice(0, 300);

  if (command === "start") {
    if (args) return linkFromStart(deps, chatId, args, fallback);
    return reply(
      deps,
      chatId,
      linked ? helpText(locale) : botText(locale).hello(escapeHtml(settingsUrl(deps.env))),
    );
  }
  if (!linked) {
    await reply(deps, chatId, botText(locale).linkFirst(escapeHtml(settingsUrl(deps.env))));
    return;
  }
  await runCommand(deps, chatId, linked.userId, command, args);
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
  if (!link || !loaded) return answer(botText("es").reminderGone);

  const { timeZone, locale } = await prefsOf(deps.db, link.userId);
  const t = botText(locale);
  const occurrenceStart = Number.parseInt(occurrence, 36);
  const content = await reminderContent(deps.db, link.userId, loaded.target, occurrenceStart);
  const events = eventRepository(deps.db, link.userId);

  let footer: string;
  if (action === "ok") {
    await events.updateReminder(reminderId, { snoozeUntil: null, snoozeOccurrenceStart: null });
    footer = t.done;
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
    footer = t.snoozedUntil(untilLabel(until, deps.now, timeZone, locale));
  }
  try {
    await deps.telegram.editMessageText(
      chatId,
      query.message.message_id,
      reminderText(content, timeZone, deps.now, escapeHtml(footer), locale),
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
