import {
  type BoardColumn,
  type BoardDetail,
  type BoardTemplate,
  type CardPriority,
  type CardSummary,
  dateOnlyToUtc,
  instantToWall,
  utcToDateOnly,
  wallToInstant,
} from "@delyra/shared";
import { intlLocale } from "@delyra/ui";
import { generateKeyBetween } from "fractional-indexing";
import { workMessages } from "./messages";

/** Lógica del tablero sin React: orden, movimientos optimistas, filtros y fechas (F4-08, F4-10). */

const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

export function sortedColumns(board: BoardDetail): BoardColumn[] {
  return [...board.columns].sort(byPosition);
}

/** Ids de tarjetas por columna, ya ordenados. */
export function cardIdsByColumn(board: BoardDetail): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const column of board.columns) result[column.id] = [];
  for (const card of [...board.cards].sort(byPosition)) result[card.columnId]?.push(card.id);
  return result;
}

/**
 * Índice para la API a partir de lo que se ve: con filtros, la columna visible es un subconjunto
 * y el índice debe referirse a la lista completa. Se coloca justo antes de la siguiente tarjeta
 * visible (o justo después de la anterior).
 */
export function serverIndex(
  fullIds: readonly string[],
  visibleAfterDrop: readonly string[],
  draggedId: string,
): number {
  const full = fullIds.filter((id) => id !== draggedId);
  const at = visibleAfterDrop.indexOf(draggedId);
  const next = visibleAfterDrop.slice(at + 1).find((id) => full.includes(id));
  if (next !== undefined) return full.indexOf(next);
  const previous = [...visibleAfterDrop.slice(0, Math.max(at, 0))]
    .reverse()
    .find((id) => full.includes(id));
  if (previous !== undefined) return full.indexOf(previous) + 1;
  // Sin vecinas visibles (solo se ve ella): se queda donde estaba.
  const own = fullIds.indexOf(draggedId);
  return own >= 0 ? own : full.length;
}

function keyAt(sorted: readonly string[], index: number): string {
  const i = Math.max(0, Math.min(index, sorted.length));
  return generateKeyBetween(sorted[i - 1] ?? null, sorted[i] ?? null);
}

/** El tablero tal y como quedará tras mover la tarjeta (actualización optimista). */
export function moveCardLocally(
  board: BoardDetail,
  cardId: string,
  columnId: string,
  index: number,
  now = new Date(),
  assignee?: string,
): BoardDetail {
  const card = board.cards.find((c) => c.id === cardId);
  const column = board.columns.find((c) => c.id === columnId);
  if (!card || !column) return board;
  const siblings = board.cards
    .filter((c) => c.columnId === columnId && c.id !== cardId)
    .sort(byPosition)
    .map((c) => c.position);
  const position = keyAt(siblings, index);
  const completedAt = column.isDone ? (card.completedAt ?? now.toISOString()) : null;
  return {
    ...board,
    cards: board.cards.map((c) =>
      c.id === cardId
        ? { ...c, columnId, position, completedAt, ...(assignee !== undefined ? { assignee } : {}) }
        : c,
    ),
  };
}

export function moveColumnLocally(board: BoardDetail, columnId: string, index: number) {
  const others = sortedColumns(board)
    .filter((c) => c.id !== columnId)
    .map((c) => c.position);
  const position = keyAt(others, index);
  return {
    ...board,
    columns: board.columns.map((c) => (c.id === columnId ? { ...c, position } : c)),
  };
}

// ── Fechas límite ────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

function localDate(ms: number, timeZone: string): string {
  const w = instantToWall(ms, timeZone);
  return `${String(w.year)}-${pad(w.month)}-${pad(w.day)}`;
}

export interface DueInfo {
  allDay: boolean;
  at: string;
  tz: string;
}

/** Día local de la fecha límite (las de todo el día ya son un día). */
function dueDate(due: DueInfo, timeZone: string): string {
  return due.allDay ? due.at : localDate(Date.parse(due.at), timeZone);
}

export function isOverdue(
  card: Pick<CardSummary, "due" | "completedAt">,
  now: number,
  timeZone: string,
): boolean {
  if (!card.due || card.completedAt) return false;
  return card.due.allDay ? card.due.at < localDate(now, timeZone) : Date.parse(card.due.at) < now;
}

/** ¿Vence en los próximos 7 días (hoy incluido)? */
export function dueThisWeek(card: Pick<CardSummary, "due">, now: number, timeZone: string) {
  if (!card.due) return false;
  const today = localDate(now, timeZone);
  const last = utcToDateOnly(dateOnlyToUtc(today) + 6 * 86_400_000);
  const date = dueDate(card.due, timeZone);
  return date >= today && date <= last;
}

/** «Hoy», «Mañana 17:00», «12 may»… */
export function dueLabel(due: DueInfo, timeZone: string, now: number): string {
  const date = dueDate(due, timeZone);
  const today = localDate(now, timeZone);
  const tomorrow = utcToDateOnly(dateOnlyToUtc(today) + 86_400_000);
  const yesterday = utcToDateOnly(dateOnlyToUtc(today) - 86_400_000);
  const t = workMessages().due;
  const day =
    date === today
      ? t.today
      : date === tomorrow
        ? t.tomorrow
        : date === yesterday
          ? t.yesterday
          : new Intl.DateTimeFormat(intlLocale(), {
              day: "numeric",
              month: "short",
              ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
              timeZone: "UTC",
            }).format(new Date(dateOnlyToUtc(date)));
  if (due.allDay) return day;
  const w = instantToWall(Date.parse(due.at), timeZone);
  return `${day} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** Valor para `<input type="datetime-local">` en la zona del usuario. */
export function toLocalInput(iso: string, timeZone: string): string {
  const w = instantToWall(Date.parse(iso), timeZone);
  return `${String(w.year)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

export function fromLocalInput(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return new Date(
    wallToInstant({ year: y, month: mo, day: d, hour: h, minute: mi, second: 0 }, timeZone),
  ).toISOString();
}

// ── Filtros (F4-10) ──────────────────────────────────────────────────────────

export interface BoardFilters {
  q?: string;
  label?: string;
  priority?: CardPriority;
  due?: "overdue" | "week";
}

export function hasFilters(filters: BoardFilters): boolean {
  return (
    (filters.q?.trim() ?? "") !== "" ||
    filters.label !== undefined ||
    filters.priority !== undefined ||
    filters.due !== undefined
  );
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function matchesFilters(
  card: CardSummary,
  filters: BoardFilters,
  now: number,
  timeZone: string,
): boolean {
  const q = filters.q?.trim();
  if (q && !normalize(card.title).includes(normalize(q))) return false;
  if (filters.label && !card.labelIds.includes(filters.label)) return false;
  if (filters.priority && card.priority !== filters.priority) return false;
  if (filters.due === "overdue" && !isOverdue(card, now, timeZone)) return false;
  if (filters.due === "week" && !dueThisWeek(card, now, timeZone)) return false;
  return true;
}

/** Nombre de una prioridad en el idioma actual. */
export const priorityLabel = (priority: CardPriority): string =>
  workMessages().priorities[priority];

/** Nombre y descripción de una plantilla de tablero en el idioma actual. */
export const templateLabel = (template: BoardTemplate) => workMessages().templates[template];
