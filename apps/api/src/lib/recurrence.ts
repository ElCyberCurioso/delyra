import {
  type EventType,
  type Feb29Rule,
  fromFloating,
  isLeapYear,
  toFloating,
} from "@delyra/shared";
import { Frequency, type Options, RRule } from "rrule";

/**
 * Recurrencias (F2-04, F2-05, F2-06). Las reglas se aplican en hora local «flotante» de la zona
 * del evento y cada ocurrencia se convierte después a instante: «los lunes a las 10:00» sigue
 * siendo a las 10:00 tras el cambio de horario. La duración real se conserva.
 *
 * Los eventos de día completo ya se guardan como medianoches UTC, así que no necesitan zona.
 */

const DAY_MS = 86_400_000;
const MAX_OCCURRENCES_PER_QUERY = 2_000;
const MAX_COUNT = 1_000;
const ALLOWED_KEYS = new Set([
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
const present = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;
const ALLOWED_FREQ = new Set([
  Frequency.DAILY,
  Frequency.WEEKLY,
  Frequency.MONTHLY,
  Frequency.YEARLY,
]);

export interface Series {
  startAt: number;
  endAt: number;
  tz: string;
  allDay: boolean;
  type: EventType;
  rrule: string | null;
  exdates: readonly number[];
  birthYear?: number | null;
  feb29Rule?: Feb29Rule | null;
}

export interface Occurrence {
  start: number;
  end: number;
  /** Inicio que tendría la ocurrencia según la regla: identifica excepciones y borrados. */
  originalStart: number;
  /** Edad que se cumple (cumpleaños con año de nacimiento). */
  age: number | null;
}

export type RruleCheck = { ok: true; rrule: string } | { ok: false; message: string };

function serialize(options: Partial<Options>): string {
  const { dtstart: _dtstart, tzid: _tzid, ...rest } = options;
  return RRule.optionsToString(rest).replace(/^RRULE:/, "");
}

/** Valida una RRULE y la devuelve normalizada. Solo frecuencias diaria o mayores. */
export function checkRrule(rrule: string): RruleCheck {
  for (const part of rrule.split(";")) {
    const key = part.split("=")[0] ?? "";
    if (!ALLOWED_KEYS.has(key)) return { ok: false, message: `Propiedad no admitida: ${key}` };
  }
  let options: Partial<Options>;
  try {
    options = RRule.parseString(rrule);
  } catch {
    return { ok: false, message: "La regla de repetición no es válida" };
  }
  if (options.freq === undefined || !ALLOWED_FREQ.has(options.freq)) {
    return { ok: false, message: "Solo se admite repetición diaria, semanal, mensual o anual" };
  }
  if (present(options.count) && (options.count < 1 || options.count > MAX_COUNT)) {
    return { ok: false, message: `Como máximo ${String(MAX_COUNT)} repeticiones` };
  }
  if (present(options.interval) && (options.interval < 1 || options.interval > 1000)) {
    return { ok: false, message: "Intervalo no válido" };
  }
  if (present(options.count) && present(options.until)) {
    return { ok: false, message: "Usa COUNT o UNTIL, no los dos" };
  }
  return { ok: true, rrule: serialize(options) };
}

function floatingStart(series: Series): number {
  return series.allDay ? series.startAt : toFloating(series.startAt, series.tz);
}

function toInstant(series: Series, floating: number): number {
  return series.allDay ? floating : fromFloating(floating, series.tz);
}

function buildRule(series: Series): RRule {
  if (!series.rrule) throw new Error("La serie no tiene regla");
  return new RRule({
    ...RRule.parseString(series.rrule),
    dtstart: new Date(floatingStart(series)),
  });
}

// ── Cumpleaños ─────────────────────────────────────────────────────────────────

/** Día de un cumpleaños en un año dado, con la regla del 29 de febrero. */
export function birthdayInYear(series: Series, year: number): number {
  const base = new Date(series.startAt);
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  if (month === 1 && day === 29 && !isLeapYear(year)) {
    return series.feb29Rule === "mar1" ? Date.UTC(year, 2, 1) : Date.UTC(year, 1, 28);
  }
  return Date.UTC(year, month, day);
}

function birthdayOccurrence(series: Series, year: number): Occurrence {
  const start = birthdayInYear(series, year);
  return {
    start,
    end: start + DAY_MS,
    originalStart: start,
    age: series.birthYear ? year - series.birthYear : null,
  };
}

// ── Expansión ──────────────────────────────────────────────────────────────────

function single(series: Series): Occurrence {
  return { start: series.startAt, end: series.endAt, originalStart: series.startAt, age: null };
}

/** Ocurrencias que se solapan con `[from, to)`, sin las borradas (`exdates`). */
export function expandSeries(series: Series, from: number, to: number): Occurrence[] {
  const excluded = new Set(series.exdates);
  const overlaps = (o: Occurrence) =>
    o.start < to && o.end > from && !excluded.has(o.originalStart);

  if (series.type === "birthday") {
    const firstYear = new Date(series.startAt).getUTCFullYear();
    const result: Occurrence[] = [];
    const fromYear = Math.max(firstYear, new Date(from).getUTCFullYear() - 1);
    for (let year = fromYear; year <= new Date(to).getUTCFullYear(); year++) {
      const occurrence = birthdayOccurrence(series, year);
      if (overlaps(occurrence)) result.push(occurrence);
    }
    return result;
  }

  if (!series.rrule) return overlaps(single(series)) ? [single(series)] : [];

  const duration = series.endAt - series.startAt;
  const rule = buildRule(series);
  // Margen de un día a cada lado: la hora flotante difiere de la real como mucho en ±14 h.
  const after = new Date(from - duration - DAY_MS);
  const before = new Date(to + DAY_MS);
  const result: Occurrence[] = [];
  rule.between(after, before, true, (date) => {
    const start = toInstant(series, date.getTime());
    const occurrence = { start, end: start + duration, originalStart: start, age: null };
    if (overlaps(occurrence)) result.push(occurrence);
    return result.length < MAX_OCCURRENCES_PER_QUERY;
  });
  return result;
}

/** Ocurrencias en orden con inicio posterior a `after` (para las alertas, F2-07). */
export function* occurrencesAfter(series: Series, after: number): Generator<Occurrence> {
  const excluded = new Set(series.exdates);
  if (series.type === "birthday") {
    const firstYear = new Date(series.startAt).getUTCFullYear();
    for (let year = Math.max(firstYear, new Date(after).getUTCFullYear() - 1); ; year++) {
      const occurrence = birthdayOccurrence(series, year);
      if (occurrence.start > after && !excluded.has(occurrence.originalStart)) yield occurrence;
      if (year > firstYear + 200) return;
    }
  }
  if (!series.rrule) {
    if (series.startAt > after && !excluded.has(series.startAt)) yield single(series);
    return;
  }
  const duration = series.endAt - series.startAt;
  const rule = buildRule(series);
  let cursor = new Date(after - DAY_MS);
  for (let i = 0; i < 5_000; i++) {
    const next = rule.after(cursor, false);
    if (!next) return;
    cursor = next;
    const start = toInstant(series, next.getTime());
    if (start > after && !excluded.has(start)) {
      yield { start, end: start + duration, originalStart: start, age: null };
    }
  }
}

/** Fin de la serie (para descartarla en consultas por rango) o null si no termina. */
export function seriesEnd(series: Series): number | null {
  if (series.type === "birthday") return null;
  if (!series.rrule) return series.endAt;
  const rule = buildRule(series);
  const { count, until } = rule.origOptions;
  if (!present(count) && !present(until)) return null;
  const last = present(count) ? rule.all().at(-1) : rule.before(until ?? new Date(0), true);
  if (!last) return series.endAt;
  return toInstant(series, last.getTime()) + (series.endAt - series.startAt);
}

/** ¿La regla genera una ocurrencia con este inicio? (valida «solo este» y «los siguientes»). */
export function isOccurrenceStart(series: Series, start: number): boolean {
  if (series.type === "birthday") {
    return birthdayInYear(series, new Date(start).getUTCFullYear()) === start;
  }
  if (!series.rrule) return start === series.startAt;
  return expandSeries({ ...series, exdates: [] }, start, start + 1).some(
    (o) => o.originalStart === start,
  );
}

/**
 * Parte la serie en una ocurrencia (F2-05, «este y los siguientes»): la regla anterior termina
 * justo antes y la nueva empieza en ella. Con COUNT se reparte el total entre las dos.
 */
export function splitRule(
  series: Series,
  occurrenceStart: number,
): { before: string; after: string; countBefore: number } {
  const rule = buildRule(series);
  const options = RRule.parseString(series.rrule ?? "");
  const splitFloating = series.allDay ? occurrenceStart : toFloating(occurrenceStart, series.tz);
  const countBefore = rule.between(
    new Date(floatingStart(series) - 1),
    new Date(splitFloating),
    false,
  ).length;
  if (present(options.count)) {
    return {
      before: serialize({ ...options, count: countBefore }),
      after: serialize({ ...options, count: Math.max(options.count - countBefore, 1) }),
      countBefore,
    };
  }
  return {
    before: serialize({ ...options, until: new Date(splitFloating - 1000) }),
    after: serialize(options),
    countBefore,
  };
}

/**
 * Desplaza un instante de la serie en hora local (F2-05, «todos» con otra hora): las
 * excepciones y los borrados siguen apuntando a sus ocurrencias aunque haya cambio de horario.
 */
export function shiftInSeries(series: Series, instant: number, deltaFloating: number): number {
  if (series.allDay) return instant + deltaFloating;
  return fromFloating(toFloating(instant, series.tz) + deltaFloating, series.tz);
}

/** Diferencia en hora local entre dos inicios (para `shiftInSeries`). */
export function floatingDelta(
  series: Series,
  from: { startAt: number; tz: string; allDay: boolean },
): number {
  if (series.allDay !== from.allDay) return 0;
  if (series.allDay) return series.startAt - from.startAt;
  return toFloating(series.startAt, series.tz) - toFloating(from.startAt, from.tz);
}
