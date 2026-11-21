import { TZDate } from "@date-fns/tz";

/**
 * Conversión entre instantes (UTC) y hora local de una zona IANA (F2). Las recurrencias y las
 * alertas se calculan en hora local («todos los lunes a las 10:00») y se convierten a instantes
 * al final, para que los cambios de horario no las desplacen.
 *
 * - Hora inexistente (último domingo de marzo, 02:30 en Madrid): se adelanta a la primera válida.
 * - Hora duplicada (último domingo de octubre): se toma la primera de las dos.
 */

export interface WallTime {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DAY_MS = 86_400_000;

export function instantToWall(ms: number, timeZone: string): WallTime {
  const date = new TZDate(ms, timeZone);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

export function wallToInstant(wall: WallTime, timeZone: string): number {
  return new TZDate(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    timeZone,
  ).getTime();
}

/**
 * Representación «flotante»: un instante ficticio cuyos campos UTC son la hora local de la zona.
 * Permite aplicar reglas (RRULE) sin cambios de horario y volver a la zona al final.
 */
export function toFloating(ms: number, timeZone: string): number {
  const w = instantToWall(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

export function fromFloating(floating: number, timeZone: string): number {
  const d = new Date(floating);
  return wallToInstant(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    },
    timeZone,
  );
}

// ── Fechas sin hora (eventos de día completo y cumpleaños) ──────────────────────

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `AAAA-MM-DD` → medianoche UTC de ese día (así se guardan los eventos de día completo). */
export function dateOnlyToUtc(date: string): number {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new RangeError(`Fecha no válida: ${date}`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Fecha no válida: ${date}`);
  }
  return ms;
}

export function utcToDateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDateOnly(date: string): boolean {
  try {
    dateOnlyToUtc(date);
    return true;
  } catch {
    return false;
  }
}

/** Instante en que empieza un día (00:00) en una zona: base de las alertas de día completo. */
export function startOfDayInZone(utcMidnight: number, timeZone: string): number {
  const d = new Date(utcMidnight);
  return wallToInstant(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

export function addDays(utcMidnight: number, days: number): number {
  return utcMidnight + days * DAY_MS;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
