import { dateOnlyToUtc, instantToWall, type Locale, type Occurrence } from "@delyra/shared";
import { escapeHtml, type InlineButton } from "../lib/telegram";
import { botText } from "./bot-text";

/**
 * Textos de Telegram (F3-06, F3-08, F3-09, F3-10), en el idioma de la cuenta (F7-06) y con fechas
 * en la zona del usuario. Todo lo que viene del usuario se escapa: los mensajes usan
 * `parse_mode: HTML`.
 */

const pad = (n: number) => String(n).padStart(2, "0");

function localDate(ms: number, timeZone: string): string {
  const w = instantToWall(ms, timeZone);
  return `${String(w.year)}-${pad(w.month)}-${pad(w.day)}`;
}

function time(ms: number, timeZone: string): string {
  const w = instantToWall(ms, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** «hoy», «mañana» o «lun 23 nov» (en el idioma de la cuenta). */
function dayLabel(date: string, today: string, locale: Locale): string {
  const t = botText(locale);
  if (date === today) return t.today;
  const tomorrow = new Date(dateOnlyToUtc(today) + 86_400_000).toISOString().slice(0, 10);
  if (date === tomorrow) return t.tomorrow;
  return new Intl.DateTimeFormat(t.intl, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(dateOnlyToUtc(date)));
}

export interface WhenInput {
  start: number;
  end: number;
  allDay: boolean;
}

/** «hoy, 17:30–18:30», «mañana, todo el día»… */
export function describeWhen(
  when: WhenInput,
  timeZone: string,
  now: number,
  locale: Locale = "es",
): string {
  const today = localDate(now, timeZone);
  if (when.allDay) {
    const date = new Date(when.start).toISOString().slice(0, 10);
    return `${dayLabel(date, today, locale)}, ${botText(locale).allDay}`;
  }
  const day = dayLabel(localDate(when.start, timeZone), today, locale);
  return `${day}, ${time(when.start, timeZone)}–${time(when.end, timeZone)}`;
}

/** «vence hoy a las 17:00», «vence mañana». */
export function describeDeadline(
  when: WhenInput,
  timeZone: string,
  now: number,
  locale: Locale = "es",
): string {
  const t = botText(locale);
  const today = localDate(now, timeZone);
  if (when.allDay) {
    return t.due(dayLabel(new Date(when.start).toISOString().slice(0, 10), today, locale));
  }
  return t.dueAt(
    dayLabel(localDate(when.start, timeZone), today, locale),
    time(when.start, timeZone),
  );
}

export interface ReminderContent extends WhenInput {
  title: string;
  calendarName: string | null;
  location: string | null;
  url: string | null;
  age: number | null;
  /** Fecha límite de una tarjeta (un instante, no un intervalo). */
  deadline?: boolean;
}

export function reminderText(
  content: ReminderContent,
  timeZone: string,
  now: number,
  footer?: string,
  locale: Locale = "es",
): string {
  const title = content.age !== null ? `${content.title} (${String(content.age)})` : content.title;
  const when = content.deadline
    ? describeDeadline(content, timeZone, now, locale)
    : describeWhen(content, timeZone, now, locale);
  const lines = [
    `${content.deadline ? "📌" : "🔔"} <b>${escapeHtml(title)}</b>`,
    escapeHtml([when, content.calendarName].filter(Boolean).join(" · ")),
  ];
  if (content.location) lines.push(`📍 ${escapeHtml(content.location)}`);
  if (content.url) lines.push(`🔗 ${escapeHtml(content.url)}`);
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

/** Botones de una alerta. `callback_data` cabe de sobra en los 64 bytes de Telegram. */
export function reminderKeyboard(
  reminderId: string,
  occurrenceStart: number,
  openUrl: string | null,
  locale: Locale = "es",
): InlineButton[][] {
  const t = botText(locale);
  const ref = `${reminderId}:${occurrenceStart.toString(36)}`;
  const rows: InlineButton[][] = [
    [
      { text: t.snooze10, callback_data: `s10:${ref}` },
      { text: t.snooze60, callback_data: `s60:${ref}` },
      { text: t.snoozeTomorrow, callback_data: `stm:${ref}` },
    ],
    [{ text: t.done, callback_data: `ok:${ref}` }],
  ];
  if (openUrl) rows[1]?.push({ text: t.open, url: openUrl });
  return rows;
}

export function agendaText(
  heading: string,
  occurrences: readonly Occurrence[],
  calendarNames: ReadonlyMap<string, string>,
  timeZone: string,
  now: number,
  withDay: boolean,
  locale: Locale = "es",
): string {
  const t = botText(locale);
  if (occurrences.length === 0) return `<b>${escapeHtml(heading)}</b>\n${t.nothing}`;
  const lines = [`<b>${escapeHtml(heading)}</b>`];
  let lastDay = "";
  const today = localDate(now, timeZone);
  for (const o of occurrences.slice(0, 60)) {
    const start = o.allDay ? dateOnlyToUtc(o.start) : Date.parse(o.start);
    const day = o.allDay ? o.start : localDate(start, timeZone);
    if (withDay && day !== lastDay) {
      lines.push("", `<u>${escapeHtml(dayLabel(day, today, locale))}</u>`);
      lastDay = day;
    }
    const when = o.allDay
      ? t.allDayLine
      : `${time(start, timeZone)}–${time(Date.parse(o.end), timeZone)}`;
    const title = o.age !== null ? `${o.title} (${String(o.age)})` : o.title;
    const calendar = calendarNames.get(o.calendarId);
    lines.push(
      `• ${escapeHtml(when)} ${escapeHtml(title)}${calendar ? ` <i>· ${escapeHtml(calendar)}</i>` : ""}`,
    );
  }
  if (occurrences.length > 60) lines.push(t.more(occurrences.length - 60));
  return lines.join("\n");
}

export interface TaskLine {
  title: string;
  boardName: string;
  date: string;
  dueAt: number;
  allDay: boolean;
  overdue: boolean;
}

/** Tareas con fecha límite: primero las vencidas, después agrupadas por día. */
export function tasksText(
  heading: string,
  tasks: readonly TaskLine[],
  timeZone: string,
  now: number,
  locale: Locale = "es",
): string {
  const t = botText(locale);
  if (tasks.length === 0) return `<b>${escapeHtml(heading)}</b>\n${t.noTasks}`;
  const today = localDate(now, timeZone);
  const line = (task: TaskLine, withDay: boolean) => {
    const day = dayLabel(task.date, today, locale);
    const when = task.allDay
      ? withDay
        ? day
        : ""
      : `${withDay ? `${day} ` : ""}${time(task.dueAt, timeZone)}`;
    return `• ${when ? `${escapeHtml(when)} ` : ""}${escapeHtml(task.title)} <i>· ${escapeHtml(task.boardName)}</i>`;
  };
  const lines = [`<b>${escapeHtml(heading)}</b>`];
  const shown = tasks.slice(0, 60);
  const overdue = shown.filter((task) => task.overdue);
  if (overdue.length > 0) {
    lines.push("", `<u>${t.overdue}</u>`, ...overdue.map((task) => line(task, true)));
  }
  let lastDay = "";
  for (const task of shown.filter((x) => !x.overdue)) {
    if (task.date !== lastDay) {
      lines.push("", `<u>${escapeHtml(dayLabel(task.date, today, locale))}</u>`);
      lastDay = task.date;
    }
    lines.push(line(task, false));
  }
  if (tasks.length > 60) lines.push(t.more(tasks.length - 60));
  return lines.join("\n");
}

export const SECURITY_EVENTS = [
  "login",
  "password_changed",
  "password_reset",
  "totp_changed",
  "recovery_codes",
  "sessions_revoked",
] as const;
export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

export function securityText(
  event: SecurityEvent,
  details: { country: string | null; device: string | null },
  settingsUrl: string,
  locale: Locale = "es",
): string {
  const t = botText(locale);
  const where = [details.device, details.country].filter(Boolean).join(" · ");
  return [
    `🔐 <b>${escapeHtml(t.security[event])}</b>`,
    where ? escapeHtml(where) : null,
    "",
    escapeHtml(t.securityAdvice(settingsUrl)),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Comandos del bot en español (los que se registran por defecto en Telegram). */
export const BOT_COMMANDS = botText("es").commands;

export function helpText(locale: Locale = "es"): string {
  const t = botText(locale);
  return [
    t.helpIntro,
    "",
    ...t.commands.map((c) => `/${c.command} — ${escapeHtml(c.description)}`),
  ].join("\n");
}
