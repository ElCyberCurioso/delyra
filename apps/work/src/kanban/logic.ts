import {
  type BoardColumn,
  type BoardDetail,
  type BoardTemplate,
  type CardDetail,
  type CardKind,
  type CardPriority,
  type CardSummary,
  dateOnlyToUtc,
  instantToDateOnly,
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

export interface DueInfo {
  allDay: boolean;
  at: string;
  tz: string;
}

/** Día local de la fecha límite (las de todo el día ya son un día). */
function dueDate(due: DueInfo, timeZone: string): string {
  return due.allDay ? due.at : instantToDateOnly(Date.parse(due.at), timeZone);
}

export function isOverdue(
  card: Pick<CardSummary, "due" | "completedAt">,
  now: number,
  timeZone: string,
): boolean {
  if (!card.due || card.completedAt) return false;
  return card.due.allDay
    ? card.due.at < instantToDateOnly(now, timeZone)
    : Date.parse(card.due.at) < now;
}

/** ¿Vence en los próximos 7 días (hoy incluido)? */
export function dueThisWeek(card: Pick<CardSummary, "due">, now: number, timeZone: string) {
  if (!card.due) return false;
  const today = instantToDateOnly(now, timeZone);
  const last = utcToDateOnly(dateOnlyToUtc(today) + 6 * 86_400_000);
  const date = dueDate(card.due, timeZone);
  return date >= today && date <= last;
}

/** «Hoy», «Mañana 17:00», «12 may»… */
export function dueLabel(due: DueInfo, timeZone: string, now: number): string {
  const date = dueDate(due, timeZone);
  const today = instantToDateOnly(now, timeZone);
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

// ── Borrador del detalle de tarjeta ──────────────────────────────────────────

/**
 * Lo que el detalle de una tarjeta guarda con su botón «Guardar cambios». Lo demás (mover,
 * checklist, comentarios, adjuntos, archivar) es de un solo gesto y va al momento.
 */
export interface CardEdits {
  title: string;
  description: string;
  kind: CardKind;
  priority: CardPriority;
  color: string | null;
  /** Texto del campo: vacío = nadie. */
  assignee: string;
  labelIds: string[];
  due: { allDay: boolean; at: string } | null;
  /** Minutos del aviso por Telegram, en texto; vacío = sin aviso. */
  reminder: string;
}

/** Solo los campos que se han tocado (los demás se ven tal y como están guardados). */
export type CardDraft = Partial<CardEdits>;

/** El aviso que pone la API al dar fecha a una tarjeta sin elegir ninguno. */
export const defaultReminder = (allDay: boolean) => (allDay ? "-540" : "60");

/** El aviso guardado o, si aún no tiene fecha, el que pondría la API con la fecha nueva. */
function savedReminder(card: CardDetail, allDay: boolean): string {
  if (!card.due) return defaultReminder(allDay);
  const first = card.reminders[0];
  return first ? String(first.offsetMinutes) : "";
}

/** Lo que se ve en el detalle: lo guardado con el borrador encima. */
export function cardEdits(card: CardDetail, draft: CardDraft): CardEdits {
  const due =
    draft.due !== undefined
      ? draft.due
      : card.due
        ? { allDay: card.due.allDay, at: card.due.at }
        : null;
  return {
    title: draft.title ?? card.title,
    description: draft.description ?? card.description,
    kind: draft.kind ?? card.kind,
    priority: draft.priority ?? card.priority,
    color: draft.color !== undefined ? draft.color : card.color,
    assignee: draft.assignee ?? card.assignee ?? "",
    labelIds: draft.labelIds ?? card.labelIds,
    due,
    reminder: draft.reminder ?? savedReminder(card, due?.allDay ?? false),
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

function sameDue(a: CardEdits["due"], b: DueInfo | null) {
  if (a === null || b === null) return a === b;
  if (a.allDay !== b.allDay) return false;
  return a.allDay ? a.at === b.at : Date.parse(a.at) === Date.parse(b.at);
}

/**
 * Lo que manda el botón «Guardar cambios»: solo lo que cambia de verdad. Elegir una fecha
 * tocando el día, el mes y la hora deja un único `due` (y una sola fila en la actividad).
 * Los avisos solo los elige quien creó el tablero (`reminders`).
 */
export function cardPatch(
  card: CardDetail,
  draft: CardDraft,
  options: { timeZone: string; reminders: boolean },
): Record<string, unknown> {
  const next = cardEdits(card, draft);
  const patch: Record<string, unknown> = {};
  const title = next.title.trim();
  if (title !== card.title) patch.title = title;
  if (next.description !== card.description) patch.description = next.description;
  if (next.kind !== card.kind) patch.kind = next.kind;
  if (next.priority !== card.priority) patch.priority = next.priority;
  if ((next.color?.toLowerCase() ?? null) !== (card.color?.toLowerCase() ?? null)) {
    patch.color = next.color;
  }
  const assignee = next.assignee.trim();
  if (assignee !== (card.assignee ?? "")) patch.assignee = assignee === "" ? null : assignee;
  if (!sameSet(next.labelIds, card.labelIds)) patch.labelIds = next.labelIds;
  if (!sameDue(next.due, card.due)) {
    patch.due = next.due ? { ...next.due, tz: options.timeZone } : null;
  }
  if (
    options.reminders &&
    next.due !== null &&
    next.reminder !== savedReminder(card, next.due.allDay)
  ) {
    patch.reminders =
      next.reminder === "" ? [] : [{ offsetMinutes: Number(next.reminder), channel: "telegram" }];
  }
  return patch;
}

/** Tras guardar, el borrador conserva solo lo que se tocó mientras se guardaba. */
export function draftAfterSave(current: CardDraft, sent: CardDraft): CardDraft {
  return Object.fromEntries(
    Object.entries(current).filter(([key, value]) => sent[key as keyof CardDraft] !== value),
  );
}
