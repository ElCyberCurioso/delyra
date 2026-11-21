import { startOfDayInZone } from "@delyra/shared";
import { occurrencesAfter, type Series } from "../lib/recurrence";

/**
 * Cálculo de `next_fire_at` (F2-07). Común a eventos y, en la Fase 4, a tarjetas: cualquier
 * cosa que pueda describirse como `Series` (una fecha suelta es una serie sin regla).
 *
 * - Con hora: avisa `offset` minutos antes del inicio.
 * - Día completo: `offset` es relativo a las 00:00 del día en la zona del evento (negativo =
 *   ese mismo día; p. ej. -540 son las 9:00).
 * - Las excepciones de una serie (ocurrencias movidas) avisan según su nuevo inicio.
 */

const DAY_MS = 86_400_000;
const MAX_SCAN = 1_000;

export interface ScheduleOverride {
  originalStart: number;
  startAt: number;
  allDay: boolean;
}

function fireTime(start: number, allDay: boolean, tz: string, offsetMinutes: number): number {
  const base = allDay ? startOfDayInZone(start, tz) : start;
  return base - offsetMinutes * 60_000;
}

export function nextFireAt(
  series: Series,
  overrides: readonly ScheduleOverride[],
  offsetMinutes: number,
  now: number,
): number | null {
  const overridden = new Set(overrides.map((o) => o.originalStart));
  let best: number | null = null;

  for (const override of overrides) {
    const fire = fireTime(override.startAt, override.allDay, series.tz, offsetMinutes);
    if (fire > now && (best === null || fire < best)) best = fire;
  }

  // Las ocurrencias salen en orden, así que la primera alerta futura es la menor.
  const from = now + offsetMinutes * 60_000 - 2 * DAY_MS;
  let scanned = 0;
  for (const occurrence of occurrencesAfter(series, from)) {
    if (++scanned > MAX_SCAN) break;
    if (overridden.has(occurrence.originalStart)) continue;
    const fire = fireTime(occurrence.start, series.allDay, series.tz, offsetMinutes);
    if (fire <= now) continue;
    if (best === null || fire < best) best = fire;
    break;
  }
  return best;
}
