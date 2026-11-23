import type { Locale } from "@delyra/shared";

/**
 * Textos de Telegram y de los avisos por correo en el idioma de la cuenta (F7-06). Los datos
 * que vienen del usuario se escapan donde se usan (los mensajes van con `parse_mode: HTML`).
 */

export type BotCommand =
  "today" | "tomorrow" | "week" | "new" | "tasks" | "mute" | "unlink" | "help";

/** Los dos juegos de comandos valen siempre, sea cual sea el idioma de la cuenta. */
export const COMMAND_ALIASES: Readonly<Record<string, BotCommand>> = {
  hoy: "today",
  today: "today",
  manana: "tomorrow",
  mañana: "tomorrow",
  tomorrow: "tomorrow",
  semana: "week",
  week: "week",
  nuevo: "new",
  new: "new",
  tareas: "tasks",
  tasks: "tasks",
  silenciar: "mute",
  mute: "mute",
  desvincular: "unlink",
  unlink: "unlink",
  ayuda: "help",
  help: "help",
};

const es = {
  intl: "es-ES",
  today: "hoy",
  tomorrow: "mañana",
  allDay: "todo el día",
  allDayLine: "Todo el día",
  due: (day: string) => `vence ${day}`,
  dueAt: (day: string, time: string) => `vence ${day} a las ${time}`,
  at: (day: string, time: string) => `${day} a las ${time}`,
  nothing: "No tienes nada en el calendario.",
  noTasks: "No tienes tareas pendientes.",
  more: (n: number) => `… y ${String(n)} más.`,
  overdue: "⚠️ Vencidas",
  snooze10: "⏰ 10 min",
  snooze60: "1 h",
  snoozeTomorrow: "Mañana 9:00",
  done: "✅ Hecho",
  open: "Abrir",
  security: {
    login: "Nuevo inicio de sesión en tu cuenta",
    password_changed: "Se ha cambiado la contraseña de tu cuenta",
    password_reset: "Se ha restablecido la contraseña de tu cuenta desde el correo",
    totp_changed: "Se ha cambiado la app autenticadora de tu cuenta",
    recovery_codes: "Se han generado códigos de recuperación nuevos",
    sessions_revoked: "Se han cerrado sesiones de tu cuenta",
  },
  securityAdvice: (url: string) =>
    `Si no has sido tú, cambia la contraseña y cierra las demás sesiones: ${url}`,
  commands: [
    { command: "hoy", description: "Agenda de hoy" },
    { command: "manana", description: "Agenda de mañana" },
    { command: "semana", description: "Próximos 7 días" },
    { command: "nuevo", description: "Crear un evento: /nuevo Dentista mañana 17:30" },
    { command: "tareas", description: "Tareas pendientes" },
    {
      command: "silenciar",
      description: "Silenciar alertas: /silenciar 2 (horas) u /silenciar no",
    },
    { command: "desvincular", description: "Desvincular esta cuenta de Telegram" },
    { command: "ayuda", description: "Qué puedo hacer" },
  ],
  helpIntro: "<b>Delyra</b> te avisa de tus eventos y te deja consultar la agenda.",
  linkInvalid: "Ese enlace no es válido o ha caducado. Genera otro en Ajustes → Telegram.",
  linked: "✅ <b>Cuenta vinculada.</b> Aquí te llegarán tus alertas.",
  agendaToday: "📅 Hoy",
  agendaTomorrow: "📅 Mañana",
  agendaWeek: "📅 Próximos 7 días",
  tasksWeek: "📌 Tareas de los próximos 7 días",
  newNotUnderstood: "No he entendido cuándo. Prueba con: /nuevo Dentista mañana 17:30",
  noPersonal: "No encuentro tu calendario Personal.",
  created: "✅ Creado:",
  unmuted: "🔔 Alertas activadas de nuevo.",
  muteHours: "Indica las horas (de 1 a 72): /silenciar 2",
  muted: (until: string) =>
    `🔕 Alertas silenciadas hasta ${until}. Los avisos de seguridad siguen llegando. /silenciar no para reactivarlas.`,
  unlinked: "Cuenta desvinculada. Ya no recibirás alertas aquí.",
  unknownCommand: "No conozco ese comando. Escribe /ayuda para ver la lista.",
  typeHelp: "Escribe /ayuda para ver lo que puedo hacer.",
  hello: (url: string) =>
    `Hola. Para recibir tus alertas, vincula tu cuenta desde Ajustes → Telegram: ${url}`,
  linkFirst: (url: string) => `Primero vincula tu cuenta desde Ajustes → Telegram: ${url}`,
  reminderGone: "Esta alerta ya no está disponible.",
  snoozedUntil: (until: string) => `⏰ Pospuesta hasta ${until}`,
  digestToday: "☀️ Tu agenda de hoy",
  digestOn: (date: string) => `☀️ Tu agenda del ${date}`,
  digestTasks: "📌 Tareas",
  test: "✅ <b>Delyra está conectado.</b>\nAquí te llegarán las alertas de tus eventos.",
  reminderSubject: (title: string) => `Recordatorio: ${title}`,
};

type BotText = typeof es;

const en: BotText = {
  intl: "en-GB",
  today: "today",
  tomorrow: "tomorrow",
  allDay: "all day",
  allDayLine: "All day",
  due: (day) => `due ${day}`,
  dueAt: (day, time) => `due ${day} at ${time}`,
  at: (day, time) => `${day} at ${time}`,
  nothing: "There's nothing on your calendar.",
  noTasks: "You have no pending tasks.",
  more: (n) => `… and ${String(n)} more.`,
  overdue: "⚠️ Overdue",
  snooze10: "⏰ 10 min",
  snooze60: "1 h",
  snoozeTomorrow: "Tomorrow 9:00",
  done: "✅ Done",
  open: "Open",
  security: {
    login: "New sign-in to your account",
    password_changed: "Your account password was changed",
    password_reset: "Your account password was reset from the email",
    totp_changed: "Your account's authenticator app was changed",
    recovery_codes: "New recovery codes were generated",
    sessions_revoked: "Sessions on your account were signed out",
  },
  securityAdvice: (url) =>
    `If it wasn't you, change your password and sign out the other sessions: ${url}`,
  commands: [
    { command: "today", description: "Today's agenda" },
    { command: "tomorrow", description: "Tomorrow's agenda" },
    { command: "week", description: "Next 7 days" },
    { command: "new", description: "Create an event: /new Dentist tomorrow 5:30pm" },
    { command: "tasks", description: "Pending tasks" },
    { command: "mute", description: "Mute alerts: /mute 2 (hours) or /mute off" },
    { command: "unlink", description: "Unlink this Telegram account" },
    { command: "help", description: "What I can do" },
  ],
  helpIntro: "<b>Delyra</b> alerts you about your events and lets you check your agenda.",
  linkInvalid: "That link isn't valid or has expired. Generate another one in Settings → Telegram.",
  linked: "✅ <b>Account linked.</b> Your alerts will arrive here.",
  agendaToday: "📅 Today",
  agendaTomorrow: "📅 Tomorrow",
  agendaWeek: "📅 Next 7 days",
  tasksWeek: "📌 Tasks for the next 7 days",
  newNotUnderstood: "I didn't understand when. Try: /new Dentist tomorrow 5:30pm",
  noPersonal: "I can't find your Personal calendar.",
  created: "✅ Created:",
  unmuted: "🔔 Alerts are back on.",
  muteHours: "Say how many hours (1 to 72): /mute 2",
  muted: (until) =>
    `🔕 Alerts muted until ${until}. Security notices still arrive. /mute off to turn them back on.`,
  unlinked: "Account unlinked. You won't get alerts here any more.",
  unknownCommand: "I don't know that command. Type /help to see the list.",
  typeHelp: "Type /help to see what I can do.",
  hello: (url) => `Hi. To get your alerts, link your account from Settings → Telegram: ${url}`,
  linkFirst: (url) => `First link your account from Settings → Telegram: ${url}`,
  reminderGone: "This alert is no longer available.",
  snoozedUntil: (until) => `⏰ Snoozed until ${until}`,
  digestToday: "☀️ Your agenda for today",
  digestOn: (date) => `☀️ Your agenda for ${date}`,
  digestTasks: "📌 Tasks",
  test: "✅ <b>Delyra is connected.</b>\nYour event alerts will arrive here.",
  reminderSubject: (title) => `Reminder: ${title}`,
};

const TEXT: Readonly<Record<Locale, BotText>> = { es, en };

export const botText = (locale: Locale): BotText => TEXT[locale];
