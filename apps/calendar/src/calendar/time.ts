import {
  dateOnlyToUtc,
  type EventDetail,
  fromFloating,
  instantToWall,
  type Occurrence,
  toFloating,
  utcToDateOnly,
  wallToInstant,
} from "@delyra/shared";

/**
 * FullCalendar trabaja aquí en «UTC» y recibe horas de pared de la zona del usuario: un evento a
 * las 10:00 en Madrid se le pasa como `…T10:00:00Z`. Así no hace falta su plugin de zonas, y los
 * cambios de horario los resuelve `@delyra/shared` (`time.ts`) al convertir a instantes reales.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Inicio/fin de una ocurrencia en el formato que espera FullCalendar. */
export function toCalendarTime(value: string, allDay: boolean, timeZone: string): string {
  if (allDay) return value;
  return new Date(toFloating(Date.parse(value), timeZone)).toISOString();
}

/** Fecha devuelta por FullCalendar (arrastre, selección) → formato de la API. */
export function fromCalendarDate(date: Date, allDay: boolean, timeZone: string): string {
  if (allDay) return utcToDateOnly(date.getTime());
  return new Date(fromFloating(date.getTime(), timeZone)).toISOString();
}

/** Instante real del borde de un rango visible de FullCalendar. */
export function rangeEdge(date: Date, timeZone: string): string {
  return new Date(fromFloating(date.getTime(), timeZone)).toISOString();
}

/** «Ahora» en hora de pared, para la línea de la hora actual. */
export function floatingNow(timeZone: string): Date {
  return new Date(toFloating(Date.now(), timeZone));
}

/** Instante ISO → campos de fecha y hora de los inputs del editor. */
export function splitInstant(iso: string, timeZone: string): { date: string; time: string } {
  const wall = instantToWall(Date.parse(iso), timeZone);
  return {
    date: `${String(wall.year)}-${pad(wall.month)}-${pad(wall.day)}`,
    time: `${pad(wall.hour)}:${pad(wall.minute)}`,
  };
}

/** Campos del editor → instante ISO en la zona del usuario. */
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

/** Diferencia en hora de pared entre dos valores (instantes o fechas) del mismo tipo. */
export function wallDelta(from: string, to: string, allDay: boolean, timeZone: string): number {
  if (allDay) return dateOnlyToUtc(to) - dateOnlyToUtc(from);
  return toFloating(Date.parse(to), timeZone) - toFloating(Date.parse(from), timeZone);
}

/** Desplaza el inicio y el fin de una serie en hora de pared (mover «todos» desde una ocurrencia). */
export function shiftSeries(
  detail: Pick<EventDetail, "start" | "end" | "allDay" | "tz">,
  delta: number,
): { start: string; end: string } {
  if (detail.allDay) {
    return {
      start: utcToDateOnly(dateOnlyToUtc(detail.start) + delta),
      end: utcToDateOnly(dateOnlyToUtc(detail.end) + delta),
    };
  }
  const shift = (iso: string) =>
    new Date(fromFloating(toFloating(Date.parse(iso), detail.tz) + delta, detail.tz)).toISOString();
  return { start: shift(detail.start), end: shift(detail.end) };
}

/** Texto corto de la fecha y hora de una ocurrencia («lun 11 ene, 10:00–11:00»). */
export function describeWhen(
  occurrence: Pick<Occurrence, "start" | "end" | "allDay">,
  timeZone: string,
) {
  if (occurrence.allDay) {
    const start = new Date(dateOnlyToUtc(occurrence.start));
    return new Intl.DateTimeFormat("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(start);
  }
  const day = new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(occurrence.start));
  const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone });
  return `${day}, ${time.format(new Date(occurrence.start))}–${time.format(new Date(occurrence.end))}`;
}
