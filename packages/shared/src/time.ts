/**
 * Conversión entre instantes (UTC) y hora local de una zona IANA (F2). Las recurrencias y las
 * alertas se calculan en hora local («todos los lunes a las 10:00») y se convierten a instantes
 * al final, para que los cambios de horario no las desplacen.
 *
 * - Hora inexistente (último domingo de marzo, 02:30 en Madrid): se adelanta a la primera válida.
 * - Hora duplicada (último domingo de octubre): se toma la primera de las dos.
 *
 * Solo usa `Intl` (instante → hora local, que es determinista) y resuelve a mano el paso inverso:
 * el resultado no depende de la zona horaria del sistema (los Workers corren en UTC y el
 * navegador en la del usuario, y ambos deben llegar al mismo instante).
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
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, format);
  }
  return format;
}

export function instantToWall(ms: number, timeZone: string): WallTime {
  const wall: WallTime = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type in wall) wall[part.type as keyof WallTime] = Number(part.value);
  }
  return wall;
}

const wallAsUtc = (w: WallTime) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);

/** Desfase de la zona en un instante (ms que hay que sumar al UTC para obtener la hora local). */
function offsetAt(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return wallAsUtc(instantToWall(whole, timeZone)) - whole;
}

export function wallToInstant(wall: WallTime, timeZone: string): number {
  const local = wallAsUtc(wall);
  // Los desfases posibles son el de antes y el de después de un cambio de horario cercano.
  const before = offsetAt(local - DAY_MS, timeZone);
  const after = offsetAt(local + DAY_MS, timeZone);
  const valid = [local - before, local - after].filter(
    (instant) => instant + offsetAt(instant, timeZone) === local,
  );
  // Hora duplicada: la primera. Hora inexistente: con el desfase anterior cae justo después.
  return valid.length > 0 ? Math.min(...valid) : local - before;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Día (`AAAA-MM-DD`) en que cae un instante en una zona: «hoy» para el usuario. */
export function instantToDateOnly(ms: number, timeZone: string): string {
  const w = instantToWall(ms, timeZone);
  return `${String(w.year)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Fecha (`AAAA-MM-DD`) y hora (`HH:MM`) locales de una zona → instante ISO. */
export function joinInstant(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
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
