/**
 * Utilidades de fecha mínimas. Todo instante se guarda en UTC; la zona del usuario
 * solo se aplica al mostrar (el cálculo con zonas llega en F2 con @date-fns/tz).
 */

/** `AAAA-MM-DD` del instante en UTC. */
export function formatUtcDate(input: Date | number): string {
  const date = typeof input === "number" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) throw new RangeError("Fecha no válida");
  return date.toISOString().slice(0, 10);
}

/** ISO 8601 en UTC con milisegundos (`2026-11-20T10:00:00.000Z`). */
export function toIsoUtc(input: Date | number): string {
  const date = typeof input === "number" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) throw new RangeError("Fecha no válida");
  return date.toISOString();
}
