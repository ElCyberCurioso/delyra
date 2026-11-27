import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Orden con índices fraccionales (F4-02): mover un elemento solo cambia su clave, que se
 * genera entre las de sus vecinos. Si una clave crece demasiado (muchas inserciones en el mismo
 * hueco), se reequilibran todas las de la lista.
 */

export const MAX_KEY_LENGTH = 50;

/** Clave para dejar un elemento en `index` dentro de `sorted` (claves ordenadas, sin él). */
export function keyAt(sorted: readonly string[], index: number): string {
  const i = Math.max(0, Math.min(index, sorted.length));
  return generateKeyBetween(sorted[i - 1] ?? null, sorted[i] ?? null);
}

function needsRebalance(key: string): boolean {
  return key.length > MAX_KEY_LENGTH;
}

/** Claves cortas y equidistantes para `count` elementos (reequilibrado o alta en bloque). */
export function evenKeys(count: number): string[] {
  return count === 0 ? [] : generateNKeysBetween(null, null, count);
}

/**
 * Coloca `id` en `index` de la lista ordenada `items` y devuelve las claves que cambian:
 * normalmente solo la suya; todas si hace falta reequilibrar.
 */
export function placeAt<T extends { id: string; position: string }>(
  items: readonly T[],
  id: string,
  index: number,
): Map<string, string> {
  const others = items.filter((item) => item.id !== id);
  const key = keyAt(
    others.map((item) => item.position),
    index,
  );
  if (!needsRebalance(key)) return new Map([[id, key]]);
  const order = [...others];
  order.splice(Math.max(0, Math.min(index, order.length)), 0, { id } as T);
  const keys = evenKeys(order.length);
  return new Map(order.map((item, i) => [item.id, keys[i] ?? ""]));
}
