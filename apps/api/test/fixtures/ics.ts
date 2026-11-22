/**
 * Fixtures ICS (F5-07). `GOOGLE_EXPORT` reproduce el formato de «Exportar» de Google Calendar
 * (PRODID, VTIMEZONE con X-LIC-LOCATION, UNTIL en UTC, EXDATE con TZID, excepciones con
 * RECURRENCE-ID, ocurrencias canceladas, VALARM y descripciones con HTML).
 */

export const crlf = (lines: readonly string[]) => `${lines.join("\r\n")}\r\n`;

const MADRID_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Madrid",
  "X-LIC-LOCATION:Europe/Madrid",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export const calendarHeader = (name: string, tz = "Europe/Madrid") => [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  `X-WR-CALNAME:${name}`,
  `X-WR-TIMEZONE:${tz}`,
];

export const GOOGLE_EXPORT = crlf([
  ...calendarHeader("Personal"),
  ...MADRID_VTIMEZONE,
  // Serie semanal (lunes 10:00) con un borrado, una ocurrencia movida y otra cancelada.
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Madrid:20261102T100000",
  "DTEND;TZID=Europe/Madrid:20261102T110000",
  "RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20261228T085959Z;BYDAY=MO",
  "EXDATE;TZID=Europe/Madrid:20261109T100000",
  "DTSTAMP:20261120T100000Z",
  "UID:7kukuqrfedlm2f9t0vqv4fn9nm@google.com",
  "CREATED:20261020T090000Z",
  "DESCRIPTION:Revisar <b>notas</b><br>y tareas pendientes de la semana\\, con un",
  "  texto largo que Google pliega en varias líneas",
  "LAST-MODIFIED:20261020T090000Z",
  "LOCATION:Oficina\\, planta 2",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Reunión semanal",
  "TRANSP:OPAQUE",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:This is an event reminder",
  "TRIGGER:-P0DT0H10M0S",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Madrid:20261116T120000",
  "DTEND;TZID=Europe/Madrid:20261116T130000",
  "DTSTAMP:20261120T100000Z",
  "UID:7kukuqrfedlm2f9t0vqv4fn9nm@google.com",
  "RECURRENCE-ID;TZID=Europe/Madrid:20261116T100000",
  "SUMMARY:Reunión semanal (movida)",
  "STATUS:CONFIRMED",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Madrid:20261123T100000",
  "DTEND;TZID=Europe/Madrid:20261123T110000",
  "DTSTAMP:20261120T100000Z",
  "UID:7kukuqrfedlm2f9t0vqv4fn9nm@google.com",
  "RECURRENCE-ID;TZID=Europe/Madrid:20261123T100000",
  "STATUS:CANCELLED",
  "SUMMARY:Reunión semanal",
  "END:VEVENT",
  // Varios días de día completo con alerta a las 9:00 del día anterior.
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261224",
  "DTEND;VALUE=DATE:20261227",
  "DTSTAMP:20261120T100000Z",
  "UID:vacaciones-2026@google.com",
  "SUMMARY:Vacaciones",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15H",
  "END:VALARM",
  "END:VEVENT",
  // En UTC.
  "BEGIN:VEVENT",
  "DTSTART:20261125T170000Z",
  "DTEND:20261125T180000Z",
  "DTSTAMP:20261120T100000Z",
  "UID:dentista@google.com",
  "SUMMARY:Dentista",
  "URL:https://example.com/cita",
  "END:VEVENT",
  // Aniversario anual de día completo.
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20200310",
  "DTEND;VALUE=DATE:20200311",
  "RRULE:FREQ=YEARLY",
  "DTSTAMP:20261120T100000Z",
  "UID:aniversario@google.com",
  "SUMMARY:Aniversario",
  "END:VEVENT",
  "END:VCALENDAR",
]);

export const WORK_EXPORT = crlf([
  ...calendarHeader("Trabajo"),
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Madrid:20261201T090000",
  "DTEND;TZID=Europe/Madrid:20261201T093000",
  "RRULE:FREQ=DAILY;COUNT=5",
  "UID:daily@google.com",
  "SUMMARY:Daily",
  "END:VEVENT",
  "END:VCALENDAR",
]);

/** Un evento con datos hostiles en todos los campos de texto. */
export const HOSTILE = crlf([
  ...calendarHeader('<img src=x onerror="alert(1)">'),
  "BEGIN:VEVENT",
  "DTSTART:20261201T100000Z",
  "DTEND:20261201T110000Z",
  `UID:${"x".repeat(5000)}`,
  "SUMMARY:<script>alert('xss')</script>Hola\u0007\u202e",
  'DESCRIPTION:<a href="javascript:alert(1)">clic</a>&lt\\;b&gt\\;',
  "URL:javascript:alert(1)",
  "LOCATION:<iframe src=//evil></iframe>Plaza",
  "END:VEVENT",
  "END:VCALENDAR",
]);

/** Muchos eventos (para los límites). */
export function manyEvents(count: number): string {
  const lines = [...calendarHeader("Grande")];
  for (let i = 0; i < count; i++) {
    const day = String((i % 28) + 1).padStart(2, "0");
    lines.push(
      "BEGIN:VEVENT",
      `DTSTART:202612${day}T100000Z`,
      `DTEND:202612${day}T110000Z`,
      `UID:evento-${String(i)}@example.com`,
      `SUMMARY:Evento ${String(i)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return crlf(lines);
}
