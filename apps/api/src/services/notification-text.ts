import { dateOnlyToUtc, instantToWall, type Occurrence } from "@delyra/shared";
import { escapeHtml, type InlineButton } from "../lib/telegram";

/**
 * Textos de Telegram (F3-06, F3-08, F3-09, F3-10), en español y con fechas en la zona del
 * usuario. Todo lo que viene del usuario se escapa: los mensajes usan `parse_mode: HTML`.
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

/** «hoy», «mañana» o «lun 23 nov». */
function dayLabel(date: string, today: string): string {
  if (date === today) return "hoy";
  const tomorrow = new Date(dateOnlyToUtc(today) + 86_400_000).toISOString().slice(0, 10);
  if (date === tomorrow) return "mañana";
  return new Intl.DateTimeFormat("es-ES", {
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
export function describeWhen(when: WhenInput, timeZone: string, now: number): string {
  const today = localDate(now, timeZone);
  if (when.allDay) {
    const date = new Date(when.start).toISOString().slice(0, 10);
    return `${dayLabel(date, today)}, todo el día`;
  }
  const day = dayLabel(localDate(when.start, timeZone), today);
  return `${day}, ${time(when.start, timeZone)}–${time(when.end, timeZone)}`;
}

export interface ReminderContent extends WhenInput {
  title: string;
  calendarName: string | null;
  location: string | null;
  url: string | null;
  age: number | null;
}

export function reminderText(
  content: ReminderContent,
  timeZone: string,
  now: number,
  footer?: string,
): string {
  const title = content.age !== null ? `${content.title} (${String(content.age)})` : content.title;
  const lines = [
    `🔔 <b>${escapeHtml(title)}</b>`,
    escapeHtml(
      [describeWhen(content, timeZone, now), content.calendarName].filter(Boolean).join(" · "),
    ),
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
): InlineButton[][] {
  const ref = `${reminderId}:${occurrenceStart.toString(36)}`;
  const rows: InlineButton[][] = [
    [
      { text: "⏰ 10 min", callback_data: `s10:${ref}` },
      { text: "1 h", callback_data: `s60:${ref}` },
      { text: "Mañana 9:00", callback_data: `stm:${ref}` },
    ],
    [{ text: "✅ Hecho", callback_data: `ok:${ref}` }],
  ];
  if (openUrl) rows[1]?.push({ text: "Abrir", url: openUrl });
  return rows;
}

export function agendaText(
  heading: string,
  occurrences: readonly Occurrence[],
  calendarNames: ReadonlyMap<string, string>,
  timeZone: string,
  now: number,
  withDay: boolean,
): string {
  if (occurrences.length === 0)
    return `<b>${escapeHtml(heading)}</b>\nNo tienes nada en el calendario.`;
  const lines = [`<b>${escapeHtml(heading)}</b>`];
  let lastDay = "";
  const today = localDate(now, timeZone);
  for (const o of occurrences.slice(0, 60)) {
    const start = o.allDay ? dateOnlyToUtc(o.start) : Date.parse(o.start);
    const day = o.allDay ? o.start : localDate(start, timeZone);
    if (withDay && day !== lastDay) {
      lines.push("", `<u>${escapeHtml(dayLabel(day, today))}</u>`);
      lastDay = day;
    }
    const when = o.allDay
      ? "Todo el día"
      : `${time(start, timeZone)}–${time(Date.parse(o.end), timeZone)}`;
    const title = o.age !== null ? `${o.title} (${String(o.age)})` : o.title;
    const calendar = calendarNames.get(o.calendarId);
    lines.push(
      `• ${escapeHtml(when)} ${escapeHtml(title)}${calendar ? ` <i>· ${escapeHtml(calendar)}</i>` : ""}`,
    );
  }
  if (occurrences.length > 60) lines.push(`… y ${String(occurrences.length - 60)} más.`);
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

const SECURITY_COPY: Record<SecurityEvent, string> = {
  login: "Nuevo inicio de sesión en tu cuenta",
  password_changed: "Se ha cambiado la contraseña de tu cuenta",
  password_reset: "Se ha restablecido la contraseña de tu cuenta desde el correo",
  totp_changed: "Se ha cambiado la app autenticadora de tu cuenta",
  recovery_codes: "Se han generado códigos de recuperación nuevos",
  sessions_revoked: "Se han cerrado sesiones de tu cuenta",
};

export function securityText(
  event: SecurityEvent,
  details: { country: string | null; device: string | null },
  settingsUrl: string,
): string {
  const where = [details.device, details.country].filter(Boolean).join(" · ");
  return [
    `🔐 <b>${escapeHtml(SECURITY_COPY[event])}</b>`,
    where ? escapeHtml(where) : null,
    "",
    `Si no has sido tú, cambia la contraseña y cierra las demás sesiones: ${escapeHtml(settingsUrl)}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export const BOT_COMMANDS = [
  { command: "hoy", description: "Agenda de hoy" },
  { command: "manana", description: "Agenda de mañana" },
  { command: "semana", description: "Próximos 7 días" },
  { command: "nuevo", description: "Crear un evento: /nuevo Dentista mañana 17:30" },
  { command: "tareas", description: "Tareas pendientes" },
  { command: "silenciar", description: "Silenciar alertas: /silenciar 2 (horas) u /silenciar no" },
  { command: "desvincular", description: "Desvincular esta cuenta de Telegram" },
  { command: "ayuda", description: "Qué puedo hacer" },
];

export function helpText(): string {
  return [
    "<b>Delyra</b> te avisa de tus eventos y te deja consultar la agenda.",
    "",
    ...BOT_COMMANDS.map((c) => `/${c.command} — ${escapeHtml(c.description)}`),
  ].join("\n");
}
