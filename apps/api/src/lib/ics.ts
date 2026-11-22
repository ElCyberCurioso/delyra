import { EVENT_LIMITS, fromFloating, isValidTimeZone, toFloating } from "@delyra/shared";
import ICAL from "ical.js";
import {
  cleanColor,
  cleanReminders,
  cleanText,
  cleanTitle,
  cleanUid,
  cleanUrl,
  finalizeEvents,
  fixRange,
  hash,
  IMPORT_LIMITS,
  type ImportedEvent,
  ImportFormatError,
  ImportLimitError,
  stripBom,
  Warnings,
} from "./import-model";
import { checkRrule } from "./recurrence";

/**
 * Parser ICS (F5-01) con ical.js. Convierte un `VCALENDAR` en eventos del modelo propio:
 *
 * - `DTSTART`/`DTEND`/`DURATION` con `TZID` (IANA, prefijos de Mozilla, nombres de Windows o un
 *   `VTIMEZONE` propio), en UTC o flotantes (zona del calendario o del usuario).
 * - `RRULE` con `UNTIL` pasado a hora flotante, como guarda las reglas `lib/recurrence.ts`.
 * - `EXDATE`, `RECURRENCE-ID` (excepciones) y `STATUS:CANCELLED` (ocurrencias borradas).
 * - `VALARM` relativos al inicio, al fin o absolutos → minutos antes del inicio.
 *
 * Para no cargar en memoria el árbol entero de un fichero grande, el texto se recorre buscando
 * los bloques `VEVENT` y `VTIMEZONE`, y ical.js solo procesa cada bloque por separado.
 */

export interface ParsedCalendar {
  name: string | null;
  description: string | null;
  color: string | null;
  timeZone: string | null;
  events: ImportedEvent[];
  /** Eventos descartados (cancelados, sin fecha o con datos no válidos). */
  skipped: number;
  warnings: Warnings;
}

export interface ParseOptions {
  /** Zona para las horas flotantes si el calendario no indica `X-WR-TIMEZONE`. */
  defaultTimeZone: string;
  /** Eventos que aún caben en la importación (el resto se rechaza). */
  maxEvents?: number;
}

const DAY_MS = 86_400_000;
const MAX_COUNT = 1_000;
const RRULE_KEYS = new Set([
  "FREQ",
  "INTERVAL",
  "COUNT",
  "UNTIL",
  "BYDAY",
  "BYMONTHDAY",
  "BYMONTH",
  "BYSETPOS",
  "BYYEARDAY",
  "BYWEEKNO",
  "WKST",
]);
const SUPPORTED_FREQ = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

/** Nombres de zona de Windows (Outlook, Exchange) más habituales → IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  "Romance Standard Time": "Europe/Madrid",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "SA Pacific Standard Time": "America/Bogota",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Canary Standard Time": "Atlantic/Canary",
  UTC: "UTC",
  "Coordinated Universal Time": "UTC",
};

// ── Recorrido del texto ──────────────────────────────────────────────────────

/** Bloques `BEGIN:<name>` … `END:<name>` al principio de línea (no se anidan entre sí). */
function* blocks(text: string, name: string): Generator<string> {
  const begin = `BEGIN:${name}`;
  const end = `END:${name}`;
  let from = 0;
  for (;;) {
    let start = text.indexOf(begin, from);
    while (start > 0 && text[start - 1] !== "\n" && text[start - 1] !== "\r") {
      start = text.indexOf(begin, start + begin.length);
    }
    if (start < 0) return;
    let stop = text.indexOf(end, start);
    while (stop > 0 && text[stop - 1] !== "\n" && text[stop - 1] !== "\r") {
      stop = text.indexOf(end, stop + end.length);
    }
    if (stop < 0) return;
    yield text.slice(start, stop + end.length);
    from = stop + end.length;
  }
}

function countBlocks(text: string, name: string): number {
  let total = 0;
  for (const _ of blocks(text, name)) total++;
  return total;
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) =>
    char === "n" || char === "N" ? "\n" : char,
  );
}

/** Propiedades de la cabecera del `VCALENDAR` (antes del primer componente). */
function header(text: string): Map<string, string> {
  const first = text.search(/\r?\n?BEGIN:(VEVENT|VTIMEZONE|VTODO|VJOURNAL|VFREEBUSY)/);
  const head = (first < 0 ? text : text.slice(0, first)).replace(/\r?\n[ \t]/g, "");
  const result = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    const match = /^([A-Za-z-]+)(?:;[^:]*)?:(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined && !result.has(match[1].toUpperCase())) {
      result.set(match[1].toUpperCase(), unescapeText(match[2]));
    }
  }
  return result;
}

/** ¿Parece un calendario? (para decidir el tipo de un fichero subido). */
export function looksLikeIcs(head: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(stripBom(head));
}

// ── Zonas horarias ───────────────────────────────────────────────────────────

interface ZoneContext {
  defaultTz: string;
  /** VTIMEZONE del propio fichero, para TZID que no son IANA. */
  custom: Map<string, ICAL.Timezone>;
  /** TZID → zona IANA equivalente (o null si solo vale el VTIMEZONE). */
  resolved: Map<string, string | null>;
  warnings: Warnings;
}

function ianaFor(tzid: string, ctx: ZoneContext): string | null {
  const cached = ctx.resolved.get(tzid);
  if (cached !== undefined) return cached;
  let zone: string | null = null;
  const clean = tzid.replace(/^"|"$/g, "").trim();
  if (isValidTimeZone(clean)) zone = clean;
  else {
    // `/mozilla.org/20050126_1/Europe/Madrid`, `/citadel.org/…/Europe/Madrid`…
    const segments = clean.split("/").filter(Boolean);
    const tail = [segments.slice(-3).join("/"), segments.slice(-2).join("/")].find(
      (candidate) => candidate.includes("/") && isValidTimeZone(candidate),
    );
    if (tail) zone = tail;
    else if (WINDOWS_ZONES[clean]) zone = WINDOWS_ZONES[clean];
    else {
      const location = ctx.custom.get(tzid)?.component?.getFirstPropertyValue("x-lic-location");
      if (typeof location === "string" && isValidTimeZone(location)) zone = location;
    }
  }
  if (zone === null && !ctx.custom.has(tzid)) {
    ctx.warnings.add(`Zona horaria desconocida «${tzid.slice(0, 60)}»: se usa ${ctx.defaultTz}`);
    zone = ctx.defaultTz;
  }
  ctx.resolved.set(tzid, zone);
  return zone;
}

interface Moment {
  /** Instante (con hora) o medianoche UTC (fecha). */
  ms: number;
  isDate: boolean;
  /** Zona IANA en la que se expresó (null si era UTC). */
  zone: string | null;
}

function wallClock(time: ICAL.Time): number {
  return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
}

function moment(time: ICAL.Time, tzid: string | null, ctx: ZoneContext): Moment {
  if (time.isDate) {
    return { ms: Date.UTC(time.year, time.month - 1, time.day), isDate: true, zone: null };
  }
  const wall = wallClock(time);
  if (time.zone === ICAL.Timezone.utcTimezone) return { ms: wall, isDate: false, zone: null };
  if (tzid) {
    const zone = ianaFor(tzid, ctx);
    if (zone) return { ms: fromFloating(wall, zone), isDate: false, zone };
    const custom = ctx.custom.get(tzid);
    if (custom) return { ms: wall - custom.utcOffset(time) * 1000, isDate: false, zone: null };
  }
  // Hora flotante: la del calendario.
  return { ms: fromFloating(wall, ctx.defaultTz), isDate: false, zone: ctx.defaultTz };
}

function tzidOf(property: ICAL.Property): string | null {
  const value = property.getParameter("tzid");
  const tzid: unknown = Array.isArray(value) ? value[0] : value;
  return typeof tzid === "string" && tzid.length > 0 ? tzid.slice(0, 120) : null;
}

function momentOf(event: ICAL.Component, name: string, ctx: ZoneContext): Moment | null {
  const property = event.getFirstProperty(name);
  const value = property?.getFirstValue();
  if (!property || !(value instanceof ICAL.Time)) return null;
  return moment(value, tzidOf(property), ctx);
}

/** Todos los valores de una propiedad que puede repetirse y tener varios valores (`EXDATE`). */
function momentsOf(event: ICAL.Component, name: string, ctx: ZoneContext): Moment[] {
  const result: Moment[] = [];
  for (const property of event.getAllProperties(name)) {
    const tzid = tzidOf(property);
    for (const value of property.getValues()) {
      if (value instanceof ICAL.Time) result.push(moment(value, tzid, ctx));
    }
  }
  return result;
}

// ── Recurrencia ──────────────────────────────────────────────────────────────

function parseUntil(value: string, allDay: boolean, tz: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, z] = match;
  const date = [Number(y), Number(mo) - 1, Number(d)] as const;
  if (h === undefined) {
    // Fecha: incluye ese día entero.
    return allDay ? Date.UTC(...date) : Date.UTC(...date, 23, 59, 59);
  }
  const wall = Date.UTC(...date, Number(h), Number(mi), Number(s));
  if (allDay) return Date.UTC(...date);
  // Las reglas se guardan en hora flotante de la zona del evento.
  return z ? toFloating(wall, tz) : wall;
}

function formatUntil(floating: number): string {
  return new Date(floating)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** RRULE del ICS → la que admite `lib/recurrence.ts`, o null (el evento queda sin repetición). */
export function convertRrule(
  raw: string,
  start: { allDay: boolean; tz: string },
  warnings: Warnings,
): string | null {
  const parts: string[] = [];
  let freq: string | null = null;
  let hasCount = false;
  let until: string | null = null;
  for (const part of raw.replace(/^RRULE:/i, "").split(";")) {
    const [rawKey, rawValue = ""] = part.split("=");
    const key = rawKey?.trim().toUpperCase() ?? "";
    const value = rawValue.trim().toUpperCase();
    if (!key) continue;
    if (!RRULE_KEYS.has(key)) {
      warnings.add(`Se ha ignorado la parte «${key.slice(0, 20)}» de alguna repetición`);
      continue;
    }
    if (key === "FREQ") freq = value;
    if (key === "UNTIL") {
      const ms = parseUntil(value, start.allDay, start.tz);
      if (ms === null) {
        warnings.add("Alguna repetición tenía una fecha de fin no válida y se ha ignorado");
        continue;
      }
      until = `UNTIL=${formatUntil(ms)}`;
      continue;
    }
    if (key === "COUNT") {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1) continue;
      if (count > MAX_COUNT) {
        warnings.add(`Alguna repetición se ha limitado a ${String(MAX_COUNT)} veces`);
      }
      hasCount = true;
      parts.push(`COUNT=${String(Math.min(count, MAX_COUNT))}`);
      continue;
    }
    parts.push(`${key}=${value}`);
  }
  if (freq === null) return null;
  if (!SUPPORTED_FREQ.has(freq)) {
    warnings.add("Las repeticiones por horas o minutos no se admiten: se importa la primera vez");
    return null;
  }
  // Con COUNT y UNTIL a la vez (no válido en RFC 5545) se queda la fecha de fin.
  const rule = [
    ...parts.filter((p) => !(until && hasCount && p.startsWith("COUNT="))),
    ...(until ? [until] : []),
  ].join(";");
  const checked = checkRrule(rule);
  if (!checked.ok) {
    warnings.add(`Repetición no admitida (${checked.message}): se importa la primera vez`);
    return null;
  }
  return checked.rrule;
}

// ── Alertas ──────────────────────────────────────────────────────────────────

function alarms(event: ICAL.Component, startAt: number, endAt: number, warnings: Warnings) {
  const offsets: number[] = [];
  for (const alarm of event.getAllSubcomponents("valarm")) {
    const property = alarm.getFirstProperty("trigger");
    const value = property?.getFirstValue();
    if (!property) continue;
    if (value instanceof ICAL.Duration) {
      const related = String(property.getParameter("related") ?? "START").toUpperCase();
      const fire = (related === "END" ? endAt : startAt) + value.toSeconds() * 1000;
      offsets.push((startAt - fire) / 60_000);
    } else if (value instanceof ICAL.Time) {
      // Absoluta (`VALUE=DATE-TIME`, en UTC según RFC 5545).
      offsets.push((startAt - wallClock(value)) / 60_000);
    }
  }
  return cleanReminders(offsets, warnings);
}

// ── VEVENT ───────────────────────────────────────────────────────────────────

function text(event: ICAL.Component, name: string): string | null {
  const value = event.getFirstPropertyValue(name);
  return typeof value === "string" ? value : null;
}

type ParsedVevent =
  | { kind: "event"; event: ImportedEvent }
  | { kind: "cancelled"; uid: string; recurrenceId: number }
  | { kind: "skip" };

function parseVevent(block: string, ctx: ZoneContext, index: number): ParsedVevent {
  const event = new ICAL.Component(ICAL.parse(block) as unknown[]);
  const start = momentOf(event, "dtstart", ctx);
  if (!start) {
    ctx.warnings.add("Algún evento no tenía fecha de inicio y se ha descartado");
    return { kind: "skip" };
  }
  const allDay = start.isDate;
  const tz = start.zone ?? ctx.defaultTz;
  const uid = cleanUid(text(event, "uid"), `${String(index)}-${hash(block.slice(0, 2_000))}`);
  const recurrence = momentOf(event, "recurrence-id", ctx);
  const recurrenceId = recurrence
    ? recurrence.isDate && !allDay
      ? // Excepción indicada por fecha en una serie con hora: misma hora local que el inicio.
        fromFloating(recurrence.ms + (toFloating(start.ms, tz) % DAY_MS), tz)
      : recurrence.ms
    : null;
  const status = text(event, "status")?.toUpperCase();
  if (status === "CANCELLED") {
    return recurrenceId === null ? { kind: "skip" } : { kind: "cancelled", uid, recurrenceId };
  }

  let endAt: number | null = momentOf(event, "dtend", ctx)?.ms ?? null;
  const duration = event.getFirstPropertyValue("duration");
  if (endAt === null && duration instanceof ICAL.Duration) {
    endAt = start.ms + duration.toSeconds() * 1000;
  }
  endAt = fixRange(start.ms, endAt, allDay, ctx.warnings);

  const rruleProperties = recurrenceId === null ? event.getAllProperties("rrule") : [];
  if (rruleProperties.length > 1) {
    ctx.warnings.add("Algún evento tenía varias reglas de repetición: se usa la primera");
  }
  if (event.getFirstProperty("rdate")) {
    ctx.warnings.add("Las fechas sueltas de repetición (RDATE) no se admiten y se han ignorado");
  }
  const rawRule = rruleProperties[0]?.toICALString();
  const rrule = rawRule
    ? convertRrule(rawRule.split(":").slice(1).join(":"), { allDay, tz }, ctx.warnings)
    : null;
  const exdates = rrule
    ? momentsOf(event, "exdate", ctx).map((m) =>
        m.isDate && !allDay ? fromFloating(m.ms + (toFloating(start.ms, tz) % DAY_MS), tz) : m.ms,
      )
    : [];

  return {
    kind: "event",
    event: {
      uid,
      recurrenceId,
      type: "event",
      title: cleanTitle(text(event, "summary")),
      notes: cleanText(text(event, "description"), EVENT_LIMITS.notes),
      location: cleanText(text(event, "location"), EVENT_LIMITS.location),
      url: cleanUrl(text(event, "url")),
      allDay,
      startAt: start.ms,
      endAt,
      tz,
      rrule,
      exdates: [...new Set(exdates)],
      reminders: alarms(event, start.ms, endAt, ctx.warnings),
      feb29Rule: null,
    },
  };
}

// ── Entrada ──────────────────────────────────────────────────────────────────

export interface IcsSummary {
  name: string | null;
  events: number;
}

/** Resumen rápido sin procesar los eventos (cuenta los `VEVENT`). */
export function summarizeIcs(text: string): IcsSummary {
  const props = header(text);
  return {
    name: props.get("X-WR-CALNAME") ?? props.get("NAME") ?? null,
    events: countBlocks(text, "VEVENT"),
  };
}

export function parseIcs(text: string, options: ParseOptions): ParsedCalendar {
  if (!looksLikeIcs(text.slice(0, 512))) {
    throw new ImportFormatError("El fichero no es un calendario (.ics)");
  }
  if (text.length > IMPORT_LIMITS.icsBytes) {
    throw new ImportLimitError("El calendario es demasiado grande");
  }
  const total = countBlocks(text, "VEVENT");
  const max = options.maxEvents ?? IMPORT_LIMITS.events;
  if (total > max) {
    throw new ImportLimitError(
      `Demasiados eventos (${String(total)}); el máximo por importación es ${String(IMPORT_LIMITS.events)}`,
    );
  }

  const props = header(text);
  const warnings = new Warnings();
  const declared = props.get("X-WR-TIMEZONE")?.trim() ?? "";
  const timeZone = isValidTimeZone(declared) ? declared : null;
  const ctx: ZoneContext = {
    defaultTz: timeZone ?? options.defaultTimeZone,
    custom: new Map(),
    resolved: new Map(),
    warnings,
  };
  for (const block of blocks(text, "VTIMEZONE")) {
    try {
      const component = new ICAL.Component(ICAL.parse(block) as unknown[]);
      const tzid = component.getFirstPropertyValue("tzid");
      if (typeof tzid === "string" && ctx.custom.size < 100) {
        ctx.custom.set(tzid, ICAL.Timezone.fromData({ component, tzid }));
      }
    } catch {
      warnings.add("Alguna definición de zona horaria no era válida y se ha ignorado");
    }
  }

  const events: ImportedEvent[] = [];
  const cancelled: { uid: string; recurrenceId: number }[] = [];
  let skipped = 0;
  let index = 0;
  for (const block of blocks(text, "VEVENT")) {
    index++;
    let parsed: ParsedVevent;
    try {
      parsed = parseVevent(block, ctx, index);
    } catch {
      warnings.add("Algún evento estaba mal formado y se ha descartado");
      skipped++;
      continue;
    }
    if (parsed.kind === "event") events.push(parsed.event);
    else if (parsed.kind === "cancelled") cancelled.push(parsed);
    else skipped++;
  }
  if (index === 0 && !text.slice(-200).toUpperCase().includes("END:VCALENDAR")) {
    throw new ImportFormatError("El calendario está incompleto o mal formado");
  }

  return {
    name: cleanText(props.get("X-WR-CALNAME") ?? props.get("NAME"), 60),
    description: cleanText(props.get("X-WR-CALDESC") ?? props.get("DESCRIPTION"), 300),
    color: cleanColor(props.get("COLOR") ?? props.get("X-APPLE-CALENDAR-COLOR")),
    timeZone,
    events: finalizeEvents(events, cancelled, warnings),
    skipped,
    warnings,
  };
}
